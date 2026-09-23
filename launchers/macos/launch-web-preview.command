#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT_DIR/launchers/macos/launcher-common.sh"
launcher_require_node
launcher_ensure_dependencies preview
cd "$ROOT_DIR"
exec "$LAUNCHER_NODE" "$ROOT_DIR/scripts/web-preview.mjs" "$@"
