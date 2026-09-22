import cors from "cors";
import express from "express";
import { config } from "./config.js";
import { LocalJsonPolicyRetriever } from "./rag/retriever.js";
import { buildSearchPolicyRouter } from "./routes/searchPolicy.js";
import { sessionRouter } from "./routes/session.js";

const app = express();
app.use(cors({ origin: config.frontendOrigin }));
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/api", sessionRouter);

// Retriever is instantiated once; swap LocalJsonPolicyRetriever for another
// PolicyRetriever implementation here without touching routes elsewhere.
const retriever = new LocalJsonPolicyRetriever();
app.use("/api", buildSearchPolicyRouter(retriever));

app.listen(config.port, () => {
  console.log(`Backend listening on http://localhost:${config.port}`);
});
