import assert from "node:assert/strict";
import { test } from "node:test";

import { checkDebug } from "../src/checks/debug.js";
import { FAKE_AWS_KEY } from "./fixtures/fake-credentials.js";
import { makeDiff } from "./helpers.js";

test("flags console.log", () => {
  const findings = checkDebug(
    makeDiff([{ path: "src/app.ts", added: ['console.log("debug");'] }]),
  );

  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.severity, "warning");
  assert.match(findings[0]?.title ?? "", /Debug logging/);
});

test("flags console.debug and console.trace", () => {
  const findings = checkDebug(
    makeDiff([
      { path: "src/app.ts", added: ["console.debug(x);", "console.trace();"] },
    ]),
  );

  assert.equal(findings.length, 2);
});

test("flags a debugger statement", () => {
  const findings = checkDebug(makeDiff([{ path: "src/app.ts", added: ["  debugger;"] }]));

  assert.equal(findings.length, 1);
  assert.match(findings[0]?.title ?? "", /debugger/);
});

test("flags TODO and FIXME markers", () => {
  const findings = checkDebug(
    makeDiff([
      { path: "src/app.ts", added: ["// TODO: handle retries", "// FIXME broken when empty"] },
    ]),
  );

  assert.equal(findings.length, 2);
  assert.ok(findings.some((finding) => /TODO/.test(finding.title)));
  assert.ok(findings.some((finding) => /FIXME/.test(finding.title)));
});

test("ignores console.log inside a comment", () => {
  const findings = checkDebug(
    makeDiff([{ path: "src/app.ts", added: ["// console.log(value) for debugging"] }]),
  );

  assert.equal(findings.length, 0);
});

test("ignores a bare mention of console.log without a call", () => {
  const findings = checkDebug(
    makeDiff([{ path: "src/app.ts", added: ["The console.log output is noisy."] }]),
  );

  assert.equal(findings.length, 0);
});

test("skips documentation files", () => {
  const findings = checkDebug(
    makeDiff([{ path: "README.md", added: ["console.log('x');", "TODO: write docs"] }]),
  );

  assert.equal(findings.length, 0);
});

test("honours shipcheck:ignore", () => {
  const findings = checkDebug(
    makeDiff([{ path: "src/app.ts", added: ["console.log(x); // shipcheck:ignore"] }]),
  );

  assert.equal(findings.length, 0);
});

test("redacts credential-shaped text in the detail", () => {
  const secret = FAKE_AWS_KEY;
  const findings = checkDebug(
    makeDiff([{ path: "src/app.ts", added: [`console.log("${secret}");`] }]),
  );

  assert.equal(findings.length, 1);
  assert.doesNotMatch(JSON.stringify(findings), new RegExp(secret));
});

test("does not scan removed lines", () => {
  const findings = checkDebug(
    makeDiff([{ path: "src/app.ts", removed: ["console.log(old);"], added: [] }]),
  );

  assert.equal(findings.length, 0);
});