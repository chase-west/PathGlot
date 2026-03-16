import { useEffect, useRef, useState, useCallback } from "react";
import { AudioPlayer, float32ToBase64Pcm, CAPTURE_SAMPLE_RATE } from "../lib/audio";
import type { City } from "../lib/cities";

const SPEECH_LOCALES: Record<string, string> = {
  es: "es-ES",
  fr: "fr-FR",
  de: "de-DE",
  ja: "ja-JP",
  it: "it-IT",
  pt: "pt-BR",
  en: "en-US",
};


const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL as string | undefined) || "http://localhost:8000";
const BACKEND_WS_URL = BACKEND_URL.replace(/^http/, "ws");

export type SessionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "error"
  | "closed";

export interface ConversationTurn {
  id: string;
  role: "user" | "agent";
  text: string;
  timestamp: number;
  pending?: boolean; // true while speech recognition is still interim
}

interface UseGeminiSessionOptions {
  languageCode: string;
  city: City;
  guideName: string;
  onNavigate?: (placeName: string, lat: number, lng: number) => void;
  onScreenshotRequest?: () => string | null;
}

export function useGeminiSession({
  languageCode,
  city,
  guideName,
  onNavigate,
  onScreenshotRequest,
}: UseGeminiSessionOptions) {
  const [status, setStatus] = useState<SessionStatus>("idle");
  const [isMicActive, setIsMicActive] = useState(false);
  const [isAgentSpeaking, setIsAgentSpeaking] = useState(false);
  const [transcript, setTranscript] = useState<ConversationTurn[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [activeHighlight, setActiveHighlight] = useState<{
    name: string; description: string;
    lat?: number; lng?: number;
    target_heading?: number; target_pitch?: number;
  } | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track whether the last turn is "sealed" (complete) so new fragments
  // from the same role start a fresh bubble after turn_complete.
  const turnSealedRef = useRef(true);

  const wsRef = useRef<WebSocket | null>(null);
  const audioPlayerRef = useRef<AudioPlayer | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const speechRecRef = useRef<SpeechRecognition | null>(null);
  // Ref-based agent speaking tracker accessible from onaudioprocess callback
  const agentSpeakingRef = useRef(false);
  const onNavigateRef = useRef(onNavigate);
  useEffect(() => {
    onNavigateRef.current = onNavigate;
  }, [onNavigate]);

  const onScreenshotRequestRef = useRef(onScreenshotRequest);
  useEffect(() => {
    onScreenshotRequestRef.current = onScreenshotRequest;
  }, [onScreenshotRequest]);

  // Connect to backend WebSocket and start Gemini session
  const connect = useCallback(async () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    setStatus("connecting");
    setError(null);

    const ws = new WebSocket(
      `${BACKEND_WS_URL}/ws/session?lang=${languageCode}&city=${city.id}&guide=${guideName}`
    );
    wsRef.current = ws;
    audioPlayerRef.current = new AudioPlayer();

    ws.onopen = () => {
      setStatus("connected");
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data as string) as BackendMessage;
      handleBackendMessage(msg);
    };

    ws.onerror = () => {
      setError("WebSocket connection error. Is the backend running?");
      setStatus("error");
    };

    ws.onclose = () => {
      setStatus("closed");
      setIsMicActive(false);
      setIsAgentSpeaking(false);
    };
  }, [languageCode, city.id, guideName]);

  const handleBackendMessage = useCallback((msg: BackendMessage) => {
    switch (msg.type) {
      case "audio":
        audioPlayerRef.current?.resume();
        audioPlayerRef.current?.enqueue(msg.data);
        agentSpeakingRef.current = true;
        setIsAgentSpeaking(true);
        break;

      case "audio_end":
        agentSpeakingRef.current = false;
        setIsAgentSpeaking(false);
        turnSealedRef.current = true;
        break;

      case "interrupted":
        audioPlayerRef.current?.stop();
        agentSpeakingRef.current = false;
        setIsAgentSpeaking(false);
        turnSealedRef.current = true;
        break;

      case "transcript": {
        setTranscript((prev) => {
          const last = prev[prev.length - 1];
          // Append to current bubble only if same role AND turn not sealed
          if (last && last.role === msg.role && !turnSealedRef.current) {
            const updated = [...prev];
            updated[updated.length - 1] = {
              ...last,
              // Agent output_transcription streams word-by-word deltas → append.
              // User input_transcription sends accumulated ASR results (each chunk
              // is the full running transcription, not a delta) → replace to avoid
              // showing every interim state concatenated as garbled text.
              text: msg.role === "agent" ? last.text + msg.text : msg.text,
            };
            return updated;
          }
          // New bubble — mark turn as open
          turnSealedRef.current = false;
          return [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: msg.role,
              text: msg.text,
              timestamp: Date.now(),
            },
          ];
        });
        break;
      }

      case "error":
        setError(msg.message);
        break;

      case "navigate":
        console.log("[session] navigate to", msg.place_name, msg.lat, msg.lng);
        onNavigateRef.current?.(msg.place_name, msg.lat, msg.lng);
        break;

      case "highlight":
        console.log("[session] highlight:", msg.name, "heading:", msg.target_heading, "pitch:", msg.target_pitch, "lat:", msg.lat, "lng:", msg.lng);
        if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
        setActiveHighlight({
          name: msg.name, description: msg.description,
          lat: msg.lat, lng: msg.lng,
          target_heading: msg.target_heading,
          target_pitch: msg.target_pitch,
        });
        highlightTimerRef.current = setTimeout(() => setActiveHighlight(null), 12000);
        break;

      case "screenshot_request":
        // Backend needs a screenshot for vision identification
        {
          const data = onScreenshotRequestRef.current?.() ?? null;
          console.log("[session] screenshot captured:", data ? `${data.length} chars` : "null (fallback to static)");
          wsRef.current?.send(JSON.stringify({ type: "screenshot", data }));
        }
        break;

      case "status":
        // Server-side status updates (e.g., "context_updated")
        console.log("[session status]", msg.message);
        break;
    }
  }, []);

  // Start microphone capture
  const startMic = useCallback(async () => {
    if (isMicActive) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: { ideal: 48000 },
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      micStreamRef.current = stream;
      // Create AudioContext at exactly 16kHz — Chrome resamples the mic stream
      // to this rate internally using a high-quality resampler, which is far
      // better than our manual linear interpolation and eliminates the
      // "h-e-l-l-o" character-by-character transcription artifact.
      const ctx = new AudioContext({ sampleRate: CAPTURE_SAMPLE_RATE });
      audioContextRef.current = ctx;

      const source = ctx.createMediaStreamSource(stream);
      sourceRef.current = source;

      // 4096 frames at 16kHz = 256ms chunks — large enough for clean VAD
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        if (wsRef.current?.readyState !== WebSocket.OPEN) return;
        // Always send real mic audio — browser echo cancellation
        // (enabled in getUserMedia) handles suppressing agent playback
        // from the mic. Sending silence or nothing caused worse issues:
        // silence triggered false VAD interrupts, nothing clipped the
        // start of user speech after agent finishes.
        const samples = e.inputBuffer.getChannelData(0);
        const base64 = float32ToBase64Pcm(samples);
        wsRef.current.send(JSON.stringify({ type: "audio", data: base64 }));
      };

      // Connect through a muted GainNode — Chrome requires a path to destination
      // for ScriptProcessorNode to run, but we don't want mic audio in speakers
      // (it would create an echo loop back into Gemini).
      const muteNode = ctx.createGain();
      muteNode.gain.value = 0;
      source.connect(processor);
      processor.connect(muteNode);
      muteNode.connect(ctx.destination);

      setIsMicActive(true);

      // Web Speech API for user transcript — proper language support,
      // replaces Gemini's input_audio_transcription which mis-detects language
      const SpeechRecognitionAPI =
        (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognitionAPI) {
        const rec: SpeechRecognition = new SpeechRecognitionAPI();
        rec.lang = SPEECH_LOCALES[languageCode] ?? languageCode;
        rec.interimResults = true;
        rec.continuous = true;
        rec.onresult = (e: SpeechRecognitionEvent) => {
          let interim = "";
          let final = "";
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const t = e.results[i][0].transcript;
            if (e.results[i].isFinal) final += t;
            else interim += t;
          }
          const text = final || interim;
          if (!text.trim()) return;
          setTranscript((prev) => {
            const last = prev[prev.length - 1];
            // Always update the existing user bubble if last message is from user —
            // don't use turnSealedRef here because Web Speech final results arrive
            // after the agent starts responding (sealing the turn), which would
            // otherwise create a duplicate bubble.
            if (last && last.role === "user") {
              const updated = [...prev];
              updated[updated.length - 1] = { ...last, text, pending: !final };
              return updated;
            }
            turnSealedRef.current = false;
            return [
              ...prev,
              { id: crypto.randomUUID(), role: "user", text, timestamp: Date.now(), pending: !final },
            ];
          });
        };
        rec.onend = () => {
          // Auto-restart so it stays active for the whole session
          if (speechRecRef.current) {
            try { rec.start(); } catch { /* already started */ }
          }
        };
        speechRecRef.current = rec;
        rec.start();
      }
    } catch (err) {
      setError(
        `Microphone access denied: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }, [isMicActive, languageCode]);

  // Stop microphone capture
  const stopMic = useCallback(() => {
    processorRef.current?.disconnect();
    sourceRef.current?.disconnect();
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    audioContextRef.current?.close();

    processorRef.current = null;
    sourceRef.current = null;
    micStreamRef.current = null;
    audioContextRef.current = null;

    speechRecRef.current?.stop();
    speechRecRef.current = null;

    setIsMicActive(false);
  }, []);

  // Send position update to backend
  const sendPositionUpdate = useCallback(
    (lat: number, lng: number, pano?: string) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({ type: "position", lat, lng, pano })
        );
      }
    },
    []
  );

  // Send POV update to backend (for vision-based label placement)
  const sendPovUpdate = useCallback(
    (heading: number, pitch: number, zoom: number, pano?: string) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({ type: "pov", heading, pitch, zoom, pano })
        );
      }
    },
    []
  );

  // Disconnect and clean up
  const disconnect = useCallback(() => {
    stopMic();
    audioPlayerRef.current?.stop();
    wsRef.current?.close();
    wsRef.current = null;
    setStatus("idle");
    setTranscript([]);
  }, [stopMic]);

  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    status,
    isMicActive,
    isAgentSpeaking,
    transcript,
    error,
    activeHighlight,
    connect,
    disconnect,
    startMic,
    stopMic,
    sendPositionUpdate,
    sendPovUpdate,
  };
}

// ---- Message types from backend ----

interface AudioMessage {
  type: "audio";
  data: string; // base64 PCM
}

interface AudioEndMessage {
  type: "audio_end";
}

interface InterruptedMessage {
  type: "interrupted";
}

interface TranscriptMessage {
  type: "transcript";
  role: "user" | "agent";
  text: string;
}

interface ErrorMessage {
  type: "error";
  message: string;
}

interface StatusMessage {
  type: "status";
  message: string;
}

interface NavigateMessage {
  type: "navigate";
  place_name: string;
  lat: number;
  lng: number;
}

interface HighlightMessage {
  type: "highlight";
  name: string;
  description: string;
  lat?: number;
  lng?: number;
  target_heading?: number; // vision-refined horizontal angle (absolute degrees)
  target_pitch?: number;   // vision-refined vertical angle (absolute degrees)
}

interface ScreenshotRequestMessage {
  type: "screenshot_request";
}

type BackendMessage =
  | AudioMessage
  | AudioEndMessage
  | InterruptedMessage
  | TranscriptMessage
  | ErrorMessage
  | StatusMessage
  | NavigateMessage
  | HighlightMessage
  | ScreenshotRequestMessage;
