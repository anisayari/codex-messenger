import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { execFile, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const execFileAsync = promisify(execFile);
const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
const devUrl = process.env.VITE_DEV_SERVER_URL ?? "http://127.0.0.1:5174/";
const smokeTest = process.argv.includes("--smoke-test");
const appIconPath = path.join(rootDir, "public", "icons", "codex-messenger-people.ico");

app.setName("Codex Messenger");
if (process.platform === "win32") app.setAppUserModelId("com.codex.messenger");

const contacts = [
  {
    id: "codex",
    name: "Codex",
    mail: "codex@codex.local",
    group: "Agents",
    status: "online",
    mood: "agent principal",
    color: "#11a77a",
    avatar: "butterfly",
    instructions:
      "Tu es Codex dans une interface Codex Messenger inspiree Windows XP. Reponds en francais, directement, comme un agent de developpement pragmatique. Quand la tache est terminee, ne mets pas de marqueur special: l'application declenche le wizz."
  },
  {
    id: "reviewer",
    name: "Code Reviewer",
    mail: "reviewer@codex.local",
    group: "Agents",
    status: "busy",
    mood: "revue bugs/tests",
    color: "#315fd0",
    avatar: "lens",
    instructions:
      "Tu es Codex en mode revue. Priorise bugs, regressions, risques et tests manquants. Reponds en francais, structure par findings si necessaire."
  },
  {
    id: "designer",
    name: "UI Designer",
    mail: "designer@codex.local",
    group: "Studio",
    status: "away",
    mood: "interface Codex",
    color: "#d88721",
    avatar: "brush",
    instructions:
      "Tu es Codex specialise UI desktop. Donne des choix concrets sur structure, composants, et interactions, sans marketing."
  },
  {
    id: "terminal",
    name: "Terminal",
    mail: "shell@codex.local",
    group: "Systeme",
    status: "online",
    mood: "execution locale",
    color: "#167c83",
    avatar: "terminal",
    instructions:
      "Tu es Codex oriente commandes et integration locale. Explique clairement les commandes et leurs effets avant les risques."
  }
];

const profile = {
  email: "anis@codex.local",
  status: "online",
  displayName: "anis",
  language: "fr"
};

const windows = new Map();
const threadByContact = new Map();
const contactByThread = new Map();
const unreadReminderByContact = new Map();
const knownThreads = new Map();
const unreadWizzDelayMs = Number(process.env.MSN_UNREAD_WIZZ_MS ?? "") || 5 * 60 * 1000;
const defaultSettings = { language: "fr", codexPath: "" };
let settingsCache = null;

function defaultCwd() {
  return process.env.CODEX_MESSENGER_WORKSPACE || (app.isPackaged ? app.getPath("home") : rootDir);
}

function projectsRoot() {
  return process.env.CODEX_MESSENGER_PROJECTS_ROOT || (app.isPackaged ? app.getPath("home") : path.dirname(rootDir));
}

function uploadsDir() {
  return path.join(app.isPackaged ? app.getPath("userData") : rootDir, "uploads");
}

function settingsFilePath() {
  return path.join(app.getPath("userData"), "settings.json");
}

function normalizeLanguage(language) {
  return language === "en" ? "en" : "fr";
}

async function loadSettings() {
  if (settingsCache) return settingsCache;
  try {
    const raw = await fs.readFile(settingsFilePath(), "utf8");
    settingsCache = { ...defaultSettings, ...JSON.parse(raw) };
  } catch {
    settingsCache = { ...defaultSettings };
  }
  settingsCache.language = normalizeLanguage(settingsCache.language);
  profile.language = settingsCache.language;
  return settingsCache;
}

async function saveSettings(nextSettings = {}) {
  const current = await loadSettings();
  settingsCache = {
    ...current,
    ...nextSettings,
    language: normalizeLanguage(nextSettings.language ?? current.language),
    codexPath: String(nextSettings.codexPath ?? current.codexPath ?? "").trim()
  };
  await fs.mkdir(path.dirname(settingsFilePath()), { recursive: true });
  await fs.writeFile(settingsFilePath(), JSON.stringify(settingsCache, null, 2), "utf8");
  profile.language = settingsCache.language;
  return settingsCache;
}

async function fileExists(filePath) {
  if (!filePath) return false;
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findCodexOnPath() {
  try {
    const command = process.platform === "win32" ? "where.exe" : "which";
    const { stdout } = await execFileAsync(command, ["codex"], { windowsHide: true, timeout: 7000 });
    const matches = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (process.platform === "win32") {
      return matches.find((line) => [".cmd", ".bat"].includes(path.extname(line).toLowerCase()))
        || matches.find((line) => path.extname(line).toLowerCase() === ".exe")
        || matches[0]
        || "";
    }
    return matches[0] || "";
  } catch {
    return "";
  }
}

function shouldUseShell(command) {
  if (process.platform !== "win32") return false;
  const ext = path.extname(command).toLowerCase();
  return !path.isAbsolute(command) && ext !== ".cmd" && ext !== ".bat";
}

function quoteWindowsArg(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function spawnCodex(command, args, options) {
  const ext = path.extname(command).toLowerCase();
  if (process.platform === "win32" && (ext === ".cmd" || ext === ".bat")) {
    return spawn(quoteWindowsArg(command), args, {
      ...options,
      shell: true
    });
  }
  return spawn(command, args, {
    ...options,
    shell: shouldUseShell(command)
  });
}

async function resolveCodexCommand(candidatePath = null) {
  const settings = await loadSettings();
  const configuredPath = String(candidatePath ?? settings.codexPath ?? "").trim();
  const envPath = String(process.env.CODEX_MESSENGER_CODEX_PATH ?? "").trim();
  const pathMatch = await findCodexOnPath();
  const candidates = [
    configuredPath ? { command: configuredPath, source: "manual" } : null,
    envPath ? { command: envPath, source: "env" } : null,
    pathMatch ? { command: pathMatch, source: "path" } : null
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (!path.isAbsolute(candidate.command) || await fileExists(candidate.command)) return candidate;
  }

  throw new Error("Codex CLI introuvable. Installez Codex puis relancez l'app, ou indiquez le chemin vers codex.exe/codex.cmd dans l'ecran de connexion.");
}

function runCodexCommand(command, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawnCodex(command, args, {
      cwd: defaultCwd(),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("Test Codex timeout"));
    }, 15000);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error((stderr || stdout || `codex exited with ${code}`).trim()));
    });
  });
}

