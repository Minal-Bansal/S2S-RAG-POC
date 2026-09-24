import { useEffect, useRef } from "react";
import type { TranscriptEntry } from "../realtime/types";

const ROLE_LABEL: Record<TranscriptEntry["role"], string> = {
  user: "You",
  assistant: "Assistant",
};

const ROLE_INITIAL: Record<TranscriptEntry["role"], string> = {
  user: "Y",
  assistant: "S",
};

export function TranscriptPanel({ entries }: { entries: TranscriptEntry[] }) {
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries.length]);

  return (
    <div className="card transcript">
      {entries.length === 0 && <div className="transcript-hint">Transcript will appear here once connected.</div>}
      {entries.map((entry) => (
        <div key={entry.id} className={`bubble-line ${entry.role}`}>
          <span className={`avatar ${entry.role}`}>{ROLE_INITIAL[entry.role]}</span>
          <div className="bubble-col">
            <span className="bubble-role">{ROLE_LABEL[entry.role]}</span>
            <div className={`bubble ${entry.role}`}>{entry.text}</div>
          </div>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
