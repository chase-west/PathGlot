"""PathGlot FastAPI backend.

WebSocket endpoint /ws/session handles:
  - Establishing Gemini Live session
  - Relaying audio from client → Gemini
  - Relaying audio from Gemini → client
  - Receiving position updates → Places API → context injection
"""

import asyncio
import json
import os
from typing import Any

from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware

from gemini_client import GeminiLiveSession
from places_client import nearby_search, text_search, haversine_distance
from context_builder import build_location_update
from language_config import build_system_prompt

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
        try:
            await websocket.send_text(json.dumps({"type": "audio_end"}))
        except Exception:
            pass

    async def on_interrupted():
        try:
            await websocket.send_text(json.dumps({"type": "interrupted"}))
        except Exception:
            pass

    # Buffer recent agent speech for place name matching
    agent_text_buffer: list[str] = []

    async def on_transcript(role: str, text: str):
        try:
            await websocket.send_text(
                json.dumps({"type": "transcript", "role": role, "text": text})
            )
        except Exception:
            pass

        # Detect place mentions in agent speech → trigger vision highlight
        if role == "agent" and cached_places:
            agent_text_buffer.append(text)
            # Keep buffer to last ~500 chars to catch names split across chunks
            while sum(len(t) for t in agent_text_buffer) > 500:
                agent_text_buffer.pop(0)
            recent_text = "".join(agent_text_buffer).lower()

            for p in cached_places:
                pname = p.get("name", "")
                if not pname or len(pname) < 3:
                    continue
                # Try full name and individual words (>4 chars) for partial matches
                # e.g. "Museo del Prado" → also match if agent just says "Prado"
                name_lower = pname.lower()
                matched = name_lower in recent_text
                if not matched:
                    words = [w for w in name_lower.split() if len(w) > 4]
                    matched = any(w in recent_text for w in words)
                if matched:
                    summary = p.get("summary", "")
                    plat = p.get("lat")
                    plng = p.get("lng")
                    print(f"[highlight] transcript matched '{pname}' in: {recent_text[-80:]!r}")
                    # Fire and forget — don't block transcript delivery
                    asyncio.create_task(
                        _send_highlight(pname, summary, place_lat=plat, place_lng=plng)
                    )
                    # Clear buffer to avoid re-triggering on same text
                    agent_text_buffer.clear()
                    break

    async def on_error(message: str):
        try:
            await websocket.send_text(
                json.dumps({"type": "error", "message": message})
            )
        except Exception:
            pass

    async def on_navigate(place_name: str, lat: float, lng: float):
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

    last_position: tuple[float, float] | None = None
    last_pov: dict[str, float] = {"heading": 0.0, "pitch": 0.0, "zoom": 1.0}
    # Cache nearby places for transcript-based place detection
    cached_places: list[dict[str, Any]] = []
    # Dedup: don't re-highlight the same place within 15 seconds
    recent_highlights: dict[str, float] = {}

    async def _send_highlight(
        place_name: str,
        description: str,
        place_lat: float | None = None,
        place_lng: float | None = None,
    ) -> None:
        """Send a single highlight with lat/lng for bearing-based positioning."""
        import time
        now = time.time()
        # Dedup check
        if place_name.lower() in recent_highlights and now - recent_highlights[place_name.lower()] < 15:
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

        print(f"[highlight] sending '{place_name}' at ({place_lat}, {place_lng})")
        try:
            await websocket.send_text(json.dumps(msg))
        except Exception as e:
            print(f"[ws] ERROR sending highlight: {e}")

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
                        context_msg = build_location_update(places, lat, lng, lang)
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
