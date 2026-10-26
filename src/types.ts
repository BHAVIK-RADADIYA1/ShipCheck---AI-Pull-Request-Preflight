export type Severity = "blocking" | "warning" | "info";

export type FileStatus = "added" | "modified" | "deleted" | "renamed";

export interface DiffLine {
  kind: "add" | "del" | "context";
  /** Line content without the unified-diff prefix character. */
  content: string;
  /** 1-based line number in the new file (add/context only). */
  newLine?: number;
  /** 1-based line number in the old file (del/context only). */
  oldLine?: number;
}

export interface DiffFile {
  /** Path in the new file, or the old path for deletions. */
  path: string;
  oldPath?: string;
  status: FileStatus;
  binary: boolean;
  /** Synthetic entries are files that were untracked in the working tree. */
  untracked?: boolean;
  lines: DiffLine[];
  added: number;
  removed: number;
}

export interface ParsedDiff {
  files: DiffFile[];
  raw: string;
}

export interface Finding {
  /** Stable identifier of the check that produced the finding. */
  check: string;
  severity: Severity;
  title: string;
  file?: string;
  line?: number;
  detail?: string;
}

export interface DiffTotals {
  files: number;
  added: number;
  removed: number;
  changedLines: number;
  binaryFiles: number;
}

export interface AiReview {
  status: "skipped" | "completed" | "failed";
  model?: string;
  summary?: string;
  risks?: string[];
  reason?: string;
}

export interface Report {
  tool: string;
  version: string;
  base: string;
  generatedAt: string;
  totals: DiffTotals;
  files: DiffFile[];
  findings: Finding[];
  blocking: number;
  warnings: number;
  infos: number;
  ai?: AiReview;
}

export interface AiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  maxDiffChars?: number;
}