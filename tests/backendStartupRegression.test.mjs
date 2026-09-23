import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import path from "node:path";
import { CodexAppServerClient } from "../electron/codexAppServerClient.js";
import { createServerRequestsController } from "../electron/serverRequests.js";

const mainSource = await readFile(new URL("../electron/main.js", import.meta.url), "utf8");

function productionBlock(marker) {
  const start = mainSource.indexOf(marker);
  assert.ok(start >= 0, "Production callback must exist");
  const end = mainSource.indexOf("\n});", start);
  assert.ok(end > start, "Production callback must close");
  return mainSource.slice(start, end + 4);
}

function makeClient() {
  return new CodexAppServerClient({
    appVersion: () => "test", defaultCwd: () => "/tmp",
    resolveCodexCommand: async () => ({ command: "codex" }),
    localizedInstructions: () => "", logDebug: () => {},
    loadedThreads: new Set(["thread-old"]), requestTimeoutMs: 1000
  });
}

function mockChild(writes = []) {
  return {
    killed: false,
    stdin: { writable: true, write(line, callback) { writes.push(JSON.parse(line)); callback?.(); return true; } },
    kill() { this.killed = true; return true; }
  };
}

test("explicit client stop rejects pending RPCs and announces fully cleared state", async () => {
  const client = makeClient();
  const child = mockChild();
  client.child = child;
  client.ready = Promise.resolve();
  client.userAgent = "old-session";
  client.buffer = "partial";
  const states = [];
  client.on("status", (status) => states.push({
    status, child: client.child, pending: client.pending.size,
    loaded: client.loadedThreads.size, ready: client.ready, userAgent: client.userAgent
  }));
  const pending = client.request("test/pending");
  const rejected = assert.rejects(pending, /CLI updated/);
  client.stop("CLI updated");
  await rejected;
  assert.equal(child.killed, true);
  assert.equal(client.buffer, "");
  assert.deepEqual(states, [{
    status: { kind: "stopped", text: "CLI updated" }, child: null,
    pending: 0, loaded: 0, ready: null, userAgent: null
  }]);
});

test("production stop handler expires requests and turns before reused server wire IDs", async () => {
  const client = makeClient();
  const writes = [];
  client.child = mockChild(writes);
  const delivered = [];
  const resolved = [];
  const controller = createServerRequestsController({
    codex: client, resolveContact: () => "contact", deliver: (payload) => delivered.push(payload),
    resolved: (payload) => resolved.push(payload)
  });
  const activeTurnByThread = new Map([["thread", { id: "turn" }]]);
  const approvals = [];
  const realtimeStatuses = [];
  vm.runInNewContext(productionBlock('codex.on("status", (status) => {'), {
    codex: client, realtime: { onStatus: (status) => realtimeStatuses.push(status) },
    serverRequests: controller, activeTurnByThread,
    clearApprovalRequests: (reason) => approvals.push(reason),
    clearActiveTurn: (threadId) => activeTurnByThread.delete(threadId),
    logCodexRuntimeDiagnostics: () => {}, sendToMain: () => {}, sendToOpenChats: () => {}
  });
  const request = {
    id: 7, method: "item/tool/requestUserInput", params: {
      threadId: "thread", turnId: "turn", itemId: "item", questions: [{
        id: "target", header: "Action", question: "Proceed?", isOther: false, isSecret: false,
        options: [{ label: "Yes", description: "Continue" }, { label: "No", description: "Stop" }]
      }]
    }
  };
  assert.equal(controller.receive(request), true);
  assert.equal(controller.pending.size, 1);
  const oldId = delivered[0].id;
  client.stop("CLI updated");
  assert.equal(controller.pending.size, 0);
  assert.equal(activeTurnByThread.size, 0);
  assert.deepEqual(approvals, ["CLI updated"]);
  assert.equal(realtimeStatuses[0].kind, "stopped");
  assert.equal(resolved[0].decision, "expired");
  client.child = mockChild(writes);
  assert.equal(controller.receive(request), true);
  const newId = delivered[1].id;
  assert.notEqual(oldId, newId);
  const response = { answers: { target: { answers: ["Yes"] } } };
  assert.equal((await controller.respond({ requestId: oldId, response }, "contact")).ok, false);
  assert.equal(writes.length, 0);
  assert.equal((await controller.respond({ requestId: newId, response }, "contact")).ok, true);
  assert.deepEqual(writes, [{ id: 7, result: response }]);
  client.stop();
});

test("production startup still creates the window when the debug log cannot be written", async () => {
  const windows = [];
  const trays = [];
  const warnings = [];
  const logEntries = [];
  await vm.runInNewContext(productionBlock("if (hasSingleInstanceLock) app.whenReady().then(async () => {"), {
    hasSingleInstanceLock: true, protocol: {}, rootDir: "/tmp/app", path, installMsnAssetProtocol() {},
    app: { whenReady: () => Promise.resolve(), getVersion: () => "test", isPackaged: false, on: () => {} },
    process: { platform: "linux" }, isDev: false,
    ensureDebugLogFile: async () => { throw Object.assign(new Error("private error details"), { code: "ENOSPC" }); },
    console: { warn: (message) => warnings.push(message) },
    logDebug: (event, details) => logEntries.push({ event, details }),
    createTray: () => trays.push(true), createMainWindow: () => windows.push(true), showMainWindow: () => {}
  });
  assert.equal(windows.length, 1);
  assert.equal(trays.length, 1);
  assert.deepEqual(warnings, ["Codex Messenger: debug log unavailable (ENOSPC)."]);
  assert.equal(logEntries[0].event, "app.start");
  assert.equal(logEntries[0].details.logPath, null);
});
