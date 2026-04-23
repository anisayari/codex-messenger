import { app, BrowserWindow, dialog, ipcMain, Menu, screen, shell, Tray } from "electron";
import { execFile, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveExecutableCandidate } from "../shared/codexExecutable.js";
import { defaultCodexOptions, normalizeCodexOptions, sandboxPolicyForMode } from "../shared/codexOptions.js";
import { codexLoginStatus, findNpmCommand, installCodexCli, nodeDownloadUrl } from "../shared/codexSetup.js";
import { codexLanguageInstruction, normalizeLanguage } from "../shared/languages.js";

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
const toastIconPath = path.join(rootDir, "public", "icons", "codex-messenger-people-256.png");
const repositoryUrl = "https://github.com/anisayari/codex-messenger";
const frontPackageUrl = "https://raw.githubusercontent.com/anisayari/codex-messenger/main/package.json";
const frontReleasesUrl = `${repositoryUrl}/releases`;
const codexNpmPackageName = "@openai/codex";
const codexNpmRegistryUrl = "https://registry.npmjs.org/@openai%2Fcodex/latest";
const codexNpmUrl = "https://www.npmjs.com/package/@openai/codex";
const updateCheckCacheMs = 10 * 60_000;

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
const toastWindows = [];
const knownThreads = new Map();
const threadItemsByThread = new Map();
const approvalRequests = new Map();
let tray = null;
let isQuitting = false;
let updateCheckCache = null;
let updateCheckPromise = null;
let nextApprovalRequestId = 1;
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
  contactAliases: {},
  threadTabs: defaultThreadTabs,
  projectSort: defaultProjectSort,
  textStyles: {},
  codexOptionsByContact: {},
  unreadWizzDelayMs: defaultUnreadWizzDelayMs,
  notificationsEnabled: true,
  newMessageSoundEnabled: true,
  unreadWizzEnabled: true,
  demoMode: false,
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

function demoProjectCwd() {
  return path.join(app.getPath("userData"), demoProjectFolderName);
}

function settingsFilePath() {
  return path.join(app.getPath("userData"), "settings.json");
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

function normalizeBoolean(value, fallback = true) {
  if (value === true || value === "true" || value === 1 || value === "1") return true;
  if (value === false || value === "false" || value === 0 || value === "0") return false;
  return fallback;
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

function contactAliasFor(contactId, settings = settingsCache) {
  return normalizeContactAliases(settings?.contactAliases)[String(contactId ?? "").trim()] ?? "";
}

function applyContactAlias(contact, settings = settingsCache) {
  if (!contact?.id) return contact;
  const alias = contactAliasFor(contact.id, settings);
  return alias ? { ...contact, name: alias } : contact;
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
  return source.map((contact) => applyContactAlias(contact, settings));
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
  settingsCache.contactAliases = normalizeContactAliases(settingsCache.contactAliases);
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
    threadTabs: normalizeThreadTabs(nextSettings.threadTabs ?? current.threadTabs),
    projectSort: normalizeProjectSort(nextSettings.projectSort ?? current.projectSort),
    textStyles: normalizeTextStyles(nextSettings.textStyles ?? current.textStyles),
    codexOptionsByContact: normalizeCodexOptionsByContact(nextSettings.codexOptionsByContact ?? current.codexOptionsByContact),
    unreadWizzDelayMs: normalizeUnreadWizzDelayMs(nextSettings.unreadWizzDelayMs ?? current.unreadWizzDelayMs),
    notificationsEnabled: normalizeBoolean(nextSettings.notificationsEnabled ?? current.notificationsEnabled, true),
    newMessageSoundEnabled: normalizeBoolean(nextSettings.newMessageSoundEnabled ?? current.newMessageSoundEnabled, true),
    unreadWizzEnabled: normalizeBoolean(nextSettings.unreadWizzEnabled ?? current.unreadWizzEnabled, true),
    demoMode: normalizeBoolean(nextSettings.demoMode ?? current.demoMode, false),
    closeBehavior: normalizeCloseBehavior(nextSettings.closeBehavior ?? current.closeBehavior)
  };
  await fs.mkdir(path.dirname(settingsFilePath()), { recursive: true });
  await fs.writeFile(settingsFilePath(), JSON.stringify(settingsCache, null, 2), "utf8");
  Object.assign(profile, settingsCache.profile);
  if (!settingsCache.unreadWizzEnabled) {
    for (const contactId of unreadReminderByContact.keys()) clearUnreadReminder(contactId);
  }
  if (!settingsCache.notificationsEnabled) {
    for (const win of [...toastWindows]) {
      if (!win.isDestroyed()) win.close();
    }
  }
  if (settingsCache.demoMode !== previousDemoMode) {
    setTimeout(closeChatWindowsForModeSwitch, 80);
  }
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
    return firstExistingCodexFallback();
  }
}

