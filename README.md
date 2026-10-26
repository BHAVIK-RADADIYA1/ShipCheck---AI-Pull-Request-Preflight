# ShipCheck

ShipCheck is an open-source TypeScript CLI that answers one question:

> Is this code change ready for review?

It reads the diff between a base branch and your working tree, runs deterministic
preflight checks, prints a readable report, and writes `shipcheck-report.md`. Run
it before opening a pull request, or in CI as a gate.

ShipCheck is deliberately small: no account, no database, no GitHub App, and no
runtime dependencies. The default run needs no credentials and makes no network
calls.

## Why

Reviewers spend their first pass on things a machine can catch: committed
credentials, leftover `console.log`, unresolved conflict markers, a 2,000-line
diff, or a source change with no test beside it. ShipCheck surfaces those before
a human is asked to look.

## Requirements

- Node.js 20 or newer
- git
- A git working tree to review

## Installation

ShipCheck is not published to npm. Install from source:

```bash
git clone https://github.com/BHAVIK-RADADIYA1/ShipCheck---AI-Pull-Request-Preflight.git
cd ShipCheck---AI-Pull-Request-Preflight
npm ci
npm run build
npm link          # optional: makes the `shipcheck` command available globally
```

`npm pack` runs the build through the `prepack` script, so a packed tarball from
a checkout with development dependencies installed includes the actual CLI.

Without `npm link`:

```bash
node dist/src/cli.js review --base main
```

## Usage

```bash
shipcheck review --base main
```

The report file itself is excluded from the diff, so repeated runs do not
review their own output.

Review a different branch, tag, or commit:

```bash
shipcheck review --base origin/main
shipcheck review --base v1.4.0
```

### Options

| Option | Description |
| --- | --- |
| `--base <ref>` | Base branch, tag, or commit to diff against. Default: `main`. |
| `--output <path>` | Markdown report path. Default: `shipcheck-report.md`. |
| `--json` | Print the report as JSON instead of text. |
| `--strict` | Treat warnings as blocking, so warnings exit with code 1. |
| `--no-untracked` | Do not scan untracked files. |
| `--ai` | Run the optional AI review (see below). |
| `--cwd <path>` | Repository to review. Default: the current directory. |
| `--help`, `-h` | Show help. |
| `--version`, `-v` | Show the version. |

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | No blocking findings. |
| `1` | Blocking findings detected. |
| `2` | Invalid usage or execution error (bad ref, not a repo, write failure). |

### Example output

```text
ShipCheck 0.1.0 — review readiness
Base: main
3 file(s) changed, +42 / -7 lines
Not ready for review  (1 blocking, 2 warning, 0 info)

x Possible secret: GitHub token  src/config.ts:12
! Debug logging left in the change  src/api.ts:31
! No matching test file found for this change  src/billing.ts

Result: not ready for review.

Report written to /repo/shipcheck-report.md
Status: Not ready for review
```

## What it checks

| Check | Severity | Notes |
| --- | --- | --- |
| Likely secrets | Blocking | Known token shapes (AWS, GitHub, Slack, Stripe live keys, Google API keys, private keys, JWTs) plus generic `key = "value"` assignments with false-positive filters. |
| Merge conflict markers | Blocking | `<<<<<<<`, `>>>>>>>`, and the `=======` separator when part of a conflict block. |
| Very large diff | Blocking | More than 1,500 changed lines or 60 files. |
| Large diff | Warning | More than 500 changed lines or 20 files. |
| Debug leftovers | Warning | `console.log`/`debug`/`trace`, `debugger`, and `TODO`/`FIXME`/`XXX`/`HACK` markers. |
| Missing tests | Warning | Heuristic filename match between changed source files and test files. |
| Binary files | Info | Reported but not reviewed line by line. |

Only **added** lines are scanned for secrets, debug leftovers, and conflict
markers; existing code is not blamed for the current change.

Matched secret values are never written to the terminal or the report. ShipCheck
reports the file, line, and the kind of credential, then tells you to rotate it.

### Reducing false positives

