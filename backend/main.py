"""PathGlot FastAPI backend.

WebSocket endpoint /ws/session handles:
  - Establishing Gemini Live session
  - Relaying audio from client → Gemini
  - Relaying audio from Gemini → client
  - Receiving position updates → Places API → context injection
"""

import asyncio
import json
import math
import os
import time
from typing import Any

from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware

from gemini_client import GeminiLiveSession
from places_client import nearby_search, text_search, haversine_distance
from context_builder import build_location_update, build_arrival_context
from language_config import build_system_prompt
from vision_locate import vision_locate_place

MOVEMENT_THRESHOLD_METERS = 30  # minimum move to trigger Places API call (~100ft)

app = FastAPI(title="PathGlot Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# City name lookup (mirrors frontend cities.ts)
CITY_NAMES: dict[str, str] = {
    "madrid": "Madrid, Spain",
    "barcelona": "Barcelona, Spain",
    "buenos-aires": "Buenos Aires, Argentina",
    "paris": "Paris, France",
    "montmartre": "Montmartre, Paris, France",
    "montreal": "Montréal, Canada",
    "berlin": "Berlin, Germany",
    "vienna": "Vienna, Austria",
    "tokyo-shibuya": "Tokyo (Shibuya), Japan",
    "osaka": "Osaka, Japan",
    "rome": "Rome, Italy",
    "florence": "Florence, Italy",
    "lisbon": "Lisbon, Portugal",
    "sao-paulo": "São Paulo, Brazil",
}


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/config")
async def config():
    return {"mapsApiKey": os.environ.get("GOOGLE_MAPS_API_KEY", "")}


@app.websocket("/ws/session")
async def session_endpoint(
    websocket: WebSocket,
    lang: str = Query("es"),
    city: str = Query("madrid"),
    guide: str = Query("Carlos"),
):
    await websocket.accept()

    city_name = CITY_NAMES.get(city, city.replace("-", " ").title())

    # Build system prompt
    system_prompt = build_system_prompt(
        guide_name=guide,
        language_code=lang,
        city_name=city_name,
    )

    # Callbacks from Gemini → WebSocket
    async def on_audio(base64_pcm: str):
        try:
            await websocket.send_text(
                json.dumps({"type": "audio", "data": base64_pcm})
            )
            print(f"[ws] sent audio chunk: {len(base64_pcm)} chars")
        except Exception as e:
            print(f"[ws] ERROR sending audio: {e}")

    async def on_audio_end():
        nonlocal highlight_fired_this_turn
        highlight_fired_this_turn = False
        try:
            await websocket.send_text(json.dumps({"type": "audio_end"}))
        except Exception:
            pass

    async def on_interrupted():
        nonlocal highlight_fired_this_turn
        highlight_fired_this_turn = False
        try:
            await websocket.send_text(json.dumps({"type": "interrupted"}))
        except Exception:
            pass

    # Buffer recent agent speech for place name matching
    agent_text_buffer: list[str] = []
    # Cooldown: suppress transcript-based highlights right after navigation
    # so the destination marker doesn't get immediately replaced
    navigate_cooldown_until: float = 0.0
    # Only fire one highlight per agent turn — reset on audio_end/interrupted
    highlight_fired_this_turn: bool = False

    def _normalize(text: str) -> str:
        """Lowercase + strip common accents for fuzzy matching."""
        import unicodedata
        nfkd = unicodedata.normalize("NFKD", text.lower())
        return "".join(c for c in nfkd if not unicodedata.combining(c))

    async def on_transcript(role: str, text: str):
        try:
            await websocket.send_text(
                json.dumps({"type": "transcript", "role": role, "text": text})
            )
        except Exception:
            pass

        # Detect place mentions in agent speech → trigger highlight
        # Skip during post-navigation cooldown so we don't replace the destination marker
        # Only one highlight per agent turn to avoid label-jumping when agent casually
        # lists multiple nearby places.
        nonlocal highlight_fired_this_turn
        # Each new user speech resets highlight dedup so the agent can re-highlight
        # the same place when the user asks follow-up questions about it.
        if role == "user":
            recent_highlights.clear()
            agent_text_buffer.clear()

        if role == "agent" and cached_places and time.time() > navigate_cooldown_until and not highlight_fired_this_turn:
            agent_text_buffer.append(text)
            # Keep buffer to last ~500 chars to catch names split across chunks
            while sum(len(t) for t in agent_text_buffer) > 500:
                agent_text_buffer.pop(0)
            recent_text = _normalize("".join(agent_text_buffer))

            for p in cached_places:
                pname = p.get("name", "")
                if not pname or len(pname) < 3:
                    continue
                # Full name match first. Partial match requires MAJORITY of
                # significant words (>2 chars) so that a generic word like "café"
                # in a different place name doesn't trigger a false highlight.
                # e.g. agent says "Gran Café Pasteleria" → "Café Latroupe" won't
                # match on "café" alone (1/2 words = 50%, need >50%).
                # But agent saying "Café Latroupe" → both words match → correct.
                name_norm = _normalize(pname)
                matched = name_norm in recent_text
                if not matched:
                    words = [w for w in name_norm.split() if len(w) > 2]
                    if words:
                        match_count = sum(1 for w in words if w in recent_text)
                        matched = match_count > len(words) / 2
                if matched:
                    summary = p.get("summary", "")
                    plat = p.get("lat")
                    plng = p.get("lng")
                    print(f"[highlight] transcript matched '{pname}' in: {recent_text[-80:]!r}")
                    highlight_fired_this_turn = True
                    # Fire and forget — don't block transcript delivery
                    asyncio.create_task(
                        _send_highlight(pname, summary, place_lat=plat, place_lng=plng)
                    )
                    break

    async def on_error(message: str):
        try:
            await websocket.send_text(
                json.dumps({"type": "error", "message": message})
            )
        except Exception:
            pass

    async def on_navigate(place_name: str, lat: float, lng: float):
        """Called from Gemini tool handler — must return FAST so the tool
        response gets back to Gemini before it times out (1008/1011)."""
        nonlocal last_position, navigate_cooldown_until
        try:
            await websocket.send_text(
                json.dumps({
                    "type": "navigate",
                    "place_name": place_name,
                    "lat": lat,
                    "lng": lng,
                })
            )
            print(f"[ws] navigate to {place_name} ({lat}, {lng})")
        except Exception as e:
            print(f"[ws] ERROR sending navigate: {e}")
            return

        # Suppress transcript-based highlights so the destination marker
        # doesn't get replaced by a casual mention of another place.
        navigate_cooldown_until = time.time() + 8
        agent_text_buffer.clear()
        last_position = (lat, lng)

        # All slow work (places fetch, vision, highlight, context) runs
        # in the background so we don't block the Gemini tool response.
        asyncio.create_task(_post_navigate(place_name, lat, lng))

    async def _post_navigate(place_name: str, lat: float, lng: float):
        """Background task: fetch places, vision-locate, highlight, inject context."""
        nonlocal navigate_cooldown_until
        try:
            # Fetch nearby places at destination
            places = await nearby_search(lat, lng, language_code=lang)
            print(f"[navigate] fetched {len(places)} places at destination: {[p.get('name','?') for p in places[:3]]}")
            cached_places.clear()
            cached_places.extend(places)

            # Find the destination in nearby results for better coords
            highlight_lat, highlight_lng = lat, lng
            highlight_desc = ""
            name_lower = place_name.lower()
            for p in places:
                pn = p.get("name", "").lower()
                if pn == name_lower or name_lower in pn or pn in name_lower:
                    highlight_lat = p.get("lat", lat)
                    highlight_lng = p.get("lng", lng)
                    highlight_desc = p.get("summary", "")
                    break
                words = [w for w in name_lower.split() if len(w) > 2]
                if words and any(w in pn for w in words):
                    highlight_lat = p.get("lat", lat)
                    highlight_lng = p.get("lng", lng)
                    highlight_desc = p.get("summary", "")
                    break

            # Calculate heading from camera toward the place
            dist = haversine_distance(lat, lng, highlight_lat, highlight_lng)
            if dist > 5:
                phi1 = math.radians(lat)
                phi2 = math.radians(highlight_lat)
                dl = math.radians(highlight_lng - lng)
                x = math.sin(dl) * math.cos(phi2)
                y = math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(phi2) * math.cos(dl)
                nav_heading = (math.degrees(math.atan2(x, y)) + 360) % 360
            else:
                nav_heading = last_pov["heading"]

            # Set POV so vision call captures the right direction
            last_pov["heading"] = nav_heading
            last_pov["pitch"] = 5.0

            # Send highlight immediately with bearing (no vision delay)
            await _send_highlight(
                place_name, highlight_desc,
                place_lat=highlight_lat, place_lng=highlight_lng,
                force=True,
                use_vision=False,
            )

            # Wait for panorama to load, then refine with vision
            await asyncio.sleep(2.0)
            asyncio.create_task(
                _refine_highlight_with_vision(
                    place_name, highlight_desc, highlight_lat, highlight_lng
                )
            )

            # Inject arrival context into Gemini
            context_msg = build_arrival_context(
                places, place_name, lang,
                user_lat=lat, user_lng=lng, user_heading=nav_heading,
            )
            await gemini.send_context(context_msg)
        except Exception as e:
            print(f"[post_navigate] ERROR: {e}")

    last_position: tuple[float, float] | None = None
    last_pov: dict[str, float] = {"heading": 0.0, "pitch": 0.0, "zoom": 1.0}
    # Cache nearby places for transcript-based place detection
    cached_places: list[dict[str, Any]] = []
    # Dedup: don't re-highlight the same place within 6 seconds
    recent_highlights: dict[str, float] = {}

    async def _send_highlight(
        place_name: str,
        description: str,
        place_lat: float | None = None,
        place_lng: float | None = None,
        force: bool = False,
        use_vision: bool = True,
    ) -> None:
        """Send a highlight immediately with bearing math, then refine with vision.
        force=True skips dedup. use_vision=True tries Gemini Flash refinement."""
        now = time.time()
        if not force:
            if place_name.lower() in recent_highlights and now - recent_highlights[place_name.lower()] < 6:
                return
        recent_highlights[place_name.lower()] = now

        msg: dict[str, Any] = {
            "type": "highlight",
            "name": place_name,
            "description": description,
        }
        if place_lat is not None and place_lng is not None:
            msg["lat"] = place_lat
            msg["lng"] = place_lng

        # Send immediately with bearing-based positioning (no delay)
        print(f"[highlight] sending '{place_name}' (bearing) force={force}")
        try:
            await websocket.send_text(json.dumps(msg))
        except Exception as e:
            print(f"[ws] ERROR sending highlight: {e}")
            return

        # Refine with vision in the background — sends an updated highlight
        if use_vision and last_position:
            asyncio.create_task(
                _refine_highlight_with_vision(place_name, description, place_lat, place_lng)
            )

    async def _refine_highlight_with_vision(
        place_name: str,
        description: str,
        place_lat: float | None,
        place_lng: float | None,
    ) -> None:
        """Background task: call Gemini Flash vision and send a refined highlight."""
        try:
            result = await vision_locate_place(
                place_name,
                last_position[0], last_position[1],
                last_pov["heading"], last_pov["pitch"],
            )
            if result:
                target_heading, target_pitch = result
                msg: dict[str, Any] = {
                    "type": "highlight",
                    "name": place_name,
                    "description": description,
                    "target_heading": target_heading,
                    "target_pitch": target_pitch,
                }
                if place_lat is not None and place_lng is not None:
                    msg["lat"] = place_lat
                    msg["lng"] = place_lng
                print(f"[highlight] vision refined '{place_name}' heading={target_heading:.1f} pitch={target_pitch:.1f}")
                await websocket.send_text(json.dumps(msg))
        except Exception as e:
            print(f"[highlight] vision refinement error: {e}")

    async def resolve_place(query: str) -> dict | None:
        """Called by Gemini tool call — resolve a place by name via Text Search."""
        # Use the user's current position for location bias (falls back to 0,0)
        lat, lng = last_position or (0.0, 0.0)
        print(f"[resolve_place] query={query!r}  bias=({lat}, {lng})")
        return await text_search(query, lat, lng, language_code=lang)

    gemini = GeminiLiveSession(
        system_prompt=system_prompt,
        language_code=lang,
        on_audio=on_audio,
        on_audio_end=on_audio_end,
        on_interrupted=on_interrupted,
        on_transcript=on_transcript,
        on_error=on_error,
        on_navigate=on_navigate,
        resolve_place=resolve_place,
    )

    try:
        await gemini.start()
        await websocket.send_text(
            json.dumps({"type": "status", "message": "session_started"})
        )
    except Exception as e:
        await websocket.send_text(
            json.dumps({"type": "error", "message": f"Failed to start Gemini session: {e}"})
        )
        await websocket.close()
        return

    mic_chunk_count = 0

    try:
        while True:
            raw = await websocket.receive_text()
            msg: dict[str, Any] = json.loads(raw)

            match msg.get("type"):
                case "audio":
                    # Client audio chunk → Gemini
                    mic_chunk_count += 1
                    if mic_chunk_count % 50 == 1:
                        print(f"[ws recv] mic chunk #{mic_chunk_count}, len={len(msg['data'])}")
                    await gemini.send_audio(msg["data"])

                case "position":
                    # Street View position update
                    lat = float(msg["lat"])
                    lng = float(msg["lng"])

                    should_update = last_position is None or haversine_distance(
                        last_position[0], last_position[1], lat, lng
                    ) > MOVEMENT_THRESHOLD_METERS

                    if should_update:
                        last_position = (lat, lng)
                        # Fetch nearby places
                        places = await nearby_search(lat, lng, language_code=lang)
                        print(f"[places] found {len(places)} nearby: {[p.get('name','?') for p in places[:3]]}")
                        # Cache for transcript-based place detection
                        cached_places.clear()
                        cached_places.extend(places)
                        context_msg = build_location_update(
                            places, lat, lng, lang,
                            user_heading=last_pov["heading"],
                        )
                        await gemini.send_context(context_msg)
                        await websocket.send_text(
                            json.dumps({"type": "status", "message": "context_updated"})
                        )


                case "pov":
                    # Street View POV update (heading/pitch/zoom)
                    last_pov["heading"] = float(msg.get("heading", 0))
                    last_pov["pitch"] = float(msg.get("pitch", 0))
                    last_pov["zoom"] = float(msg.get("zoom", 1))

                case _:
                    print(f"[ws] Unknown message type: {msg.get('type')}")

    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"[ws] Session error: {e}")
    finally:
        await gemini.close()
