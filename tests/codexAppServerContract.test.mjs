import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { sandboxPolicyForMode } from "../shared/codexOptions.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

class JsonRpcClient {
  constructor(command, args = []) {
    this.child = spawn(command, args, {
      cwd: rootDir,
      stdio: ["pipe", "pipe", "pipe"]
    });
    this.buffer = "";
    this.nextId = 1;
    this.pending = new Map();
    this.notifications = [];
    this.stderr = "";
    this.child.stdout.on("data", (chunk) => this.read(chunk));
    this.child.stderr.on("data", (chunk) => { this.stderr += chunk.toString(); });
  }

  read(chunk) {
    this.buffer += chunk.toString();
    let newline = this.buffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      newline = this.buffer.indexOf("\n");
      if (!line) continue;
      const message = JSON.parse(line);
      if (message.id !== undefined && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
      } else {
        this.notifications.push(message);
      }
    }
  }

  request(method, params = {}) {
    const id = this.nextId++;
    this.child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for ${method}. stderr=${this.stderr}`));
      }, 3000);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        }
      });
    });
  }

  notify(method, params = undefined) {
    this.child.stdin.write(`${JSON.stringify(params === undefined ? { method } : { method, params })}\n`);
  }

  close() {
    this.child.kill();
  }
}

async function writeFakeCodexAppServer(dir) {
  const script = path.join(dir, "fake-codex-app-server.mjs");
  await fs.writeFile(script, `
import readline from "node:readline";

let initialized = false;
let experimentalApi = false;
let nextThread = 1;
let nextTurn = 1;
const threads = new Map();

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\\n");
}

function fail(id, message) {
  send({ id, error: { code: -32000, message } });
}

function assertExperimentalCapability(id, method, params) {
  for (const key of ["persistExtendedHistory", "experimentalRawEvents", "persistFullHistory"]) {
    if (Object.prototype.hasOwnProperty.call(params, key)) {
      if (!experimentalApi) {
        fail(id, method + "." + key + " requires experimentalApi capability");
        return false;
      }
    }
  }
  return true;
}

function textFromInput(input) {
  return (input || []).map((item) => item.text || item.path || "").filter(Boolean).join("\\n");
}

