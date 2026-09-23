import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const launcherNames = ["launch-codex-messenger.command", "launch-web-preview.command", "launcher-common.sh"];
const macTest = (name, fn) => test(name, { skip: process.platform === "win32" }, fn);
const directVersions = { vite: "7.1.12", electron: "41.3.0", react: "19.1.1", "@vitejs/plugin-react": "5.0.4" };

async function executable(file, lines) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, lines.join("\n") + "\n");
  await fs.chmod(file, 0o755);
  return file;
}

async function nodeMock(file, version) {
  return executable(file, [
    "#!/bin/bash",
    "set -euo pipefail",
    'if [[ "$1" == "-e" ]]; then',
    '  printf "dependency-check|%s|%s\\n" "$0" "$PWD" >> "$LAUNCH_TEST_LOG"',
    '  exec "$LAUNCH_TEST_REAL_NODE" "$@"',
    'fi',
    'printf "node|%s|%s|%s|%s\\n" "$0" "$#" "$PWD" "$*" >> "$LAUNCH_TEST_LOG"',
    'if [[ "$1" == "--version" ]]; then',
    '  printf "%s\\n" "' + version + '"',
    "  exit 0",
    "fi",
    'exit "$LAUNCH_TEST_NODE_STATUS"'
  ]);
}

async function dependencies(project, electron = true) {
  for (const [name, version] of Object.entries(directVersions)) {
    await fs.mkdir(path.join(project, "node_modules", name), { recursive: true });
    await fs.writeFile(path.join(project, "node_modules", name, "package.json"), JSON.stringify({ name, version }));
  }
  await fs.mkdir(path.join(project, "node_modules/vite/dist/node"), { recursive: true });
  await fs.writeFile(path.join(project, "node_modules/vite/dist/node/index.js"), "");
  await fs.copyFile(path.join(project, "package-lock.json"), path.join(project, "node_modules/.package-lock.json"));
  if (electron) {
    await executable(path.join(project, "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"), ["#!/bin/bash", "exit 0"]);
  }
}

async function fixture(t, { version = "v24.19.0", ready = true, electron = true } = {}) {
  const temp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "codex mac launcher ")));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const project = path.join(temp, "project with spaces");
  const bin = path.join(temp, "mock commands");
  const log = path.join(temp, "calls.log");
  await fs.mkdir(path.join(project, "launchers/macos"), { recursive: true });
  for (const name of launcherNames) {
    await fs.copyFile(path.join(repoRoot, "launchers/macos", name), path.join(project, "launchers/macos", name));
  }
  await fs.mkdir(path.join(project, "scripts"), { recursive: true });
  await fs.writeFile(path.join(project, "scripts/bootstrap-codex-env.mjs"), "throw new Error('Bootstrap must not be called');\n");
  await fs.writeFile(path.join(project, "scripts/dev-electron.mjs"), "");
  await fs.writeFile(path.join(project, "scripts/web-preview.mjs"), "");
  await fs.writeFile(path.join(project, "package.json"), JSON.stringify({ dependencies: { react: "^19.1.1" }, devDependencies: { vite: "^7.1.12", electron: "^41.3.0", "@vitejs/plugin-react": "^5.0.4" } }));
  await fs.writeFile(path.join(project, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages: Object.fromEntries(Object.entries(directVersions).map(([name, version]) => ["node_modules/" + name, { version }])) }));
  const installFile = path.join(temp, "mock local install.cjs");
  await fs.writeFile(installFile, [
    'const fs = require("node:fs"), path = require("node:path");',
    'const lock = JSON.parse(fs.readFileSync("package-lock.json", "utf8"));',
    'for (const [location, entry] of Object.entries(lock.packages)) {',
    '  fs.mkdirSync(location, { recursive: true });',
    '  fs.writeFileSync(path.join(location, "package.json"), JSON.stringify({ version: entry.version }));',
    '}',
    'fs.writeFileSync("node_modules/.package-lock.json", JSON.stringify(lock));'
  ].join("\n"));
  await fs.writeFile(log, "");
  const node = await nodeMock(path.join(bin, "node"), version);
  const npm = await executable(path.join(bin, "npm"), [
    "#!/bin/bash",
    "set -euo pipefail",
    'printf "npm|%s|%s|%s\\n" "$#" "$PWD" "$*" >> "$LAUNCH_TEST_LOG"',
    'if [[ "$LAUNCH_TEST_NPM_STATUS" != "0" ]]; then exit "$LAUNCH_TEST_NPM_STATUS"; fi',
    'if [[ "$LAUNCH_TEST_NPM_COMPLETE" == "0" ]]; then exit 0; fi',
    '[[ "$#" == "1" && "$1" == "ci" ]] || exit 91',
    'mkdir -p node_modules/vite/dist/node node_modules/electron/dist/Electron.app/Contents/MacOS',
    '"$LAUNCH_TEST_REAL_NODE" "$LAUNCH_TEST_INSTALL_FILE"',
    'printf "// fixture\\n" > node_modules/vite/dist/node/index.js',
    'printf "#!/bin/bash\\nexit 0\\n" > node_modules/electron/dist/Electron.app/Contents/MacOS/Electron',
    'chmod +x node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
  ]);
  await executable(path.join(bin, "open"), [
    "#!/bin/bash",
    'printf "open|%s|%s\\n" "$#" "$*" >> "$LAUNCH_TEST_LOG"',
    'exit "$LAUNCH_TEST_OPEN_STATUS"'
  ]);
  await executable(path.join(bin, "sysctl"), ["#!/bin/bash", 'printf "%s\\n" "$LAUNCH_TEST_HW_ARM64"']);
  await executable(path.join(bin, "uname"), ["#!/bin/bash", 'printf "%s\\n" "$LAUNCH_TEST_ARCH"']);
  if (ready) await dependencies(project, electron);
  const env = {
    ...process.env,
    PATH: bin + ":/usr/bin:/bin:/usr/sbin:/sbin",
    NVM_DIR: path.join(temp, "controlled nvm"),
    CODEX_MESSENGER_NODE_PATH: node,
    CODEX_MESSENGER_NPM_PATH: npm,
    LAUNCH_TEST_LOG: log,
    LAUNCH_TEST_REAL_NODE: process.execPath,
    LAUNCH_TEST_INSTALL_FILE: installFile,
    LAUNCH_TEST_NODE_STATUS: "0",
    LAUNCH_TEST_NPM_STATUS: "0",
    LAUNCH_TEST_NPM_COMPLETE: "1",
    LAUNCH_TEST_OPEN_STATUS: "0",
    LAUNCH_TEST_ARCH: "arm64",
    LAUNCH_TEST_HW_ARM64: "1"
  };
  return { temp, project, bin, log, node, npm, env };
}

