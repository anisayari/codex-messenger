import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  codexApprovalOptions,
  codexCwdOptions,
  codexModelOptions,
  codexReasoningOptions,
  codexSandboxOptions,
  defaultCodexOptions,
  normalizeCodexOptions,
  optionLabel
} from "../shared/codexOptions.js";
import { appCopyFor, loginCopyFor, normalizeLanguage, supportedLanguages } from "../shared/languages.js";
import {
  applyLanguageDirection,
  contactStatusFor,
  localizedStatusLabel,
  statusLabels,
  statusOptions,
  statusOptionsFor
} from "./i18n.js";
import msnDisplayPictures from "./msnDisplayPictures.js";
import msnEmoticons from "./msnEmoticons.js";
import { animatedInlineEmoticons, renderFormattedMessageText } from "./messageFormatting.jsx";
import {
  bubbleColorOptions,
  defaultTextStyle,
  normalizeConversationZoom,
  normalizeTextStyle,
  textColorOptions,
  textFontOptions,
  textStyleForContact,
  transcriptInitialRenderLimit,
  transcriptRenderStep
} from "./chatTextStyle.js";
import { playNewMessage, playSoundKey, playWink, playWizz, soundCatalog } from "./soundEffects.js";
import { extractWinkFromText, winkCatalog } from "./winks.js";
import UpdateDialog from "./updateDialog.jsx";
import Composer from "./composer.jsx";
import { ApprovalRequestsPanel, Message } from "./chatParts.jsx";
import GamesPanel from "./gamesPanel.jsx";
import {
  ActivitiesPanel,
  CameraPanel,
  EmoticonsPanel,
  FilesPanel,
  FormatButton,
  InvitePanel,
  TextStylePanel,
  Tool,
  VoicePanel
} from "./mediaPanels.jsx";
import ThreadTabs from "./threadTabs.jsx";
import RosterView from "./rosterView.jsx";
import { useCodexEvents } from "./useCodexEvents.js";
import { usePromptDialog } from "./usePromptDialog.jsx";
import { useUpdates } from "./useUpdates.js";
import { brandPeopleLogo, Logo, Menu, ResizeGrip, Titlebar } from "./windowChrome.jsx";
import "./styles.css";

const api = window.codexMsn;

function errorMessage(error, fallback = "Erreur inconnue") {
  if (!error) return fallback;
  return error.message || String(error) || fallback;
}

function reportRendererError(event, error, details = {}) {
  const message = errorMessage(error);
  const logResult = api?.log?.(event, {
    ...details,
    message,
    stack: error?.stack
  });
  logResult?.catch?.(() => {});
}

function ErrorScreen({ title = "Erreur Codex Messenger", message, logPath, details }) {
  return (
    <div className="loading error">
      <section className="debug-error-card" role="alert">
        <strong>{title}</strong>
        <p>{message}</p>
        {details ? <code>{details}</code> : null}
        {logPath ? <small>Log: {logPath}</small> : null}
        <button type="button" onClick={() => api?.app?.reload?.()}>{appCopyFor("fr").common.reload ?? "Recharger"}</button>
      </section>
    </div>
  );
}

class RendererErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    this.setState({ info });
    reportRendererError("react.render.error", error, { componentStack: info?.componentStack });
  }

  render() {
    if (this.state.error) {
      return (
        <ErrorScreen
          title="Erreur interface"
          message={errorMessage(this.state.error, "L'interface a plante pendant le rendu.")}
          details={this.state.info?.componentStack?.trim()}
        />
      );
    }
    return this.props.children;
  }
}

const activityPrompts = [
  ["Plan", "Fais un plan de travail court pour ce projet, puis propose la premiere action concrete."],
  ["Review", "Fais une revue pragmatique du projet courant: bugs probables, risques, tests manquants, priorites."],
  ["Tests", "Inspecte le projet et propose les commandes de test/build pertinentes. Si c'est raisonnable, lance-les."],
  ["Design", "Analyse l'interface actuelle et propose les modifications visuelles prioritaires pour coller a MSN 7."]
];
const slashCommandCatalog = [
  { id: "status", label: "/status", detail: "etat du fil" },
  { id: "new", label: "/new", detail: "nouveau fil" },
  { id: "review", label: "/review", detail: "revue Codex" },
  { id: "compact", label: "/compact", detail: "compacter" },
  { id: "fork", label: "/fork", detail: "dupliquer" },
  { id: "model", label: "/model", detail: "modele actif" }
];
const agentAvatarOptions = [
  ["lens", "Loupe"],
  ["brush", "Design"],
  ["terminal", "Terminal"],
  ["butterfly", "Codex"],
  ...msnDisplayPictures.map((picture) => [picture.id, picture.label])
];
const msnDisplayPictureById = Object.fromEntries(msnDisplayPictures.map((picture) => [picture.id, picture]));
const agentColorOptions = ["#315fd0", "#11a77a", "#d88721", "#167c83", "#8b5bc7", "#c54545"];
const generatedAvatarPalettes = [
  ["#0e9fbd", "#88e4f5", "#185ac4", "#f7fcff"],
  ["#24a36a", "#b7f1c7", "#047050", "#f9fffb"],
  ["#e18b21", "#ffd58f", "#c44f1f", "#fffaf2"],
  ["#5166d8", "#c7d4ff", "#6b46ad", "#fbfbff"],
  ["#c64b65", "#ffd1dc", "#842849", "#fff8fb"],
  ["#22827f", "#afeae6", "#2157a5", "#f8ffff"]
];
function now() {
  return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(new Date());
}

function makeMessage(from, author, text, options = {}) {
  return { id: crypto.randomUUID(), from, author, text, time: now(), createdAtMs: Date.now(), ...options };
}

function hasRecentSameOutgoing(messages, text) {
  const cleanText = normalizeMessageText(text);
  if (!cleanText) return false;
  const currentTime = Date.now();
  return messages.slice(-8).some((message) => (
    message.from === "me" &&
    Number.isFinite(message.createdAtMs) &&
    currentTime - message.createdAtMs < 5000 &&
    normalizeMessageText(message.text) === cleanText
  ));
}

function appendOutgoingMessage(messages, author, text, options = {}) {
  if (hasRecentSameOutgoing(messages, text)) return messages;
  return [...messages, makeMessage("me", author, text, options)];
}

function codexConnectionNotice(text) {
  const clean = normalizeMessageText(text);
  if (!clean) return null;
  const reconnectMatch = clean.match(/^Reconnecting\.{3}\s*(\d+\s*\/\s*\d+)?$/i);
  if (reconnectMatch) {
    return {
      kind: "reconnecting",
      text: `Reconnexion Codex${reconnectMatch[1] ? ` ${reconnectMatch[1].replace(/\s+/g, "")}` : ""}`
    };
  }
  if (/^(codex app-server exited|codex app-server stopped|disconnected|connection lost|offline|hors ligne)/i.test(clean)) {
    return { kind: "offline", text: `Codex offline: ${clean}` };
  }
  if (/^(connected|reconnected|codex app-server active|online)$/i.test(clean)) {
    return { kind: "online", text: "Codex online" };
  }
  return null;
}

function appendSystemNotice(messages, notice) {
  if (!notice?.text) return messages;
  const last = messages[messages.length - 1];
  if (last?.from === "system" && last.noticeKind === notice.kind) {
    return [...messages.slice(0, -1), { ...last, text: notice.text, time: now() }];
  }
  return [...messages, makeMessage("system", "system", notice.text, { noticeKind: notice.kind })];
}

function codexModelValue(model) {
  return String(model?.model ?? model?.id ?? "").trim();
}

function codexModelLabel(model) {
  return String(model?.displayName ?? model?.model ?? model?.id ?? "").trim();
}

function uniqueOptions(options) {
  const seen = new Set();
  return options.filter((option) => {
    if (seen.has(option.value)) return false;
    seen.add(option.value);
    return true;
  });
}

function codexModelMenuOptions(models = [], selectedValue = "") {
  const dynamicOptions = models
    .map((model) => {
      const value = codexModelValue(model);
      if (!value) return null;
      return { value, label: codexModelLabel(model) || value };
    })
    .filter(Boolean);
  const selectedOption = selectedValue && !dynamicOptions.some((option) => option.value === selectedValue)
    ? [{ value: selectedValue, label: selectedValue }]
    : [];
  return uniqueOptions([codexModelOptions[0], ...selectedOption, ...dynamicOptions, ...codexModelOptions.slice(1)]);
}

function codexReasoningMenuOptions(models = [], selectedModel = "", selectedReasoning = "") {
  const model = models.find((item) => codexModelValue(item) === selectedModel);
  const supported = Array.isArray(model?.supportedReasoningEfforts)
    ? model.supportedReasoningEfforts
        .map((item) => String(item?.reasoningEffort ?? "").trim())
        .filter(Boolean)
    : [];
  const dynamicOptions = supported
    .map((value) => codexReasoningOptions.find((option) => option.value === value) ?? { value, label: value })
    .filter(Boolean);
  const selectedOption = selectedReasoning && !dynamicOptions.some((option) => option.value === selectedReasoning)
    ? [codexReasoningOptions.find((option) => option.value === selectedReasoning) ?? { value: selectedReasoning, label: selectedReasoning }]
    : [];
  const fallback = supported.length ? dynamicOptions : codexReasoningOptions.slice(1);
  return uniqueOptions([codexReasoningOptions[0], ...selectedOption, ...fallback]);
}

function replaceChatContactUrl(contactId) {
  const cleanContactId = String(contactId ?? "").trim();
  if (!cleanContactId) return;
  const params = new URLSearchParams(window.location.search);
  if (params.get("view") !== "chat") return;
  params.set("contactId", cleanContactId);
  window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
}

function normalizeWizzDelaySeconds(value) {
  const seconds = Math.round(Number(value) || 60);
  return Math.max(10, Math.min(1800, seconds));
}

function normalizeMessengerSettings(settings = {}) {
  const source = settings ?? {};
  const closeBehavior = source.closeBehavior === "close" ? "quit" : source.closeBehavior;
  return {
    language: normalizeLanguage(source.language ?? source.profile?.language ?? "fr"),
    notificationsEnabled: source.notificationsEnabled !== false,
    newMessageSoundEnabled: source.newMessageSoundEnabled !== false,
    unreadWizzEnabled: source.unreadWizzEnabled !== false,
    demoMode: source.demoMode === true,
    autoSignIn: source.autoSignIn !== false,
    unreadWizzDelaySeconds: normalizeWizzDelaySeconds((source.unreadWizzDelayMs ?? 60_000) / 1000),
    closeBehavior: ["ask", "hide", "quit"].includes(closeBehavior) ? closeBehavior : "ask"
  };
}

function hasAvailableUpdates(updateState) {
  return Boolean(updateState?.front?.updateAvailable || updateState?.codex?.updateAvailable);
}

function versionLabel(value, unknown = "inconnue") {
  return String(value || unknown);
}

