import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, screen, shell, Tray } from "electron";
import { execFile, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { defaultCodexOptions, normalizeCodexOptions, sandboxPolicyForMode } from "../shared/codexOptions.js";
import { codexImageFromItem, isCodexImageItem } from "../shared/codexImages.js";
import { codexLoginStatus, codexVersion, codexVersionSupport, findCodexCommand, findNpmCommand, installCodexCli, minimumCodexVersion, nodeDownloadUrl, quoteWindowsArg, spawnCommand, unsupportedCodexVersionMessage } from "../shared/codexSetup.js";
import { codexLanguageInstruction, normalizeLanguage } from "../shared/languages.js";
import { newestThreadForProject, threadTimeMs } from "../shared/threadSelection.js";
import { CodexAppServerClient } from "./codexAppServerClient.js";
import { registerUpdateIpcHandlers, registerWindowIpcHandlers } from "./ipcHandlers.js";
import { createNotificationService, toastPreview } from "./notifications.js";
import { assertEnum, assertObject, assertString, isSafeExternalUrl } from "./security.js";
import { createSettingsStore } from "./settingsStore.js";
import { codexNpmUrl, createUpdateService, frontReleasesUrl } from "./updateService.js";
import { createBaseWindowFactory, setStableWindowTitle } from "./windowManager.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const execFileAsync = promisify(execFile);
const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
const devUrl = process.env.VITE_DEV_SERVER_URL ?? "http://127.0.0.1:5174/";
const smokeTest = process.argv.includes("--smoke-test");
const appIconPath = path.join(
  rootDir,
  "public",
  "icons",
  process.platform === "win32" ? "codex-messenger-people.ico" : "codex-messenger-people-256.png"
);
const macTrayTemplateIconPath = path.join(rootDir, "public", "icons", "codex-messenger-menubarTemplate.png");
const macTrayTemplateIcon2xPath = path.join(rootDir, "public", "icons", "codex-messenger-menubarTemplate@2x.png");
const toastIconPath = path.join(rootDir, "public", "icons", "codex-messenger-people-256.png");
const threadListPageSize = 20;
const codexHistoryPageSize = 10;

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
const demoProjectDisplayName = "Codex Messenger Tour";
const demoProjectFolderName = "codex-messenger-tour";
const demoSeedThreadIds = new Set([
  "demo-seed-welcome",
  "demo-seed-xp-polish",
  "demo-seed-release-check"
]);
const legacyDefaultEmail = "anis@codex.local";
const legacyDefaultDisplayName = "anis";

function cleanLocalIdentityPart(value) {
  const clean = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, ".")
    .replace(/^[._-]+|[._-]+$/g, "");
  return clean || "user";
}

function displayNameForEmail(email) {
  const localPart = String(email || "").split("@")[0] || "user";
  return String(localPart)
    .trim()
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 80) || "user";
}

function defaultUserEmail() {
  const explicit = String(
    process.env.CODEX_MESSENGER_DEFAULT_EMAIL ||
    process.env.GIT_AUTHOR_EMAIL ||
    process.env.GIT_COMMITTER_EMAIL ||
    process.env.EMAIL ||
    ""
  ).trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(explicit)) return explicit;

  let username = "user";
  try {
    username = os.userInfo().username;
  } catch {
    username = process.env.USER || process.env.USERNAME || "user";
  }
  username = cleanLocalIdentityPart(username);
  return `${username}@codex.local`;
}

function createDefaultProfile() {
  const email = defaultUserEmail();
  return {
    email,
    status: "online",
    displayName: displayNameForEmail(email),
    language: "fr",
    personalMessage: "Codex Messenger",
    displayPicturePath: "",
    displayPictureAsset: ""
  };
}

const defaultProfile = {
  ...createDefaultProfile()
};
const profile = { ...defaultProfile };

const windows = new Map();
const threadByContact = new Map();
const contactByThread = new Map();
const unreadReminderByContact = new Map();
const unreadByContact = new Map();
const recentIncomingByContact = new Map();
const knownThreads = new Map();
const threadItemsByThread = new Map();
const deliveredItemsByThread = new Map();
const activeTurnByThread = new Map();
const activeTurnMetaByThread = new Map();
const approvalRequests = new Map();
const loadedThreads = new Set();
let tray = null;
let isQuitting = false;
let codexWarmupPromise = null;
let nextApprovalRequestId = 1;
const defaultUnreadWizzDelayMs = Math.max(10_000, Number(process.env.MSN_UNREAD_WIZZ_MS ?? "") || 60_000);
const turnNoResponseNoticeMs = 25_000;
const turnStalledNoticeMs = 120_000;
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
  contactAliases: {},
  contactStatuses: {},
  threadTabs: defaultThreadTabs,
  projectSort: defaultProjectSort,
  textStyles: {},
  codexOptionsByContact: {},
  unreadWizzDelayMs: defaultUnreadWizzDelayMs,
  notificationsEnabled: true,
  newMessageSoundEnabled: true,
  unreadWizzEnabled: true,
  demoMode: false,
  closeBehavior: "ask",
  signedIn: false,
  autoSignIn: true
};
const settingsStore = createSettingsStore({ settingsFilePath, defaultSettings });
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

function demoProjectCwd() {
  return path.join(app.getPath("userData"), demoProjectFolderName);
}

function settingsFilePath() {
  return path.join(app.getPath("userData"), "settings.json");
}

function logFilePath() {
  return path.join(app.getPath("userData"), "codex-messenger.log");
}

async function ensureDebugLogFile() {
  const filePath = logFilePath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, "", "utf8");
  return filePath;
}

function redactForLog(value, depth = 0) {
  if (depth > 5) return "[depth-limit]";
  if (typeof value === "string") return value.length > 800 ? `${value.slice(0, 800)}...` : value;
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => redactForLog(item, depth + 1));
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (/token|authorization|password|secret|cookie/i.test(key)) {
      result[key] = "[redacted]";
    } else {
      result[key] = redactForLog(item, depth + 1);
    }
  }
  return result;
}

function logDebug(event, details = {}) {
  const line = JSON.stringify({
    time: new Date().toISOString(),
    event,
    ...redactForLog(details)
  });
  fs.appendFile(logFilePath(), `${line}\n`, "utf8").catch(() => {});
}

function safeSend(win, channel, payload) {
  if (!win || win.isDestroyed() || win.webContents?.isDestroyed?.()) return false;
  try {
    win.webContents.send(channel, payload);
    return true;
  } catch (error) {
    logDebug("window.send.error", { channel, error: error.message });
    return false;
  }
}

function openExternalUrl(url) {
  if (!isSafeExternalUrl(url)) {
    logDebug("security.openExternal.blocked", { url });
    return { ok: false, error: "External URL blocked" };
  }
  shell.openExternal(url);
  return { ok: true, url };
}

function sendUpdateProgress(payload = {}) {
  const eventPayload = {
    at: new Date().toISOString(),
    ...payload
  };
  for (const win of BrowserWindow.getAllWindows()) {
    safeSend(win, "updates:progress", eventPayload);
  }
}

function migrateLegacyDefaultProfile(nextProfile = {}) {
  const email = String(nextProfile.email || "").trim().toLowerCase();
  const displayName = String(nextProfile.displayName || "").trim().toLowerCase();
  if (email !== legacyDefaultEmail || (displayName && displayName !== legacyDefaultDisplayName)) return nextProfile;
  return {
    ...nextProfile,
    email: defaultProfile.email,
    displayName: defaultProfile.displayName
  };
}

function normalizeProfile(nextProfile = {}) {
  const merged = { ...defaultProfile, ...migrateLegacyDefaultProfile(nextProfile) };
  merged.email = String(merged.email || defaultProfile.email).trim();
  merged.displayName = String(merged.displayName || displayNameForEmail(merged.email) || defaultProfile.displayName).trim();
  merged.status = String(merged.status || defaultProfile.status).trim();
  merged.language = normalizeLanguage(merged.language);
  merged.personalMessage = String(merged.personalMessage ?? "").slice(0, 140);
  merged.displayPicturePath = String(merged.displayPicturePath ?? "");
  merged.displayPictureAsset = displayPictureAssetSet.has(merged.displayPictureAsset) ? merged.displayPictureAsset : "";
  return merged;
}

function normalizeCloseBehavior(value) {
  const clean = String(value || "");
  if (clean === "close") return "quit";
  return ["ask", "hide", "quit"].includes(clean) ? clean : "ask";
}

function normalizeProjectSort(value) {
  return projectSortModes.has(value) ? value : defaultProjectSort;
}

function normalizeUnreadWizzDelayMs(value) {
  const delay = Number(value);
  if (!Number.isFinite(delay)) return defaultUnreadWizzDelayMs;
  return Math.max(10_000, Math.min(30 * 60_000, Math.round(delay)));
}

function normalizeBoolean(value, fallback = true) {
  if (value === true || value === "true" || value === 1 || value === "1") return true;
  if (value === false || value === "false" || value === 0 || value === "0") return false;
  return fallback;
}

function shouldAutoSignIn(settings, status) {
  return Boolean(
    settings?.signedIn === true
    && settings?.autoSignIn !== false
    && status?.ok
    && (!status.login || status.login.ok)
  );
}

function withTimeout(promise, timeoutMs, message) {
  let timeout = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeout));
}

function normalizeContactAliases(value = {}) {
  const aliases = {};
  if (!value || typeof value !== "object") return aliases;
  for (const [contactId, name] of Object.entries(value)) {
    const key = String(contactId ?? "").trim();
    const label = String(name ?? "").trim().slice(0, 80);
    if (key && label) aliases[key] = label;
  }
  return aliases;
}

function normalizeContactStatuses(value = {}) {
  const statuses = {};
  const allowed = new Set(["online", "busy", "away", "offline"]);
  if (!value || typeof value !== "object") return statuses;
  for (const [contactId, status] of Object.entries(value)) {
    const key = String(contactId ?? "").trim();
    const clean = String(status ?? "").trim();
    if (key && allowed.has(clean)) statuses[key] = clean;
  }
  return statuses;
}

function contactAliasFor(contactId, settings = settingsCache) {
  return normalizeContactAliases(settings?.contactAliases)[String(contactId ?? "").trim()] ?? "";
}

function contactStatusFor(contactId, settings = settingsCache) {
  return normalizeContactStatuses(settings?.contactStatuses)[String(contactId ?? "").trim()] ?? "";
}

function applyContactOverrides(contact, settings = settingsCache) {
  if (!contact?.id) return contact;
  const alias = contactAliasFor(contact.id, settings);
  const status = contactStatusFor(contact.id, settings);
  return {
    ...contact,
    ...(alias ? { name: alias } : {}),
    ...(status ? { status } : {})
  };
}

function applyThreadAlias(thread, settings = settingsCache) {
  if (!thread?.contactId) return thread;
  const alias = contactAliasFor(thread.contactId, settings);
  return alias ? { ...thread, preview: alias } : thread;
}

function normalizeCodexOptionsByContact(value = {}) {
  const clean = {};
  if (!value || typeof value !== "object") return clean;
  for (const [contactId, options] of Object.entries(value)) {
    const key = String(contactId ?? "").trim();
    if (!key) continue;
    clean[key] = normalizeCodexOptions(options);
  }
  return clean;
}

function codexOptionsForContact(contactId, settings = settingsCache) {
  return normalizeCodexOptions(settings?.codexOptionsByContact?.[contactId] ?? defaultCodexOptions);
}

