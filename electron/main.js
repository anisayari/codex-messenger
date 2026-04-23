import { app, BrowserWindow, dialog, ipcMain, Menu, screen, shell, Tray } from "electron";
import { execFile, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveExecutableCandidate } from "../shared/codexExecutable.js";
import { codexLanguageInstruction, normalizeLanguage } from "../shared/languages.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const execFileAsync = promisify(execFile);
const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
const devUrl = process.env.VITE_DEV_SERVER_URL ?? "http://127.0.0.1:5174/";
const smokeTest = process.argv.includes("--smoke-test");
const appIconPath = path.join(rootDir, "public", "icons", "codex-messenger-people.ico");
const toastIconPath = path.join(rootDir, "public", "icons", "codex-messenger-people.png");

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
    kind: "agent",
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
    avatar: "msn-friendly-dog",
    kind: "agent",
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
    avatar: "msn-orange-daisy",
    kind: "agent",
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
    avatar: "msn-rocket-launch",
    kind: "agent",
    instructions:
      "Tu es Codex oriente commandes et integration locale. Explique clairement les commandes et leurs effets avant les risques."
  }
];

const displayPictureAssets = [
  ["msn-beach-chairs", "./msn-assets/msn75/display-pictures/beach-chairs.png"],
  ["msn-chess-pieces", "./msn-assets/msn75/display-pictures/chess-pieces.png"],
  ["msn-dirt-bike", "./msn-assets/msn75/display-pictures/dirt-bike.png"],
  ["msn-friendly-dog", "./msn-assets/msn75/display-pictures/friendly-dog.png"],
  ["msn-orange-daisy", "./msn-assets/msn75/display-pictures/orange-daisy.png"],
  ["msn-palm-trees", "./msn-assets/msn75/display-pictures/palm-trees.png"],
  ["msn-rocket-launch", "./msn-assets/msn75/display-pictures/rocket-launch.png"],
  ["msn-rubber-ducky", "./msn-assets/msn75/display-pictures/rubber-ducky.png"],
  ["msn-running-horses", "./msn-assets/msn75/display-pictures/running-horses.png"],
  ["msn-skateboarder", "./msn-assets/msn75/display-pictures/skateboarder.png"],
  ["msn-soccer-ball", "./msn-assets/msn75/display-pictures/soccer-ball.png"]
];
const displayPictureAssetByAvatar = new Map(displayPictureAssets);
const displayPictureAssetSet = new Set(displayPictureAssets.map(([, asset]) => asset));
const agentAvatars = new Set(["butterfly", "lens", "brush", "terminal", ...displayPictureAssetByAvatar.keys()]);
const defaultProfile = {
  email: "anis@codex.local",
  status: "online",
  displayName: "anis",
  language: "fr",
  personalMessage: "Codex Messenger",
  displayPicturePath: "",
  displayPictureAsset: ""
};
const profile = { ...defaultProfile };

const windows = new Map();
const threadByContact = new Map();
const contactByThread = new Map();
const unreadReminderByContact = new Map();
const unreadByContact = new Map();
const recentIncomingByContact = new Map();
const toastWindows = [];
const knownThreads = new Map();
let tray = null;
let isQuitting = false;
const defaultUnreadWizzDelayMs = Math.max(10_000, Number(process.env.MSN_UNREAD_WIZZ_MS ?? "") || 60_000);
const defaultThreadTabs = { orderByCwd: {}, hiddenIds: [] };
const defaultProjectSort = "name-asc";
const defaultTextStyle = {
  fontFamily: "Tahoma",
  fontSize: 11,
  color: "#182337",
  bubble: "#f0f6ff",
  meBubble: "#eefaf1"
};
const projectSortModes = new Set([
  "name-asc",
  "name-desc",
  "created-desc",
  "created-asc",
  "modified-desc",
  "modified-asc",
  "threads-desc",
  "threads-asc"
]);
const defaultSettings = {
  language: "fr",
  codexPath: "",
  profile: defaultProfile,
  customAgents: [],
  threadTabs: defaultThreadTabs,
  projectSort: defaultProjectSort,
  textStyles: {},
  unreadWizzDelayMs: defaultUnreadWizzDelayMs,
  closeBehavior: "ask"
};
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

function normalizeProfile(nextProfile = {}) {
  const merged = { ...defaultProfile, ...nextProfile };
  merged.email = String(merged.email || defaultProfile.email).trim();
  merged.displayName = String(merged.displayName || merged.email.split("@")[0] || defaultProfile.displayName).trim();
  merged.status = String(merged.status || defaultProfile.status).trim();
  merged.language = normalizeLanguage(merged.language);
  merged.personalMessage = String(merged.personalMessage ?? "").slice(0, 140);
  merged.displayPicturePath = String(merged.displayPicturePath ?? "");
  merged.displayPictureAsset = displayPictureAssetSet.has(merged.displayPictureAsset) ? merged.displayPictureAsset : "";
  return merged;
}

function normalizeCloseBehavior(value) {
  return ["ask", "hide", "close"].includes(value) ? value : "ask";
}

