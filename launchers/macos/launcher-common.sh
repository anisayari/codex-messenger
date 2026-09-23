#!/usr/bin/env bash
# Shared by the Finder launchers; do not source user shell profiles or run Codex setup.

LAUNCHER_NODE=""
LAUNCHER_NPM=""
LAUNCHER_NODE_DIR=""

launcher_absolute_command() {
  local candidate="$1"
  [[ -f "$candidate" && -x "$candidate" ]] || return 1
  printf '%s/%s\n' "$(cd "$(dirname "$candidate")" && pwd -P)" "$(basename "$candidate")"
}

launcher_supported_node() {
  local candidate="$1" version
  [[ -f "$candidate" && -x "$candidate" ]] || return 1
  version="$("$candidate" --version 2>/dev/null)" || return 1
  [[ "$version" =~ ^v?([0-9]+)\.([0-9]+)\.([0-9]+)$ ]] || return 1
  LAUNCHER_CANDIDATE_MAJOR=$((10#${BASH_REMATCH[1]}))
  LAUNCHER_CANDIDATE_MINOR=$((10#${BASH_REMATCH[2]}))
  LAUNCHER_CANDIDATE_PATCH=$((10#${BASH_REMATCH[3]}))
  (( (LAUNCHER_CANDIDATE_MAJOR == 20 && LAUNCHER_CANDIDATE_MINOR >= 19) ||
     (LAUNCHER_CANDIDATE_MAJOR == 22 && LAUNCHER_CANDIDATE_MINOR >= 12) ||
     LAUNCHER_CANDIDATE_MAJOR > 22 ))
}

launcher_use_node() {
  local candidate="$1"
  launcher_supported_node "$candidate" || return 1
  LAUNCHER_NODE="$(launcher_absolute_command "$candidate")" || return 1
  LAUNCHER_NODE_DIR="$(dirname "$LAUNCHER_NODE")"
  export PATH="$LAUNCHER_NODE_DIR:${PATH:-/usr/bin:/bin:/usr/sbin:/sbin}"
}

launcher_nvm_node() {
  local nvm_dir="$1" candidate best="" best_major=-1 best_minor=-1 best_patch=-1
  [[ -n "$nvm_dir" ]] || return 1
  if launcher_use_node "$nvm_dir/current/bin/node"; then
    return 0
  fi
  for candidate in "$nvm_dir"/versions/node/v*/bin/node; do
    if launcher_supported_node "$candidate"; then
      if (( LAUNCHER_CANDIDATE_MAJOR > best_major ||
           (LAUNCHER_CANDIDATE_MAJOR == best_major && LAUNCHER_CANDIDATE_MINOR > best_minor) ||
           (LAUNCHER_CANDIDATE_MAJOR == best_major && LAUNCHER_CANDIDATE_MINOR == best_minor && LAUNCHER_CANDIDATE_PATCH > best_patch) )); then
        best="$candidate"
        best_major="$LAUNCHER_CANDIDATE_MAJOR"
        best_minor="$LAUNCHER_CANDIDATE_MINOR"
        best_patch="$LAUNCHER_CANDIDATE_PATCH"
      fi
    fi
  done
  [[ -n "$best" ]] && launcher_use_node "$best"
}

launcher_find_node() {
  local candidate path_node
  # An explicit runtime is a user choice; an invalid override must not silently switch.
  if [[ -n "${CODEX_MESSENGER_NODE_PATH:-}" ]]; then
    launcher_use_node "$CODEX_MESSENGER_NODE_PATH"
    return $?
  fi
  path_node="$(command -v node 2>/dev/null || true)"
  if [[ -n "$path_node" ]] && launcher_use_node "$path_node"; then
    return 0
  fi
  if [[ -n "${NVM_DIR:-}" ]] && launcher_nvm_node "$NVM_DIR"; then
    return 0
  fi
  for candidate in /opt/homebrew/bin/node /usr/local/bin/node "${HOME:-}/.volta/bin/node"; do
    if launcher_use_node "$candidate"; then
      return 0
    fi
  done
  if [[ -z "${NVM_DIR:-}" ]] && launcher_nvm_node "${HOME:-}/.nvm"; then
    return 0
  fi
  return 1
}

launcher_require_node() {
  if launcher_find_node; then
    return 0
  fi
  printf '%s\n' "Use Node.js 20 (20.19+) or Node.js 22.12+ to run Codex Messenger from source." >&2
  printf '%s\n' "Install a supported Node.js runtime, then double-click this launcher again." >&2
  open "https://nodejs.org/en/download" || true
  return 1
}

launcher_require_npm() {
  local candidate path_npm
  if [[ -n "${CODEX_MESSENGER_NPM_PATH:-}" ]]; then
    if ! LAUNCHER_NPM="$(launcher_absolute_command "$CODEX_MESSENGER_NPM_PATH")"; then
      printf '%s\n' "The configured npm executable was not found or is not executable." >&2
      return 1
    fi
    return 0
  fi
  path_npm="$(command -v npm 2>/dev/null || true)"
  for candidate in "$LAUNCHER_NODE_DIR/npm" "$path_npm" /opt/homebrew/bin/npm /usr/local/bin/npm; do
    if [[ -n "$candidate" ]] && LAUNCHER_NPM="$(launcher_absolute_command "$candidate")"; then
      return 0
    fi
  done
  printf '%s\n' "npm is required to install this project's dependencies. Install Node.js with npm and retry." >&2
  return 1
}

launcher_dependencies_ready() {
  local mode="$1"
  [[ -f "$ROOT_DIR/node_modules/vite/package.json" &&
     -f "$ROOT_DIR/node_modules/vite/dist/node/index.js" ]] || return 1
  if [[ "$mode" == "electron" ]]; then
    [[ -x "$ROOT_DIR/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron" ]] || return 1
  fi
  # Existing node_modules can belong to an older checkout. Check every direct
  # package against this checkout's lock, using the runtime selected above.
  "$LAUNCHER_NODE" -e '
    const fs = require("node:fs"), path = require("node:path");
    try {
      const root = process.argv[1];
      const read = relative => JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
      const project = read("package.json"), lock = read("package-lock.json");
      const installedLock = read("node_modules/.package-lock.json");
      const names = Object.keys({ ...project.dependencies, ...project.devDependencies });
      if (!names.length || !lock.packages || !installedLock.packages) process.exit(1);
      for (const name of names) {
        const expected = lock.packages[`node_modules/${name}`]?.version;
        const installed = read(`node_modules/${name}/package.json`).version;
        if (typeof expected !== "string" || installed !== expected) process.exit(1);
      }
      for (const [location, installed] of Object.entries(installedLock.packages)) {
        const expected = lock.packages[location];
        if (!expected || installed.version !== expected.version ||
            (installed.integrity && expected.integrity && installed.integrity !== expected.integrity)) process.exit(1);
      }
    } catch { process.exit(1); }
  ' "$ROOT_DIR"
}

launcher_ensure_dependencies() {
  local mode="$1"
  if launcher_dependencies_ready "$mode"; then
    return 0
  fi
  [[ -f "$ROOT_DIR/package-lock.json" ]] || {
    printf '%s\n' "package-lock.json is missing. Use a complete checkout of Codex Messenger." >&2
    return 1
  }
  launcher_require_npm || return 1
  printf '%s\n' "Installing this checkout's dependencies with npm ci..."
  (cd "$ROOT_DIR" && "$LAUNCHER_NPM" ci) || return $?
  if ! launcher_dependencies_ready "$mode"; then
    printf '%s\n' "Project dependencies are incomplete after npm ci; inspect the installation output and retry." >&2
    return 1
  fi
}
