export type ConnectionStatus = "idle" | "connecting" | "connected" | "error" | "closed";

export interface TranscriptEntry {
  id: string;
  role: "user" | "assistant";
  text: string;
}

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
