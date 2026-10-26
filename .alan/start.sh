#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

# ShipCheck is a CLI, not a service. There is nothing to keep running; make
# sure a build exists so `node dist/src/cli.js` works immediately.
if [ ! -f dist/src/cli.js ]; then
  npm run build
fi

echo "ShipCheck CLI ready: node dist/src/cli.js review --base main"