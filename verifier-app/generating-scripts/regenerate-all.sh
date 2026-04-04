#!/usr/bin/env bash
# Regenerate all .json files from .ts scripts in this directory.
# Assumes a volta+bash environment (volta manages node/npm, npx tsx is available).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

for ts_file in "$SCRIPT_DIR"/*.ts; do
  json_file="${ts_file%.ts}.json"
  echo "Generating $(basename "$json_file") ..."
  npx tsx "$ts_file" > "$json_file"
done

echo "Done."
