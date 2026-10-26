import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { redactCredentialLike } from "./checks/secrets.js";
import type { AiReview, Finding, ParsedDiff, Report, Severity } from "./types.js";

export const REPORT_FILENAME = "shipcheck-report.md";

const SEVERITY_ORDER: Record<Severity, number> = {
  blocking: 0,
  warning: 1,
  info: 2,
};

export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((left, right) => {
    const bySeverity = SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity];
    if (bySeverity !== 0) return bySeverity;
    const byFile = (left.file ?? "").localeCompare(right.file ?? "");
    if (byFile !== 0) return byFile;
    return (left.line ?? 0) - (right.line ?? 0);
  });
}

export interface BuildReportOptions {
  version: string;
  base: string;
  diff: ParsedDiff;
  findings: Finding[];
  ai?: AiReview;
  now?: Date;
}

export function buildReport(options: BuildReportOptions): Report {
  const { diff } = options;
  const findings = sortFindings(options.findings);
  const added = diff.files.reduce((total, file) => total + file.added, 0);
  const removed = diff.files.reduce((total, file) => total + file.removed, 0);

  return {
    tool: "ShipCheck",
    version: options.version,
    base: options.base,
    generatedAt: (options.now ?? new Date()).toISOString(),
    totals: {
      files: diff.files.length,
      added,
      removed,
      changedLines: added + removed,
      binaryFiles: diff.files.filter((file) => file.binary).length,
    },
    files: diff.files,
    findings,
    blocking: findings.filter((finding) => finding.severity === "blocking").length,
    warnings: findings.filter((finding) => finding.severity === "warning").length,
    infos: findings.filter((finding) => finding.severity === "info").length,
    ...(options.ai ? { ai: options.ai } : {}),
  };
}

export function statusLabel(report: Report): string {
  if (report.totals.files === 0) return "Nothing to review";
  if (report.blocking > 0) return "Not ready for review";
  if (report.warnings > 0) return "Ready for review, with warnings";
  return "Ready for review";
}

export function isBlocking(report: Report, strict = false): boolean {
  if (report.blocking > 0) return true;
  return strict && report.warnings > 0;
}

function markdownCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function findingLocation(finding: Finding): string {
  if (!finding.file) return "repository";
  return finding.line ? `${finding.file}:${finding.line}` : finding.file;
}

export function renderMarkdown(report: Report): string {
  const lines: string[] = [];
  const ai = report.ai;

  lines.push("# ShipCheck report", "");
  lines.push("| Field | Value |");
  lines.push("| --- | --- |");
  lines.push(`| Status | **${statusLabel(report)}** |`);
  lines.push(`| Base | \`${markdownCell(report.base)}\` |`);
  lines.push(`| Generated | ${report.generatedAt} |`);
  lines.push(`| Files changed | ${report.totals.files} |`);
  lines.push(`| Lines added / removed | +${report.totals.added} / -${report.totals.removed} |`);
  lines.push(
    `| Findings | ${report.blocking} blocking, ${report.warnings} warning, ${report.infos} info |`,
  );
  lines.push("");

  lines.push("## Findings", "");
  if (report.findings.length === 0) {
    lines.push("No findings. The deterministic checks found nothing to flag.", "");
  } else {
    for (const severity of ["blocking", "warning", "info"] as Severity[]) {
      const group = report.findings.filter((finding) => finding.severity === severity);
      if (group.length === 0) continue;
      lines.push(`### ${severity[0]?.toUpperCase() ?? ""}${severity.slice(1)} (${group.length})`, "");
      for (const finding of group) {
        lines.push(`- **${finding.title}** — \`${markdownCell(findingLocation(finding))}\``);
        if (finding.detail) lines.push(`  ${markdownCell(finding.detail)}`);
      }
      lines.push("");
    }
  }

  lines.push("## Changed files", "");
  if (report.files.length === 0) {
    lines.push("No changed files relative to the base.", "");
  } else {
    lines.push("| File | Status | Added | Removed |");
    lines.push("| --- | --- | ---: | ---: |");
    for (const file of report.files) {
      const status = file.binary ? `${file.status} (binary)` : file.status;
      lines.push(
        `| \`${markdownCell(file.path)}\` | ${status} | ${file.added} | ${file.removed} |`,
      );
    }
    lines.push("");
  }

  if (ai) {
    lines.push("## AI review", "");
    if (ai.status === "completed") {
      if (ai.model) lines.push(`Model: \`${markdownCell(ai.model)}\``, "");
      if (ai.summary) lines.push(ai.summary, "");
      if (ai.risks && ai.risks.length > 0) {
        for (const risk of ai.risks) lines.push(`- ${risk}`);
        lines.push("");
      }
    } else if (ai.status === "failed") {
      lines.push(`AI review failed: ${ai.reason ?? "unknown error"}.`, "");
    } else {
      lines.push(`AI review skipped: ${ai.reason ?? "not configured"}.`, "");
    }
  }

  lines.push("## Limitations", "");
  lines.push(
    "- Deterministic checks only inspect the diff; they do not prove the change is correct.",
  );
  lines.push("- Test detection is a filename heuristic, not coverage analysis.");
  lines.push("- Secret detection uses patterns and can miss novel credential formats.");
  lines.push("- Reviewed code is never executed, and the default run makes no network calls.");
  lines.push("");

  return lines.join("\n");
}

