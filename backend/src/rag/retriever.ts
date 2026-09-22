import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import { embedText } from "./embeddings.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = path.join(__dirname, "..", "..", "data", "policy-index.json");

export interface PolicyEvidence {
  text: string;
  section: string;
  score: number;
}

export interface PolicySearchResult {
  evidence: PolicyEvidence[];
  sufficient: boolean;
}

/**
 * Swappable RAG interface. Any implementation of search_policy() can be
 * dropped in behind this — local JSON store, OpenAI hosted vector store,
 * Pinecone, pgvector, etc. — without touching the route or the realtime
 * tool wiring.
 */
export interface PolicyRetriever {
  search(question: string): Promise<PolicySearchResult>;
}

interface IndexedChunk {
  text: string;
  section: string;
  embedding: number[];
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Brute-force cosine-similarity search over a local JSON file of
 * {text, section, embedding} chunks. Fine for a single policy document
 * (a few hundred chunks) — the simplest reliable option for a POC.
 */
export class LocalJsonPolicyRetriever implements PolicyRetriever {
  private chunks: IndexedChunk[] = [];

  constructor(indexPath: string = INDEX_PATH) {
    if (!fs.existsSync(indexPath)) {
      throw new Error(
        `Policy index not found at ${indexPath}. Run "npm run ingest" in backend/ first.`
      );
    }
    this.chunks = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
  }

  async search(question: string): Promise<PolicySearchResult> {
    const queryVec = await embedText(question);

    const scored = this.chunks
      .map((chunk) => ({
        text: chunk.text,
        section: chunk.section,
        score: cosineSimilarity(queryVec, chunk.embedding),
      }))
      .sort((a, b) => b.score - a.score);

    const top = scored.slice(0, config.retrievalTopK);
    const sufficient = top.length > 0 && top[0].score >= config.retrievalScoreThreshold;

    return { evidence: top, sufficient };
  }
}
