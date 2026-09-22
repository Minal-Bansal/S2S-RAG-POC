import { useEffect, useRef } from "react";
import type { TranscriptEntry } from "../realtime/types";

const ROLE_LABEL: Record<TranscriptEntry["role"], string> = {
  user: "You",
  assistant: "Assistant",
  tool: "search_policy",
};

export function TranscriptPanel({ entries }: { entries: TranscriptEntry[] }) {
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries.length]);

  return (
    <div className="transcript">
      {entries.length === 0 && <div className="entry tool">Transcript will appear here once connected.</div>}
      {entries.map((entry) => (
        <div key={entry.id} className={`entry ${entry.role}`}>
          <span className="role">{ROLE_LABEL[entry.role]}:</span>
          {entry.text}
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
