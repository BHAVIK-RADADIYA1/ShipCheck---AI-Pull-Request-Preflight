import path from "node:path";

import type { Finding, ParsedDiff } from "../types.js";
import { isMinified } from "./util.js";

export interface SizeLimits {
  warnLines: number;
  blockLines: number;
  warnFiles: number;
  blockFiles: number;
}

export const DEFAULT_SIZE_LIMITS: SizeLimits = {
  warnLines: 500,
  blockLines: 1500,
  warnFiles: 20,
  blockFiles: 60,
};

/**
 * Report large diffs so reviewers know before they start reading. The blocking
 * thresholds are deliberately high: a large change is a process risk, not
 * proof of a defect.
 */
export function checkSize(diff: ParsedDiff, limits: SizeLimits = DEFAULT_SIZE_LIMITS): Finding[] {
  const findings: Finding[] = [];
  const countedFiles = diff.files.filter((file) => !isMinified(file.path));
  const changedLines = diff.files.reduce((total, file) => total + file.added + file.removed, 0);

  if (changedLines > limits.blockLines) {
    findings.push({
      check: "size",
      severity: "blocking",
      title: `Very large change: ${changedLines} lines`,
      detail:
        `More than ${limits.blockLines} added/removed lines. ` +
        "Split the change into reviewable pieces before opening the pull request.",
    });
  } else if (changedLines > limits.warnLines) {
    findings.push({
      check: "size",
      severity: "warning",
      title: `Large change: ${changedLines} lines`,
      detail: `More than ${limits.warnLines} added/removed lines makes careful review harder.`,
    });
  }

  if (countedFiles.length > limits.blockFiles) {
    findings.push({
      check: "size",
      severity: "blocking",
      title: `Very large change: ${countedFiles.length} files`,
      detail: `More than ${limits.blockFiles} changed files. Consider splitting the change.`,
    });
  } else if (countedFiles.length > limits.warnFiles) {
    findings.push({
      check: "size",
      severity: "warning",
      title: `Large change: ${countedFiles.length} files`,
      detail: `More than ${limits.warnFiles} changed files makes careful review harder.`,
    });
  }

  const binaryFiles = diff.files.filter((file) => file.binary);
  if (binaryFiles.length > 0) {
    const names = binaryFiles
      .slice(0, 3)
      .map((file) => path.posix.basename(file.path))
      .join(", ");
    const suffix = binaryFiles.length > 3 ? ` and ${binaryFiles.length - 3} more` : "";
    findings.push({
      check: "size",
      severity: "info",
      title: `Binary files changed: ${binaryFiles.length}`,
      detail: `${names}${suffix}. Binary changes are not reviewed line by line.`,
    });
  }

  if (diff.files.length === 0) {
    findings.push({
      check: "size",
      severity: "info",
      title: "No changes relative to the base",
      detail: "The working tree matches the base commit.",
    });
  }

  return findings;
}