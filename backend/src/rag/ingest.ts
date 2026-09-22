import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
// pdfjs-dist's legacy build targets Node directly (no DOM/worker setup needed).
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { embedTexts } from "./embeddings.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "..", "data");
const PDF_PATH = path.join(DATA_DIR, "policy.pdf");
const INDEX_PATH = path.join(DATA_DIR, "policy-index.json");

const CHUNK_SIZE = 900; // characters
const CHUNK_OVERLAP = 150; // characters

interface RawChunk {
  text: string;
  section: string;
}

/**
 * A line is treated as a section heading if it's short, has no trailing
 * period, and is either ALL CAPS or Title Case-ish (starts with a capital,
 * no lowercase-starting sentence structure). Heuristic — good enough for
 * typical policy-document headings ("SECTION 3: CLAIMS PROCESS", "Exclusions").
 */
function looksLikeHeading(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.length > 80) return false;
  if (trimmed.endsWith(".")) return false;
  const isAllCaps = trimmed === trimmed.toUpperCase() && /[A-Z]/.test(trimmed);
  const isNumberedHeading = /^(section|part|article|clause)\s+[\dIVXLC]+/i.test(trimmed);
  return isAllCaps || isNumberedHeading;
}

function chunkText(fullText: string): RawChunk[] {
  const lines = fullText.split(/\r?\n/);
  let currentSection = "General";
  const paragraphs: { text: string; section: string }[] = [];
  let buffer: string[] = [];

  const flushBuffer = () => {
    const text = buffer.join(" ").replace(/\s+/g, " ").trim();
    if (text.length > 0) paragraphs.push({ text, section: currentSection });
    buffer = [];
  };

  for (const line of lines) {
    if (looksLikeHeading(line)) {
      flushBuffer();
      currentSection = line.trim();
      continue;
    }
    if (line.trim() === "") {
      flushBuffer();
      continue;
    }
    buffer.push(line.trim());
  }
  flushBuffer();

  // Greedily pack paragraphs into ~CHUNK_SIZE chunks with overlap, never
  // splitting a paragraph across a section boundary.
  const chunks: RawChunk[] = [];
  let current = "";
  let currentChunkSection = paragraphs[0]?.section ?? "General";

  for (const para of paragraphs) {
    if (para.section !== currentChunkSection && current.length > 0) {
      chunks.push({ text: current.trim(), section: currentChunkSection });
      current = "";
    }
    currentChunkSection = para.section;

    if ((current + " " + para.text).length > CHUNK_SIZE && current.length > 0) {
      chunks.push({ text: current.trim(), section: currentChunkSection });
      const overlapStart = Math.max(0, current.length - CHUNK_OVERLAP);
      current = current.slice(overlapStart);
    }
    current = (current + " " + para.text).trim();
  }
  if (current.trim().length > 0) {
    chunks.push({ text: current.trim(), section: currentChunkSection });
  }

  return chunks.filter((c) => c.text.length > 20);
}

const STANDARD_FONT_DATA_URL = path.join(
  __dirname,
  "..",
  "..",
  "node_modules",
  "pdfjs-dist",
  "standard_fonts/"
);

async function extractPdfText(pdfPath: string): Promise<{ text: string; numPages: number }> {
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const doc = await pdfjsLib.getDocument({ data, standardFontDataUrl: STANDARD_FONT_DATA_URL }).promise;

  const pageTexts: string[] = [];
  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();
    // Join items with newlines so line-based heading detection in chunkText still works.
    const pageText = content.items.map((item: any) => item.str ?? "").join("\n");
    pageTexts.push(pageText);
  }

  return { text: pageTexts.join("\n"), numPages: doc.numPages };
}

async function main() {
  if (!fs.existsSync(PDF_PATH)) {
    throw new Error(
      `No policy PDF found at ${PDF_PATH}. Place your policy document there as "policy.pdf" and re-run "npm run ingest".`
    );
  }

  console.log(`Reading ${PDF_PATH} ...`);
  const parsed = await extractPdfText(PDF_PATH);

  console.log(`Extracted ${parsed.text.length} characters from ${parsed.numPages} pages.`);
  const chunks = chunkText(parsed.text);
  console.log(`Chunked into ${chunks.length} chunks (target ~${CHUNK_SIZE} chars, ${CHUNK_OVERLAP} overlap).`);

  console.log("Embedding chunks...");
  const BATCH_SIZE = 96;
  const indexed: { text: string; section: string; embedding: number[] }[] = [];
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const vectors = await embedTexts(batch.map((c) => c.text));
    batch.forEach((c, j) => indexed.push({ text: c.text, section: c.section, embedding: vectors[j] }));
    console.log(`  embedded ${Math.min(i + BATCH_SIZE, chunks.length)}/${chunks.length}`);
  }

  fs.writeFileSync(INDEX_PATH, JSON.stringify(indexed, null, 2));
  console.log(`Wrote index to ${INDEX_PATH} (${indexed.length} chunks).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
