#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { readAiConfig, reviewWithAi, type FetchLike } from "./ai.js";
import { runDeterministicChecks } from "./checks/index.js";
import { collectDiff, GitError, listTrackedFiles } from "./git.js";
import {
  buildReport,
  isBlocking,
  renderMarkdown,
  renderTerminal,
  sanitizeAiReview,
  statusLabel,
  writeReportFile,
} from "./report.js";
import type { Report } from "./types.js";

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

export interface CliDeps {
  collectDiff?: typeof collectDiff;
  listTrackedFiles?: typeof listTrackedFiles;
  reviewWithAi?: typeof reviewWithAi;
  fetchImpl?: FetchLike;
  env?: NodeJS.ProcessEnv;
  now?: Date;
  color?: boolean;
}

interface ReviewOptions {
  base: string;
  output: string;
  json: boolean;
  strict: boolean;
  ai: boolean;
  includeUntracked: boolean;
  cwd: string;
}

type ParseResult =
  | { kind: "help" }
  | { kind: "version" }
  | { kind: "run"; options: ReviewOptions }
  | { kind: "error"; message: string };

const USAGE = `ShipCheck — is this change ready for review?

Usage:
  shipcheck review [options]

Options:
  --base <ref>       Base branch, tag, or commit to diff against (default: main)
  --output <path>    Markdown report path (default: shipcheck-report.md)
  --json             Print the report as JSON instead of text
  --strict           Treat warnings as blocking (exit 1)
  --no-untracked     Do not scan untracked files
  --ai               Run the optional AI review (requires SHIPCHECK_AI_* env vars)
  --cwd <path>       Repository to review (default: current directory)
  --help, -h         Show this help
  --version, -v      Show the version

Exit codes:
  0  No blocking findings
  1  Blocking findings detected
  2  Invalid usage or execution error

Optional AI review:
  ${"SHIPCHECK_AI_BASE_URL"}   OpenAI-compatible API base URL
  ${"SHIPCHECK_AI_MODEL"}      Model name
  ${"SHIPCHECK_AI_API_KEY"}    API key (never printed or written to a report)

  The AI review is off by default. The default run needs no credentials and
  makes no network calls.`;

function readVersion(): string {
  try {
    const raw = readFileSync(new URL("../../package.json", import.meta.url), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null) {
      const version = (parsed as { version?: unknown }).version;
      if (typeof version === "string" && version.trim() !== "") return version;
    }
  } catch {
    // Package metadata is optional for a local checkout.
  }
  return "0.0.0";
}

function parseReviewArgs(argv: string[]): ParseResult {
  const options: ReviewOptions = {
    base: "main",
    output: "shipcheck-report.md",
    json: false,
    strict: false,
    ai: false,
    includeUntracked: true,
    cwd: process.cwd(),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";

    if (arg === "--help" || arg === "-h") return { kind: "help" };
    if (arg === "--version" || arg === "-v") return { kind: "version" };
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--strict") {
      options.strict = true;
      continue;
    }
    if (arg === "--ai") {
      options.ai = true;
      continue;
    }
    if (arg === "--no-untracked") {
      options.includeUntracked = false;
      continue;
    }

    if (arg === "--base" || arg === "--output" || arg === "--cwd") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        return { kind: "error", message: `${arg} requires a value` };
      }
      index += 1;
      if (arg === "--base") options.base = value;
      else if (arg === "--output") options.output = value;
      else options.cwd = value;
      continue;
    }

    if (arg.startsWith("--base=")) {
      options.base = arg.slice("--base=".length);
      continue;
    }
    if (arg.startsWith("--output=")) {
      options.output = arg.slice("--output=".length);
      continue;
    }
    if (arg.startsWith("--cwd=")) {
      options.cwd = arg.slice("--cwd=".length);
      continue;
    }

    return { kind: "error", message: `Unknown option: ${arg}` };
  }

  if (options.base.trim() === "") {
    return { kind: "error", message: "--base requires a non-empty ref" };
  }
  if (options.output.trim() === "") {
    return { kind: "error", message: "--output requires a non-empty path" };
  }

  return { kind: "run", options };
}

