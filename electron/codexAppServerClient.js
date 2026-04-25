import { EventEmitter } from "node:events";
import { defaultCodexOptions, normalizeCodexOptions, sandboxPolicyForMode } from "../shared/codexOptions.js";
import { spawnCommand } from "../shared/codexSetup.js";

const codexMessengerConfigOverrides = Object.freeze({
  "mcp_servers": {},
  "features.apps": false,
  "features.plugins": false,
  "include_apps_instructions": false
});

function codexThreadConfigOverrides() {
  if (process.env.CODEX_MESSENGER_ENABLE_CODEX_CONNECTORS === "1") return null;
  return { ...codexMessengerConfigOverrides };
}

function codexAppServerArgs() {
  const args = ["app-server", "--analytics-default-enabled"];
  if (process.env.CODEX_MESSENGER_ENABLE_CODEX_CONNECTORS === "1") return args;
  return [
    ...args,
    "--disable",
    "apps",
    "--disable",
    "plugins",
    "-c",
    "include_apps_instructions=false",
    "-c",
    "mcp_servers={}"
  ];
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

export class CodexAppServerClient extends EventEmitter {
  child = null;
  buffer = "";
  nextId = 1;
  pending = new Map();
  ready = null;
  userAgent = null;

  constructor({
    appVersion,
    defaultCwd,
    resolveCodexCommand,
    localizedInstructions,
    logDebug,
    loadedThreads,
    threadListPageSize = 20,
    codexHistoryPageSize = 10
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
  }

  async ensureReady() {
    if (this.ready) return this.ready;
    this.ready = this.start();
    return this.ready;
  }

  async start() {
    const codexCommand = await this.resolveCodexCommand();
    this.logDebug("codex.app-server.start", { command: codexCommand.command, cwd: this.defaultCwd() });
    this.child = spawnCommand(codexCommand.command, codexAppServerArgs(), {
      cwd: this.defaultCwd(),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: {
        ...process.env,
        CODEX_INTERNAL_ORIGINATOR_OVERRIDE: "Codex Messenger"
      }
    });

    this.child.on("error", (error) => {
      this.logDebug("codex.app-server.error", { error: error.message });
      this.emit("status", { kind: "error", text: error.message });
      this.child = null;
      this.ready = null;
      this.loadedThreads.clear();
      for (const [, pending] of this.pending) pending.reject(error);
      this.pending.clear();
    });
    this.child.stdout.on("data", (chunk) => this.readStdout(chunk));
    this.child.stderr.on("data", (chunk) => {
      this.logDebug("codex.app-server.stderr", { text: chunk.toString() });
      this.emit("status", { kind: "stderr", text: chunk.toString() });
    });
    this.child.on("exit", (code) => {
      this.logDebug("codex.app-server.exit", { code });
      this.emit("status", { kind: "exit", text: `codex app-server exited with ${code ?? "unknown"}` });
      this.child = null;
      this.ready = null;
      this.userAgent = null;
      this.loadedThreads.clear();
      for (const [, pending] of this.pending) pending.reject(new Error("codex app-server stopped"));
      this.pending.clear();
    });

    const init = await this.request("initialize", {
      clientInfo: {
        name: "codex-messenger",
        title: "Codex Messenger",
        version: this.appVersion()
      },
      capabilities: {
        experimentalApi: true
      }
    });
    this.userAgent = init.userAgent;
    this.notify("initialized");
    this.logDebug("codex.initialize.ok", { userAgent: init.userAgent, codexHome: init.codexHome, platformFamily: init.platformFamily, platformOs: init.platformOs });
    return init;
  }

  readStdout(chunk) {
    this.buffer += chunk.toString();
    let newline;
    while ((newline = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      try {
        this.handleMessage(JSON.parse(line));
      } catch (error) {
        this.emit("status", { kind: "parse-error", text: `${error.message}: ${line}` });
      }
    }
  }

  handleMessage(message) {
    if (message.id !== undefined && message.method) {
      this.emit("request", message);
      return;
    }

    if (message.id !== undefined && this.pending.has(message.id)) {
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) {
        this.logDebug("codex.rpc.error", { id: message.id, error: message.error });
        pending.reject(new Error(message.error.message ?? "Codex request failed"));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (message.method) {
      this.emit("notification", message);
    }
  }

  request(method, params) {
    if (!this.child) throw new Error("codex app-server is not running");
    const id = this.nextId++;
    const payload = { id, method, params };
    if (/^(thread|turn|review)\//.test(method) || method === "initialize") {
      this.logDebug("codex.rpc.request", { id, method, params });
    }
    this.child.stdin.write(`${JSON.stringify(payload)}\n`);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        this.logDebug("codex.rpc.timeout", { id, method });
        reject(new Error(`Timed out waiting for ${method}`));
      }, 120000);
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

  notify(method, params) {
    if (!this.child) return;
    const payload = params === undefined ? { method } : { method, params };
    this.child.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  stop(reason = "codex app-server stopped") {
    const child = this.child;
    this.child = null;
    this.ready = null;
    this.userAgent = null;
    this.loadedThreads.clear();
    this.logDebug("codex.app-server.stop", { reason });
    for (const [, pending] of this.pending) pending.reject(new Error(reason));
    this.pending.clear();
    if (child && !child.killed) child.kill();
  }

  respond(id, result) {
    if (!this.child) throw new Error("codex app-server is not running");
    this.child.stdin.write(`${JSON.stringify({ id, result })}\n`);
  }

  respondError(id, message, code = -32000) {
    if (!this.child) return;
    this.child.stdin.write(`${JSON.stringify({ id, error: { code, message } })}\n`);
  }

  async startThread(contact, cwd = this.defaultCwd(), options = defaultCodexOptions) {
    await this.ensureReady();
    const codexOptions = normalizeCodexOptions(options);
    const result = await this.request("thread/start", {
      model: codexOptions.model || null,
      modelProvider: null,
      cwd,
      approvalPolicy: codexOptions.approvalPolicy,
      permissionProfile: null,
      config: codexThreadConfigOverrides(),
      baseInstructions: null,
      developerInstructions: this.localizedInstructions(contact),
      personality: "pragmatic"
    });
    this.loadedThreads.add(result.thread.id);
    this.logDebug("codex.thread.start.ok", { threadId: result.thread.id, cwd });
    return result.thread.id;
  }

  async resumeThread(threadId, overrides = {}) {
    await this.ensureReady();
    const codexOptions = normalizeCodexOptions(overrides.codexOptions);
    const result = await this.request("thread/resume", {
      threadId,
      history: null,
      path: null,
      model: codexOptions.model || null,
      modelProvider: null,
      cwd: overrides.cwd ?? null,
      approvalPolicy: codexOptions.approvalPolicy,
      permissionProfile: null,
      config: codexThreadConfigOverrides(),
      baseInstructions: null,
      developerInstructions: overrides.developerInstructions ?? null,
      personality: "pragmatic",
      excludeTurns: overrides.excludeTurns !== false
    });
    if (result.thread?.id) {
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
    return this.request("thread/turns/list", {
      threadId,
      cursor: options.cursor ?? null,
      limit: Math.max(1, Math.min(50, Number(options.limit) || this.codexHistoryPageSize)),
      sortDirection: options.sortDirection ?? "desc"
    });
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
      sandboxPolicy: sandboxPolicyForMode(codexOptions.sandbox),
      model: codexOptions.model || null,
      effort: codexOptions.reasoningEffort || null,
      summary: null
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
      permissionProfile: null,
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

  dispose() {
    if (this.child) {
      this.child.kill();
      this.child = null;
    }
  }
}
