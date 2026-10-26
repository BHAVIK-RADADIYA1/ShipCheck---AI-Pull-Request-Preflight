import type { Finding, ParsedDiff } from "../types.js";
import { redactCredentialLike } from "./secrets.js";
import { addedLines, isCommentOnly, shouldScanCode, truncate } from "./util.js";

const CONSOLE_LOG = /\bconsole\s*\.\s*(?:log|debug|trace)\s*\(/;
const DEBUGGER = /^\s*debugger\s*;?\s*$/;
const TODO_MARKER = /\b(TODO|FIXME|XXX|HACK)\b/;
const ALLOWLIST_COMMENT = /shipcheck:ignore/i;

/**
 * Flag common debugging leftovers and unfinished-work markers in added lines.
 * Comment-only lines are ignored for the console/debugger checks so that
 * documentation about `console.log` does not create noise.
 */
export function checkDebug(diff: ParsedDiff): Finding[] {
  const findings: Finding[] = [];

  for (const { file, line } of addedLines(diff)) {
    if (!shouldScanCode(file.path)) continue;
    if (ALLOWLIST_COMMENT.test(line.content)) continue;

    const commentOnly = isCommentOnly(line.content);
    const location = { file: file.path, line: line.newLine };

    if (!commentOnly && CONSOLE_LOG.test(line.content)) {
      findings.push({
        check: "debug",
        severity: "warning",
        title: "Debug logging left in the change",
        ...location,
        detail: truncate(redactCredentialLike(line.content.trim()), 120),
      });
    }

    if (!commentOnly && DEBUGGER.test(line.content)) {
      findings.push({
        check: "debug",
        severity: "warning",
        title: "`debugger` statement left in the change",
        ...location,
        detail: "Remove it before opening the pull request.",
      });
    }

    const marker = TODO_MARKER.exec(line.content);
    if (marker) {
      findings.push({
        check: "debug",
        severity: "warning",
        title: `${marker[1] ?? "TODO"} marker in added code`,
        ...location,
        detail: truncate(redactCredentialLike(line.content.trim()), 120),
      });
    }
  }

  return findings;
}