function cwdForCodexContact(contact, options, fallback = defaultCwd()) {
  const cleanOptions = normalizeCodexOptions(options);
  if (cleanOptions.cwdMode === "local") return defaultCwd();
  return contact?.cwd ?? fallback ?? defaultCwd();
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

function notificationsAreEnabled() {
  return normalizeBoolean(settingsCache?.notificationsEnabled, true);
}

function newMessageSoundIsEnabled() {
  return normalizeBoolean(settingsCache?.newMessageSoundEnabled, true);
}

function unreadWizzIsEnabled() {
  return normalizeBoolean(settingsCache?.unreadWizzEnabled, true);
}

function demoModeIsEnabled(settings = settingsCache) {
  return normalizeBoolean(settings?.demoMode, false);
}

function normalizedPathKey(filePath) {
  return path.resolve(String(filePath || "")).toLowerCase();
}

function isDemoProjectPath(cwd) {
  return normalizedPathKey(cwd) === normalizedPathKey(demoProjectCwd());
}

async function writeFileIfMissing(filePath, text) {
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, text, "utf8");
  }
}

async function ensureDemoProject() {
  const cwd = demoProjectCwd();
  await fs.mkdir(path.join(cwd, "notes"), { recursive: true });
  await writeFileIfMissing(
    path.join(cwd, "README.md"),
    [
      "# Codex Messenger Tour",
      "",
      "This folder is used by Codex Messenger demo mode.",
      "It exists only so Codex has an isolated workspace while the app shows demo agents, projects, and threads.",
      "",
      "Real Codex conversations and user projects are not copied here."
    ].join("\n")
  );
  await writeFileIfMissing(
    path.join(cwd, "notes", "xp-window-checklist.md"),
    [
      "# XP Window Checklist",
      "",
      "- Glossy blue title bar",
      "- MSN-style menu and toolbar",
      "- Wizz movement on the native window",
      "- Conversation tabs inside project windows"
    ].join("\n")
  );
  await writeFileIfMissing(
    path.join(cwd, "notes", "release-checklist.md"),
    [
      "# Release Checklist",
      "",
      "- Keep version at 0.0.1 until explicitly changed",
      "- No build unless requested",
      "- Update README before publishing",
      "- Verify Codex CLI detection"
    ].join("\n")
  );
  return cwd;
}

function demoContacts() {
  const cwd = demoProjectCwd();
  return [
    {
      id: "demo-agent:guide",
      name: "Codex Guide",
      mail: "guide@codex.local",
      group: "Showcase",
      status: "online",
      mood: "visite guidee",
      color: "#0f8b78",
      avatar: "butterfly",
      kind: "agent",
      cwd,
      instructions:
        "Tu es Codex Guide dans Codex Messenger. Cette conversation est en mode demonstration isole. " +
        "Aide l'utilisateur a decouvrir l'app sans mentionner ses vraies conversations. Travaille dans le dossier de tour fourni."
    },
    {
      id: "demo-agent:designer",
      name: "Interface Designer",
      mail: "designer@codex.local",
      group: "Showcase",
      status: "away",
      mood: "polish MSN 7",
      color: "#d88721",
      avatar: "msn-orange-daisy",
      kind: "agent",
      cwd,
      instructions:
        "Tu es un agent UI en mode demonstration Codex Messenger. Propose des ameliorations visuelles retro MSN/Windows XP, " +
        "avec des actions concretes et courtes, dans le workspace de tour uniquement."
    },
    {
      id: "demo-agent:release",
      name: "Release Reviewer",
      mail: "release@codex.local",
      group: "Showcase",
      status: "busy",
      mood: "check release",
      color: "#315fd0",
      avatar: "msn-friendly-dog",
      kind: "agent",
      cwd,
      instructions:
        "Tu es un agent release en mode demonstration Codex Messenger. Verifie les risques, la documentation, les scripts, " +
        "et les checks possibles sans lancer de build sauf demande explicite."
    }
  ];
}

function demoSeedThreadData() {
  const cwd = demoProjectCwd();
  const baseTime = Date.parse("2026-04-23T08:00:00.000Z") / 1000;
  return [
    {
      id: "demo-seed-welcome",
      preview: "Premiers pas dans Codex Messenger",
      createdAt: baseTime + 60,
      cwd,
      source: "demo",
      modelProvider: "demo",
      turns: [
        {
          items: [
            { id: "demo-welcome-user", type: "user_message", text: "Je veux voir l'app sans afficher mes vrais projets.", timestamp: "2026-04-23T08:01:00.000Z" },
            { id: "demo-welcome-agent", type: "agent_message", text: "Mode demonstration actif. Je peux repondre normalement via Codex, mais la liste montre seulement des agents et fils de presentation.", timestamp: "2026-04-23T08:01:18.000Z" }
          ]
        }
      ]
    },
    {
      id: "demo-seed-xp-polish",
      preview: "Polish XP sur une fenetre de conversation",
      createdAt: baseTime + 120,
      cwd,
      source: "demo",
      modelProvider: "demo",
      turns: [
        {
          items: [
            { id: "demo-polish-user", type: "user_message", text: "Analyse la fenetre et trouve trois details qui ne font pas assez MSN 7.", timestamp: "2026-04-23T08:02:00.000Z" },
            { id: "demo-polish-agent", type: "agent_message", text: "Priorites: renforcer les reflets du titre, rapprocher les flyouts des boutons, et garder la zone de saisie visible au resize. Je peux ensuite appliquer ces corrections.", timestamp: "2026-04-23T08:02:24.000Z" }
          ]
        }
      ]
    },
    {
      id: "demo-seed-release-check",
      preview: "Checklist release Windows",
      createdAt: baseTime + 180,
      cwd,
      source: "demo",
      modelProvider: "demo",
      turns: [
        {
          items: [
            { id: "demo-release-user", type: "user_message", text: "Prepare une checklist release sans changer la version.", timestamp: "2026-04-23T08:03:00.000Z" },
            { id: "demo-release-agent", type: "agent_message", text: "Checklist: garder `0.0.1`, verifier detection Codex, relire README, tester le launcher, puis publier seulement les artefacts demandes.", timestamp: "2026-04-23T08:03:19.000Z" }
          ]
        }
      ]
    }
  ];
}

function isDemoSeedThreadId(threadId) {
  return demoSeedThreadIds.has(String(threadId || ""));
}

function demoSeedThreadById(threadId) {
  return demoSeedThreadData().find((thread) => thread.id === threadId) ?? null;
}

function demoSeedThreads() {
  return demoSeedThreadData().map((thread) => {
    knownThreads.set(thread.id, thread);
    return normalizeThread(thread);
  });
}

function closeChatWindowsForModeSwitch() {
  for (const [key, win] of windows.entries()) {
    if (!key.startsWith("chat:")) continue;
    if (!win.isDestroyed()) win.close();
  }
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
  const cwd = String(agent.cwd || defaultCwd()).trim() || defaultCwd();
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
    cwd,
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
  const source = demoModeIsEnabled(settings) ? demoContacts() : [...contacts, ...normalizeCustomAgents(settings?.customAgents ?? [])];
  return source.map((contact) => applyContactOverrides(contact, settings));
}

async function loadSettings() {
  if (settingsCache) return settingsCache;
  const rawSettings = await settingsStore.loadRaw();
  const loadedStoredSettings = rawSettings.loadedStoredSettings;
  settingsCache = rawSettings.settings;
  settingsCache.language = normalizeLanguage(settingsCache.language);
  settingsCache.profile = normalizeProfile({
    ...settingsCache.profile,
    language: settingsCache.language
  });
  settingsCache.customAgents = normalizeCustomAgents(settingsCache.customAgents);
  settingsCache.contactAliases = normalizeContactAliases(settingsCache.contactAliases);
  settingsCache.contactStatuses = normalizeContactStatuses(settingsCache.contactStatuses);
  settingsCache.threadTabs = normalizeThreadTabs(settingsCache.threadTabs);
  settingsCache.projectSort = normalizeProjectSort(settingsCache.projectSort);
  settingsCache.textStyles = normalizeTextStyles(settingsCache.textStyles);
  settingsCache.codexOptionsByContact = normalizeCodexOptionsByContact(settingsCache.codexOptionsByContact);
  settingsCache.unreadWizzDelayMs = normalizeUnreadWizzDelayMs(settingsCache.unreadWizzDelayMs);
  settingsCache.notificationsEnabled = normalizeBoolean(settingsCache.notificationsEnabled, true);
  settingsCache.newMessageSoundEnabled = normalizeBoolean(settingsCache.newMessageSoundEnabled, true);
  settingsCache.unreadWizzEnabled = normalizeBoolean(settingsCache.unreadWizzEnabled, true);
  settingsCache.demoMode = normalizeBoolean(settingsCache.demoMode, false);
  settingsCache.closeBehavior = normalizeCloseBehavior(settingsCache.closeBehavior);
  settingsCache.signedIn = normalizeBoolean(settingsCache.signedIn, loadedStoredSettings && Boolean(settingsCache.profile.email));
  settingsCache.autoSignIn = normalizeBoolean(settingsCache.autoSignIn, true);
  Object.assign(profile, settingsCache.profile);
  return settingsCache;
}

async function saveSettings(nextSettings = {}) {
  const current = await loadSettings();
  const previousDemoMode = demoModeIsEnabled(current);
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
    contactAliases: normalizeContactAliases(nextSettings.contactAliases ?? current.contactAliases),
    contactStatuses: normalizeContactStatuses(nextSettings.contactStatuses ?? current.contactStatuses),
    threadTabs: normalizeThreadTabs(nextSettings.threadTabs ?? current.threadTabs),
    projectSort: normalizeProjectSort(nextSettings.projectSort ?? current.projectSort),
    textStyles: normalizeTextStyles(nextSettings.textStyles ?? current.textStyles),
    codexOptionsByContact: normalizeCodexOptionsByContact(nextSettings.codexOptionsByContact ?? current.codexOptionsByContact),
    unreadWizzDelayMs: normalizeUnreadWizzDelayMs(nextSettings.unreadWizzDelayMs ?? current.unreadWizzDelayMs),
    notificationsEnabled: normalizeBoolean(nextSettings.notificationsEnabled ?? current.notificationsEnabled, true),
    newMessageSoundEnabled: normalizeBoolean(nextSettings.newMessageSoundEnabled ?? current.newMessageSoundEnabled, true),
    unreadWizzEnabled: normalizeBoolean(nextSettings.unreadWizzEnabled ?? current.unreadWizzEnabled, true),
    demoMode: normalizeBoolean(nextSettings.demoMode ?? current.demoMode, false),
    closeBehavior: normalizeCloseBehavior(nextSettings.closeBehavior ?? current.closeBehavior),
    signedIn: normalizeBoolean(nextSettings.signedIn ?? current.signedIn, false),
    autoSignIn: normalizeBoolean(nextSettings.autoSignIn ?? current.autoSignIn, true)
  };
  await settingsStore.save(settingsCache);
  Object.assign(profile, settingsCache.profile);
  if (!settingsCache.unreadWizzEnabled) {
    for (const contactId of unreadReminderByContact.keys()) clearUnreadReminder(contactId);
  }
  if (!settingsCache.notificationsEnabled) {
    notifications.closeAllToasts();
  }
  if (settingsCache.demoMode !== previousDemoMode) {
    setTimeout(closeChatWindowsForModeSwitch, 80);
  }
  return settingsCache;
}

async function resolveCodexCommand(candidatePath = null) {
  const settings = await loadSettings();
  try {
    return await findCodexCommand(candidatePath ?? settings.codexPath ?? "");
  } catch {
    throw new Error("Codex CLI introuvable. Installez Codex puis relancez l'app, ou indiquez le chemin vers le binaire codex dans l'ecran de connexion.");
  }
}

