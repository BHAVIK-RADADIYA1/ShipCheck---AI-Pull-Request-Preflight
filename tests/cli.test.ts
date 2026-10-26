import assert from "node:assert/strict";
import { existsSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { test } from "node:test";

import { FAKE_AWS_KEY } from "./fixtures/fake-credentials.js";
import { createRepo, createTempDir, runCli, runCliAsync } from "./helpers.js";

const packageJson = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as { version: string };

const AWS_KEY = FAKE_AWS_KEY;
const SECRET_SOURCE = `export const awsKey = "${AWS_KEY}";\n`;

test("prints usage and exits 0 for --help", () => {
  const result = runCli(["--help"], createTempDir());

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage:/);
  assert.match(result.stdout, /Exit codes:/);
});

test("prints the package version for --version", () => {
  const result = runCli(["--version"], createTempDir());

  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), packageJson.version);
});

test("exits 2 when no command is given", () => {
  const result = runCli([], createTempDir());

  assert.equal(result.status, 2);
  assert.match(result.stderr, /missing command/);
});

test("exits 2 for an unknown command", () => {
  const result = runCli(["frobnicate"], createTempDir());

  assert.equal(result.status, 2);
  assert.match(result.stderr, /unknown command/);
});

test("exits 2 for an unknown option", () => {
  const result = runCli(["review", "--nope"], createRepo().dir);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Unknown option/);
});

test("exits 0 and writes a report for a clean change", () => {
  const repo = createRepo();
  repo.write("README.md", "# Fixture\n\nUpdated documentation.\n");

  const result = runCli(["review", "--base", "main"], repo.dir);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Ready for review/);
  assert.match(result.stdout, /Report written to/);

  const reportPath = path.join(repo.dir, "shipcheck-report.md");
  assert.equal(existsSync(reportPath), true);
  const report = readFileSync(reportPath, "utf8");
  assert.match(report, /# ShipCheck report/);
  assert.match(report, /Ready for review/);
});

test("exits 1 for a blocking finding and never prints the secret", () => {
  const repo = createRepo();
  repo.write("src/config.ts", SECRET_SOURCE);

  const result = runCli(["review", "--base", "main"], repo.dir);

  assert.equal(result.status, 1);
  assert.match(result.stdout, /Possible secret/);
  assert.doesNotMatch(result.stdout, new RegExp(AWS_KEY));
  assert.doesNotMatch(result.stderr, new RegExp(AWS_KEY));

  const report = readFileSync(path.join(repo.dir, "shipcheck-report.md"), "utf8");
  assert.match(report, /Not ready for review/);
  assert.doesNotMatch(report, new RegExp(AWS_KEY));
});

test("handles an empty diff with exit 0", () => {
  const repo = createRepo();
  const result = runCli(["review", "--base", "main"], repo.dir);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /No changes relative to the base/);

  const report = readFileSync(path.join(repo.dir, "shipcheck-report.md"), "utf8");
  assert.match(report, /Nothing to review/);
});

test("exits 2 when the base ref is missing", () => {
  const repo = createRepo();
  const result = runCli(["review", "--base", "no-such-branch"], repo.dir);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Base ref not found/);
  assert.match(result.stderr, /hint:/);
});

test("exits 2 outside a git repository", () => {
  const result = runCli(["review", "--base", "main"], createTempDir());

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Not a git working tree/);
});

test("rejects an unsafe base ref without executing it", () => {
  const repo = createRepo();
  const result = runCli(["review", "--base", "main;touch pwned"], repo.dir);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Invalid base ref/);
  assert.equal(existsSync(path.join(repo.dir, "pwned")), false);
});

test("--strict turns warnings into exit 1", () => {
  const repo = createRepo();
  repo.write("src/debug.ts", 'console.log("temporary");\n');

  const normal = runCli(["review", "--base", "main"], repo.dir);
  assert.equal(normal.status, 0);

  const strict = runCli(["review", "--base", "main", "--strict"], repo.dir);
  assert.equal(strict.status, 1);
});

test("--json prints valid JSON without diff line bodies", () => {
  const repo = createRepo();
  repo.write("src/config.ts", SECRET_SOURCE);

  const result = runCli(["review", "--base", "main", "--json"], repo.dir);
  assert.equal(result.status, 1);

  const parsed = JSON.parse(result.stdout) as {
    blocking: number;
    files: Array<Record<string, unknown>>;
    findings: Array<{ check: string }>;
    reportPath: string;
  };

  assert.equal(parsed.blocking, 1);
  assert.ok(parsed.findings.some((finding) => finding.check === "secrets"));
  assert.equal(parsed.files.every((file) => !("lines" in file)), true);
  assert.match(parsed.reportPath, /shipcheck-report\.md$/);
  assert.doesNotMatch(result.stdout, new RegExp(AWS_KEY));
});

