import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { embedTexts } from "./embeddings.js";
import { chunkText, extractPdfTextFromBytes } from "./pdfUtils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "..", "data");
const INDEX_PATH = path.join(DATA_DIR, "policy-index.json");

// Official Star Health Insurance product brochures — fetched directly into
// memory and indexed. The PDF bytes are never written to disk; only the
// derived text chunks + embeddings are persisted, in policy-index.json.
const SOURCES = [
  {
    document: "Star Comprehensive Insurance Policy",
    url: "https://d28c6jni2fmamz.cloudfront.net/Brochure_Star_Comprehensive_Insurance_Policy_V_15_Web_633bcfcaaf.pdf",
  },
  {
    document: "Medi Classic Insurance Policy (Individual)",
    url: "https://d28c6jni2fmamz.cloudfront.net/Brochure_Medi_Classic_Insurance_Policy_Individual_V_17_Web_93737c396f.pdf",
  },
  {
    document: "Family Health Optima Insurance Plan",
    url: "https://d28c6jni2fmamz.cloudfront.net/Brochure_Family_Health_Optima_Insurance_Plan_V_15_Web_74cee1b82f.pdf",
  },
  {
    document: "Star Health Assure Insurance Policy",
    url: "https://d28c6jni2fmamz.cloudfront.net/Brochure_Star_Health_Assure_Insurance_Policy_V_5_Web_8153c42b87.pdf",
  },
  {
    document: "Star Health Gain Insurance Policy",
    url: "https://d28c6jni2fmamz.cloudfront.net/Brochure_Star_Health_Gain_Insurance_Policy_V_13_Web_Page_4e4f649213.pdf",
  },
];

interface IndexedChunk {
  text: string;
  section: string;
  document: string;
  embedding: number[];
}

async function main() {
  const indexed: IndexedChunk[] = [];

  for (const source of SOURCES) {
    console.log(`\nFetching "${source.document}" ...`);
    const res = await fetch(source.url);
    if (!res.ok) throw new Error(`Failed to fetch ${source.url}: ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());

    const parsed = await extractPdfTextFromBytes(bytes);
    console.log(`  extracted ${parsed.text.length} characters from ${parsed.numPages} pages`);

    const chunks = chunkText(parsed.text);
    console.log(`  chunked into ${chunks.length} chunks`);

    const BATCH_SIZE = 96;
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);
      const vectors = await embedTexts(batch.map((c) => c.text));
      batch.forEach((c, j) =>
        indexed.push({ text: c.text, section: c.section, document: source.document, embedding: vectors[j] })
      );
      console.log(`  embedded ${Math.min(i + BATCH_SIZE, chunks.length)}/${chunks.length}`);
    }
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(INDEX_PATH, JSON.stringify(indexed, null, 2));
  console.log(`\nWrote index to ${INDEX_PATH} (${indexed.length} chunks across ${SOURCES.length} documents).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
