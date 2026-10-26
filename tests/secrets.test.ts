import assert from "node:assert/strict";
import { test } from "node:test";

import {
  checkSecrets,
  containsLikelySecret,
  redactCredentialLike,
} from "../src/checks/secrets.js";
import {
  FAKE_AWS_KEY,
  FAKE_GENERIC_SECRET,
  FAKE_GITHUB_TOKEN,
  FAKE_JWT,
  FAKE_PRIVATE_KEY_HEADER,
} from "./fixtures/fake-credentials.js";
import { makeDiff } from "./helpers.js";

const AWS_KEY = FAKE_AWS_KEY;
const GITHUB_TOKEN = FAKE_GITHUB_TOKEN;

test("detects an AWS access key as blocking", () => {
  const findings = checkSecrets(
    makeDiff([{ path: "src/config.ts", added: [`const key = "${AWS_KEY}";`] }]),
  );

  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.severity, "blocking");
  assert.match(findings[0]?.title ?? "", /AWS access key/);
});

test("never includes the matched value in a finding", () => {
  const findings = checkSecrets(
    makeDiff([{ path: "src/config.ts", added: [`const key = "${AWS_KEY}";`] }]),
  );

  assert.doesNotMatch(JSON.stringify(findings), new RegExp(AWS_KEY));
});

test("detects a GitHub token", () => {
  const findings = checkSecrets(
    makeDiff([{ path: "ci/settings.py", added: [`TOKEN = "${GITHUB_TOKEN}"`] }]),
  );

  assert.equal(findings.length, 1);
  assert.match(findings[0]?.title ?? "", /GitHub token/);
});

test("detects a private key block", () => {
  const findings = checkSecrets(
    makeDiff([
      {
        path: "certs/server.pem",
        added: [FAKE_PRIVATE_KEY_HEADER, "MIIEowIBAAKCAQEA"],
      },
    ]),
  );

  assert.ok(findings.some((finding) => /Private key/.test(finding.title)));
});

test("detects a hard-coded generic credential", () => {
  const findings = checkSecrets(
    makeDiff([{ path: "src/auth.ts", added: [`const apiKey = "${FAKE_GENERIC_SECRET}";`] }]),
  );

  assert.equal(findings.length, 1);
  assert.match(findings[0]?.title ?? "", /hard-coded credential/);
});

test("ignores placeholder values", () => {
  const findings = checkSecrets(
    makeDiff([
      {
        path: "src/auth.ts",
        added: [
          'const apiKey = "your-api-key-here";',
          'const password = "changeme";',
          'const token = "${process.env.TOKEN}";',
        ],
      },
    ]),
  );

  assert.equal(findings.length, 0);
});

test("ignores environment variable references without quotes", () => {
  const findings = checkSecrets(
    makeDiff([
      {
        path: "src/auth.ts",
        added: ["const apiKey = process.env.API_KEY;", "const secret = os.environ['SECRET'];"],
      },
    ]),
  );

  assert.equal(findings.length, 0);
});

test("ignores low-entropy values", () => {
  const findings = checkSecrets(
    makeDiff([{ path: "src/auth.ts", added: ['const token = "aaaaaaaaaaaaaaa";'] }]),
  );

  assert.equal(findings.length, 0);
});

test("ignores environment-variable names used as string constants", () => {
  const findings = checkSecrets(
    makeDiff([{ path: "src/ai.ts", added: ['apiKey: "SHIPCHECK_AI_API_KEY",'] }]),
  );

  assert.equal(findings.length, 0);
});

test("honours a shipcheck:ignore allowlist comment", () => {
  const findings = checkSecrets(
    makeDiff([
      { path: "src/auth.ts", added: [`const key = "${AWS_KEY}"; // shipcheck:ignore`] },
    ]),
  );

  assert.equal(findings.length, 0);
});

test("does not scan removed lines", () => {
  const findings = checkSecrets(
    makeDiff([{ path: "src/auth.ts", removed: [`const key = "${AWS_KEY}";`], added: [] }]),
  );

  assert.equal(findings.length, 0);
});

test("skips lockfiles", () => {
  const findings = checkSecrets(
    makeDiff([{ path: "package-lock.json", added: [`"token": "${GITHUB_TOKEN}"`] }]),
  );

  assert.equal(findings.length, 0);
});

test("still catches token shapes in documentation", () => {
  const findings = checkSecrets(
    makeDiff([{ path: "README.md", added: [`Use ${GITHUB_TOKEN} in CI.`] }]),
  );

  assert.equal(findings.length, 1);
});

test("ignores generic assignments in documentation", () => {
  const findings = checkSecrets(
    makeDiff([{ path: "README.md", added: [`const apiKey = "${FAKE_GENERIC_SECRET}";`] }]),
  );

  assert.equal(findings.length, 0);
});

test("containsLikelySecret agrees with the check", () => {
  assert.equal(containsLikelySecret(`key=${AWS_KEY}`), true);
  assert.equal(containsLikelySecret('const token = "your-token";'), false);
});

test("redactCredentialLike masks token shapes", () => {
  const redacted = redactCredentialLike(`key ${AWS_KEY} and ${GITHUB_TOKEN}`);
  assert.doesNotMatch(redacted, new RegExp(AWS_KEY));
  assert.doesNotMatch(redacted, new RegExp(GITHUB_TOKEN));
  assert.match(redacted, /redacted/);
});

test("detects a JWT", () => {
  const token = FAKE_JWT;
  const findings = checkSecrets(makeDiff([{ path: "src/token.ts", added: [`const jwt = "${token}";`] }]));
  assert.ok(findings.some((finding) => /JSON Web Token/.test(finding.title)));
});