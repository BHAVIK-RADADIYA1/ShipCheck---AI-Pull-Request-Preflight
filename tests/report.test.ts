import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildReport,
  isBlocking,
  renderMarkdown,
  renderTerminal,
  sanitizeAiReview,
  sortFindings,
  statusLabel,
} from "../src/report.js";
import type { Finding } from "../src/types.js";
import {
  FAKE_AWS_KEY,
  FAKE_GENERIC_SECRET,
  FAKE_GITHUB_TOKEN,
} from "./fixtures/fake-credentials.js";
import { makeDiff } from "./helpers.js";

function reportFor(findings: Finding[], added = ["const value = 1;"]) {
  return buildReport({
    version: "0.1.0",
    base: "main",
    diff: makeDiff([{ path: "src/app.ts", added }]),
    findings,
    now: new Date("2026-01-01T00:00:00.000Z"),
  });
}

test("computes totals from the diff", () => {
  const report = reportFor([], ["one", "two", "three"]);

  assert.equal(report.totals.files, 1);
  assert.equal(report.totals.added, 3);
  assert.equal(report.totals.removed, 0);
  assert.equal(report.totals.changedLines, 3);
});

test("counts findings by severity", () => {
  const report = reportFor([
    { check: "x", severity: "blocking", title: "a" },
    { check: "x", severity: "warning", title: "b" },
    { check: "x", severity: "warning", title: "c" },
    { check: "x", severity: "info", title: "d" },
  ]);

  assert.equal(report.blocking, 1);
  assert.equal(report.warnings, 2);
  assert.equal(report.infos, 1);
});

test("status reflects the highest severity", () => {
  assert.equal(statusLabel(reportFor([{ check: "x", severity: "blocking", title: "a" }])), "Not ready for review");
  assert.equal(statusLabel(reportFor([{ check: "x", severity: "warning", title: "a" }])), "Ready for review, with warnings");
  assert.equal(statusLabel(reportFor([])), "Ready for review");
});

test("sorts findings by severity then location", () => {
  const sorted = sortFindings([
    { check: "x", severity: "info", title: "i" },
    { check: "x", severity: "warning", title: "w", file: "b.ts", line: 2 },
    { check: "x", severity: "blocking", title: "b" },
    { check: "x", severity: "warning", title: "w", file: "a.ts", line: 9 },
  ]);

  assert.deepEqual(
    sorted.map((finding) => finding.title),
    ["b", "w", "w", "i"],
  );
});

test("isBlocking respects strict mode", () => {
  const report = reportFor([{ check: "x", severity: "warning", title: "w" }]);
  assert.equal(isBlocking(report), false);
  assert.equal(isBlocking(report, true), true);
});

test("markdown contains the summary, findings, and files", () => {
  const report = reportFor([
    {
      check: "secrets",
      severity: "blocking",
      title: "Possible secret: AWS access key ID",
      file: "src/app.ts",
      line: 4,
      detail: "The matched value is withheld from this report.",
    },
  ]);

  const markdown = renderMarkdown(report);
  assert.match(markdown, /# ShipCheck report/);
  assert.match(markdown, /Not ready for review/);
  assert.match(markdown, /Possible secret: AWS access key ID/);
  assert.match(markdown, /src\/app\.ts:4/);
  assert.match(markdown, /## Changed files/);
  assert.match(markdown, /## Limitations/);
});

test("markdown renders an empty diff clearly", () => {
  const report = buildReport({
    version: "0.1.0",
    base: "main",
    diff: makeDiff([]),
    findings: [],
  });

  const markdown = renderMarkdown(report);
  assert.match(markdown, /Nothing to review/);
  assert.match(markdown, /No changed files/);
});

test("terminal output is plain by default", () => {
  const report = reportFor([{ check: "x", severity: "blocking", title: "Problem" }]);
  const text = renderTerminal(report, { color: false });

  assert.match(text, /ShipCheck 0\.1\.0/);
  assert.match(text, /Problem/);
  assert.match(text, /not ready for review/);
  assert.doesNotMatch(text, /\u001b\[/);
});

test("terminal output uses color when enabled", () => {
  const report = reportFor([{ check: "x", severity: "blocking", title: "Problem" }]);
  const text = renderTerminal(report, { color: true });
  assert.match(text, /\u001b\[/);
});

test("terminal output reports no changes", () => {
  const report = buildReport({
    version: "0.1.0",
    base: "main",
    diff: makeDiff([]),
    findings: [],
  });

  assert.match(renderTerminal(report), /No changes relative to the base/);
});

test("AI review appears in markdown and is skipped clearly", () => {
  const report = buildReport({
    version: "0.1.0",
    base: "main",
    diff: makeDiff([{ path: "src/app.ts", added: ["const x = 1;"] }]),
    findings: [],
    ai: { status: "skipped", reason: "AI review is not configured" },
  });

  assert.match(renderMarkdown(report), /AI review skipped/);
});

test("sanitizeAiReview redacts credentials echoed by a model", () => {
  const sanitized = sanitizeAiReview({
    status: "completed",
    model: "test-model",
    summary: `Found ${FAKE_AWS_KEY} in the diff.`,
    risks: [`token ${FAKE_GITHUB_TOKEN} is exposed`],
    reason: `password = "${FAKE_GENERIC_SECRET}"`,
  });

  const serialized = JSON.stringify(sanitized);
  assert.equal(serialized.includes(FAKE_AWS_KEY), false);
  assert.equal(serialized.includes(FAKE_GITHUB_TOKEN), false);
  assert.equal(serialized.includes(FAKE_GENERIC_SECRET), false);
});

test("markdown escapes pipes in file names", () => {
  const report = buildReport({
    version: "0.1.0",
    base: "main",
    diff: makeDiff([{ path: "docs/a|b.md", added: ["text"] }]),
    findings: [{ check: "x", severity: "warning", title: "Odd name", file: "docs/a|b.md", line: 1 }],
  });

  assert.match(renderMarkdown(report), /docs\/a\\\|b\.md/);
});