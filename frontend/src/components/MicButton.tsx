interface Props {
  isMicActive: boolean;
  isAgentSpeaking: boolean;
  sessionStatus: string;
  onToggle: () => void;
}

export function MicButton({
  isMicActive,
  isAgentSpeaking,
  sessionStatus,
  onToggle,
}: Props) {
  const isConnected = sessionStatus === "connected";

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        onClick={onToggle}
        disabled={!isConnected}
        className={`
          relative w-16 h-16 rounded-full flex items-center justify-center transition-all duration-200 shadow-lg
          ${!isConnected ? "bg-white/10 cursor-not-allowed" : ""}
          ${isConnected && !isMicActive ? "bg-white hover:bg-zinc-200 hover:scale-105 active:scale-95 shadow-white/20" : ""}
          ${isMicActive ? "bg-red-500 hover:bg-red-600 shadow-red-500/40 hover:scale-105 active:scale-95" : ""}
        `}
        title={
          !isConnected
            ? "Connect first"
            : isMicActive
              ? "Stop speaking"
              : "Start speaking"
        }
      >
        {/* Mic icon */}
        {!isMicActive ? (
          <svg
            className={`w-7 h-7 ${isConnected ? "text-black" : "text-white"}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8"
            />
          </svg>
        ) : (
          <svg
            className="w-7 h-7 text-white"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
        )}

        {/* Pulse ring when active */}
        {isMicActive && (
          <span className="absolute inset-0 rounded-full animate-ping bg-red-400 opacity-40" />
        )}
      </button>

      {/* Status label */}
      <span className="text-xs text-slate-400 text-center">
        {!isConnected && sessionStatus === "connecting" && "Connecting…"}
        {!isConnected && sessionStatus !== "connecting" && "Disconnected"}
        {isConnected && !isMicActive && !isAgentSpeaking && "Tap to speak"}
        {isMicActive && "Listening…"}
        {isAgentSpeaking && !isMicActive && "Agent speaking…"}
      </span>
    </div>
  );
}