function updateLineState(item, copy = appCopyFor("fr")) {
  const updateCopy = copy.updates ?? {};
  const unknown = updateCopy.unknown || "inconnue";
  if (!item) return updateCopy.notChecked || "Non verifie";
  if (item.updateAvailable) return (updateCopy.updateAvailableLine || "Mise a jour disponible: {version}").replace("{version}", versionLabel(item.latestVersion, unknown));
  if (item.error) return (updateCopy.checkIncomplete || "Verification incomplete: {error}").replace("{error}", item.error);
  if (item.latestVersion) return updateCopy.upToDate || "A jour";
  return updateCopy.notChecked || "Non verifie";
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function localFileUrl(filePath) {
  return `file:///${String(filePath).replace(/\\/g, "/")}`;
}

function hashString(value = "") {
  let hash = 2166136261;
  const input = String(value);
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function safeColor(value, fallback) {
  const color = String(value ?? "").trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;
}

function initialsFor(name) {
  const words = String(name || "CM").trim().split(/\s+/).filter(Boolean);
  const raw = words.length > 1 ? `${words[0][0]}${words[1][0]}` : (words[0] || "CM").slice(0, 2);
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 2) || "CM";
}

function generatedAvatarKind(contact = {}) {
  if (contact.kind === "thread" || contact.threadId) return "thread";
  if (contact.kind === "project" || contact.cwd) return "project";
  if (["lens", "brush", "terminal"].includes(contact.avatar)) return contact.avatar;
  if (contact.custom || contact.kind === "agent") return "agent";
  return "buddy";
}

function isCodexHistoryContact(contact = {}) {
  return Boolean(contact.kind === "project" || contact.kind === "thread" || contact.cwd || contact.threadId);
}

const avatarCache = new Map();

function generatedAvatarUrl(contact = {}) {
  const seed = `${contact.id ?? ""}|${contact.name ?? ""}|${contact.mail ?? ""}|${contact.cwd ?? ""}|${contact.threadId ?? ""}`;
  const hash = hashString(seed);
  const [base, bright, accent, paper] = generatedAvatarPalettes[hash % generatedAvatarPalettes.length];
  const primary = safeColor(contact.color, base);
  const initials = initialsFor(contact.name || contact.mail);
  const kind = generatedAvatarKind(contact);
  const key = `${kind}|${initials}|${primary}|${bright}|${accent}|${paper}|${hash % 19}`;
  if (avatarCache.has(key)) return avatarCache.get(key);

  const sharedPerson = `
    <circle cx="56" cy="63" r="21" fill="${bright}" stroke="${accent}" stroke-width="5"/>
    <path d="M22 125c3-28 17-45 37-45 18 0 32 16 36 45v14H22z" fill="${bright}" stroke="${accent}" stroke-width="5"/>
    <circle cx="94" cy="54" r="29" fill="url(#shine)" stroke="${primary}" stroke-width="6"/>
    <path d="M48 137c4-42 22-65 51-65 28 0 46 23 51 65v12H48z" fill="url(#body)" stroke="${primary}" stroke-width="6"/>
  `;
  const glyphs = {
    agent: `${sharedPerson}<path d="M73 94l16 22-16 22" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/><path d="M102 133h27" stroke="#fff" stroke-width="9" stroke-linecap="round"/>`,
    buddy: sharedPerson,
    project: `<path d="M18 58h44l12 14h68c7 0 11 4 11 11v48c0 7-4 11-11 11H18z" fill="url(#body)" stroke="${primary}" stroke-width="6"/><path d="M18 58h48l10 14H18z" fill="${bright}" opacity=".95"/><circle cx="115" cy="105" r="18" fill="#fff" opacity=".9"/><path d="M102 106h28M116 92v28" stroke="${accent}" stroke-width="7" stroke-linecap="round"/>`,
    thread: `<rect x="22" y="34" width="116" height="78" rx="18" fill="url(#body)" stroke="${primary}" stroke-width="6"/><path d="M55 111l-20 27 38-19" fill="url(#body)" stroke="${primary}" stroke-width="6" stroke-linejoin="round"/><circle cx="56" cy="74" r="8" fill="#fff"/><circle cx="81" cy="74" r="8" fill="#fff"/><circle cx="106" cy="74" r="8" fill="#fff"/><text x="80" y="143" text-anchor="middle" font-family="Tahoma,Arial" font-size="22" font-weight="700" fill="${accent}">${initials}</text>`,
    terminal: `<rect x="22" y="35" width="116" height="88" rx="10" fill="#17324f" stroke="${primary}" stroke-width="6"/><rect x="30" y="43" width="100" height="15" rx="4" fill="${bright}" opacity=".45"/><path d="M43 78l18 16-18 16" fill="none" stroke="#dcfff4" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/><path d="M75 111h37" stroke="#dcfff4" stroke-width="8" stroke-linecap="round"/><text x="80" y="146" text-anchor="middle" font-family="Tahoma,Arial" font-size="22" font-weight="700" fill="${accent}">${initials}</text>`,
    lens: `<circle cx="69" cy="71" r="38" fill="url(#shine)" stroke="${primary}" stroke-width="8"/><path d="M98 100l35 35" stroke="${accent}" stroke-width="14" stroke-linecap="round"/><circle cx="56" cy="57" r="13" fill="#fff" opacity=".8"/><text x="80" y="147" text-anchor="middle" font-family="Tahoma,Arial" font-size="22" font-weight="700" fill="${accent}">${initials}</text>`,
    brush: `<path d="M102 24c14 9 21 23 14 35L77 126c-5 9-18 9-25 3s-8-18-1-26l51-79z" fill="url(#body)" stroke="${primary}" stroke-width="6"/><path d="M48 111c-17 4-27 13-30 28 14 2 28-1 38-13" fill="${accent}" opacity=".86"/><circle cx="94" cy="52" r="13" fill="#fff" opacity=".75"/><text x="83" y="148" text-anchor="middle" font-family="Tahoma,Arial" font-size="22" font-weight="700" fill="${accent}">${initials}</text>`
  };
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${paper}"/><stop offset=".48" stop-color="${bright}"/><stop offset="1" stop-color="${primary}"/></linearGradient>
    <radialGradient id="shine" cx=".34" cy=".22" r=".78"><stop offset="0" stop-color="#fff"/><stop offset=".42" stop-color="${bright}"/><stop offset="1" stop-color="${primary}"/></radialGradient>
    <linearGradient id="body" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${bright}"/><stop offset=".72" stop-color="${primary}"/></linearGradient>
  </defs>
  <rect width="160" height="160" rx="11" fill="url(#bg)"/>
  <path d="M13 17c32-15 82-10 118 13 20 13 20 36 4 42-36 13-78 6-116-14C4 50 1 25 13 17z" fill="#fff" opacity=".5"/>
  ${glyphs[kind] ?? glyphs.buddy}
  <path d="M0 150c42-10 86-10 160 0v10H0z" fill="#fff" opacity=".18"/>
</svg>`;
  const url = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  avatarCache.set(key, url);
  return url;
}

function presenceClass(status) {
  if (status === "busy") return "busy";
  if (status === "offline") return "offline";
  if (["away", "brb", "phone", "lunch"].includes(status)) return "away";
  return "online";
}

function Avatar({ contact, large = false }) {
  const picturePath = contact.displayPicturePath || contact.picturePath;
  const pictureAsset = contact.displayPictureAsset || contact.pictureAsset;
  const defaultPicture = msnDisplayPictureById[contact.avatar];
  const generatedPicture = generatedAvatarUrl(contact);
  return (
    <div className={`${large ? "avatar large" : "avatar"} ${presenceClass(contact.status)}`} style={{ "--avatar": contact.color ?? "#11a77a" }}>
      {picturePath ? (
        <img className="avatar-picture" src={localFileUrl(picturePath)} alt="" draggable="false" />
      ) : pictureAsset ? (
        <img className="avatar-picture" src={pictureAsset} alt="" draggable="false" />
      ) : defaultPicture ? (
        <img className="avatar-picture" src={defaultPicture.src} alt="" draggable="false" />
      ) : contact.avatar === "butterfly" ? (
        <Logo small={!large} />
      ) : (
        <img className="avatar-generated" src={generatedPicture} alt="" draggable="false" />
      )}
    </div>
  );
}

function DisplayFrame({ contact, position, menuItems = [], statusCopy = statusLabels, onNameDoubleClick, onStatusDoubleClick }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const statusText = statusCopy[contact.status] ?? contact.status ?? statusCopy.online ?? statusLabels.online;

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (!ref.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  function runEntry(entry) {
    if (entry.disabled) return;
    setOpen(false);
    entry.action?.();
  }

  return (
    <div className={`display-frame ${position ?? ""}`} ref={ref}>
      <Avatar contact={contact} large />
      <div className="display-frame-caption">
        <button type="button" title="Double-clic pour renommer" onDoubleClick={onNameDoubleClick}>
          {contact.name ?? "Codex"}
        </button>
        <button type="button" title="Double-clic pour changer le statut" onDoubleClick={onStatusDoubleClick}>
          {statusText}
        </button>
      </div>
      <button
        className="display-frame-menu-button"
        type="button"
        aria-label={`Options ${contact.name ?? "avatar"}`}
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((current) => !current);
        }}
      />
      {open ? (
        <div className="display-frame-menu" role="menu">
          {menuItems.map((entry, index) => (
            entry.separator ? (
              <div className="display-frame-menu-separator" key={`separator-${index}`} />
            ) : entry.type === "select" ? (
              <label
                className="display-frame-menu-select"
                key={`${entry.label}-${index}`}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
              >
                <span>{entry.label}</span>
                <select
                  value={entry.value}
                  aria-label={entry.label}
                  onChange={(event) => entry.onChange?.(event.target.value)}
                >
                  {entry.options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : entry.type === "status" ? (
              <div className="display-frame-menu-status" key={`${entry.label}-${index}`}>
                {entry.label}
              </div>
            ) : (
              <button
                type="button"
                role="menuitem"
                disabled={entry.disabled}
                key={entry.label}
                onClick={() => runEntry(entry)}
              >
                {entry.label}
              </button>
            )
          ))}
        </div>
      ) : null}
    </div>
  );
}

function WinkAnimationOverlay({ animation }) {
  if (!animation?.wink) return null;
  const { wink, direction, key } = animation;
  return (
    <div className={`wink-animation-overlay ${direction}`} key={key} aria-hidden="true">
      <div className="wink-animation-card">
        <img src={wink.src} alt="" draggable="false" />
      </div>
    </div>
  );
}

function displayNameFromEmail(email) {
  const localPart = String(email || "").split("@")[0] || "user";
  return String(localPart)
    .trim()
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 80) || "user";
}

function LoginView({ initialProfile, initialSettings, initialCodexStatus, onSignedIn }) {
  const initialEmail = initialProfile.email || "";
  const initialDisplayName = initialProfile.displayName || displayNameFromEmail(initialEmail);
  const [email, setEmail] = useState(initialEmail);
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [status, setStatus] = useState(initialProfile.status);
  const [language, setLanguage] = useState(normalizeLanguage(initialProfile.language ?? initialSettings?.language ?? "fr"));
  const [codexPath, setCodexPath] = useState(initialSettings?.codexPath ?? "");
  const [autoSignIn, setAutoSignIn] = useState(initialSettings?.autoSignIn !== false);
  const [codexStatus, setCodexStatus] = useState(initialCodexStatus);
  const [state, setState] = useState("idle");
  const [setupState, setSetupState] = useState("idle");
  const [error, setError] = useState("");
  const [setupMessage, setSetupMessage] = useState("");
  const [pressedPathAction, setPressedPathAction] = useState("");
  const pathActionTimer = useRef(null);
  const displayNameEdited = useRef(initialDisplayName !== displayNameFromEmail(initialEmail));
  const text = loginCopyFor(language);
  const npmMissing = codexStatus?.npm && !codexStatus.npm.ok;
  const codexMissing = !codexStatus?.ok;
  const loginMissing = Boolean(codexStatus?.ok && codexStatus?.login && !codexStatus.login.ok);
  const canConnect = Boolean(codexStatus?.ok && (!codexStatus.login || codexStatus.login.ok));

  useEffect(() => () => {
    if (pathActionTimer.current) window.clearTimeout(pathActionTimer.current);
  }, []);

  useEffect(() => {
    applyLanguageDirection(language);
  }, [language]);

  function pulsePathAction(action) {
    if (pathActionTimer.current) window.clearTimeout(pathActionTimer.current);
    setPressedPathAction(action);
    pathActionTimer.current = window.setTimeout(() => {
      setPressedPathAction("");
      pathActionTimer.current = null;
    }, 180);
  }

  async function waitForButtonPaint() {
    await new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
    await new Promise((resolve) => window.setTimeout(resolve, 55));
  }

  async function submit(event) {
    event.preventDefault();
    setError("");
    if (!canConnect) {
      setError(codexMissing ? text.missing : text.loginMissing);
      return;
    }
    setState("connecting");
    try {
      const result = await api.signIn({
        email: email.trim(),
        displayName: displayName.trim() || displayNameFromEmail(email),
        personalMessage: initialProfile.personalMessage ?? "",
        status,
        language,
        codexPath,
        autoSignIn,
        unreadWizzDelayMs: normalizeWizzDelaySeconds((initialSettings?.unreadWizzDelayMs ?? 60_000) / 1000) * 1000,
        displayPicturePath: initialProfile.displayPicturePath ?? "",
        displayPictureAsset: initialProfile.displayPictureAsset ?? ""
      });
      onSignedIn(result.profile, result.userAgent, result.settings, result.codexStatus);
    } catch (err) {
      setError(err.message);
      setState("idle");
    }
  }

  function changeEmail(value) {
    setEmail(value);
    if (!displayNameEdited.current) {
      setDisplayName(displayNameFromEmail(value));
    }
  }

  function changeDisplayName(value) {
    displayNameEdited.current = true;
    setDisplayName(value);
  }

  async function chooseCodex() {
    setError("");
    pulsePathAction("browse");
    await waitForButtonPaint();
    const result = await api.chooseCodex();
    if (result?.canceled) return;
    setCodexPath(result.settings.codexPath ?? "");
    setCodexStatus(result.codexStatus);
  }

  async function testCodex() {
    setError("");
    setSetupMessage("");
    pulsePathAction("test");
    await waitForButtonPaint();
    try {
      const result = await api.testCodex(codexPath || null);
      setCodexStatus(result);
    } catch (err) {
      setCodexStatus({ ok: false, error: err.message });
      setError(`${text.testFail}: ${err.message}`);
    }
  }

  async function installCodexCli() {
    setError("");
    setSetupMessage("");
    setSetupState("installing");
    try {
      const result = await api.installCodex();
      setCodexStatus(result.codexStatus);
    } catch (err) {
      setError(err.message);
    } finally {
      setSetupState("idle");
    }
  }

  async function loginCodexCli() {
    setError("");
    setSetupMessage("");
    setSetupState("login");
    try {
      const result = await api.loginCodex(codexPath || null);
      setCodexStatus(result.codexStatus);
      setSetupMessage(text.loginStarted);
    } catch (err) {
      setError(err.message);
    } finally {
      setSetupState("idle");
    }
  }

  async function openNodeDownload() {
    setError("");
    setSetupMessage(text.npmMissing);
    await api.openNodeDownload();
  }

  function codexStatusText() {
    if (codexStatus?.ok && codexStatus?.login?.ok) return `${text.found}: ${codexStatus.command}. ${codexStatus.login.text}`;
    if (codexStatus?.ok && codexStatus?.login && !codexStatus.login.ok) return `${text.found}: ${codexStatus.command}. ${text.loginMissing}: ${codexStatus.login.text}`;
    if (npmMissing) return `${text.missing} ${text.npmMissing}`;
    return codexStatus?.error ?? text.missing;
  }

  const loginPresence = !canConnect || status === "offline"
    ? "offline"
    : state === "connecting" || setupState !== "idle"
      ? "away"
      : status;
  const sessionText = loginMissing || !canConnect ? text.sessionRequired : text.sessionReady;
  const statusText = state === "connecting" ? text.reconnecting : localizedStatusLabel(status, text);

  return (
    <form className="login-panel msn-login-panel" onSubmit={submit}>
      <section className="msn-login-card" aria-label="Codex Messenger sign in">
        <img className="msn-login-watermark" src={brandPeopleLogo} alt="" aria-hidden="true" draggable="false" />
        <header className="msn-login-brand">
          <Logo small />
          <strong>Codex</strong>
          <span>Messenger</span>
        </header>

        <div className="msn-login-picture">
          <div className={`msn-login-avatar ${presenceClass(loginPresence)}`}>
            <Logo />
          </div>
        </div>

        <label className="msn-login-field">
          <span>{text.language}:</span>
          <select value={language} onChange={(event) => setLanguage(normalizeLanguage(event.target.value))}>
            {supportedLanguages.map((item) => <option value={item.code} key={item.code}>{item.label}</option>)}
          </select>
        </label>

        <label className="msn-login-field">
          <span>{text.email}:</span>
          <div className="msn-combo-input">
            <input value={email} onChange={(event) => changeEmail(event.target.value)} autoComplete="email" />
            <button type="button" tabIndex={-1} aria-hidden="true">⌄</button>
          </div>
        </label>

        <label className="msn-login-field">
          <span>{text.displayName}:</span>
          <input value={displayName} onChange={(event) => changeDisplayName(event.target.value)} autoComplete="name" />
        </label>

        <label className="msn-login-field">
          <span>{text.openAiSession}:</span>
          <input value={sessionText} readOnly disabled />
        </label>

        <label className="msn-login-status-row">
          <span>{text.status}: <strong>{statusText}</strong></span>
          <i className={`msn-login-dot ${presenceClass(loginPresence)}`} aria-hidden="true" />
          <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label={text.status}>
            {statusOptions.map(([value]) => <option value={value} key={value}>{localizedStatusLabel(value, text)}</option>)}
          </select>
        </label>

        <fieldset className="msn-login-options">
          <label><input type="checkbox" defaultChecked /> {text.remember}</label>
          <label><input type="checkbox" defaultChecked /> {text.rememberPassword}</label>
          <label>
            <input
              type="checkbox"
              checked={autoSignIn}
              onChange={(event) => setAutoSignIn(event.target.checked)}
            />
            {text.signAutomatically}
          </label>
        </fieldset>

        <button className="msn-signin-button" disabled={state !== "idle" || !canConnect}>
          {state === "idle" ? text.connect : text.connecting}
        </button>
        <div className={state === "idle" ? "progress msn-login-progress" : "progress msn-login-progress active"}><span /></div>

        <details className="msn-service-panel" aria-label={text.serviceStatus} open={!canConnect}>
          <summary className="msn-service-title">
            <span>{text.serviceStatus}</span>
            <strong className={canConnect ? "online" : "offline"}>{canConnect ? text.online : text.offline}</strong>
          </summary>
          <div className="msn-service-body">
            <label className="msn-login-field compact">
              <span>{text.codexPath}</span>
              <input value={codexPath} onChange={(event) => setCodexPath(event.target.value)} placeholder={text.autoPath} />
            </label>
            <div className="codex-path-actions">
              <button className={pressedPathAction === "browse" ? "pressed" : ""} type="button" onClick={chooseCodex}>{text.browse}</button>
              <button className={pressedPathAction === "test" ? "pressed" : ""} type="button" onClick={testCodex}>{text.test}</button>
            </div>
            <p className={canConnect ? "codex-status ok" : "codex-status"}>
              {codexStatusText()}
            </p>
            <div className="codex-setup-actions">
              {npmMissing ? (
                <button type="button" onClick={openNodeDownload}>{text.openNode}</button>
              ) : null}
              {!npmMissing && codexMissing ? (
                <button type="button" onClick={installCodexCli} disabled={setupState !== "idle"}>
                  {setupState === "installing" ? text.installingCodex : text.installCodex}
                </button>
              ) : null}
              {loginMissing ? (
                <button type="button" onClick={loginCodexCli} disabled={setupState !== "idle"}>
                  {text.loginCodex}
                </button>
              ) : null}
            </div>
          </div>
        </details>

        <nav className="msn-login-links" aria-label="Login help">
          <button type="button" onClick={loginCodexCli} disabled={setupState !== "idle"}>{text.loginCodex}</button>
          <button type="button" onClick={testCodex}>{text.test}</button>
        </nav>
      </section>

      {setupMessage ? <p className="setup-box">{setupMessage}</p> : null}
      {error ? <p className="error-box">{error}</p> : null}
      <p className="server-hint">{text.hint}</p>
    </form>
  );
}

function ProfilePictureDialog({ draft, selecting, onSelectDefault, onImport, onClear, onClose, copy = appCopyFor("fr") }) {
  return (
    <div className="settings-dialog-backdrop profile-picture-dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="settings-dialog profile-picture-dialog" role="dialog" aria-modal="true" aria-label="Choisir une image perso">
        <header>
          <strong>Choisir une image perso</strong>
          <button type="button" aria-label="Fermer" onClick={onClose}>x</button>
        </header>
        <section>
          <div className="profile-picture-dialog-preview">
            <Avatar contact={{ ...draft, avatar: "butterfly", color: "#11a77a" }} large />
            <div>
              <strong>Images Windows/MSN d'epoque</strong>
              <p>Selectionne une image fournie avec le style Messenger, ou importe une photo locale.</p>
            </div>
          </div>
          <div className="profile-picture-gallery large" aria-label="Images Windows et MSN par defaut">
            {msnDisplayPictures.map((picture) => (
              <button
                className={draft.displayPictureAsset === picture.src ? "active" : ""}
                key={picture.id}
                title={picture.label}
                type="button"
                onClick={() => onSelectDefault(picture)}
              >
                <img src={picture.src} alt="" draggable="false" />
                <span>{picture.label}</span>
              </button>
            ))}
          </div>
        </section>
        <footer>
          <button type="button" onClick={onImport} disabled={selecting}>{selecting ? "Import..." : "Importer une photo..."}</button>
          <button type="button" onClick={onClear}>{copy.chat.defaultPicture}</button>
          <button type="button" onClick={onClose}>{copy.common.close}</button>
        </footer>
      </section>
    </div>
  );
}

function ProfileEditor({ profile, onChange, onChoosePicture, onClose, copy = appCopyFor("fr") }) {
  const [draft, setDraft] = useState(profile);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [pictureDialogOpen, setPictureDialogOpen] = useState(false);
  const [selectingPicture, setSelectingPicture] = useState(false);

  useEffect(() => {
    setDraft(profile);
  }, [profile]);

  function update(field, value) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await onChange(draft);
      onClose();
    } catch (err) {
      setError(err.message || "Profil non sauvegarde.");
    } finally {
      setSaving(false);
    }
  }

  function chooseDefaultPicture(picture) {
    setDraft((current) => ({
      ...current,
      displayPictureAsset: picture.src,
      displayPicturePath: ""
    }));
    setPictureDialogOpen(false);
  }

  function clearDraftPicture() {
    setDraft((current) => ({
      ...current,
      displayPictureAsset: "",
      displayPicturePath: ""
    }));
    setPictureDialogOpen(false);
  }

  async function importPicture() {
    setSelectingPicture(true);
    setError("");
    try {
      const result = await onChoosePicture({ save: false });
      if (result?.canceled) return;
      setDraft((current) => ({
        ...current,
        displayPicturePath: result?.profile?.displayPicturePath ?? current.displayPicturePath ?? "",
        displayPictureAsset: result?.profile?.displayPictureAsset ?? ""
      }));
      setPictureDialogOpen(false);
    } catch (err) {
      setError(err.message || "Image non importee.");
    } finally {
      setSelectingPicture(false);
    }
  }

  return (
    <form className="profile-editor" onSubmit={submit}>
      <div className="profile-editor-picture">
        <Avatar contact={{ ...draft, avatar: "butterfly", color: "#11a77a" }} />
        <div className="profile-picture-tools">
          <button type="button" onClick={() => setPictureDialogOpen(true)}>{copy.chat.changePicture}</button>
          <button type="button" onClick={clearDraftPicture}>{copy.chat.defaultPicture}</button>
        </div>
      </div>
      <label>
        <span>{loginCopyFor(profile.language).displayName}</span>
        <input value={draft.displayName ?? ""} onChange={(event) => update("displayName", event.target.value)} />
      </label>
      <label>
        <span>{loginCopyFor(profile.language).personalMessage}</span>
        <input value={draft.personalMessage ?? ""} onChange={(event) => update("personalMessage", event.target.value)} maxLength={140} />
      </label>
      <label>
        <span>{loginCopyFor(profile.language).status}</span>
        <select value={draft.status ?? "online"} onChange={(event) => update("status", event.target.value)}>
          {statusOptionsFor(copy).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
        </select>
      </label>
      {error ? <p className="profile-editor-error">{error}</p> : null}
      <div className="profile-editor-actions">
        <button type="submit" disabled={saving}>{saving ? copy.settings.saving : copy.common.apply}</button>
        <button type="button" disabled={saving} onClick={onClose}>{copy.common.close}</button>
      </div>
      {pictureDialogOpen ? (
        <ProfilePictureDialog
          draft={draft}
          selecting={selectingPicture}
          onSelectDefault={chooseDefaultPicture}
          onImport={importPicture}
          onClear={clearDraftPicture}
          onClose={() => setPictureDialogOpen(false)}
          copy={copy}
        />
      ) : null}
    </form>
  );
}

function SettingsDialog({ settings, onSave, onClose, copy = appCopyFor("fr") }) {
  const [draft, setDraft] = useState(() => normalizeMessengerSettings(settings));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setDraft(normalizeMessengerSettings(settings));
  }, [settings]);

  function update(field, value) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await onSave({
        language: normalizeLanguage(draft.language),
        notificationsEnabled: draft.notificationsEnabled,
        newMessageSoundEnabled: draft.newMessageSoundEnabled,
        unreadWizzEnabled: draft.unreadWizzEnabled,
        autoSignIn: draft.autoSignIn,
        unreadWizzDelayMs: normalizeWizzDelaySeconds(draft.unreadWizzDelaySeconds) * 1000,
        closeBehavior: draft.closeBehavior
      });
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

 return (
    <div className="settings-dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form className="settings-dialog" onSubmit={submit} role="dialog" aria-modal="true" aria-label={`${copy.settings.title} Codex Messenger`}>
        <header>
          <strong>{copy.settings.title}</strong>
          <button type="button" aria-label={copy.common.close} onClick={onClose}>x</button>
        </header>
        <section>
          <label className="settings-check">
            <input
              type="checkbox"
              checked={draft.notificationsEnabled}
              onChange={(event) => update("notificationsEnabled", event.target.checked)}
            />
            <span>{copy.settings.notifications}</span>
          </label>
          <label className="settings-check">
            <input
              type="checkbox"
              checked={draft.newMessageSoundEnabled}
              onChange={(event) => update("newMessageSoundEnabled", event.target.checked)}
            />
            <span>{copy.settings.sound}</span>
          </label>
          <label className="settings-check">
            <input
              type="checkbox"
              checked={draft.unreadWizzEnabled}
              onChange={(event) => update("unreadWizzEnabled", event.target.checked)}
            />
            <span>{copy.settings.unreadWizz}</span>
          </label>
          <label className="settings-check">
            <input
              type="checkbox"
              checked={draft.autoSignIn}
              onChange={(event) => update("autoSignIn", event.target.checked)}
            />
            <span>{copy.settings.autoSignIn}</span>
          </label>
          <label className="settings-row">
            <span>{copy.settings.language}</span>
            <select value={draft.language} onChange={(event) => update("language", normalizeLanguage(event.target.value))}>
              {supportedLanguages.map((language) => (
                <option value={language.code} key={language.code}>{language.label}</option>
              ))}
            </select>
          </label>
          <label className="settings-row">
            <span>{copy.settings.unreadDelay}</span>
            <input
              type="number"
              min="10"
              max="1800"
              step="5"
              value={draft.unreadWizzDelaySeconds}
              disabled={!draft.unreadWizzEnabled}
              onChange={(event) => update("unreadWizzDelaySeconds", normalizeWizzDelaySeconds(event.target.value))}
            />
          </label>
          <label className="settings-row">
            <span>{copy.settings.closeBehavior}</span>
            <select value={draft.closeBehavior} onChange={(event) => update("closeBehavior", event.target.value)}>
              <option value="ask">{copy.settings.closeAsk}</option>
              <option value="hide">{copy.settings.closeHide}</option>
              <option value="quit">{copy.settings.closeQuit}</option>
            </select>
          </label>
        </section>
        {error ? <p className="settings-error">{error}</p> : null}
        <footer>
          <button type="button" onClick={onClose}>{copy.common.cancel}</button>
          <button type="submit" disabled={saving}>{saving ? copy.settings.saving : copy.common.apply}</button>
        </footer>
      </form>
    </div>
  );
}

function AgentCreator({ onCreate, onClose, onChooseRunFolder, error }) {
  const [draft, setDraft] = useState({
    name: "Agent Specifique",
    group: "Agents personnalises",
    mood: "role sur mesure",
    status: "online",
    avatar: "lens",
    color: agentColorOptions[0],
    cwd: "",
    instructions: "Tu es un agent Codex specialise. Reponds en francais, garde ton role, pose les questions utiles, puis execute la tache de maniere pragmatique."
  });
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState("");

  function update(field, value) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  async function chooseRunFolder() {
    setLocalError("");
    const result = await onChooseRunFolder?.();
    if (result?.canceled || !result?.cwd) return;
    update("cwd", result.cwd);
  }

  async function submit(event) {
    event.preventDefault();
    if (!draft.cwd.trim()) {
      setLocalError("Choisis le dossier de run Codex.");
      return;
    }
    setSaving(true);
    try {
      await onCreate(draft);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="agent-editor" onSubmit={submit}>
      <div className="agent-editor-head">
        <Avatar contact={{ ...draft, displayName: draft.name }} />
        <div>
          <strong>Nouveau contact agent</strong>
          <p>Ce contact ouvre une conversation Codex avec ses propres instructions.</p>
        </div>
      </div>
      <div className="agent-editor-grid">
        <label>
          <span>Nom du contact</span>
          <input required value={draft.name} onChange={(event) => update("name", event.target.value)} />
        </label>
        <label>
          <span>Groupe</span>
          <input value={draft.group} onChange={(event) => update("group", event.target.value)} />
        </label>
        <label>
          <span>Specialite</span>
          <input value={draft.mood} onChange={(event) => update("mood", event.target.value)} />
        </label>
        <label className="agent-run-folder">
          <span>Dossier de run Codex</span>
          <div className="agent-path-picker">
            <input required readOnly value={draft.cwd} placeholder="Choisir le dossier local..." />
            <button type="button" onClick={chooseRunFolder}>Parcourir</button>
          </div>
        </label>
        <label>
          <span>Statut</span>
          <select value={draft.status} onChange={(event) => update("status", event.target.value)}>
            {statusOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
          </select>
        </label>
        <label>
          <span>Icone</span>
          <select value={draft.avatar} onChange={(event) => update("avatar", event.target.value)}>
            {agentAvatarOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
          </select>
        </label>
        <div className="agent-color-field">
          <span>Couleur</span>
          <div className="agent-swatches">
            {agentColorOptions.map((color) => (
              <button
                className={draft.color === color ? "active" : ""}
                key={color}
                style={{ "--swatch": color }}
                title={color}
                type="button"
                onClick={() => update("color", color)}
              />
            ))}
          </div>
        </div>
        <label className="agent-instructions">
          <span>Instructions de l'agent</span>
          <textarea value={draft.instructions} onChange={(event) => update("instructions", event.target.value)} rows={5} />
        </label>
      </div>
      {localError || error ? <p className="agent-error">{localError || error}</p> : null}
      <div className="agent-editor-actions">
        <button type="submit" disabled={saving}>{saving ? "Creation..." : "Creer et ouvrir"}</button>
        <button type="button" onClick={onClose}>Annuler</button>
      </div>
    </form>
  );
}


function MainWindow() {
  const [bootstrap, setBootstrap] = useState(null);
  const [bootstrapError, setBootstrapError] = useState("");
  const [profile, setProfile] = useState(null);
  const [userAgent, setUserAgent] = useState("");
  const [settings, setSettings] = useState(null);
  const [codexStatus, setCodexStatus] = useState(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [profileEditorOpen, setProfileEditorOpen] = useState(false);
  const [agentEditorOpen, setAgentEditorOpen] = useState(false);
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [askPrompt, promptDialog] = usePromptDialog();
  const {
    updateDialogOpen,
    setUpdateDialogOpen,
    updateState,
    checkingUpdates,
    installingUpdateTarget,
    updateActionMessage,
    updateProgress,
    checkForUpdates,
    openUpdateTarget,
    installUpdateTarget,
    restartForUpdate
  } = useUpdates({
    api,
    appVersion: bootstrap?.appVersion ?? "",
    userAgent,
    initialCheck: Boolean(bootstrap)
  });

  useEffect(() => {
    api.bootstrap()
      .then((data) => {
        setBootstrap(data);
        setProfile(data.profile);
        setUserAgent(data.userAgent ?? "");
        setSettings(data.settings);
        setCodexStatus(data.codexStatus);
      })
      .catch((error) => {
        reportRendererError("bootstrap.main.error", error, { view: "main" });
        setBootstrapError(errorMessage(error, "Chargement de la fenetre principale impossible."));
      });
  }, []);

  useEffect(() => api.on("codex:status", (status) => {
    if (status?.kind === "ready") {
      setUserAgent(status.userAgent || status.text || "Codex local connecte");
      setRefreshTick((tick) => tick + 1);
      return;
    }
    if (status?.kind === "error") {
      setCodexStatus((current) => ({
        ...current,
        ready: false,
        error: status.text
      }));
    }
  }), []);

  useEffect(() => {
    const language = settings?.language ?? profile?.language;
    if (language) applyLanguageDirection(language);
  }, [profile?.language, settings?.language]);

  if (bootstrapError) return <ErrorScreen title="Chargement impossible" message={bootstrapError} />;
  if (!bootstrap || !profile) return <div className="loading">Connexion...</div>;
  const copy = appCopyFor(settings?.language ?? profile.language);
  const localizedStatusOptions = statusOptionsFor(copy);

  async function saveProfilePatch(patch) {
    const nextProfile = { ...profile, ...patch };
    const result = await api.setSettings({
      language: nextProfile.language ?? profile.language,
      profile: nextProfile
    });
    setProfile(result.settings.profile);
    setSettings(result.settings);
  }

  function updateAgents(nextContacts, nextSettings) {
    setBootstrap((current) => ({ ...current, contacts: nextContacts, settings: nextSettings }));
    if (nextSettings) setSettings(nextSettings);
  }

  async function changeWizzDelay() {
    const currentSeconds = normalizeWizzDelaySeconds((settings?.unreadWizzDelayMs ?? 60_000) / 1000);
    const value = await askPrompt({
      title: copy.settings.unreadDelay,
      initialValue: String(currentSeconds),
      inputType: "number",
      cancelLabel: copy.common.cancel
    });
    if (value === null) return;
    const seconds = normalizeWizzDelaySeconds(value);
    const result = await api.setSettings({ unreadWizzDelayMs: seconds * 1000 });
    setSettings(result.settings);
    setBootstrap((current) => current ? { ...current, settings: result.settings } : current);
  }

  async function saveMessengerSettings(patch) {
    const result = await api.setSettings(patch);
    setSettings(result.settings);
    if (result.settings?.profile) setProfile(result.settings.profile);
    setBootstrap((current) => current ? { ...current, settings: result.settings } : current);
  }

  async function reloadMainBootstrap() {
    const data = await api.bootstrap();
    setBootstrap(data);
    setProfile(data.profile);
    setUserAgent(data.userAgent ?? "");
    setSettings(data.settings);
    setCodexStatus(data.codexStatus);
    setRefreshTick((tick) => tick + 1);
    return data;
  }

  async function toggleDemoMode() {
    const nextDemoMode = !(settings?.demoMode === true);
    await api.setSettings({ demoMode: nextDemoMode });
    await reloadMainBootstrap();
  }

  function openAgentCreator() {
    setAgentEditorOpen(true);
  }

  const uploadsPath = `${bootstrap.cwd}\\uploads`;
  const primaryContactId = bootstrap.contacts[0]?.id ?? "codex";
  const mainMenus = [
    {
      label: copy.menu.file,
      entries: [
        { label: copy.menu.newConversation, action: () => api.openConversation(primaryContactId) },
        { label: settings?.demoMode ? copy.menu.openDemo : copy.menu.openProject, action: () => api.openProjectPicker() },
        { label: copy.menu.editProfile, action: () => setProfileEditorOpen(true) },
        { separator: true },
        { label: copy.menu.about, action: () => setUpdateDialogOpen(true) },
        { label: copy.menu.checkUpdates, action: () => checkForUpdates({ force: true }) },
        { separator: true },
        { label: copy.menu.openAppFolder, action: () => api.app.openPath(bootstrap.cwd) },
        { label: copy.menu.quit, shortcut: "Alt+F4", action: () => api.app.quit() }
      ]
    },
    {
      label: copy.menu.contacts,
      entries: [
        ...bootstrap.contacts.map((contact) => ({
          label: `${contact.name} (${copy.status[contact.status] ?? contact.status})`,
          action: () => api.openConversation(contact.id)
        })),
        { separator: true },
        { label: copy.menu.addContact, disabled: settings?.demoMode, action: openAgentCreator }
      ]
    },
    {
      label: copy.menu.actions,
      entries: [
        { label: copy.menu.codexToday, action: () => api.openConversation(primaryContactId) },
        { label: copy.menu.refreshList, shortcut: "F5", action: () => setRefreshTick((tick) => tick + 1) },
        { separator: true },
        ...localizedStatusOptions.map(([status, label]) => ({
          label: `${copy.menu.statusPrefix}: ${label}`,
          action: () => saveProfilePatch({ status })
        })),
        { separator: true },
        {
          label: copy.menu.wizzCodex,
          action: async () => {
            await api.openConversation(primaryContactId);
            window.setTimeout(() => api.wizz(primaryContactId), 250);
          }
        }
      ]
    },
    {
      label: copy.menu.tools,
      entries: [
        { label: copy.menu.uploadsFolder, action: () => api.app.openPath(uploadsPath) },
        { label: copy.menu.reloadWindow, shortcut: "Ctrl+R", action: () => api.app.reload() },
        { separator: true },
        { label: copy.menu.minimize, action: () => api.window.minimize() },
        { label: copy.menu.maximize, action: () => api.window.maximize() }
      ]
    },
    {
      label: copy.menu.settings,
      entries: [
        { label: copy.menu.openSettings, action: () => setSettingsDialogOpen(true) },
        { separator: true },
        { label: copy.menu.wizzDelay, action: changeWizzDelay },
        {
          label: `${copy.menu.notificationsState}: ${settings?.notificationsEnabled === false ? copy.common.disabled : copy.common.enabled}`,
          action: () => saveMessengerSettings({ notificationsEnabled: settings?.notificationsEnabled === false })
        },
        {
          label: `${copy.menu.soundState}: ${settings?.newMessageSoundEnabled === false ? copy.common.disabled : copy.common.enabled}`,
          action: () => saveMessengerSettings({ newMessageSoundEnabled: settings?.newMessageSoundEnabled === false })
        },
        {
          label: `${copy.menu.unreadWizzState}: ${settings?.unreadWizzEnabled === false ? copy.common.disabled : copy.common.enabled}`,
          action: () => saveMessengerSettings({ unreadWizzEnabled: settings?.unreadWizzEnabled === false })
        }
      ]
    },
    {
      label: copy.menu.help,
      entries: [
        {
          label: copy.menu.about,
          action: () => setUpdateDialogOpen(true)
        },
        { label: copy.menu.checkUpdates, action: () => checkForUpdates({ force: true }) },
        { label: copy.menu.server, action: () => window.alert(userAgent || copy.roster.localConnected) }
      ]
    }
  ];

  return (
    <main className="msn-window">
      <Titlebar title="Codex Messenger" />
      <Menu items={mainMenus} />
      <ResizeGrip />
      {promptDialog}
      {hasAvailableUpdates(updateState) ? (
        <button className="top-update-button" type="button" onClick={() => setUpdateDialogOpen(true)}>Update</button>
      ) : null}
      {settingsDialogOpen ? (
        <SettingsDialog
          settings={settings}
          copy={copy}
          onSave={saveMessengerSettings}
          onClose={() => setSettingsDialogOpen(false)}
        />
      ) : null}
      {updateDialogOpen ? (
        <UpdateDialog
          updateState={updateState}
          checking={checkingUpdates}
          installingTarget={installingUpdateTarget}
          actionMessage={updateActionMessage}
          progress={updateProgress}
          appVersion={bootstrap.appVersion}
          userAgent={userAgent}
          copy={copy}
          versionLabel={(value) => versionLabel(value, copy.updates?.unknown)}
          updateLineState={(item) => updateLineState(item, copy)}
          onCheck={() => checkForUpdates({ force: true })}
          onOpen={openUpdateTarget}
          onInstall={installUpdateTarget}
          onRestart={restartForUpdate}
          onClose={() => setUpdateDialogOpen(false)}
        />
      ) : null}
      {userAgent ? (
        <RosterView
          api={api}
          bootstrap={bootstrap}
          profile={profile}
          userAgent={userAgent}
          refreshTick={refreshTick}
          profileEditorOpen={profileEditorOpen}
          agentEditorOpen={agentEditorOpen}
          AvatarComponent={Avatar}
          ProfileEditorComponent={ProfileEditor}
          AgentCreatorComponent={AgentCreator}
          playNewMessage={playNewMessage}
          onProfileEditorOpenChange={setProfileEditorOpen}
          onAgentEditorOpenChange={setAgentEditorOpen}
          onAgentsChange={updateAgents}
          copy={copy}
          onProfileChange={(nextProfile, nextUserAgent, nextSettings) => {
            setProfile(nextProfile);
            setUserAgent(nextUserAgent);
            if (nextSettings) setSettings(nextSettings);
          }}
        />
      ) : (
        <LoginView initialProfile={profile} initialSettings={settings} initialCodexStatus={codexStatus} onSignedIn={(nextProfile, nextUserAgent, nextSettings, nextCodexStatus) => {
          setProfile(nextProfile);
          setUserAgent(nextUserAgent);
          setSettings(nextSettings);
          setCodexStatus(nextCodexStatus);
        }} />
      )}
    </main>
  );
}

function ChatWindow({ bootstrap }) {
  const initialContact = bootstrap.contact ?? bootstrap.contacts.find((item) => item.id === bootstrap.contactId) ?? bootstrap.contacts[0];
  const [activeContact, setActiveContact] = useState(initialContact);
  const contact = activeContact ?? initialContact;
  const conversationAgentName = contact.kind === "project" || contact.kind === "thread" ? "Codex" : contact.name;
  const [profile, setProfile] = useState(bootstrap.profile);
  const [messages, setMessages] = useState(bootstrap.historyMessages ?? []);
  const [historyCursor, setHistoryCursor] = useState(bootstrap.historyCursor ?? (bootstrap.historyMessages?.length ?? 0));
  const [historyHasMore, setHistoryHasMore] = useState(Boolean(bootstrap.historyHasMore));
  const [loadingPreviousMessages, setLoadingPreviousMessages] = useState(false);
  const [transcriptRenderLimit, setTranscriptRenderLimit] = useState(transcriptInitialRenderLimit);
  const [draft, setDraft] = useState("");
  const [promptHistory, setPromptHistory] = useState([]);
  const [historySearchOpen, setHistorySearchOpen] = useState(false);
  const [historySearchQuery, setHistorySearchQuery] = useState("");
  const [draftAttachments, setDraftAttachments] = useState([]);
  const [typing, setTyping] = useState(false);
  const [conversations, setConversations] = useState(bootstrap.conversations);
  const [threadsLoading, setThreadsLoading] = useState(() => isCodexHistoryContact(contact) && !bootstrap.conversations);
  const [threadsLoadError, setThreadsLoadError] = useState("");
  const [chatSettings, setChatSettings] = useState(bootstrap.settings ?? {});
  const [codexModels, setCodexModels] = useState([]);
  const [conversationZoom, setConversationZoom] = useState(1);
  const [textStyle, setTextStyle] = useState(() => textStyleForContact(bootstrap.settings, contact.id));
  const [openFlyout, setOpenFlyout] = useState("");
  const [flyoutPosition, setFlyoutPosition] = useState({ left: 8, top: 88, arrowX: 24, placement: "below" });
  const [activeGame, setActiveGame] = useState("morpion");
  const [cameraStream, setCameraStream] = useState(null);
  const [recording, setRecording] = useState(false);
  const [mediaError, setMediaError] = useState("");
  const [activeThreadId, setActiveThreadId] = useState(contact.threadId ?? "");
  const [activeWinkAnimation, setActiveWinkAnimation] = useState(null);
  const [approvalRequests, setApprovalRequests] = useState(bootstrap.approvalRequests ?? []);
  const [askPrompt, promptDialog] = usePromptDialog();
  const {
    updateDialogOpen,
    setUpdateDialogOpen,
    updateState,
    checkingUpdates,
    installingUpdateTarget,
    updateActionMessage,
    updateProgress,
    checkForUpdates,
    installUpdateTarget,
    restartForUpdate
  } = useUpdates({
    api,
    appVersion: bootstrap.appVersion,
    userAgent: bootstrap.userAgent ?? "",
    initialCheck: true
  });
  const copy = appCopyFor(chatSettings?.language ?? profile.language);
  const localizedStatusOptions = statusOptionsFor(copy);
  useEffect(() => {
    applyLanguageDirection(chatSettings?.language ?? profile.language);
  }, [chatSettings?.language, profile.language]);
  const scrollRef = useRef(null);
  const stickToBottomRef = useRef(true);
  const previousMessagesScrollRef = useRef(null);
  const loadingPreviousMessagesRef = useRef(false);
  const deltaQueueRef = useRef([]);
  const deltaFlushTimerRef = useRef(null);
  const deltaFirstQueuedAtRef = useRef(0);
  const playedStreamingSoundRef = useRef(false);
  const videoRef = useRef(null);
  const textareaRef = useRef(null);
  const recorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const flyoutRef = useRef(null);
  const chatWindowRef = useRef(null);
  const winkAnimationTimerRef = useRef(null);
  const selfContact = {
    id: "self",
    name: profile.displayName,
    status: profile.status,
    displayPicturePath: profile.displayPicturePath,
    displayPictureAsset: profile.displayPictureAsset,
    personalMessage: profile.personalMessage,
    color: "#6e8799",
    avatar: "butterfly"
  };
  const currentProject = useMemo(() => {
    const projects = conversations?.projects ?? [];
    if (contact.cwd) return projects.find((project) => project.cwd === contact.cwd) ?? null;
    return null;
  }, [contact.cwd, conversations]);
  const currentThread = useMemo(() => {
    if (!activeThreadId || !currentProject) return null;
    return [...(currentProject.threads ?? []), ...(currentProject.hiddenThreads ?? [])].find((thread) => thread.id === activeThreadId) ?? null;
  }, [activeThreadId, currentProject]);
  const sessionContactId = activeThreadId ? `thread:${activeThreadId}` : contact.id;
  const displayContact = {
    ...contact,
    id: sessionContactId,
    name: activeThreadId ? (currentThread?.preview || contact.name) : contact.name,
    status: contactStatusFor(chatSettings, sessionContactId, contact.status ?? "online")
  };
  const codexOptions = useMemo(
    () => normalizeCodexOptions(chatSettings?.codexOptionsByContact?.[contact.id] ?? defaultCodexOptions),
    [chatSettings?.codexOptionsByContact, contact.id]
  );
  const modelMenuOptions = useMemo(
    () => codexModelMenuOptions(codexModels, codexOptions.model),
    [codexModels, codexOptions.model]
  );
  const reasoningMenuOptions = useMemo(
    () => codexReasoningMenuOptions(codexModels, codexOptions.model, codexOptions.reasoningEffort),
    [codexModels, codexOptions.model, codexOptions.reasoningEffort]
  );
  const codexOptionsSummary = useMemo(() => (
    [
      optionLabel(modelMenuOptions, codexOptions.model),
      optionLabel(reasoningMenuOptions, codexOptions.reasoningEffort),
      optionLabel(codexCwdOptions, codexOptions.cwdMode),
      optionLabel(codexSandboxOptions, codexOptions.sandbox)
    ].join(" / ")
  ), [codexOptions, modelMenuOptions, reasoningMenuOptions]);
  const pendingApprovals = useMemo(
    () => approvalRequests.filter((request) => request.contactId === contact.id),
    [approvalRequests, contact.id]
  );
  const primaryApproval = pendingApprovals[0] ?? null;
  const approvalMenuTarget = primaryApproval?.kind === "file" ? "modification" : "commande";
  const hiddenRenderedMessages = Math.max(0, messages.length - transcriptRenderLimit);
  const visibleMessages = useMemo(
    () => messages.slice(Math.max(0, messages.length - transcriptRenderLimit)),
    [messages, transcriptRenderLimit]
  );
  const promptHistoryKey = `codexMessenger.promptHistory.${contact.id}`;
  const draftStorageKey = `codexMessenger.draft.${contact.id}`;
  const filteredPromptHistory = useMemo(() => {
    const search = historySearchQuery.trim().toLowerCase();
    return promptHistory.filter((entry) => !search || entry.toLowerCase().includes(search)).slice(0, 8);
  }, [historySearchQuery, promptHistory]);
  const slashMatches = useMemo(() => {
    const clean = draft.trim().toLowerCase();
    if (!clean.startsWith("/")) return [];
    return slashCommandCatalog.filter((command) => command.label.startsWith(clean)).slice(0, 6);
  }, [draft]);

  useEffect(() => {
    setActiveContact(initialContact);
  }, [initialContact.id, initialContact.threadId]);

  useEffect(() => {
    setActiveThreadId(contact.threadId ?? "");
    setTranscriptRenderLimit(transcriptInitialRenderLimit);
    deltaQueueRef.current = [];
    deltaFirstQueuedAtRef.current = 0;
    playedStreamingSoundRef.current = false;
    if (deltaFlushTimerRef.current) {
      window.clearTimeout(deltaFlushTimerRef.current);
      deltaFlushTimerRef.current = null;
    }
  }, [contact.id, contact.threadId]);

  useEffect(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem(promptHistoryKey) || "[]");
      setPromptHistory(Array.isArray(stored) ? stored.filter(Boolean).slice(0, 80) : []);
    } catch {
      setPromptHistory([]);
    }
    setHistorySearchOpen(false);
    setHistorySearchQuery("");
    setDraft(window.localStorage.getItem(draftStorageKey) || "");
  }, [draftStorageKey, promptHistoryKey]);

  useEffect(() => {
    try {
      window.localStorage.setItem(draftStorageKey, draft);
    } catch {
      // Draft recovery is best effort.
    }
  }, [draft, draftStorageKey]);

  useEffect(() => {
    setProfile(bootstrap.profile);
  }, [bootstrap.profile]);

  useEffect(() => {
    const projectName = contact.cwd ? (currentProject?.name ?? contact.name) : "";
    document.title = contact.kind === "project"
      ? `${displayContact.name} - Codex Messenger`
      : contact.kind === "thread"
        ? `${displayContact.name} - ${projectName || "Codex"}`
        : `${displayContact.name} - Conversation`;
  }, [contact.kind, contact.cwd, currentProject?.name, displayContact.name]);

  useEffect(() => {
    const markRead = () => {
      if (document.visibilityState !== "hidden" && document.hasFocus()) api.markRead(contact.id);
    };
    window.addEventListener("focus", markRead);
    document.addEventListener("visibilitychange", markRead);
    if (document.hasFocus()) markRead();
    return () => {
      window.removeEventListener("focus", markRead);
      document.removeEventListener("visibilitychange", markRead);
    };
  }, [contact.id]);

  useEffect(() => {
    let alive = true;
    const showThreadLoader = isCodexHistoryContact(contact);
    if (showThreadLoader) {
      setThreadsLoading(true);
      setThreadsLoadError("");
    }
    api.listConversations()
      .then((nextConversations) => {
        if (alive) setConversations(nextConversations);
      })
      .catch((error) => {
        if (alive && showThreadLoader) setThreadsLoadError(error.message || "Fils indisponibles");
      })
      .finally(() => {
        if (alive && showThreadLoader) setThreadsLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [contact.id, contact.kind, contact.cwd]);

  useEffect(() => {
    let alive = true;
    api.listCodexModels()
      .then((result) => {
        if (alive) setCodexModels(Array.isArray(result?.models) ? result.models : []);
      })
      .catch(() => {
        if (alive) setCodexModels([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    setChatSettings(bootstrap.settings ?? {});
    setTextStyle(textStyleForContact(bootstrap.settings, contact.id));
  }, [bootstrap.settings, contact.id]);

  useEffect(() => {
    if (videoRef.current && cameraStream) videoRef.current.srcObject = cameraStream;
  }, [cameraStream, openFlyout]);

  useEffect(() => () => {
    cameraStream?.getTracks().forEach((track) => track.stop());
    recorderRef.current?.stream?.getTracks?.().forEach((track) => track.stop());
  }, [cameraStream]);

  useEffect(() => () => {
    if (winkAnimationTimerRef.current) window.clearTimeout(winkAnimationTimerRef.current);
    if (deltaFlushTimerRef.current) window.clearTimeout(deltaFlushTimerRef.current);
  }, []);

  useEffect(() => {
    const close = (event) => {
      if (!flyoutRef.current?.contains(event.target)) setOpenFlyout("");
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setOpenFlyout("");
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  function flushAgentDeltas() {
    if (deltaFlushTimerRef.current) {
      window.clearTimeout(deltaFlushTimerRef.current);
      deltaFlushTimerRef.current = null;
    }
    const delta = deltaQueueRef.current.join("");
    deltaQueueRef.current = [];
    deltaFirstQueuedAtRef.current = 0;
    if (!delta) return;
    setTyping(false);
    setMessages((current) => {
      const notice = codexConnectionNotice(delta);
      if (notice) return appendSystemNotice(current, notice);
      if (!current[current.length - 1]?.streaming && !playedStreamingSoundRef.current) {
        playedStreamingSoundRef.current = true;
        playNewMessageIfEnabled();
      }
      return appendAgentDelta(current, conversationAgentName, delta);
    });
  }

  function queueAgentDelta(delta) {
    const cleanDelta = String(delta ?? "");
    if (!cleanDelta) return;
    const notice = codexConnectionNotice(cleanDelta);
    if (notice) {
      flushAgentDeltas();
      setTyping(false);
      setMessages((current) => appendSystemNotice(current, notice));
      return;
    }
    if (!deltaQueueRef.current.length) deltaFirstQueuedAtRef.current = Date.now();
    deltaQueueRef.current.push(cleanDelta);
    const queuedChars = deltaQueueRef.current.reduce((total, item) => total + item.length, 0);
    const queuedAge = Date.now() - deltaFirstQueuedAtRef.current;
    const shouldCatchUp = deltaQueueRef.current.length >= 8 || queuedChars >= 2200 || queuedAge >= 120;
    if (shouldCatchUp) {
      flushAgentDeltas();
      return;
    }
    if (!deltaFlushTimerRef.current) {
      deltaFlushTimerRef.current = window.setTimeout(flushAgentDeltas, 16);
    }
  }

  useCodexEvents({
    api,
    contact,
    conversationAgentName,
    deltaFlushTimerRef,
    deltaQueueRef,
    deltaFirstQueuedAtRef,
    playedStreamingSoundRef,
    queueAgentDelta,
    flushAgentDeltas,
    codexConnectionNotice,
    appendSystemNotice,
    finishAgentMessage,
    extractWinkFromText,
    isCodexHistoryContact,
    playWink,
    playWizz,
    triggerWinkAnimation,
    playNewMessageIfEnabled,
    setMessages,
    setTyping,
    setThreadsLoading,
    setThreadsLoadError,
    setConversations,
    setCodexModels,
    setApprovalRequests
  });

  useEffect(() => {
    const element = scrollRef.current;
    if (previousMessagesScrollRef.current && element) {
      const previous = previousMessagesScrollRef.current;
      previousMessagesScrollRef.current = null;
      element.scrollTop = element.scrollHeight - previous.scrollHeight + previous.scrollTop;
      return;
    }
    if (!element || !stickToBottomRef.current) return;
    element.scrollTo({ top: element.scrollHeight, behavior: "auto" });
  }, [messages, typing]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return undefined;
    const updateStickiness = () => {
      const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
      stickToBottomRef.current = distanceFromBottom < 48;
      if (element.scrollTop < 24 && element.scrollHeight > element.clientHeight + 24) {
        if (hiddenRenderedMessages > 0) {
          previousMessagesScrollRef.current = { scrollHeight: element.scrollHeight, scrollTop: element.scrollTop };
          setTranscriptRenderLimit((current) => Math.min(messages.length, current + transcriptRenderStep));
        } else {
          loadPreviousMessages();
        }
      }
    };
    element.addEventListener("scroll", updateStickiness, { passive: true });
    updateStickiness();
    return () => element.removeEventListener("scroll", updateStickiness);
  }, [activeThreadId, contact.id, historyCursor, historyHasMore, hiddenRenderedMessages, loadingPreviousMessages, messages.length]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (!event.ctrlKey || event.altKey || event.metaKey) return;
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        zoomConversationIn();
      } else if (event.key === "-") {
        event.preventDefault();
        zoomConversationOut();
      } else if (event.key === "0") {
        event.preventDefault();
        resetConversationZoom();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [conversationZoom]);

  async function loadPreviousMessages() {
    if (!activeThreadId || !historyHasMore || loadingPreviousMessagesRef.current) return;
    const element = scrollRef.current;
    previousMessagesScrollRef.current = element
      ? { scrollHeight: element.scrollHeight, scrollTop: element.scrollTop }
      : null;
    loadingPreviousMessagesRef.current = true;
    setLoadingPreviousMessages(true);
    try {
      const result = await api.loadPreviousMessages({
        contactId: contact.id,
        threadId: activeThreadId,
        cursor: historyCursor,
        limit: 10
      });
      if (result?.messages?.length) {
        stickToBottomRef.current = false;
        setTranscriptRenderLimit((current) => current + result.messages.length);
        setMessages((current) => [...result.messages, ...current]);
      } else {
        previousMessagesScrollRef.current = null;
      }
      setHistoryCursor(result?.historyCursor ?? historyCursor);
      setHistoryHasMore(Boolean(result?.historyHasMore));
    } catch (error) {
      previousMessagesScrollRef.current = null;
      setMessages((current) => [...current, makeMessage("system", "system", error.message)]);
      setHistoryHasMore(false);
    } finally {
      loadingPreviousMessagesRef.current = false;
      setLoadingPreviousMessages(false);
    }
  }

  async function sendItems(items, displayText, options = {}) {
    const cleanText = String(displayText ?? "").trim();
    if (!items.length || !cleanText) return;
    stickToBottomRef.current = true;
    setMessages((current) => appendOutgoingMessage(current, profile.displayName, cleanText, options));
    setTyping(true);
    api.markRead(contact.id);
    try {
      const result = await api.sendItems(contact.id, items);
      if (result?.threadId) {
        setActiveThreadId(result.threadId);
        if (!activeThreadId) {
          setHistoryCursor(messages.length + 1);
          setHistoryHasMore(false);
        }
      }
      if (result?.conversations) setConversations(result.conversations);
    } catch (error) {
      setTyping(false);
      setMessages((current) => [...current, makeMessage("system", "system", error.message)]);
    }
  }

  function submit(event) {
    event.preventDefault();
    const clean = draft.trim();
    if (!clean) return;
    const slash = slashCommandCatalog.find((command) => command.label === clean.split(/\s+/)[0].toLowerCase());
    if (slash) {
      runSlashCommand(slash.id);
      setDraft("");
      return;
    }
    rememberPrompt(clean);
    const attachments = draftAttachments;
    const itemAttachments = attachments.map((attachment) => ({ type: "localImage", path: attachment.path }));
    sendItems(
      [{ type: "text", text: clean }, ...itemAttachments],
      clean,
      attachments[0] ? { attachment: { type: "image", src: attachments[0].src, name: attachments[0].name } } : {}
    );
    setDraft("");
    setDraftAttachments([]);
  }

  function rememberPrompt(text) {
    const clean = String(text || "").trim();
    if (!clean) return;
    setPromptHistory((current) => {
      const next = [clean, ...current.filter((entry) => entry !== clean)].slice(0, 80);
      try {
        window.localStorage.setItem(promptHistoryKey, JSON.stringify(next));
      } catch {
        // Prompt history is a convenience only.
      }
      return next;
    });
  }

  function useHistoryEntry(text) {
    setDraft(text);
    setHistorySearchOpen(false);
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(text.length, text.length);
    });
  }

  async function interruptCurrentTurn() {
    if (!activeThreadId) return;
    const result = await api.interruptTurn({ contactId: contact.id, threadId: activeThreadId });
    if (!result?.ok) {
      setMessages((current) => [...current, makeMessage("system", "system", result?.error || "Interruption impossible.")]);
    }
  }

  async function runSlashCommand(commandId) {
    setHistorySearchOpen(false);
    if (commandId === "status" || commandId === "model") {
      setMessages((current) => [...current, makeMessage("system", "system", `Codex: ${codexOptionsSummary}`)]);
      return;
    }
    if (commandId === "new") {
      if (contact.cwd) await openProjectTab(contact.cwd);
      return;
    }
    if (commandId === "review") {
      const result = await api.reviewThread({ contactId: contact.id, threadId: activeThreadId });
      if (result?.ok) {
        setActiveThreadId(result.threadId ?? activeThreadId);
        setTyping(true);
      } else {
        setMessages((current) => [...current, makeMessage("system", "system", result?.error || "Review impossible.")]);
      }
      return;
    }
    if (commandId === "compact") {
      const result = await api.compactThread({ contactId: contact.id, threadId: activeThreadId });
      if (result?.ok) {
        setActiveThreadId(result.threadId ?? activeThreadId);
        setTyping(true);
      } else {
        setMessages((current) => [...current, makeMessage("system", "system", result?.error || "Compact impossible.")]);
      }
      return;
    }
    if (commandId === "fork") {
      if (!activeThreadId) {
        setMessages((current) => [...current, makeMessage("system", "system", "Aucun fil a dupliquer.")]);
        return;
      }
      const result = await api.forkThread({ contactId: contact.id, threadId: activeThreadId });
      if (result?.threadId) {
        if (result.conversations) setConversations(result.conversations);
        await openThreadTab(result.threadId);
      } else {
        setMessages((current) => [...current, makeMessage("system", "system", result?.error || "Duplication impossible.")]);
      }
    }
  }

  function handleComposerKeyDown(event) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "r") {
      event.preventDefault();
      setHistorySearchOpen(true);
      setHistorySearchQuery("");
      return;
    }
    if (event.key === "Escape" && historySearchOpen) {
      event.preventDefault();
      setHistorySearchOpen(false);
      return;
    }
    if (event.key === "ArrowUp" && !draft && promptHistory[0]) {
      event.preventDefault();
      useHistoryEntry(promptHistory[0]);
      return;
    }
    if (event.key === "Tab" && slashMatches[0]) {
      event.preventDefault();
      setDraft(slashMatches[0].label);
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) submit(event);
  }

  async function handleComposerPaste(event) {
    const files = Array.from(event.clipboardData?.files ?? []).filter((file) => file.type.startsWith("image/"));
    if (!files.length) return;
    event.preventDefault();
    const savedAttachments = [];
    for (const file of files.slice(0, 4)) {
      const dataUrl = await blobToDataUrl(file);
      const saved = await api.saveDataUrl({ dataUrl, name: file.name || "clipboard-image.png" });
      if (saved?.ok) {
        savedAttachments.push({
          path: saved.path,
          name: saved.name || file.name || "clipboard-image.png",
          src: localFileUrl(saved.path)
        });
      }
    }
    if (!savedAttachments.length) return;
    const start = draftAttachments.length + 1;
    const labels = savedAttachments.map((_, index) => `[Image #${start + index}]`).join(" ");
    setDraftAttachments((current) => [...current, ...savedAttachments].slice(0, 8));
    setDraft((value) => `${value}${value && !value.endsWith(" ") ? " " : ""}${labels} `);
  }

  function replaceDraft(start, end, replacement, cursorStart = start + replacement.length, cursorEnd = cursorStart) {
    const next = `${draft.slice(0, start)}${replacement}${draft.slice(end)}`;
    setDraft(next);
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(cursorStart, cursorEnd);
    });
  }

  function insertDraft(text) {
    const element = textareaRef.current;
    const start = element?.selectionStart ?? draft.length;
    const end = element?.selectionEnd ?? draft.length;
    replaceDraft(start, end, text);
  }

  function wrapDraft(prefix, suffix = prefix) {
    const element = textareaRef.current;
    const start = element?.selectionStart ?? draft.length;
    const end = element?.selectionEnd ?? draft.length;
    const selected = draft.slice(start, end);
    const replacement = `${prefix}${selected}${suffix}`;
    const cursorStart = selected ? start : start + prefix.length;
    const cursorEnd = selected ? start + replacement.length : cursorStart;
    replaceDraft(start, end, replacement, cursorStart, cursorEnd);
  }

  async function copyDraft(cut = false) {
    const element = textareaRef.current;
    const start = element?.selectionStart ?? 0;
    const end = element?.selectionEnd ?? 0;
    const selected = start === end ? draft : draft.slice(start, end);
    if (!selected) return;
    await navigator.clipboard.writeText(selected);
    if (cut && start !== end) replaceDraft(start, end, "", start);
  }

  async function pasteDraft() {
    const text = await navigator.clipboard.readText();
    if (text) insertDraft(text);
  }

  function selectAllDraft() {
    textareaRef.current?.focus();
    textareaRef.current?.select();
  }

  async function setConversationZoomFactor(nextZoom) {
    const zoomFactor = normalizeConversationZoom(nextZoom);
    const result = await api.window.setZoomFactor(zoomFactor);
    setConversationZoom(normalizeConversationZoom(result?.zoomFactor ?? zoomFactor));
  }

  function zoomConversationIn() {
    return setConversationZoomFactor(conversationZoom + 0.1);
  }

  function zoomConversationOut() {
    return setConversationZoomFactor(conversationZoom - 0.1);
  }

  function resetConversationZoom() {
    return setConversationZoomFactor(1);
  }

  function flyoutSize(name) {
    const root = chatWindowRef.current?.getBoundingClientRect();
    const rootWidth = root?.width ?? window.innerWidth;
    const rootHeight = root?.height ?? window.innerHeight;
    const availableWidth = Math.max(230, rootWidth - 18);
    const availableHeight = Math.max(146, rootHeight - 118);
    if (name === "emoticons") {
      return {
        width: Math.min(560, Math.max(344, availableWidth - 16)),
        height: Math.min(520, Math.max(278, availableHeight))
      };
    }
    if (name === "text") return { width: 284, height: 318 };
    if (name === "activities") return { width: Math.min(438, availableWidth), height: Math.min(520, Math.max(390, availableHeight)) };
    if (name === "games") return { width: Math.min(430, availableWidth), height: Math.min(510, Math.max(386, availableHeight)) };
    if (name === "camera") return { width: 250, height: 240 };
    if (name === "files") return { width: 254, height: 136 };
    if (name === "voice") return { width: 246, height: 112 };
    return { width: 246, height: 146 };
  }

  function flyoutSpace(targetTop, targetBottom, rootHeight) {
    const margin = 8;
    return {
      above: Math.max(96, targetTop - margin),
      below: Math.max(96, rootHeight - targetBottom - margin)
    };
  }

  function placeFlyout(name, event) {
    const root = chatWindowRef.current?.getBoundingClientRect();
    const target = event?.currentTarget?.getBoundingClientRect?.();
    const desired = flyoutSize(name);
    const { width } = desired;
    const rootWidth = root?.width ?? window.innerWidth;
    const rootHeight = root?.height ?? window.innerHeight;
    const center = target
      ? target.left + target.width / 2 - (root?.left ?? 0)
      : Math.min(rootWidth - 24, Math.max(24, rootWidth / 2));
    const rawLeft = Math.round(center - width / 2);
    const left = Math.max(8, Math.min(rawLeft, rootWidth - width - 8));
    const targetTop = target ? target.top - (root?.top ?? 0) : 82;
    const targetBottom = target ? target.bottom - (root?.top ?? 0) : 118;
    const space = flyoutSpace(targetTop, targetBottom, rootHeight);
    const belowFits = space.below >= Math.min(desired.height, 220);
    const aboveFits = space.above >= Math.min(desired.height, 220);
    const placement = belowFits || (!aboveFits && space.below >= space.above) ? "below" : "above";
    const height = Math.min(desired.height, placement === "above" ? space.above : space.below);
    const top = placement === "above"
      ? targetTop - height - 4
      : targetBottom - 1;
    setFlyoutPosition({
      left,
      top: Math.max(8, top),
      arrowX: Math.max(12, Math.min(width - 12, center - left)),
      placement,
      width,
      maxHeight: height
    });
  }

  function openPanel(name, event) {
    placeFlyout(name, event);
    setOpenFlyout(name);
  }

  function toggleFlyout(name, event) {
    if (openFlyout === name) {
      setOpenFlyout("");
      return;
    }
    openPanel(name, event);
  }

  async function handleSearch() {
    const query = await askPrompt({ title: copy.menu.searchTranscript, initialValue: "", cancelLabel: copy.common.cancel });
    const clean = String(query ?? "").trim();
    if (!clean) return;
    const match = [...messages].reverse().find((message) => message.text?.toLowerCase().includes(clean.toLowerCase()));
    const result = match
      ? `Recherche "${clean}": trouve dans un message de ${match.author}.`
      : `Recherche "${clean}": aucun resultat.`;
    setMessages((current) => [...current, makeMessage("system", "system", result)]);
  }

  async function saveConversationTextStyle(nextStyle) {
    const cleanStyle = normalizeTextStyle(nextStyle);
    const nextTextStyles = { ...(chatSettings?.textStyles ?? {}), [contact.id]: cleanStyle };
    setTextStyle(cleanStyle);
    setChatSettings((current) => ({ ...(current ?? {}), textStyles: nextTextStyles }));
    try {
      const result = await api.setSettings({ textStyles: nextTextStyles });
      setChatSettings(result.settings);
      setTextStyle(textStyleForContact(result.settings, contact.id));
    } catch (error) {
      setMessages((current) => [...current, makeMessage("system", "system", `Rendu texte non sauvegarde: ${error.message}`)]);
    }
  }

  async function resetConversationTextStyle() {
    const nextTextStyles = { ...(chatSettings?.textStyles ?? {}) };
    delete nextTextStyles[contact.id];
    setTextStyle(defaultTextStyle);
    setChatSettings((current) => ({ ...(current ?? {}), textStyles: nextTextStyles }));
    try {
      const result = await api.setSettings({ textStyles: nextTextStyles });
      setChatSettings(result.settings);
      setTextStyle(textStyleForContact(result.settings, contact.id));
    } catch (error) {
      setMessages((current) => [...current, makeMessage("system", "system", `Rendu texte non sauvegarde: ${error.message}`)]);
    }
  }

  async function changeConversationFontSize() {
    const value = await askPrompt({
      title: copy.menu.textSize,
      initialValue: String(textStyle.fontSize),
      inputType: "number",
      cancelLabel: copy.common.cancel
    });
    if (value === null) return;
    saveConversationTextStyle({ ...textStyle, fontSize: value });
  }

  async function handleSendFile() {
    const file = await api.pickFile({ title: "Send Files" });
    if (file?.canceled) return;
    const text = file.isImage
      ? `Image envoyee a Codex:\n${file.path}`
      : `Fichier envoye a Codex:\n${file.path}`;
    const items = [{ type: "text", text }];
    if (file.isImage) items.push({ type: "localImage", path: file.path });
    sendItems(items, text, file.isImage ? { attachment: { type: "image", src: localFileUrl(file.path), name: file.name } } : { attachment: { type: "file", name: file.name } });
  }

  async function startCamera(event) {
    openPanel("camera", event);
    setMediaError("");
    if (cameraStream) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      setCameraStream(stream);
    } catch (error) {
      setMediaError(error.message);
    }
  }

  function stopCamera() {
    cameraStream?.getTracks().forEach((track) => track.stop());
    setCameraStream(null);
  }

  async function sendCameraSnapshot() {
    if (!videoRef.current) return;
    const canvas = document.createElement("canvas");
    canvas.width = videoRef.current.videoWidth || 640;
    canvas.height = videoRef.current.videoHeight || 480;
    canvas.getContext("2d").drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/png");
    const saved = await api.saveDataUrl({ dataUrl, name: "camera-capture.png" });
    if (!saved.ok) {
      setMediaError(saved.error ?? "Capture impossible");
      return;
    }
    const text = `Capture webcam envoyee a Codex:\n${saved.path}`;
    sendItems([{ type: "text", text }, { type: "localImage", path: saved.path }], text, { attachment: { type: "image", src: localFileUrl(saved.path), name: saved.name } });
  }

  async function toggleVoiceClip() {
    setMediaError("");
    if (recording && recorderRef.current) {
      recorderRef.current.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) audioChunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        setRecording(false);
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || "audio/webm" });
        const dataUrl = await blobToDataUrl(blob);
        const saved = await api.saveDataUrl({ dataUrl, name: "voice-clip.webm" });
        if (!saved.ok) {
          setMediaError(saved.error ?? "Enregistrement impossible");
          return;
        }
        const text = `Message vocal enregistre pour Codex:\n${saved.path}\n\nTranscris ou analyse ce message vocal si le runtime le permet, sinon utilise ce chemin comme piece jointe.`;
        sendItems([{ type: "text", text }], text, { attachment: { type: "audio", src: localFileUrl(saved.path), name: saved.name } });
      };
      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch (error) {
      setMediaError(error.message);
    }
  }

  function sendQuickPrompt(prompt) {
    sendItems([{ type: "text", text: prompt }], prompt);
  }

  function playNewMessageIfEnabled() {
    api.getSettings()
      .then((result) => {
        if (result?.settings) setChatSettings(result.settings);
        if (result?.settings?.newMessageSoundEnabled !== false) playNewMessage();
      })
      .catch(() => {
        if (chatSettings?.newMessageSoundEnabled !== false) playNewMessage();
      });
  }

  function triggerWinkAnimation(wink, direction = "incoming") {
    if (!wink) return;
    if (winkAnimationTimerRef.current) window.clearTimeout(winkAnimationTimerRef.current);
    const nextAnimation = {
      key: `${wink.id}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      wink,
      direction
    };
    setActiveWinkAnimation(null);
    window.requestAnimationFrame(() => setActiveWinkAnimation(nextAnimation));
    winkAnimationTimerRef.current = window.setTimeout(() => {
      setActiveWinkAnimation((current) => current?.key === nextAnimation.key ? null : current);
      winkAnimationTimerRef.current = null;
    }, 4200);
  }

  function sendWink(wink) {
    playWink(wink);
    triggerWinkAnimation(wink, "outgoing");
    setOpenFlyout("");
    const text = `Clin d'oeil envoye: ${wink.label}`;
    sendItems(
      [{ type: "text", text: `[wink:${wink.id}] ${text}` }],
      text,
      { wink }
    );
  }

  function askCodexWink(wink) {
    setOpenFlyout("");
    const prompt = `Envoie-moi un clin d'oeil ${wink.label}. Utilise exactement le marqueur [wink:${wink.id}] dans ta reponse.`;
    sendQuickPrompt(prompt);
  }

  async function saveTranscript() {
    const safeName = contact.name.replace(/[^a-zA-Z0-9._-]+/g, "-").toLowerCase() || "conversation";
    const text = messages
      .map((message) => `[${message.time}] ${message.author}: ${message.text}`)
      .join("\r\n\r\n");
    const result = await api.saveText({
      title: "Save Conversation",
      defaultPath: `${safeName}-codex-messenger.txt`,
      text
    });
    if (!result?.canceled) {
      setMessages((current) => [...current, makeMessage("system", "system", `Conversation sauvegardee: ${result.path}`)]);
    }
  }

  async function openThreadTab(threadId) {
    if (!threadId || threadId === activeThreadId) return;
    const previousThreadId = activeThreadId;
    setActiveThreadId(threadId);
    if (currentProject) {
      let result = null;
      try {
        result = await api.loadThread({ contactId: contact.id, threadId });
      } catch (error) {
        reportRendererError("conversation.loadThread.error", error, { contactId: contact.id, threadId });
        setActiveThreadId(previousThreadId);
        setMessages((current) => [...current, makeMessage("system", "system", `Impossible de charger ce fil: ${errorMessage(error)}`)]);
        return;
      }
      if (result?.ok === false) {
        const message = result.error || "Fil indisponible";
        reportRendererError("conversation.loadThread.rejected", new Error(message), { contactId: contact.id, threadId });
        setActiveThreadId(previousThreadId);
        setMessages((current) => [...current, makeMessage("system", "system", `Impossible de charger ce fil: ${message}`)]);
        return;
      }
      if (result?.contact) {
        setActiveContact(result.contact);
        setActiveThreadId(result.threadId ?? result.contact.threadId ?? threadId);
        replaceChatContactUrl(result.contactId ?? result.contact.id);
      }
      if (result?.messages) {
        stickToBottomRef.current = true;
        setTranscriptRenderLimit(transcriptInitialRenderLimit);
        setMessages(result.messages);
        setHistoryCursor(result.historyCursor ?? result.messages.length);
        setHistoryHasMore(Boolean(result.historyHasMore));
        setTyping(false);
      }
      if (result?.conversations) setConversations(result.conversations);
      return;
    }
    await api.switchThread(threadId);
  }

  async function openProjectTab(cwd) {
    if (!cwd || (!activeThreadId && contact.cwd === cwd)) return;
    await api.switchProject(cwd);
  }

  async function reorderThreadTabs(threadIds) {
    if (!currentProject) return;
    const result = await api.reorderThreads({ cwd: currentProject.cwd, threadIds });
    if (result?.conversations) setConversations(result.conversations);
  }

  async function deleteThreadTab(thread) {
    if (!thread?.id || !currentProject) return;
    const ok = window.confirm(`Supprimer ce fil de Codex Messenger ?\n\n${thread.preview}`);
    if (!ok) return;
    const result = await api.deleteThread(thread.id);
    const nextConversations = result?.conversations ?? conversations;
    setConversations(nextConversations);
    if (activeThreadId === thread.id) {
      const nextProject = nextConversations?.projects?.find((project) => project.cwd === currentProject.cwd);
      const nextThread = nextProject?.threads?.find((item) => item.id !== thread.id);
      if (nextThread) await openThreadTab(nextThread.id);
      else await api.switchProject(currentProject.cwd);
    }
  }

  function showContactInfo() {
    const lines = [
      displayContact.name,
      contact.email,
      `${copy.menu.statusPrefix}: ${copy.status[displayContact.status] ?? displayContact.status}`,
      contact.kind ? `Type: ${contact.kind}` : "",
      contact.cwd ? `Projet: ${contact.cwd}` : "",
      contact.instructions ? `Instructions: ${contact.instructions}` : ""
    ].filter(Boolean);
    window.alert(lines.join("\n"));
  }

  function showSelfInfo() {
    const lines = [
      profile.displayName || profile.email,
      profile.email,
      `${copy.menu.statusPrefix}: ${copy.status[profile.status] ?? profile.status}`,
      profile.personalMessage ? `Message: ${profile.personalMessage}` : ""
    ].filter(Boolean);
    window.alert(lines.join("\n"));
  }

  async function chooseSelfPicture(options = {}) {
    const result = await api.chooseProfilePicture(options);
    if (result?.canceled) return result;
    if (options?.save === false) return result;
    setProfile(result.profile);
    if (result.settings) setChatSettings(result.settings);
    return result;
  }

  async function clearSelfPicture() {
    const result = await api.clearProfilePicture();
    setProfile(result.profile);
    if (result.settings) setChatSettings(result.settings);
  }

  async function changeSelfStatus(status) {
    const result = await api.setSettings({
      language: profile.language,
      profile: { ...profile, status }
    });
    setProfile(result.settings.profile);
    setChatSettings(result.settings);
  }

  async function promptForStatus(currentStatus) {
    const value = await askPrompt({
      title: `${copy.menu.statusPrefix} (${localizedStatusOptions.map(([, label]) => label).join(", ")})`,
      initialValue: copy.status[currentStatus] ?? currentStatus ?? copy.status.online,
      cancelLabel: copy.common.cancel
    });
    if (value === null) return "";
    const clean = value.trim().toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
    const aliases = {
      online: "online",
      "en ligne": "online",
      busy: "busy",
      occupe: "busy",
      away: "away",
      absent: "away",
      offline: "offline",
      "hors ligne": "offline"
    };
    return aliases[clean] ?? "";
  }

  async function renameCurrentSession() {
    const currentName = displayContact.name || contact.name || "Codex";
    const name = await askPrompt({ title: copy.chat.renameSession, initialValue: currentName, cancelLabel: copy.common.cancel });
    if (name === null) return;
    const cleanName = name.trim();
    if (!cleanName || cleanName === currentName) return;
    const result = await api.renameContact({ contactId: sessionContactId, name: cleanName });
    if (!result?.ok) {
      window.alert(result?.error || copy.chat.renameSession);
      return;
    }
    if (result.settings) setChatSettings(result.settings);
    if (result.conversations) setConversations(result.conversations);
    if (sessionContactId === contact.id) setActiveContact((current) => current ? { ...current, name: cleanName } : current);
  }

  async function changeCurrentSessionStatus(nextStatus = null) {
    const status = nextStatus || await promptForStatus(displayContact.status);
    if (!status || status === displayContact.status) return;
    const result = await api.setContactStatus({ contactId: sessionContactId, status });
    if (!result?.ok) {
      window.alert(result?.error || copy.menu.statusPrefix);
      return;
    }
    if (result.settings) setChatSettings(result.settings);
    if (result.conversations) setConversations(result.conversations);
    if (sessionContactId === contact.id) setActiveContact((current) => current ? { ...current, status } : current);
  }

  async function renameSelfDisplayName() {
    const currentName = profile.displayName || profile.email || "";
    const name = await askPrompt({ title: loginCopyFor(profile.language).displayName, initialValue: currentName, cancelLabel: copy.common.cancel });
    if (name === null) return;
    const cleanName = name.trim();
    if (!cleanName || cleanName === currentName) return;
    const result = await api.setSettings({
      language: profile.language,
      profile: { ...profile, displayName: cleanName }
    });
    setProfile(result.settings.profile);
    setChatSettings(result.settings);
  }

  async function changeSelfStatusFromFrame() {
    const status = await promptForStatus(profile.status);
    if (!status || status === profile.status) return;
    await changeSelfStatus(status);
  }

  async function toggleDemoModeFromChat() {
    await api.setSettings({ demoMode: !(chatSettings?.demoMode === true) });
  }

  async function saveContactCodexOptions(patch) {
    const nextOptions = normalizeCodexOptions({ ...codexOptions, ...patch });
    const nextOptionsByContact = {
      ...(chatSettings?.codexOptionsByContact ?? {}),
      [contact.id]: nextOptions
    };
    setChatSettings((current) => ({ ...(current ?? {}), codexOptionsByContact: nextOptionsByContact }));
    const result = await api.setSettings({ codexOptionsByContact: nextOptionsByContact });
    if (result?.settings) setChatSettings(result.settings);
  }

  async function respondToApproval(request, decision) {
    if (!request?.approvalId) return;
    setApprovalRequests((current) => current.map((item) => (
      item.approvalId === request.approvalId ? { ...item, sendingDecision: decision } : item
    )));
    try {
      const result = await api.respondApproval({ approvalId: request.approvalId, decision });
      if (!result?.ok) throw new Error(result?.error ?? "Autorisation impossible.");
      setApprovalRequests((current) => current.filter((item) => item.approvalId !== request.approvalId));
    } catch (error) {
      setApprovalRequests((current) => current.map((item) => (
        item.approvalId === request.approvalId ? { ...item, sendingDecision: "", error: error.message } : item
      )));
      setMessages((current) => [...current, makeMessage("system", "system", error.message)]);
    }
  }

  const contactFrameMenu = [
    { label: copy.chat.contactInfo, action: showContactInfo },
    { label: copy.chat.renameSession, action: renameCurrentSession },
    contact.cwd ? { label: copy.chat.openProject, action: () => api.app.openPath(contact.cwd) } : null,
    { separator: true },
    ...localizedStatusOptions.map(([status, label]) => ({
      label: `${copy.chat.sessionPrefix}: ${label}`,
      disabled: displayContact.status === status,
      action: () => changeCurrentSessionStatus(status)
    })),
    { separator: true },
    { type: "status", label: `Codex: ${codexOptionsSummary}` },
    {
      type: "select",
      label: copy.chat.model,
      value: codexOptions.model,
      options: modelMenuOptions,
      onChange: (value) => {
        const nextReasoningOptions = codexReasoningMenuOptions(codexModels, value, codexOptions.reasoningEffort);
        const supportsCurrentReasoning = nextReasoningOptions.some((option) => option.value === codexOptions.reasoningEffort);
        saveContactCodexOptions({
          model: value,
          reasoningEffort: supportsCurrentReasoning ? codexOptions.reasoningEffort : ""
        });
      }
    },
    {
      type: "select",
      label: copy.chat.reasoning,
      value: codexOptions.reasoningEffort,
      options: reasoningMenuOptions,
      onChange: (value) => saveContactCodexOptions({ reasoningEffort: value })
    },
    {
      type: "select",
      label: copy.chat.execution,
      value: codexOptions.cwdMode,
      options: codexCwdOptions,
      onChange: (value) => saveContactCodexOptions({ cwdMode: value })
    },
    {
      type: "select",
      label: copy.chat.sandbox,
      value: codexOptions.sandbox,
      options: codexSandboxOptions,
      onChange: (value) => saveContactCodexOptions({ sandbox: value })
    },
    {
      type: "select",
      label: copy.chat.confirmation,
      value: codexOptions.approvalPolicy,
      options: codexApprovalOptions,
      onChange: (value) => saveContactCodexOptions({ approvalPolicy: value })
    },
    { separator: true },
    {
      label: copy.chat.askContext,
      action: () => sendQuickPrompt(`Resume le contexte de cette conversation avec ${contact.name}.`)
    }
  ].filter(Boolean);
  const selfFrameMenu = [
    { label: copy.chat.myProfile, action: showSelfInfo },
    { label: copy.chat.changePicture, action: chooseSelfPicture },
    { label: copy.chat.defaultPicture, action: clearSelfPicture },
    { separator: true },
    ...localizedStatusOptions.map(([status, label]) => ({
      label: `${copy.menu.statusPrefix}: ${label}`,
      disabled: profile.status === status,
      action: () => changeSelfStatus(status)
    }))
  ];

  const chatMenus = [
    {
      label: copy.menu.file,
      entries: [
        { label: copy.menu.sendFiles, action: handleSendFile },
        { label: copy.menu.openProject, action: () => api.openProjectPicker() },
        { label: copy.menu.saveConversation, action: saveTranscript },
        { separator: true },
        { label: copy.menu.about, action: () => setUpdateDialogOpen(true) },
        { label: copy.menu.checkUpdates, action: () => checkForUpdates({ force: true }) },
        { separator: true },
        { label: copy.menu.closeWindow, shortcut: "Alt+F4", action: () => api.window.close() }
      ]
    },
    {
      label: copy.menu.edit,
      entries: [
        { label: copy.menu.undo, shortcut: "Ctrl+Z", action: () => document.execCommand("undo") },
        { separator: true },
        { label: copy.menu.cut, shortcut: "Ctrl+X", action: () => copyDraft(true) },
        { label: copy.menu.copy, shortcut: "Ctrl+C", action: () => copyDraft(false) },
        { label: copy.menu.paste, shortcut: "Ctrl+V", action: pasteDraft },
        { label: copy.menu.selectAll, shortcut: "Ctrl+A", action: selectAllDraft },
        { separator: true },
        { label: copy.menu.clearText, action: () => setDraft("") }
      ]
    },
    {
      label: copy.menu.format,
      entries: [
        { label: copy.menu.textAppearance, action: () => openPanel("text") },
        { label: "Font: Tahoma", action: () => saveConversationTextStyle({ ...textStyle, fontFamily: "Tahoma" }) },
        { label: "Font: Verdana", action: () => saveConversationTextStyle({ ...textStyle, fontFamily: "Verdana" }) },
        { label: "Font: Comic Sans MS", action: () => saveConversationTextStyle({ ...textStyle, fontFamily: "Comic Sans MS" }) },
        { label: copy.menu.textSize, action: changeConversationFontSize },
        { separator: true },
        { label: copy.menu.resetText, action: resetConversationTextStyle }
      ]
    },
    {
      label: copy.menu.actions,
      entries: [
        { label: copy.menu.invite, action: () => toggleFlyout("invite") },
        { label: "Wizz", action: () => api.wizz(contact.id) },
        { label: copy.menu.sendWink, action: () => toggleFlyout("activities") },
        { label: copy.menu.emoticons, action: () => toggleFlyout("emoticons") },
        { label: copy.menu.searchTranscript, action: handleSearch },
        ...(primaryApproval ? [
          { separator: true },
          { label: `Autoriser la ${approvalMenuTarget} Codex`, action: () => respondToApproval(primaryApproval, "approved") },
          ...(primaryApproval.canApproveForSession ? [
            { label: "Autoriser pour la session", action: () => respondToApproval(primaryApproval, "approved_for_session") }
          ] : []),
          { label: `Refuser la ${approvalMenuTarget} Codex`, action: () => respondToApproval(primaryApproval, "denied") }
        ] : []),
        { separator: true },
        { label: `Zoom + (${Math.round(conversationZoom * 100)}%)`, shortcut: "Ctrl++", disabled: conversationZoom >= 1.6, action: zoomConversationIn },
        { label: "Zoom -", shortcut: "Ctrl+-", disabled: conversationZoom <= 0.7, action: zoomConversationOut },
        { label: copy.menu.zoomDefault, shortcut: "Ctrl+0", disabled: conversationZoom === 1, action: resetConversationZoom },
        { separator: true },
        { label: copy.menu.activities, action: () => toggleFlyout("activities") },
        { label: copy.menu.games, action: () => toggleFlyout("games") },
        { label: "Play Morpion", action: () => { setActiveGame("morpion"); openPanel("games"); } },
        { label: "Play Memory", action: () => { setActiveGame("memory"); openPanel("games"); } },
        { label: "Play Wizz Reflex", action: () => { setActiveGame("wizz"); openPanel("games"); } }
      ]
    },
    {
      label: copy.menu.tools,
      entries: [
        { label: copy.menu.startCamera, action: startCamera },
        { label: recording ? copy.menu.stopVoiceClip : copy.menu.voiceClip, action: toggleVoiceClip },
        { label: copy.menu.sendImageFile, action: handleSendFile },
        { separator: true },
        { label: copy.menu.openAppFolder, action: () => api.app.openPath(bootstrap.cwd) },
        { label: copy.menu.openUploadsFolder, action: () => api.app.openPath(`${bootstrap.cwd}\\uploads`) },
        { label: copy.menu.reloadWindow, shortcut: "Ctrl+R", action: () => api.app.reload() }
      ]
    },
    {
      label: copy.menu.help,
      entries: [
        {
          label: copy.menu.about,
          action: () => setUpdateDialogOpen(true)
        },
        { label: copy.menu.checkUpdates, action: () => checkForUpdates({ force: true }) },
        {
          label: copy.menu.keyboardShortcuts,
          action: () => window.alert("Enter: envoyer\nShift+Enter: nouvelle ligne\nCtrl+A/C/X/V: edition du message\nWizz: secoue la fenetre et joue le son.")
        }
      ]
    }
  ];

  return (
    <main className="msn-window chat" ref={chatWindowRef}>
      <Titlebar title={`${displayContact.name} - ${copy.chat.conversation}`} />
      <Menu items={chatMenus} />
      <ResizeGrip />
      {promptDialog}
      {hasAvailableUpdates(updateState) ? (
        <button className="top-update-button" type="button" onClick={() => setUpdateDialogOpen(true)}>Update</button>
      ) : null}
      {updateDialogOpen ? (
        <UpdateDialog
          updateState={updateState}
          checking={checkingUpdates}
          installingTarget={installingUpdateTarget}
          actionMessage={updateActionMessage}
          progress={updateProgress}
          appVersion={bootstrap.appVersion}
          userAgent={bootstrap.userAgent ?? ""}
          copy={copy}
          versionLabel={(value) => versionLabel(value, copy.updates?.unknown)}
          updateLineState={(item) => updateLineState(item, copy)}
          onCheck={() => checkForUpdates({ force: true })}
          onOpen={(target) => api.openUpdateTarget(target)}
          onInstall={installUpdateTarget}
          onRestart={restartForUpdate}
          onClose={() => setUpdateDialogOpen(false)}
        />
      ) : null}
      <div className="toolbar-shell">
        <div className="toolbar">
          <Tool icon="invite" label={copy.toolbar.invite} active={openFlyout === "invite"} onClick={(event) => toggleFlyout("invite", event)} />
          <Tool icon="files" label={copy.toolbar.files} active={openFlyout === "files"} onClick={(event) => toggleFlyout("files", event)} />
          <Tool icon="video" label={copy.toolbar.video} active={openFlyout === "camera"} onClick={startCamera} />
          <Tool icon="voice" label={recording ? copy.toolbar.stop : copy.toolbar.voice} active={openFlyout === "voice" || recording} onClick={(event) => toggleFlyout("voice", event)} />
          <Tool icon="activities" label={copy.toolbar.activities} active={openFlyout === "activities"} onClick={(event) => toggleFlyout("activities", event)} />
          <Tool icon="games" label={copy.toolbar.games} active={openFlyout === "games"} onClick={(event) => toggleFlyout("games", event)} />
          <div className="toolbar-brand"><span>Codex</span><Logo small /></div>
        </div>
      </div>
      {openFlyout ? (
        <div
          ref={flyoutRef}
          className={`toolbar-flyout ${openFlyout} ${flyoutPosition.placement}`}
          style={{
            left: flyoutPosition.left,
            top: flyoutPosition.top,
            width: flyoutPosition.width,
            maxHeight: flyoutPosition.maxHeight,
            "--arrow-x": `${flyoutPosition.arrowX}px`
          }}
        >
          {openFlyout === "invite" ? (
            <InvitePanel
              contact={contact}
              AvatarComponent={Avatar}
              statusCopy={statusLabels}
              onOpenProject={() => contact.cwd ? api.app.openPath(contact.cwd) : null}
              onRun={sendQuickPrompt}
            />
          ) : null}
          {openFlyout === "files" ? (
            <FilesPanel
              canOpenProject={Boolean(contact.cwd)}
              onSendFile={handleSendFile}
              onCamera={(event) => startCamera(event)}
              onOpenProject={() => contact.cwd ? api.app.openPath(contact.cwd) : null}
            />
          ) : null}
          {openFlyout === "voice" ? (
            <VoicePanel recording={recording} mediaError={mediaError} onToggle={toggleVoiceClip} />
          ) : null}
          {openFlyout === "text" ? (
            <TextStylePanel
              textStyle={textStyle}
              normalizeTextStyle={normalizeTextStyle}
              textFontOptions={textFontOptions}
              textColorOptions={textColorOptions}
              bubbleColorOptions={bubbleColorOptions}
              onChange={(patch) => saveConversationTextStyle({ ...textStyle, ...patch })}
              onReset={resetConversationTextStyle}
            />
          ) : null}
          {openFlyout === "camera" ? (
            <CameraPanel
              videoRef={videoRef}
              cameraStream={cameraStream}
              mediaError={mediaError}
              onSnapshot={sendCameraSnapshot}
              onStop={stopCamera}
            />
          ) : null}
          {openFlyout === "activities" ? (
            <ActivitiesPanel
              winks={winkCatalog}
              sounds={soundCatalog}
              prompts={activityPrompts}
              onRun={sendQuickPrompt}
              onSendWink={sendWink}
              onAskWink={askCodexWink}
              onPreviewSound={playSoundKey}
            />
          ) : null}
          {openFlyout === "emoticons" ? (
            <EmoticonsPanel
              emoticons={msnEmoticons}
              animatedEmoticons={animatedInlineEmoticons}
              onInsert={(emoticon) => {
                insertDraft(`${emoticon.code} `);
                setOpenFlyout("");
              }}
            />
          ) : null}
          {openFlyout === "games" ? (
            <GamesPanel
              activeGame={activeGame}
              onSelectGame={setActiveGame}
              onRun={sendQuickPrompt}
              waiting={typing}
            />
          ) : null}
        </div>
      ) : null}
      <section className="chat-body">
        <WinkAnimationOverlay animation={activeWinkAnimation} />
        <div className="chat-main">
          <ThreadTabs
            project={currentProject}
            contact={contact}
            activeThreadId={activeThreadId}
            loading={threadsLoading}
            loadingError={threadsLoadError}
            isHistoryContact={isCodexHistoryContact(contact)}
            onOpenProject={openProjectTab}
            onOpenThread={openThreadTab}
            onDeleteThread={deleteThreadTab}
            onReorderThreads={reorderThreadTabs}
          />
          <div
            className="transcript"
            ref={scrollRef}
            style={{
              "--message-font-family": textStyle.fontFamily,
              "--message-font-size": `${textStyle.fontSize}px`,
              "--message-color": textStyle.color,
              "--message-bubble": textStyle.bubble,
              "--message-me-bubble": textStyle.meBubble
            }}
          >
            {hiddenRenderedMessages > 0 ? (
              <div className="history-load-row">
                <button
                  type="button"
                  onClick={() => setTranscriptRenderLimit((current) => Math.min(messages.length, current + transcriptRenderStep))}
                >
                  Afficher {Math.min(transcriptRenderStep, hiddenRenderedMessages)} messages precedents
                </button>
              </div>
            ) : null}
            {historyHasMore ? (
              <div className="history-load-row">
                <button type="button" onClick={loadPreviousMessages} disabled={loadingPreviousMessages}>
                  {loadingPreviousMessages ? "Chargement..." : "Load previous"}
                </button>
              </div>
            ) : null}
            {visibleMessages.map((message) => (
              <Message
                key={message.id}
                message={message}
                extractWinkFromText={extractWinkFromText}
                renderFormattedMessageText={renderFormattedMessageText}
              />
            ))}
            {typing ? <div className="typing"><i /><i /><i />{conversationAgentName} {copy.chat.typing}</div> : null}
          </div>
          <ApprovalRequestsPanel requests={pendingApprovals} onRespond={respondToApproval} />
          <div className="format-strip">
            <FormatButton icon="font" title="Rendu texte" active={openFlyout === "text"} onClick={(event) => toggleFlyout("text", event)} />
            <FormatButton icon="smile" title="Emoticones MSN" active={openFlyout === "emoticons"} onClick={(event) => toggleFlyout("emoticons", event)} />
            <FormatButton icon="voice" title="Voice Clip" label={recording ? "Stop" : "Voice Clip"} active={openFlyout === "voice" || recording} onClick={(event) => toggleFlyout("voice", event)} />
            <FormatButton icon="wink" title="Clin d'oeil" active={openFlyout === "activities"} onClick={(event) => toggleFlyout("activities", event)} />
            <FormatButton icon="image" title="Image" active={openFlyout === "files"} onClick={(event) => toggleFlyout("files", event)} />
            <FormatButton icon="gift" title="Activites" active={openFlyout === "activities"} onClick={(event) => toggleFlyout("activities", event)} />
            <FormatButton icon="wizz" title="Wizz" onClick={() => api.wizz(contact.id)} />
            {recording ? <span className="format-status recording">Recording...</span> : null}
            {!recording && mediaError && !openFlyout ? <span className="format-status error">{mediaError}</span> : null}
          </div>
          <Composer
            copy={copy}
            draft={draft}
            onDraftChange={setDraft}
            onSubmit={submit}
            textareaRef={textareaRef}
            onKeyDown={handleComposerKeyDown}
            onPaste={handleComposerPaste}
            typing={typing}
            onStop={interruptCurrentTurn}
            onSearch={handleSearch}
            historySearchOpen={historySearchOpen}
            historySearchQuery={historySearchQuery}
            onHistorySearchChange={setHistorySearchQuery}
            onHistorySearchClose={() => setHistorySearchOpen(false)}
            filteredPromptHistory={filteredPromptHistory}
            onUseHistoryEntry={useHistoryEntry}
            slashMatches={slashMatches}
            onRunSlashCommand={runSlashCommand}
            draftAttachments={draftAttachments}
            onRemoveAttachment={(index) => setDraftAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))}
          />
        </div>
        <aside className="chat-side">
          <DisplayFrame
            contact={displayContact}
            position="top"
            menuItems={contactFrameMenu}
            statusCopy={copy.status}
            onNameDoubleClick={renameCurrentSession}
            onStatusDoubleClick={() => changeCurrentSessionStatus()}
          />
          <DisplayFrame
            contact={selfContact}
            position="bottom"
            menuItems={selfFrameMenu}
            statusCopy={copy.status}
            onNameDoubleClick={renameSelfDisplayName}
            onStatusDoubleClick={changeSelfStatusFromFrame}
          />
        </aside>
      </section>
      <footer className="chat-ad" aria-hidden="true">Codex App Server active</footer>
    </main>
  );
}

