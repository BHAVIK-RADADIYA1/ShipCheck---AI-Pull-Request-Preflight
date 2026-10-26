import assert from "node:assert/strict";
import { test } from "node:test";

import { checkSize, DEFAULT_SIZE_LIMITS } from "../src/checks/size.js";
import { makeDiff } from "./helpers.js";

function lines(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `const value${index} = ${index};`);
}

test("reports no size finding for a small diff", () => {
  const findings = checkSize(makeDiff([{ path: "src/app.ts", added: ["const a = 1;"] }]));
  assert.equal(findings.length, 0);
});

test("warns above the warning line threshold", () => {
  const findings = checkSize(
    makeDiff([{ path: "src/app.ts", added: lines(DEFAULT_SIZE_LIMITS.warnLines + 1) }]),
  );

  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.severity, "warning");
  assert.match(findings[0]?.title ?? "", /Large change/);
});

test("blocks above the blocking line threshold", () => {
  const findings = checkSize(
    makeDiff([{ path: "src/app.ts", added: lines(DEFAULT_SIZE_LIMITS.blockLines + 1) }]),
  );

  assert.ok(findings.some((finding) => finding.severity === "blocking"));
});

test("counts added and removed lines together", () => {
  const files = [
    { path: "a.ts", added: lines(300), removed: lines(300) },
  ];
  const findings = checkSize(makeDiff(files));
  assert.ok(findings.some((finding) => /600 lines/.test(finding.title)));
});

test("warns above the file warning threshold", () => {
  const specs = Array.from({ length: DEFAULT_SIZE_LIMITS.warnFiles + 1 }, (_, index) => ({
    path: `src/file${index}.ts`,
    added: ["const x = 1;"],
  }));

  const findings = checkSize(makeDiff(specs));
  assert.ok(findings.some((finding) => /files/.test(finding.title) && finding.severity === "warning"));
});

test("supports custom limits", () => {
  const findings = checkSize(makeDiff([{ path: "src/app.ts", added: lines(5) }]), {
    warnLines: 2,
    blockLines: 10,
    warnFiles: 5,
    blockFiles: 10,
  });

  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.severity, "warning");
});

test("reports binary files as info", () => {
  const findings = checkSize(
    makeDiff([{ path: "assets/logo.png", added: [], binary: true }]),
  );

  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.severity, "info");
  assert.match(findings[0]?.title ?? "", /Binary files/);
});

test("reports an empty diff as info", () => {
  const findings = checkSize(makeDiff([]));
  assert.equal(findings.length, 1);
  assert.match(findings[0]?.title ?? "", /No changes/);
});

test("does not count minified files toward the file threshold", () => {
  const specs = Array.from({ length: 25 }, (_, index) => ({
    path: `public/bundle${index}.min.js`,
    added: ["var a=1;"],
  }));

  const findings = checkSize(makeDiff(specs));
  assert.ok(!findings.some((finding) => /25 files/.test(finding.title)));
});