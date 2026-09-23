import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { chooseSupportedCodexCandidate, codexLoginStatus, codexVersion, codexVersionSupport, findCodexCommand, minimumCodexVersion, runCommand, unsupportedCodexVersionMessage } from "../shared/codexSetup.js";

import { resolveNpmCodexNativeExecutable } from "../shared/codexExecutable.js";

async function writeFakeCodexCli(dir, behavior, version = "1.2.3") {
  const loginOk = behavior === "logged-in";
  if (process.platform === "win32") {
    const script = path.join(dir, `fake-codex-${behavior}.cmd`);
    const loginStatus = loginOk
      ? 'echo Logged in as test@example.com\r\n  exit /b 0'
      : 'echo Not logged in 1>&2\r\n  exit /b 1';
    await fs.writeFile(script, `@echo off\r\nif "%~1"=="--version" (\r\n  echo codex-cli-test ${version}\r\n  exit /b 0\r\n)\r\nif "%~1"=="login" if "%~2"=="status" (\r\n  ${loginStatus}\r\n)\r\necho unexpected args: %* 1>&2\r\nexit /b 2\r\n`, "utf8");
    return script;
  }

  const script = path.join(dir, `fake-codex-${behavior}.sh`);
  await fs.writeFile(script, `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "--version" ]]; then
  echo "codex-cli-test ${version}"
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
  assert.equal(minimumCodexVersion, "0.156.1");
  assert.equal(codexVersionSupport("codex-cli 0.155.1").ok, false);
  assert.equal(codexVersionSupport("codex-cli 0.156.1").ok, true);
  assert.equal(codexVersionSupport("codex-cli 1.0.0").ok, true);
  assert.match(unsupportedCodexVersionMessage("codex-cli 0.124.0"), /npm install -g @openai\/codex@latest/);
});


test("automatic discovery skips an old PATH Codex for the first supported fallback", async () => {
  const oldPath = path.join(os.tmpdir(), "bundled-codex-alpha");
  const nvmFallback = path.join(os.tmpdir(), "nvm-codex-stable");
  const versions = new Map([[oldPath, "codex-cli 0.154.0-alpha.6.2"], [nvmFallback, "codex-cli 0.156.1"]]);
  const selected = await chooseSupportedCodexCandidate([oldPath, nvmFallback], { readVersion: async (command) => versions.get(command) });
  assert.equal(selected, nvmFallback);
});

test("automatic discovery preserves a supported PATH command before later candidates", async () => {
  const pathCommand = path.join(os.tmpdir(), "path-codex-supported");
  const newerFallback = path.join(os.tmpdir(), "fallback-codex-newer");
  const versions = new Map([[pathCommand, "codex-cli 0.156.1"], [newerFallback, "codex-cli 1.0.0"]]);
  assert.equal(await chooseSupportedCodexCandidate([pathCommand, newerFallback], { readVersion: async (command) => versions.get(command) }), pathCommand);
});

test("an unreadable candidate version does not hide a compatible fallback", async () => {
  const unknown = path.join(os.tmpdir(), "codex-wrapper-without-node");
  const stable = path.join(os.tmpdir(), "native-codex-supported");
  const selected = await chooseSupportedCodexCandidate([unknown, stable], {
    readVersion: async (command) => {
      if (command === unknown) throw new Error("node is not available in PATH");
      return "codex-cli 0.156.1";
    }
  });
  assert.equal(selected, stable);
});

test("a candidate without a parseable version is not treated as supported", async () => {
  const unknown = path.join(os.tmpdir(), "codex-unknown-version");
  const stable = path.join(os.tmpdir(), "codex-known-version");
  const selected = await chooseSupportedCodexCandidate([unknown, stable], {
    readVersion: async (command) => command === unknown ? "Codex version unavailable" : "codex-cli 0.156.1"
  });
  assert.equal(selected, stable);
});

test("discovery keeps the first command when no candidate has a verified supported version", async () => {
  const unknown = path.join(os.tmpdir(), "codex-version-unavailable");
  const old = path.join(os.tmpdir(), "codex-too-old");
  const versions = new Map([[unknown, "version unavailable"], [old, "codex-cli 0.155.1"]]);
  const readVersion = async (command) => versions.get(command);
  assert.equal(await chooseSupportedCodexCandidate(["", unknown, old], { readVersion }), unknown);
  assert.equal(codexVersionSupport(await readVersion(unknown)).ok, false);
});

test("a manual Codex path is preserved even when its version is unsupported", async (t) => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "codex-messenger-manual-"));
  t.after(async () => fs.rm(tmp, { recursive: true, force: true }));
  const manual = await writeFakeCodexCli(tmp, "logged-in", "0.154.0-alpha.6.2");
  const previousOverride = process.env.CODEX_MESSENGER_CODEX_PATH;
  process.env.CODEX_MESSENGER_CODEX_PATH = path.join(tmp, "automatic-fallback-codex");
  t.after(() => {
    if (previousOverride === undefined) delete process.env.CODEX_MESSENGER_CODEX_PATH;
    else process.env.CODEX_MESSENGER_CODEX_PATH = previousOverride;
  });
  const found = await findCodexCommand(manual);
  assert.equal(found.command, manual);
  assert.equal(found.source, "manual");
  assert.equal(codexVersionSupport(await codexVersion(found.command)).ok, false);
});

test("an explicit environment Codex override is preserved without automatic replacement", async (t) => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "codex-messenger-env-"));
  t.after(async () => fs.rm(tmp, { recursive: true, force: true }));
  const override = await writeFakeCodexCli(tmp, "logged-in", "0.154.0-alpha.6.2");
  const previousOverride = process.env.CODEX_MESSENGER_CODEX_PATH;
  process.env.CODEX_MESSENGER_CODEX_PATH = override;
  t.after(() => {
    if (previousOverride === undefined) delete process.env.CODEX_MESSENGER_CODEX_PATH;
    else process.env.CODEX_MESSENGER_CODEX_PATH = previousOverride;
  });
  const found = await findCodexCommand();
  assert.equal(found.command, override);
  assert.equal(found.source, "env");
  assert.equal(codexVersionSupport(await codexVersion(found.command)).ok, false);
});


const testCodexTriples = {
  linux: { x64: "x86_64-unknown-linux-musl", arm64: "aarch64-unknown-linux-musl" },
  android: { x64: "x86_64-unknown-linux-musl", arm64: "aarch64-unknown-linux-musl" },
  darwin: { x64: "x86_64-apple-darwin", arm64: "aarch64-apple-darwin" },
  win32: { x64: "x86_64-pc-windows-msvc", arm64: "aarch64-pc-windows-msvc" }
};

async function writeNpmCodexFixture(dir, { packageName = "@openai/codex", native = true, optionalPackage = false, targetTriple = testCodexTriples[process.platform]?.[process.arch] } = {}) {
  const packageRoot = path.join(dir, "node_modules", "@openai", "codex");
  const launcher = path.join(packageRoot, "bin", "codex.js");
  await fs.mkdir(path.dirname(launcher), { recursive: true });
  await fs.writeFile(path.join(packageRoot, "package.json"), JSON.stringify({ name: packageName, version: "0.156.1" }));
  await fs.writeFile(launcher, "#!/usr/bin/env node\nthrow new Error('The Node launcher should be bypassed');\n");
  await fs.chmod(launcher, 0o755);
  let command = launcher;
  if (process.platform !== "win32") {
    command = path.join(dir, "bin", "codex");
    await fs.mkdir(path.dirname(command), { recursive: true });
    await fs.symlink(launcher, command);
  }
  let vendorRoot = path.join(packageRoot, "vendor");
  if (optionalPackage) {
    const platformName = process.platform === "android" ? "linux" : process.platform;
    const platformPackage = "@openai/codex-" + platformName + "-" + process.arch;
    const optionalRoot = path.join(dir, "node_modules", ...platformPackage.split("/"));
    await fs.mkdir(optionalRoot, { recursive: true });
    await fs.writeFile(path.join(optionalRoot, "package.json"), JSON.stringify({ name: platformPackage, version: "0.156.1" }));
    vendorRoot = path.join(optionalRoot, "vendor");
  }
  const nativeCommand = targetTriple ? path.join(vendorRoot, targetTriple, "bin", process.platform === "win32" ? "codex.exe" : "codex") : "";
  if (native && nativeCommand) {
    await fs.mkdir(path.dirname(nativeCommand), { recursive: true });
    await fs.writeFile(nativeCommand, process.platform === "win32" ? "fixture executable" : "#!/bin/sh\nprintf 'codex-cli 0.156.1\\n'\n");
    await fs.chmod(nativeCommand, 0o755);
  }
  return { command, nativeCommand };
}

test("resolves the official npm package executable for this platform", async (t) => {
  if (!testCodexTriples[process.platform]?.[process.arch]) return t.skip("The official Codex package has no fixture target for this platform");
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "codex-messenger-npm-native-"));
  t.after(async () => fs.rm(tmp, { recursive: true, force: true }));
  const fixture = await writeNpmCodexFixture(tmp);
  assert.equal(await resolveNpmCodexNativeExecutable(fixture.command), await fs.realpath(fixture.nativeCommand));
  const manual = await findCodexCommand(fixture.command);
  assert.equal(manual.command, await fs.realpath(fixture.nativeCommand));
  assert.equal(manual.source, "manual");
});

test("resolves the installed official optional platform package executable", async (t) => {
  if (!testCodexTriples[process.platform]?.[process.arch]) return t.skip("The official Codex package has no fixture target for this platform");
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "codex-messenger-npm-platform-"));
  t.after(async () => fs.rm(tmp, { recursive: true, force: true }));
  const fixture = await writeNpmCodexFixture(tmp, { optionalPackage: true });
  assert.equal(await resolveNpmCodexNativeExecutable(fixture.command), await fs.realpath(fixture.nativeCommand));
});

test("the resolved npm executable runs when Node is absent from PATH", async (t) => {
  if (process.platform === "win32") return t.skip("Executable invocation fixture uses the POSIX shell");
  if (!testCodexTriples[process.platform]?.[process.arch]) return t.skip("The official Codex package has no fixture target for this platform");
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "codex-messenger-no-node-"));
  t.after(async () => fs.rm(tmp, { recursive: true, force: true }));
  const fixture = await writeNpmCodexFixture(tmp, { optionalPackage: true });
  const emptyPath = path.join(tmp, "empty-path");
  await fs.mkdir(emptyPath);
  const env = { ...process.env, PATH: emptyPath };
  await assert.rejects(runCommand(fixture.command, ["--version"], { env, timeoutMs: 5_000 }), /node/i);
  const command = await resolveNpmCodexNativeExecutable(fixture.command);
  const output = await runCommand(command, ["--version"], { env, timeoutMs: 5_000 });
  assert.equal(output.stdout.trim(), "codex-cli 0.156.1");
});

test("keeps the original command for a non-Codex npm package or missing vendor executable", async (t) => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "codex-messenger-npm-fallback-"));
  t.after(async () => fs.rm(tmp, { recursive: true, force: true }));
  const unrelated = await writeNpmCodexFixture(path.join(tmp, "unrelated"), { packageName: "unrelated-package" });
  assert.equal(await resolveNpmCodexNativeExecutable(unrelated.command), unrelated.command);
  const missing = await writeNpmCodexFixture(path.join(tmp, "missing"), { native: false });
  assert.equal(await resolveNpmCodexNativeExecutable(missing.command), missing.command);
});

test("does not select another platform's npm vendor executable", async (t) => {
  const current = testCodexTriples[process.platform]?.[process.arch];
  if (!current) return t.skip("The official Codex package has no fixture target for this platform");
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "codex-messenger-npm-wrong-platform-"));
  t.after(async () => fs.rm(tmp, { recursive: true, force: true }));
  const other = ["x86_64-unknown-linux-musl", "aarch64-apple-darwin", "x86_64-pc-windows-msvc"].find((triple) => triple !== current);
  const fixture = await writeNpmCodexFixture(tmp, { targetTriple: other });
  assert.equal(await resolveNpmCodexNativeExecutable(fixture.command), fixture.command);
});
