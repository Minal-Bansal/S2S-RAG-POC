import { useState } from "react";
import type { FormEvent } from "react";

// Hardcoded demo credential for this POC — not a real auth backend.
const DEMO_USERNAME = "demo@lumiq.ai";
const DEMO_PASSWORD = "lumiq@123";

export function LoginScreen({ onLogin }: { onLogin: (username: string) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();

    if (username.trim().length === 0 || password.length === 0) {
      setError("Enter a username and password to continue.");
      return;
    }

    if (username.trim() !== DEMO_USERNAME || password !== DEMO_PASSWORD) {
      setError("Invalid username or password.");
      return;
    }

    setError(null);
    onLogin(username.trim());
  };

  return (
    <div className="app login-page">
      <div className="card masthead">
        <h1>Star Health AI Teaching Assistant</h1>
        <div className="masthead-rule" />
        <p className="powered-by">
          Developed by
          <img src="/lumiq_logo.png" alt="LUMIQ" />
        </p>
      </div>

      <form className="card login-card" onSubmit={handleSubmit} noValidate>
        <div className="login-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.8" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" stroke="currentColor" strokeWidth="1.8" />
          </svg>
        </div>
        <h2 className="login-title">Sign in</h2>
        <p className="login-subtitle">Enter your credentials to start a tutoring session.</p>

        <label className="login-field" htmlFor="login-username">
          <span>Username</span>
          <input
            id="login-username"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
          />
        </label>

        <label className="login-field" htmlFor="login-password">
          <span>Password</span>
          <input
            id="login-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>

        {error && <p className="login-error">{error}</p>}

        <button type="submit" className="btn-start login-submit">
          Sign in
        </button>
      </form>
    </div>
  );
}
