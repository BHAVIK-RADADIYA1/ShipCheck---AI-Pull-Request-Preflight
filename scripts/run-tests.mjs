#!/usr/bin/env node
// Run the compiled test suite with explicit file paths.
//
// Node 20's test runner does not expand globs, and shell expansion is not
// portable (cmd.exe on Windows behaves differently). Passing the discovered
// files directly keeps `npm test` working on every supported platform.

import { readdirSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const testsDir = fileURLToPath(new URL("../dist/tests/", import.meta.url));

function findTestFiles(directory) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...findTestFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".test.js")) {
      files.push(fullPath);
    }
  }

  return files;
}

const files = findTestFiles(testsDir).sort();
if (files.length === 0) {
  console.error(`No compiled test files found in ${testsDir}. Run the build first.`);
  process.exit(2);
}

const result = spawnSync(process.execPath, ["--test", ...files], {
  stdio: "inherit",
  shell: false,
});

process.exit(result.status ?? 1);