test("--no-untracked excludes untracked files from the review", () => {
  const repo = createRepo();
  repo.write(".env", `AWS_ACCESS_KEY_ID=${AWS_KEY}\n`);

  const withUntracked = runCli(["review", "--base", "main"], repo.dir);
  assert.equal(withUntracked.status, 1);

  const withoutUntracked = runCli(["review", "--base", "main", "--no-untracked"], repo.dir);
  assert.equal(withoutUntracked.status, 0);
});

test(
  "reports skipped untracked symlinks without following them",
  { skip: process.platform === "win32" ? "symlinks need extra privileges on Windows" : false },
  () => {
    const repo = createRepo();
    const outside = path.join(createTempDir(), "external.ts");
    writeFileSync(outside, 'export const external = "do not read";\n');
    symlinkSync(outside, path.join(repo.dir, "linked.ts"));

    const result = runCli(["review", "--base", "main"], repo.dir);

    assert.equal(result.status, 0);
    const report = readFileSync(path.join(repo.dir, "shipcheck-report.md"), "utf8");
    assert.match(report, /1 untracked file\(s\) not scanned/);
    assert.match(report, /1 symlink\(s\), not followed/);
    assert.doesNotMatch(report, /do not read/);
  },
);

test("--output writes to a nested custom path", () => {
  const repo = createRepo();
  repo.write("README.md", "# Fixture\n\nChanged.\n");

  const result = runCli(
    ["review", "--base", "main", "--output", "reports/preflight.md"],
    repo.dir,
  );

  assert.equal(result.status, 0);
  assert.equal(existsSync(path.join(repo.dir, "reports/preflight.md")), true);
});

test("--cwd reviews another repository", () => {
  const repo = createRepo();
  repo.write("README.md", "# Fixture\n\nChanged.\n");
  const elsewhere = createTempDir();

  const result = runCli(["review", "--base", "main", "--cwd", repo.dir], elsewhere);

  assert.equal(result.status, 0);
  assert.equal(existsSync(path.join(repo.dir, "shipcheck-report.md")), true);
  assert.equal(existsSync(path.join(elsewhere, "shipcheck-report.md")), false);
});

test("--ai without configuration is skipped, not an error", () => {
  const repo = createRepo();
  repo.write("README.md", "# Fixture\n\nChanged.\n");

  const result = runCli(["review", "--base", "main", "--ai"], repo.dir);

  assert.equal(result.status, 0);
  const report = readFileSync(path.join(repo.dir, "shipcheck-report.md"), "utf8");
  assert.match(report, /AI review skipped/);
  assert.match(report, /SHIPCHECK_AI_BASE_URL/);
});

test("--ai works end to end against a configured compatible endpoint", async () => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        choices: [
          { message: { content: '{"summary":"Adds documentation.","risks":["No code changed"]}' } },
        ],
      }),
    );
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address !== "object" || address === null) throw new Error("no port");
  const apiKey = "local-test-key-not-real";

  try {
    const repo = createRepo();
    repo.write("README.md", "# Fixture\n\nChanged.\n");

    const result = await runCliAsync(["review", "--base", "main", "--ai"], repo.dir, {
      SHIPCHECK_AI_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
      SHIPCHECK_AI_MODEL: "test-model",
      SHIPCHECK_AI_API_KEY: apiKey,
    });

    assert.equal(result.status, 0);
    const report = readFileSync(path.join(repo.dir, "shipcheck-report.md"), "utf8");
    assert.match(report, /## AI review/);
    assert.match(report, /Adds documentation\./);
    assert.match(report, /No code changed/);
    assert.doesNotMatch(report, new RegExp(apiKey));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("does not review its own previous report", () => {
  const repo = createRepo();
  repo.write("README.md", "# Fixture\n\nChanged.\n");

  const first = runCli(["review", "--base", "main"], repo.dir);
  assert.equal(first.status, 0);

  const second = runCli(["review", "--base", "main"], repo.dir);
  assert.equal(second.status, 0);
  assert.match(second.stdout, /1 file\(s\) changed/);
});

test("default base is main", () => {
  const repo = createRepo();
  repo.write("README.md", "# Fixture\n\nChanged.\n");

  const result = runCli(["review"], repo.dir);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Base: main/);
});