import assert from "node:assert/strict";
import { test } from "node:test";

import {
  checkMissingTests,
  isSourceFile,
  isTestPath,
} from "../src/checks/tests.js";
import { makeDiff } from "./helpers.js";

test("source detection recognises code files", () => {
  assert.equal(isSourceFile("src/app.ts", "modified"), true);
  assert.equal(isSourceFile("lib/worker.py", "added"), true);
  assert.equal(isSourceFile("README.md", "modified"), false);
  assert.equal(isSourceFile("src/app.test.ts", "modified"), false);
  assert.equal(isSourceFile("src/app.ts", "deleted"), false);
  assert.equal(isSourceFile("vite.config.ts", "modified"), false);
  assert.equal(isSourceFile("dist/bundle.js", "modified"), false);
  assert.equal(isSourceFile("types/index.d.ts", "modified"), false);
});

test("test path detection covers common layouts", () => {
  assert.equal(isTestPath("src/app.test.ts"), true);
  assert.equal(isTestPath("src/app.spec.ts"), true);
  assert.equal(isTestPath("tests/app.ts"), true);
  assert.equal(isTestPath("test/app_test.py"), true);
  assert.equal(isTestPath("__tests__/app.tsx"), true);
  assert.equal(isTestPath("src/app.ts"), false);
});

test("warns when a changed source file has no matching test", () => {
  const findings = checkMissingTests(
    makeDiff([{ path: "src/billing.ts", added: ["export const rate = 1;"] }]),
    [],
  );

  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.severity, "warning");
  assert.match(findings[0]?.title ?? "", /No matching test file/);
  assert.match(findings[0]?.detail ?? "", /Heuristic/);
});

test("does not warn when a matching test exists", () => {
  const findings = checkMissingTests(
    makeDiff([{ path: "src/billing.ts", added: ["export const rate = 1;"] }]),
    ["tests/billing.test.ts"],
  );

  assert.equal(findings.length, 0);
});

test("matches a test file that was itself added in the change", () => {
  const findings = checkMissingTests(
    makeDiff([
      { path: "src/billing.ts", added: ["export const rate = 1;"], status: "modified" },
      { path: "src/billing.test.ts", added: ["test('rate', () => {});"], status: "added" },
    ]),
    [],
  );

  assert.equal(findings.length, 0);
});

test("matches nested test directories", () => {
  const findings = checkMissingTests(
    makeDiff([{ path: "src/services/user.ts", added: ["export const user = 1;"] }]),
    ["src/services/__tests__/user.ts"],
  );

  assert.equal(findings.length, 0);
});

test("ignores deleted source files", () => {
  const findings = checkMissingTests(
    makeDiff([{ path: "src/legacy.ts", removed: ["export const old = 1;"], status: "deleted" }]),
    [],
  );

  assert.equal(findings.length, 0);
});

test("ignores documentation and config files", () => {
  const findings = checkMissingTests(
    makeDiff([
      { path: "README.md", added: ["docs"] },
      { path: "tsconfig.json", added: ["{}"] },
      { path: "vitest.config.ts", added: ["export default {};"] },
    ]),
    [],
  );

  assert.equal(findings.length, 0);
});

test("caps detailed findings and adds an aggregate warning", () => {
  const specs = Array.from({ length: 8 }, (_, index) => ({
    path: `src/module${index}.ts`,
    added: ["export const x = 1;"],
  }));

  const findings = checkMissingTests(makeDiff(specs), [], { maxReported: 5 });
  assert.equal(findings.length, 6);
  assert.match(findings[5]?.title ?? "", /3 more source files/);
});

test("does not match unrelated filenames with short tokens", () => {
  const findings = checkMissingTests(
    makeDiff([{ path: "src/a.ts", added: ["export const a = 1;"] }]),
    ["tests/b.test.ts"],
  );

  assert.equal(findings.length, 1);
});