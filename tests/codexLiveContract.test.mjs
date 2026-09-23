import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CodexAppServerClient } from "../electron/codexAppServerClient.js";

const executable = process.env.CODEX_MESSENGER_TEST_CODEX;

test("actual 0.156.1 binary: discovery, metadata and unmaterialized history capability", {
  skip: !executable,
  timeout: 30000
}, async (t) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "messenger-codex-contract-"));
  const home = path.join(temp, "codex-data");
  await fs.mkdir(home);
  const environment = {
    ...process.env,
    PATH: [path.dirname(process.execPath), process.env.PATH].filter(Boolean).join(path.delimiter),
    CODEX_HOME: home
  };
  for (const key of ["OPENAI_API_KEY", "CODEX_API_KEY", "CHATGPT_ACCESS_TOKEN", "OPENAI_ACCESS_TOKEN"]) {
    delete environment[key];
  }
  let client;
  t.after(async () => {
    const child = client?.child;
    client?.dispose();
    if (child && child.exitCode === null && child.signalCode === null) {
      await new Promise((resolve) => {
        const timeout = setTimeout(resolve, 2000);
        child.once("close", () => { clearTimeout(timeout); resolve(); });
      });
    }
    await fs.rm(temp, { recursive: true, force: true });
  });

  assert.match(execFileSync(executable, ["--version"], {
    encoding: "utf8", env: environment, timeout: 5000
  }), /^codex-cli 0\.156\.1\s*$/);

  client = new CodexAppServerClient({
    appVersion: () => "test",
    defaultCwd: () => temp,
    resolveCodexCommand: async () => ({ command: executable }),
    localizedInstructions: () => "",
    logDebug: () => {},
    loadedThreads: new Set(),
    requestTimeoutMs: 5000,
    spawnProcess: (command, args, options) => spawn(command, args, {
      ...options, env: { ...environment, CODEX_INTERNAL_ORIGINATOR_OVERRIDE: "Codex Messenger" }
    })
  });
  const initialization = await client.ensureReady();
  assert.ok(initialization.userAgent);
  assert.equal((await client.request("account/read", { refreshToken: false })).account, null);
  const models = await client.listModels();
  assert.ok(Array.isArray(models) && models.length > 0);
  assert.ok(Array.isArray((await client.request("collaborationMode/list", {})).data));
  assert.ok(Array.isArray((await client.request("skills/list", { cwds: [temp], forceReload: true })).data));

  // No authenticated turn is created: this fixture verifies public local
  // metadata, and cannot establish successful inference or persisted history.
  const threadId = await client.startThread({ kind: "project", cwd: temp }, temp, {
    sandbox: "readOnly", approvalPolicy: "never"
  });
  assert.ok(threadId);
  const metadata = await client.readThread(threadId, { includeTurns: false });
  assert.equal(metadata.id, threadId);
  assert.equal(metadata.cwd, temp);

  try {
    const turns = await client.listThreadTurns(threadId);
    assert.deepEqual(turns.data, []);
    assert.equal(turns.nextCursor, null);
    t.diagnostic("This empty thread supports history reads; persisted-history and inference remain untested.");
  } catch (error) {
    t.diagnostic(`Unmaterialized-history response: ${error.code}: ${error.message}`);
    if (error.code === -32600) {
      assert.match(error.message, /is not materialized yet; thread\/turns\/list is unavailable before first user message/i);
    } else {
      assert.equal(error.code, -32601);
      assert.match(error.message, /list_turns is not supported/i);
    }
    t.diagnostic("History is unavailable for this unmaterialized thread; metadata reads work.");
  }
});