async function launch(f, name = "launch-codex-messenger.command", args = []) {
  try {
    const result = await execFileAsync("/bin/bash", [path.join(f.project, "launchers/macos", name), ...args], {
      cwd: f.temp,
      env: f.env,
      timeout: 10000
    });
    return { code: 0, ...result };
  } catch (error) {
    return { code: error.code, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
  }
}

async function calls(f) {
  return (await fs.readFile(f.log, "utf8")).trim().split("\n").filter(Boolean).map(line => line.split("|"));
}

function helperCalls(records) {
  return records.filter(r => r[0] === "node" && r[4] !== "--version");
}

async function bundle(f, output, valid = true) {
  const directory = path.join(f.project, "release", output, "Codex Messenger.app");
  await fs.mkdir(valid ? path.join(directory, "Contents") : directory, { recursive: true });
  if (valid) await fs.writeFile(path.join(directory, "Contents/Info.plist"), "<plist/>");
  return directory;
}

macTest("macOS launcher files pass the system bash syntax check", async () => {
  await Promise.all(launcherNames.map(name => execFileAsync("/bin/bash", ["-n", path.join(repoRoot, "launchers/macos", name)])));
});

macTest("packaged app opens without Node, npm or Codex bootstrap", async t => {
  const f = await fixture(t, { ready: false });
  const app = await bundle(f, "macos/mac-arm64");
  f.env.CODEX_MESSENGER_NODE_PATH = path.join(f.temp, "no runtime");
  f.env.CODEX_MESSENGER_NPM_PATH = path.join(f.temp, "no npm");
  assert.equal((await launch(f)).code, 0);
  assert.deepEqual(await calls(f), [["open", "2", "-n " + app]]);
});

macTest("Apple Silicon under Rosetta prefers arm64 when both builds exist", async t => {
  const f = await fixture(t);
  await bundle(f, "macos/mac");
  const arm = await bundle(f, "macos/mac-arm64");
  f.env.LAUNCH_TEST_ARCH = "x86_64";
  assert.equal((await launch(f)).code, 0);
  assert.deepEqual(await calls(f), [["open", "2", "-n " + arm]]);
});

macTest("Intel prefers x64 when both architectures exist", async t => {
  const f = await fixture(t);
  const intel = await bundle(f, "macos/mac");
  await bundle(f, "macos/mac-arm64");
  f.env.LAUNCH_TEST_HW_ARM64 = "0";
  f.env.LAUNCH_TEST_ARCH = "x86_64";
  assert.equal((await launch(f)).code, 0);
  assert.deepEqual(await calls(f), [["open", "2", "-n " + intel]]);
});

macTest("Intel skips an ARM-only bundle and starts the source checkout", async t => {
  const f = await fixture(t);
  await bundle(f, "macos/mac-arm64");
  f.env.LAUNCH_TEST_HW_ARM64 = "0";
  f.env.LAUNCH_TEST_ARCH = "x86_64";
  assert.equal((await launch(f)).code, 0);
  const records = await calls(f);
  assert.equal(records.some(r => r[0] === "open"), false);
  assert.deepEqual(helperCalls(records), [["node", f.node, "1", f.project, path.join(f.project, "scripts/dev-electron.mjs")]]);
});

macTest("native legacy output wins before a translated modern output", async t => {
  const f = await fixture(t);
  await bundle(f, "macos/mac");
  const arm = await bundle(f, "mac-arm64");
  assert.equal((await launch(f)).code, 0);
  assert.deepEqual(await calls(f), [["open", "2", "-n " + arm]]);
});

macTest("an incomplete app directory is skipped and source startup handles spaces", async t => {
  const f = await fixture(t);
  await bundle(f, "macos/mac-arm64", false);
  assert.equal((await launch(f, "launch-codex-messenger.command", ["--smoke-test"])).code, 0);
  const records = await calls(f);
  assert.equal(records.some(r => r[0] === "open" || r[0] === "npm"), false);
  assert.deepEqual(helperCalls(records), [["node", f.node, "2", f.project, path.join(f.project, "scripts/dev-electron.mjs") + " --smoke-test"]]);
  assert.equal(records.some(r => r.join("|").includes("bootstrap-codex-env")), false);
});

macTest("a packaged open failure is propagated without falling back to installs", async t => {
  const f = await fixture(t, { ready: false });
  const app = await bundle(f, "macos/mac-arm64");
  f.env.LAUNCH_TEST_OPEN_STATUS = "7";
  assert.equal((await launch(f)).code, 7);
  assert.deepEqual(await calls(f), [["open", "2", "-n " + app]]);
});

macTest("fresh source checkout installs local locked dependencies before launching", async t => {
  const f = await fixture(t, { ready: false });
  assert.equal((await launch(f)).code, 0);
  const records = await calls(f);
  assert.deepEqual(records.filter(r => r[0] === "npm"), [["npm", "1", f.project, "ci"]]);
  assert.deepEqual(helperCalls(records), [["node", f.node, "1", f.project, path.join(f.project, "scripts/dev-electron.mjs")]]);
  assert.equal(records.some(r => /bootstrap-codex-env|install -g|login/.test(r.join("|"))), false);
});

macTest("an old direct dependency is reinstalled from the current lock before launch", async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.project, "node_modules/electron/package.json"), JSON.stringify({ version: "29.1.0" }));
  assert.equal((await launch(f)).code, 0);
  assert.deepEqual((await calls(f)).filter(r => r[0] === "npm"), [["npm", "1", f.project, "ci"]]);
  assert.equal(JSON.parse(await fs.readFile(path.join(f.project, "node_modules/electron/package.json"), "utf8")).version, directVersions.electron);
});

