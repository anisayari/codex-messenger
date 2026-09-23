import { EventEmitter } from "node:events";
import { StringDecoder } from "node:string_decoder";
import { defaultCodexOptions, normalizeCodexOptions, sandboxPolicyForMode } from "../shared/codexOptions.js";
import { spawnCommand } from "../shared/codexSetup.js";

// Preserve the user's effective Codex configuration. Isolation is explicit.
export function codexThreadConfigOverrides() {
  if (process.env.CODEX_MESSENGER_DISABLE_CODEX_CONNECTORS !== "1") return null;
  return { mcp_servers: {}, "features.apps": false, "features.plugins": false, include_apps_instructions: false };
}

export function codexAppServerArgs() {
  const args = ["app-server"];
  if (process.env.CODEX_MESSENGER_DISABLE_CODEX_CONNECTORS !== "1") return args;
  return [...args, "--disable", "apps", "--disable", "plugins", "-c", "include_apps_instructions=false", "-c", "mcp_servers={}"];
}

function normalizeUserInputs(input) {
  const items = typeof input === "string" ? [{ type: "text", text: input }] : input;
  return (Array.isArray(items) ? items : []).map((item) => {
    if (item?.type !== "text") return item;
    return {
      ...item,
      text: String(item.text ?? ""),
      text_elements: Array.isArray(item.text_elements) ? item.text_elements : []
    };
  });
}

function threadPermissionParams(options) {
  if (options.permissions) return { permissions: options.permissions };
  const modes = { readOnly: "read-only", workspaceWrite: "workspace-write", dangerFullAccess: "danger-full-access" };
  return modes[options.sandbox] ? { sandbox: modes[options.sandbox] } : {};
}

export function sanitizeObservedCollaborationMode(value) {
  if (!value || !["default", "plan"].includes(value.mode) || !value.settings || typeof value.settings !== "object" || Array.isArray(value.settings)) return null;
  const model = value.settings.model;
  if (typeof model !== "string" || !model.trim() || model.length > 256 || model.includes("\0")) return null;
  const effort = value.settings.reasoning_effort;
  return { mode: value.mode, settings: { model, reasoning_effort: typeof effort === "string" && /^[a-z0-9_]{1,64}$/.test(effort) ? effort : null } };
}

export class CodexAppServerClient extends EventEmitter {
  child = null;
  buffer = "";
  nextId = 1;
  pending = new Map();
  observedCollaborationModes = new Map();
  connectionEpoch = 0;
  ready = null;
  userAgent = null;
  decoder = new StringDecoder("utf8");

  constructor({
    appVersion,
    defaultCwd,
    resolveCodexCommand,
    localizedInstructions,
    logDebug,
    loadedThreads,
    threadListPageSize = 20,
    codexHistoryPageSize = 10,
    spawnProcess = spawnCommand,
    requestTimeoutMs = 120000
  }) {
    super();
    this.appVersion = appVersion;
    this.defaultCwd = defaultCwd;
    this.resolveCodexCommand = resolveCodexCommand;
    this.localizedInstructions = localizedInstructions;
    this.logDebug = logDebug;
    this.loadedThreads = loadedThreads;
    this.threadListPageSize = threadListPageSize;
    this.codexHistoryPageSize = codexHistoryPageSize;
    this.spawnProcess = spawnProcess;
    this.requestTimeoutMs = requestTimeoutMs;
  }

  ensureReady() {
    if (!this.ready) {
      const ready = this.start();
      this.ready = ready;
      ready.catch(() => { if (this.ready === ready) this.ready = null; });
    }
    return this.ready;
  }

  async start() {
    const codexCommand = await this.resolveCodexCommand();
    this.buffer = "";
    this.decoder = new StringDecoder("utf8");
    this.logDebug("codex.app-server.start", { command: codexCommand.command, cwd: this.defaultCwd() });
    const child = this.spawnProcess(codexCommand.command, codexAppServerArgs(), {
      cwd: this.defaultCwd(), stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
      env: { ...process.env, CODEX_INTERNAL_ORIGINATOR_OVERRIDE: "Codex Messenger" }
    });
    this.child = child;
    const fail = (error, kind) => {
      if (this.child !== child) return;
      this.stop(error.message);
      this.emit("status", { kind, text: error.message });
    };
    child.on("error", (error) => fail(error, "error"));
    child.stdin.on("error", (error) => fail(error, "error"));
    child.stdout.on("data", (chunk) => { if (this.child === child) this.readStdout(chunk); });
    child.stderr.on("data", (chunk) => {
      if (this.child === child) this.emit("status", { kind: "stderr", text: chunk.toString() });
    });
    child.on("exit", (code, signal) => fail(new Error(`codex app-server exited with ${signal || code || "0"}`), "exit"));
    try {
      const init = await this.request("initialize", {
        clientInfo: { name: "codex-messenger", title: "Codex Messenger", version: this.appVersion() },
        capabilities: { experimentalApi: true, mcpServerOpenaiFormElicitation: true }
      });
      if (this.child !== child) throw new Error("Codex connection replaced during initialization");
      this.userAgent = init.userAgent;
      this.notify("initialized");
      this.logDebug("codex.initialize.ok", { userAgent: init.userAgent, platformFamily: init.platformFamily, platformOs: init.platformOs });
      return init;
    } catch (error) {
      if (this.child === child) this.stop(error.message);
      throw error;
    }
  }

