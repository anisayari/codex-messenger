import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modes = ["run", "--debug", "debug", "--logs", "logs", "--telemetry", "telemetry", "--verify", "verify"];
const bashTest = (name, fn) => test(name, { skip: process.platform === "win32" }, fn);

async function fixture(t, { running = false, sequence = "", statuses = {} } = {}) {
  const temp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "codex build launcher ")));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const project = path.join(temp, "project with spaces");
  const bin = path.join(temp, "mock commands");
  const script = path.join(project, "script/build_and_run.sh");
  const callsFile = path.join(temp, "calls.jsonl");
  const alive = path.join(temp, "simulated existing app");
  const bundle = path.join(project, "release/macos/mac-arm64/Codex Messenger.app");
  const driver = path.join(temp, "mock driver.cjs");
  const bashEnv = path.join(temp, "controlled bash environment");
  await fs.mkdir(path.dirname(script), { recursive: true });
  await fs.mkdir(bin, { recursive: true });
  // Execute the unchanged production script; only its commands are simulated.
  await fs.copyFile(path.join(root, "script/build_and_run.sh"), script);
  await fs.writeFile(callsFile, "");
  if (running) await fs.writeFile(alive, "existing app remains alive\n");
  await fs.writeFile(driver, `
const fs = require("node:fs");
const [command, ...args] = process.argv.slice(2);
const env = process.env;
fs.appendFileSync(env.BUILD_RUN_TEST_CALLS, JSON.stringify({command, args, cwd: process.cwd()}) + "\\n");
const statuses = JSON.parse(env.BUILD_RUN_TEST_STATUSES);
if (Object.hasOwn(statuses, command)) process.exit(statuses[command]);
if (command === "pgrep") {
  const sequence = env.BUILD_RUN_TEST_SEQUENCE.split(",").filter(Boolean).map(Number);
  if (sequence.length) {
    const counter = env.BUILD_RUN_TEST_COUNTER;
    const index = fs.existsSync(counter) ? Number(fs.readFileSync(counter, "utf8")) : 0;
    fs.writeFileSync(counter, String(index + 1));
    process.exit(sequence[Math.min(index, sequence.length - 1)]);
  }
  process.exit(fs.existsSync(env.BUILD_RUN_TEST_ALIVE) ? 0 : 1);
}
if (command === "pkill") fs.rmSync(env.BUILD_RUN_TEST_ALIVE, {force: true});
if (command === "npm") fs.mkdirSync(env.BUILD_RUN_TEST_BUNDLE, {recursive: true});
if (command === "open") fs.writeFileSync(env.BUILD_RUN_TEST_ALIVE, "simulated app opened\\n");
process.exit(0);
`);
  for (const command of ["pgrep", "pkill", "npm", "open", "log", "lldb", "sleep"]) {
    const file = path.join(bin, command);
    await fs.writeFile(file, `#!/bin/bash\nexec "$BUILD_RUN_TEST_NODE" "$BUILD_RUN_TEST_DRIVER" ${command} "$@"\n`);
    await fs.chmod(file, 0o755);
  }
  // Bash functions also intercept the two absolute macOS commands, without
  // modifying the script or allowing a real application/log stream to start.
  await fs.writeFile(bashEnv, 'function /usr/bin/open() { "$BUILD_RUN_TEST_BIN/open" "$@"; }\nfunction /usr/bin/log() { "$BUILD_RUN_TEST_BIN/log" "$@"; }\n');
  const env = {
    ...process.env,
    PATH: bin + ":/usr/bin:/bin:/usr/sbin:/sbin",
    BASH_ENV: bashEnv,
    BUILD_RUN_TEST_BIN: bin,
    BUILD_RUN_TEST_NODE: process.execPath,
    BUILD_RUN_TEST_DRIVER: driver,
    BUILD_RUN_TEST_CALLS: callsFile,
    BUILD_RUN_TEST_ALIVE: alive,
    BUILD_RUN_TEST_BUNDLE: bundle,
    BUILD_RUN_TEST_SEQUENCE: sequence,
    BUILD_RUN_TEST_COUNTER: path.join(temp, "probe counter"),
    BUILD_RUN_TEST_STATUSES: JSON.stringify(statuses)
  };
  delete env.POSIXLY_CORRECT;
  return { temp, project, script, callsFile, alive, bundle, env };
}

