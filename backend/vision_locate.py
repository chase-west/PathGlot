"""Vision-based place locating using Street View static images + Gemini Flash.

Flow: capture a static Street View image at the user's POV → ask Gemini Flash
to find the place in the image → convert viewport fractions to absolute heading
and pitch angles that the frontend can project as the user pans.
"""

import os
import httpx
from google import genai
from google.genai import types as genai_types

MAPS_API_KEY = os.environ.get("GOOGLE_MAPS_API_KEY", "")
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")

# Fixed FOV for static image capture — used in the fx,fy → heading,pitch conversion
CAPTURE_FOV = 90
CAPTURE_SIZE = "640x480"
CAPTURE_ASPECT = 640 / 480  # width / height


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


async def vision_identify_view(
    lat: float,
    lng: float,
    heading: float,
    pitch: float,
) -> str | None:
    """
    Capture the user's current view and ask Gemini Flash to identify what's visible.
    Returns a plain-language description (e.g. "Guernica by Pablo Picasso, 1937"),
    or None if nothing identifiable or API unavailable.
    """
    if not GEMINI_API_KEY:
        return None

    image = await fetch_streetview_image(lat, lng, heading, pitch, fov=90, size="640x480")
    if not image:
        print("[vision_identify] no image available")
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
                                data=image,
                                mime_type="image/jpeg",
                            )
                        ),
                        genai_types.Part(
                            text=(
                                "This is a Street View image of what a user is currently looking at. "
                                "Identify the most prominent thing visible — artwork, sculpture, building facade, "
                                "landmark, sign, or architectural feature. "
                                "Be specific: if it's a painting, name the work and artist. "
                                "If it's a sculpture or monument, name it. "
                                "If it's a building or street feature, describe it precisely. "
                                "Respond in 1-2 sentences. If nothing identifiable, respond with: UNKNOWN"
                            )
                        ),
                    ],
                ),
            ],
        )
        text = response.text.strip()
        if "UNKNOWN" in text or not text:
            return None
        print(f"[vision_identify] identified: {text!r}")
        return text
    except Exception as e:
        print(f"[vision_identify] Gemini Flash error: {e}")
        return None


async def vision_locate_place(
    place_name: str,
    lat: float,
    lng: float,
    heading: float,
    pitch: float,
) -> tuple[float, float] | None:
    """
    Full pipeline: capture Street View image → find place → return (heading, pitch).

    Returns the absolute heading and pitch angles where the place appears,
    or None if the place couldn't be found in the image.
    """
    image = await fetch_streetview_image(
        lat, lng, heading, pitch,
        fov=CAPTURE_FOV, size=CAPTURE_SIZE,
    )
    if not image:
        print(f"[vision_locate] no image for {place_name}")
        return None

    result = await locate_place_in_image(image, place_name)
    if not result:
        print(f"[vision_locate] '{place_name}' not found in image")
        return None

    fx, fy = result
    # Convert viewport fractions → absolute heading and pitch.
    # fx=0 is left edge (heading - FOV/2), fx=1 is right edge (heading + FOV/2)
    # fy=0 is top edge (pitch + vFov/2), fy=1 is bottom edge (pitch - vFov/2)
    h_fov = CAPTURE_FOV
    v_fov = CAPTURE_FOV / CAPTURE_ASPECT  # ~67.5° for 4:3

    target_heading = (heading + (fx - 0.5) * h_fov) % 360
    target_pitch = pitch + (0.5 - fy) * v_fov

    print(f"[vision_locate] '{place_name}' at fx={fx:.2f},fy={fy:.2f} → heading={target_heading:.1f}, pitch={target_pitch:.1f}")
    return (target_heading, target_pitch)
