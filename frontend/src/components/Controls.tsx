import type { ConnectionStatus } from "../realtime/types";

export function Controls({
  status,
  onStart,
  onStop,
}: {
  status: ConnectionStatus;
  onStart: () => void;
  onStop: () => void;
}) {
  const isActive = status === "connecting" || status === "connected";

  return (
    <div className="status-bar">
      <div className="status-actions">
        <button className="btn-start" onClick={onStart} disabled={isActive}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="9" y="2" width="6" height="12" rx="3" fill="currentColor" />
            <path
              d="M5 11a7 7 0 0 0 14 0M12 18v3"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
          Start session
        </button>
        <button className="btn-end" onClick={onStop} disabled={!isActive}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M3.5 10.5c5.5-5 11.5-5 17 0a1.2 1.2 0 0 1 .1 1.7l-2.2 2.4a1.2 1.2 0 0 1-1.6.1l-2-1.6a1.2 1.2 0 0 0-1.4-.05 6 6 0 0 1-3.6 0 1.2 1.2 0 0 0-1.4.05l-2 1.6a1.2 1.2 0 0 1-1.6-.1l-2.2-2.4a1.2 1.2 0 0 1 .1-1.7Z"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
          </svg>
          End session
        </button>
      </div>
    </div>
  );
}