async function launch(f, mode) {
  try {
    return { code: 0, ...await execFileAsync("/bin/bash", [f.script, mode], { cwd: f.temp, env: f.env, timeout: 10000 }) };
  } catch (error) {
    return { code: error.code, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
  }
}

async function calls(f) {
  return (await fs.readFile(f.callsFile, "utf8")).trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
}

bashTest("an already-open app is preserved and prevents every build mode", async t => {
  for (const mode of modes) await t.test(mode, async t => {
    const f = await fixture(t, { running: true });
    const result = await launch(f, mode);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /close.*manually.*before.*rebuild/i);
    assert.equal(await fs.readFile(f.alive, "utf8"), "existing app remains alive\n");
    assert.deepEqual(await calls(f), [{ command: "pgrep", args: ["-x", "Codex Messenger"], cwd: f.project }]);
  });
});

bashTest("all build modes retain their native arguments and paths with spaces", async t => {
  for (const mode of modes) await t.test(mode, async t => {
    const f = await fixture(t);
    assert.equal((await launch(f, mode)).code, 0);
    const expected = [
      { command: "pgrep", args: ["-x", "Codex Messenger"], cwd: f.project },
      { command: "npm", args: ["run", "package:mac:dir"], cwd: f.project }
    ];
    if (mode.includes("debug")) expected.push({ command: "lldb", args: ["--", f.bundle + "/Contents/MacOS/Codex Messenger"], cwd: f.project });
    else {
      expected.push({ command: "open", args: ["-n", f.bundle], cwd: f.project });
      if (mode.includes("logs") || mode.includes("telemetry")) expected.push({ command: "log", args: ["stream", "--info", "--style", "compact", "--predicate", 'process == "Codex Messenger"'], cwd: f.project });
      if (mode.includes("verify")) expected.push({ command: "pgrep", args: ["-x", "Codex Messenger"], cwd: f.project });
    }
    assert.deepEqual(await calls(f), expected);
  });
});

bashTest("a failed process probe prevents rebuilding instead of assuming absence", async t => {
  for (const code of [2, 3, 127]) await t.test(String(code), async t => {
    const f = await fixture(t, { statuses: { pgrep: code } });
    const result = await launch(f, "run");
    assert.equal(result.code, code);
    assert.match(result.stderr, /unable to check/i);
    assert.deepEqual((await calls(f)).map(call => call.command), ["pgrep"]);
  });
});

bashTest("build, open, debugger and log failures keep their status and stop later commands", async t => {
  for (const [command, mode, expected] of [
    ["npm", "run", ["pgrep", "npm"]],
    ["open", "--verify", ["pgrep", "npm", "open"]],
    ["lldb", "--debug", ["pgrep", "npm", "lldb"]],
    ["log", "--logs", ["pgrep", "npm", "open", "log"]]
  ]) await t.test(command, async t => {
    const f = await fixture(t, { statuses: { [command]: 19 } });
    assert.equal((await launch(f, mode)).code, 19);
    assert.deepEqual((await calls(f)).map(call => call.command), expected);
  });
});

bashTest("verify retries absence, observes startup and rejects an inspection error", async t => {
  const started = await fixture(t, { sequence: "1,1,0" });
  assert.equal((await launch(started, "--verify")).code, 0);
  assert.deepEqual((await calls(started)).map(call => call.command), ["pgrep", "npm", "open", "pgrep", "sleep", "pgrep"]);
  const failed = await fixture(t, { sequence: "1,3" });
  const result = await launch(failed, "--verify");
  assert.equal(result.code, 3);
  assert.match(result.stderr, /unable to check/i);
  assert.deepEqual((await calls(failed)).map(call => call.command), ["pgrep", "npm", "open", "pgrep"]);
});

bashTest("an invalid mode exits before inspecting processes or running commands", async t => {
  const f = await fixture(t, { running: true });
  const result = await launch(f, "invalid");
  assert.equal(result.code, 2);
  assert.match(result.stderr, /usage:/);
  assert.deepEqual(await calls(f), []);
  assert.equal(await fs.readFile(f.alive, "utf8"), "existing app remains alive\n");
});
