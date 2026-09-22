import type { ConnectionStatus } from "../realtime/types";

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  idle: "Not connected",
  connecting: "Connecting…",
  connected: "Connected — listening",
  error: "Error",
  closed: "Session ended",
};

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
      <span className={`status-dot ${status}`} />
      <span>{STATUS_LABEL[status]}</span>
      <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
        <button onClick={onStart} disabled={isActive}>
          Start session
        </button>
        <button onClick={onStop} disabled={!isActive}>
          End session
        </button>
      </div>
    </div>
  );
}
