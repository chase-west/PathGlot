"""Builds location context messages injected into the Gemini Live session."""

from typing import Any


def build_location_update(
    places: list[dict[str, Any]],
    lat: float,
    lng: float,
    language_code: str = "en",
) -> str:
    """
    Build a natural-language location context message to inject into the
    Gemini Live session when the user moves to a new area.
    """
    if not places:
        return (
            f"[LOCATION UPDATE] The user has moved to coordinates {lat:.5f}, {lng:.5f}. "
            "No specific nearby places were found. Describe the general area if you know it, "
            "or acknowledge the move and invite the user to keep exploring."
        )

    place_lines = []
    for p in places[:8]:  # cap at 8 to keep context concise
        parts = [p["name"]]
        if p.get("summary"):
            parts.append(f"— {p['summary']}")
        if p.get("rating"):
            parts.append(f"(rated {p['rating']}/5)")
        if p.get("address"):
            parts.append(f"at {p['address']}")
        if p.get("lat") and p.get("lng"):
            parts.append(f"[coords: {p['lat']:.6f}, {p['lng']:.6f}]")
        place_lines.append(" ".join(parts))

    places_text = "\n".join(f"• {line}" for line in place_lines)

    return (
        f"[LOCATION UPDATE] The user has moved to a new area near {lat:.5f}, {lng:.5f}.\n"
        f"Nearby places within ~50 meters (from Google Places API — these are verified):\n{places_text}\n\n"
        f"Naturally acknowledge this location change in {_language_name(language_code)} "
        f"and weave in some of these nearby places into your commentary. "
        f"Only mention places you are confident about from this list. "
        f"If the user wants to visit a place, use the navigate_to_place tool with its coordinates to take them there."
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
