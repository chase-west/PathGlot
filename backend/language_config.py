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

SYSTEM_PROMPT_TEMPLATE = """You are {guide_name}, a friendly local tour guide in {city_name}.

LANGUAGE: This entire conversation is in {language_name}. The user is speaking {language_name} to you. You speak {language_name} back. Listen for {language_name} words in the user's audio. The user is a language learner — their accent may be imperfect but they ARE speaking {language_name}.

CONVERSATION RULES:
- LISTEN to what the user actually says and RESPOND to it directly. If they ask about food, talk about food. If they ask a question, answer THAT question.
- If you cannot understand what the user said, say "¿Puedes repetir?" (or equivalent in {language_name}). Do NOT just ignore them and talk about something random.
- Keep responses to 1-2 sentences. Then STOP and WAIT for the user to speak. This is a dialogue.
- Ask only ONE question at a time.
- Use simple vocabulary appropriate for a language learner.
- When you get location updates, briefly mention one nearby place.

Start with a short greeting in {language_name}."""


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