macTest("a missing React plugin is repaired despite an existing Vite entry and Electron executable", async t => {
  const f = await fixture(t);
  await fs.rm(path.join(f.project, "node_modules/@vitejs/plugin-react"), { recursive: true });
  assert.equal((await launch(f, "launch-web-preview.command")).code, 0);
  assert.deepEqual((await calls(f)).filter(r => r[0] === "npm"), [["npm", "1", f.project, "ci"]]);
  assert.equal(JSON.parse(await fs.readFile(path.join(f.project, "node_modules/@vitejs/plugin-react/package.json"), "utf8")).version, directVersions["@vitejs/plugin-react"]);
});

macTest("stale packages after a falsely successful install prevent source startup", async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.project, "node_modules/react/package.json"), JSON.stringify({ version: "18.0.0" }));
  f.env.LAUNCH_TEST_NPM_COMPLETE = "0";
  const result = await launch(f);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /incomplete after npm ci/);
  assert.equal(helperCalls(await calls(f)).length, 0);
});

macTest("stale installed lock metadata triggers repair even when direct package files match", async t => {
  const f = await fixture(t);
  const file = path.join(f.project, "node_modules/.package-lock.json");
  const installed = JSON.parse(await fs.readFile(file, "utf8"));
  installed.packages["node_modules/vite"].version = "5.0.0";
  await fs.writeFile(file, JSON.stringify(installed));
  assert.equal((await launch(f, "launch-web-preview.command")).code, 0);
  assert.deepEqual((await calls(f)).filter(r => r[0] === "npm"), [["npm", "1", f.project, "ci"]]);
  assert.equal(JSON.parse(await fs.readFile(file, "utf8")).packages["node_modules/vite"].version, directVersions.vite);
});

