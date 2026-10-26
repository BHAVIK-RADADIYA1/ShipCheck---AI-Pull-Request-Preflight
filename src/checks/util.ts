import path from "node:path";

import type { DiffFile, DiffLine, ParsedDiff } from "../types.js";

const LOCKFILES = new Set([
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
  "Cargo.lock",
  "poetry.lock",
  "Pipfile.lock",
  "composer.lock",
  "Gemfile.lock",
  "go.sum",
]);

const DOC_EXTENSIONS = new Set([".md", ".mdx", ".rst", ".txt", ".adoc"]);

const GENERATED_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  "coverage",
  "vendor",
  "generated",
  ".next",
  ".nuxt",
  ".venv",
  "venv",
  "__pycache__",
]);

export function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

export function isLockfile(filePath: string): boolean {
  return LOCKFILES.has(path.posix.basename(toPosix(filePath)));
}

export function isMinified(filePath: string): boolean {
  return /\.min\.(?:js|css)$/.test(filePath) || /\.map$/.test(filePath);
}

export function isDocumentation(filePath: string): boolean {
  return DOC_EXTENSIONS.has(path.posix.extname(toPosix(filePath)).toLowerCase());
}

export function isGeneratedPath(filePath: string): boolean {
  const segments = toPosix(filePath).split("/");
  return segments.some((segment) => GENERATED_DIRS.has(segment));
}

/** Skip files where a line-based scan is meaningless or pathologically noisy. */
export function shouldScanText(filePath: string): boolean {
  if (isLockfile(filePath) || isMinified(filePath)) return false;
  if (isGeneratedPath(filePath)) return false;
  return true;
}

/** Ignore an entire file for the debug/TODO scan when it is prose. */
export function shouldScanCode(filePath: string): boolean {
  return shouldScanText(filePath) && !isDocumentation(filePath);
}

export function addedLines(diff: ParsedDiff): Array<{ file: DiffFile; line: DiffLine }> {
  const rows: Array<{ file: DiffFile; line: DiffLine }> = [];
  for (const file of diff.files) {
    if (file.binary) continue;
    for (const line of file.lines) {
      if (line.kind === "add") rows.push({ file, line });
    }
  }
  return rows;
}

export function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1))}…`;
}

export function isCommentOnly(content: string): boolean {
  const trimmed = content.trim();
  if (trimmed === "") return true;
  return (
    trimmed.startsWith("//") ||
    trimmed.startsWith("#") ||
    trimmed.startsWith("*") ||
    trimmed.startsWith("/*") ||
    trimmed.startsWith("--") ||
    trimmed.startsWith("<!--")
  );
}