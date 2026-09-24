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
  document: string;
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
  search(question: string, productHint?: string): Promise<PolicySearchResult>;
}

interface IndexedChunk {
  text: string;
  section: string;
  document: string;
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
 * {text, section, document, embedding} chunks, spanning one or more source
 * documents. Fine at this scale (a few hundred chunks) — the simplest
 * reliable option for a POC.
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

  async search(question: string, productHint?: string): Promise<PolicySearchResult> {
    const queryVec = await embedText(question);

    // When the model names a specific plan, scope the search to that plan's
    // brochure — generic insurance boilerplate (waiting periods, sum insured,
    // etc.) reads similarly across Star Health's product line, so semantic
    // similarity alone can't reliably tell the documents apart otherwise.
    let pool = this.chunks;
    if (productHint && productHint.trim().length > 0) {
      const hint = productHint.trim().toLowerCase();
      const filtered = this.chunks.filter((c) => c.document.toLowerCase().includes(hint));
      if (filtered.length > 0) pool = filtered;
    }

    const scored = pool
      .map((chunk) => ({
        text: chunk.text,
        section: chunk.section,
        document: chunk.document,
        score: cosineSimilarity(queryVec, chunk.embedding),
      }))
      .sort((a, b) => b.score - a.score);

    const top = scored.slice(0, config.retrievalTopK);
    const sufficient = top.length > 0 && top[0].score >= config.retrievalScoreThreshold;

    return { evidence: top, sufficient };
  }
}
