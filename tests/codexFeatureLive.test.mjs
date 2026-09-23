import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import { CodexAppServerClient } from "../electron/codexAppServerClient.js";
import { createCodexFeatureService } from "../electron/codexFeatureService.js";
import { createTerminalService } from "../electron/terminalService.js";
import { EventEmitter } from "node:events";

const execFileAsync = promisify(execFile);
const enabled = process.env.CODEX_MESSENGER_LIVE_PROTOCOL_TEST === "1";
const sandboxAvailable = existsSync("/usr/bin/sandbox-exec");

test("current local CLI feature catalog truthfully reports unavailable runtime methods without account or network", {
  skip: !enabled ? "Set CODEX_MESSENGER_LIVE_PROTOCOL_TEST=1 to check the installed CLI" : !sandboxAvailable ? "This isolated check requires the macOS network sandbox" : false,
  timeout: 45_000
}, async (t) => {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "codex-messenger-live-protocol-"));
  const isolatedHome = path.join(fixture, "codex-home");
  const workspace = path.join(fixture, "workspace");
  await fs.mkdir(isolatedHome); await fs.mkdir(workspace);
  t.after(() => fs.rm(fixture, { recursive: true, force: true }));
  const executable = process.env.CODEX_MESSENGER_LIVE_CODEX_PATH || "codex";
  const version = (await execFileAsync(executable, ["--version"])).stdout.trim();
  assert.match(version, /codex-cli \d+\.\d+\.\d+/);
  const client = new CodexAppServerClient({
    appVersion: () => "test", defaultCwd: () => workspace,
    resolveCodexCommand: async () => ({ command: executable }),
    localizedInstructions: () => "Local protocol validation only.",
    logDebug: () => {}, loadedThreads: new Set(), requestTimeoutMs: 8_000,
    spawnProcess: (command, args, options) => {
      // This override is scoped to a child process: the user's settings/account stay untouched.
      const environment = { ...options.env, CODEX_HOME: isolatedHome };
      for (const key of ["OPENAI_API_KEY", "CODEX_API_KEY", "CHATGPT_ACCESS_TOKEN", "OPENAI_ACCESS_TOKEN"]) delete environment[key];
      return spawn("/usr/bin/sandbox-exec", ["-p", "(version 1) (allow default) (deny network*)", command, ...args,
        "--disable", "apps", "--disable", "plugins", "-c", "mcp_servers={}", "-c", "analytics.enabled=false"], { ...options, env: environment });
    }
  });
  t.after(() => client.dispose());
  await client.ensureReady();
  const service = createCodexFeatureService({ codex: client, defaultCwd: () => workspace, resolveContext: () => ({ cwd: workspace, threadId: null }) });
  const catalog = await service.catalog();
  assert.equal(catalog.sections.account.available, true);
  assert.equal(catalog.sections.account.data.account, null);
  assert.equal(catalog.sections.thread, undefined);
  for (const section of Object.values(catalog.sections)) {
    assert.equal(typeof section.available, "boolean");
    if (!section.available) { assert.equal(section.data, null); assert.ok(section.error); assert.notEqual(section.status, "available"); }
  }
  const summary = Object.fromEntries(Object.entries(catalog.sections).map(([name, section]) => [name, section.status]));
  // Diagnostics contain capability statuses only, no account, tokens or model output.
  t.diagnostic(`${version}: ${JSON.stringify(summary)}`);
  const knownMethod = Object.values(catalog.sections).filter((section) => section.available).length;
  assert.ok(knownMethod >= 3, "The current CLI must answer core read-only catalog methods");
  const sender = new EventEmitter(); sender.isDestroyed = () => false;
  const output = []; let completed;
  const done = new Promise((resolve) => { completed = resolve; });
  const terminal = createTerminalService({ codex: client, resolveContext: async () => ({ cwd: workspace, contactId: "fixture", codexOptions: { sandbox: "externalSandbox" } }),
    shell: "/bin/sh", deliver: (_sender, payload) => { output.push(payload); if (payload.done) completed(payload); } });
  t.after(() => terminal.dispose());
  await terminal.start({ sender }, { contactId: "fixture", command: "printf 'messenger-terminal-fixture\\n'" });
  const result = await done;
  assert.equal(result.error, undefined); assert.equal(result.exitCode, 0);
  assert.equal(output.map((entry) => entry.text || "").join("").replace(/\r/g, ""), "messenger-terminal-fixture\n");
  t.diagnostic("Real command/exec PTY echo verified inside explicit external deny-network sandbox");
});
