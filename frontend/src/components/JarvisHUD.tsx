import { useEffect, useState, useRef, useCallback } from "react";
import type { ConversationTurn } from "../hooks/useGeminiSession";

interface Props {
  transcript: ConversationTurn[];
}

interface HUDMessage {
  id: string;
  role: "user" | "agent";
  text: string;
  phase: "entering" | "visible" | "fading";
}

const DISPLAY_DURATION = 6000; // ms visible before fade starts
const FADE_DURATION = 1000;    // ms for fade-out
const MAX_VISIBLE = 2;

export function JarvisHUD({ transcript }: Props) {
  const [messages, setMessages] = useState<HUDMessage[]>([]);
  const prevLengthRef = useRef(0);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>[]>>(new Map());

  const scheduleLifecycle = useCallback((id: string) => {
    // Clear existing timers for this id
    timersRef.current.get(id)?.forEach(clearTimeout);

    const fadeTimer = setTimeout(() => {
      setMessages((prev) =>
        prev.map((m) => (m.id === id ? { ...m, phase: "fading" as const } : m))
      );
    }, DISPLAY_DURATION);

    const removeTimer = setTimeout(() => {
      setMessages((prev) => prev.filter((m) => m.id !== id));
      timersRef.current.delete(id);
    }, DISPLAY_DURATION + FADE_DURATION);

    timersRef.current.set(id, [fadeTimer, removeTimer]);
  }, []);

  // Watch for new transcript entries
  useEffect(() => {
    if (transcript.length === 0) {
      setMessages([]);
      prevLengthRef.current = 0;
      return;
    }

    // New bubble added
    if (transcript.length > prevLengthRef.current) {
      const newTurn = transcript[transcript.length - 1];

      setMessages((prev) => {
        const next = [
          ...prev,
          { id: newTurn.id, role: newTurn.role, text: newTurn.text, phase: "entering" as const },
        ];
        return next.slice(-MAX_VISIBLE);
      });

      scheduleLifecycle(newTurn.id);
      prevLengthRef.current = transcript.length;
    }

    // Update text of the last bubble (streaming appends)
    const lastTranscript = transcript[transcript.length - 1];
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === lastTranscript.id);
      if (idx === -1) return prev;
      if (prev[idx].text === lastTranscript.text) return prev;

      const updated = [...prev];
      updated[idx] = { ...updated[idx], text: lastTranscript.text };

      // Reset the fade timer since new text arrived
      timersRef.current.get(lastTranscript.id)?.forEach(clearTimeout);
      scheduleLifecycle(lastTranscript.id);

      return updated;
    });
  }, [transcript, scheduleLifecycle]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      timersRef.current.forEach((arr) => arr.forEach(clearTimeout));
    };
  }, []);

  if (messages.length === 0) return null;

  return (
    <div className="absolute bottom-24 left-6 z-10 pointer-events-none flex flex-col gap-3 max-w-md">
      {messages.map((msg) => (
        <div
          key={msg.id}
          className={`hud-message ${msg.role === "user" ? "hud-user" : "hud-agent"} ${
            msg.phase === "fading" ? "hud-fade-out" : "hud-fade-in"
          }`}
        >
          <div className="hud-role-bar">
            <span className={`hud-dot ${msg.role === "agent" ? "hud-dot-agent" : "hud-dot-user"}`} />
            <span className="hud-role-label">
              {msg.role === "agent" ? "GUIDE" : "YOU"}
            </span>
          </div>
          <p className="hud-text">{msg.text}</p>
        </div>
      ))}
    </div>
  );
}
