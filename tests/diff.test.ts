import assert from "node:assert/strict";
import { test } from "node:test";

import { buildUntrackedFile, countChangedLines, parseDiff } from "../src/diff.js";

const MODIFIED = `diff --git a/src/app.ts b/src/app.ts
index 1111111..2222222 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,3 +1,4 @@
 context one
-const oldValue = 1;
+const value = 2;
+console.log(value);
 context two
`;

test("parses a modified file with line numbers", () => {
  const diff = parseDiff(MODIFIED);
  assert.equal(diff.files.length, 1);

  const file = diff.files[0];
  assert.ok(file);
  assert.equal(file.path, "src/app.ts");
  assert.equal(file.status, "modified");
  assert.equal(file.added, 2);
  assert.equal(file.removed, 1);
  assert.deepEqual(
    file.lines.map((line) => [line.kind, line.content, line.newLine ?? null]),
    [
      ["context", "context one", 1],
      ["del", "const oldValue = 1;", null],
      ["add", "const value = 2;", 2],
      ["add", "console.log(value);", 3],
      ["context", "context two", 4],
    ],
  );
});

test("parses an added file from /dev/null", () => {
  const diff = parseDiff(`diff --git a/src/new.ts b/src/new.ts
new file mode 100644
index 0000000..1111111
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,2 @@
+line one
+line two
`);

  const file = diff.files[0];
  assert.ok(file);
  assert.equal(file.status, "added");
  assert.equal(file.path, "src/new.ts");
  assert.equal(file.added, 2);
});

test("parses a deleted file", () => {
  const diff = parseDiff(`diff --git a/old.ts b/old.ts
deleted file mode 100644
index 1111111..0000000
--- a/old.ts
+++ /dev/null
@@ -1,1 +0,0 @@
-removed line
`);

  const file = diff.files[0];
  assert.ok(file);
  assert.equal(file.status, "deleted");
  assert.equal(file.added, 0);
  assert.equal(file.removed, 1);
});

test("parses a rename", () => {
  const diff = parseDiff(`diff --git a/old/name.ts b/new/name.ts
similarity index 90%
rename from old/name.ts
rename to new/name.ts
--- a/old/name.ts
+++ b/new/name.ts
@@ -1,1 +1,1 @@
-old
+new
`);

  const file = diff.files[0];
  assert.ok(file);
  assert.equal(file.status, "renamed");
  assert.equal(file.oldPath, "old/name.ts");
  assert.equal(file.path, "new/name.ts");
});

test("marks binary diffs", () => {
  const diff = parseDiff(`diff --git a/logo.png b/logo.png
new file mode 100644
index 0000000..1111111
Binary files /dev/null and b/logo.png differ
`);

  const file = diff.files[0];
  assert.ok(file);
  assert.equal(file.binary, true);
  assert.equal(file.added, 0);
});

test("parses quoted paths containing spaces", () => {
  const diff = parseDiff(`diff --git "a/docs/with space.md" "b/docs/with space.md"
--- "a/docs/with space.md"
+++ "b/docs/with space.md"
@@ -1,1 +1,1 @@
-old
+new
`);

  const file = diff.files[0];
  assert.ok(file);
  assert.equal(file.path, "docs/with space.md");
});

test("ignores the no-newline marker and stray empty lines", () => {
  const diff = parseDiff(`diff --git a/a.txt b/a.txt
--- a/a.txt
+++ b/a.txt
@@ -1,1 +1,1 @@
-old
+new
\\ No newline at end of file
`);

  const file = diff.files[0];
  assert.ok(file);
  assert.equal(file.added, 1);
  assert.equal(file.removed, 1);
  assert.deepEqual(file.lines.map((line) => line.content), ["old", "new"]);
});

test("returns no files for empty input", () => {
  const diff = parseDiff("");
  assert.equal(diff.files.length, 0);
});

test("builds an untracked file entry", () => {
  const file = buildUntrackedFile("notes.txt", "one\ntwo\n");
  assert.equal(file.path, "notes.txt");
  assert.equal(file.status, "added");
  assert.equal(file.untracked, true);
  assert.equal(file.added, 2);
  assert.deepEqual(file.lines.map((line) => line.newLine), [1, 2]);
});

test("counts changed lines across files", () => {
  const diff = parseDiff(MODIFIED);
  assert.equal(countChangedLines(diff.files), 3);
});