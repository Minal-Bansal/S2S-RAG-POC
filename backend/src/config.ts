import "dotenv/config";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const config = {
  azureEndpoint: required("AZURE_OPENAI_ENDPOINT").replace(/\/+$/, ""),
  azureApiKey: required("AZURE_OPENAI_API_KEY"),
  azureApiVersion: process.env.AZURE_OPENAI_API_VERSION ?? "2025-04-01-preview",
  azureRealtimeDeployment: process.env.AZURE_REALTIME_DEPLOYMENT ?? "gpt-realtime-mini",
  azureEmbeddingDeployment: process.env.AZURE_EMBEDDING_DEPLOYMENT ?? "text-embedding-3-small",
  realtimeVoice: process.env.REALTIME_VOICE ?? "alloy",
  port: Number(process.env.PORT ?? 8787),
  frontendOrigin: process.env.FRONTEND_ORIGIN ?? "http://localhost:5173",
  retrievalScoreThreshold: Number(process.env.RETRIEVAL_SCORE_THRESHOLD ?? 0.35),
  retrievalTopK: Number(process.env.RETRIEVAL_TOP_K ?? 4),
  // How sensitive server-side VAD is to "user started speaking". Raise this
  // (and vadSilenceDurationMs) when testing with speakers+mic in an echo-prone
  // room; lower back toward the API default (0.5) in a quiet room / headphones,
  // where a high threshold instead makes it miss normal speaking volume.
  vadThreshold: Number(process.env.VAD_THRESHOLD ?? 0.5),
  vadSilenceDurationMs: Number(process.env.VAD_SILENCE_DURATION_MS ?? 200),
};
