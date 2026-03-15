"""Gemini Live session manager with function-calling navigation."""

import asyncio
import base64
import os
import re
from typing import Callable, Awaitable, Any

from google import genai
from google.genai import types as genai_types

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
# Use the December 2025 preview — Google's recommended model for Live API.
# v1alpha API version unlocks affective dialog and proactive audio.
GEMINI_MODEL = "gemini-2.5-flash-native-audio-preview-12-2025"

# Tool declarations — only navigate_to_place.
# highlight_place was removed because a second tool destabilizes the
# preview audio model (causes 1008 errors).  Place highlighting is now
# detected from output transcription text instead.
TOOLS = genai_types.Tool(
    function_declarations=[
        genai_types.FunctionDeclaration(
            name="navigate_to_place",
            description=(
                "Move the user's Street View to a specific place. "
                "Call this whenever the user asks to go somewhere or you suggest visiting a place. "
                "Use a descriptive search query — e.g. 'Shibuya Sky observation deck, Tokyo' or 'Café de Flore, Paris'."
            ),
            parameters=genai_types.Schema(
                type="OBJECT",
                properties={
                    "query": genai_types.Schema(
                        type="STRING",
                        description="Search query for the place — include the place name and city for best results.",
                    ),
                },
                required=["query"],
            ),
        ),
    ]
)


