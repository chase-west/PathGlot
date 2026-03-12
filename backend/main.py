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
from places_client import nearby_search, haversine_distance
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

    async def on_transcript(role: str, text: str):
        try:
            await websocket.send_text(
                json.dumps({"type": "transcript", "role": role, "text": text})
            )
        except Exception:
            pass

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

    gemini = GeminiLiveSession(
        system_prompt=system_prompt,
        language_code=lang,
        on_audio=on_audio,
        on_audio_end=on_audio_end,
        on_interrupted=on_interrupted,
        on_transcript=on_transcript,
        on_error=on_error,
        on_navigate=on_navigate,
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

    last_position: tuple[float, float] | None = None
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
                        context_msg = build_location_update(places, lat, lng, lang)
                        await gemini.send_context(context_msg)
                        await websocket.send_text(
                            json.dumps({"type": "status", "message": "context_updated"})
                        )

                case _:
                    print(f"[ws] Unknown message type: {msg.get('type')}")

    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"[ws] Session error: {e}")
    finally:
        await gemini.close()
