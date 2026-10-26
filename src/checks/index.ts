import type { UntrackedSkipCounts } from "../git.js";
import type { Finding, ParsedDiff } from "../types.js";
import { checkConflicts } from "./conflicts.js";
import { checkDebug } from "./debug.js";
import { checkSecrets } from "./secrets.js";
import { checkSize, DEFAULT_SIZE_LIMITS, type SizeLimits } from "./size.js";
import { checkMissingTests } from "./tests.js";

export interface RunChecksOptions {
  trackedFiles?: string[];
  sizeLimits?: SizeLimits;
  /** Report a note when untracked files could not be scanned. */
  skippedUntracked?: number;
  /** Breakdown of why untracked files were skipped. */
  skippedUntrackedReasons?: UntrackedSkipCounts;
}

function describeSkippedUntracked(
  count: number,
  reasons: UntrackedSkipCounts | undefined,
): string {
  const parts: string[] = [];
  if (reasons?.symlink) parts.push(`${reasons.symlink} symlink(s), not followed`);
  if (reasons?.outside) parts.push(`${reasons.outside} outside the repository`);
  if (reasons?.["too-large"]) parts.push(`${reasons["too-large"]} larger than 512 KB`);
  if (reasons?.unreadable) parts.push(`${reasons.unreadable} unreadable`);

  if (parts.length === 0) {
    return (
      `Skipped ${count} untracked file(s): symlinks are not followed, and files ` +
      "outside the repository, unreadable, or larger than 512 KB are ignored."
    );
  }

  return `Skipped ${count} untracked file(s): ${parts.join(", ")}.`;
}

/**
 * Run every deterministic check. No network access, no model calls, no
 * execution of reviewed code.
 */
function skippedUntrackedFinding(options: RunChecksOptions): Finding | null {
  if (!options.skippedUntracked || options.skippedUntracked <= 0) return null;

  return {
    check: "untracked",
    severity: "info",
    title: `${options.skippedUntracked} untracked file(s) not scanned`,
    detail: describeSkippedUntracked(
      options.skippedUntracked,
      options.skippedUntrackedReasons,
    ),
  };
}

export function runDeterministicChecks(
  diff: ParsedDiff,
  options: RunChecksOptions = {},
): Finding[] {
  const skipped = skippedUntrackedFinding(options);

  if (diff.files.length === 0) {
    return [
      {
        check: "size",
        severity: "info",
        title: "No changes relative to the base",
        detail: "The working tree matches the base commit.",
      },
      ...(skipped ? [skipped] : []),
    ];
  }

  const findings: Finding[] = [
    ...checkSecrets(diff),
    ...checkConflicts(diff),
    ...checkDebug(diff),
    ...checkSize(diff, options.sizeLimits ?? DEFAULT_SIZE_LIMITS),
    ...checkMissingTests(diff, options.trackedFiles ?? []),
  ];

  if (skipped) findings.push(skipped);

  return findings;
}

export { checkConflicts, checkDebug, checkSecrets, checkSize, checkMissingTests };
export { DEFAULT_SIZE_LIMITS };
export type { SizeLimits };