function appendAgentDelta(messages, author, delta) {
  const cleanDelta = String(delta ?? "");
  if (!cleanDelta) return messages;
  const last = messages[messages.length - 1];
  if (last?.streaming) {
    return [...messages.slice(0, -1), { ...last, text: mergeStreamText(last.text, cleanDelta) }];
  }
  return [...messages, makeMessage("them", author, cleanDelta, { streaming: true })];
}

function finishAgentMessage(messages, author, text) {
  const parsed = extractWinkFromText(text);
  const cleanText = parsed.text.trim();
  if (!cleanText) return messages;
  const last = messages[messages.length - 1];
  if (last?.streaming) {
    return [...messages.slice(0, -1), { ...last, text: cleanText, streaming: false, wink: parsed.wink ?? last.wink }];
  }
  if (last?.from === "them" && normalizeMessageText(last.text) === normalizeMessageText(cleanText)) {
    return messages;
  }
  const previous = messages[messages.length - 2];
  if (last?.from === "them" && previous?.from === "them" && normalizeMessageText(previous.text) === normalizeMessageText(cleanText)) {
    return messages.slice(0, -1);
  }
  return [...messages, makeMessage("them", author, cleanText, parsed.wink ? { wink: parsed.wink } : {})];
}

function mergeStreamText(current, incoming) {
  const left = String(current ?? "");
  const right = String(incoming ?? "");
  if (!left || right.startsWith(left)) return right;
  if (!right || left.endsWith(right)) return left;

  const maxOverlap = Math.min(left.length, right.length);
  for (let size = maxOverlap; size > 0; size -= 1) {
    if (left.slice(-size) === right.slice(0, size)) {
      return left + right.slice(size);
    }
  }
  return left + right;
}

function normalizeMessageText(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

function App() {
  const [bootstrap, setBootstrap] = useState(null);
  const [bootstrapError, setBootstrapError] = useState("");

  useEffect(() => {
    api.bootstrap()
      .then(setBootstrap)
      .catch((error) => {
        reportRendererError("bootstrap.app.error", error, { view: "initial" });
        setBootstrapError(errorMessage(error, "Chargement impossible."));
      });
  }, []);

  useEffect(() => {
    const onError = (event) => reportRendererError("window.error", event.error || event.message, { source: event.filename, line: event.lineno });
    const onUnhandled = (event) => reportRendererError("window.unhandledrejection", event.reason, {});
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandled);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandled);
    };
  }, []);

  if (bootstrapError) return <ErrorScreen title="Chargement impossible" message={bootstrapError} />;
  if (!bootstrap) return <div className="loading">Chargement...</div>;
  return bootstrap.view === "chat" ? <ChatWindow bootstrap={bootstrap} /> : <MainWindow />;
}

createRoot(document.getElementById("root")).render(
  <RendererErrorBoundary>
    <App />
  </RendererErrorBoundary>
);