function normalizeProjectSort(value) {
  return projectSortModes.has(value) ? value : defaultProjectSort;
}

function normalizeUnreadWizzDelayMs(value) {
  const delay = Number(value);
  if (!Number.isFinite(delay)) return defaultUnreadWizzDelayMs;
  return Math.max(10_000, Math.min(30 * 60_000, Math.round(delay)));
}

function normalizeTextStyle(value = {}) {
  const fontFamily = String(value.fontFamily || defaultTextStyle.fontFamily).trim().slice(0, 48) || defaultTextStyle.fontFamily;
  const fontSize = Math.max(9, Math.min(18, Math.round(Number(value.fontSize) || defaultTextStyle.fontSize)));
  const color = /^#[0-9a-f]{6}$/i.test(String(value.color || "")) ? String(value.color) : defaultTextStyle.color;
  const bubble = /^#[0-9a-f]{6}$/i.test(String(value.bubble || "")) ? String(value.bubble) : defaultTextStyle.bubble;
  const meBubble = /^#[0-9a-f]{6}$/i.test(String(value.meBubble || "")) ? String(value.meBubble) : defaultTextStyle.meBubble;
  return { fontFamily, fontSize, color, bubble, meBubble };
}

function normalizeTextStyles(value = {}) {
  const styles = {};
  const source = value && typeof value === "object" ? value : {};
  for (const [contactId, style] of Object.entries(source)) {
    const cleanId = String(contactId || "").trim().slice(0, 180);
    if (!cleanId) continue;
    styles[cleanId] = normalizeTextStyle(style);
  }
  return styles;
}

function currentUnreadWizzDelayMs() {
  return normalizeUnreadWizzDelayMs(settingsCache?.unreadWizzDelayMs ?? defaultUnreadWizzDelayMs);
}

function slugifyAgentName(name) {
  const slug = String(name || "agent")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 34);
  return slug || "agent";
}

function normalizeAgentColor(color) {
  const value = String(color ?? "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#315fd0";
}

function uniqueAgentId(name, existing = []) {
  const used = new Set([...contacts.map((contact) => contact.id), ...existing.map((contact) => contact.id)]);
  const base = `agent:${slugifyAgentName(name)}`;
  let id = `${base}-${Date.now().toString(36)}`;
  let index = 2;
  while (used.has(id)) {
    id = `${base}-${Date.now().toString(36)}-${index}`;
    index += 1;
  }
  return id;
}

function normalizeCustomAgent(agent = {}, existing = []) {
  const name = String(agent.name || "Nouvel agent").trim().slice(0, 48) || "Nouvel agent";
  const id = String(agent.id || uniqueAgentId(name, existing)).trim();
  const group = String(agent.group || "Agents personnalises").trim().slice(0, 48) || "Agents personnalises";
  const mood = String(agent.mood || "agent specifique").trim().slice(0, 90) || "agent specifique";
  const instructions = String(agent.instructions || "").trim().slice(0, 6000)
    || `Tu es ${name}, un agent Codex specialise. Respecte ton role, demande les precisions utiles, puis execute la tache de maniere pragmatique.`;

  return {
    id,
    name,
    mail: String(agent.mail || `${slugifyAgentName(name)}@codex.local`).trim().slice(0, 90),
    group,
    status: String(agent.status || "online").trim(),
    mood,
    color: normalizeAgentColor(agent.color),
    avatar: agentAvatars.has(agent.avatar) ? agent.avatar : "lens",
    kind: "agent",
    custom: true,
    instructions
  };
}

function normalizeCustomAgents(value = []) {
  const agents = [];
  for (const item of Array.isArray(value) ? value : []) {
    const agent = normalizeCustomAgent(item, agents);
    if (!agents.some((existing) => existing.id === agent.id)) agents.push(agent);
  }
  return agents.slice(0, 50);
}

function normalizeThreadTabs(value = {}) {
  const orderByCwd = {};
  const sourceOrder = value && typeof value.orderByCwd === "object" ? value.orderByCwd : {};
  for (const [cwd, ids] of Object.entries(sourceOrder)) {
    const cleanCwd = String(cwd || "").trim();
    if (!cleanCwd || !Array.isArray(ids)) continue;
    orderByCwd[cleanCwd] = Array.from(new Set(ids.map((id) => String(id || "").trim()).filter(Boolean))).slice(0, 200);
  }
  const hiddenIds = Array.from(new Set(
    (Array.isArray(value?.hiddenIds) ? value.hiddenIds : [])
      .map((id) => String(id || "").trim())
      .filter(Boolean)
  )).slice(0, 1000);
  return { orderByCwd, hiddenIds };
}

function contactsForSettings(settings = settingsCache) {
  return [...contacts, ...normalizeCustomAgents(settings?.customAgents ?? [])];
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
  settingsCache.profile = normalizeProfile({
    ...settingsCache.profile,
    language: settingsCache.language
  });
  settingsCache.customAgents = normalizeCustomAgents(settingsCache.customAgents);
  settingsCache.threadTabs = normalizeThreadTabs(settingsCache.threadTabs);
  settingsCache.projectSort = normalizeProjectSort(settingsCache.projectSort);
  settingsCache.textStyles = normalizeTextStyles(settingsCache.textStyles);
  settingsCache.unreadWizzDelayMs = normalizeUnreadWizzDelayMs(settingsCache.unreadWizzDelayMs);
  settingsCache.closeBehavior = normalizeCloseBehavior(settingsCache.closeBehavior);
  Object.assign(profile, settingsCache.profile);
  return settingsCache;
}

async function saveSettings(nextSettings = {}) {
  const current = await loadSettings();
  const nextLanguage = normalizeLanguage(nextSettings.language ?? nextSettings.profile?.language ?? current.language);
  const nextProfile = normalizeProfile({
    ...current.profile,
    ...nextSettings.profile,
    language: nextLanguage
  });
  settingsCache = {
    ...current,
    ...nextSettings,
    language: nextLanguage,
    codexPath: String(nextSettings.codexPath ?? current.codexPath ?? "").trim(),
    profile: nextProfile,
    customAgents: normalizeCustomAgents(nextSettings.customAgents ?? current.customAgents),
    threadTabs: normalizeThreadTabs(nextSettings.threadTabs ?? current.threadTabs),
    projectSort: normalizeProjectSort(nextSettings.projectSort ?? current.projectSort),
    textStyles: normalizeTextStyles(nextSettings.textStyles ?? current.textStyles),
    unreadWizzDelayMs: normalizeUnreadWizzDelayMs(nextSettings.unreadWizzDelayMs ?? current.unreadWizzDelayMs),
    closeBehavior: normalizeCloseBehavior(nextSettings.closeBehavior ?? current.closeBehavior)
  };
  await fs.mkdir(path.dirname(settingsFilePath()), { recursive: true });
  await fs.writeFile(settingsFilePath(), JSON.stringify(settingsCache, null, 2), "utf8");
  Object.assign(profile, settingsCache.profile);
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
    const command = await resolveExecutableCandidate(candidate.command);
    if (!path.isAbsolute(command) || await fileExists(command)) return { ...candidate, command };
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
  const languageInstruction = codexLanguageInstruction(profile.language);
  const winkInstruction = "Tu peux envoyer un clin d'oeil anime dans Codex Messenger en ecrivant exactement un marqueur comme [wink:butterfly], [wink:butterfly-small], [wink:surprise], [wink:nudge], [wink:flash] ou [wink:msn-flow]. Utilise ce marqueur seulement quand un clin d'oeil est pertinent.";
  return `${contact.instructions}\n\n${languageInstruction}\n\n${winkInstruction}`;
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
    kind: "project",
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
    kind: "thread",
    cwd,
    threadId,
    instructions:
      `Tu es Codex dans Codex Messenger. Ce fil appartient au projet ${projectNameFor(cwd)} (${cwd}). ` +
      "Reprends le contexte existant et reponds en francais."
  };
}

