import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { MAX_AI_RISKS } from "../src/ai.js";

const root = new URL("../../", import.meta.url);

function readProjectFile(name: string): string {
  return readFileSync(new URL(name, root), "utf8");
}

const readme = readProjectFile("README.md");
const envExample = readProjectFile(".env.example");
const packageJson = JSON.parse(readProjectFile("package.json")) as {
  engines: { node: string };
  scripts: Record<string, string>;
};

test("npm test uses the cross-platform runner rather than a shell glob", () => {
  assert.match(packageJson.scripts.test ?? "", /scripts\/run-tests\.mjs/);
  assert.doesNotMatch(packageJson.scripts.test ?? "", /\*/);
});

test("packaging builds the CLI before packing", () => {
  assert.equal(packageJson.scripts.prepack, "npm run build");
});

test("the supported Node version matches the documented version", () => {
  assert.match(packageJson.engines.node, />=20/);
  assert.match(readme, /Node\.js 20 or newer/);
});

test(".env.example documents exporting variables, not automatic .env loading", () => {
  assert.doesNotMatch(envExample, /copy to \.env/i);
  assert.match(envExample, /does not load \.env/i);
  assert.match(envExample, /export them/i);
});

test("README limits shipcheck:ignore to the checks that implement it", () => {
  assert.match(readme, /\*\*secrets\*\*\s+and\s+\*\*debug\*\*/);
  assert.match(readme, /does not suppress[\s\S]*conflict-marker[\s\S]*size[\s\S]*missing-test/);
});

test("README risk limit matches the adapter limit", () => {
  const words = ["zero", "one", "two", "three", "four", "five"];
  const documented = words[MAX_AI_RISKS];
  assert.ok(documented);
  assert.match(readme, new RegExp(`up to ${documented} risks`));
});

test("README documents that untracked symlinks are not followed", () => {
  assert.match(readme, /Untracked symlinks are not followed/);
});