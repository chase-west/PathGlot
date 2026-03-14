"""Builds location context messages injected into the Gemini Live session."""

import math
from typing import Any

# Prefix that tells Gemini to discard stale location context.
_SUPERSEDE = (
    "[LOCATION UPDATE — THIS REPLACES ALL PREVIOUS LOCATION UPDATES. "
    "Discard any earlier nearby-places lists; only reference places from THIS message.]\n"
)


def _bearing(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Calculate bearing in degrees from point 1 to point 2."""
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dl = math.radians(lng2 - lng1)
    x = math.sin(dl) * math.cos(phi2)
    y = math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(phi2) * math.cos(dl)
    return (math.degrees(math.atan2(x, y)) + 360) % 360


def _relative_direction(user_heading: float, bearing_to_place: float) -> str:
    """Human-readable direction relative to where the user is facing."""
    delta = (bearing_to_place - user_heading + 360) % 360
    if delta < 40 or delta > 320:
        return "ahead"
    elif delta < 100:
        return "to your right"
    elif delta < 260:
        return "behind you"
    else:
        return "to your left"


def _format_places(
    places: list[dict[str, Any]],
    max_count: int = 8,
    user_lat: float | None = None,
    user_lng: float | None = None,
    user_heading: float | None = None,
) -> str:
    """Compact place list — name, type, direction, summary. No coordinates."""
    lines = []
    for p in places[:max_count]:
        parts = [p["name"]]
        if p.get("types"):
            parts.append(f"({p['types'][0].replace('_', ' ')})")
        # Add relative direction if we have position + heading
        plat = p.get("lat")
        plng = p.get("lng")
        if user_lat is not None and user_lng is not None and user_heading is not None and plat and plng:
            brng = _bearing(user_lat, user_lng, plat, plng)
            direction = _relative_direction(user_heading, brng)
            parts.append(f"[{direction}]")
        if p.get("summary"):
            parts.append(f"— {p['summary']}")
        elif p.get("rating"):
            parts.append(f"— rated {p['rating']}/5")
        lines.append(" ".join(parts))
    return "\n".join(f"• {line}" for line in lines)


def build_location_update(
    places: list[dict[str, Any]],
    lat: float,
    lng: float,
    language_code: str = "en",
    user_heading: float | None = None,
) -> str:
    """
    Proactive context — user is walking organically.
    AI should mention interesting places nearby.
    """
    if not places:
        return (
            f"{_SUPERSEDE}"
            "The user has moved to a new area. "
            "No specific nearby places were found. Describe the general area if you know it, "
            "or acknowledge the move and invite the user to keep exploring."
        )

    places_text = _format_places(places, user_lat=lat, user_lng=lng, user_heading=user_heading)

    return (
        f"{_SUPERSEDE}"
        f"Nearby places (verified, Google Places API):\n{places_text}\n\n"
        f"Direction tags like [ahead] or [to your left] show where each place is relative to where the user is currently looking.\n\n"
        f"Start speaking NOW in {_language_name(language_code)} about this area — don't wait for the user. "
        f"Pick 1-2 of the most interesting places and bring them to life. "
        f"Say each place's full name clearly. React naturally like a real guide. "
        f"Ask the user a question to keep the conversation going. "
        f"Only speak about places on this list. "
        f"If the user wants to visit somewhere, use navigate_to_place. "
        f"If the user asks about something they can see, confirm it and say the full name — do NOT navigate."
    )


def build_arrival_context(
    places: list[dict[str, Any]],
    destination_name: str,
    language_code: str = "en",
    user_lat: float | None = None,
    user_lng: float | None = None,
    user_heading: float | None = None,
) -> str:
    """
    Passive context — user just teleported via navigate_to_place.
    AI should know what's nearby but NOT monologue about every place.
    It should answer naturally if the user asks about surroundings
    (e.g. "is that a Starbucks?") and offer to mark/highlight places.
    """
    if not places:
        return (
            f"{_SUPERSEDE}"
            f"The user has arrived at {destination_name}. "
            "No specific nearby places were found from the API."
        )

    places_text = _format_places(places, user_lat=user_lat, user_lng=user_lng, user_heading=user_heading)

    return (
        f"{_SUPERSEDE}"
        f"The user has arrived at {destination_name}.\n"
        f"Nearby places the user can see around them (verified, Google Places API):\n{places_text}\n\n"
        f"Direction tags like [ahead] or [to your left] show where each place is relative to where the user is currently looking.\n\n"
        f"DO NOT list all these places unprompted. You already described {destination_name} when navigating. "
        f"Keep this list as PASSIVE KNOWLEDGE for answering user questions:\n"
        f"- IDENTIFYING ('is that a Kiko?'): match by name + direction tag, confirm, say FULL NAME to trigger highlight. Do NOT navigate.\n"
        f"- SEARCHING ('any bars nearby?', 'is there a Starbucks?'): match by name or type, say FULL NAME + direction, ask if they want to go there or just mark it.\n"
        f"- NAVIGATING ('take me to...'): only then use navigate_to_place.\n"
        f"Always say the FULL NAME of any place so the highlight system can mark it on screen."
    )


def _language_name(code: str) -> str:
    names = {
        "es": "Spanish",
        "fr": "French",
        "de": "German",
        "ja": "Japanese",
        "it": "Italian",
        "pt": "Portuguese",
    }
    return names.get(code, "the target language")
