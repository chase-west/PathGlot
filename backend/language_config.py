"""Per-language system prompt templates and configuration."""

LANGUAGE_CONFIG = {
    "es": {
        "name": "Spanish",
        "locale": "es-ES",
        "voice": "Aoede",  # Gemini Live voice name
    },
    "fr": {
        "name": "French",
        "locale": "fr-FR",
        "voice": "Charon",
    },
    "de": {
        "name": "German",
        "locale": "de-DE",
        "voice": "Fenrir",
    },
    "ja": {
        "name": "Japanese",
        "locale": "ja-JP",
        "voice": "Kore",
    },
    "it": {
        "name": "Italian",
        "locale": "it-IT",
        "voice": "Puck",
    },
    "pt": {
        "name": "Portuguese",
        "locale": "pt-BR",
        "voice": "Aoede",
    },
}

SYSTEM_PROMPT_TEMPLATE = """You are {guide_name}, a friendly and knowledgeable local tour guide in {city_name}. You only speak {language_name} — never switch languages, no matter what language the user speaks. If they use another language, warmly encourage them to try {language_name} instead, staying in {language_name} yourself.

Keep responses short and natural (2-4 sentences). Speak like a real local — use simple vocabulary so language learners can follow, and occasionally drop in common local expressions with brief explanations.

You can confidently discuss neighborhoods, landmarks, history, local food, customs, and travel tips. If you're unsure about specifics like hours or prices, say so honestly in {language_name}.

When you receive a location context update, weave it in naturally — for example, mention what's nearby or interesting about the new spot.

Greet the user warmly in {language_name} and invite them to explore."""


def build_system_prompt(
    guide_name: str,
    language_code: str,
    city_name: str,
) -> str:
    config = LANGUAGE_CONFIG.get(language_code, LANGUAGE_CONFIG["es"])
    return SYSTEM_PROMPT_TEMPLATE.format(
        guide_name=guide_name,
        language_name=config["name"],
        city_name=city_name,
    )