function contactFor(id) {
  const fixedContact = contactsForSettings().find((contact) => contact.id === id);
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

function sortThreadsForCwd(threads, cwd, threadTabs) {
  const order = threadTabs?.orderByCwd?.[cwd] ?? [];
  const rank = new Map(order.map((id, index) => [id, index]));
  return [...threads].sort((a, b) => {
    const aRank = rank.has(a.id) ? rank.get(a.id) : Number.MAX_SAFE_INTEGER;
    const bRank = rank.has(b.id) ? rank.get(b.id) : Number.MAX_SAFE_INTEGER;
    if (aRank !== bRank) return aRank - bRank;
    return String(b.timestamp ?? "").localeCompare(String(a.timestamp ?? ""));
  });
}

function isoFromMs(value) {
  return Number.isFinite(value) && value > 0 ? new Date(value).toISOString() : null;
}

function threadTimeMs(thread) {
  const value = Date.parse(thread?.timestamp ?? "");
  return Number.isFinite(value) ? value : 0;
}

async function projectMetadata(cwd, threads) {
  const threadTimes = threads.map(threadTimeMs).filter((value) => value > 0);
  const oldestThread = threadTimes.length ? Math.min(...threadTimes) : 0;
  const newestThread = threadTimes.length ? Math.max(...threadTimes) : 0;
  let createdMs = oldestThread;
  let modifiedMs = newestThread;

  try {
    const stat = await fs.stat(cwd);
    createdMs = Number(stat.birthtimeMs || stat.ctimeMs || createdMs);
    modifiedMs = Math.max(Number(stat.mtimeMs || 0), newestThread);
  } catch {
    // Keep thread-derived dates when a historical thread points to a missing folder.
  }

  return {
    createdAt: isoFromMs(createdMs),
    modifiedAt: isoFromMs(modifiedMs),
    threadCount: threads.length
  };
}

async function conversationBrowser() {
  const settings = await loadSettings();
  const threads = await listVisibleThreads(settings);

  const projectPaths = new Set(await listWorkspaceProjects());
  for (const thread of threads) projectPaths.add(thread.cwd);

  const projects = await Promise.all(Array.from(projectPaths).map(async (cwd) => {
    const projectThreads = sortThreadsForCwd(
      threads.filter((thread) => thread.cwd === cwd),
      cwd,
      settings.threadTabs
    );
    return {
      id: encodeProjectId(cwd),
      cwd,
      name: projectNameFor(cwd),
      threads: projectThreads,
      ...(await projectMetadata(cwd, projectThreads))
    };
  }));

  return {
    rootDir: defaultCwd(),
    projectsRoot: projectsRoot(),
    projects: projects.sort((a, b) => a.name.localeCompare(b.name))
  };
}

async function listVisibleThreads(settings = settingsCache) {
  const currentSettings = settings ?? await loadSettings();
  const hiddenIds = new Set(currentSettings.threadTabs.hiddenIds);
  try {
    return (await codex.listThreads()).map(normalizeThread).filter((thread) => !hiddenIds.has(thread.id));
  } catch {
    return [];
  }
}

function firstThreadForProject(threads, cwd, settings = settingsCache) {
  return sortThreadsForCwd(
    threads.filter((thread) => thread.cwd === cwd),
    cwd,
    settings?.threadTabs ?? defaultThreadTabs
  )[0] ?? null;
}

function textFromUserInput(input) {
  if (!input) return "";
  if (typeof input === "string") return input;
  if (input.type === "text") return input.text ?? "";
  if (input.type === "input_text") return input.text ?? "";
  if (input.type === "output_text") return input.text ?? "";
  if (input.type === "localImage") return `[image] ${input.path}`;
  if (input.type === "local_image") return `[image] ${input.path}`;
  if (input.type === "image") return `[image] ${input.url}`;
  if (input.text) return input.text;
  if (input.path) return `[image] ${input.path}`;
  if (input.url) return `[image] ${input.url}`;
  return "";
}

function textFromItem(item) {
  if (!item) return "";
  if (typeof item.text === "string") return item.text;
  if (typeof item.message === "string") return item.message;
  if (typeof item.content === "string") return item.content;
  if (Array.isArray(item.content)) return item.content.map(textFromUserInput).filter(Boolean).join("\n");
  if (Array.isArray(item.input)) return item.input.map(textFromUserInput).filter(Boolean).join("\n");
  return "";
}

function historyAuthorForContact(contact) {
  return contact?.kind === "project" || contact?.kind === "thread" ? "Codex" : contact?.name || "Codex";
}

function timeFromHistoryItem(item) {
  const value = item?.timestamp ?? item?.createdAt ?? item?.completedAt ?? item?.updatedAt;
  const date = typeof value === "number" ? new Date(value > 10_000_000_000 ? value : value * 1000) : new Date(value ?? "");
  if (!Number.isFinite(date.getTime())) return "--:--";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function messagesFromThread(thread, contact) {
  const messages = [];
  const author = historyAuthorForContact(contact);
  for (const turn of thread?.turns ?? []) {
    for (const item of turn.items ?? []) {
      const type = String(item.type ?? "").toLowerCase();
      if (["usermessage", "user_message", "user"].includes(type)) {
        const text = textFromItem(item);
        if (text) messages.push({ id: item.id ?? `user-${messages.length}`, from: "me", author: profile.displayName, text, time: timeFromHistoryItem(item) });
      } else if (["agentmessage", "agent_message", "assistant", "assistant_message"].includes(type)) {
        const text = textFromItem(item);
        if (text) messages.push({ id: item.id ?? `agent-${messages.length}`, from: "them", author, text, time: timeFromHistoryItem(item) });
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

function chatWindowTitle(contact) {
  if (contact?.kind === "project") return `${contact.name} - Codex Messenger`;
  if (contact?.kind === "thread") {
    const projectName = contact.cwd ? projectNameFor(contact.cwd) : "Codex";
    return `${contact.name} - ${projectName}`;
  }
  return `${contact?.name || "Codex"} - Conversation`;
}

function setStableWindowTitle(win, title) {
  if (!win || win.isDestroyed()) return;
  win.codexMessengerTitle = title;
  win.setTitle(title);
}

function createBaseWindow(key, options) {
  const initialTitle = options.title ?? "Codex Messenger";
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
  win.codexMessengerTitle = initialTitle;
  windows.set(key, win);
  win.setMenuBarVisibility(false);
  win.on("page-title-updated", (event) => {
    if (!win.codexMessengerTitle) return;
    event.preventDefault();
    win.setTitle(win.codexMessengerTitle);
  });
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

function showMainWindow() {
  const existing = windows.get("main");
  if (existing && !existing.isDestroyed()) {
    existing.show();
    existing.focus();
    return existing;
  }
  return createMainWindow();
}

function hideMainWindow() {
  const win = windows.get("main");
  if (!win || win.isDestroyed()) return;
  win.hide();
}

async function handleMainWindowClose(event, win) {
  if (isQuitting || smokeTest) return;
  event.preventDefault();
  const settings = await loadSettings();
  let behavior = normalizeCloseBehavior(settings.closeBehavior);

  if (behavior === "ask") {
    const result = await dialog.showMessageBox(win, {
      type: "question",
      title: "Codex Messenger",
      message: "Fermer Codex Messenger ?",
      detail: "Tu peux fermer seulement cette fenetre et garder les conversations ouvertes, ou reduire Codex Messenger dans la zone de notification.",
      buttons: ["Reduire", "Fermer la fenetre"],
      defaultId: 0,
      cancelId: 0,
      checkboxLabel: "Memoriser mon choix",
      checkboxChecked: false
    });
    behavior = result.response === 1 ? "close" : "hide";
    if (result.checkboxChecked) await saveSettings({ closeBehavior: behavior });
  }

  if (behavior === "close") {
    win.destroy();
  } else {
    hideMainWindow();
  }
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
  win.on("minimize", (event) => {
    if (isQuitting || smokeTest) return;
    event.preventDefault();
    hideMainWindow();
  });
  win.on("close", (event) => {
    handleMainWindowClose(event, win).catch(() => {
      if (!win.isDestroyed()) win.hide();
    });
  });
  win.loadURL(rendererUrl({ view: "main" }));
  return win;
}

function createChatWindow(contactId) {
  const existing = windows.get(`chat:${contactId}`);
  if (existing && !existing.isDestroyed()) {
    setStableWindowTitle(existing, chatWindowTitle(contactFor(contactId)));
    existing.show();
    existing.focus();
    return existing;
  }

  const contact = contactFor(contactId);
  const title = chatWindowTitle(contact);
  const offset = Math.max(0, Array.from(windows.keys()).filter((key) => key.startsWith("chat:")).length);
  const win = createBaseWindow(`chat:${contactId}`, {
    width: 760,
    height: 520,
    minWidth: 660,
    minHeight: 430,
    x: 440 + offset * 28,
    y: 80 + offset * 28,
    title
  });
  win.on("focus", () => {
    clearUnread(contactId, { clearReminder: false });
  });
  win.on("closed", () => clearUnreadReminder(contactId));
  win.loadURL(rendererUrl({ view: "chat", contactId }));
  return win;
}

function createTray() {
  if (tray || process.platform === "darwin") return tray;
  tray = new Tray(appIconPath);
  tray.setToolTip("Codex Messenger");
  const updateMenu = () => {
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: "Ouvrir Codex Messenger", click: showMainWindow },
      { label: "Ouvrir Codex", click: () => createChatWindow("codex") },
      { type: "separator" },
      { label: "Fermer definitivement", click: quitApplication }
    ]));
  };
  tray.on("click", showMainWindow);
  tray.on("double-click", showMainWindow);
  updateMenu();
  updateTrayTitle();
  return tray;
}

function quitApplication() {
  isQuitting = true;
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.destroy();
  }
  app.quit();
}

function switchChatWindow(event, contactId) {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) {
    createChatWindow(contactId);
    return { ok: true };
  }

  const targetKey = `chat:${contactId}`;
  const existing = windows.get(targetKey);
  if (existing && existing !== win && !existing.isDestroyed()) existing.close();

  for (const [key, value] of windows) {
    if (value === win && key.startsWith("chat:")) {
      clearUnreadReminder(key.slice("chat:".length));
      windows.delete(key);
      break;
    }
  }
  windows.set(targetKey, win);
  setStableWindowTitle(win, chatWindowTitle(contactFor(contactId)));
  win.loadURL(rendererUrl({ view: "chat", contactId }));
  return { ok: true };
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

function unreadState() {
  return Object.fromEntries(unreadByContact);
}

function unreadTotal() {
  return Array.from(unreadByContact.values()).reduce((total, count) => total + count, 0);
}

function updateTrayTitle() {
  if (!tray) return;
  const count = unreadTotal();
  tray.setToolTip(count ? `Codex Messenger - ${count} unread` : "Codex Messenger");
}

function emitUnreadState(contactId) {
  updateTrayTitle();
  sendToMain("conversation:unread", {
    contactId,
    count: unreadByContact.get(contactId) ?? 0,
    unread: unreadState()
  });
}

function markUnread(contactId) {
  if (!contactId) return;
  unreadByContact.set(contactId, (unreadByContact.get(contactId) ?? 0) + 1);
  emitUnreadState(contactId);
}

function clearUnread(contactId, options = {}) {
  if (options.clearReminder !== false) clearUnreadReminder(contactId);
  const win = windows.get(`chat:${contactId}`);
  if (win && !win.isDestroyed()) win.flashFrame(false);
  if (!unreadByContact.has(contactId)) return;
  unreadByContact.delete(contactId);
  emitUnreadState(contactId);
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
  clearUnreadReminder(contactId);
  unreadReminderByContact.set(contactId, setTimeout(() => {
    unreadReminderByContact.delete(contactId);
    const target = windows.get(`chat:${contactId}`);
    if (target && !target.isDestroyed() && !target.isFocused()) {
      wizz(target, { focus: false });
    } else if (target && !target.isDestroyed()) {
      wizz(target);
    }
  }, currentUnreadWizzDelayMs()));
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

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function toastPreview(text) {
  return String(text ?? "")
    .replace(/\[(?:wink|clin|clin-doeil|nudge):[a-z0-9-]+\]/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "sent you a message.";
}

function publicAssetUrl(assetPath) {
  const relativePath = String(assetPath || "").replace(/^\.\//, "");
  return pathToFileURL(path.join(rootDir, "public", relativePath)).href;
}

function avatarUrlForToast(contact) {
  if (contact?.displayPicturePath) return pathToFileURL(contact.displayPicturePath).href;
  if (contact?.displayPictureAsset && displayPictureAssetSet.has(contact.displayPictureAsset)) return publicAssetUrl(contact.displayPictureAsset);
  const defaultPicture = displayPictureAssetByAvatar.get(contact?.avatar);
  if (defaultPicture) return publicAssetUrl(defaultPicture);
  return pathToFileURL(toastIconPath).href;
}

function positionToastWindows() {
  if (!app.isReady()) return;
  const width = 430;
  const height = 170;
  const gap = 12;
  const margin = 18;
  const { workArea } = screen.getPrimaryDisplay();
  toastWindows.forEach((win, index) => {
    if (win.isDestroyed()) return;
    win.setBounds({
      width,
      height,
      x: workArea.x + workArea.width - width - margin,
      y: workArea.y + workArea.height - height - margin - index * (height + gap)
    }, false);
  });
}

function removeToastWindow(win) {
  const index = toastWindows.indexOf(win);
  if (index >= 0) toastWindows.splice(index, 1);
  positionToastWindows();
}

function messengerToastHtml({ contact, preview, playSound = false }) {
  const name = escapeHtml(contact.name || "Codex");
  const message = escapeHtml(preview);
  const avatar = escapeHtml(avatarUrlForToast(contact));
  const logo = escapeHtml(pathToFileURL(toastIconPath).href);
  const sound = escapeHtml(pathToFileURL(path.join(rootDir, "public", "msn-assets", "sounds", "type.wav")).href);
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent;font-family:"Segoe UI",Tahoma,Arial,sans-serif;color:#3c3c3c}
.toast{position:absolute;inset:8px;border:1px solid #61cce8;border-radius:18px;background:linear-gradient(135deg,#f7fcff 0%,#e6f7ff 50%,#ccecff 100%);box-shadow:0 9px 24px rgba(31,47,72,.38),inset 0 1px 0 rgba(255,255,255,.95)}
.head{display:flex;align-items:center;gap:10px;padding:18px 18px 8px;font-size:23px;color:#515151;text-shadow:0 1px 0 white}
.head img{width:29px;height:29px;object-fit:contain}.close{margin-left:auto;color:#717171;text-decoration:none;font-size:30px;line-height:1}
.body{display:grid;grid-template-columns:104px 1fr;gap:18px;padding:6px 22px 0 22px}.avatar{width:94px;height:94px;padding:6px;border:1px solid #9eb8c7;border-radius:18px;background:linear-gradient(#fff,#d7ecf9);box-shadow:0 7px 12px rgba(42,65,83,.28),inset 0 0 0 4px rgba(239,248,255,.95)}.avatar img{width:100%;height:100%;border-radius:8px;object-fit:cover;background:#b8dcf5}.copy{padding-top:14px;font-size:24px;line-height:1.2}.copy strong{display:block;margin-bottom:4px;font-size:26px;font-weight:700;color:#3a3a3a}.copy span{display:block;max-height:58px;overflow:hidden}.options{position:absolute;right:26px;bottom:18px;color:#0a73da;text-decoration:none;font-size:24px}.open{position:absolute;inset:52px 0 0 0}
</style>
</head>
<body>
<div class="toast">
  <div class="head"><img src="${logo}" alt=""> <span>Codex Messenger</span><a class="close" href="codex-messenger://toast/close">x</a></div>
  <a class="open" href="codex-messenger://toast/open"></a>
  <div class="body"><div class="avatar"><img src="${avatar}" alt=""></div><div class="copy"><strong>${name}</strong><span>${message}</span></div></div>
  <a class="options" href="codex-messenger://toast/open">Options</a>
</div>
${playSound ? `<audio src="${sound}" autoplay></audio>` : ""}
</body>
</html>`;
}

function showMessengerToast(contactId, text, options = {}) {
  if (smokeTest || isQuitting) return;
  const contact = contactFor(contactId);
  const preview = toastPreview(text);
  const width = 430;
  const height = 170;
  const toastWin = new BrowserWindow({
    width,
    height,
    frame: false,
    show: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    transparent: true,
    backgroundColor: "#00000000",
    title: "Codex Messenger",
    icon: appIconPath,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  toastWindows.unshift(toastWin);
  while (toastWindows.length > 3) toastWindows.pop()?.close();
  toastWin.on("closed", () => removeToastWindow(toastWin));
  toastWin.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("codex-messenger://toast/")) return;
    event.preventDefault();
    if (url.endsWith("/open")) createChatWindow(contactId);
    toastWin.close();
  });
  toastWin.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("codex-messenger://toast/open")) createChatWindow(contactId);
    toastWin.close();
    return { action: "deny" };
  });
  toastWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(messengerToastHtml({ contact, preview, playSound: Boolean(options.playSound) }))}`);
  toastWin.once("ready-to-show", () => {
    positionToastWindows();
    toastWin.showInactive();
  });
  setTimeout(() => {
    if (!toastWin.isDestroyed()) toastWin.close();
  }, 8500);
}

function registerIncomingMessage(contactId, text) {
  if (!contactId || !String(text ?? "").trim()) return false;
  const now = Date.now();
  const signature = `${normalizeMessageTextForDedupe(text)}:${Math.floor(now / 6000)}`;
  if (recentIncomingByContact.get(contactId) === signature) return false;
  recentIncomingByContact.set(contactId, signature);

  const chatWin = windows.get(`chat:${contactId}`);
  if (chatWin?.isFocused()) {
    clearUnread(contactId, { clearReminder: false });
    scheduleUnreadReminder(contactId);
    return false;
  }

  markUnread(contactId);
  if (chatWin && !chatWin.isDestroyed()) {
    chatWin.flashFrame(true);
  }
  scheduleUnreadReminder(contactId);
  const needsMainSound = !chatWin || chatWin.isDestroyed();
  const mainWin = windows.get("main");
  const mainCanPlaySound = mainWin && !mainWin.isDestroyed();
  showMessengerToast(contactId, text, { playSound: needsMainSound && !mainCanPlaySound });
  if (needsMainSound && mainCanPlaySound) {
    sendToMain("conversation:notify", { contactId, contact: contactFor(contactId), text: toastPreview(text) });
  }
  return true;
}

function normalizeMessageTextForDedupe(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim().slice(0, 240);
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
      registerIncomingMessage(contactId, text);
      sendToChat(contactId, "codex:completed-item", { contactId, text });
    }
    return;
  }

  if (message.method === "turn/completed") {
    const contactId = contactByThread.get(message.params.threadId);
    if (contactId) {
      sendToChat(contactId, "codex:done", { contactId });
      sendToMain("conversation:finished", { contactId });
    }
    return;
  }

  if (message.method === "error") {
    const text = message.params?.message ?? "Erreur Codex";
    for (const contact of contactsForSettings()) sendToChat(contact.id, "codex:error", { contactId: contact.id, text });
    return;
  }

  if (message.method?.startsWith("codex/event/")) {
    const event = message.params?.msg;
    const contactId = contactByThread.get(message.params?.conversationId);
    if (!event || !contactId) return;
    if (event.type === "agent_message_delta") {
      sendToChat(contactId, "codex:delta", { contactId, delta: event.delta });
    } else if (event.type === "agent_message" && event.message) {
      registerIncomingMessage(contactId, event.message);
      sendToChat(contactId, "codex:completed-item", { contactId, text: event.message });
    } else if (event.type === "task_complete") {
      if (event.last_agent_message) {
        registerIncomingMessage(contactId, event.last_agent_message);
        sendToChat(contactId, "codex:completed-item", { contactId, text: event.last_agent_message });
      }
      sendToChat(contactId, "codex:done", { contactId });
      sendToMain("conversation:finished", { contactId });
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
  const contactId = String(params.contactId ?? "");
  let contact = contactFor(contactId);
  let historyMessages = [];
  if (params.view === "chat") {
    try {
      let threadId = threadIdFromContactId(contactId) || threadByContact.get(contactId) || null;
      if (!threadId && contact.kind === "project") {
        const projectThread = firstThreadForProject(await listVisibleThreads(settings), contact.cwd, settings);
        threadId = projectThread?.id ?? null;
      }

      if (threadId) {
        const thread = await codex.resumeThread(threadId, {
          cwd: contact.cwd ?? knownThreads.get(threadId)?.cwd ?? defaultCwd(),
          developerInstructions: localizedInstructions(contact)
        });
        knownThreads.set(threadId, thread);
        if (threadIdFromContactId(contactId)) {
          contact = contactFromThread(threadId);
        } else {
          contact = { ...contact, threadId };
        }
        threadByContact.set(contactId, threadId);
        contactByThread.set(threadId, contactId);
        historyMessages = messagesFromThread(thread, contact);
      }
    } catch (error) {
      historyMessages = [{ id: "resume-error", from: "system", author: "system", text: error.message, time: "--:--" }];
    }
  }

  return {
    view: params.view,
    contactId,
    contacts: contactsForSettings(settings),
    contact,
    profile,
    cwd: defaultCwd(),
    settings,
    unread: unreadState(),
    codexStatus: await codexStatus(),
    userAgent: codex.userAgent,
    conversations: params.view === "chat" ? await conversationBrowser() : null,
    historyMessages
  };
});

ipcMain.handle("auth:sign-in", async (_event, nextProfile) => {
  const settings = await saveSettings({
    language: nextProfile.language,
    codexPath: nextProfile.codexPath,
    unreadWizzDelayMs: nextProfile.unreadWizzDelayMs,
    profile: nextProfile
  });
  Object.assign(profile, settings.profile);
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

ipcMain.handle("contacts:create-agent", async (_event, draft = {}) => {
  const current = await loadSettings();
  const contact = normalizeCustomAgent(draft, current.customAgents);
  const customAgents = [
    ...current.customAgents.filter((agent) => agent.id !== contact.id),
    contact
  ];
  const settings = await saveSettings({ customAgents });
  return {
    ok: true,
    contact,
    contacts: contactsForSettings(settings),
    settings
  };
});

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

ipcMain.handle("profile:choose-picture", async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win, {
    title: "Change Display Picture",
    properties: ["openFile"],
    filters: [
      { name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp"] },
      { name: "All files", extensions: ["*"] }
    ]
  });
  if (result.canceled || !result.filePaths?.[0]) return { canceled: true };

  const sourcePath = result.filePaths[0];
  const profileDir = path.join(app.getPath("userData"), "profile");
  await fs.mkdir(profileDir, { recursive: true });
  const targetPath = path.join(profileDir, safeFileName(path.basename(sourcePath)));
  await fs.copyFile(sourcePath, targetPath);
  const settings = await saveSettings({
    profile: {
      ...profile,
      displayPicturePath: targetPath,
      displayPictureAsset: ""
    }
  });
  return { canceled: false, path: targetPath, profile, settings };
});

ipcMain.handle("profile:clear-picture", async () => {
  const settings = await saveSettings({
    profile: {
      ...profile,
      displayPicturePath: "",
      displayPictureAsset: ""
    }
  });
  return { ok: true, profile, settings };
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

ipcMain.handle("conversation:switch-thread", (event, threadId) => {
  return switchChatWindow(event, `thread:${threadId}`);
});

ipcMain.handle("conversation:load-thread", async (_event, { contactId, threadId } = {}) => {
  const cleanThreadId = String(threadId || "").trim();
  const cleanContactId = String(contactId || "").trim();
  if (!cleanThreadId || !cleanContactId) return { ok: false, error: "Fil invalide" };
  const contact = contactFor(cleanContactId);
  const thread = await codex.resumeThread(cleanThreadId, {
    cwd: contact.cwd ?? knownThreads.get(cleanThreadId)?.cwd ?? defaultCwd(),
    developerInstructions: localizedInstructions(contact)
  });
  knownThreads.set(cleanThreadId, thread);
  const hydratedContact = contact.kind === "project" ? { ...contact, threadId: cleanThreadId } : contactFromThread(cleanThreadId);
  threadByContact.set(cleanContactId, cleanThreadId);
  contactByThread.set(cleanThreadId, cleanContactId);
  return {
    ok: true,
    threadId: cleanThreadId,
    contact: hydratedContact,
    messages: messagesFromThread(thread, hydratedContact),
    conversations: await conversationBrowser()
  };
});

ipcMain.handle("conversation:switch-project", (event, cwd) => {
  return switchChatWindow(event, encodeProjectId(cwd));
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

ipcMain.handle("conversation:reorder-threads", async (_event, { cwd, threadIds } = {}) => {
  const cleanCwd = String(cwd || "").trim();
  if (!cleanCwd) return { ok: false, error: "Projet invalide" };
  const settings = await loadSettings();
  const nextThreadTabs = normalizeThreadTabs({
    ...settings.threadTabs,
    orderByCwd: {
      ...settings.threadTabs.orderByCwd,
      [cleanCwd]: Array.isArray(threadIds) ? threadIds : []
    }
  });
  await saveSettings({ threadTabs: nextThreadTabs });
  return { ok: true, conversations: await conversationBrowser() };
});

ipcMain.handle("conversation:delete-thread", async (_event, threadId) => {
  const cleanThreadId = String(threadId || "").trim();
  if (!cleanThreadId) return { ok: false, error: "Fil invalide" };
  const settings = await loadSettings();
  const hiddenIds = Array.from(new Set([...settings.threadTabs.hiddenIds, cleanThreadId]));
  const orderByCwd = {};
  for (const [cwd, ids] of Object.entries(settings.threadTabs.orderByCwd)) {
    orderByCwd[cwd] = ids.filter((id) => id !== cleanThreadId);
  }
  await saveSettings({ threadTabs: { orderByCwd, hiddenIds } });
  const win = windows.get(`chat:thread:${cleanThreadId}`);
  if (win && !win.isDestroyed()) win.flashFrame(false);
  return { ok: true, conversations: await conversationBrowser() };
});

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
    clearUnread(contactId);
    sendToChat(contactId, "codex:typing", { contactId });
    const threadId = await ensureThread(contactId);
    await codex.startTurn(threadId, cleanItems);
    return { ok: true, threadId, conversations: await conversationBrowser() };
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
  quitApplication();
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
  clearUnread(contactId, { clearReminder: false });
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
  createTray();
  createMainWindow();
  app.on("activate", () => {
    showMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin" && isQuitting) app.quit();
});

app.on("before-quit", () => {
  isQuitting = true;
  codex.dispose();
});