async function firstExistingCodexFallback() {
  const npm = await findNpmCommand();
  const npmBinDir = npm.ok && npm.command ? path.dirname(npm.command) : "";
  const candidates = process.platform === "win32"
    ? [
      process.env.APPDATA ? path.join(process.env.APPDATA, "npm", "codex.cmd") : "",
      process.env.APPDATA ? path.join(process.env.APPDATA, "npm", "codex.exe") : "",
      npmBinDir ? path.join(npmBinDir, "codex.cmd") : "",
      npmBinDir ? path.join(npmBinDir, "codex.exe") : "",
      npmBinDir ? path.join(npmBinDir, "codex") : ""
    ]
    : [
      "/Applications/Codex.app/Contents/Resources/codex",
      "/opt/homebrew/bin/codex",
      "/usr/local/bin/codex",
      path.join(os.homedir(), ".nvm", "current", "bin", "codex"),
      npmBinDir ? path.join(npmBinDir, "codex") : ""
    ];
  for (const candidate of candidates) {
    if (await fileExists(candidate)) return candidate;
  }
  return "";
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

  throw new Error("Codex CLI introuvable. Installez Codex puis relancez l'app, ou indiquez le chemin vers le binaire codex dans l'ecran de connexion.");
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

function fetchJson(url, timeoutMs = 6500) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": `Codex-Messenger/${app.getVersion()}`
      },
      timeout: timeoutMs
    }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        fetchJson(new URL(response.headers.location, url).toString(), timeoutMs).then(resolve, reject);
        return;
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }
      let raw = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { raw += chunk; });
      response.on("end", () => {
        try {
          resolve(JSON.parse(raw));
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on("timeout", () => {
      request.destroy(new Error("Update check timeout"));
    });
    request.on("error", reject);
  });
}

function parseVersion(value) {
  const match = String(value ?? "").match(/v?(\d+)\.(\d+)\.(\d+)(?:\.(\d+)|-(\d+))?(?:[-+][0-9A-Za-z.-]+)?/);
  if (!match) return null;
  const revision = Number(match[4] ?? match[5] ?? 0);
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    revision,
    raw: revision > 0 ? `${match[1]}.${match[2]}.${match[3]}.${revision}` : `${match[1]}.${match[2]}.${match[3]}`
  };
}

function displayVersion(value) {
  return parseVersion(value)?.raw || String(value ?? "").trim();
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return 0;
  for (const key of ["major", "minor", "patch", "revision"]) {
    if (a[key] > b[key]) return 1;
    if (a[key] < b[key]) return -1;
  }
  return 0;
}

function updateAvailable(latestVersion, currentVersion) {
  return compareVersions(latestVersion, currentVersion) > 0;
}

function updateCheckError(error) {
  return String(error?.message || error || "Update check failed");
}

function formatCommandForDisplay(command, args = []) {
  return [command, ...args].join(" ");
}

function compactUpdateOutput(stdout = "", stderr = "") {
  const combined = [stdout, stderr].filter(Boolean).join("\n").trim();
  if (!combined) return "";
  return combined.length > 4000 ? `${combined.slice(-4000)}` : combined;
}

function spawnableUpdateCommand(command, args = []) {
  if (process.platform === "win32" && [".cmd", ".bat"].includes(path.extname(command).toLowerCase())) {
    return {
      command: "cmd.exe",
      args: ["/d", "/s", "/c", command, ...args]
    };
  }
  return { command, args };
}