function colorize(enabled: boolean, code: string, value: string): string {
  return enabled ? `\u001b[${code}m${value}\u001b[0m` : value;
}

export interface TerminalOptions {
  color?: boolean;
}

export function renderTerminal(report: Report, options: TerminalOptions = {}): string {
  const color = options.color ?? false;
  const lines: string[] = [];
  const red = (value: string) => colorize(color, "31", value);
  const yellow = (value: string) => colorize(color, "33", value);
  const blue = (value: string) => colorize(color, "36", value);
  const dim = (value: string) => colorize(color, "2", value);
  const bold = (value: string) => colorize(color, "1", value);

  lines.push(bold(`ShipCheck ${report.version} — review readiness`));
  lines.push(dim(`Base: ${report.base}`));
  lines.push(
    `${report.totals.files} file(s) changed, +${report.totals.added} / -${report.totals.removed} lines`,
  );
  lines.push(
    `${statusLabel(report)}  (${report.blocking} blocking, ${report.warnings} warning, ${report.infos} info)`,
  );

  if (report.totals.files === 0) {
    lines.push("");
    lines.push("No changes relative to the base. Nothing to review.");
    return lines.join("\n");
  }

  if (report.findings.length > 0) {
    lines.push("");
    for (const finding of report.findings) {
      const marker =
        finding.severity === "blocking"
          ? red("x")
          : finding.severity === "warning"
            ? yellow("!")
            : blue("i");
      const location = dim(` ${findingLocation(finding)}`);
      lines.push(`${marker} ${finding.title}${location}`);
    }
  }

  lines.push("");
  const blocking = isBlocking(report);
  lines.push(
    blocking
      ? red("Result: not ready for review.")
      : report.warnings > 0
        ? yellow("Result: ready for review, with warnings.")
        : bold("Result: ready for review."),
  );

  return lines.join("\n");
}

export function writeReportFile(filePath: string, markdown: string): string {
  const resolved = path.resolve(filePath);
  mkdirSync(path.dirname(resolved), { recursive: true });
  writeFileSync(resolved, markdown, "utf8");
  return resolved;
}

/** Final safety net: strip credential-shaped text from an AI result. */
export function sanitizeAiReview(review: AiReview): AiReview {
  return {
    ...review,
    ...(review.summary ? { summary: redactCredentialLike(review.summary) } : {}),
    ...(review.risks
      ? { risks: review.risks.map((risk) => redactCredentialLike(risk)) }
      : {}),
    ...(review.reason ? { reason: redactCredentialLike(review.reason) } : {}),
  };
}