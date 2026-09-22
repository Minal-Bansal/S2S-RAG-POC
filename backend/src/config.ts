import "dotenv/config";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const config = {
  openaiApiKey: required("OPENAI_API_KEY"),
  realtimeModel: process.env.REALTIME_MODEL ?? "gpt-realtime",
  embeddingModel: process.env.EMBEDDING_MODEL ?? "text-embedding-3-small",
  realtimeVoice: process.env.REALTIME_VOICE ?? "alloy",
  port: Number(process.env.PORT ?? 8787),
  frontendOrigin: process.env.FRONTEND_ORIGIN ?? "http://localhost:5173",
  retrievalScoreThreshold: Number(process.env.RETRIEVAL_SCORE_THRESHOLD ?? 0.72),
  retrievalTopK: Number(process.env.RETRIEVAL_TOP_K ?? 4),
};
