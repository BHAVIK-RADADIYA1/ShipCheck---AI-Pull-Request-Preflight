import assert from "node:assert/strict";
import { test } from "node:test";

import { runDeterministicChecks } from "../src/checks/index.js";
import { makeDiff } from "./helpers.js";

function findingsWithSkips(
  skippedUntracked: number,
  skippedUntrackedReasons?: Record<string, number>,
) {
  const diff = makeDiff([{ path: "src/app.ts", added: ["export const value = 1;"] }]);
  return runDeterministicChecks(diff, {
    skippedUntracked,
    ...(skippedUntrackedReasons ? { skippedUntrackedReasons } : {}),
  }).filter((finding) => finding.check === "untracked");
}

test("reports skipped symlinks accurately", () => {
  const findings = findingsWithSkips(2, { symlink: 2 });
  assert.equal(findings.length, 1);

  const finding = findings[0];
  assert.ok(finding);
  assert.equal(finding.severity, "info");
  assert.match(finding.title ?? "", /2 untracked file\(s\) not scanned/);
  assert.match(finding.detail ?? "", /2 symlink\(s\), not followed/);
  assert.doesNotMatch(finding.detail ?? "", /binary/);
});

test("uses an accurate generic message when no reasons are known", () => {
  const findings = findingsWithSkips(3);
  assert.equal(findings.length, 1);

  const detail = findings[0]?.detail ?? "";
  assert.match(detail, /symlinks are not followed/);
  assert.match(detail, /unreadable/);
  assert.match(detail, /512 KB/);
  assert.doesNotMatch(detail, /binary/);
});

test("lists every skip reason that occurred", () => {
  const findings = findingsWithSkips(4, {
    symlink: 1,
    outside: 1,
    "too-large": 1,
    unreadable: 1,
  });

  const detail = findings[0]?.detail ?? "";
  assert.match(detail, /1 symlink\(s\), not followed/);
  assert.match(detail, /1 outside the repository/);
  assert.match(detail, /1 larger than 512 KB/);
  assert.match(detail, /1 unreadable/);
});

test("does not add a skip finding when nothing was skipped", () => {
  assert.equal(findingsWithSkips(0).length, 0);
});

test("reports skipped files even when every change was skipped", () => {
  const findings = runDeterministicChecks(makeDiff([]), {
    skippedUntracked: 1,
    skippedUntrackedReasons: { symlink: 1 },
  });

  assert.ok(findings.some((finding) => finding.check === "untracked"));
  assert.ok(findings.some((finding) => finding.check === "size"));
});