readline.createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.trim()) return;
  const message = JSON.parse(line);
  const { id, method, params = {} } = message;
  if (!id && method === "initialized") return;
  if (method !== "initialize" && !initialized) return fail(id, "Not initialized");

  if (method === "initialize") {
    initialized = true;
    experimentalApi = params.capabilities?.experimentalApi === true;
    send({ id, result: { userAgent: "fake-codex/1.0", codexHome: "/tmp/fake-codex", platformFamily: "unix", platformOs: "test" } });
    return;
  }

  if (method === "thread/start") {
    if (!assertExperimentalCapability(id, method, params)) return;
    const thread = { id: "thr_" + nextThread++, cwd: params.cwd, turns: [], preview: "New thread", createdAt: Date.now() / 1000, updatedAt: Date.now() / 1000 };
    threads.set(thread.id, thread);
    send({ id, result: { thread, model: params.model || "auto", modelProvider: "fake", cwd: params.cwd } });
    send({ method: "thread/started", params: { thread: { ...thread, status: { type: "idle" } } } });
    return;
  }

  if (method === "thread/resume") {
    if (!assertExperimentalCapability(id, method, params)) return;
    const thread = threads.get(params.threadId);
    if (!thread) return fail(id, "thread not found: " + params.threadId);
    send({ id, result: { thread: params.excludeTurns ? { ...thread, turns: [] } : thread, model: params.model || "auto", modelProvider: "fake", cwd: params.cwd || thread.cwd } });
    send({ method: "thread/started", params: { thread: { ...thread, status: { type: "idle" } } } });
    return;
  }

  if (method === "thread/list") {
    send({ id, result: { data: Array.from(threads.values()), nextCursor: null, backwardsCursor: null } });
    return;
  }

  if (method === "thread/read") {
    const thread = threads.get(params.threadId);
    if (!thread) return fail(id, "thread not found: " + params.threadId);
    send({ id, result: { thread: params.includeTurns ? thread : { ...thread, turns: [] } } });
    return;
  }

  if (method === "thread/turns/list") {
    const thread = threads.get(params.threadId);
    if (!thread) return fail(id, "thread not found: " + params.threadId);
    send({ id, result: { data: [...thread.turns].reverse(), nextCursor: null, backwardsCursor: null } });
    return;
  }

  if (method === "turn/start" || method === "turn/steer") {
    const thread = threads.get(params.threadId);
    if (!thread) return fail(id, "thread not found: " + params.threadId);
    const turn = {
      id: "turn_" + nextTurn++,
      status: "completed",
      items: [
        { id: "user_" + nextTurn, type: "user_message", text: textFromInput(params.input), createdAt: Date.now() / 1000 },
        { id: "agent_" + nextTurn, type: "agent_message", text: "received: " + textFromInput(params.input), createdAt: Date.now() / 1000 }
      ]
    };
    thread.turns.push(turn);
    thread.updatedAt = Date.now() / 1000;
    send({ id, result: method === "turn/steer" ? { turnId: turn.id } : { turn } });
    send({ method: "turn/started", params: { threadId: params.threadId, turn: { ...turn, status: "inProgress", items: [] } } });
    send({ method: "item/agentMessage/delta", params: { threadId: params.threadId, delta: "received" } });
    send({ method: "item/completed", params: { threadId: params.threadId, item: turn.items[1] } });
    send({ method: "turn/completed", params: { threadId: params.threadId, turn } });
    return;
  }

  if (method === "review/start") {
    const thread = threads.get(params.threadId);
    if (!thread) return fail(id, "thread not found: " + params.threadId);
    const turn = { id: "review_" + nextTurn++, status: "completed", items: [{ id: "review_item", type: "agent_message", text: "review ok" }] };
    thread.turns.push(turn);
    send({ id, result: { turn, reviewThreadId: params.threadId } });
    send({ method: "turn/completed", params: { threadId: params.threadId, turn } });
    return;
  }

  if (method === "thread/fork") {
    if (!assertExperimentalCapability(id, method, params)) return;
    const source = threads.get(params.threadId);
    if (!source) return fail(id, "thread not found: " + params.threadId);
    const thread = { ...source, id: "thr_" + nextThread++, turns: params.excludeTurns ? [] : [...source.turns], forkedFromId: source.id };
    threads.set(thread.id, thread);
    send({ id, result: { thread, model: params.model || "auto", modelProvider: "fake", cwd: params.cwd || source.cwd } });
    send({ method: "thread/started", params: { thread: { ...thread, status: { type: "idle" } } } });
    return;
  }

  if (method === "thread/compact/start" || method === "thread/name/set") {
    send({ id, result: {} });
    return;
  }

  fail(id, "Unsupported method: " + method);
});
`, "utf8");
  return script;
}

function threadStartParams(cwd) {
  return {
    model: null,
    modelProvider: null,
    cwd,
    approvalPolicy: "never",
    permissionProfile: null,
    config: {
      "mcp_servers": {},
      "features.apps": false,
      "features.plugins": false,
      "include_apps_instructions": false
    },
    baseInstructions: null,
    developerInstructions: "Test developer instruction",
    personality: "pragmatic",
    persistExtendedHistory: true
  };
}

function turnStartParams(threadId, text) {
  return {
    threadId,
    input: [{ type: "text", text, text_elements: [] }],
    cwd: null,
    approvalPolicy: "never",
    sandboxPolicy: sandboxPolicyForMode("workspaceWrite"),
    model: null,
    effort: null,
    summary: null
  };
}

test("Codex app-server contract covers auth, thread read/write, resume, steer, review, fork, and formatting", async (t) => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "codex-messenger-contract-"));
  t.after(async () => fs.rm(tmp, { recursive: true, force: true }));
  const fakeServer = await writeFakeCodexAppServer(tmp);
  const client = new JsonRpcClient(process.execPath, [fakeServer]);
  t.after(() => client.close());

  const init = await client.request("initialize", {
    clientInfo: { name: "codex-messenger", title: "Codex Messenger", version: "test" },
    capabilities: { experimentalApi: true }
  });
  client.notify("initialized");
  assert.equal(init.userAgent, "fake-codex/1.0");

  const started = await client.request("thread/start", threadStartParams(tmp));
  assert.match(started.thread.id, /^thr_/);
  assert.equal(started.thread.cwd, tmp);

  const firstTurn = await client.request("turn/start", turnStartParams(started.thread.id, "fait git pull"));
  assert.equal(firstTurn.turn.status, "completed");
  assert.equal(firstTurn.turn.items[0].type, "user_message");
  assert.equal(firstTurn.turn.items[1].text, "received: fait git pull");

  const read = await client.request("thread/read", { threadId: started.thread.id, includeTurns: true });
  assert.equal(read.thread.turns.length, 1);
  assert.equal(read.thread.turns[0].items[0].text, "fait git pull");

  const resumed = await client.request("thread/resume", {
    threadId: started.thread.id,
    history: null,
    path: null,
    model: null,
    modelProvider: null,
    cwd: tmp,
    approvalPolicy: "never",
    permissionProfile: null,
    config: threadStartParams(tmp).config,
    baseInstructions: null,
    developerInstructions: "resume instruction",
    personality: "pragmatic",
    excludeTurns: true,
    persistExtendedHistory: true
  });
  assert.equal(resumed.thread.id, started.thread.id);
  assert.deepEqual(resumed.thread.turns, []);

  const steered = await client.request("turn/steer", {
    threadId: started.thread.id,
    input: [{ type: "text", text: "ajoute les tests", text_elements: [] }],
    expectedTurnId: firstTurn.turn.id
  });
  assert.match(steered.turnId, /^turn_/);

  const turns = await client.request("thread/turns/list", {
    threadId: started.thread.id,
    cursor: null,
    limit: 10,
    sortDirection: "desc"
  });
  assert.equal(turns.data.length, 2);

  const review = await client.request("review/start", {
    threadId: started.thread.id,
    target: { type: "uncommittedChanges" },
    delivery: "inline"
  });
  assert.equal(review.reviewThreadId, started.thread.id);

  const forked = await client.request("thread/fork", {
    threadId: started.thread.id,
    model: null,
    modelProvider: null,
    cwd: tmp,
    approvalPolicy: "never",
    permissionProfile: null,
    config: threadStartParams(tmp).config,
    baseInstructions: null,
    developerInstructions: "fork instruction",
    ephemeral: false,
    excludeTurns: true,
    persistExtendedHistory: true
  });
  assert.notEqual(forked.thread.id, started.thread.id);
  assert.equal(forked.thread.forkedFromId, started.thread.id);

  const listed = await client.request("thread/list", {
    cursor: null,
    limit: 20,
    sortKey: "updated_at",
    sortDirection: "desc",
    modelProviders: null,
    sourceKinds: null,
    archived: null,
    cwd: null,
    useStateDbOnly: true,
    searchTerm: null
  });
  assert.equal(listed.data.length, 2);

  assert.ok(client.notifications.some((item) => item.method === "thread/started"));
  assert.ok(client.notifications.some((item) => item.method === "item/agentMessage/delta"));
  assert.ok(client.notifications.some((item) => item.method === "turn/completed"));
});

test("contract fake server requires experimentalApi for experimental thread history fields", async (t) => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "codex-messenger-contract-"));
  t.after(async () => fs.rm(tmp, { recursive: true, force: true }));
  const fakeServer = await writeFakeCodexAppServer(tmp);
  const client = new JsonRpcClient(process.execPath, [fakeServer]);
  t.after(() => client.close());

  await client.request("initialize", {
    clientInfo: { name: "codex-messenger", title: "Codex Messenger", version: "test" },
    capabilities: {}
  });
  client.notify("initialized");

  await assert.rejects(
    client.request("thread/start", { ...threadStartParams(tmp), persistExtendedHistory: true }),
    /requires experimentalApi capability/
  );
});
