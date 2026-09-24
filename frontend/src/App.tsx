import { useState } from "react";
import { Controls } from "./components/Controls";
import { LoginScreen } from "./components/LoginScreen";
import { TranscriptPanel } from "./components/TranscriptPanel";
import { useRealtimeSession } from "./realtime/useRealtimeSession";

export default function App() {
  const { status, transcript, connect, disconnect } = useRealtimeSession();
  const [username, setUsername] = useState<string | null>(null);

  const handleLogout = () => {
    disconnect();
    setUsername(null);
  };

  if (!username) {
    return <LoginScreen onLogin={setUsername} />;
  }

  return (
    <div className="app">
      <div className="card masthead">
        <div className="masthead-top">
          <div>
            <h1>Star Health AI Teaching Assistant</h1>
            <div className="masthead-rule" />
            <p className="powered-by">
              Developed by
              <img src="/lumiq_logo.png" alt="LUMIQ" />
            </p>
          </div>
          <div className="session-user">
            <button className="link-button" onClick={handleLogout}>
              Log out
            </button>
          </div>
        </div>

        <Controls status={status} onStart={connect} onStop={() => disconnect()} />
      </div>

      <TranscriptPanel entries={transcript} />
    </div>
  );
}
