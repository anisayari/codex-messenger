#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
URL="http://127.0.0.1:5174/"

cd "$ROOT_DIR"
npm run dev &
sleep 2
open "$URL"
wait
