import { Router } from "express";
import { logEvent } from "../logger.js";
import type { PolicyRetriever } from "../rag/retriever.js";

export function buildSearchPolicyRouter(retriever: PolicyRetriever): Router {
  const router = Router();

  /**
   * Tool boundary: the browser only ever sends/receives plain text here.
   * The vector index and embedding calls stay entirely server-side.
   */
  router.post("/search-policy", async (req, res) => {
    const question = req.body?.question;
    if (typeof question !== "string" || question.trim().length === 0) {
      res.status(400).json({ error: "Missing 'question' string in request body." });
      return;
    }

    try {
      logEvent({ kind: "tool_call", question });
      const result = await retriever.search(question);
      logEvent({
        kind: "tool_result",
        question,
        sufficient: result.sufficient,
        chunkCount: result.evidence.length,
        topScore: result.evidence[0]?.score ?? null,
      });
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logEvent({ kind: "error", message });
      res.status(500).json({ error: message });
    }
  });

  return router;
}
