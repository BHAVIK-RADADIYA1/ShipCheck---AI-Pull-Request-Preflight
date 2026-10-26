#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

# Install exactly what the lockfile pins, then build the CLI so the sandbox is
# ready for review commands. No credentials are read or written here.
npm ci --no-audit --no-fund
npm run build