class GeminiLiveSession:
    def __init__(
        self,
        system_prompt: str,
        language_code: str,
        on_audio: Callable[[str], Awaitable[None]],
        on_audio_end: Callable[[], Awaitable[None]],
        on_interrupted: Callable[[], Awaitable[None]],
        on_transcript: Callable[[str, str], Awaitable[None]],
        on_error: Callable[[str], Awaitable[None]],
        on_navigate: Callable[[str, float, float], Awaitable[None]] | None = None,
        resolve_place: Callable[[str], Awaitable[dict[str, Any] | None]] | None = None,
    ):
        self.system_prompt = system_prompt
        self.language_code = language_code
        self.on_audio = on_audio
        self.on_audio_end = on_audio_end
        self.on_interrupted = on_interrupted
        self.on_transcript = on_transcript
        self.on_error = on_error
        self.on_navigate = on_navigate
        self.resolve_place = resolve_place

        # v1alpha required for enable_affective_dialog and proactivity
        self._client = genai.Client(
            vertexai=True,
            project=os.environ.get("GOOGLE_CLOUD_PROJECT"),
            location=os.environ.get("CLOUD_RUN_REGION", "us-central1"),
            http_options={"api_version": "v1alpha"},
        )
        self._audio_queue: asyncio.Queue[str | None] = asyncio.Queue()
        self._context_queue: asyncio.Queue[str | None] = asyncio.Queue()
        self._task: asyncio.Task | None = None
        self._closed = False

    async def start(self) -> None:
        """Start the session in a background task."""
        self._task = asyncio.create_task(self._run())
        # Give it a moment to connect before returning
        await asyncio.sleep(0.5)

    async def send_audio(self, base64_pcm: str) -> None:
        if not self._closed:
            await self._audio_queue.put(base64_pcm)

    async def send_context(self, context_text: str) -> None:
        if not self._closed:
            await self._context_queue.put(context_text)

    async def close(self) -> None:
        self._closed = True
        await self._audio_queue.put(None)   # sentinel to unblock sender
        await self._context_queue.put(None)
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    async def _run(self) -> None:
        from language_config import LANGUAGE_CONFIG

        lang_cfg = LANGUAGE_CONFIG.get(self.language_code, LANGUAGE_CONFIG["es"])
        voice_name = lang_cfg["voice"]

        config = genai_types.LiveConnectConfig(
            response_modalities=["AUDIO"],
            system_instruction=self.system_prompt,
            speech_config=genai_types.SpeechConfig(
                voice_config=genai_types.VoiceConfig(
                    prebuilt_voice_config=genai_types.PrebuiltVoiceConfig(
                        voice_name=voice_name,
                    )
                )
            ),
            input_audio_transcription=genai_types.AudioTranscriptionConfig(),
            output_audio_transcription=genai_types.AudioTranscriptionConfig(),
            # Affective dialog — emotion-aware, more human-like responses
            enable_affective_dialog=True,
            # Proactive audio — model can initiate when it has something relevant
            proactivity=genai_types.ProactivityConfig(
                proactive_audio=True,
            ),
            # Ensure VAD stays active across turns so the model keeps listening
            # after each response instead of waiting for explicit turn signals.
            realtime_input_config=genai_types.RealtimeInputConfig(
                automatic_activity_detection=genai_types.AutomaticActivityDetection(
                    disabled=False,
                    # LOW end sensitivity prevents the model from cutting off the
                    # user mid-sentence.  Removing this previously caused echo-loop
                    # garbled language detection.
                    end_of_speech_sensitivity=genai_types.EndSensitivity.END_SENSITIVITY_LOW,
                ),
            ),
            # Function calling for navigation and highlighting
            tools=[TOOLS],
        )

        try:
            async with self._client.aio.live.connect(
                model=GEMINI_MODEL, config=config
            ) as session:
                # Prime the session — turn_complete=True triggers the greeting
                await session.send_client_content(
                    turns=genai_types.Content(
                        role="user",
                        parts=[genai_types.Part(text="[Session started. Introduce yourself now.]")],
                    ),
                    turn_complete=True,
                )
                # Run sender and receiver concurrently
                await asyncio.gather(
                    self._send_loop(session),
                    self._receive_loop(session),
                )
        except asyncio.CancelledError:
            pass
        except Exception as e:
            if not self._closed:
                await self.on_error(f"Gemini session error: {e}")

    async def _send_loop(self, session) -> None:
        """Forward audio and context messages to Gemini."""
        send_count = 0
        while not self._closed:
            # Check context queue first (non-blocking)
            try:
                ctx = self._context_queue.get_nowait()
                if ctx is None:
                    return
                # Inject context WITHOUT turn_complete so it doesn't interfere
                # with VAD-based turn management. The context enriches future
                # responses without forcing a turn boundary.
                await session.send_client_content(
                    turns=genai_types.Content(
                        role="user",
                        parts=[genai_types.Part(text=ctx)],
                    ),
                    turn_complete=False,
                )
                print(f"[send_loop] injected context (no turn_complete)")
                continue
            except asyncio.QueueEmpty:
                pass

            # Wait for next audio chunk (with short timeout to re-check context)
            try:
                chunk = await asyncio.wait_for(self._audio_queue.get(), timeout=0.05)
                if chunk is None:
                    return
                audio_bytes = base64.b64decode(chunk)
                try:
                    await session.send_realtime_input(
                        media=genai_types.Blob(
                            data=audio_bytes,
                            mime_type="audio/pcm;rate=16000",
                        )
                    )
                    send_count += 1
                    if send_count % 50 == 1:
                        print(f"[send_loop] sent audio #{send_count} to gemini ({len(audio_bytes)} bytes)")
                except Exception as e:
                    print(f"[send_loop] ERROR sending audio: {e}")
                    raise
            except asyncio.TimeoutError:
                continue
        print("[send_loop] exited loop")

    async def _receive_loop(self, session) -> None:
        """Receive and dispatch messages from Gemini."""
        turn_num = 0
        while not self._closed:
            turn_num += 1
            print(f"[receive_loop] listening for turn {turn_num}")
            async for message in session.receive():
                if self._closed:
                    return

                # Audio output
                if message.data:
                    audio_b64 = base64.b64encode(message.data).decode()
                    await self.on_audio(audio_b64)

                # Handle function calls from Gemini
                if message.tool_call:
                    await self._handle_tool_call(session, message.tool_call)

                if message.server_content:
                    # User interrupted the agent — stop playback immediately
                    if message.server_content.interrupted:
                        print(f"[gemini recv] interrupted (turn {turn_num})")
                        await self.on_interrupted()

                    # Output transcript
                    if message.server_content.output_transcription:
                        text = message.server_content.output_transcription.text
                        if text:
                            # Filter out tool call syntax that leaks into transcription
                            # but preserve whitespace (chunks arrive with leading spaces)
                            text = re.sub(r'(?:reagált?:?)?\s*\w+_to_\w+\{[^}]*\}', '', text)
                            text = re.sub(r'<ctrl\d+>', '', text)
                            if text and not text.isspace():
                                print(f"[gemini recv] agent: {text!r}")
                                await self.on_transcript("agent", text)

                    # Turn complete (after transcript)
                    if message.server_content.turn_complete:
                        print(f"[gemini recv] turn_complete (turn {turn_num})")
                        await self.on_audio_end()

                    # Input transcript
                    if message.server_content.input_transcription:
                        text = message.server_content.input_transcription.text
                        if text:
                            print(f"[gemini recv] user: {text!r}")
                            await self.on_transcript("user", text)

    async def _handle_tool_call(self, session, tool_call) -> None:
        """Execute tool calls from Gemini and send responses back."""
        responses = []

        for fc in tool_call.function_calls:
            print(f"[tool_call] {fc.name}({fc.args})")

            if fc.name == "navigate_to_place" and self.resolve_place:
                query = fc.args.get("query", "")
                place = await self.resolve_place(query)

                if place and place.get("lat") and place.get("lng"):
                    # Trigger frontend navigation
                    if self.on_navigate:
                        await self.on_navigate(
                            place.get("name", query),
                            place["lat"],
                            place["lng"],
                        )
                    responses.append(
                        genai_types.FunctionResponse(
                            name=fc.name,
                            id=fc.id,
                            response={
                                "success": True,
                                "name": place.get("name", ""),
                                "address": place.get("address", ""),
                                "summary": place.get("summary", ""),
                                "rating": place.get("rating"),
                            },
                        )
                    )
                    print(f"[tool_call] resolved '{query}' → {place['name']} ({place['lat']}, {place['lng']})")
                else:
                    responses.append(
                        genai_types.FunctionResponse(
                            name=fc.name,
                            id=fc.id,
                            response={
                                "success": False,
                                "error": f"Could not find a place matching '{query}'. Try a different description.",
                            },
                        )
                    )
                    print(f"[tool_call] no results for '{query}'")
            else:
                responses.append(
                    genai_types.FunctionResponse(
                        name=fc.name,
                        id=fc.id,
                        response={"error": f"Unknown function: {fc.name}"},
                    )
                )

        # Send all responses back to Gemini
        await session.send_tool_response(function_responses=responses)
        print(f"[tool_call] sent {len(responses)} tool response(s)")
