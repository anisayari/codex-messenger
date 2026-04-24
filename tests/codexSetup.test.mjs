import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { codexLoginStatus, codexVersion, findCodexCommand } from "../shared/codexSetup.js";

async function writeFakeCodexCli(dir, behavior) {
  const script = path.join(dir, `fake-codex-${behavior}.sh`);
  const loginOk = behavior === "logged-in";
  await fs.writeFile(script, `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "--version" ]]; then
  echo "codex-cli-test 1.2.3"
  exit 0
fi
if [[ "\${1:-}" == "login" && "\${2:-}" == "status" ]]; then
  ${loginOk ? 'echo "Logged in as test@example.com"; exit 0' : 'echo "Not logged in" >&2; exit 1'}
fi
echo "unexpected args: $*" >&2
exit 2
`, "utf8");
  await fs.chmod(script, 0o755);
  return script;
}

test("detects explicit Codex CLI path and reads version/login status", async (t) => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "codex-messenger-cli-"));
  t.after(async () => fs.rm(tmp, { recursive: true, force: true }));
  const fakeCodex = await writeFakeCodexCli(tmp, "logged-in");

  const found = await findCodexCommand(fakeCodex);
  assert.equal(found.command, fakeCodex);
  assert.equal(found.source, "manual");

  assert.equal(await codexVersion(fakeCodex), "codex-cli-test 1.2.3");
});

test("reports Codex login status success and failure", async (t) => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "codex-messenger-cli-"));
  t.after(async () => fs.rm(tmp, { recursive: true, force: true }));
  const loggedIn = await writeFakeCodexCli(tmp, "logged-in");
  const loggedOut = await writeFakeCodexCli(tmp, "logged-out");

  const success = await codexLoginStatus(loggedIn);
  assert.equal(success.ok, true);
  assert.equal(success.text, "Logged in as test@example.com");

  const failure = await codexLoginStatus(loggedOut);
  assert.equal(failure.ok, false);
  assert.equal(failure.text, "Not logged in");
});
