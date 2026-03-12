import { useState, useCallback, useRef } from "react";
import { LandingPage } from "./components/LandingPage";
import { StreetView } from "./components/StreetView";
import { MicButton } from "./components/MicButton";
import { ConversationLog } from "./components/ConversationLog";
import { useGeminiSession } from "./hooks/useGeminiSession";
import { getLanguage, getCity, type City, type Language } from "./lib/cities";
import type { StreetViewPosition } from "./hooks/useStreetView";

interface SessionConfig {
  languageCode: string;
  cityId: string;
  guideName: string;
}

export default function App() {
  const [config, setConfig] = useState<SessionConfig | null>(null);
  const [showLog, setShowLog] = useState(false);

  // Derived from config
  const language: Language | undefined = config
    ? getLanguage(config.languageCode)
    : undefined;
  const city: City | undefined = config
    ? getCity(config.languageCode, config.cityId)
    : undefined;

  const session = useGeminiSession(
    config
      ? {
          languageCode: config.languageCode,
          city: city!,
          guideName: config.guideName,
        }
      : { languageCode: "es", city: getCity("es", "madrid")!, guideName: "Carlos" }
  );

  const lastSentPositionRef = useRef<{ lat: number; lng: number } | null>(null);

  const handlePositionChange = useCallback(
    (pos: StreetViewPosition) => {
      const last = lastSentPositionRef.current;
      // Frontend throttle: only send if moved >5m (backend does the 50m threshold)
      if (
        !last ||
        haversineDistance(last.lat, last.lng, pos.lat, pos.lng) > 5
      ) {
        session.sendPositionUpdate(pos.lat, pos.lng);
        lastSentPositionRef.current = { lat: pos.lat, lng: pos.lng };
      }
    },
    [session]
  );

  function handleStart(
    languageCode: string,
    cityId: string,
    guideName: string
  ) {
    setConfig({ languageCode, cityId, guideName });
  }

  function handleEnd() {
    session.disconnect();
    setConfig(null);
    setShowLog(false);
    lastSentPositionRef.current = null;
  }

  function handleMicToggle() {
    if (session.isMicActive) {
      session.stopMic();
    } else {
      if (session.status !== "connected") {
        session.connect().then(() => session.startMic());
      } else {
        session.startMic();
      }
    }
  }

  async function handleConnect() {
    await session.connect();
  }

  // Landing screen
  if (!config || !city || !language) {
    return <LandingPage onStart={handleStart} />;
  }

  // Main session view
  return (
    <div className="h-screen flex flex-col bg-[#09090b] overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-black/60 backdrop-blur-sm border-b border-zinc-800 z-10 shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={handleEnd}
            className="text-slate-400 hover:text-white transition-colors p-1"
            title="End session"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </button>
          <div>
            <span className="font-semibold text-white text-sm">
              {language.flag} {city.name}
            </span>
            <span className="text-slate-400 text-xs ml-2">
              · Guide: {config.guideName} · {language.name}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Connection status pill */}
          <StatusPill status={session.status} />

          {/* Connect button (if not connected) */}
          {(session.status === "idle" || session.status === "closed" || session.status === "error") && (
            <button onClick={handleConnect} className="btn-primary text-sm py-1.5 px-4">
              Connect
            </button>
          )}

          {/* Transcript toggle */}
          <button
            onClick={() => setShowLog((v) => !v)}
            className={`btn-secondary text-xs ${showLog ? "bg-white/20" : ""}`}
          >
            Transcript
          </button>
        </div>
      </div>

      {/* Error banner */}
      {session.error && (
        <div className="bg-red-500/20 border-b border-red-500/30 text-red-300 px-4 py-2 text-sm text-center shrink-0">
          {session.error}
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 relative overflow-hidden">
        {/* Street View */}
        <StreetView city={city} onPositionChange={handlePositionChange} />

        {/* Overlay controls */}
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10">
          <MicButton
            isMicActive={session.isMicActive}
            isAgentSpeaking={session.isAgentSpeaking}
            sessionStatus={session.status}
            onToggle={handleMicToggle}
          />
        </div>

        {/* Conversation log sidebar */}
        <ConversationLog
          transcript={session.transcript}
          isOpen={showLog}
          onClose={() => setShowLog(false)}
        />
      </div>
    </div>
  );
}

// ---- Helper components ----

function StatusPill({ status }: { status: string }) {
  const config: Record<string, { color: string; label: string }> = {
    idle: { color: "bg-slate-500", label: "Idle" },
    connecting: { color: "bg-yellow-500 animate-pulse", label: "Connecting…" },
    connected: { color: "bg-green-500", label: "Live" },
    error: { color: "bg-red-500", label: "Error" },
    closed: { color: "bg-slate-500", label: "Closed" },
  };
  const { color, label } = config[status] ?? config.idle;
  return (
    <div className="flex items-center gap-1.5">
      <span className={`w-2 h-2 rounded-full ${color}`} />
      <span className="text-xs text-slate-400">{label}</span>
    </div>
  );
}

// ---- Utility ----

function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371000; // Earth radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
