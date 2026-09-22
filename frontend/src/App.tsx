import { Controls } from "./components/Controls";
import { TranscriptPanel } from "./components/TranscriptPanel";
import { useRealtimeSession } from "./realtime/useRealtimeSession";

export default function App() {
  const { status, transcript, errorMessage, connect, disconnect } = useRealtimeSession();

  return (
    <div className="app">
      <h1>Policy Voice Assistant (POC)</h1>
      <p style={{ color: "#9aa4b2", fontSize: 14 }}>
        Speak-to-speech health insurance policy explainer. Answers to policy questions are
        grounded only in the ingested policy document via the <code>search_policy</code> tool.
      </p>

      <Controls status={status} onStart={connect} onStop={disconnect} />

      {errorMessage && (
        <div style={{ color: "#f85149", fontSize: 14 }}>Error: {errorMessage}</div>
      )}

      <TranscriptPanel entries={transcript} />
    </div>
  );
}
