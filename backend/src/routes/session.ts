import { Router } from "express";
import { config } from "../config.js";
import { logEvent } from "../logger.js";
import { GREETING, SEARCH_POLICY_TOOL, SYSTEM_PROMPT } from "../prompt.js";

export const sessionRouter = Router();

/**
 * Mints a short-lived Realtime client secret using the real OPENAI_API_KEY
 * (server-side only) and returns it to the browser. The browser uses this
 * ephemeral secret to open its WebRTC connection directly to OpenAI —
 * it never sees OPENAI_API_KEY itself.
 */
sessionRouter.post("/session", async (_req, res) => {
  try {
    const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session: {
          type: "realtime",
          model: config.realtimeModel,
          instructions: SYSTEM_PROMPT,
          audio: {
            output: { voice: config.realtimeVoice },
            input: {
              transcription: { model: "whisper-1" },
              turn_detection: { type: "server_vad" },
            },
          },
          tools: [SEARCH_POLICY_TOOL],
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`OpenAI session create failed: ${response.status} ${errText}`);
    }

    const data = await response.json();
    logEvent({ kind: "session_created", sessionId: data.id ?? "unknown" });

    // Hand the ephemeral client_secret (and the greeting line) to the browser.
    res.json({ clientSecret: data, greeting: GREETING });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logEvent({ kind: "session_error", message });
    res.status(500).json({ error: message });
  }
});
