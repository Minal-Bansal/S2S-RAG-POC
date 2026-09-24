import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { embedTexts } from "./embeddings.js";
import { chunkText, extractPdfTextFromBytes } from "./pdfUtils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "..", "data");
const PDF_PATH = path.join(DATA_DIR, "policy.pdf");
const INDEX_PATH = path.join(DATA_DIR, "policy-index.json");

async function main() {
  if (!fs.existsSync(PDF_PATH)) {
    throw new Error(
      `No policy PDF found at ${PDF_PATH}. Place your policy document there as "policy.pdf" and re-run "npm run ingest".`
    );
  }

  console.log(`Reading ${PDF_PATH} ...`);
  const parsed = await extractPdfTextFromBytes(new Uint8Array(fs.readFileSync(PDF_PATH)));

  console.log(`Extracted ${parsed.text.length} characters from ${parsed.numPages} pages.`);
  const chunks = chunkText(parsed.text);
  console.log(`Chunked into ${chunks.length} chunks.`);

  console.log("Embedding chunks...");
  const BATCH_SIZE = 96;
  const indexed: { text: string; section: string; document: string; embedding: number[] }[] = [];
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const vectors = await embedTexts(batch.map((c) => c.text));
    batch.forEach((c, j) =>
      indexed.push({ text: c.text, section: c.section, document: "Policy Document", embedding: vectors[j] })
    );
    console.log(`  embedded ${Math.min(i + BATCH_SIZE, chunks.length)}/${chunks.length}`);
  }

  fs.writeFileSync(INDEX_PATH, JSON.stringify(indexed, null, 2));
  console.log(`Wrote index to ${INDEX_PATH} (${indexed.length} chunks).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