async function codexVersionRequirement(command) {
  const version = await codexVersion(command);
  const support = codexVersionSupport(version);
  return {
    version,
    minimumCodexVersion: support.minimumVersion,
    versionSupported: support.ok
  };
}

async function resolveSupportedCodexCommand(candidatePath = null) {
  const resolved = await resolveCodexCommand(candidatePath);
  const version = await codexVersionRequirement(resolved.command);
  if (!version.versionSupported) {
    throw new Error(unsupportedCodexVersionMessage(version.version, version.minimumCodexVersion));
  }
  return resolved;
}

function runCodexCommand(command, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawnCommand(command, args, {
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
  const npm = await findNpmCommand();
  try {
    const resolved = await resolveCodexCommand(candidatePath);
    const version = await codexVersionRequirement(resolved.command);
    const base = {
      ...resolved,
      configured: Boolean(settings.codexPath),
      npm,
      version: version.version,
      minimumCodexVersion: version.minimumCodexVersion,
      versionSupported: version.versionSupported
    };
    if (!version.versionSupported) {
      return {
        ok: false,
        ...base,
        login: { ok: false, text: "Codex CLI update required" },
        ready: false,
        error: unsupportedCodexVersionMessage(version.version, version.minimumCodexVersion)
      };
    }
    const login = await codexLoginStatus(resolved.command);
    return { ok: true, ...base, login, ready: login.ok };
  } catch (error) {
    return {
      ok: false,
      command: "",
      source: "missing",
      configured: Boolean(settings.codexPath),
      npm,
      version: "",
      minimumCodexVersion,
      versionSupported: false,
      login: { ok: false, text: "Codex CLI not available" },
      ready: false,
      error: error.message
    };
  }
}

function quotePosixArg(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function quotePowerShellArg(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function openCodexLoginTerminal(command) {
  if (process.platform === "darwin") {
    const shellCommand = `${quotePosixArg(command)} login; echo; echo "Codex login finished. You can close this window."`;
    return execFileAsync("osascript", [
      "-e",
      "tell application \"Terminal\" to activate",
      "-e",
      `tell application "Terminal" to do script ${JSON.stringify(shellCommand)}`
    ]);
  }

  if (process.platform === "win32") {
    const script = `& ${quotePowerShellArg(command)} login; Write-Host ""; Read-Host "Codex login finished. Press Enter to close"`;
    const child = spawn("powershell.exe", ["-NoExit", "-ExecutionPolicy", "Bypass", "-Command", script], {
      detached: true,
      windowsHide: false,
      stdio: "ignore"
    });
    child.unref();
    return Promise.resolve();
  }

  const child = spawn(command, ["login"], {
    detached: true,
    stdio: "ignore"
  });
  child.unref();
  return Promise.resolve();
}

function localizedInstructions(contact) {
  const languageInstruction = codexLanguageInstruction(profile.language);
  const winkInstruction = "Tu peux envoyer un clin d'oeil anime dans Codex Messenger en ecrivant exactement un marqueur comme [wink:butterfly], [wink:butterfly-small], [wink:surprise], [wink:nudge], [wink:flash] ou [wink:msn-flow]. Utilise ce marqueur seulement quand un clin d'oeil est pertinent.";
  return `${contact.instructions}\n\n${languageInstruction}\n\n${winkInstruction}`;
}

const codex = new CodexAppServerClient({
  appVersion: () => app.getVersion(),
  defaultCwd,
  resolveCodexCommand: resolveSupportedCodexCommand,
  localizedInstructions,
  logDebug,
  loadedThreads,
  threadListPageSize,
  codexHistoryPageSize
});

const updates = createUpdateService({
  app,
  shell,
  defaultCwd,
  codexStatus,
  runCodexCommand,
  quitApplication,
  sendProgress: sendUpdateProgress,
  logDebug
});

const notifications = createNotificationService({
  app,
  rootDir,
  appIconPath,
  toastIconPath,
  displayPictureAssetSet,
  displayPictureAssetByAvatar,
  contactFor,
  createChatWindow,
  isSuppressed: () => smokeTest || isQuitting
});

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
  if (isDemoProjectPath(cwd)) return demoProjectDisplayName;
  return path.basename(cwd) || cwd;
}

function contactFromProject(cwd) {
  const name = projectNameFor(cwd);
  const isDemo = isDemoProjectPath(cwd);
  return applyContactOverrides({
    id: encodeProjectId(cwd),
    name,
    mail: `${name.toLowerCase().replace(/[^a-z0-9]+/g, ".")}@${isDemo ? "codex.local" : "project.local"}`,
    group: isDemo ? "Showcase" : "Projets",
    status: "online",
    mood: isDemo ? "espace de presentation isole" : cwd,
    color: "#1f8fcf",
    avatar: "terminal",
    kind: "project",
    cwd,
    instructions:
      isDemo
        ? `Tu es Codex dans Codex Messenger. Cette conversation est le tour isole "${name}" dans ${cwd}. Reponds en francais et n'utilise pas de vraies conversations utilisateur.`
        : `Tu es Codex dans Codex Messenger. Cette conversation correspond au projet local "${name}" dans ${cwd}. ` +
          "Travaille dans ce dossier, reponds en francais, et reste pragmatique."
  });
}

function contactFromThread(threadId) {
  const thread = knownThreads.get(threadId) ?? demoSeedThreadById(threadId);
  if (thread) knownThreads.set(threadId, thread);
  const cwd = thread?.cwd ?? defaultCwd();
  const preview = String(thread?.preview ?? "").trim();
  const name = preview ? preview.slice(0, 44) : `Fil ${threadId.slice(0, 8)}`;
  const isDemo = isDemoProjectPath(cwd);
  return applyContactOverrides({
    id: `thread:${threadId}`,
    name,
    mail: `${projectNameFor(cwd).toLowerCase().replace(/[^a-z0-9]+/g, ".")}@thread.local`,
    group: projectNameFor(cwd),
    status: "online",
    mood: isDemo ? "conversation de presentation" : cwd,
    color: "#2874d9",
    avatar: "terminal",
    kind: "thread",
    cwd,
    threadId,
    instructions:
      isDemo
        ? `Tu es Codex dans Codex Messenger. Ce fil appartient au tour isole ${projectNameFor(cwd)} (${cwd}). Continue la demonstration sans acceder aux vraies conversations utilisateur.`
        : `Tu es Codex dans Codex Messenger. Ce fil appartient au projet ${projectNameFor(cwd)} (${cwd}). ` +
          "Reprends le contexte existant et reponds en francais."
  });
}

function contactFor(id) {
  const fixedContact = contactsForSettings().find((contact) => contact.id === id);
  if (fixedContact) return fixedContact;
  const cwd = decodeProjectId(id);
  if (cwd) return contactFromProject(cwd);
  const threadId = threadIdFromContactId(id);
  if (threadId) return contactFromThread(threadId);
  return contactsForSettings()[0] ?? contacts[0];
}

async function listWorkspaceProjects(settings = settingsCache) {
  if (demoModeIsEnabled(settings)) {
    await ensureDemoProject();
    return [demoProjectCwd()];
  }
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
  const updatedAt = Number(thread.updatedAt ?? thread.createdAt ?? 0) * 1000;
  return {
    id: thread.id,
    contactId: `thread:${thread.id}`,
    preview: String(thread.preview ?? "").trim() || "Nouveau fil Codex",
    cwd: thread.cwd || defaultCwd(),
    projectName: projectNameFor(thread.cwd || defaultCwd()),
    createdAt: createdAt ? new Date(createdAt).toISOString() : null,
    updatedAt: updatedAt ? new Date(updatedAt).toISOString() : null,
    timestamp: updatedAt || createdAt ? new Date(updatedAt || createdAt).toISOString() : null,
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

function codexServerIsActive() {
  return Boolean(codex.child || codex.ready || codex.userAgent);
}

function scheduleCodexWarmup(reason = "startup") {
  if (smokeTest || codexWarmupPromise || codexServerIsActive()) return codexWarmupPromise;
  codexWarmupPromise = withTimeout(
    codex.ensureReady(),
    30000,
    "Démarrage de Codex trop long."
  )
    .then((init) => {
      const payload = {
        kind: "ready",
        text: init.userAgent || "Codex pret",
        userAgent: init.userAgent || "",
        reason
      };
      sendToMain("codex:status", payload);
      sendToOpenChats("codex:status", payload);
      return init;
    })
    .catch((error) => {
      codex.stop(error.message);
      const payload = { kind: "error", text: error.message, reason };
      sendToMain("codex:status", payload);
      sendToOpenChats("codex:status", payload);
      return null;
    })
    .finally(() => {
      codexWarmupPromise = null;
    });
  return codexWarmupPromise;
}

async function conversationBrowser(options = {}) {
  const settings = await loadSettings();
  const browserThreads = await listBrowserThreads(settings, {
    startCodex: Boolean(options.startCodex),
    cursor: options.cursor ?? null,
    limit: options.limit ?? threadListPageSize,
    cwd: options.cwd ?? null,
    searchTerm: options.searchTerm ?? null
  });
  const { visible: threads, hidden: hiddenThreads } = browserThreads;

  const projectPaths = new Set();
  for (const thread of threads) projectPaths.add(thread.cwd);
  for (const thread of hiddenThreads) projectPaths.add(thread.cwd);
  if (demoModeIsEnabled(settings) && !projectPaths.size) {
    for (const cwd of await listWorkspaceProjects(settings)) projectPaths.add(cwd);
  }

  const projects = await Promise.all(Array.from(projectPaths).map(async (cwd) => {
    const projectContactId = encodeProjectId(cwd);
    const projectThreads = sortThreadsForCwd(
      threads.filter((thread) => thread.cwd === cwd),
      cwd,
      settings.threadTabs
    );
    const projectHiddenThreads = sortThreadsForCwd(
      hiddenThreads.filter((thread) => thread.cwd === cwd),
      cwd,
      settings.threadTabs
    );
    const allProjectThreads = [...projectThreads, ...projectHiddenThreads];
    return {
      id: projectContactId,
      cwd,
      name: contactAliasFor(projectContactId, settings) || projectNameFor(cwd),
      threads: projectThreads,
      hiddenThreads: projectHiddenThreads,
      hiddenThreadCount: projectHiddenThreads.length,
      visibleThreadCount: projectThreads.length,
      ...(await projectMetadata(cwd, allProjectThreads))
    };
  }));

  return {
    rootDir: defaultCwd(),
    projectsRoot: projectsRoot(),
    projects: projects.sort((a, b) => a.name.localeCompare(b.name)),
    nextCursor: browserThreads.nextCursor ?? null,
    backwardsCursor: browserThreads.backwardsCursor ?? null,
    hasMore: Boolean(browserThreads.nextCursor)
  };
}

function splitHiddenThreads(threads = [], settings = settingsCache) {
  const hiddenIds = new Set(settings?.threadTabs?.hiddenIds ?? []);
  return {
    visible: threads.filter((thread) => !hiddenIds.has(thread.id)),
    hidden: threads.filter((thread) => hiddenIds.has(thread.id))
  };
}

async function listBrowserThreads(settings = settingsCache, options = {}) {
  const currentSettings = settings ?? await loadSettings();
  const shouldQueryCodex = Boolean(options.startCodex || codexServerIsActive());
  if (!shouldQueryCodex) {
    if (demoModeIsEnabled(currentSettings)) {
      await ensureDemoProject();
      return {
        ...splitHiddenThreads(
        demoSeedThreads().map((thread) => applyThreadAlias(thread, currentSettings)),
        currentSettings
        ),
        nextCursor: null,
        backwardsCursor: null
      };
    }
    return { visible: [], hidden: [], nextCursor: null, backwardsCursor: null };
  }

  try {
    const page = await codex.listThreads({
      cursor: options.cursor ?? null,
      limit: options.limit ?? threadListPageSize,
      cwd: options.cwd ?? null,
      searchTerm: options.searchTerm ?? null,
      useStateDbOnly: true
    });
    const listedThreads = (page.data ?? []).map(normalizeThread).map((thread) => applyThreadAlias(thread, currentSettings));
    const listedIds = new Set(listedThreads.map((thread) => thread.id));
    const hiddenMetadata = (await Promise.all(currentSettings.threadTabs.hiddenIds
      .filter((threadId) => !listedIds.has(threadId))
      .slice(0, 100)
      .map(async (threadId) => {
        try {
          const thread = await codex.readThread(threadId, { includeTurns: false });
          return thread ? applyThreadAlias(normalizeThread(thread), currentSettings) : null;
        } catch {
          return null;
        }
      }))).filter(Boolean);
    const threads = [...listedThreads, ...hiddenMetadata];
    if (demoModeIsEnabled(currentSettings)) {
      await ensureDemoProject();
      const realDemoThreads = threads.filter((thread) => isDemoProjectPath(thread.cwd));
      const seeded = demoSeedThreads().map((thread) => applyThreadAlias(thread, currentSettings));
      return {
        ...splitHiddenThreads([...seeded, ...realDemoThreads], currentSettings),
        nextCursor: page.nextCursor ?? null,
        backwardsCursor: page.backwardsCursor ?? null
      };
    }
    return {
      ...splitHiddenThreads(threads, currentSettings),
      nextCursor: page.nextCursor ?? null,
      backwardsCursor: page.backwardsCursor ?? null
    };
  } catch {
    if (demoModeIsEnabled(currentSettings)) {
      await ensureDemoProject();
      return {
        ...splitHiddenThreads(
        demoSeedThreads().map((thread) => applyThreadAlias(thread, currentSettings)),
        currentSettings
        ),
        nextCursor: null,
        backwardsCursor: null
      };
    }
    return { visible: [], hidden: [], nextCursor: null, backwardsCursor: null };
  }
}

async function listVisibleThreads(settings = settingsCache, options = {}) {
  return (await listBrowserThreads(settings, options)).visible;
}

async function revealThreadInTabs(threadId) {
  const cleanThreadId = String(threadId || "").trim();
  if (!cleanThreadId) return await loadSettings();
  const current = await loadSettings();
  if (!current.threadTabs.hiddenIds.includes(cleanThreadId)) return current;
  return await saveSettings({
    threadTabs: {
      ...current.threadTabs,
      hiddenIds: current.threadTabs.hiddenIds.filter((id) => id !== cleanThreadId)
    }
  });
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
  return messagesFromTurns(thread?.turns ?? [], contact);
}

function messagesFromTurns(turns, contact) {
  const messages = [];
  const author = historyAuthorForContact(contact);
  for (const turn of turns ?? []) {
    for (const item of turn.items ?? []) {
      const type = String(item.type ?? "").toLowerCase();
      const timeSource = {
        ...item,
        createdAt: item.createdAt ?? turn.completedAt ?? turn.startedAt
      };
      if (["usermessage", "user_message", "user"].includes(type)) {
        const text = textFromItem(item);
        if (text) messages.push({ id: item.id ?? `user-${messages.length}`, from: "me", author: profile.displayName, text, time: timeFromHistoryItem(timeSource), itemType: item.type });
      } else if (["agentmessage", "agent_message", "assistant", "assistant_message"].includes(type)) {
        const text = textFromItem(item);
        if (text) messages.push({ id: item.id ?? `agent-${messages.length}`, from: "them", author, text, time: timeFromHistoryItem(timeSource), itemType: item.type });
      } else if (isCodexImageItem(item)) {
        const image = codexImageFromItem(item);
        if (image) {
          messages.push({
            id: item.id ?? `image-${messages.length}`,
            from: "them",
            author,
            text: image.text,
            time: timeFromHistoryItem(timeSource),
            itemType: item.type,
            attachment: image.src ? {
              type: "image",
              src: image.src,
              name: image.name,
              path: image.path,
              prompt: image.prompt,
              status: image.status
            } : null,
            imageCommand: image.kind === "imageGeneration" ? {
              command: "image_generation_call",
              status: image.status,
              prompt: image.prompt,
              path: image.path
            } : null
          });
        }
      } else if (type === "commandexecution") {
        const output = item.aggregatedOutput ? `\n\n${item.aggregatedOutput}` : "";
        messages.push({
          id: item.id ?? `command-${messages.length}`,
          from: "system",
          author: "command",
          text: `${item.command ?? "Commande Codex"}${output}`,
          time: timeFromHistoryItem(timeSource),
          itemType: "commandExecution",
          command: item.command,
          cwd: item.cwd,
          status: item.status,
          exitCode: item.exitCode,
          durationMs: item.durationMs
        });
      } else if (type === "filechange") {
        const changes = Array.isArray(item.changes) ? item.changes : [];
        messages.push({
          id: item.id ?? `file-${messages.length}`,
          from: "system",
          author: "files",
          text: changes.length ? changes.map((change) => change.path ?? change.file ?? "fichier").join("\n") : "Modification de fichiers",
          time: timeFromHistoryItem(timeSource),
          itemType: "fileChange",
          changes,
          status: item.status
        });
      } else if (type === "mcptoolcall" || type === "dynamictoolcall") {
        messages.push({
          id: item.id ?? `tool-${messages.length}`,
          from: "system",
          author: "tool",
          text: `${item.server ? `${item.server}: ` : ""}${item.tool ?? "outil"} (${item.status ?? "termine"})`,
          time: timeFromHistoryItem(timeSource),
          itemType: item.type,
          status: item.status
        });
      }
    }
  }
  return messages;
}

async function threadHistoryPageFromServer(threadId, contact, options = {}) {
  try {
    const page = await codex.listThreadTurns(threadId, {
      cursor: options.cursor || null,
      limit: options.limit || codexHistoryPageSize,
      sortDirection: "desc"
    });
    const turns = [...(page.data ?? [])].reverse();
    return {
      messages: messagesFromTurns(turns, contact),
      historyCursor: page.nextCursor ?? null,
      historyBackwardsCursor: page.backwardsCursor ?? null,
      historyHasMore: Boolean(page.nextCursor),
      historySource: "codex-app-server"
    };
  } catch {
    return {
      messages: [],
      historyCursor: null,
      historyBackwardsCursor: null,
      historyHasMore: false,
      historySource: "codex-app-server"
    };
  }
}

function threadHistoryPageFromThread(thread, contact, options = {}) {
  const limit = Math.max(1, Math.min(50, Number(options.limit) || codexHistoryPageSize));
  const skipNewest = Math.max(0, Number(options.cursor) || 0);
  const messages = messagesFromThread(thread, contact);
  const end = Math.max(0, messages.length - skipNewest);
  const start = Math.max(0, end - limit);
  return {
    messages: messages.slice(start, end),
    historyCursor: messages.length - start,
    historyHasMore: start > 0,
    historySource: "codex-app-server"
  };
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

const createBaseWindow = createBaseWindowFactory({
  dirname: __dirname,
  appIconPath,
  windows,
  showDockIcon,
  smokeTest,
  onSmokeReady: () => app.quit(),
  openExternalUrl
});

function showMainWindow() {
  showDockIcon();
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
  createTray();
  win.hide();
  hideDockIconIfNoVisibleWindows();
}

function showDockIcon() {
  if (process.platform === "darwin") app.dock?.show();
}

function hideDockIconIfNoVisibleWindows() {
  if (process.platform !== "darwin" || !app.dock) return;
  const hasVisibleWindow = BrowserWindow.getAllWindows().some((item) => !item.isDestroyed() && item.isVisible());
  if (!hasVisibleWindow) app.dock.hide();
}

async function handleMainWindowClose(event, win) {
  if (isQuitting || smokeTest) return;
  event.preventDefault();
  const settings = await loadSettings();
  let behavior = normalizeCloseBehavior(settings.closeBehavior);

  if (behavior === "ask") {
    const hideLabel = process.platform === "darwin" ? "Laisser dans la barre de menu" : "Reduire dans la zone de notification";
    const hideDetail = process.platform === "darwin"
      ? "Codex Messenger restera ouvert en fond avec une icone dans la barre de menu macOS. Tu peux aussi quitter completement l'application."
      : "Codex Messenger restera ouvert en fond dans la zone de notification. Tu peux aussi quitter completement l'application.";
    const result = await dialog.showMessageBox(win, {
      type: "question",
      title: "Codex Messenger",
      message: "Fermer Codex Messenger ?",
      detail: hideDetail,
      buttons: [hideLabel, "Fermer definitivement", "Annuler"],
      defaultId: 0,
      cancelId: 2,
      checkboxLabel: "Memoriser mon choix",
      checkboxChecked: false
    });
    if (result.response === 2) return;
    behavior = result.response === 1 ? "quit" : "hide";
    if (result.checkboxChecked) await saveSettings({ closeBehavior: behavior });
  }

  if (behavior === "quit") quitApplication();
  else hideMainWindow();
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
    clearUnread(contactId);
  });
  win.on("closed", () => clearUnreadReminder(contactId));
  win.loadURL(rendererUrl({ view: "chat", contactId }));
  return win;
}

function createTray() {
  if (tray) return tray;
  tray = new Tray(trayIcon());
  tray.setToolTip("Codex Messenger");
  const updateMenu = () => {
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: "Afficher Codex Messenger", click: showMainWindow },
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

function trayIcon() {
  if (process.platform === "darwin") {
    const templateIcon = macTrayTemplateIcon();
    if (!templateIcon.isEmpty()) return templateIcon;
  }

  const image = nativeImage.createFromPath(appIconPath);
  if (process.platform !== "darwin" || image.isEmpty()) return image;
  return image.resize({ width: 18, height: 18 });
}

function macTrayTemplateIcon() {
  const image = nativeImage.createEmpty();
  try {
    image.addRepresentation({ scaleFactor: 1, buffer: readFileSync(macTrayTemplateIconPath) });
    image.addRepresentation({ scaleFactor: 2, buffer: readFileSync(macTrayTemplateIcon2xPath) });
    image.setTemplateImage(true);
    return image;
  } catch {
    const fallback = nativeImage.createFromPath(macTrayTemplateIconPath);
    if (!fallback.isEmpty()) fallback.setTemplateImage(true);
    return fallback;
  }
}

function quitApplication() {
  isQuitting = true;
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.destroy();
  }
  app.quit();
}

function retargetChatWindow(event, contactId) {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return null;

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
  return win;
}

function switchChatWindow(event, contactId) {
  const win = retargetChatWindow(event, contactId);
  if (!win) {
    createChatWindow(contactId);
    return { ok: true };
  }

  win.loadURL(rendererUrl({ view: "chat", contactId }));
  return { ok: true };
}

function sendToChat(contactId, channel, payload) {
  const win = windows.get(`chat:${contactId}`);
  if (!win || win.isDestroyed()) return;
  safeSend(win, channel, payload);
}

function sendToOpenChats(channel, payload) {
  for (const [key, win] of windows) {
    if (!key.startsWith("chat:") || !win || win.isDestroyed()) continue;
    safeSend(win, channel, payload);
  }
}

function sendToMain(channel, payload) {
  const win = windows.get("main");
  if (!win || win.isDestroyed()) return;
  safeSend(win, channel, payload);
}

function clearTurnTimers(meta) {
  if (!meta) return;
  if (meta.noResponseTimer) clearTimeout(meta.noResponseTimer);
  if (meta.stalledTimer) clearTimeout(meta.stalledTimer);
  meta.noResponseTimer = null;
  meta.stalledTimer = null;
}

function notifyTurnStatus(threadId, text, kind = "warning") {
  const meta = activeTurnMetaByThread.get(threadId);
  if (!meta?.contactId || !text) return;
  logDebug("codex.turn.status-note", {
    contactId: meta.contactId,
    threadId,
    turnId: meta.turnId,
    kind,
    text
  });
  sendToChat(meta.contactId, "codex:status-note", { contactId: meta.contactId, text, kind });
}

function markTurnStalled(threadId) {
  const meta = activeTurnMetaByThread.get(threadId);
  if (!meta) return;
  const elapsedSeconds = Math.max(1, Math.round((Date.now() - meta.startedAt) / 1000));
  const text = `Codex ne renvoie aucune sortie depuis ${elapsedSeconds}s. Le tour est probablement bloque cote Codex/app-server ou reseau. Tu peux cliquer Stop puis renvoyer le message.`;
  logDebug("codex.turn.stalled", {
    contactId: meta.contactId,
    threadId,
    turnId: meta.turnId,
    elapsedSeconds
  });
  sendToChat(meta.contactId, "codex:status-note", { contactId: meta.contactId, text, kind: "warning" });
}

function armTurnTimers(meta) {
  clearTurnTimers(meta);
  meta.noResponseTimer = setTimeout(() => {
    notifyTurnStatus(
      meta.threadId,
      "Codex a bien recu le message, mais aucune sortie n'est encore revenue. Je continue d'attendre le flux app-server.",
      "reconnecting"
    );
  }, turnNoResponseNoticeMs);
  meta.stalledTimer = setTimeout(() => markTurnStalled(meta.threadId), turnStalledNoticeMs);
}

function trackActiveTurn(threadId, contactId, turnId) {
  const cleanThreadId = String(threadId || "").trim();
  const cleanContactId = String(contactId || "").trim();
  const cleanTurnId = String(turnId || "").trim();
  if (!cleanThreadId || !cleanContactId || !cleanTurnId) return;
  clearTurnTimers(activeTurnMetaByThread.get(cleanThreadId));
  const meta = {
    threadId: cleanThreadId,
    contactId: cleanContactId,
    turnId: cleanTurnId,
    startedAt: Date.now(),
    lastActivityAt: Date.now(),
    visibleOutputCount: 0,
    warningKeys: new Set(),
    noResponseTimer: null,
    stalledTimer: null
  };
  activeTurnMetaByThread.set(cleanThreadId, meta);
  armTurnTimers(meta);
}

function noteTurnActivity(threadId) {
  const meta = activeTurnMetaByThread.get(threadId);
  if (!meta) return;
  meta.lastActivityAt = Date.now();
  if (meta.noResponseTimer) {
    clearTimeout(meta.noResponseTimer);
    meta.noResponseTimer = null;
  }
  if (meta.stalledTimer) {
    clearTimeout(meta.stalledTimer);
    meta.stalledTimer = setTimeout(() => markTurnStalled(meta.threadId), turnStalledNoticeMs);
  }
}

function noteVisibleTurnOutput(threadId) {
  const meta = activeTurnMetaByThread.get(threadId);
  if (meta) meta.visibleOutputCount = (meta.visibleOutputCount ?? 0) + 1;
  noteTurnActivity(threadId);
}

function clearActiveTurn(threadId) {
  const meta = activeTurnMetaByThread.get(threadId);
  clearTurnTimers(meta);
  activeTurnMetaByThread.delete(threadId);
}

function mcpConnectorNameFromWarning(message) {
  const url = String(message || "").match(/https?:\/\/[^"\\,\s)]+/i)?.[0];
  if (!url) return "";
  try {
    const host = new URL(url).hostname.replace(/^mcp\./i, "").replace(/^www\./i, "");
    const name = host.split(".")[0] || "";
    if (!name) return "";
    return name.charAt(0).toUpperCase() + name.slice(1);
  } catch {
    return "";
  }
}

function codexRuntimeWarnings(stderrText) {
  const warnings = [];
  for (const rawLine of String(stderrText || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    let message = line;
    try {
      message = JSON.parse(line)?.fields?.message || line;
    } catch {
      // Some stderr chunks are plain text or truncated JSON.
    }
    if (/stream disconnected - retrying sampling request/i.test(message)) {
      const retry = message.match(/\((\d+\/\d+)[^)]+\)/)?.[1] ?? "";
      warnings.push({
        key: `stream:${retry || message}`,
        kind: "reconnecting",
        text: `Flux Codex interrompu, nouvelle tentative${retry ? ` ${retry}` : ""}. La reponse peut prendre plus longtemps.`
      });
    } else if (/failed to refresh available models/i.test(message)) {
      warnings.push({
        key: "models-refresh",
        kind: "warning",
        text: "Codex n'arrive pas a rafraichir la liste des modeles pour l'instant. Le message reste envoye, mais la reponse peut etre retardee."
      });
    } else if (/invalid_token|Missing or invalid access token/i.test(message) && /mcp|oauth|Bearer/i.test(message)) {
      const connectorName = mcpConnectorNameFromWarning(message);
      warnings.push({
        key: `mcp-invalid-token:${connectorName || "unknown"}`,
        kind: "warning",
        text: `${connectorName ? `Le connecteur MCP ${connectorName}` : "Un connecteur MCP"} configure dans Codex a un token expire ou invalide. Si la reponse bloque, desactive ou reconnecte ce connecteur dans Codex.`
      });
    }
  }
  return warnings;
}

function logCodexRuntimeDiagnostics(stderrText) {
  const warnings = codexRuntimeWarnings(stderrText);
  if (!warnings.length) return;
  for (const warning of warnings) {
    logDebug("codex.runtime.warning", {
      key: warning.key,
      kind: warning.kind,
      text: warning.text
    });
    for (const meta of activeTurnMetaByThread.values()) {
      if (!meta?.contactId || meta.warningKeys?.has(warning.key)) continue;
      meta.warningKeys?.add(warning.key);
      sendToChat(meta.contactId, "codex:status-note", {
        contactId: meta.contactId,
        text: warning.text,
        kind: warning.kind
      });
    }
  }
}

function storeThreadItem(threadId, item) {
  if (!threadId || !item?.id) return;
  let items = threadItemsByThread.get(threadId);
  if (!items) {
    items = new Map();
    threadItemsByThread.set(threadId, items);
  }
  items.set(item.id, item);
  while (items.size > 250) items.delete(items.keys().next().value);
}

function deliveredThreadItems(threadId) {
  if (!threadId) return null;
  let items = deliveredItemsByThread.get(threadId);
  if (!items) {
    items = new Set();
    deliveredItemsByThread.set(threadId, items);
  }
  return items;
}

function threadItemWasDelivered(threadId, itemId) {
  if (!threadId || !itemId) return false;
  return deliveredItemsByThread.get(threadId)?.has(itemId) === true;
}

function markThreadItemDelivered(threadId, itemId) {
  if (!threadId || !itemId) return;
  const items = deliveredThreadItems(threadId);
  items.add(itemId);
  while (items.size > 300) items.delete(items.values().next().value);
}

function threadItem(threadId, itemId) {
  return threadItemsByThread.get(threadId)?.get(itemId) ?? null;
}

function approvalPayloadsForContact(contactId) {
  return Array.from(approvalRequests.values())
    .filter((request) => request.payload.contactId === contactId)
    .map((request) => request.payload);
}

function quoteCommandPart(part) {
  const text = String(part ?? "");
  if (!text) return "\"\"";
  if (!/[\s"`]/.test(text)) return text;
  return `"${text.replace(/(["\\])/g, "\\$1")}"`;
}

function approvalCommandText(command) {
  if (Array.isArray(command)) return command.map(quoteCommandPart).join(" ");
  return String(command ?? "").trim();
}

function approvalRisk(risk) {
  if (!risk) return { riskLevel: "", riskDescription: "" };
  return {
    riskLevel: risk.riskLevel ?? risk.risk_level ?? "",
    riskDescription: risk.description ?? ""
  };
}

function normalizeApprovalFileChanges(input) {
  if (!input) return [];
  if (Array.isArray(input)) {
    return input.map((change) => ({
      path: change?.path ?? "",
      kind: change?.kind ?? change?.type ?? "modified"
    })).filter((change) => change.path);
  }
  if (typeof input === "object") {
    return Object.entries(input).map(([filePath, change]) => ({
      path: filePath,
      kind: change?.kind ?? change?.type ?? "modified"
    })).filter((change) => change.path);
  }
  return [];
}

function contactIdForApproval(params = {}) {
  const threadId = params.threadId ?? params.conversationId ?? params.turn_id ?? "";
  const contactId = contactByThread.get(threadId);
  if (contactId) return contactId;
  const firstContact = contactsForSettings()[0];
  return firstContact?.id ?? "codex";
}

function createApprovalRecord(message) {
  const params = message.params ?? {};
  const method = message.method;
  const approvalId = `approval-${nextApprovalRequestId++}`;
  const threadId = params.threadId ?? params.conversationId ?? "";
  const item = threadItem(params.threadId, params.itemId);
  const contactId = contactIdForApproval(params);
  const contact = contactFor(contactId);
  const isCommand = method === "execCommandApproval" || method === "item/commandExecution/requestApproval";
  const isV2Command = method === "item/commandExecution/requestApproval";
  const isV2File = method === "item/fileChange/requestApproval";
  const command = approvalCommandText(params.command ?? item?.command);
  const cwd = params.cwd ?? item?.cwd ?? knownThreads.get(threadId)?.cwd ?? contact?.cwd ?? defaultCwd();
  const changes = normalizeApprovalFileChanges(params.fileChanges ?? params.changes ?? item?.changes);
  const risk = approvalRisk(params.risk);
  const payload = {
    approvalId,
    contactId,
    threadId,
    kind: isCommand ? "command" : "file",
    title: isCommand ? "Codex veut executer une commande" : "Codex veut modifier des fichiers",
    command,
    cwd,
    reason: params.reason ?? "",
    riskLevel: risk.riskLevel,
    riskDescription: risk.riskDescription,
    fileChanges: changes,
    grantRoot: params.grantRoot ?? params.grant_root ?? "",
    canApproveForSession: isCommand,
    createdAt: new Date().toISOString()
  };

  return {
    approvalId,
    requestId: message.id,
    method,
    protocol: isV2Command ? "v2-command" : isV2File ? "v2-file" : "legacy",
    payload
  };
}

function approvalResponseFor(record, decision) {
  const approveForSession = decision === "approved_for_session" || decision === "allow_session";
  const approve = approveForSession || decision === "approved" || decision === "allow" || decision === "accept";
  if (record.protocol === "v2-command") {
    return {
      decision: approveForSession ? "acceptForSession" : approve ? "accept" : "decline"
    };
  }
  if (record.protocol === "v2-file") {
    return { decision: approveForSession ? "acceptForSession" : approve ? "accept" : "decline" };
  }
  return { decision: approveForSession ? "approved_for_session" : approve ? "approved" : "denied" };
}

function deliverApprovalRequest(payload) {
  let win = windows.get(`chat:${payload.contactId}`);
  if (!win || win.isDestroyed()) {
    win = createChatWindow(payload.contactId);
  }
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();

  const send = () => {
    if (!win.isDestroyed()) win.webContents.send("codex:approval-request", payload);
  };
  if (win.webContents.isLoading()) {
    win.webContents.once("did-finish-load", () => setTimeout(send, 80));
  } else {
    send();
  }
}

function resolveApprovalRequest(approvalId, decision) {
  const record = approvalRequests.get(approvalId);
  if (!record) return { ok: false, error: "Demande d'autorisation expiree." };
  const response = approvalResponseFor(record, decision);
  codex.respond(record.requestId, response);
  approvalRequests.delete(approvalId);
  sendToChat(record.payload.contactId, "codex:approval-resolved", {
    approvalId,
    contactId: record.payload.contactId,
    decision
  });
  return { ok: true };
}

function clearApprovalRequests(reason = "Codex app-server stopped") {
  for (const record of approvalRequests.values()) {
    sendToChat(record.payload.contactId, "codex:approval-resolved", {
      approvalId: record.approvalId,
      contactId: record.payload.contactId,
      decision: "expired",
      reason
    });
  }
  approvalRequests.clear();
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
  if (!unreadWizzIsEnabled()) {
    clearUnreadReminder(contactId);
    return;
  }
  const win = windows.get(`chat:${contactId}`);
  if (win && !win.isDestroyed() && win.isFocused()) {
    clearUnreadReminder(contactId);
    return;
  }
  clearUnreadReminder(contactId);
  unreadReminderByContact.set(contactId, setTimeout(() => {
    unreadReminderByContact.delete(contactId);
    const target = windows.get(`chat:${contactId}`);
    if (target && !target.isDestroyed() && target.isFocused()) {
      clearUnread(contactId);
    } else if (target && !target.isDestroyed()) {
      wizz(target, { focus: false });
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

function registerIncomingMessage(contactId, text) {
  if (!contactId || !String(text ?? "").trim()) return false;
  const now = Date.now();
  const signature = `${normalizeMessageTextForDedupe(text)}:${Math.floor(now / 6000)}`;
  if (recentIncomingByContact.get(contactId) === signature) return false;
  recentIncomingByContact.set(contactId, signature);

  const chatWin = windows.get(`chat:${contactId}`);
  if (chatWin && !chatWin.isDestroyed() && chatWin.isFocused()) {
    clearUnread(contactId);
    return false;
  }

  markUnread(contactId);
  if (chatWin && !chatWin.isDestroyed()) {
    chatWin.flashFrame(true);
  }
  scheduleUnreadReminder(contactId);
  const shouldPlaySound = newMessageSoundIsEnabled();
  const needsMainSound = shouldPlaySound && (!chatWin || chatWin.isDestroyed());
  const mainWin = windows.get("main");
  const mainCanPlaySound = mainWin && !mainWin.isDestroyed();
  if (notificationsAreEnabled()) {
    notifications.showMessengerToast(contactId, text, { playSound: needsMainSound && !mainCanPlaySound });
  }
  if (needsMainSound && mainCanPlaySound) {
    sendToMain("conversation:notify", { contactId, contact: contactFor(contactId), text: toastPreview(text) });
  }
  return true;
}

function normalizeMessageTextForDedupe(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim().slice(0, 240);
}

async function ensureThread(contactId) {
  const settings = await loadSettings();
  const contact = contactFor(contactId);
  const codexOptions = codexOptionsForContact(contactId, settings);
  const mappedThreadId = threadByContact.get(contactId);
  if (mappedThreadId) {
    await ensureLoadedThread(contactId, mappedThreadId, contact, codexOptions);
    return mappedThreadId;
  }

  const existingThreadId = threadIdFromContactId(contactId);
  if (existingThreadId && !isDemoSeedThreadId(existingThreadId)) {
    await ensureLoadedThread(contactId, existingThreadId, contact, codexOptions);
    threadByContact.set(contactId, existingThreadId);
    contactByThread.set(existingThreadId, contactId);
    return existingThreadId;
  }

  if (isDemoProjectPath(contact.cwd)) await ensureDemoProject();
  const threadId = await codex.startThread(contact, cwdForCodexContact(contact, codexOptions), codexOptions);
  threadByContact.set(contactId, threadId);
  contactByThread.set(threadId, contactId);
  return threadId;
}

async function ensureLoadedThread(contactId, threadId, contact = contactFor(contactId), codexOptions = codexOptionsForContact(contactId)) {
  const cleanThreadId = String(threadId || "").trim();
  if (!cleanThreadId || isDemoSeedThreadId(cleanThreadId) || loadedThreads.has(cleanThreadId)) return null;
  logDebug("codex.thread.resume.before-turn", { contactId, threadId: cleanThreadId });
  const thread = await codex.resumeThread(cleanThreadId, {
    cwd: cwdForCodexContact(contact, codexOptions, knownThreads.get(cleanThreadId)?.cwd),
    developerInstructions: localizedInstructions(contact),
    codexOptions,
    excludeTurns: true
  });
  if (thread) knownThreads.set(cleanThreadId, thread);
  return thread;
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

function isAgentMessageItem(item) {
  const type = String(item?.type ?? "").toLowerCase();
  return ["agentmessage", "agent_message", "assistant", "assistant_message"].includes(type);
}

function isUserMessageItem(item) {
  const type = String(item?.type ?? "").toLowerCase();
  return ["usermessage", "user_message", "user"].includes(type);
}

function renderedMessageFromThreadItem(item, contact, completedAt = Date.now() / 1000) {
  const [renderedItem] = messagesFromTurns([{ items: [item], completedAt }], contact);
  return renderedItem ?? null;
}

function deliverStartedThreadItemToChat(threadId, contactId, item, startedAt = Date.now() / 1000) {
  if (!threadId || !contactId || !item || !isCodexImageItem(item)) return false;
  const contact = contactFor(contactId);
  const renderedItem = renderedMessageFromThreadItem(item, contact, startedAt);
  if (!renderedItem) return false;
  sendToChat(contactId, "codex:item-started", {
    contactId,
    message: {
      ...renderedItem,
      pending: true
    }
  });
  noteTurnActivity(threadId);
  logDebug("codex.item.started.delivered", { threadId, contactId, itemId: item.id ?? "", type: item.type });
  return true;
}

function deliverThreadItemToChat(threadId, contactId, item, source = "item/completed", completedAt = Date.now() / 1000) {
  if (!threadId || !contactId || !item || isUserMessageItem(item)) return false;
  const itemId = item.id ?? "";
  if (itemId && threadItemWasDelivered(threadId, itemId)) return false;

  const text = textFromCompletedItem(item);
  if (text) {
    markThreadItemDelivered(threadId, itemId);
    registerIncomingMessage(contactId, text);
    sendToChat(contactId, "codex:completed-item", { contactId, text });
    noteVisibleTurnOutput(threadId);
    logDebug("codex.item.delivered", { source, threadId, itemId, type: item.type, channel: "codex:completed-item" });
    return true;
  }

  const contact = contactFor(contactId);
  const renderedItem = renderedMessageFromThreadItem(item, contact, completedAt);
  if (!renderedItem) return false;
  markThreadItemDelivered(threadId, itemId);
  registerIncomingMessage(contactId, renderedItem.text || renderedItem.command || renderedItem.itemType || "Element Codex");
  if (isAgentMessageItem(item)) {
    sendToChat(contactId, "codex:completed-item", { contactId, text: renderedItem.text });
  } else {
    sendToChat(contactId, "codex:item-completed", { contactId, message: renderedItem });
  }
  noteVisibleTurnOutput(threadId);
  logDebug("codex.item.delivered", { source, threadId, itemId, type: item.type, channel: isAgentMessageItem(item) ? "codex:completed-item" : "codex:item-completed" });
  return true;
}

function deliverTurnItemsToChat(threadId, contactId, turn, source = "turn/completed") {
  if (!threadId || !contactId || !turn?.items?.length) return 0;
  let deliveredCount = 0;
  const completedAt = turn.completedAt ?? turn.updatedAt ?? Date.now() / 1000;
  for (const item of turn.items) {
    storeThreadItem(threadId, item);
    if (deliverThreadItemToChat(threadId, contactId, item, source, completedAt)) deliveredCount += 1;
  }
  return deliveredCount;
}

function notifyNoVisibleTurnOutput(contactId, threadId, turnId) {
  const text = "Codex a termine le tour, mais app-server n'a renvoye aucun message affichable. Regarde le log codex-messenger.log pour ce thread.";
  logDebug("codex.turn.no-visible-output", { contactId, threadId, turnId, text });
  sendToChat(contactId, "codex:status-note", { contactId, text, kind: "warning" });
}

async function recoverCompletedTurnOutput(threadId, contactId, turnId, hadVisibleOutput) {
  try {
    const result = await codex.listThreadTurns(threadId, { limit: 5, sortDirection: "desc" });
    const turns = result?.data ?? [];
    const turn = turns.find((item) => item.id === turnId) ?? turns[0];
    const deliveredCount = deliverTurnItemsToChat(threadId, contactId, turn, "thread/turns/list");
    if (!deliveredCount && !hadVisibleOutput) notifyNoVisibleTurnOutput(contactId, threadId, turnId);
  } catch (error) {
    logDebug("codex.turn.recover-output.error", { contactId, threadId, turnId, error: error.message });
    if (!hadVisibleOutput) {
      sendToChat(contactId, "codex:status-note", {
        contactId,
        text: `Codex a termine sans message affichable et la relecture du tour a echoue: ${error.message}`,
        kind: "warning"
      });
    }
  }
}

codex.on("request", (message) => {
  if (
    message.method !== "execCommandApproval" &&
    message.method !== "applyPatchApproval" &&
    message.method !== "item/commandExecution/requestApproval" &&
    message.method !== "item/fileChange/requestApproval"
  ) {
    codex.respondError(message.id, `Unsupported Codex server request: ${message.method}`);
    return;
  }

  const record = createApprovalRecord(message);
  approvalRequests.set(record.approvalId, record);
  deliverApprovalRequest(record.payload);
});

codex.on("notification", (message) => {
  if (message.method === "thread/started") {
    const threadId = message.params?.thread?.id;
    if (threadId) {
      loadedThreads.add(threadId);
      logDebug("codex.thread.started", { threadId, status: message.params?.thread?.status });
    }
    return;
  }

  if (message.method === "turn/started") {
    if (message.params?.threadId && message.params?.turn?.id) {
      activeTurnByThread.set(message.params.threadId, message.params.turn.id);
      const contactId = contactByThread.get(message.params.threadId);
      if (contactId) trackActiveTurn(message.params.threadId, contactId, message.params.turn.id);
      logDebug("codex.turn.started", { threadId: message.params.threadId, turnId: message.params.turn.id });
    }
    return;
  }

  if (message.method === "item/agentMessage/delta") {
    const contactId = contactByThread.get(message.params.threadId);
    if (contactId) {
      noteTurnActivity(message.params.threadId);
      sendToChat(contactId, "codex:delta", { contactId, delta: message.params.delta });
    }
    return;
  }

  if (message.method === "item/started") {
    const threadId = message.params?.threadId;
    const item = message.params?.item;
    storeThreadItem(threadId, item);
    const contactId = contactByThread.get(threadId);
    if (contactId) deliverStartedThreadItemToChat(threadId, contactId, item);
    return;
  }

  if (message.method === "item/completed") {
    const threadId = message.params?.threadId;
    const item = message.params?.item;
    storeThreadItem(threadId, item);
    noteTurnActivity(threadId);
    const contactId = contactByThread.get(threadId);
    if (contactId) deliverThreadItemToChat(threadId, contactId, item, "item/completed");
    return;
  }

  if (message.method === "turn/completed") {
    const threadId = message.params?.threadId;
    const turnId = message.params?.turn?.id;
    const contactId = contactByThread.get(threadId);
    const activeMeta = activeTurnMetaByThread.get(threadId);
    const hadVisibleOutput = Boolean(activeMeta?.visibleOutputCount);
    const deliveredCount = contactId ? deliverTurnItemsToChat(threadId, contactId, message.params?.turn, "turn/completed") : 0;
    if (threadId) activeTurnByThread.delete(threadId);
    if (threadId) clearActiveTurn(threadId);
    logDebug("codex.turn.completed", {
      threadId,
      turnId,
      status: message.params?.turn?.status,
      error: message.params?.turn?.error,
      deliveredCount,
      hadVisibleOutput
    });
    if (contactId) {
      if (!deliveredCount && !hadVisibleOutput) {
        recoverCompletedTurnOutput(threadId, contactId, turnId, hadVisibleOutput);
      }
      sendToChat(contactId, "codex:done", { contactId });
      sendToMain("conversation:finished", { contactId });
    }
    return;
  }

  if (message.method === "error") {
    const text = message.params?.message ?? "Erreur Codex";
    for (const threadId of activeTurnByThread.keys()) clearActiveTurn(threadId);
    activeTurnByThread.clear();
    for (const contact of contactsForSettings()) sendToChat(contact.id, "codex:error", { contactId: contact.id, text });
    return;
  }

  if (message.method?.startsWith("codex/event/")) {
    const event = message.params?.msg;
    const contactId = contactByThread.get(message.params?.conversationId);
    if (!event || !contactId) return;
    if (event.type === "agent_message_delta") {
      noteTurnActivity(message.params?.conversationId);
      sendToChat(contactId, "codex:delta", { contactId, delta: event.delta });
    } else if (event.type === "agent_message" && event.message) {
      noteTurnActivity(message.params?.conversationId);
      registerIncomingMessage(contactId, event.message);
      sendToChat(contactId, "codex:completed-item", { contactId, text: event.message });
    } else if (event.type === "task_complete") {
      if (message.params?.conversationId) activeTurnByThread.delete(message.params.conversationId);
      if (message.params?.conversationId) clearActiveTurn(message.params.conversationId);
      if (event.last_agent_message) {
        registerIncomingMessage(contactId, event.last_agent_message);
        sendToChat(contactId, "codex:completed-item", { contactId, text: event.last_agent_message });
      }
      sendToChat(contactId, "codex:done", { contactId });
      sendToMain("conversation:finished", { contactId });
    } else if (event.type === "stream_error" || event.type === "error") {
      if (message.params?.conversationId) clearActiveTurn(message.params.conversationId);
      sendToChat(contactId, "codex:error", { contactId, text: event.message ?? "Erreur Codex" });
    }
  }
});

codex.on("status", (status) => {
  if (status.kind === "exit" || status.kind === "error") clearApprovalRequests(status.text);
  if (status.kind === "stderr") logCodexRuntimeDiagnostics(status.text);
  sendToMain("codex:status", status);
  sendToOpenChats("codex:status", status);
});

ipcMain.handle("app:bootstrap", async (_event, params = {}) => {
  try {
    params = assertObject(params, "bootstrap params");
    const settings = await loadSettings();
    let startupCodexStatus = await codexStatus();
    let startupUserAgent = codex.userAgent;
    if (!startupUserAgent && shouldAutoSignIn(settings, startupCodexStatus)) {
      startupUserAgent = startupCodexStatus.login?.text || "Codex local connecte";
      setTimeout(() => scheduleCodexWarmup("startup"), 250);
    }

    const contactId = String(params.contactId ?? "");
    let contact = contactFor(contactId);
    let bootstrapConversations = null;
    let historyMessages = [];
    let historyCursor = null;
    let historyHasMore = false;
    if (params.view === "chat") {
      let attemptedThreadResume = false;
      try {
        const directThreadId = threadIdFromContactId(contactId);
        let threadId = directThreadId || (contact.kind === "project" ? null : threadByContact.get(contactId) || null);
        if (!threadId && contact.kind === "project") {
          bootstrapConversations = await conversationBrowser({ startCodex: true, cwd: contact.cwd });
          const project = bootstrapConversations.projects.find((item) => item.cwd === contact.cwd);
          const latestThread = newestThreadForProject(project);
          if (latestThread?.id) threadId = latestThread.id;
        }

        if (threadId) {
          attemptedThreadResume = true;
          const codexOptions = codexOptionsForContact(contactId, settings);
          const thread = isDemoSeedThreadId(threadId) ? demoSeedThreadById(threadId) : null;
          if (threadIdFromContactId(contactId)) {
            contact = contactFromThread(threadId);
          } else {
            contact = { ...contact, threadId };
          }
          if (!isDemoSeedThreadId(threadId)) {
            threadByContact.set(contact.id, threadId);
            contactByThread.set(threadId, contact.id);
          }
          const historyPage = thread
            ? threadHistoryPageFromThread(thread, contact)
            : await threadHistoryPageFromServer(threadId, contact, { limit: codexHistoryPageSize });
          if (historyPage?.messages?.length || historyPage?.historyHasMore) {
            historyMessages = historyPage.messages;
            historyCursor = historyPage.historyCursor;
            historyHasMore = historyPage.historyHasMore;
          } else {
            codex.resumeThread(threadId, {
              cwd: cwdForCodexContact(contact, codexOptions, knownThreads.get(threadId)?.cwd),
              developerInstructions: localizedInstructions(contact),
              codexOptions,
              excludeTurns: true
            }).then((resumedThread) => {
              if (resumedThread) knownThreads.set(threadId, resumedThread);
            }).catch(() => {});
          }
        }
      } catch (error) {
        logDebug("app.bootstrap.history.error", {
          contactId,
          attemptedThreadResume,
          error: error.message,
          stack: error.stack
        });
        historyMessages = attemptedThreadResume
          ? [{ id: "resume-error", from: "system", author: "system", text: error.message, time: "--:--" }]
          : [];
        historyCursor = null;
        historyHasMore = false;
      }
    }

    return {
      view: params.view,
      contactId,
      contacts: contactsForSettings(settings),
      contact,
      profile,
      cwd: defaultCwd(),
      appVersion: app.getVersion(),
      settings,
      unread: unreadState(),
      codexStatus: startupCodexStatus,
      userAgent: startupUserAgent,
      conversations: bootstrapConversations,
      historyMessages,
      historyCursor,
      historyHasMore,
      logPath: logFilePath(),
      approvalRequests: params.view === "chat" ? approvalPayloadsForContact(contactId) : []
    };
  } catch (error) {
    logDebug("app.bootstrap.error", {
      view: params?.view,
      contactId: params?.contactId,
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
});

registerUpdateIpcHandlers({
  ipcMain,
  updates,
  assertEnum,
  openExternalUrl,
  frontReleasesUrl,
  codexNpmUrl,
  restartApp: () => {
    logDebug("update.restart.requested", { target: "codex" });
    app.relaunch();
    quitApplication();
  }
});

ipcMain.handle("auth:sign-in", async (_event, nextProfile) => {
  const status = await codexStatus(nextProfile.codexPath);
  if (!status.ok) {
    throw new Error(status.error || "Codex CLI introuvable.");
  }
  if (status.login && !status.login.ok) {
    throw new Error("Connexion OpenAI requise. Lancez le login Codex/OpenAI puis reconnectez Codex Messenger.");
  }
  const settings = await saveSettings({
    language: nextProfile.language,
    codexPath: nextProfile.codexPath,
    unreadWizzDelayMs: nextProfile.unreadWizzDelayMs,
    signedIn: true,
    autoSignIn: normalizeBoolean(nextProfile.autoSignIn, true),
    profile: nextProfile
  });
  Object.assign(profile, settings.profile);
  setTimeout(() => scheduleCodexWarmup("sign-in"), 250);
  return {
    ok: true,
    userAgent: status.login?.text || "Codex local connecte",
    profile,
    settings,
    codexStatus: await codexStatus()
  };
});

ipcMain.handle("settings:get", async () => ({
  settings: await loadSettings(),
  codexStatus: await codexStatus()
}));

ipcMain.handle("settings:set", async (_event, nextSettings = {}) => ({
  settings: await saveSettings(nextSettings),
  codexStatus: await codexStatus(nextSettings.codexPath)
}));

ipcMain.handle("models:list", async () => {
  try {
    return {
      ok: true,
      models: await codex.listModels()
    };
  } catch (error) {
    logDebug("codex.models.list.error", { error: error.message });
    return {
      ok: false,
      models: [],
      error: error.message
    };
  }
});

ipcMain.handle("contacts:create-agent", async (_event, draft = {}) => {
  const current = await loadSettings();
  const cwd = String(draft?.cwd || "").trim();
  if (!cwd) return { ok: false, error: "Choisis le dossier de run avant de creer le contact." };
  try {
    const stat = await fs.stat(cwd);
    if (!stat.isDirectory()) return { ok: false, error: "Le dossier de run selectionne n'est pas un dossier." };
  } catch {
    return { ok: false, error: "Le dossier de run selectionne est introuvable." };
  }
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

ipcMain.handle("contacts:rename", async (_event, payload = {}) => {
  const contactId = String(payload.contactId || "").trim();
  if (!contactId) return { ok: false, error: "Contact invalide" };
  const name = String(payload.name || "").trim().slice(0, 80);
  const current = await loadSettings();
  const contactAliases = normalizeContactAliases(current.contactAliases);
  if (name) contactAliases[contactId] = name;
  else delete contactAliases[contactId];
  const threadId = threadIdFromContactId(contactId);
  if (threadId && name && codexServerIsActive()) {
    try {
      await codex.setThreadName(threadId, name);
    } catch {
      // Local alias still keeps the UI responsive if the stored thread is unavailable.
    }
  }
  const settings = await saveSettings({ contactAliases });
  return {
    ok: true,
    contacts: contactsForSettings(settings),
    conversations: await conversationBrowser(),
    settings
  };
});

ipcMain.handle("contacts:set-status", async (_event, payload = {}) => {
  const contactId = String(payload.contactId || "").trim();
  const status = String(payload.status || "").trim();
  if (!contactId) return { ok: false, error: "Contact invalide" };
  if (!["online", "busy", "away", "offline"].includes(status)) return { ok: false, error: "Statut invalide" };
  const current = await loadSettings();
  const contactStatuses = normalizeContactStatuses(current.contactStatuses);
  contactStatuses[contactId] = status;
  const settings = await saveSettings({ contactStatuses });
  return {
    ok: true,
    contacts: contactsForSettings(settings),
    conversations: await conversationBrowser(),
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
  const version = await codexVersionRequirement(resolved.command);
  const login = version.versionSupported
    ? await codexLoginStatus(resolved.command)
    : { ok: false, text: "Codex CLI update required" };
  return {
    ok: version.versionSupported,
    ...resolved,
    version: version.version,
    minimumCodexVersion: version.minimumCodexVersion,
    versionSupported: version.versionSupported,
    npm: await findNpmCommand(),
    login,
    ready: version.versionSupported && login.ok,
    error: version.versionSupported ? "" : unsupportedCodexVersionMessage(version.version, version.minimumCodexVersion)
  };
});

ipcMain.handle("setup:install-codex", async () => {
  await installCodexCli({ cwd: defaultCwd() });
  return { ok: true, codexStatus: await codexStatus() };
});

ipcMain.handle("setup:login-codex", async (_event, candidatePath = null) => {
  const resolved = await resolveSupportedCodexCommand(candidatePath);
  await openCodexLoginTerminal(resolved.command);
  return { ok: true, command: resolved.command, codexStatus: await codexStatus(candidatePath) };
});

ipcMain.handle("setup:open-node-download", () => {
  return openExternalUrl(nodeDownloadUrl);
});

ipcMain.handle("profile:choose-picture", async (event, options = {}) => {
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
  if (options?.save === false) {
    return {
      canceled: false,
      path: targetPath,
      profile: {
        ...profile,
        displayPicturePath: targetPath,
        displayPictureAsset: ""
      }
    };
  }
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

ipcMain.handle("conversation:open-thread", async (_event, threadId) => {
  const cleanThreadId = String(threadId || "").trim();
  if (!cleanThreadId) return { ok: false, error: "Fil invalide" };
  await revealThreadInTabs(cleanThreadId);
  createChatWindow(`thread:${cleanThreadId}`);
  return { ok: true, conversations: await conversationBrowser() };
});

ipcMain.handle("conversation:open-project", async (_event, cwd) => {
  const settings = await loadSettings();
  const targetCwd = demoModeIsEnabled(settings) && !isDemoProjectPath(cwd) ? await ensureDemoProject() : cwd;
  createChatWindow(encodeProjectId(targetCwd));
  return { ok: true };
});

ipcMain.handle("conversation:switch-thread", (event, threadId) => {
  return switchChatWindow(event, `thread:${threadId}`);
});

ipcMain.handle("conversation:load-thread", async (event, { contactId, threadId } = {}) => {
  const cleanThreadId = String(threadId || "").trim();
  const cleanContactId = String(contactId || "").trim();
  if (!cleanThreadId || !cleanContactId) return { ok: false, error: "Fil invalide" };
  const settings = await revealThreadInTabs(cleanThreadId);
  const contact = contactFor(cleanContactId);
  const codexOptions = codexOptionsForContact(cleanContactId, settings);
  const thread = isDemoSeedThreadId(cleanThreadId)
    ? demoSeedThreadById(cleanThreadId)
    : null;
  if (thread) knownThreads.set(cleanThreadId, thread);
  const hydratedContact = contact.kind === "project" ? { ...contact, threadId: cleanThreadId } : contactFromThread(cleanThreadId);
  const targetContactId = hydratedContact.id;
  if (!isDemoSeedThreadId(cleanThreadId)) {
    threadByContact.set(targetContactId, cleanThreadId);
    contactByThread.set(cleanThreadId, targetContactId);
  }
  let historyPage = thread
    ? threadHistoryPageFromThread(thread, hydratedContact)
    : await threadHistoryPageFromServer(cleanThreadId, hydratedContact, { limit: codexHistoryPageSize });
  if (!thread && !isDemoSeedThreadId(cleanThreadId)) {
    await ensureLoadedThread(targetContactId, cleanThreadId, contact, codexOptions);
  }
  retargetChatWindow(event, targetContactId);
  return {
    ok: true,
    threadId: cleanThreadId,
    contactId: targetContactId,
    contact: hydratedContact,
    messages: historyPage.messages,
    historyCursor: historyPage.historyCursor,
    historyHasMore: historyPage.historyHasMore,
    conversations: await conversationBrowser()
  };
});

ipcMain.handle("conversation:load-previous-messages", async (_event, { contactId, threadId, cursor, limit } = {}) => {
  const cleanThreadId = String(threadId || "").trim();
  const cleanContactId = String(contactId || "").trim();
  if (!cleanThreadId || !cleanContactId) return { ok: false, error: "Fil invalide" };
  const contact = contactFor(cleanContactId);
  const hydratedContact = contact.threadId === cleanThreadId || contact.kind !== "project"
    ? contact
    : { ...contact, threadId: cleanThreadId };
  const historyPage = isDemoSeedThreadId(cleanThreadId)
    ? threadHistoryPageFromThread(demoSeedThreadById(cleanThreadId), hydratedContact, { cursor, limit })
    : await threadHistoryPageFromServer(cleanThreadId, hydratedContact, { cursor, limit });
  if (!historyPage) return { ok: true, messages: [], historyCursor: null, historyHasMore: false };
  return { ok: true, ...historyPage };
});

ipcMain.handle("conversation:switch-project", async (event, cwd) => {
  const settings = await loadSettings();
  const targetCwd = demoModeIsEnabled(settings) && !isDemoProjectPath(cwd) ? await ensureDemoProject() : cwd;
  return switchChatWindow(event, encodeProjectId(targetCwd));
});

ipcMain.handle("conversation:open-project-picker", async (event) => {
  const settings = await loadSettings();
  if (demoModeIsEnabled(settings)) {
    const cwd = await ensureDemoProject();
    createChatWindow(encodeProjectId(cwd));
    return { canceled: false, cwd };
  }
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

ipcMain.handle("app:choose-directory", async (event, options = {}) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win, {
    title: String(options.title || "Choisir un dossier"),
    defaultPath: String(options.defaultPath || projectsRoot()),
    properties: ["openDirectory"]
  });
  if (result.canceled || !result.filePaths?.[0]) return { canceled: true };
  return { canceled: false, cwd: result.filePaths[0] };
});

ipcMain.handle("conversation:list", async (_event, options = {}) => conversationBrowser({
  startCodex: true,
  cursor: options?.cursor ?? null,
  limit: options?.limit ?? threadListPageSize,
  cwd: options?.cwd ?? null,
  searchTerm: options?.searchTerm ?? null
}));

ipcMain.handle("approval:respond", async (_event, { approvalId, decision } = {}) => {
  const cleanId = String(approvalId ?? "");
  if (!cleanId) return { ok: false, error: "Demande d'autorisation invalide." };
  try {
    return resolveApprovalRequest(cleanId, decision);
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

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

ipcMain.handle("conversation:send", async (_event, payload = {}) => {
  const { contactId, text } = assertObject(payload, "send payload");
  const cleanContactId = assertString(contactId, "contactId", { maxLength: 500 }).trim();
  const clean = assertString(text, "text", { maxLength: 200_000 }).trim();
  if (!clean) return { ok: false };
  return sendConversationItems(cleanContactId, [{ type: "text", text: clean }]);
});

ipcMain.handle("conversation:send-items", async (_event, payload = {}) => {
  const { contactId, items } = assertObject(payload, "send-items payload");
  return sendConversationItems(assertString(contactId, "contactId", { maxLength: 500 }).trim(), Array.isArray(items) ? items : []);
});

function resolvedThreadIdForContact(contactId, threadId = "") {
  return String(threadId || "").trim()
    || threadIdFromContactId(contactId)
    || threadByContact.get(contactId)
    || "";
}

ipcMain.handle("conversation:interrupt-turn", async (_event, { contactId, threadId } = {}) => {
  const cleanContactId = String(contactId || "").trim();
  const cleanThreadId = resolvedThreadIdForContact(cleanContactId, threadId);
  const turnId = activeTurnByThread.get(cleanThreadId);
  if (!cleanThreadId || !turnId) return { ok: false, error: "Aucun tour Codex en cours." };
  try {
    await codex.interruptTurn(cleanThreadId, turnId);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("conversation:compact", async (_event, { contactId, threadId } = {}) => {
  const cleanContactId = String(contactId || "").trim();
  try {
    const cleanThreadId = resolvedThreadIdForContact(cleanContactId, threadId) || await ensureThread(cleanContactId);
    await codex.compactThread(cleanThreadId);
    return { ok: true, threadId: cleanThreadId };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("conversation:review", async (_event, { contactId, threadId } = {}) => {
  const cleanContactId = String(contactId || "").trim();
  try {
    const cleanThreadId = resolvedThreadIdForContact(cleanContactId, threadId) || await ensureThread(cleanContactId);
    const result = await codex.reviewThread(cleanThreadId);
    if (result?.turn?.id) activeTurnByThread.set(cleanThreadId, result.turn.id);
    return { ok: true, threadId: cleanThreadId };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("conversation:fork", async (_event, { contactId, threadId } = {}) => {
  const cleanContactId = String(contactId || "").trim();
  const cleanThreadId = resolvedThreadIdForContact(cleanContactId, threadId);
  if (!cleanThreadId) return { ok: false, error: "Aucun fil a dupliquer." };
  try {
    const settings = await loadSettings();
    const contact = contactFor(cleanContactId);
    const codexOptions = codexOptionsForContact(cleanContactId, settings);
    const thread = await codex.forkThread(cleanThreadId, contact, codexOptions);
    if (thread) knownThreads.set(thread.id, thread);
    const targetContact = thread ? contactFromThread(thread.id) : null;
    if (targetContact?.id && thread?.id) {
      threadByContact.set(targetContact.id, thread.id);
      contactByThread.set(thread.id, targetContact.id);
    }
    return { ok: true, threadId: thread?.id, contact: targetContact, conversations: await conversationBrowser() };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

async function sendConversationItems(contactId, items) {
  const cleanContactId = String(contactId || "").trim();
  const cleanItems = items.filter((item) => {
    if (item?.type === "text") return String(item.text ?? "").trim();
    if (item?.type === "localImage") return String(item.path ?? "").trim();
    return false;
  });
  if (!cleanItems.length) return { ok: false };
  try {
    clearUnread(cleanContactId);
    sendToChat(cleanContactId, "codex:typing", { contactId: cleanContactId });
    const settings = await loadSettings();
    const codexOptions = codexOptionsForContact(cleanContactId, settings);
    const threadId = await ensureThread(cleanContactId);
    logDebug("conversation.send", {
      contactId: cleanContactId,
      threadId,
      itemTypes: cleanItems.map((item) => item.type),
      textPreview: cleanItems.find((item) => item.type === "text")?.text ?? ""
    });
    const activeTurnId = activeTurnByThread.get(threadId);
    if (activeTurnId) {
      noteTurnActivity(threadId);
      await codex.steerTurn(threadId, activeTurnId, cleanItems);
      return { ok: true, threadId, steered: true, conversations: await conversationBrowser() };
    }
    const result = await codex.startTurn(threadId, cleanItems, codexOptions);
    if (result?.turn?.id) {
      activeTurnByThread.set(threadId, result.turn.id);
      trackActiveTurn(threadId, cleanContactId, result.turn.id);
    }
    return { ok: true, threadId, conversations: await conversationBrowser() };
  } catch (error) {
    logDebug("conversation.send.error", { contactId: cleanContactId, error: error.message });
    sendToChat(cleanContactId, "codex:error", { contactId: cleanContactId, text: error.message });
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

ipcMain.handle("app:log", (_event, payload = {}) => {
  const event = String(payload?.event || "log")
    .replace(/[^a-zA-Z0-9:._-]+/g, ".")
    .slice(0, 100) || "log";
  logDebug(`renderer.${event}`, payload?.details ?? {});
  return { ok: true, logPath: logFilePath() };
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
  clearUnread(contactId);
  return { ok: true };
});

ipcMain.handle("conversation:wizz", (_event, contactId) => {
  wizz(windows.get(`chat:${contactId}`));
  return { ok: true };
});

registerWindowIpcHandlers({ ipcMain, BrowserWindow });

app.whenReady().then(async () => {
  const debugLogPath = await ensureDebugLogFile();
  logDebug("app.start", {
    version: app.getVersion(),
    packaged: app.isPackaged,
    dev: isDev,
    logPath: debugLogPath
  });
  if (process.platform === "darwin" && app.dock) {
    const dockIcon = nativeImage.createFromPath(appIconPath);
    if (!dockIcon.isEmpty()) app.dock.setIcon(dockIcon);
  }
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
