import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { codexLoginStatus, codexVersion, codexVersionSupport, findCodexCommand, minimumCodexVersion, unsupportedCodexVersionMessage } from "../shared/codexSetup.js";

async function writeFakeCodexCli(dir, behavior) {
  const loginOk = behavior === "logged-in";
  if (process.platform === "win32") {
    const script = path.join(dir, `fake-codex-${behavior}.cmd`);
    const loginStatus = loginOk
      ? 'echo Logged in as test@example.com\r\n  exit /b 0'
      : 'echo Not logged in 1>&2\r\n  exit /b 1';
    await fs.writeFile(script, `@echo off\r\nif "%~1"=="--version" (\r\n  echo codex-cli-test 1.2.3\r\n  exit /b 0\r\n)\r\nif "%~1"=="login" if "%~2"=="status" (\r\n  ${loginStatus}\r\n)\r\necho unexpected args: %* 1>&2\r\nexit /b 2\r\n`, "utf8");
    return script;
  }

  const script = path.join(dir, `fake-codex-${behavior}.sh`);
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

test("checks the minimum supported Codex CLI version", () => {
  assert.equal(minimumCodexVersion, "0.125.0");
  assert.equal(codexVersionSupport("codex-cli 0.124.0").ok, false);
  assert.equal(codexVersionSupport("codex-cli 0.125.0").ok, true);
  assert.equal(codexVersionSupport("codex-cli 1.0.0").ok, true);
  assert.match(unsupportedCodexVersionMessage("codex-cli 0.124.0"), /npm install -g @openai\/codex@latest/);
});
