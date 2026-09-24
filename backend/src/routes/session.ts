import { Router } from "express";
import { config } from "../config.js";
import { logEvent } from "../logger.js";
import { END_CALL_TOOL, GREETING, SEARCH_POLICY_TOOL, SYSTEM_PROMPT } from "../prompt.js";

export const sessionRouter = Router();

/**
 * Mints a short-lived Realtime client secret using the real AZURE_OPENAI_API_KEY
 * (server-side only) and returns it to the browser. The browser uses this
 * ephemeral secret to open its WebRTC connection directly to the Azure
 * OpenAI resource — it never sees AZURE_OPENAI_API_KEY itself.
 */
sessionRouter.post("/session", async (_req, res) => {
  try {
    const response = await fetch(`${config.azureEndpoint}/openai/v1/realtime/client_secrets`, {
      method: "POST",
      headers: {
        "api-key": config.azureApiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session: {
          type: "realtime",
          model: config.azureRealtimeDeployment,
          instructions: SYSTEM_PROMPT,
          audio: {
            output: { voice: config.realtimeVoice },
            input: {
              transcription: { model: "whisper-1", language: "en" },
              // Configurable via VAD_THRESHOLD / VAD_SILENCE_DURATION_MS in
              // .env — tune higher in an echo-prone speaker+mic setup, back
              // toward the API defaults (0.5 / 200ms) in a quiet room or with
              // headphones, where a high threshold instead misses normal speech.
              turn_detection: {
                type: "server_vad",
                threshold: config.vadThreshold,
                silence_duration_ms: config.vadSilenceDurationMs,
              },
            },
          },
          tools: [SEARCH_POLICY_TOOL, END_CALL_TOOL],
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Azure Realtime session create failed: ${response.status} ${errText}`);
    }

    const data = await response.json();
    logEvent({ kind: "session_created", sessionId: data.id ?? "unknown" });

    // Hand the ephemeral client_secret, the WebRTC SDP-exchange URL, and the
    // greeting line to the browser. The call URL lives on the Azure resource,
    // not api.openai.com, so the browser needs it rather than hardcoding one.
    res.json({
      clientSecret: data,
      greeting: GREETING,
      realtimeCallUrl: `${config.azureEndpoint}/openai/v1/realtime/calls`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logEvent({ kind: "session_error", message });
    res.status(500).json({ error: message });
  }
});
