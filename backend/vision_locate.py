"""Vision-based place locating using Street View static images + Gemini Flash."""

import os
import httpx
from google import genai
from google.genai import types as genai_types

MAPS_API_KEY = os.environ.get("GOOGLE_MAPS_API_KEY", "")
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")


async def fetch_streetview_image(
    lat: float,
    lng: float,
    heading: float,
    pitch: float,
    fov: float = 90,
    size: str = "640x480",
) -> bytes | None:
    """Fetch a static Street View image at the given POV."""
    if not MAPS_API_KEY:
        return None

    url = (
        f"https://maps.googleapis.com/maps/api/streetview"
        f"?size={size}&location={lat},{lng}"
        f"&heading={heading}&pitch={pitch}&fov={fov}"
        f"&key={MAPS_API_KEY}"
    )

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            # The API returns an image even for "no imagery" — check content-type
            if resp.headers.get("content-type", "").startswith("image/"):
                return resp.content
            return None
    except Exception as e:
        print(f"[vision_locate] Street View image fetch error: {e}")
        return None


async def locate_place_in_image(
    image_bytes: bytes,
    place_name: str,
) -> tuple[float, float] | None:
    """
    Use Gemini Flash to locate a place/building in a Street View image.
    Returns (fx, fy) as fractions 0.0-1.0 from top-left, or None if not found.
    """
    if not GEMINI_API_KEY:
        return None

    client = genai.Client(api_key=GEMINI_API_KEY)

    try:
        response = await client.aio.models.generate_content(
            model="gemini-2.5-flash",
            contents=[
                genai_types.Content(
                    role="user",
                    parts=[
                        genai_types.Part(
                            inline_data=genai_types.Blob(
                                data=image_bytes,
                                mime_type="image/jpeg",
                            )
                        ),
                        genai_types.Part(
                            text=(
                                f"Look at this street view image. Where is '{place_name}'? "
                                f"Return ONLY two decimal numbers separated by a comma: x,y "
                                f"where x is the horizontal position (0.0=left edge, 1.0=right edge) "
                                f"and y is the vertical position (0.0=top, 1.0=bottom). "
                                f"If you cannot find it in the image, respond with exactly: NOT_FOUND"
                            )
                        ),
                    ],
                ),
            ],
        )

        text = response.text.strip()
        if "NOT_FOUND" in text:
            return None

        # Parse "0.35,0.42" or "0.35, 0.42"
        parts = text.replace(" ", "").split(",")
        if len(parts) >= 2:
            fx = float(parts[0])
            fy = float(parts[1])
            if 0 <= fx <= 1 and 0 <= fy <= 1:
                return (fx, fy)

        print(f"[vision_locate] unparseable response: {text!r}")
        return None
    except Exception as e:
        print(f"[vision_locate] Gemini Flash error: {e}")
        return None
