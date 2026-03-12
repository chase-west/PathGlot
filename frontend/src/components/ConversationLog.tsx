import { useEffect, useRef } from "react";
import type { ConversationTurn } from "../hooks/useGeminiSession";

interface Props {
  transcript: ConversationTurn[];
  isOpen: boolean;
  onClose: () => void;
}

export function ConversationLog({ transcript, isOpen, onClose }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript]);

  if (!isOpen) return null;

  return (
    <div className="absolute right-0 top-0 h-full w-80 glass-card rounded-none border-l border-white/10 flex flex-col z-20">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <h3 className="font-semibold text-sm text-white">Conversation</h3>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-white transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Transcript */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {transcript.length === 0 ? (
          <p className="text-slate-500 text-sm text-center mt-8">
            Your conversation will appear here.
          </p>
        ) : (
          transcript.map((turn) => (
            <div
              key={turn.id}
              className={`flex ${turn.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`
                  max-w-[85%] rounded-2xl px-3 py-2 text-sm
                  ${
                    turn.role === "user"
                      ? "bg-brand-500/80 text-white rounded-br-sm"
                      : "bg-white/10 text-slate-200 rounded-bl-sm"
                  }
                  ${turn.pending ? "opacity-60 italic" : ""}
                `}
              >
                {turn.text}
              </div>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