function publicReport(report: Report, reportPath: string): Record<string, unknown> {
  return {
    ...report,
    files: report.files.map((file) => ({
      path: file.path,
      oldPath: file.oldPath,
      status: file.status,
      binary: file.binary,
      untracked: file.untracked,
      added: file.added,
      removed: file.removed,
    })),
    reportPath,
  };
}

export async function main(
  argv: string[],
  io: CliIo = {
    stdout: (text) => process.stdout.write(`${text}\n`),
    stderr: (text) => process.stderr.write(`${text}\n`),
  },
  deps: CliDeps = {},
): Promise<number> {
  const version = readVersion();

  if (argv.length === 0) {
    io.stderr(`${USAGE}\n\nshipcheck: missing command`);
    return 2;
  }

  if (argv[0] === "--help" || argv[0] === "-h") {
    io.stdout(USAGE);
    return 0;
  }
  if (argv[0] === "--version" || argv[0] === "-v") {
    io.stdout(version);
    return 0;
  }
  if (argv[0] !== "review") {
    io.stderr(`${USAGE}\n\nshipcheck: unknown command: ${argv[0]}`);
    return 2;
  }

  const parsed = parseReviewArgs(argv.slice(1));
  if (parsed.kind === "help") {
    io.stdout(USAGE);
    return 0;
  }
  if (parsed.kind === "version") {
    io.stdout(version);
    return 0;
  }
  if (parsed.kind === "error") {
    io.stderr(USAGE);
    io.stderr(`\nshipcheck: ${parsed.message}`);
    return 2;
  }

  const options = parsed.options;
  const env = deps.env ?? process.env;
  const diffFn = deps.collectDiff ?? collectDiff;
  const trackedFn = deps.listTrackedFiles ?? listTrackedFiles;
  const aiFn = deps.reviewWithAi ?? reviewWithAi;

  const reportPath = path.resolve(options.cwd, options.output);

  try {
    const collected = diffFn({
      cwd: options.cwd,
      base: options.base,
      includeUntracked: options.includeUntracked,
      excludePaths: [reportPath],
    });

    const trackedFiles = trackedFn(options.cwd);
    const findings = runDeterministicChecks(collected.diff, {
      trackedFiles,
      skippedUntracked: collected.skippedUntracked,
      skippedUntrackedReasons: collected.skippedUntrackedReasons,
    });

    let ai;
    if (options.ai) {
      const configResult = readAiConfig(env);
      if (!configResult.config) {
        ai = { status: "skipped" as const, reason: configResult.reason };
      } else {
        const result = await aiFn(collected.diff, configResult.config, deps.fetchImpl);
        ai = sanitizeAiReview(result);
      }
    }

    const report = buildReport({
      version,
      base: options.base,
      diff: collected.diff,
      findings,
      ...(ai ? { ai } : {}),
      ...(deps.now ? { now: deps.now } : {}),
    });

    const writtenReportPath = writeReportFile(reportPath, renderMarkdown(report));

    const color = deps.color ?? Boolean(process.stdout.isTTY && !env.NO_COLOR);
    if (options.json) {
      io.stdout(JSON.stringify(publicReport(report, writtenReportPath), null, 2));
    } else {
      io.stdout(renderTerminal(report, { color }));
      io.stdout(`\nReport written to ${writtenReportPath}`);
      io.stdout(`Status: ${statusLabel(report)}`);
    }

    return isBlocking(report, options.strict) ? 1 : 0;
  } catch (error) {
    if (error instanceof GitError) {
      io.stderr(`shipcheck: ${error.message}`);
      if (error.hint) io.stderr(`hint: ${error.hint}`);
      return 2;
    }
    const message = error instanceof Error ? error.message : String(error);
    io.stderr(`shipcheck: ${message}`);
    return 2;
  }
}

function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  process.exitCode = await main(process.argv.slice(2));
}