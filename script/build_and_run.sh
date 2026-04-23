#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-run}"
APP_NAME="Codex Messenger"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RELEASE_DIR="$ROOT_DIR/release/macos"

cd "$ROOT_DIR"

kill_existing() {
  pkill -x "$APP_NAME" >/dev/null 2>&1 || true
}

build_app() {
  npm run package:mac:dir
}

find_app_bundle() {
  for candidate in "$RELEASE_DIR"/mac*/"$APP_NAME.app" "$RELEASE_DIR"/"$APP_NAME.app"; do
    if [[ -d "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
}

open_app() {
  local app_bundle="$1"
  /usr/bin/open -n "$app_bundle"
}

verify_app() {
  for _ in {1..30}; do
    if pgrep -x "$APP_NAME" >/dev/null; then
      return 0
    fi
    sleep 0.5
  done
  echo "$APP_NAME did not start" >&2
  return 1
}

case "$MODE" in
  run|--logs|logs|--telemetry|telemetry|--verify|verify|--debug|debug)
    kill_existing
    build_app
    APP_BUNDLE="$(find_app_bundle)"
    if [[ -z "$APP_BUNDLE" ]]; then
      echo "Unable to find $APP_NAME.app in $RELEASE_DIR" >&2
      exit 1
    fi
    ;;
  *)
    echo "usage: $0 [run|--debug|--logs|--telemetry|--verify]" >&2
    exit 2
    ;;
esac

case "$MODE" in
  run)
    open_app "$APP_BUNDLE"
    ;;
  --debug|debug)
    lldb -- "$APP_BUNDLE/Contents/MacOS/$APP_NAME"
    ;;
  --logs|logs)
    open_app "$APP_BUNDLE"
    /usr/bin/log stream --info --style compact --predicate "process == \"$APP_NAME\""
    ;;
  --telemetry|telemetry)
    open_app "$APP_BUNDLE"
    /usr/bin/log stream --info --style compact --predicate "process == \"$APP_NAME\""
    ;;
  --verify|verify)
    open_app "$APP_BUNDLE"
    verify_app
    ;;
esac
