import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CodexAppServerClient } from "../electron/codexAppServerClient.js";

const enabled = process.env.CODEX_MESSENGER_AUTHENTICATED_LIVE_TEST === "1";
const executable = process.env.CODEX_MESSENGER_TEST_CODEX;
const expected = "CODEX-MSN-OK";
const options = { sandbox: "readOnly", approvalPolicy: "never" };

function publicFailure(error) {
  const message = typeof error?.message === "string" ? error.message : "";
  const cause = /quota|usage limit|rate limit|exceed.*limit/i.test(message) ? "quota or rate limit"
    : /auth|unauthoriz|login|log in|token.*expired|401|403/i.test(message) ? "authentication rejected"
    : /network|connect|timeout|timed out|websocket|transport/i.test(message) ? "transport or deadline"
    : /not supported|unavailable|materialized/i.test(message) ? "runtime capability unavailable"
    : "runtime rejected the operation";
  return new Error(`Authenticated fixture failed: ${cause}; code=${typeof error?.code === "number" ? error.code : "unavailable"}`);
}

function containsReply(turns) {
  return turns.some((turn) => (turn.items || []).some((item) => item.type === "agentMessage" && item.text?.trim() === expected));
}

test("authenticated actual CLI: streamed reply, persisted reload, search, occurrences, resume and fork", {
  skip: !enabled ? "Set CODEX_MESSENGER_AUTHENTICATED_LIVE_TEST=1 for existing CLI authentication only"
    : !executable ? "Set CODEX_MESSENGER_TEST_CODEX to the current CLI executable" : false,
  timeout: 60000
}, async (t) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "messenger-codex-authenticated-"));
  await fs.chmod(temp, 0o700);
  const home = path.join(temp, "codex-home");
  const workspace = path.join(temp, "workspace");
  await fs.mkdir(home, { mode: 0o700 });
  await fs.mkdir(workspace, { mode: 0o700 });
  let client;
  let watchdog;
  const methods = {};
  let completionReject;
  let completionResolve;
  let threadId;
  let turnId;
  let stream = "";
  let deltaCount = 0;
  let finalReply = "";
  let stage = "authentication";
  const deadline = Date.now() + 55000;

  async function stopClient() {
    const child = client?.child;
    client?.dispose();
    if (child && child.exitCode === null && child.signalCode === null) {
      await new Promise((resolve) => {
        const timeout = setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 2000);
        child.once("close", () => { clearTimeout(timeout); resolve(); });
      });
    }
  }
  t.after(async () => {
    clearTimeout(watchdog);
    await stopClient();
    await fs.rm(temp, { recursive: true, force: true });
    t.diagnostic(JSON.stringify({ stage, methods, deltaCount }));
  });

  const sourceHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  try {
    await fs.copyFile(path.join(sourceHome, "auth.json"), path.join(home, "auth.json"));
    await fs.chmod(path.join(home, "auth.json"), 0o600);
  } catch (error) {
    if (error.code === "ENOENT") {
      t.skip("Existing authentication has no file-backed auth.json; credentials were not extracted from another store.");
      return;
    }
    throw new Error("Unable to create the private authentication fixture.");
  }
  const environment = {
    ...process.env,
    CODEX_HOME: home,
    PATH: [path.dirname(process.execPath), process.env.PATH].filter(Boolean).join(path.delimiter)
  };
  for (const key of ["OPENAI_API_KEY", "CODEX_API_KEY", "CHATGPT_ACCESS_TOKEN", "OPENAI_ACCESS_TOKEN"]) delete environment[key];
  assert.match(execFileSync(executable, ["--version"], { encoding: "utf8", env: environment, timeout: 5000 }), /^codex-cli 0\.156\.1\s*$/);
  const login = execFileSync(executable, ["login", "status"], { encoding: "utf8", env: environment, timeout: 5000, stdio: ["ignore", "pipe", "pipe"] });
  // Login status normally goes to stderr. The real authenticated turn below is
  // the authority; no account identity or credential contents are displayed.
  void login;

  function createClient() {
    const instance = new CodexAppServerClient({
      appVersion: () => "test", defaultCwd: () => workspace,
      resolveCodexCommand: async () => ({ command: executable }),
      localizedInstructions: () => "", logDebug: (_event, fields) => {
        if (fields?.method) methods[fields.method] = (methods[fields.method] || 0) + 1;
      }, loadedThreads: new Set(), requestTimeoutMs: Math.max(1, Math.min(8000, deadline - Date.now())),
      spawnProcess: (command, args, spawnOptions) => spawn(command, [...args,
        "--disable", "apps", "--disable", "plugins", "-c", "mcp_servers={}", "-c", "analytics.enabled=false"
      ], { ...spawnOptions, env: { ...environment, CODEX_INTERNAL_ORIGINATOR_OVERRIDE: "Codex Messenger" } })
    });
    instance.on("request", (message) => {
      methods[message.method] = (methods[message.method] || 0) + 1;
      instance.respondError(message.id, "The no-tool fixture does not approve server requests.", -32601);
    });
    instance.on("notification", (message) => {
      methods[message.method] = (methods[message.method] || 0) + 1;
      const p = message.params;
      if (p?.threadId !== threadId) return;
      if (message.method === "item/agentMessage/delta") {
        deltaCount++;
        if (stream.length < 1000) stream += typeof p.delta === "string" ? p.delta : "";
      }
      if (message.method === "item/completed" && p.item?.type === "agentMessage") finalReply = p.item.text;
      if (message.method === "turn/completed") {
        if (p.turn?.status === "completed") completionResolve?.(p.turn);
        else completionReject?.(publicFailure(p.turn?.error));
      }
    });
    return instance;
  }
  watchdog = setTimeout(() => {
    completionReject?.(new Error("Authenticated fixture deadline exceeded."));
    client?.dispose();
  }, Math.max(1, deadline - Date.now()));

  try {
    client = createClient();
    await client.ensureReady();
    threadId = await client.startThread({ kind: "project", cwd: workspace }, workspace, options);
    stage = "inference";
    const completed = new Promise((resolve, reject) => { completionResolve = resolve; completionReject = reject; });
    const started = await client.startTurn(threadId, "Réponds uniquement CODEX-MSN-OK, sans outil, sans lire de fichier.", options);
    turnId = started.turn.id;
    await completed;
    assert.equal(finalReply?.trim() === expected, true, "The completed reply must equal the harmless fixture string.");
    assert.equal(stream.trim() === expected, true, "The real streamed deltas must equal the completed fixture reply.");
    assert.ok(deltaCount > 0, "A completed snapshot alone does not demonstrate streaming.");
    t.diagnostic(JSON.stringify({ threadId, turnId, reply: expected, deltaCount, status: "completed" }));

    stage = "persisted-reload";
    await stopClient();
    client = createClient();
    await client.ensureReady();
    const full = await client.readThread(threadId, { includeTurns: true });
    assert.equal(full.id, threadId);
    assert.ok(containsReply(full.turns || []), "Full history must contain the actual completed fixture reply after server restart.");
    const page = await client.listThreadTurns(threadId, { limit: 10, sortDirection: "asc" });
    assert.ok(containsReply(page.data), "The real paginated or legacy history API must return the fixture reply.");
    const resumed = await client.resumeThread(threadId, { cwd: workspace, codexOptions: options, excludeTurns: false });
    assert.equal(resumed.id, threadId);
    assert.ok(containsReply(resumed.turns || []), "Resume with turns must return the actual completed fixture reply.");

    stage = "search";
    const search = await client.request("thread/search", {
      searchTerm: expected, archived: false, limit: 25, sortKey: "updated_at", sortDirection: "desc"
    });
    assert.ok(Array.isArray(search.data), "The actual search response must contain its documented data array.");
    const ownHit = search.data.find((hit) => hit.thread?.id === threadId);
    assert.ok(ownHit, "Server search must find only the materialized fixture thread under examination.");

    stage = "search-occurrences";
    const occurrences = await client.request("thread/searchOccurrences", { threadId, searchTerm: expected, limit: 25 });
    assert.ok(Array.isArray(occurrences.data) && occurrences.data.length > 0, "Server search must return real occurrences in the fixture thread.");
    for (const occurrence of occurrences.data) {
      assert.equal(occurrence.turnId, turnId);
      assert.equal(typeof occurrence.itemId, "string");
      assert.ok(occurrence.itemId.length > 0);
      assert.equal(typeof occurrence.turnCursor, "string");
      assert.ok(occurrence.turnCursor.length > 0);
      assert.equal(typeof occurrence.snippet, "string");
      const range = occurrence.snippetMatchRange;
      assert.ok(Number.isInteger(range?.start) && Number.isInteger(range?.end));
      assert.ok(range.start >= 0 && range.end > range.start && range.end <= occurrence.snippet.length);
      assert.equal(occurrence.snippet.slice(range.start, range.end).toUpperCase() === expected, true, "The documented UTF-16 match range must select the actual harmless query.");
    }
    t.diagnostic(JSON.stringify({ threadId, searchHit: true, occurrenceCount: occurrences.data.length, matchRangesVerified: true }));

    stage = "fork";
    const fork = await client.forkThread(threadId, { kind: "project", cwd: workspace }, options);
    assert.notEqual(fork.id, threadId);
    assert.equal(fork.forkedFromId, threadId);
    const forkHistory = await client.readThread(fork.id, { includeTurns: true });
    assert.ok(containsReply(forkHistory.turns || []), "The isolated fork must retain the actual fixture history.");
    stage = "complete";
    t.diagnostic(JSON.stringify({ threadId, turnId, forkId: fork.id, turnCount: page.data.length, persistedReload: true, search: true, occurrences: true, resume: true, fork: true }));
  } catch (error) {
    if (error.code === "ERR_ASSERTION") throw error;
    throw publicFailure(error);
  }
});
