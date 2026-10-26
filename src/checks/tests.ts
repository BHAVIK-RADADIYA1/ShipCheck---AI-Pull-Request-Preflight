import path from "node:path";

import type { DiffFile, Finding, ParsedDiff } from "../types.js";
import { isGeneratedPath } from "./util.js";

const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".rs",
  ".rb",
  ".java",
  ".kt",
  ".kts",
  ".cs",
  ".php",
  ".swift",
  ".c",
  ".h",
  ".cc",
  ".cpp",
  ".hpp",
  ".scala",
  ".ex",
  ".exs",
]);

const TEST_PATH =
  /(^|\/)(__tests__|__specs__|tests?|spec)\/|\.(test|spec)\.[^/]+$|(^|\/)test_[^/]+$|_test\.[^/]+$|(Test|Tests|Spec)\.(java|kt|cs|swift|php)$/;

const CONFIG_FILE =
  /(^|\/)(vite|webpack|rollup|esbuild|tailwind|postcss|jest|vitest|playwright|eslint|prettier|babel|tsup)\.config\.[^/]+$|(^|\/)\.eslintrc|(^|\/)tsconfig[^/]*\.json$/;

function extensionOf(filePath: string): string {
  return path.posix.extname(filePath).toLowerCase();
}

export function isTestPath(filePath: string): boolean {
  return TEST_PATH.test(filePath);
}

export function isSourceFile(filePath: string, status: DiffFile["status"]): boolean {
  if (status === "deleted") return false;
  if (!SOURCE_EXTENSIONS.has(extensionOf(filePath))) return false;
  if (isTestPath(filePath)) return false;
  if (CONFIG_FILE.test(filePath)) return false;
  if (isGeneratedPath(filePath)) return false;
  if (filePath.endsWith(".d.ts")) return false;
  if (/(^|\/)(migrations?|fixtures?)\//.test(filePath)) return false;
  return true;
}

const GENERIC_NAME_TOKENS = new Set(["test", "tests", "spec", "specs", "src", "lib"]);

function nameTokens(filePath: string): string[] {
  const base = path.posix.basename(filePath, extensionOf(filePath));
  return base
    .split(/[^A-Za-z0-9]+/)
    .filter((token) => token.length > 1)
    .map((token) => token.toLowerCase())
    .filter((token) => !GENERIC_NAME_TOKENS.has(token));
}

function hasMatchingTest(source: string, testFiles: string[]): boolean {
  const sourceTokens = new Set(nameTokens(source));
  if (sourceTokens.size === 0) return false;

  return testFiles.some((testFile) => {
    const testTokens = new Set(nameTokens(testFile));
    for (const token of sourceTokens) {
      if (testTokens.has(token)) return true;
    }
    return false;
  });
}

export interface MissingTestOptions {
  maxReported?: number;
}

/**
 * Heuristic: warn about changed source files that have no test file with a
 * matching filename anywhere in the repository.
 *
 * This is intentionally a filename heuristic. It cannot prove that a change is
 * untested, and the finding text says so.
 */
export function checkMissingTests(
  diff: ParsedDiff,
  trackedFiles: string[],
  options: MissingTestOptions = {},
): Finding[] {
  const maxReported = options.maxReported ?? 5;

  const knownTests = new Set([
    ...trackedFiles.filter(isTestPath),
    ...diff.files.filter((file) => isTestPath(file.path)).map((file) => file.path),
  ]);
  const testFiles = [...knownTests];

  const untested = diff.files.filter(
    (file) => isSourceFile(file.path, file.status) && !hasMatchingTest(file.path, testFiles),
  );

  if (untested.length === 0) return [];

  const findings: Finding[] = untested.slice(0, maxReported).map((file) => ({
    check: "missing-tests",
    severity: "warning",
    title: "No matching test file found for this change",
    file: file.path,
    detail:
      "Heuristic: ShipCheck matches test files by filename. " +
      "Add or update a test, or confirm the change is covered elsewhere.",
  }));

  if (untested.length > maxReported) {
    const remaining = untested.slice(maxReported).map((file) => file.path);
    findings.push({
      check: "missing-tests",
      severity: "warning",
      title: `${remaining.length} more source files have no matching test file`,
      detail: `Heuristic, and capped at ${maxReported} entries. Also unmatched: ${remaining
        .slice(0, 5)
        .join(", ")}${remaining.length > 5 ? ", …" : ""}`,
    });
  }

  return findings;
}