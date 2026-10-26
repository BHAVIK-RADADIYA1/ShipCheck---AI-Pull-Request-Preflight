import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import path from "node:path";

import { buildUntrackedFile, parseDiff } from "./diff.js";
import type { DiffFile, ParsedDiff } from "./types.js";

export type GitFailureKind =
  | "not-a-repo"
  | "invalid-base"
  | "git-unavailable"
  | "git-failed";

export class GitError extends Error {
  readonly kind: GitFailureKind;
  readonly hint: string;

  constructor(kind: GitFailureKind, message: string, hint = "") {
    super(message);
    this.name = "GitError";
    this.kind = kind;
    this.hint = hint;
  }
}

export interface GitOutcome {
  code: number;
  stdout: string;
  stderr: string;
}

const GIT_TIMEOUT_MS = 30_000;
const MAX_BUFFER = 64 * 1024 * 1024;
const DEFAULT_MAX_UNTRACKED_BYTES = 512 * 1024;

/**
 * Run git with a fixed argument vector and no shell. Reviewed code is never
 * executed; only the commands constructed here run.
 */
export function runGit(args: string[], cwd: string): GitOutcome {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    shell: false,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: MAX_BUFFER,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" },
  });

  if (result.error) {
    const code = (result.error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new GitError(
        "git-unavailable",
        "Could not run git.",
        "Install git and make sure it is on PATH.",
      );
    }
    throw new GitError("git-failed", `git ${args[0] ?? ""} failed: ${result.error.message}`);
  }

  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

export function isValidRef(ref: string): boolean {
  if (ref.length === 0 || ref.length > 200) return false;
  if (!/^[A-Za-z0-9][A-Za-z0-9._/@{}~^:-]*$/.test(ref)) return false;
  if (ref.includes("..") || ref.includes("//") || ref.includes("@{")) return false;
  return true;
}

function ensureRepository(cwd: string): void {
  if (!existsSync(cwd)) {
    throw new GitError("not-a-repo", `Directory does not exist: ${cwd}`);
  }

  const inside = runGit(["rev-parse", "--is-inside-work-tree"], cwd);
  if (inside.code !== 0 || inside.stdout.trim() !== "true") {
    throw new GitError(
      "not-a-repo",
      `Not a git working tree: ${cwd}`,
      "Run shipcheck from inside a git repository, or pass --cwd.",
    );
  }
}

export function resolveCommit(ref: string, cwd: string): string {
  if (!isValidRef(ref)) {
    throw new GitError(
      "invalid-base",
      `Invalid base ref: ${JSON.stringify(ref)}`,
      "Use a branch, tag, or commit name such as main or origin/main.",
    );
  }

  const result = runGit(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], cwd);
  if (result.code !== 0 || result.stdout.trim() === "") {
    throw new GitError(
      "invalid-base",
      `Base ref not found: ${ref}`,
      `Check the branch name, or fetch it first (for example: git fetch origin ${ref}).`,
    );
  }

  return result.stdout.trim();
}

export function listTrackedFiles(cwd: string): string[] {
  const result = runGit(["ls-files", "-z"], cwd);
  if (result.code !== 0) {
    throw new GitError("git-failed", `git ls-files failed: ${result.stderr.trim()}`);
  }
  return result.stdout.split("\0").filter((entry) => entry !== "");
}

function listUntrackedFiles(cwd: string): string[] {
  const result = runGit(["ls-files", "--others", "--exclude-standard", "-z"], cwd);
  if (result.code !== 0) {
    throw new GitError("git-failed", `git ls-files failed: ${result.stderr.trim()}`);
  }
  return result.stdout.split("\0").filter((entry) => entry !== "");
}

export function isProbablyBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, 8000);
  return sample.includes(0);
}

export type UntrackedSkipReason = "symlink" | "outside" | "too-large" | "unreadable";

export type UntrackedSkipCounts = Partial<Record<UntrackedSkipReason, number>>;

