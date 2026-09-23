import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { createTerminalService, registerTerminalIpcHandlers, terminalCommandArgv } from "../electron/terminalService.js";

const tick = () => new Promise((resolve) => setImmediate(resolve));
function fixture(t, options = {}) {
  const calls = []; const output = []; const pending = new Map();
  const codex = new EventEmitter(); codex.ensureReady = async () => {};
  codex.request = async (method, params) => {
    calls.push({ method, params });
    if (method === "command/exec") return new Promise((resolve, reject) => pending.set(params.processId, { resolve, reject }));
    return {};
  };
  const sender = new EventEmitter(); sender.isDestroyed = () => false;
  const service = createTerminalService({ codex, resolveContext: async (request) => {
    if (request.contactId !== "fixture-contact") throw new Error("Contact inconnu");
    return { contactId: request.contactId, threadId: "fixture-thread", cwd: process.cwd(), codexOptions: { sandbox: "readOnly", ...options } };
  }, deliver: (_sender, payload) => output.push(payload), shell: "/bin/sh" });
  t.after(() => service.dispose());
  return { codex, sender, event: { sender }, service, calls, pending, output, payload: { contactId: "fixture-contact", threadId: "fixture-thread", command: "printf fixture" } };
}

test("terminal execution uses exact server PTY fields and selected read-only policy", async (t) => {
  const f = fixture(t); const result = await f.service.start(f.event, f.payload);
  const call = f.calls[0]; assert.equal(call.method, "command/exec");
  assert.deepEqual(call.params.command, process.platform === "win32"
    ? [process.env.ComSpec || "cmd.exe", "/d", "/s", "/c", "printf fixture"]
    : ["/bin/sh", "-c", "printf fixture"]);
  assert.deepEqual(call.params.sandboxPolicy, { type: "readOnly", networkAccess: false });
  assert.equal(call.params.permissionProfile, undefined);
  assert.equal(call.params.processId, result.sessionId); assert.equal(call.params.tty, true);
  assert.equal(call.params.streamStdin, true); assert.equal(call.params.streamStdoutStderr, true);
  assert.deepEqual(call.params.size, { cols: 80, rows: 24 }); assert.equal(call.params.timeoutMs, 60000);
  assert.equal(call.params.approvalPolicy, undefined, "Standalone protocol has no approvalPolicy field");
  f.pending.get(result.sessionId).resolve({ exitCode: 0, stdout: "", stderr: "" }); await tick();
  assert.equal(f.output.at(-1).done, true); assert.equal(f.output.at(-1).exitCode, 0);
});

test("named permissions are sent without an overriding sandbox policy", async (t) => {
  const f = fixture(t, { permissions: ":workspace" }); await f.service.start(f.event, f.payload);
  assert.equal(f.calls[0].params.permissionProfile, ":workspace");
  assert.equal(f.calls[0].params.sandboxPolicy, undefined);
});

test("streamed base64 bytes decode split Unicode exactly once and final output is deferred", async (t) => {
  const f = fixture(t); const { sessionId } = await f.service.start(f.event, f.payload);
  const bytes = Buffer.from("été 🦋\n");
  for (const chunk of [bytes.subarray(0, 1), bytes.subarray(1, 7), bytes.subarray(7)]) f.codex.emit("notification", {
    method: "command/exec/outputDelta", params: { processId: sessionId, stream: "stdout", deltaBase64: chunk.toString("base64"), capReached: false }
  });
  assert.equal(f.output.map((entry) => entry.text || "").join(""), "été 🦋\n");
  assert.equal(f.output.some((entry) => entry.done), false);
  f.pending.get(sessionId).resolve({ exitCode: 0, stdout: "", stderr: "" }); await tick();
  assert.equal(f.output.map((entry) => entry.text || "").join(""), "été 🦋\n");
});

test("stdin, PTY resize and stop belong exclusively to the initiating window", async (t) => {
  const f = fixture(t); const { sessionId } = await f.service.start(f.event, f.payload);
  const other = { sender: new EventEmitter() };
  await assert.rejects(f.service.write(other, { sessionId, data: "bad" }), /appartient/);
  await assert.rejects(f.service.resize(other, { sessionId, cols: 80, rows: 24 }), /appartient/);
  await assert.rejects(f.service.stop(other, { sessionId }), /appartient/);
  await f.service.write(f.event, { sessionId, data: "\x03" });
  assert.deepEqual(f.calls.at(-1), { method: "command/exec/write", params: { processId: sessionId, deltaBase64: "Aw==", closeStdin: false } });
  await f.service.resize(f.event, { sessionId, cols: 100, rows: 40 });
  assert.deepEqual(f.calls.at(-1), { method: "command/exec/resize", params: { processId: sessionId, size: { cols: 100, rows: 40 } } });
  await f.service.stop(f.event, { sessionId }); assert.equal(f.calls.at(-1).method, "command/exec/terminate");
  f.pending.get(sessionId).resolve({ exitCode: 130, stdout: "", stderr: "" }); await tick();
  await assert.rejects(f.service.write(f.event, { sessionId, data: "late" }), /terminée/);
});

test("terminal validates commands, dimensions, stdin and session limits before unsafe requests", async (t) => {
  const f = fixture(t);
  await assert.rejects(f.service.start(f.event, { ...f.payload, command: "bad\0value" }), /invalide/);
  await assert.rejects(f.service.start(f.event, { ...f.payload, cols: 500000 }), /Dimensions/);
  await assert.rejects(f.service.start(f.event, { ...f.payload, contactId: "unknown" }), /inconnu/);
  assert.equal(f.calls.length, 0);
  const result = await f.service.start(f.event, f.payload);
  await assert.rejects(f.service.write(f.event, { sessionId: result.sessionId, data: "a".repeat(64001) }), /invalide/);
  await f.service.start(f.event, f.payload);
  await assert.rejects(f.service.start(f.event, f.payload), /Limite/);
});

test("connection failures and renderer closure finish sessions and terminate owned processes", async (t) => {
  const f = fixture(t); await f.service.start(f.event, f.payload);
  f.sender.emit("destroyed"); await tick();
  assert.ok(f.calls.some((call) => call.method === "command/exec/terminate"));
  assert.equal(f.output.at(-1).done, true);
  await f.service.start(f.event, f.payload); f.codex.emit("status", { kind: "exit" });
  assert.equal(f.output.at(-1).done, true); assert.match(f.output.at(-1).error, /interrompue/);
});

test("the IPC surface exposes only validated terminal operations and the Windows shell is derived locally", () => {
  const handlers = new Map(); const service = { start() {}, write() {}, resize() {}, stop() {} };
  registerTerminalIpcHandlers({ ipcMain: { handle: (name, handler) => handlers.set(name, handler) }, service });
  assert.deepEqual([...handlers.keys()], ["terminal:start", "terminal:write", "terminal:resize", "terminal:stop"]);
  assert.deepEqual(terminalCommandArgv("echo fixture", { platform: "win32", shell: "/bin/sh" }), [process.env.ComSpec || "cmd.exe", "/d", "/s", "/c", "echo fixture"]);
  assert.deepEqual(terminalCommandArgv("printf fixture", { platform: "darwin", shell: "/bin/sh" }), ["/bin/sh", "-c", "printf fixture"]);
  assert.equal(terminalCommandArgv("echo fixture", { platform: "darwin", shell: "relative-shell" })[0], "/bin/sh");
});