macTest("npm ci failure preserves its status and never starts Electron", async t => {
  const f = await fixture(t, { ready: false });
  f.env.LAUNCH_TEST_NPM_STATUS = "19";
  assert.equal((await launch(f)).code, 19);
  assert.equal(helperCalls(await calls(f)).length, 0);
});

macTest("a reported successful but incomplete install does not launch", async t => {
  const f = await fixture(t, { ready: false });
  f.env.LAUNCH_TEST_NPM_COMPLETE = "0";
  const result = await launch(f);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /incomplete after npm ci/);
  assert.equal(helperCalls(await calls(f)).length, 0);
});

macTest("complete locked dependencies need no npm and preview needs no Electron executable", async t => {
  const f = await fixture(t, { electron: false });
  f.env.CODEX_MESSENGER_NPM_PATH = path.join(f.temp, "npm intentionally unavailable");
  assert.equal((await launch(f, "launch-web-preview.command")).code, 0);
  const records = await calls(f);
  assert.equal(records.some(r => r[0] === "npm" || r[0] === "open"), false);
  assert.deepEqual(helperCalls(records), [["node", f.node, "1", f.project, path.join(f.project, "scripts/web-preview.mjs")]]);
});

macTest("Finder PATH discovers newest compatible NVM semantically rather than lexically", async t => {
  const f = await fixture(t, { version: "v16.20.2" });
  delete f.env.CODEX_MESSENGER_NODE_PATH;
  await nodeMock(path.join(f.env.NVM_DIR, "versions/node/v24.9.0/bin/node"), "v24.9.0");
  const newest = await nodeMock(path.join(f.env.NVM_DIR, "versions/node/v24.15.0/bin/node"), "v24.15.0");
  await nodeMock(path.join(f.env.NVM_DIR, "versions/node/v20.18.0/bin/node"), "v20.18.0");
  assert.equal((await launch(f)).code, 0);
  assert.equal(helperCalls(await calls(f))[0][1], newest);
});

macTest("a compatible PATH runtime remains preferred to a newer NVM runtime", async t => {
  const f = await fixture(t, { version: "v22.12.0" });
  delete f.env.CODEX_MESSENGER_NODE_PATH;
  await nodeMock(path.join(f.env.NVM_DIR, "versions/node/v24.15.0/bin/node"), "v24.15.0");
  assert.equal((await launch(f)).code, 0);
  const records = await calls(f);
  assert.equal(helperCalls(records)[0][1], f.node);
  assert.equal(records.some(r => r[0] === "node" && r[1].includes("controlled nvm")), false);
});

macTest("source runtime version checks follow the actual Vite engine boundaries", async t => {
  for (const [version, supported] of [
    ["v20.18.9", false], ["v20.19.0", true], ["v20.20.0", true],
    ["v21.7.0", false], ["v22.11.9", false], ["v22.12.0", true],
    ["v23.0.0", true], ["v24.19.0", true], ["v24.0.0-rc.1", false]
  ]) {
    await t.test(version, async sub => {
      const f = await fixture(sub, { version });
      const result = await launch(f, "launch-web-preview.command");
      assert.equal(result.code, supported ? 0 : 1);
      const records = await calls(f);
      assert.equal(helperCalls(records).length, supported ? 1 : 0);
      if (!supported) {
        assert.match(result.stderr, /Node.js/);
        assert.deepEqual(records.filter(r => r[0] === "open"), [["open", "1", "https://nodejs.org/en/download"]]);
      }
    });
  }
});

macTest("missing lockfile stops installation with an actionable message", async t => {
  const f = await fixture(t, { ready: false });
  await fs.rm(path.join(f.project, "package-lock.json"));
  const result = await launch(f);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /complete checkout/);
  assert.equal((await calls(f)).some(r => r[0] === "npm"), false);
});

macTest("preview delegates readiness and cleanup in the foreground and propagates exit status", async t => {
  const f = await fixture(t);
  f.env.LAUNCH_TEST_NODE_STATUS = "23";
  const result = await launch(f, "launch-web-preview.command", ["--smoke-test"]);
  assert.equal(result.code, 23);
  const records = await calls(f);
  assert.deepEqual(helperCalls(records), [["node", f.node, "2", f.project, path.join(f.project, "scripts/web-preview.mjs") + " --smoke-test"]]);
  assert.equal(records.some(r => r[0] === "npm" || r[0] === "open"), false);
});