function runUpdateCommand(command, args = [], { timeoutMs = 5 * 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    const spawnable = spawnableUpdateCommand(command, args);
    const child = spawn(spawnable.command, spawnable.args, {
      cwd: defaultCwd(),
      env: process.env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`${formatCommandForDisplay(command, args)} timed out`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const output = compactUpdateOutput(stdout, stderr);
      reject(new Error(output || `${formatCommandForDisplay(command, args)} exited with ${code}`));
    });
  });
}

async function installCodexUpdate() {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const args = ["install", "-g", `${codexNpmPackageName}@latest`];
  const command = formatCommandForDisplay("npm", args);
  const before = await checkCodexUpdate();
  const output = await runUpdateCommand(npmCommand, args);
  updateCheckCache = null;
  const after = await checkCodexUpdate();
  const currentLabel = versionLabelForResult(after.currentVersion || after.latestVersion);
  const message = after.error
    ? `Codex app-server update command finished, but verification failed: ${after.error}`
    : after.updateAvailable
      ? `Codex app-server update command finished, but detected version is still ${currentLabel}.`
      : `Codex app-server is up to date (${currentLabel}).`;
  return {
    ok: true,
    target: "codex",
    command,
    before,
    after,
    message,
    output: compactUpdateOutput(output.stdout, output.stderr)
  };
}

function versionLabelForResult(value) {
  return displayVersion(value) || "unknown";
}

async function checkFrontUpdate() {
  const currentVersion = app.getVersion();
  const result = {
    id: "front",
    name: "Codex Messenger",
    currentVersion,
    latestVersion: "",
    updateAvailable: false,
    source: "github",
    url: frontReleasesUrl,
    error: ""
  };

  try {
    const remotePackage = await fetchJson(frontPackageUrl);
    result.latestVersion = displayVersion(remotePackage.version);
    result.updateAvailable = updateAvailable(result.latestVersion, currentVersion);
  } catch (error) {
    result.error = updateCheckError(error);
  }
  return result;
}

async function checkCodexUpdate() {
  const result = {
    id: "codex",
    name: "Codex app-server",
    packageName: codexNpmPackageName,
    command: "",
    currentVersion: "",
    latestVersion: "",
    updateAvailable: false,
    source: "npm",
    url: codexNpmUrl,
    installHint: `npm install -g ${codexNpmPackageName}`,
    error: ""
  };

  try {
    const status = await codexStatus();
    result.command = status.command || "";
    if (!status.ok) {
      result.error = status.error || "Codex CLI not detected";
    } else {
      const current = await runCodexCommand(status.command, ["--version"]);
      result.currentVersion = displayVersion(current.stdout || current.stderr);
    }
  } catch (error) {
    result.error = updateCheckError(error);
  }

  try {
    const latestPackage = await fetchJson(codexNpmRegistryUrl);
    result.latestVersion = displayVersion(latestPackage.version);
  } catch (error) {
    result.error = result.error
      ? `${result.error}; latest version unavailable: ${updateCheckError(error)}`
      : updateCheckError(error);
  }

  result.updateAvailable = Boolean(result.currentVersion && result.latestVersion)
    && updateAvailable(result.latestVersion, result.currentVersion);
  return result;
}

async function checkUpdates({ force = false } = {}) {
  const now = Date.now();
  if (!force && updateCheckCache && now - updateCheckCache.checkedAtMs < updateCheckCacheMs) {
    return updateCheckCache.payload;
  }
  if (!force && updateCheckPromise) return updateCheckPromise;

  updateCheckPromise = Promise.all([checkFrontUpdate(), checkCodexUpdate()])
    .then(([front, codex]) => {
      const payload = {
        checkedAt: new Date().toISOString(),
        front,
        codex
      };
      updateCheckCache = { checkedAtMs: Date.now(), payload };
      return payload;
    })
    .finally(() => {
      updateCheckPromise = null;
    });
  return updateCheckPromise;
}

