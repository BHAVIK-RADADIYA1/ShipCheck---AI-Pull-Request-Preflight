import { execFile, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { parseDiff } from "../src/diff.js";
import type { FileStatus, ParsedDiff } from "../src/types.js";

export interface DiffSpec {
  path: string;
  added?: string[];
  removed?: string[];
  status?: FileStatus;
  binary?: boolean;
}

/** Build a realistic unified diff and parse it, so checks are tested end to end. */
export function makeDiff(specs: DiffSpec[]): ParsedDiff {
  const chunks: string[] = [];

  for (const spec of specs) {
    const added = spec.added ?? [];
    const removed = spec.removed ?? [];
    const status = spec.status ?? "modified";

    chunks.push(`diff --git a/${spec.path} b/${spec.path}`);
    if (status === "added") chunks.push("new file mode 100644");
    if (status === "deleted") chunks.push("deleted file mode 100644");
    chunks.push(`--- ${status === "added" ? "/dev/null" : `a/${spec.path}`}`);
    chunks.push(`+++ ${status === "deleted" ? "/dev/null" : `b/${spec.path}`}`);

    if (spec.binary) {
      chunks.push(`Binary files a/${spec.path} and b/${spec.path} differ`);
      continue;
    }

    chunks.push(`@@ -1,${removed.length} +1,${added.length} @@`);
    for (const line of removed) chunks.push(`-${line}`);
    for (const line of added) chunks.push(`+${line}`);
  }

  return parseDiff(chunks.join("\n"));
}

export interface TempRepo {
  dir: string;
  git: (args: string[]) => void;
  commit: (message: string) => void;
  write: (relativePath: string, content: string) => void;
}

export function createTempDir(prefix = "shipcheck-test-"): string {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function createRepo(): TempRepo {
  const dir = createTempDir("shipcheck-repo-");

  const git = (args: string[]): void => {
    const result = spawnSync("git", args, {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    if (result.status !== 0) {
      throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
    }
  };

  const write = (relativePath: string, content: string): void => {
    const target = path.join(dir, relativePath);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content, "utf8");
  };

  git(["init", "-q", "-b", "main"]);
  git(["config", "user.name", "ShipCheck Tests"]);
  git(["config", "user.email", "tests@example.invalid"]);
  write("README.md", "# Fixture\n");
  write("src/app.ts", "export const answer = 42;\n");
  git(["add", "-A"]);
  git(["commit", "-q", "-m", "initial"]);

  const commit = (message: string): void => {
    git(["add", "-A"]);
    git(["commit", "-q", "-m", message]);
  };

  return { dir, git, commit, write };
}

export interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

export function runCli(
  args: string[],
  cwd: string,
  extraEnv: NodeJS.ProcessEnv = {},
): CliResult {
  const cliPath = fileURLToPath(new URL("../src/cli.js", import.meta.url));
  const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: "1", ...extraEnv };
  if (!extraEnv.SHIPCHECK_AI_BASE_URL) {
    delete env.SHIPCHECK_AI_BASE_URL;
    delete env.SHIPCHECK_AI_MODEL;
    delete env.SHIPCHECK_AI_API_KEY;
  }

  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: "utf8",
    env,
  });

  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}
const execFileAsync = promisify(execFile);

/**
 * Async variant for tests that host an in-process mock server: spawnSync would
 * block the event loop the server needs to answer.
 */
export async function runCliAsync(
  args: string[],
  cwd: string,
  extraEnv: NodeJS.ProcessEnv = {},
): Promise<CliResult> {
  const cliPath = fileURLToPath(new URL("../src/cli.js", import.meta.url));
  const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: "1", ...extraEnv };

  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [cliPath, ...args], {
      cwd,
      env,
      timeout: 60_000,
    });
    return { status: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return {
      status: typeof failure.code === "number" ? failure.code : 1,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
    };
  }
}
