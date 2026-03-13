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
            "[LOCATION UPDATE] The user has moved to a new area. "
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
        # NOTE: We intentionally omit coordinates here so Gemini never leaks
        # them into the transcript.  Navigation is handled via function calling.
        place_lines.append(" ".join(parts))

    places_text = "\n".join(f"• {line}" for line in place_lines)

    return (
        f"[LOCATION UPDATE] The user has moved to a new area.\n"
        f"Nearby places (verified from Google Places API):\n{places_text}\n\n"
        f"Start speaking NOW in {_language_name(language_code)} about this area — don't wait for the user. "
        f"Pick 1-2 of the most interesting places from this list and bring them to life! "
        f"Say each place's full name clearly. React naturally — point things out like a real guide would. "
        f"Ask the user a question to keep the conversation going. "
        f"Only speak about places on this list. "
        f"If the user wants to visit somewhere, use navigate_to_place."
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
