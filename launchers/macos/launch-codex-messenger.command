#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP_NAME="Codex Messenger.app"

host_architecture() {
  # Finder can launch a Terminal running under Rosetta on an Apple Silicon Mac.
  if [[ "$(sysctl -n hw.optional.arm64 2>/dev/null || true)" == "1" ]]; then
    printf '%s\n' "arm64"
  else
    uname -m
  fi
}

find_app() {
  local architecture output_dir bundle_dir candidate
  architecture="$(host_architecture)"
  local preferred_dirs=()
  case "$architecture" in
    arm64|aarch64)
      preferred_dirs=(mac-arm64 mac-universal universal "" mac mac-x64)
      ;;
    *)
      preferred_dirs=(mac mac-x64 mac-universal universal "")
      ;;
  esac
  for bundle_dir in "${preferred_dirs[@]}"; do
    for output_dir in "$ROOT_DIR/release/macos" "$ROOT_DIR/release"; do
      candidate="$output_dir${bundle_dir:+/$bundle_dir}/$APP_NAME"
      if [[ -f "$candidate/Contents/Info.plist" ]]; then
        printf '%s\n' "$candidate"
        return 0
      fi
    done
  done
  # No app is an expected source-checkout case, including under set -e.
  return 0
}

APP_BUNDLE="$(find_app)"
if [[ -n "$APP_BUNDLE" ]]; then
  open -n "$APP_BUNDLE"
  exit 0
fi

source "$ROOT_DIR/launchers/macos/launcher-common.sh"
launcher_require_node
launcher_ensure_dependencies electron
cd "$ROOT_DIR"
exec "$LAUNCHER_NODE" "$ROOT_DIR/scripts/dev-electron.mjs" "$@"