async function codexStatus(candidatePath = null) {
  const settings = await loadSettings();
  try {
    const resolved = await resolveCodexCommand(candidatePath);
    return { ok: true, ...resolved, configured: Boolean(settings.codexPath) };
  } catch (error) {
    return { ok: false, command: "", source: "missing", configured: Boolean(settings.codexPath), error: error.message };
  }
}

function localizedInstructions(contact) {
  const languageInstruction = profile.language === "en"
    ? "Answer in English by default unless the user explicitly asks for another language."
    : "Reponds en francais par defaut sauf demande explicite de l'utilisateur.";
  return `${contact.instructions}\n\n${languageInstruction}`;
}

class CodexAppServer extends EventEmitter {
  child = null;
  buffer = "";
  nextId = 1;
  pending = new Map();
  ready = null;
  userAgent = null;

  async ensureReady() {
    if (this.ready) return this.ready;
    this.ready = this.start();
    return this.ready;
  }

  async start() {
    const codexCommand = await resolveCodexCommand();
    this.child = spawnCodex(codexCommand.command, ["app-server"], {
      cwd: defaultCwd(),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: {
        ...process.env,
        CODEX_INTERNAL_ORIGINATOR_OVERRIDE: "Codex Messenger"
      }
    });

    this.child.on("error", (error) => {
      this.emit("status", { kind: "error", text: error.message });
      this.child = null;
      this.ready = null;
      for (const [, pending] of this.pending) pending.reject(error);
      this.pending.clear();
    });
    this.child.stdout.on("data", (chunk) => this.readStdout(chunk));
    this.child.stderr.on("data", (chunk) => {
      this.emit("status", { kind: "stderr", text: chunk.toString() });
    });
    this.child.on("exit", (code) => {
      this.emit("status", { kind: "exit", text: `codex app-server exited with ${code ?? "unknown"}` });
      this.child = null;
      this.ready = null;
      for (const [, pending] of this.pending) pending.reject(new Error("codex app-server stopped"));
      this.pending.clear();
    });

    const init = await this.request("initialize", {
      clientInfo: {
        name: "codex-messenger",
        title: "Codex Messenger",
        version: app.getVersion()
      }
    });
    this.userAgent = init.userAgent;
    this.notify("initialized");
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
    if (message.id !== undefined && this.pending.has(message.id)) {
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) {
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
    this.child.stdin.write(`${JSON.stringify(payload)}\n`);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
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

  async startThread(contact, cwd = defaultCwd()) {
    await this.ensureReady();
    const result = await this.request("thread/start", {
      model: null,
      modelProvider: null,
      cwd,
      approvalPolicy: "never",
      sandbox: "workspaceWrite",
      config: null,
      baseInstructions: null,
      developerInstructions: localizedInstructions(contact)
    });
    return result.thread.id;
  }

  async resumeThread(threadId, overrides = {}) {
    await this.ensureReady();
    const result = await this.request("thread/resume", {
      threadId,
      history: null,
      path: null,
      model: null,
      modelProvider: null,
      cwd: overrides.cwd ?? null,
      approvalPolicy: "never",
      sandbox: "workspaceWrite",
      config: null,
      baseInstructions: null,
      developerInstructions: overrides.developerInstructions ?? null
    });
    return result.thread;
  }

  async listThreads() {
    await this.ensureReady();
    const data = [];
    let cursor = null;
    do {
      const result = await this.request("thread/list", {
        cursor,
        limit: 100,
        modelProviders: null
      });
      data.push(...(result.data ?? []));
      cursor = result.nextCursor ?? null;
    } while (cursor);
    return data;
  }

  async startTurn(threadId, input) {
    await this.ensureReady();
    const items = typeof input === "string" ? [{ type: "text", text: input }] : input;
    return this.request("turn/start", {
      threadId,
      input: items,
      cwd: null,
      approvalPolicy: null,
      sandboxPolicy: null,
      model: null,
      effort: null,
      summary: null
    });
  }

  dispose() {
    if (this.child) {
      this.child.kill();
      this.child = null;
    }
  }
}

const codex = new CodexAppServer();

function encodeProjectId(cwd) {
  return `project:${Buffer.from(cwd, "utf8").toString("base64url")}`;
}

function decodeProjectId(contactId) {
  if (!contactId?.startsWith("project:")) return null;
  try {
    return Buffer.from(contactId.slice("project:".length), "base64url").toString("utf8");
  } catch {
    return null;
  }
}

function threadIdFromContactId(contactId) {
  return contactId?.startsWith("thread:") ? contactId.slice("thread:".length) : null;
}

function projectNameFor(cwd) {
  return path.basename(cwd) || cwd;
}

function contactFromProject(cwd) {
  const name = projectNameFor(cwd);
  return {
    id: encodeProjectId(cwd),
    name,
    mail: `${name.toLowerCase().replace(/[^a-z0-9]+/g, ".")}@project.local`,
    group: "Projets",
    status: "online",
    mood: cwd,
    color: "#1f8fcf",
    avatar: "terminal",
    cwd,
    instructions:
      `Tu es Codex dans Codex Messenger. Cette conversation correspond au projet local "${name}" dans ${cwd}. ` +
      "Travaille dans ce dossier, reponds en francais, et reste pragmatique."
  };
}

function contactFromThread(threadId) {
  const thread = knownThreads.get(threadId);
  const cwd = thread?.cwd ?? defaultCwd();
  const preview = String(thread?.preview ?? "").trim();
  const name = preview ? preview.slice(0, 44) : `Fil ${threadId.slice(0, 8)}`;
  return {
    id: `thread:${threadId}`,
    name,
    mail: `${projectNameFor(cwd).toLowerCase()}@thread.local`,
    group: projectNameFor(cwd),
    status: "online",
    mood: cwd,
    color: "#2874d9",
    avatar: "terminal",
    cwd,
    threadId,
    instructions:
      `Tu es Codex dans Codex Messenger. Ce fil appartient au projet ${projectNameFor(cwd)} (${cwd}). ` +
      "Reprends le contexte existant et reponds en francais."
  };
}

function contactFor(id) {
  const fixedContact = contacts.find((contact) => contact.id === id);
  if (fixedContact) return fixedContact;
  const cwd = decodeProjectId(id);
  if (cwd) return contactFromProject(cwd);
  const threadId = threadIdFromContactId(id);
  if (threadId) return contactFromThread(threadId);
  return contacts[0];
}

async function listWorkspaceProjects() {
  const root = projectsRoot();
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules")
      .map((entry) => path.join(root, entry.name))
      .sort((a, b) => projectNameFor(a).localeCompare(projectNameFor(b)));
  } catch {
    return [defaultCwd()];
  }
}

function normalizeThread(thread) {
  knownThreads.set(thread.id, thread);
  const createdAt = Number(thread.createdAt ?? 0) * 1000;
  return {
    id: thread.id,
    contactId: `thread:${thread.id}`,
    preview: String(thread.preview ?? "").trim() || "Nouveau fil Codex",
    cwd: thread.cwd || defaultCwd(),
    projectName: projectNameFor(thread.cwd || defaultCwd()),
    timestamp: createdAt ? new Date(createdAt).toISOString() : null,
    source: thread.source,
    modelProvider: thread.modelProvider
  };
}

async function conversationBrowser() {
  let threads = [];
  try {
    threads = (await codex.listThreads()).map(normalizeThread);
  } catch {
    threads = [];
  }

  const projectPaths = new Set(await listWorkspaceProjects());
  for (const thread of threads) projectPaths.add(thread.cwd);

  return {
    rootDir: defaultCwd(),
    projectsRoot: projectsRoot(),
    projects: Array.from(projectPaths)
      .map((cwd) => ({
        id: encodeProjectId(cwd),
        cwd,
        name: projectNameFor(cwd),
        threads: threads
          .filter((thread) => thread.cwd === cwd)
          .sort((a, b) => String(b.timestamp ?? "").localeCompare(String(a.timestamp ?? "")))
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  };
}

function textFromUserInput(input) {
  if (!input) return "";
  if (input.type === "text") return input.text ?? "";
  if (input.type === "localImage") return `[image] ${input.path}`;
  if (input.type === "image") return `[image] ${input.url}`;
  return "";
}

function messagesFromThread(thread, contact) {
  const messages = [];
  for (const turn of thread?.turns ?? []) {
    for (const item of turn.items ?? []) {
      if (item.type === "userMessage") {
        const text = (item.content ?? []).map(textFromUserInput).filter(Boolean).join("\n");
        if (text) messages.push({ id: item.id, from: "me", author: profile.displayName, text, time: "--:--" });
      } else if (item.type === "agentMessage" && item.text) {
        messages.push({ id: item.id, from: "them", author: contact.name, text: item.text, time: "--:--" });
      }
    }
  }
  return messages;
}

function rendererUrl(params) {
  const query = new URLSearchParams(params).toString();
  if (isDev) return `${devUrl}?${query}`;
  const index = pathToFileURL(path.join(rootDir, "dist", "index.html")).href;
  return `${index}?${query}`;
}

function createBaseWindow(key, options) {
  const win = new BrowserWindow({
    frame: false,
    show: false,
    resizable: true,
    backgroundColor: "#edf6ff",
    titleBarStyle: "hidden",
    icon: appIconPath,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    ...options
  });
  windows.set(key, win);
  win.setMenuBarVisibility(false);
  win.once("ready-to-show", () => {
    win.show();
    if (smokeTest) setTimeout(() => app.quit(), 500);
  });
  win.on("closed", () => {
    windows.delete(key);
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  return win;
}

function createMainWindow() {
  const win = createBaseWindow("main", {
    width: 430,
    height: 690,
    minWidth: 360,
    minHeight: 500,
    x: 80,
    y: 60,
    title: "Codex Messenger"
  });
  win.loadURL(rendererUrl({ view: "main" }));
  return win;
}

function createChatWindow(contactId) {
  const existing = windows.get(`chat:${contactId}`);
  if (existing && !existing.isDestroyed()) {
    existing.show();
    existing.focus();
    return existing;
  }

  const contact = contactFor(contactId);
  const offset = Math.max(0, Array.from(windows.keys()).filter((key) => key.startsWith("chat:")).length);
  const win = createBaseWindow(`chat:${contactId}`, {
    width: 760,
    height: 520,
    minWidth: 660,
    minHeight: 430,
    x: 440 + offset * 28,
    y: 80 + offset * 28,
    title: `${contact.name} - Conversation`
  });
  win.on("focus", () => {
    win.flashFrame(false);
    clearUnreadReminder(contactId);
  });
  win.on("closed", () => clearUnreadReminder(contactId));
  win.loadURL(rendererUrl({ view: "chat", contactId }));
  return win;
}

function sendToChat(contactId, channel, payload) {
  const win = windows.get(`chat:${contactId}`);
  if (!win || win.isDestroyed()) return;
  win.webContents.send(channel, payload);
}

function sendToMain(channel, payload) {
  const win = windows.get("main");
  if (!win || win.isDestroyed()) return;
  win.webContents.send(channel, payload);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clearUnreadReminder(contactId) {
  const timer = unreadReminderByContact.get(contactId);
  if (timer) clearTimeout(timer);
  unreadReminderByContact.delete(contactId);
}

function scheduleUnreadReminder(contactId) {
  const win = windows.get(`chat:${contactId}`);
  if (win?.isFocused()) {
    clearUnreadReminder(contactId);
    return;
  }

  clearUnreadReminder(contactId);
  unreadReminderByContact.set(contactId, setTimeout(() => {
    unreadReminderByContact.delete(contactId);
    const target = windows.get(`chat:${contactId}`);
    if (target && !target.isDestroyed() && !target.isFocused()) {
      wizz(target);
    }
  }, unreadWizzDelayMs));
}

async function wizz(win, options = {}) {
  if (!win || win.isDestroyed()) return;
  const focus = options.focus ?? true;
  const [x, y] = win.getPosition();
  win.webContents.send("window:wizz", {});
  if (focus) {
    win.show();
    win.focus();
  } else {
    win.flashFrame(true);
  }

  const offsets = [[-18, 8], [20, -8], [-14, -10], [16, 9], [-8, 4], [9, -4], [0, 0]];
  for (const [dx, dy] of offsets) {
    if (win.isDestroyed()) return;
    win.setPosition(x + dx, y + dy, false);
    await sleep(46);
  }
  if (!win.isDestroyed()) win.setPosition(x, y, false);
}

async function ensureThread(contactId) {
  if (threadByContact.has(contactId)) return threadByContact.get(contactId);
  const contact = contactFor(contactId);

  const existingThreadId = threadIdFromContactId(contactId);
  if (existingThreadId) {
    const thread = await codex.resumeThread(existingThreadId, {
      cwd: contact.cwd ?? knownThreads.get(existingThreadId)?.cwd ?? defaultCwd(),
      developerInstructions: localizedInstructions(contact)
    });
    knownThreads.set(existingThreadId, thread);
    threadByContact.set(contactId, existingThreadId);
    contactByThread.set(existingThreadId, contactId);
    return existingThreadId;
  }

  const threadId = await codex.startThread(contact, contact.cwd ?? defaultCwd());
  threadByContact.set(contactId, threadId);
  contactByThread.set(threadId, contactId);
  return threadId;
}

function textFromCompletedItem(item) {
  if (!item) return "";
  if (item.type === "agent_message" && Array.isArray(item.content)) {
    return item.content.map((part) => part.text ?? "").join("");
  }
  if (item.type === "AgentMessage" && Array.isArray(item.content)) {
    return item.content.map((part) => part.text ?? "").join("");
  }
  if (item.type === "agentMessage") return item.text ?? "";
  return "";
}

codex.on("notification", (message) => {
  if (message.method === "item/agentMessage/delta") {
    const contactId = contactByThread.get(message.params.threadId);
    if (contactId) {
      sendToChat(contactId, "codex:delta", { contactId, delta: message.params.delta });
    }
    return;
  }

  if (message.method === "item/completed") {
    const contactId = contactByThread.get(message.params.threadId);
    const text = textFromCompletedItem(message.params.item);
    if (contactId && text) {
      scheduleUnreadReminder(contactId);
      sendToChat(contactId, "codex:completed-item", { contactId, text });
    }
    return;
  }

  if (message.method === "turn/completed") {
    const contactId = contactByThread.get(message.params.threadId);
    if (contactId) {
      scheduleUnreadReminder(contactId);
      sendToChat(contactId, "codex:done", { contactId });
      sendToMain("conversation:finished", { contactId });
      wizz(windows.get(`chat:${contactId}`), { focus: false });
    }
    return;
  }

  if (message.method === "error") {
    const text = message.params?.message ?? "Erreur Codex";
    for (const contact of contacts) sendToChat(contact.id, "codex:error", { contactId: contact.id, text });
    return;
  }

  if (message.method?.startsWith("codex/event/")) {
    const event = message.params?.msg;
    const contactId = contactByThread.get(message.params?.conversationId);
    if (!event || !contactId) return;
    if (event.type === "agent_message_delta") {
      sendToChat(contactId, "codex:delta", { contactId, delta: event.delta });
    } else if (event.type === "agent_message" && event.message) {
      scheduleUnreadReminder(contactId);
      sendToChat(contactId, "codex:completed-item", { contactId, text: event.message });
    } else if (event.type === "task_complete") {
      if (event.last_agent_message) {
        scheduleUnreadReminder(contactId);
        sendToChat(contactId, "codex:completed-item", { contactId, text: event.last_agent_message });
      }
      scheduleUnreadReminder(contactId);
      sendToChat(contactId, "codex:done", { contactId });
      sendToMain("conversation:finished", { contactId });
      wizz(windows.get(`chat:${contactId}`), { focus: false });
    } else if (event.type === "stream_error" || event.type === "error") {
      sendToChat(contactId, "codex:error", { contactId, text: event.message ?? "Erreur Codex" });
    }
  }
});

codex.on("status", (status) => {
  sendToMain("codex:status", status);
});

ipcMain.handle("app:bootstrap", async (_event, params = {}) => {
  const settings = await loadSettings();
  const contact = contactFor(params.contactId);
  let historyMessages = [];
  if (params.view === "chat" && threadIdFromContactId(params.contactId)) {
    try {
      const threadId = threadIdFromContactId(params.contactId);
      const thread = await codex.resumeThread(threadId, {
        cwd: contact.cwd ?? knownThreads.get(threadId)?.cwd ?? defaultCwd(),
        developerInstructions: localizedInstructions(contact)
      });
      knownThreads.set(threadId, thread);
      threadByContact.set(params.contactId, threadId);
      contactByThread.set(threadId, params.contactId);
      historyMessages = messagesFromThread(thread, contact);
    } catch (error) {
      historyMessages = [{ id: "resume-error", from: "system", author: "system", text: error.message, time: "--:--" }];
    }
  }

  return {
    view: params.view,
    contactId: params.contactId,
    contacts,
    contact,
    profile,
    cwd: defaultCwd(),
    settings,
    codexStatus: await codexStatus(),
    userAgent: codex.userAgent,
    conversations: params.view === "chat" ? await conversationBrowser() : null,
    historyMessages
  };
});

ipcMain.handle("auth:sign-in", async (_event, nextProfile) => {
  const settings = await saveSettings({
    language: nextProfile.language,
    codexPath: nextProfile.codexPath
  });
  Object.assign(profile, nextProfile, { language: settings.language });
  const init = await codex.ensureReady();
  return { ok: true, userAgent: init.userAgent, profile, settings, codexStatus: await codexStatus() };
});

ipcMain.handle("settings:get", async () => ({
  settings: await loadSettings(),
  codexStatus: await codexStatus()
}));

ipcMain.handle("settings:set", async (_event, nextSettings = {}) => ({
  settings: await saveSettings(nextSettings),
  codexStatus: await codexStatus(nextSettings.codexPath)
}));

ipcMain.handle("settings:choose-codex", async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win, {
    title: "Select Codex CLI",
    properties: ["openFile"],
    filters: process.platform === "win32"
      ? [{ name: "Codex CLI", extensions: ["exe", "cmd", "bat"] }, { name: "All files", extensions: ["*"] }]
      : [{ name: "All files", extensions: ["*"] }]
  });
  if (result.canceled || !result.filePaths?.[0]) return { canceled: true };
  const settings = await saveSettings({ codexPath: result.filePaths[0] });
  return { canceled: false, settings, codexStatus: await codexStatus(settings.codexPath) };
});

ipcMain.handle("settings:test-codex", async (_event, candidatePath = null) => {
  const resolved = await resolveCodexCommand(candidatePath);
  const version = await runCodexCommand(resolved.command, ["--version"]);
  return {
    ok: true,
    ...resolved,
    version: (version.stdout || version.stderr).trim()
  };
});

ipcMain.handle("conversation:open", (_event, contactId) => {
  createChatWindow(contactId);
  return { ok: true };
});

ipcMain.handle("conversation:open-thread", (_event, threadId) => {
  createChatWindow(`thread:${threadId}`);
  return { ok: true };
});

ipcMain.handle("conversation:open-project", (_event, cwd) => {
  createChatWindow(encodeProjectId(cwd));
  return { ok: true };
});

ipcMain.handle("conversation:open-project-picker", async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win, {
    title: "Open Project",
    properties: ["openDirectory"]
  });
  if (result.canceled || !result.filePaths?.[0]) return { canceled: true };
  const cwd = result.filePaths[0];
  createChatWindow(encodeProjectId(cwd));
  return { canceled: false, cwd };
});

ipcMain.handle("conversation:list", async () => conversationBrowser());

ipcMain.handle("conversation:send", async (_event, { contactId, text }) => {
  const clean = String(text ?? "").trim();
  if (!clean) return { ok: false };
  return sendConversationItems(contactId, [{ type: "text", text: clean }]);
});

ipcMain.handle("conversation:send-items", async (_event, { contactId, items }) => {
  return sendConversationItems(contactId, Array.isArray(items) ? items : []);
});

async function sendConversationItems(contactId, items) {
  const cleanItems = items.filter((item) => {
    if (item?.type === "text") return String(item.text ?? "").trim();
    if (item?.type === "localImage") return String(item.path ?? "").trim();
    return false;
  });
  if (!cleanItems.length) return { ok: false };
  try {
    clearUnreadReminder(contactId);
    sendToChat(contactId, "codex:typing", { contactId });
    const threadId = await ensureThread(contactId);
    await codex.startTurn(threadId, cleanItems);
    return { ok: true };
  } catch (error) {
    sendToChat(contactId, "codex:error", { contactId, text: error.message });
    return { ok: false, error: error.message };
  }
}

async function ensureUploadsDir() {
  await fs.mkdir(uploadsDir(), { recursive: true });
}

function safeFileName(name) {
  const parsed = path.parse(name || "upload");
  const base = parsed.name.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 60) || "upload";
  const ext = parsed.ext.replace(/[^a-zA-Z0-9.]/g, "").slice(0, 12);
  return `${Date.now()}-${base}${ext}`;
}

function mimeFromExtension(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".bmp"].includes(ext)) return `image/${ext === ".jpg" ? "jpeg" : ext.slice(1)}`;
  if ([".webm", ".wav", ".mp3", ".m4a", ".ogg"].includes(ext)) return `audio/${ext.slice(1)}`;
  return "application/octet-stream";
}

