import assert from "node:assert/strict";
import { test } from "node:test";

import { checkConflicts } from "../src/checks/conflicts.js";
import { makeDiff } from "./helpers.js";

test("detects a merge conflict block", () => {
  const findings = checkConflicts(
    makeDiff([
      {
        path: "src/app.ts",
        added: ["<<<<<<< HEAD", "const value = 1;", "=======", "const value = 2;", ">>>>>>> feature"],
      },
    ]),
  );

  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.severity, "blocking");
  assert.equal(findings[0]?.file, "src/app.ts");
  assert.match(findings[0]?.detail ?? "", /3 conflict marker/);
});

test("handles markers with branch labels", () => {
  const findings = checkConflicts(
    makeDiff([{ path: "src/app.ts", added: ["<<<<<<< feature/x", ">>>>>>> main"] }]),
  );

  assert.equal(findings.length, 1);
});

test("ignores a lone separator line", () => {
  const findings = checkConflicts(
    makeDiff([{ path: "docs.md", added: ["=======", "A heading"] }]),
  );

  assert.equal(findings.length, 0);
});

test("ignores conflict markers in removed lines", () => {
  const findings = checkConflicts(
    makeDiff([
      { path: "src/app.ts", removed: ["<<<<<<< HEAD", "=======", ">>>>>>> main"], added: [] },
    ]),
  );

  assert.equal(findings.length, 0);
});

test("does not scan binary files", () => {
  const findings = checkConflicts(
    makeDiff([{ path: "image.png", added: ["<<<<<<< HEAD"], binary: true }]),
  );

  assert.equal(findings.length, 0);
});

test("reports one finding per conflicted file", () => {
  const findings = checkConflicts(
    makeDiff([
      {
        path: "src/a.ts",
        added: ["<<<<<<< HEAD", "=======", ">>>>>>> main"],
      },
      {
        path: "src/b.ts",
        added: ["<<<<<<< HEAD", "=======", ">>>>>>> main"],
      },
    ]),
  );

  assert.equal(findings.length, 2);
});