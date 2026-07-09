#!/bin/zsh
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
NODE_BIN="/Users/mima0000/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
exec "$NODE_BIN" "$ROOT_DIR/scripts/server.mjs"