  readStdout(chunk) {
    this.buffer += Buffer.isBuffer(chunk) ? this.decoder.write(chunk) : String(chunk);
    let newline;
    while ((newline = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); }
      catch (error) {
        this.emit("status", { kind: "parse-error", text: `Invalid Codex JSON message: ${error.message}` });
        continue;
      }
      this.handleMessage(message);
    }
  }

  handleMessage(message) {
    if (!message || typeof message !== "object") return;
    if (message.id !== undefined && message.method) { this.emit("request", message); return; }
    if (message.id !== undefined && this.pending.has(message.id)) {
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) {
        const error = new Error(message.error.message ?? "Codex request failed");
        error.code = message.error.code;
        error.data = message.error.data;
        pending.reject(error);
      } else pending.resolve(message.result);
      return;
    }
    if (message.method) this.emit("notification", message);
  }

  writeMessage(payload, callback) {
    const child = this.child;
    if (!child || child.killed || child.stdin.destroyed || !child.stdin.writable) throw new Error("codex app-server is not running");
    child.stdin.write(`${JSON.stringify(payload)}\n`, callback);
  }

  request(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for ${method}`));
      }, this.requestTimeoutMs);
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timeout); resolve(value); },
        reject: (error) => { clearTimeout(timeout); reject(error); }
      });
      try {
        // Log routing metadata only; params can contain private messages or answers.
        this.logDebug("codex.rpc.request", { id, method });
        this.writeMessage({ id, method, params }, (error) => {
          if (!error) return;
          const pending = this.pending.get(id);
          this.pending.delete(id);
          pending?.reject(error);
        });
      } catch (error) {
        const pending = this.pending.get(id);
        this.pending.delete(id);
        pending?.reject(error);
      }
    });
  }

  notify(method, params) {
    this.writeMessage(params === undefined ? { method } : { method, params });
  }

  stop(reason = "codex app-server stopped") {
    const child = this.child;
    this.connectionEpoch += 1;
    this.child = null;
    this.ready = null;
    this.userAgent = null;
    this.buffer = "";
    this.decoder = new StringDecoder("utf8");
    this.loadedThreads.clear();
    this.observedCollaborationModes.clear();
    this.logDebug("codex.app-server.stop", { reason });
    for (const pending of this.pending.values()) pending.reject(new Error(reason));
    this.pending.clear();
    if (child && !child.killed) child.kill();
    this.emit("status", { kind: "stopped", text: reason });
  }

  respond(id, result) { this.writeMessage({ id, result }); }
  respondError(id, message, code = -32000) {
    if (this.child) this.writeMessage({ id, error: { code, message } });
  }

  async startThread(contact, cwd = this.defaultCwd(), options = defaultCodexOptions) {
    await this.ensureReady();
    const codexOptions = normalizeCodexOptions(options);
    const result = await this.request("thread/start", {
      model: codexOptions.model || null,
      historyMode: "paginated",
      modelProvider: null,
      cwd,
      approvalPolicy: codexOptions.approvalPolicy,
      ...threadPermissionParams(codexOptions),
      config: codexThreadConfigOverrides(),
      baseInstructions: null,
      developerInstructions: this.localizedInstructions(contact),
      personality: "pragmatic"
    });
    this.loadedThreads.add(result.thread.id);
    this.logDebug("codex.thread.start.ok", { threadId: result.thread.id, cwd });
    return result.thread.id;
  }

  getObservedCollaborationMode(threadId) {
    const observed = this.observedCollaborationModes.get(threadId);
    return observed ? structuredClone(observed) : null;
  }

  async resumeThread(threadId, overrides = {}) {
    await this.ensureReady();
    const connectionEpoch = this.connectionEpoch;
    const codexOptions = normalizeCodexOptions(overrides.codexOptions);
    const result = await this.request("thread/resume", {
      threadId,
      model: codexOptions.model || null,
      modelProvider: null,
      cwd: overrides.cwd ?? null,
      approvalPolicy: codexOptions.approvalPolicy,
      ...threadPermissionParams(codexOptions),
      config: codexThreadConfigOverrides(),
      baseInstructions: null,
      developerInstructions: overrides.developerInstructions ?? null,
      personality: "pragmatic",
      excludeTurns: overrides.excludeTurns !== false
    });
    if (connectionEpoch !== this.connectionEpoch) throw new Error("Codex connection changed during thread resume");
    if (result.thread?.id) {
      const observedMode = sanitizeObservedCollaborationMode(result.collaborationMode);
      if (observedMode) this.observedCollaborationModes.set(result.thread.id, observedMode);
      else this.observedCollaborationModes.delete(result.thread.id);
      this.emit("collaboration-mode", { threadId: result.thread.id, collaborationMode: this.getObservedCollaborationMode(result.thread.id) });
      this.loadedThreads.add(result.thread.id);
      this.logDebug("codex.thread.resume.ok", { threadId: result.thread.id, cwd: overrides.cwd ?? null });
    }
    return result.thread;
  }

  async listThreads(options = {}) {
    await this.ensureReady();
    return this.request("thread/list", {
      cursor: options.cursor ?? null,
      limit: Math.max(1, Math.min(100, Number(options.limit) || this.threadListPageSize)),
      sortKey: options.sortKey ?? "updated_at",
      sortDirection: options.sortDirection ?? "desc",
      modelProviders: options.modelProviders ?? null,
      sourceKinds: options.sourceKinds ?? null,
      archived: options.archived ?? null,
      cwd: options.cwd ?? null,
      useStateDbOnly: options.useStateDbOnly !== false,
      searchTerm: options.searchTerm ?? null
    });
  }

  async readThread(threadId, options = {}) {
    await this.ensureReady();
    const result = await this.request("thread/read", {
      threadId,
      includeTurns: options.includeTurns === true
    });
    return result.thread ?? null;
  }

  async listThreadTurns(threadId, options = {}) {
    await this.ensureReady();
    const limit = Math.max(1, Math.min(50, Number(options.limit) || this.codexHistoryPageSize));
    const cursor = options.cursor ?? null;
    if (!String(cursor ?? "").startsWith("legacy:")) {
      try {
        return await this.request("thread/turns/list", {
          threadId, cursor, limit, sortDirection: options.sortDirection ?? "desc", itemsView: "full"
        });
      } catch (error) {
        if (error.code !== -32601 && !/list_turns is not supported|turn pagination is not supported/i.test(error.message)) throw error;
      }
    }
    // Legacy persisted threads do not support the new paginated storage API.
    const thread = await this.readThread(threadId, { includeTurns: true });
    const turns = [...(thread?.turns ?? [])];
    if ((options.sortDirection ?? "desc") === "desc") turns.reverse();
    const offset = cursor ? Number(String(cursor).slice(7)) : 0;
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("Invalid legacy history cursor");
    const data = turns.slice(offset, offset + limit);
    return { data, nextCursor: offset + limit < turns.length ? `legacy:${offset + limit}` : null, backwardsCursor: null };
  }

  async listModels() {
    await this.ensureReady();
    const data = [];
    let cursor = null;
    do {
      const result = await this.request("model/list", {
        cursor,
        limit: 100,
        includeHidden: false
      });
      data.push(...(result.data ?? []));
      cursor = result.nextCursor ?? null;
    } while (cursor);
    return data;
  }

  async startTurn(threadId, input, options = defaultCodexOptions) {
    await this.ensureReady();
    const items = normalizeUserInputs(input);
    const codexOptions = normalizeCodexOptions(options);
    const result = await this.request("turn/start", {
      threadId,
      input: items,
      cwd: null,
      approvalPolicy: codexOptions.approvalPolicy,
      ...(codexOptions.permissions ? { permissions: codexOptions.permissions } : { sandboxPolicy: sandboxPolicyForMode(codexOptions.sandbox) }),
      model: codexOptions.model || null,
      effort: codexOptions.reasoningEffort || null,
      ...(codexOptions.serviceTier ? { serviceTier: codexOptions.serviceTier } : {}),
      ...(codexOptions.collaborationMode ? { collaborationMode: codexOptions.collaborationMode } : {})
    });
    this.logDebug("codex.turn.start.ok", { threadId, turnId: result?.turn?.id });
    return result;
  }

  async interruptTurn(threadId, turnId) {
    await this.ensureReady();
    return this.request("turn/interrupt", { threadId, turnId });
  }

  async steerTurn(threadId, turnId, input) {
    await this.ensureReady();
    const items = normalizeUserInputs(input);
    return this.request("turn/steer", {
      threadId,
      input: items,
      expectedTurnId: turnId
    });
  }

  async compactThread(threadId) {
    await this.ensureReady();
    return this.request("thread/compact/start", { threadId });
  }

  async reviewThread(threadId) {
    await this.ensureReady();
    return this.request("review/start", {
      threadId,
      target: { type: "uncommittedChanges" },
      delivery: "inline"
    });
  }

  async forkThread(threadId, contact, options = defaultCodexOptions) {
    await this.ensureReady();
    const codexOptions = normalizeCodexOptions(options);
    const result = await this.request("thread/fork", {
      threadId,
      model: codexOptions.model || null,
      modelProvider: null,
      cwd: contact?.cwd ?? null,
      approvalPolicy: codexOptions.approvalPolicy,
      ...threadPermissionParams(codexOptions),
      config: codexThreadConfigOverrides(),
      baseInstructions: null,
      developerInstructions: contact ? this.localizedInstructions(contact) : null,
      ephemeral: false,
      excludeTurns: true
    });
    if (result.thread?.id) {
      this.loadedThreads.add(result.thread.id);
      this.logDebug("codex.thread.fork.ok", { sourceThreadId: threadId, threadId: result.thread.id });
    }
    return result.thread;
  }

  async setThreadName(threadId, name) {
    await this.ensureReady();
    return this.request("thread/name/set", { threadId, name });
  }

  dispose() { this.stop(); }
}
