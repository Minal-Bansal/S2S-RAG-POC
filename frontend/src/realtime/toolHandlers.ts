import type { PolicySearchResult } from "./types";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? "http://localhost:8787";

/**
 * Tool boundary on the browser side: forwards the question text to the
 * backend and returns whatever evidence/sufficiency it responds with.
 * The browser never talks to the vector store or embeddings directly.
 */
export async function searchPolicy(question: string): Promise<PolicySearchResult> {
  const res = await fetch(`${BACKEND_URL}/api/search-policy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
  });
  if (!res.ok) {
    throw new Error(`search-policy failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

export async function createRealtimeSession(): Promise<{ clientSecret: any; greeting: string }> {
  const res = await fetch(`${BACKEND_URL}/api/session`, { method: "POST" });
  if (!res.ok) {
    throw new Error(`session create failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}
