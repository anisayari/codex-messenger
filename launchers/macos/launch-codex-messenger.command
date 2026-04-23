#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP_NAME="Codex Messenger.app"
NODE_DOWNLOAD_URL="https://nodejs.org/en/download"

find_app() {
  for candidate in \
    "$ROOT_DIR"/release/macos/mac*/"$APP_NAME" \
    "$ROOT_DIR"/release/macos/"$APP_NAME" \
    "$ROOT_DIR"/release/mac*/"$APP_NAME"; do
    if [[ -d "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
}

if [[ -f "$ROOT_DIR/scripts/bootstrap-codex-env.mjs" ]]; then
  if ! command -v node >/dev/null 2>&1; then
    echo "Node.js/npm is required to install Codex CLI."
    open "$NODE_DOWNLOAD_URL"
    exit 1
  fi
  node "$ROOT_DIR/scripts/bootstrap-codex-env.mjs" --ensure
fi

APP_BUNDLE="$(find_app)"
if [[ -n "$APP_BUNDLE" ]]; then
  open -n "$APP_BUNDLE"
  exit 0
fi

cd "$ROOT_DIR"
npm run electron:dev