async function codexStatus(candidatePath = null) {
  const settings = await loadSettings();
  const npm = await findNpmCommand();
  try {
    const resolved = await resolveCodexCommand(candidatePath);
    const login = await codexLoginStatus(resolved.command);
    return { ok: true, ...resolved, configured: Boolean(settings.codexPath), npm, login, ready: login.ok };
  } catch (error) {
    return {
      ok: false,
      command: "",
      source: "missing",
      configured: Boolean(settings.codexPath),
      npm,
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
    if (message.id !== undefined && message.method) {
      this.emit("request", message);
      return;
    }

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

  respond(id, result) {
    if (!this.child) throw new Error("codex app-server is not running");
    this.child.stdin.write(`${JSON.stringify({ id, result })}\n`);
  }

  respondError(id, message, code = -32000) {
    if (!this.child) return;
    this.child.stdin.write(`${JSON.stringify({ id, error: { code, message } })}\n`);
  }

  async startThread(contact, cwd = defaultCwd(), options = defaultCodexOptions) {
    await this.ensureReady();
    const codexOptions = normalizeCodexOptions(options);
    const result = await this.request("thread/start", {
      model: codexOptions.model || null,
      modelProvider: null,
      cwd,
      approvalPolicy: codexOptions.approvalPolicy,
      sandbox: codexOptions.sandbox,
      config: null,
      baseInstructions: null,
      developerInstructions: localizedInstructions(contact)
    });
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
      sandbox: codexOptions.sandbox,
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

  async listModels() {
    await this.ensureReady();
    const data = [];
    let cursor = null;
    do {
      const result = await this.request("model/list", {
        cursor,
        limit: 100
      });
      data.push(...(result.data ?? []));
      cursor = result.nextCursor ?? null;
    } while (cursor);
    return data;
  }

  async startTurn(threadId, input, options = defaultCodexOptions) {
    await this.ensureReady();
    const items = typeof input === "string" ? [{ type: "text", text: input }] : input;
    const codexOptions = normalizeCodexOptions(options);
    return this.request("turn/start", {
      threadId,
      input: items,
      cwd: null,
      approvalPolicy: codexOptions.approvalPolicy,
      sandboxPolicy: sandboxPolicyForMode(codexOptions.sandbox),
      model: codexOptions.model || null,
      effort: codexOptions.reasoningEffort || null,
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
  if (isDemoProjectPath(cwd)) return demoProjectDisplayName;
  return path.basename(cwd) || cwd;
}

function contactFromProject(cwd) {
  const name = projectNameFor(cwd);
  const isDemo = isDemoProjectPath(cwd);
  return applyContactAlias({
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
  return applyContactAlias({
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

  const projectPaths = new Set(await listWorkspaceProjects(settings));
  for (const thread of threads) projectPaths.add(thread.cwd);

  const projects = await Promise.all(Array.from(projectPaths).map(async (cwd) => {
    const projectContactId = encodeProjectId(cwd);
    const projectThreads = sortThreadsForCwd(
      threads.filter((thread) => thread.cwd === cwd),
      cwd,
      settings.threadTabs
    );
    return {
      id: projectContactId,
      cwd,
      name: contactAliasFor(projectContactId, settings) || projectNameFor(cwd),
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
    const threads = (await codex.listThreads()).map(normalizeThread).map((thread) => applyThreadAlias(thread, currentSettings)).filter((thread) => !hiddenIds.has(thread.id));
    if (demoModeIsEnabled(currentSettings)) {
      await ensureDemoProject();
      const realDemoThreads = threads.filter((thread) => isDemoProjectPath(thread.cwd));
      const seeded = demoSeedThreads().map((thread) => applyThreadAlias(thread, currentSettings)).filter((thread) => !hiddenIds.has(thread.id));
      return [...seeded, ...realDemoThreads];
    }
    return threads;
  } catch {
    if (demoModeIsEnabled(currentSettings)) {
      await ensureDemoProject();
      return demoSeedThreads().map((thread) => applyThreadAlias(thread, currentSettings)).filter((thread) => !hiddenIds.has(thread.id));
    }
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
    const hideLabel = process.platform === "darwin" ? "Masquer" : "Reduire";
    const hideDetail = process.platform === "darwin"
      ? "Tu peux masquer la fenetre principale et garder Codex Messenger ouvert dans le Dock, ou fermer seulement cette fenetre."
      : "Tu peux fermer seulement cette fenetre et garder les conversations ouvertes, ou reduire Codex Messenger dans la zone de notification.";
    const result = await dialog.showMessageBox(win, {
      type: "question",
      title: "Codex Messenger",
      message: "Fermer Codex Messenger ?",
      detail: hideDetail,
      buttons: [hideLabel, "Fermer la fenetre"],
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
  win.webContents.send(channel, payload);
}

function sendToOpenChats(channel, payload) {
  for (const [key, win] of windows) {
    if (!key.startsWith("chat:") || !win || win.isDestroyed()) continue;
    win.webContents.send(channel, payload);
  }
}

function sendToMain(channel, payload) {
  const win = windows.get("main");
  if (!win || win.isDestroyed()) return;
  win.webContents.send(channel, payload);
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
      decision: approve ? "accept" : "decline",
      acceptSettings: approve ? { forSession: approveForSession } : null
    };
  }
  if (record.protocol === "v2-file") {
    return { decision: approve ? "accept" : "decline" };
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

function publicAssetPath(assetPath) {
  const relativePath = String(assetPath || "").replace(/^\.\//, "");
  return path.join(rootDir, "public", relativePath);
}

function mimeTypeForFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".gif") return "image/gif";
  if (ext === ".webp") return "image/webp";
  if (ext === ".avif") return "image/avif";
  if (ext === ".ico") return "image/x-icon";
  if (ext === ".wav") return "audio/wav";
  if (ext === ".mp3") return "audio/mpeg";
  return "application/octet-stream";
}

function dataUrlForFile(filePath) {
  try {
    const data = readFileSync(filePath);
    return `data:${mimeTypeForFile(filePath)};base64,${data.toString("base64")}`;
  } catch {
    return "";
  }
}

function avatarPathForToast(contact) {
  if (contact?.displayPicturePath) return contact.displayPicturePath;
  if (contact?.displayPictureAsset && displayPictureAssetSet.has(contact.displayPictureAsset)) return publicAssetPath(contact.displayPictureAsset);
  const defaultPicture = displayPictureAssetByAvatar.get(contact?.avatar);
  if (defaultPicture) return publicAssetPath(defaultPicture);
  return toastIconPath;
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
  const avatar = escapeHtml(dataUrlForFile(avatarPathForToast(contact)) || dataUrlForFile(toastIconPath));
  const logo = escapeHtml(dataUrlForFile(toastIconPath));
  const sound = escapeHtml(dataUrlForFile(path.join(rootDir, "public", "msn-assets", "sounds", "type.wav")));
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
*{box-sizing:border-box}
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent;font-family:"Segoe UI",Tahoma,Arial,sans-serif;color:#3c3c3c}
.toast{position:absolute;inset:8px;display:grid;grid-template-rows:48px minmax(0,1fr) 31px;overflow:hidden;border:1px solid #61cce8;border-radius:18px;background:linear-gradient(135deg,#f7fcff 0%,#e6f7ff 53%,#ccecff 100%);box-shadow:0 9px 24px rgba(31,47,72,.38),inset 0 1px 0 rgba(255,255,255,.95)}
.head{position:relative;z-index:2;display:grid;grid-template-columns:31px minmax(0,1fr) 30px;align-items:center;gap:9px;padding:14px 18px 5px 20px;color:#515151;text-shadow:0 1px 0 white}
.head img{display:block;width:28px;height:28px;object-fit:contain}.head span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:23px}.close{display:grid;width:30px;height:30px;place-items:center;color:#717171;text-decoration:none;font-size:28px;line-height:1}.close:hover{color:#333}
.body{position:relative;z-index:2;display:grid;grid-template-columns:98px minmax(0,1fr);gap:16px;min-height:0;padding:2px 24px 0 28px;pointer-events:none}
.avatar{width:94px;height:94px;padding:6px;border:1px solid #9eb8c7;border-radius:16px;background:linear-gradient(#fff,#d7ecf9);box-shadow:0 7px 12px rgba(42,65,83,.28),inset 0 0 0 4px rgba(239,248,255,.95)}
.avatar img{display:block;width:100%;height:100%;border-radius:8px;object-fit:cover;background:#b8dcf5}.copy{min-width:0;padding-top:11px;line-height:1.14}.copy strong{display:block;overflow:hidden;margin-bottom:5px;color:#3a3a3a;font-size:23px;font-weight:700;text-overflow:ellipsis;white-space:nowrap}.copy span{display:-webkit-box;overflow:hidden;color:#414141;font-size:21px;line-height:1.18;overflow-wrap:anywhere;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.options{position:relative;z-index:3;justify-self:end;align-self:start;margin-right:26px;color:#0a73da;text-decoration:none;font-size:22px;line-height:26px}.options:hover{text-decoration:underline}.open{position:absolute;inset:49px 0 31px 0;z-index:1}
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
  const shouldPlaySound = newMessageSoundIsEnabled();
  const needsMainSound = shouldPlaySound && (!chatWin || chatWin.isDestroyed());
  const mainWin = windows.get("main");
  const mainCanPlaySound = mainWin && !mainWin.isDestroyed();
  if (notificationsAreEnabled()) {
    showMessengerToast(contactId, text, { playSound: needsMainSound && !mainCanPlaySound });
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
  if (threadByContact.has(contactId)) return threadByContact.get(contactId);
  const settings = await loadSettings();
  const contact = contactFor(contactId);
  const codexOptions = codexOptionsForContact(contactId, settings);

  const existingThreadId = threadIdFromContactId(contactId);
  if (existingThreadId && !isDemoSeedThreadId(existingThreadId)) {
    const thread = await codex.resumeThread(existingThreadId, {
      cwd: cwdForCodexContact(contact, codexOptions, knownThreads.get(existingThreadId)?.cwd),
      developerInstructions: localizedInstructions(contact),
      codexOptions
    });
    knownThreads.set(existingThreadId, thread);
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
  if (message.method === "item/agentMessage/delta") {
    const contactId = contactByThread.get(message.params.threadId);
    if (contactId) {
      sendToChat(contactId, "codex:delta", { contactId, delta: message.params.delta });
    }
    return;
  }

  if (message.method === "item/started") {
    storeThreadItem(message.params?.threadId, message.params?.item);
    return;
  }

  if (message.method === "item/completed") {
    storeThreadItem(message.params?.threadId, message.params?.item);
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
  if (status.kind === "exit" || status.kind === "error") clearApprovalRequests(status.text);
  sendToMain("codex:status", status);
  sendToOpenChats("codex:status", status);
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
        const codexOptions = codexOptionsForContact(contactId, settings);
        const thread = isDemoSeedThreadId(threadId)
          ? demoSeedThreadById(threadId)
          : await codex.resumeThread(threadId, {
            cwd: cwdForCodexContact(contact, codexOptions, knownThreads.get(threadId)?.cwd),
            developerInstructions: localizedInstructions(contact),
            codexOptions
          });
        if (thread) knownThreads.set(threadId, thread);
        if (threadIdFromContactId(contactId)) {
          contact = contactFromThread(threadId);
        } else {
          contact = { ...contact, threadId };
        }
        if (!isDemoSeedThreadId(threadId)) {
          threadByContact.set(contactId, threadId);
          contactByThread.set(threadId, contactId);
        }
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
    appVersion: app.getVersion(),
    settings,
    unread: unreadState(),
    codexStatus: await codexStatus(),
    userAgent: codex.userAgent,
    conversations: params.view === "chat" ? await conversationBrowser() : null,
    historyMessages,
    approvalRequests: params.view === "chat" ? approvalPayloadsForContact(contactId) : []
  };
});

ipcMain.handle("updates:check", async (_event, options = {}) => {
  return checkUpdates({ force: Boolean(options.force) });
});

ipcMain.handle("updates:open", (_event, target = "front") => {
  const url = target === "codex" ? codexNpmUrl : frontReleasesUrl;
  shell.openExternal(url);
  return { ok: true, url };
});

ipcMain.handle("updates:install", async (_event, target = "codex") => {
  if (target !== "codex") {
    shell.openExternal(frontReleasesUrl);
    return { ok: true, target: "front", url: frontReleasesUrl };
  }
  return installCodexUpdate();
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

ipcMain.handle("models:list", async () => ({
  ok: true,
  models: await codex.listModels()
}));

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
  const settings = await saveSettings({ contactAliases });
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
  const version = await runCodexCommand(resolved.command, ["--version"]);
  const login = await codexLoginStatus(resolved.command);
  return {
    ok: true,
    ...resolved,
    version: (version.stdout || version.stderr).trim(),
    npm: await findNpmCommand(),
    login,
    ready: login.ok
  };
});

ipcMain.handle("setup:install-codex", async () => {
  await installCodexCli({ cwd: defaultCwd() });
  return { ok: true, codexStatus: await codexStatus() };
});

ipcMain.handle("setup:login-codex", async (_event, candidatePath = null) => {
  const resolved = await resolveCodexCommand(candidatePath);
  await openCodexLoginTerminal(resolved.command);
  return { ok: true, command: resolved.command, codexStatus: await codexStatus(candidatePath) };
});

ipcMain.handle("setup:open-node-download", () => {
  shell.openExternal(nodeDownloadUrl);
  return { ok: true, url: nodeDownloadUrl };
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

ipcMain.handle("conversation:open-thread", (_event, threadId) => {
  createChatWindow(`thread:${threadId}`);
  return { ok: true };
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
  const settings = await loadSettings();
  const contact = contactFor(cleanContactId);
  const codexOptions = codexOptionsForContact(cleanContactId, settings);
  const thread = isDemoSeedThreadId(cleanThreadId)
    ? demoSeedThreadById(cleanThreadId)
    : await codex.resumeThread(cleanThreadId, {
      cwd: cwdForCodexContact(contact, codexOptions, knownThreads.get(cleanThreadId)?.cwd),
      developerInstructions: localizedInstructions(contact),
      codexOptions
  });
  if (thread) knownThreads.set(cleanThreadId, thread);
  const hydratedContact = contact.kind === "project" ? { ...contact, threadId: cleanThreadId } : contactFromThread(cleanThreadId);
  const targetContactId = hydratedContact.id;
  if (!isDemoSeedThreadId(cleanThreadId)) {
    threadByContact.set(targetContactId, cleanThreadId);
    contactByThread.set(cleanThreadId, targetContactId);
  }
  retargetChatWindow(event, targetContactId);
  return {
    ok: true,
    threadId: cleanThreadId,
    contactId: targetContactId,
    contact: hydratedContact,
    messages: messagesFromThread(thread, hydratedContact),
    conversations: await conversationBrowser()
  };
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

ipcMain.handle("conversation:list", async () => conversationBrowser());

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
    const settings = await loadSettings();
    const codexOptions = codexOptionsForContact(contactId, settings);
    const threadId = await ensureThread(contactId);
    await codex.startTurn(threadId, cleanItems, codexOptions);
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

ipcMain.handle("window:get-bounds", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return null;
  return win.getBounds();
});

ipcMain.handle("window:resize-to", (event, nextBounds = {}) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed() || win.isMaximized() || win.isFullScreen()) return { ok: false };
  const current = win.getBounds();
  const [minWidth, minHeight] = win.getMinimumSize();
  const width = Math.max(minWidth || 320, Math.round(Number(nextBounds.width) || current.width));
  const height = Math.max(minHeight || 320, Math.round(Number(nextBounds.height) || current.height));
  win.setBounds({ ...current, width, height }, false);
  return { ok: true, bounds: win.getBounds() };
});

ipcMain.handle("window:set-zoom-factor", (event, factor = 1) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return { ok: false, zoomFactor: 1 };
  const zoomFactor = Math.max(0.7, Math.min(1.6, Number(factor) || 1));
  win.webContents.setZoomFactor(zoomFactor);
  return { ok: true, zoomFactor: win.webContents.getZoomFactor() };
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
