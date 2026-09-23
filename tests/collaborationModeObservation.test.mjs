import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { CodexAppServerClient, sanitizeObservedCollaborationMode } from "../electron/codexAppServerClient.js";

function clientFixture() {
  const client = new CodexAppServerClient({ appVersion: () => "test", defaultCwd: () => "/tmp", resolveCodexCommand: async () => ({ command: "codex" }), localizedInstructions: () => "", logDebug: () => {}, loadedThreads: new Set() });
  client.ensureReady = async () => {};
  const calls = [];
  let response = null;
  client.request = async (method, params) => { calls.push({ method, params }); return method === "thread/resume" ? response : { turn: { id: "turn" } }; };
  return { client, calls, setResponse: value => { response = value; } };
}
const observedPlan = { mode: "plan", settings: { model: "server-model", reasoning_effort: "high", developer_instructions: "private server instruction" }, unexpected: "private data" };

test("resume observes the server mode before a first prompt without overriding user Auto choices", async () => {
  const f = clientFixture();
  f.setResponse({ thread: { id: "thread" }, collaborationMode: observedPlan });
  const observations = [];
  f.client.on("collaboration-mode", payload => observations.push(payload));
  await f.client.resumeThread("thread");
  const expected = { mode: "plan", settings: { model: "server-model", reasoning_effort: "high" } };
  assert.deepEqual(f.client.getObservedCollaborationMode("thread"), expected);
  assert.deepEqual(observations, [{ threadId: "thread", collaborationMode: expected }]);
  assert.equal(JSON.stringify(observations).includes("private"), false);
  await f.client.startTurn("thread", "Continue");
  const turn = f.calls.find(call => call.method === "turn/start").params;
  assert.equal(turn.model, null); assert.equal(turn.effort, null);
  assert.equal(Object.hasOwn(turn, "collaborationMode"), false);
  assert.equal(f.calls[0].method, "thread/resume");
  f.client.stop();
});

test("observations are independent per thread, reset on old responses and stop, and never replace explicit choices", async () => {
  const f = clientFixture();
  f.setResponse({ thread: { id: "first" }, collaborationMode: observedPlan });
  await f.client.resumeThread("first");
  const copy = f.client.getObservedCollaborationMode("first");
  copy.settings.model = "mutated"; copy.mode = "default";
  assert.equal(f.client.getObservedCollaborationMode("first").settings.model, "server-model");
  f.setResponse({ thread: { id: "second" } }); await f.client.resumeThread("second");
  assert.equal(f.client.getObservedCollaborationMode("second"), null);
  assert.equal(f.client.getObservedCollaborationMode("first").mode, "plan");
  const explicit = { collaborationMode: { mode: "default", settings: { model: "chosen-model", reasoning_effort: "low" } } };
  await f.client.startTurn("first", "Continue", explicit);
  const turn = f.calls.find(call => call.method === "turn/start").params;
  assert.equal(turn.collaborationMode.mode, "default");
  assert.equal(turn.collaborationMode.settings.model, "chosen-model");
  f.setResponse({ thread: { id: "first" } }); await f.client.resumeThread("first");
  assert.equal(f.client.getObservedCollaborationMode("first"), null);
  f.setResponse({ thread: { id: "first" }, collaborationMode: observedPlan }); await f.client.resumeThread("first");
  f.client.stop("restart");
  assert.equal(f.client.getObservedCollaborationMode("first"), null);
  assert.equal(f.client.loadedThreads.size, 0);
});

test("malformed collaboration modes remain unobserved and raw instructions are never retained", () => {
  for (const value of [null, {}, { mode: "unknown", settings: { model: "m" } }, { mode: "plan", settings: [] }, { mode: "plan", settings: { model: null } }, { mode: "plan", settings: { model: "" } }, { mode: "plan", settings: { model: "m\0private" } }, { mode: "plan", settings: { model: "m".repeat(257) } }]) assert.equal(sanitizeObservedCollaborationMode(value), null);
  assert.deepEqual(sanitizeObservedCollaborationMode({ mode: "default", settings: { model: "m", reasoning_effort: { private: "not public" }, developer_instructions: "private" } }), { mode: "default", settings: { model: "m", reasoning_effort: null } });
});

test("preload forwards the exact readonly voice getter and scalar preference setter contracts", async () => {
  const source = await readFile(new URL("../electron/preload.cjs", import.meta.url), "utf8");
  const calls = []; let api;
  vm.runInNewContext(source, { require: name => {
    assert.equal(name, "electron");
    return { contextBridge: { exposeInMainWorld(name, value) { assert.equal(name, "codexMsn"); api = value; } }, ipcRenderer: { invoke: (...args) => calls.push(args) }, webUtils: {} };
  } });
  api.realtimeVoicePreference(); api.realtimeSetVoicePreference("sage"); api.realtimeSetVoicePreference(null);
  assert.deepEqual(calls, [["realtime:voice-preference"], ["realtime:set-voice-preference", "sage"], ["realtime:set-voice-preference", null]]);
});

test("a resume response settled immediately before stop cannot restore stale loaded state or mode", async () => {
  const f = clientFixture();
  let settle;
  f.client.request = () => new Promise(resolve => { settle = resolve; });
  const resumed = f.client.resumeThread("stale-thread");
  await Promise.resolve();
  const rejection = assert.rejects(resumed, /connection changed/);
  settle({ thread: { id: "stale-thread" }, collaborationMode: observedPlan });
  f.client.stop("restart before resume continuation");
  await rejection;
  assert.equal(f.client.getObservedCollaborationMode("stale-thread"), null);
  assert.equal(f.client.loadedThreads.size, 0);
});
