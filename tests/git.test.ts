import assert from "node:assert/strict";
import { symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  collectDiff,
  GitError,
  isValidRef,
  listTrackedFiles,
  resolveCommit,
} from "../src/git.js";
import { createRepo, createTempDir } from "./helpers.js";

test("collects a diff between the base and working tree", () => {
  const repo = createRepo();
  repo.write("src/app.ts", "export const answer = 43;\n");
  repo.write("src/extra.ts", "export const extra = true;\n");

  const { diff, baseCommit } = collectDiff({ cwd: repo.dir, base: "main" });

  assert.match(baseCommit, /^[0-9a-f]{40}$/);
  assert.ok(diff.files.some((file) => file.path === "src/app.ts"));
  assert.ok(diff.files.some((file) => file.path === "src/extra.ts"));
  const app = diff.files.find((file) => file.path === "src/app.ts");
  assert.equal(app?.added, 1);
  assert.equal(app?.removed, 1);
});

test("returns an empty diff when nothing changed", () => {
  const repo = createRepo();
  const { diff } = collectDiff({ cwd: repo.dir, base: "main" });
  assert.equal(diff.files.length, 0);
});

test("includes untracked files by default", () => {
  const repo = createRepo();
  repo.write("src/untracked.ts", "export const untracked = true;\n");

  const { diff, skippedUntracked } = collectDiff({ cwd: repo.dir, base: "main" });
  const file = diff.files.find((entry) => entry.path === "src/untracked.ts");

  assert.ok(file);
  assert.equal(file.untracked, true);
  assert.equal(file.added, 1);
  assert.equal(skippedUntracked, 0);
});

test("excludes the configured report path", () => {
  const repo = createRepo();
  repo.write("shipcheck-report.md", "# previous report\n");
  repo.write("src/new.ts", "export const value = 1;\n");

  const { diff } = collectDiff({
    cwd: repo.dir,
    base: "main",
    excludePaths: ["shipcheck-report.md"],
  });

  assert.deepEqual(diff.files.map((file) => file.path), ["src/new.ts"]);
});

test("can exclude untracked files", () => {
  const repo = createRepo();
  repo.write("src/untracked.ts", "export const untracked = true;\n");

  const { diff } = collectDiff({
    cwd: repo.dir,
    base: "main",
    includeUntracked: false,
  });

  assert.equal(diff.files.length, 0);
});

test("skips large untracked files and counts them", () => {
  const repo = createRepo();
  repo.write("big.txt", "x".repeat(2048));

  const { diff, skippedUntracked, skippedUntrackedReasons } = collectDiff({
    cwd: repo.dir,
    base: "main",
    maxUntrackedBytes: 1024,
  });

  assert.equal(diff.files.length, 0);
  assert.equal(skippedUntracked, 1);
  assert.equal(skippedUntrackedReasons["too-large"], 1);
});

test(
  "skips an untracked symlink that points outside the repository",
  { skip: process.platform === "win32" ? "symlinks need extra privileges on Windows" : false },
  () => {
    const repo = createRepo();
    const outside = path.join(createTempDir(), "outside.ts");
    writeFileSync(outside, 'export const outside = "should not be read";\n');
    symlinkSync(outside, path.join(repo.dir, "linked.ts"));

    const { diff, skippedUntracked, skippedUntrackedReasons } = collectDiff({
      cwd: repo.dir,
      base: "main",
    });

    assert.equal(diff.files.some((file) => file.path === "linked.ts"), false);
    assert.equal(skippedUntracked, 1);
    assert.equal(skippedUntrackedReasons.symlink, 1);
  },
);

test(
  "skips an untracked symlink that points inside the repository",
  { skip: process.platform === "win32" ? "symlinks need extra privileges on Windows" : false },
  () => {
    const repo = createRepo();
    symlinkSync("src/app.ts", path.join(repo.dir, "alias.ts"));

    const { diff, skippedUntracked, skippedUntrackedReasons } = collectDiff({
      cwd: repo.dir,
      base: "main",
    });

    assert.equal(diff.files.some((file) => file.path === "alias.ts"), false);
    assert.equal(skippedUntracked, 1);
    assert.equal(skippedUntrackedReasons.symlink, 1);
  },
);

test(
  "does not follow a symlinked directory outside the repository",
  { skip: process.platform === "win32" ? "symlinks need extra privileges on Windows" : false },
  () => {
    const repo = createRepo();
    const outsideDir = createTempDir();
    writeFileSync(path.join(outsideDir, "secret.ts"), 'export const leak = 1;\n');
    symlinkSync(outsideDir, path.join(repo.dir, "linked-dir"));

    const { diff, skippedUntracked, skippedUntrackedReasons } = collectDiff({
      cwd: repo.dir,
      base: "main",
    });

    assert.equal(diff.files.some((file) => file.path.startsWith("linked-dir")), false);
    assert.equal(skippedUntracked, 1);
    assert.equal(skippedUntrackedReasons.symlink, 1);
  },
);

test("marks binary untracked files", () => {
  const repo = createRepo();
  writeFileSync(path.join(repo.dir, "image.bin"), Buffer.from([0, 1, 2, 3]));

  const { diff } = collectDiff({ cwd: repo.dir, base: "main" });
  const file = diff.files.find((entry) => entry.path === "image.bin");

  assert.ok(file);
  assert.equal(file.binary, true);
});

test("reports a missing base ref", () => {
  const repo = createRepo();

  assert.throws(
    () => collectDiff({ cwd: repo.dir, base: "does-not-exist" }),
    (error: unknown) =>
      error instanceof GitError &&
      error.kind === "invalid-base" &&
      /Base ref not found/.test(error.message),
  );
});

test("reports a directory that is not a git repository", () => {
  const dir = createTempDir("shipcheck-nogit-");
  assert.throws(
    () => collectDiff({ cwd: dir, base: "main" }),
    (error: unknown) => error instanceof GitError && error.kind === "not-a-repo",
  );
});

test("reports a missing directory", () => {
  assert.throws(
    () => collectDiff({ cwd: path.join(createTempDir(), "missing"), base: "main" }),
    (error: unknown) => error instanceof GitError && error.kind === "not-a-repo",
  );
});

test("rejects option-like and unsafe refs", () => {
  assert.equal(isValidRef("main"), true);
  assert.equal(isValidRef("origin/main"), true);
  assert.equal(isValidRef("HEAD~1"), true);
  assert.equal(isValidRef("v0.1.0"), true);
  assert.equal(isValidRef("--all"), false);
  assert.equal(isValidRef("main; rm -rf /"), false);
  assert.equal(isValidRef("main..other"), false);
  assert.equal(isValidRef(""), false);
  assert.equal(isValidRef("main branch"), false);

  const repo = createRepo();
  assert.throws(
    () => resolveCommit("main; touch pwned", repo.dir),
    (error: unknown) => error instanceof GitError && error.kind === "invalid-base",
  );
});

test("lists tracked files", () => {
  const repo = createRepo();
  const files = listTrackedFiles(repo.dir);
  assert.ok(files.includes("src/app.ts"));
  assert.ok(files.includes("README.md"));
});