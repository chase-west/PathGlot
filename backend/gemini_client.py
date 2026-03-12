"""Gemini Live session manager."""

import asyncio
import base64
import os
from typing import Callable, Awaitable

from google import genai
from google.genai import types as genai_types

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODEL = "gemini-2.5-flash-native-audio-latest"


class GeminiLiveSession:
    def __init__(
        self,
        system_prompt: str,
        language_code: str,
        on_audio: Callable[[str], Awaitable[None]],
        on_audio_end: Callable[[], Awaitable[None]],
        on_transcript: Callable[[str, str], Awaitable[None]],
        on_error: Callable[[str], Awaitable[None]],
    ):
        self.system_prompt = system_prompt
        self.language_code = language_code
        self.on_audio = on_audio
        self.on_audio_end = on_audio_end
        self.on_transcript = on_transcript
        self.on_error = on_error

        self._client = genai.Client(api_key=GEMINI_API_KEY)
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
        )

        try:
            async with self._client.aio.live.connect(
                model=GEMINI_MODEL, config=config
            ) as session:
                # Run sender and receiver concurrently inside the context
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
        while not self._closed:
            # Check context queue first (non-blocking)
            try:
                ctx = self._context_queue.get_nowait()
                if ctx is None:
                    return
                await session.send_client_content(
                    turns=genai_types.Content(
                        role="user",
                        parts=[genai_types.Part(text=ctx)],
                    ),
                    turn_complete=False,
                )
                continue
            except asyncio.QueueEmpty:
                pass

            # Wait for next audio chunk (with short timeout to re-check context)
            try:
                chunk = await asyncio.wait_for(self._audio_queue.get(), timeout=0.05)
                if chunk is None:
                    return
                audio_bytes = base64.b64decode(chunk)
                await session.send_realtime_input(
                    audio=genai_types.Blob(
                        data=audio_bytes,
                        mime_type="audio/pcm;rate=16000",
                    )
                )
            except asyncio.TimeoutError:
                continue

    async def _receive_loop(self, session) -> None:
        """Receive and dispatch messages from Gemini."""
        async for message in session.receive():
            if self._closed:
                break

            # Audio output
            if message.data:
                audio_b64 = base64.b64encode(message.data).decode()
                await self.on_audio(audio_b64)

            # Turn complete
            if message.server_content and message.server_content.turn_complete:
                await self.on_audio_end()

            # Output transcript (agent speech → text)
            if message.server_content and message.server_content.output_transcription:
                text = message.server_content.output_transcription.text
                if text:
                    await self.on_transcript("agent", text)

            # Input transcript (user speech → text)
            if message.server_content and message.server_content.input_transcription:
                text = message.server_content.input_transcription.text
                if text:
                    await self.on_transcript("user", text)