ipcMain.handle("media:pick-file", async (event, options = {}) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win, {
    title: options.title ?? "Send Files",
    properties: ["openFile"],
    filters: options.filters ?? [
      { name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp"] },
      { name: "All files", extensions: ["*"] }
    ]
  });
  if (result.canceled || !result.filePaths?.[0]) return { canceled: true };

  await ensureUploadsDir();
  const sourcePath = result.filePaths[0];
  const targetPath = path.join(uploadsDir(), safeFileName(path.basename(sourcePath)));
  await fs.copyFile(sourcePath, targetPath);
  return {
    canceled: false,
    path: targetPath,
    name: path.basename(targetPath),
    mime: mimeFromExtension(targetPath),
    isImage: mimeFromExtension(targetPath).startsWith("image/")
  };
});

ipcMain.handle("media:save-data-url", async (_event, { dataUrl, name = "capture.webm" }) => {
  const match = String(dataUrl ?? "").match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return { ok: false, error: "Invalid media data" };
  const [, mime, base64] = match;
  const extFromMime = mime.includes("png") ? ".png" : mime.includes("jpeg") ? ".jpg" : mime.includes("webm") ? ".webm" : mime.includes("wav") ? ".wav" : path.extname(name) || ".bin";
  const targetName = safeFileName(name.endsWith(extFromMime) ? name : `${name}${extFromMime}`);
  await ensureUploadsDir();
  const targetPath = path.join(uploadsDir(), targetName);
  await fs.writeFile(targetPath, Buffer.from(base64, "base64"));
  return { ok: true, path: targetPath, name: targetName, mime, isImage: mime.startsWith("image/") };
});

