export { buildReport, isBlocking, renderMarkdown, renderTerminal, statusLabel } from "./report.js";
export { parseDiff, buildUntrackedFile, countChangedLines } from "./diff.js";
export { collectDiff, GitError, isValidRef, listTrackedFiles, runGit } from "./git.js";
export type { UntrackedSkipCounts, UntrackedSkipReason } from "./git.js";
export { runDeterministicChecks } from "./checks/index.js";
export { checkSecrets, containsLikelySecret, redactCredentialLike } from "./checks/secrets.js";
export { checkDebug } from "./checks/debug.js";
export { checkConflicts } from "./checks/conflicts.js";
export { checkSize, DEFAULT_SIZE_LIMITS } from "./checks/size.js";
export { checkMissingTests, isSourceFile, isTestPath } from "./checks/tests.js";
export { buildPromptDiff, readAiConfig, reviewWithAi, AI_ENV_VARS } from "./ai.js";
export { main } from "./cli.js";
export type {
  AiConfig,
  AiReview,
  DiffFile,
  DiffLine,
  DiffTotals,
  Finding,
  ParsedDiff,
  Report,
  Severity,
} from "./types.js";