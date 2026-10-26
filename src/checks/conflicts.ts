import type { Finding, ParsedDiff } from "../types.js";
import { shouldScanText } from "./util.js";

const START_MARKER = /^<{7}(?: |$)/;
const END_MARKER = /^>{7}(?: |$)/;
const SEPARATOR = /^={7}$/;

/**
 * Detect merge-conflict markers in added lines.
 *
 * A bare `=======` line is common in Markdown and ASCII art, so it is only
 * reported when the same file also added a `<<<<<<<` marker.
 */
export function checkConflicts(diff: ParsedDiff): Finding[] {
  const findings: Finding[] = [];

  for (const file of diff.files) {
    if (file.binary || !shouldScanText(file.path)) continue;

    const added = file.lines.filter((line) => line.kind === "add");
    const starts = added.filter((line) => START_MARKER.test(line.content));
    const ends = added.filter((line) => END_MARKER.test(line.content));
    const separators = added.filter((line) => SEPARATOR.test(line.content));

    const markerCount = starts.length + ends.length + (starts.length > 0 ? separators.length : 0);
    if (markerCount === 0) continue;

    const first = starts[0] ?? ends[0] ?? separators[0];
    findings.push({
      check: "conflicts",
      severity: "blocking",
      title: "Merge conflict markers in the change",
      file: file.path,
      line: first?.newLine,
      detail:
        `Found ${markerCount} conflict marker line(s). ` +
        "Resolve the conflict and remove the markers before review.",
    });
  }

  return findings;
}