- Placeholder-ish values (`example`, `changeme`, `your-api-key`, `${process.env.X}`,
  low-entropy strings, repeated characters) are ignored by the generic detector.
- Add a `shipcheck:ignore` comment on a line to skip the **secrets** and
  **debug** checks for that line. It does not suppress conflict-marker, size, or
  missing-test findings. This is a per-line assertion by the author, not a
  security control.
- Lockfiles, minified files, and generated directories are skipped.
- Generic `name = "value"` assignments are not reported in documentation files;
  high-confidence token shapes still are.

## Optional AI review

`--ai` adds a short risk summary and up to three risks from a model you choose.
It is **off by default** and never required. ShipCheck reads the variables from
the process environment; it does not load a `.env` file automatically.

ShipCheck does not bundle a provider or default endpoint. The adapter calls an
OpenAI-compatible `POST {base}/chat/completions` endpoint that you configure:

```bash
export SHIPCHECK_AI_BASE_URL="https://your-provider.example/v1"
export SHIPCHECK_AI_MODEL="your-model-name"
export SHIPCHECK_AI_API_KEY="..."   # never printed or written to the report

shipcheck review --base main --ai
```

Notes:

- Any OpenAI-compatible endpoint works, including a locally served open-weight
  model. ShipCheck ships no default URL or model name.
- The diff is size-capped and credential-shaped lines are redacted before the
  request.
- The response must be a JSON object with a `summary` string and an optional
  `risks` array of up to three strings. Malformed responses are rejected, extra
  risks are capped at three, and the result is redacted once more before it
  reaches the report.
- Model output is never executed.
- If the variables are missing, `--ai` records "AI review skipped" and the run
  continues normally.
- The adapter is covered by tests against a local mock HTTP server. It has not
  been tested against a live third-party provider in this repository.

## Use in CI

```yaml
- run: npm ci && npm run build
- run: node dist/src/cli.js review --base origin/main --strict
```

A non-zero exit fails the job. Keep the generated `shipcheck-report.md` as a
build artifact if you want the details in the job summary.

## Development

```bash
npm ci
npm run typecheck   # tsc --noEmit
npm test            # build, then run the full node:test suite
npm run build
```

Tests use Node's built-in test runner, so there is no test-framework dependency.
`npm test` compiles the suite and runs `scripts/run-tests.mjs`, which passes
explicit file paths to the runner. That works on Node 20 and avoids relying on
shell glob expansion on any platform. The suite covers the diff parser, every
deterministic check, report rendering, exit codes, real git repositories
(including missing refs, symlinks, and untracked files), and the AI adapter
against a local mock server.

### Project layout

```text
src/
  cli.ts              argument parsing, orchestration, exit codes
  git.ts              git invocation (no shell), ref validation, untracked files
  diff.ts             unified-diff parser
  checks/             secrets, debug, conflicts, size, missing tests
  report.ts           terminal and Markdown rendering
  ai.ts               optional OpenAI-compatible adapter
  types.ts            shared types
tests/                node:test suites and git fixtures
scripts/run-tests.mjs cross-platform test discovery (Node 20 compatible)
.alan/                reproducible Alan cloud environment
```

## Alan cloud environment

The repository ships `.alan/environment.json`, `.alan/setup.sh`, and
`.alan/start.sh`. Setup runs `npm ci` and builds the CLI; start is a no-op check
because ShipCheck has no long-running service. Review commands can then run
directly in an Alan sandbox.

## Limitations

- Checks inspect only the diff. They cannot prove the change is correct.
- Missing-test detection is a filename heuristic, not coverage analysis.
- Secret detection is pattern-based and will miss novel credential formats. It
  is a safety net, not a replacement for secret scanning or revocation.
- Size thresholds are currently fixed in `src/checks/size.ts`.
- No GitHub API integration: ShipCheck does not post review comments or read PR
  metadata yet.
- Untracked symlinks are not followed. Symlinks, unreadable files, files
  outside the repository, and untracked files larger than 512 KB are skipped and
  reported in the report.
- The AI adapter's quality depends entirely on the model and endpoint you
  configure.

## License

MIT. See `LICENSE`.