ipcMain.handle("app:open-path", async (_event, targetPath = defaultCwd()) => {
  const resolvedPath = String(targetPath || defaultCwd());
  if (path.basename(resolvedPath).toLowerCase() === "uploads") {
    await fs.mkdir(resolvedPath, { recursive: true });
  }
  const error = await shell.openPath(resolvedPath);
  return { ok: !error, error };
});

ipcMain.handle("app:show-item", (_event, targetPath = defaultCwd()) => {
  shell.showItemInFolder(String(targetPath || defaultCwd()));
  return { ok: true };
});

ipcMain.handle("app:reload", (event) => {
  BrowserWindow.fromWebContents(event.sender)?.reload();
  return { ok: true };
});

ipcMain.handle("app:quit", () => {
  app.quit();
  return { ok: true };
});

ipcMain.handle("app:save-text", async (event, { title = "Save", defaultPath = "codex-messenger.txt", text = "" } = {}) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showSaveDialog(win, {
    title,
    defaultPath,
    filters: [{ name: "Text", extensions: ["txt"] }, { name: "All files", extensions: ["*"] }]
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  await fs.writeFile(result.filePath, text, "utf8");
  return { canceled: false, path: result.filePath };
});

ipcMain.handle("conversation:read", (_event, contactId) => {
  clearUnreadReminder(contactId);
  return { ok: true };
});

ipcMain.handle("conversation:wizz", (_event, contactId) => {
  wizz(windows.get(`chat:${contactId}`));
  return { ok: true };
});

ipcMain.handle("window:minimize", (event) => {
  BrowserWindow.fromWebContents(event.sender)?.minimize();
});

ipcMain.handle("window:maximize", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
});

ipcMain.handle("window:close", (event) => {
  BrowserWindow.fromWebContents(event.sender)?.close();
});

app.whenReady().then(() => {
  createMainWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  codex.dispose();
});
