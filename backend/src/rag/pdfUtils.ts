import path from "node:path";
import { fileURLToPath } from "node:url";
// pdfjs-dist's legacy build targets Node directly (no DOM/worker setup needed).
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STANDARD_FONT_DATA_URL = path.join(__dirname, "..", "..", "node_modules", "pdfjs-dist", "standard_fonts/");

export const CHUNK_SIZE = 900; // characters
export const CHUNK_OVERLAP = 150; // characters

export interface RawChunk {
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

export function chunkText(fullText: string): RawChunk[] {
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

/** Extracts text from PDF bytes already in memory — no disk write required. */
export async function extractPdfTextFromBytes(data: Uint8Array): Promise<{ text: string; numPages: number }> {
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
