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
CAPTURE_SIZE = "640x360"
CAPTURE_ASPECT = 640 / 360  # width / height — 16:9 matches typical widescreen viewport


async def fetch_streetview_image(
    lat: float,
    lng: float,
    heading: float,
    pitch: float,
    fov: float = 90,
    size: str = "640x480",
    pano: str = "",
) -> bytes | None:
    """Fetch a static Street View image at the given POV.

    When pano is provided, uses the exact panorama ID instead of lat,lng
    to ensure we capture the same view the user is actually seeing.
    """
    if not MAPS_API_KEY:
        return None

    # Use pano ID when available — lat,lng finds the *nearest* panorama
    # which is often different from what the user is viewing.
    if pano:
        location_param = f"pano={pano}"
    else:
        location_param = f"location={lat},{lng}"

    url = (
        f"https://maps.googleapis.com/maps/api/streetview"
        f"?size={size}&{location_param}"
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
            model="gemini-3-flash-preview",
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


def _zoom_to_fov(zoom: float) -> int:
    """Convert Street View zoom level to FOV degrees.

    Street View zoom 1 ≈ 90° FOV, higher zoom = narrower FOV.
    """
    return max(10, min(90, int(90 / max(zoom, 1))))


def _build_nearby_context(nearby_places: list[dict] | None) -> str:
    """Build a context string listing nearby places for the vision prompt."""
    if not nearby_places:
        return ""
    lines = ["Known nearby places from Google Places API (use these to cross-reference what you see):"]
    for p in nearby_places[:10]:
        name = p.get("name", "")
        if not name:
            continue
        parts = [name]
        types = p.get("types", [])
        if types:
            parts.append(f"({types[0].replace('_', ' ')})")
        summary = p.get("summary", "")
        if summary:
            parts.append(f"— {summary}")
        lines.append(f"  - {' '.join(parts)}")
    return "\n".join(lines) + "\n\n"


async def vision_identify_from_screenshot(
    image_bytes: bytes,
    nearby_places: list[dict] | None = None,
    city_name: str = "",
) -> tuple[str, str] | None:
    """
    Identify what's visible in an actual browser screenshot.
    This is preferred over the static API because it shows exactly what the user sees.
    Returns (name, description) or None.
    """
    if not GEMINI_API_KEY:
        return None

    nearby_ctx = _build_nearby_context(nearby_places)
    location_ctx = f"The user is in {city_name}. " if city_name else ""

    client = genai.Client(api_key=GEMINI_API_KEY)
    try:
        response = await client.aio.models.generate_content(
            model="gemini-2.5-flash-lite",
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
                                "Google Street View screenshot. " + location_ctx
                                + "Identify the place/store/building at CENTER of image.\n\n"
                                "Read the actual storefront sign/awning — not ads or posters in windows. "
                                "A shop selling Casa Batlló merch is a shop, NOT Casa Batlló.\n\n"
                                + nearby_ctx
                                + "Reply ONLY:\n"
                                "NAME: <1-5 words>\n"
                                "DESC: <1 sentence>"
                            )
                        ),
                    ],
                ),
            ],
        )
        text = response.text.strip()
        if not text:
            return None
        if text.strip().upper() == "UNKNOWN":
            print("[vision_screenshot] genuinely nothing visible")
            return None
        name = None
        desc = None
        for line in text.splitlines():
            if line.startswith("NAME:"):
                name = line[5:].strip()
            elif line.startswith("DESC:"):
                desc = line[5:].strip()
        if not name:
            name = text.split(".")[0][:40]
            desc = text
        print(f"[vision_screenshot] identified: {name!r} — {desc!r}")
        return (name, desc or "")
    except Exception as e:
        print(f"[vision_screenshot] Gemini Flash error: {e}")
        return None


async def vision_identify_view(
    lat: float,
    lng: float,
    heading: float,
    pitch: float,
    pano: str = "",
    zoom: float = 1.0,
) -> tuple[str, str] | None:
    """
    Capture the user's current view and ask Gemini Flash to identify what's visible.
    Returns (name, description) or None if API unavailable.
    """
    if not GEMINI_API_KEY:
        return None

    fov = _zoom_to_fov(zoom)
    image = await fetch_streetview_image(
        lat, lng, heading, pitch,
        fov=fov, size="640x480", pano=pano,
    )
    if not image:
        print("[vision_identify] no image available")
        return None

    client = genai.Client(api_key=GEMINI_API_KEY)
    try:
        response = await client.aio.models.generate_content(
            model="gemini-3-flash-preview",
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
                                "This is a Google Street View image. Identify the most interesting "
                                "named thing visible in the image. Look for ANY of these, in priority order:\n"
                                "1. Named stores, restaurants, cafés, or brand signs (read text on signs/awnings)\n"
                                "2. Named buildings, churches, monuments, statues, or landmarks\n"
                                "3. Notable architectural features (e.g. 'Art Nouveau balcony', 'Gothic cathedral facade')\n"
                                "4. Street art, murals, or public sculptures\n"
                                "5. Named streets or plazas visible on signs\n\n"
                                "Prioritize whatever is most prominent in the center/foreground of the image.\n"
                                "If there are readable signs or text, always try to read them.\n\n"
                                "Respond in this exact format:\n"
                                "NAME: <short name, 1-5 words>\n"
                                "DESC: <1-2 sentence description>\n\n"
                                "IMPORTANT: Try hard to name SOMETHING. Only respond with UNKNOWN if the "
                                "image is completely blank, corrupted, or shows nothing but empty road/sky "
                                "with zero identifiable features."
                            )
                        ),
                    ],
                ),
            ],
        )
        text = response.text.strip()
        if not text:
            return None
        # Only treat as unknown if the ENTIRE response is just "UNKNOWN"
        if text.strip().upper() == "UNKNOWN":
            print("[vision_identify] genuinely nothing visible")
            return None
        # Parse "NAME: ...\nDESC: ..." format
        name = None
        desc = None
        for line in text.splitlines():
            if line.startswith("NAME:"):
                name = line[5:].strip()
            elif line.startswith("DESC:"):
                desc = line[5:].strip()
        if not name:
            # Fallback: treat entire response as description
            name = text.split(".")[0][:40]
            desc = text
        print(f"[vision_identify] identified: {name!r} — {desc!r}")
        return (name, desc or "")
    except Exception as e:
        print(f"[vision_identify] Gemini Flash error: {e}")
        return None


async def vision_locate_place(
    place_name: str,
    lat: float,
    lng: float,
    heading: float,
    pitch: float,
    pano: str = "",
    zoom: float = 1.0,
) -> tuple[float, float] | None:
    """
    Full pipeline: capture Street View image → find place → return (heading, pitch).

    Returns the absolute heading and pitch angles where the place appears,
    or None if the place couldn't be found in the image.
    """
    capture_fov = _zoom_to_fov(zoom)
    image = await fetch_streetview_image(
        lat, lng, heading, pitch,
        fov=capture_fov, size=CAPTURE_SIZE, pano=pano,
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
    h_fov = capture_fov
    v_fov = capture_fov / CAPTURE_ASPECT  # ~50.6° for 16:9 at default zoom

    target_heading = (heading + (fx - 0.5) * h_fov) % 360
    target_pitch = pitch + (0.5 - fy) * v_fov

    print(f"[vision_locate] '{place_name}' at fx={fx:.2f},fy={fy:.2f} → heading={target_heading:.1f}, pitch={target_pitch:.1f}")
    return (target_heading, target_pitch)