interface UntrackedReadResult {
  file: DiffFile | null;
  skip?: UntrackedSkipReason;
}

function readUntrackedFile(
  cwd: string,
  relativePath: string,
  maxBytes: number,
): UntrackedReadResult {
  const absolute = path.resolve(cwd, relativePath);
  const root = path.resolve(cwd) + path.sep;
  if (!absolute.startsWith(root)) return { file: null, skip: "outside" };

  // Use lstat so a symlink is never followed. Git repositories can contain
  // symlinks to arbitrary targets, including files outside the work tree.
  let info;
  try {
    info = lstatSync(absolute);
  } catch {
    return { file: null, skip: "unreadable" };
  }

  if (info.isSymbolicLink()) return { file: null, skip: "symlink" };
  if (!info.isFile()) return { file: null, skip: "unreadable" };
  if (info.size > maxBytes) return { file: null, skip: "too-large" };

  let buffer: Buffer;
  try {
    buffer = readFileSync(absolute);
  } catch {
    return { file: null, skip: "unreadable" };
  }

  if (isProbablyBinary(buffer)) {
    return {
      file: {
        path: relativePath,
        status: "added",
        binary: true,
        untracked: true,
        lines: [],
        added: 0,
        removed: 0,
      },
    };
  }

  return { file: buildUntrackedFile(relativePath, buffer.toString("utf8")) };
}

export interface CollectDiffOptions {
  cwd: string;
  base: string;
  includeUntracked?: boolean;
  maxUntrackedBytes?: number;
  /** Repository-relative or absolute paths to omit (for example the report file). */
  excludePaths?: string[];
}

export interface CollectedDiff {
  diff: ParsedDiff;
  baseCommit: string;
  skippedUntracked: number;
  skippedUntrackedReasons: UntrackedSkipCounts;
}

function normalizeRepoPath(cwd: string, value: string): string {
  const absolute = path.isAbsolute(value) ? value : path.resolve(cwd, value);
  return path.relative(cwd, absolute).split(path.sep).join("/");
}

/**
 * Collect the diff between `base` and the current working tree, including
 * untracked text files (which plain `git diff` omits).
 */
export function collectDiff(options: CollectDiffOptions): CollectedDiff {
  const cwd = path.resolve(options.cwd);
  ensureRepository(cwd);
  const baseCommit = resolveCommit(options.base, cwd);
  const excluded = new Set((options.excludePaths ?? []).map((value) => normalizeRepoPath(cwd, value)));

  const result = runGit(
    [
      "diff",
      "--no-color",
      "--no-ext-diff",
      "--no-textconv",
      "--unified=3",
      "--find-renames",
      baseCommit,
      "--",
    ],
    cwd,
  );

  if (result.code !== 0) {
    throw new GitError("git-failed", `git diff failed: ${result.stderr.trim() || "unknown error"}`);
  }

  const diff = parseDiff(result.stdout);
  if (excluded.size > 0) {
    diff.files = diff.files.filter((file) => !excluded.has(normalizeRepoPath(cwd, file.path)));
  }

  let skippedUntracked = 0;
  const skippedUntrackedReasons: UntrackedSkipCounts = {};
  if (options.includeUntracked !== false) {
    const maxBytes = options.maxUntrackedBytes ?? DEFAULT_MAX_UNTRACKED_BYTES;
    for (const relativePath of listUntrackedFiles(cwd)) {
      if (excluded.has(normalizeRepoPath(cwd, relativePath))) continue;
      const read = readUntrackedFile(cwd, relativePath, maxBytes);
      if (read.file) {
        diff.files.push(read.file);
      } else if (read.skip) {
        skippedUntracked += 1;
        skippedUntrackedReasons[read.skip] = (skippedUntrackedReasons[read.skip] ?? 0) + 1;
      }
    }
  }

  return { diff, baseCommit, skippedUntracked, skippedUntrackedReasons };
}