import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { loginCopyFor, normalizeLanguage, supportedLanguages } from "../shared/languages.js";
import msnDisplayPictures from "./msnDisplayPictures.js";
import msnEmoticons from "./msnEmoticons.js";
import "./styles.css";

const api = window.codexMsn;
const statusLabels = {
  online: "En ligne",
  busy: "Occupe",
  brb: "De retour bientot",
  away: "Absent",
  phone: "Au telephone",
  lunch: "Parti manger",
  offline: "Hors ligne"
};
const statusOptions = [
  ["online", "En ligne"],
  ["busy", "Occupe"],
  ["brb", "De retour bientot"],
  ["away", "Absent"],
  ["phone", "Au telephone"],
  ["lunch", "Parti manger"],
  ["offline", "Apparaitre hors ligne"]
];
const audioFiles = {
  wizz: "./msn-assets/sounds/nudge.wav",
  message: "./msn-assets/sounds/type.wav",
  newEmail: "./msn-assets/sounds/newemail.wav",
  online: "./msn-assets/sounds/online.wav",
  phone: "./msn-assets/sounds/phone.wav",
  ring: "./msn-assets/sounds/ring.wav",
  type: "./msn-assets/sounds/newalert.wav",
  done: "./msn-assets/sounds/vimdone.wav"
};
const brandPeopleLogo = new URL("./icons/codex-messenger-people.png", window.location.href).href;
const toolbarIcons = {
  invite: "./icons/toolbar/invite.png",
  files: "./icons/toolbar/files.png",
  video: "./icons/toolbar/video.png",
  voice: "./icons/toolbar/voice.png",
  activities: "./icons/toolbar/activities.png",
  games: "./icons/toolbar/games.png",
  wizz: "./icons/toolbar/wizz.png"
};
const formatIcons = {
  font: "./icons/format/font.png",
  smile: "./icons/format/smile.png",
  voice: "./icons/format/voice.png",
  wink: "./icons/format/wink.png",
  image: "./icons/format/image.png",
  gift: "./icons/format/gift.png",
  wizz: "./icons/toolbar/wizz.png",
  laugh: "./icons/format/laugh.png"
};
const activityPrompts = [
  ["Plan", "Fais un plan de travail court pour ce projet, puis propose la premiere action concrete."],
  ["Review", "Fais une revue pragmatique du projet courant: bugs probables, risques, tests manquants, priorites."],
  ["Tests", "Inspecte le projet et propose les commandes de test/build pertinentes. Si c'est raisonnable, lance-les."],
  ["Design", "Analyse l'interface actuelle et propose les modifications visuelles prioritaires pour coller a MSN 7."]
];
const gamePrompts = [
  ["Bug Hunt", "Lance un mini-jeu Bug Hunt: donne-moi un fichier ou une zone a inspecter, puis guide-moi pour trouver le bug avant de proposer la correction."],
  ["20 Questions", "Lance un jeu de 20 questions pour clarifier une feature du projet avant implementation."],
  ["Code Golf", "Choisis une petite amelioration du projet et transforme-la en defi code golf lisible, puis propose la solution propre."],
  ["XP Polish", "Lance un defi XP Polish: trouve trois details visuels qui trahissent une UI moderne et corrige-les un par un."]
];
const gameCatalog = [
  { id: "morpion", label: "Morpion" },
  { id: "memory", label: "Memory" },
  { id: "wizz", label: "Wizz" }
];
const soundCatalog = [
  ["message", "Nouveau message", audioFiles.message],
  ["wizz", "Wizz / Nudge", audioFiles.wizz],
  ["newEmail", "Nouvel e-mail", audioFiles.newEmail],
  ["online", "Contact en ligne", audioFiles.online],
  ["ring", "Sonnerie", audioFiles.ring],
  ["phone", "Telephone", audioFiles.phone],
  ["type", "Alerte", audioFiles.type],
  ["done", "Invite terminee", audioFiles.done]
];
const projectSortOptions = [
  { id: "modified-desc", label: "Date de modification", detail: "recent d'abord", short: "modifie" },
  { id: "modified-asc", label: "Date de modification", detail: "ancien d'abord", short: "modifie" },
  { id: "created-desc", label: "Date de creation", detail: "recent d'abord", short: "cree" },
  { id: "created-asc", label: "Date de creation", detail: "ancien d'abord", short: "cree" },
  { id: "name-asc", label: "Alphabet montant", detail: "A a Z", short: "A-Z" },
  { id: "name-desc", label: "Alphabet descendant", detail: "Z a A", short: "Z-A" },
  { id: "threads-desc", label: "Nombre de fils", detail: "plus d'abord", short: "fils +" },
  { id: "threads-asc", label: "Nombre de fils", detail: "moins d'abord", short: "fils -" }
];
const projectSortIds = new Set(projectSortOptions.map((option) => option.id));
const defaultTextStyle = {
  fontFamily: "Tahoma",
  fontSize: 11,
  color: "#182337",
  bubble: "#f0f6ff",
  meBubble: "#eefaf1"
};
const textFontOptions = ["Tahoma", "Verdana", "Arial", "Segoe UI", "Times New Roman", "Courier New", "Comic Sans MS"];
const textColorOptions = ["#182337", "#123f82", "#0b7747", "#7a1c1c", "#4b347a", "#111111"];
const bubbleColorOptions = ["#f0f6ff", "#fffbd0", "#eefaf1", "#fff0f0", "#f2edff", "#ffffff"];
const winkCatalog = [
  {
    id: "water-balloon",
    label: "Water Balloon",
    src: "./msn-assets/msn75/packages/winks/msgslang_WINK_1121_9/water_balloon.png",
    swf: "./msn-assets/msn75/packages/winks/msgslang_WINK_1121_9/water_balloon.swf",
    sound: "wizz"
  },
  {
    id: "bouncy-ball",
    label: "Bouncy Ball",
    src: "./msn-assets/msn75/packages/winks/msgslang_WINK_1122_9/bouncy_ball.png",
    swf: "./msn-assets/msn75/packages/winks/msgslang_WINK_1122_9/bouncy_ball.swf",
    sound: "online"
  },
  {
    id: "lightbulb",
    label: "Lightbulb",
    src: "./msn-assets/msn75/packages/winks/msgslang_WINK_1123_9/lightbulb.jpg",
    swf: "./msn-assets/msn75/packages/winks/msgslang_WINK_1123_9/lightbulb.swf",
    sound: "type"
  },
  {
    id: "crying",
    label: "Crying",
    src: "./msn-assets/msn75/packages/winks/msgslang_WINK_1124_9/crying.png",
    swf: "./msn-assets/msn75/packages/winks/msgslang_WINK_1124_9/crying.swf",
    sound: "ring"
  },
  {
    id: "ufo",
    label: "UFO",
    src: "./msn-assets/msn75/packages/winks/msgslang_WINK_1125_9/ufo.png",
    swf: "./msn-assets/msn75/packages/winks/msgslang_WINK_1125_9/ufo.swf",
    sound: "wizz"
  },
  {
    id: "frog",
    label: "Frog",
    src: "./msn-assets/msn75/packages/winks/msgslang_WINK_1126_9/frog.png",
    swf: "./msn-assets/msn75/packages/winks/msgslang_WINK_1126_9/frog.swf",
    sound: "online"
  },
  {
    id: "dancer",
    label: "Dancer",
    src: "./msn-assets/msn75/packages/winks/msgslang_WINK_1127_9/dancer.png",
    swf: "./msn-assets/msn75/packages/winks/msgslang_WINK_1127_9/dancer.swf",
    sound: "done"
  },
  {
    id: "bow",
    label: "Bow",
    src: "./msn-assets/msn75/packages/winks/msgslang_WINK_1128_9/bow.jpg",
    swf: "./msn-assets/msn75/packages/winks/msgslang_WINK_1128_9/bow.swf",
    sound: "done"
  },
  {
    id: "heart",
    label: "Heart",
    src: "./msn-assets/msn75/packages/winks/msgslang_WINK_1129_9/heart.png",
    swf: "./msn-assets/msn75/packages/winks/msgslang_WINK_1129_9/heart.swf",
    sound: "ring"
  },
  {
    id: "silly-face",
    label: "Silly Face",
    src: "./msn-assets/msn75/packages/winks/msgslang_WINK_1130_9/silly_face.png",
    swf: "./msn-assets/msn75/packages/winks/msgslang_WINK_1130_9/silly_face.swf",
    sound: "type"
  },
  {
    id: "dancing-pig",
    label: "Dancing Pig",
    src: "./msn-assets/msn75/packages/winks/msgslang_WINK_1131_9/dancing_pig.png",
    swf: "./msn-assets/msn75/packages/winks/msgslang_WINK_1131_9/dancing_pig.swf",
    sound: "done"
  },
  {
    id: "kiss",
    label: "Kiss",
    src: "./msn-assets/msn75/packages/winks/msgslang_WINK_1132_9/kiss.png",
    swf: "./msn-assets/msn75/packages/winks/msgslang_WINK_1132_9/kiss.swf",
    sound: "ring"
  },
  {
    id: "guitar-smash",
    label: "Guitar Smash",
    src: "./msn-assets/msn75/packages/winks/msgslang_WINK_1133_9/guitar_smash.png",
    swf: "./msn-assets/msn75/packages/winks/msgslang_WINK_1133_9/guitar_smash.swf",
    sound: "wizz"
  },
  {
    id: "knock",
    label: "Knock",
    src: "./msn-assets/msn75/packages/winks/msgslang_WINK_1134_9/knock.png",
    swf: "./msn-assets/msn75/packages/winks/msgslang_WINK_1134_9/knock.swf",
    sound: "wizz"
  },
  {
    id: "laughing-girl",
    label: "Laughing Girl",
    src: "./msn-assets/msn75/packages/winks/msgslang_WINK_1135_9/laughing_girl.png",
    swf: "./msn-assets/msn75/packages/winks/msgslang_WINK_1135_9/laughing_girl.swf",
    sound: "done"
  },
  { id: "butterfly", label: "Papillon", src: "./msn-assets/winks/butterfly.gif", sound: "wizz" },
  { id: "butterfly-small", label: "Mini papillon", src: "./msn-assets/winks/butterfly-small.gif", sound: "online" },
  { id: "surprise", label: "Surprise", src: "./msn-assets/winks/surprise.gif", sound: "ring" },
  { id: "nudge", label: "Secousse", src: "./msn-assets/winks/nudge-burst.gif", sound: "wizz" },
  { id: "flash", label: "Flash", src: "./msn-assets/winks/flash.gif", sound: "type" },
  { id: "msn-flow", label: "MSN", src: "./msn-assets/winks/msn-flow.gif", sound: "done" }
];
const winkById = Object.fromEntries(winkCatalog.map((wink) => [wink.id, wink]));
const animatedInlineEmoticons = [
  { id: "animated-butterfly", label: "Papillon animé", code: ":butterfly:", aliases: ["[emoji:butterfly]", "[emote:butterfly]"], src: "./msn-assets/winks/butterfly-small.gif" },
  { id: "animated-surprise", label: "Surprise animée", code: ":surprise:", aliases: ["[emoji:surprise]", "[emote:surprise]"], src: "./msn-assets/winks/surprise.gif" },
  { id: "animated-flash", label: "Flash animé", code: ":flash:", aliases: ["[emoji:flash]", "[emote:flash]"], src: "./msn-assets/winks/flash.gif" },
  { id: "animated-wizz", label: "Wizz animé", code: ":wizz:", aliases: ["[emoji:wizz]", "[emote:wizz]"], src: "./msn-assets/winks/nudge-burst.gif" },
  { id: "animated-flow", label: "MSN animé", code: ":msn-flow:", aliases: ["[emoji:msn-flow]", "[emote:msn-flow]"], src: "./msn-assets/winks/msn-flow.gif" }
];
const inlineEmoticons = [...msnEmoticons, ...animatedInlineEmoticons];
const gameAssets = {
  x: "./msn-assets/games/piece-x.png",
  o: "./msn-assets/games/piece-o.png",
  bell: "./msn-assets/games/bell.png",
  play: "./msn-assets/games/play.png"
};
const memorySymbols = [
  { id: "smile", label: "Smile", src: "./msn-assets/games/smile.png" },
  { id: "gift", label: "Gift", src: "./msn-assets/games/gift.png" },
  { id: "butterfly", label: "Butterfly", src: "./msn-assets/games/butterfly.png" },
  { id: "bell", label: "Wizz", src: "./msn-assets/games/bell.png" },
  { id: "person", label: "Buddy", src: "./msn-assets/games/person.png" },
  { id: "group", label: "Group", src: "./msn-assets/games/group.png" }
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
const ticLines = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6]
];
function now() {
  return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(new Date());
}

function makeMessage(from, author, text, options = {}) {
  return { id: crypto.randomUUID(), from, author, text, time: now(), ...options };
}

function playAudio(src, fallback) {
  const audio = new Audio(src);
  audio.currentTime = 0;
  audio.play().catch(() => fallback?.());
}

function playNewMessage() {
  playAudio(audioFiles.message);
}

function playSyntheticWizz() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  const ctx = new AudioContext();
  const master = ctx.createGain();
  master.gain.setValueAtTime(0.0001, ctx.currentTime);
  master.gain.exponentialRampToValueAtTime(0.22, ctx.currentTime + 0.01);
  master.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.72);
  master.connect(ctx.destination);

  [[0, 620], [0.1, 880], [0.2, 540], [0.3, 980], [0.46, 720]].forEach(([offset, hz]) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(hz, ctx.currentTime + offset);
    osc.frequency.exponentialRampToValueAtTime(hz * 1.28, ctx.currentTime + offset + 0.12);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime + offset);
    gain.gain.exponentialRampToValueAtTime(0.13, ctx.currentTime + offset + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + offset + 0.14);
    osc.connect(gain);
    gain.connect(master);
    osc.start(ctx.currentTime + offset);
    osc.stop(ctx.currentTime + offset + 0.16);
  });

  window.setTimeout(() => ctx.close(), 900);
}

function playWizz() {
  playAudio(audioFiles.wizz, playSyntheticWizz);
}

function playSoundKey(soundKey) {
  playAudio(audioFiles[soundKey] ?? audioFiles.message);
}

function playWink(wink) {
  playSoundKey(wink?.sound ?? "wizz");
}

function extractWinkFromText(text) {
  const source = String(text ?? "");
  const match = source.match(/\[(?:wink|clin|clin-doeil|nudge):([a-z0-9-]+)\]/i);
  if (!match) return { text: source, wink: null };
  const wink = winkById[match[1]] ?? null;
  if (!wink) return { text: source, wink: null };
  const cleanText = source.replace(match[0], "").replace(/\n{3,}/g, "\n\n").trim();
  return { text: cleanText || `Clin d'oeil: ${wink.label}`, wink };
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeProjectSort(value) {
  return projectSortIds.has(value) ? value : "name-asc";
}

function normalizeTextStyle(style = {}) {
  const fontFamily = textFontOptions.includes(style.fontFamily) ? style.fontFamily : defaultTextStyle.fontFamily;
  const fontSize = Math.max(9, Math.min(18, Math.round(Number(style.fontSize) || defaultTextStyle.fontSize)));
  const color = textColorOptions.includes(style.color) ? style.color : defaultTextStyle.color;
  const bubble = bubbleColorOptions.includes(style.bubble) ? style.bubble : defaultTextStyle.bubble;
  const meBubble = bubbleColorOptions.includes(style.meBubble) ? style.meBubble : defaultTextStyle.meBubble;
  return { fontFamily, fontSize, color, bubble, meBubble };
}

function textStyleForContact(settings, contactId) {
  return normalizeTextStyle(settings?.textStyles?.[contactId]);
}

function normalizeWizzDelaySeconds(value) {
  const seconds = Math.round(Number(value) || 60);
  return Math.max(10, Math.min(1800, seconds));
}

function projectSortOption(sort) {
  return projectSortOptions.find((option) => option.id === normalizeProjectSort(sort)) ?? projectSortOptions[4];
}

function projectDateMs(project, key) {
  const value = Date.parse(project?.[key] ?? "");
  return Number.isFinite(value) ? value : 0;
}

function projectThreadCount(project) {
  return Number(project?.threadCount ?? project?.threads?.length ?? 0) || 0;
}

function compareProjectNames(left, right) {
  return String(left?.name ?? "").localeCompare(String(right?.name ?? ""), undefined, {
    numeric: true,
    sensitivity: "base"
  });
}

function sortProjects(projects, sort) {
  const mode = normalizeProjectSort(sort);
  return [...projects].sort((left, right) => {
    let result = 0;
    if (mode === "name-asc") result = compareProjectNames(left, right);
    if (mode === "name-desc") result = compareProjectNames(right, left);
    if (mode === "created-desc") result = projectDateMs(right, "createdAt") - projectDateMs(left, "createdAt");
    if (mode === "created-asc") result = projectDateMs(left, "createdAt") - projectDateMs(right, "createdAt");
    if (mode === "modified-desc") result = projectDateMs(right, "modifiedAt") - projectDateMs(left, "modifiedAt");
    if (mode === "modified-asc") result = projectDateMs(left, "modifiedAt") - projectDateMs(right, "modifiedAt");
    if (mode === "threads-desc") result = projectThreadCount(right) - projectThreadCount(left);
    if (mode === "threads-asc") result = projectThreadCount(left) - projectThreadCount(right);
    return result || compareProjectNames(left, right) || String(left?.cwd ?? "").localeCompare(String(right?.cwd ?? ""));
  });
}

const emoticonTokens = inlineEmoticons
  .flatMap((emoticon) => [emoticon.code, ...(emoticon.aliases ?? [])].map((code) => [code, emoticon]))
  .filter(([code]) => code);
const emoticonByToken = Object.fromEntries(emoticonTokens);
const emoticonPattern = new RegExp(
  `(${emoticonTokens.map(([code]) => code).sort((left, right) => right.length - left.length).map(escapeRegExp).join("|")})`,
  "g"
);

function renderTextWithEmoticons(text) {
  const source = String(text ?? "");
  if (!source) return null;
  return source.split(emoticonPattern).map((part, index) => {
    const emoticon = emoticonByToken[part];
    if (!emoticon) return part;
    return (
      <img
        key={`${part}-${index}`}
        className="message-emoticon"
        src={emoticon.src}
        alt={part}
        title={`${emoticon.label} ${emoticon.code}`}
        draggable="false"
      />
    );
  });
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

function Logo({ small = false }) {
  return (
    <span className={small ? "logo small" : "logo"} aria-hidden="true">
      <img src={brandPeopleLogo} alt="" draggable="false" />
    </span>
  );
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

function Titlebar({ title }) {
  return (
    <header className="titlebar">
      <div className="title-left">
        <Logo small />
        <span>{title}</span>
      </div>
      <div className="window-buttons">
        <button type="button" aria-label="Minimiser" onClick={() => api.window.minimize()}><span /></button>
        <button type="button" aria-label="Maximiser" onClick={() => api.window.maximize()}><span /></button>
        <button type="button" aria-label="Fermer" onClick={() => api.window.close()}><span /></button>
      </div>
    </header>
  );
}

function Menu({ items }) {
  const [open, setOpen] = useState(null);
  const ref = useRef(null);
  const normalized = items.map((item) => typeof item === "string" ? { label: item, entries: [] } : item);

  useEffect(() => {
    const close = (event) => {
      if (!ref.current?.contains(event.target)) setOpen(null);
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setOpen(null);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  async function runEntry(entry) {
    if (entry.disabled) return;
    setOpen(null);
    try {
      await entry.action?.();
    } catch (error) {
      window.alert(error.message ?? "Action impossible");
    }
  }

  return (
    <nav className="menu" ref={ref}>
      {normalized.map((menu, index) => (
        <div className="menu-item" key={menu.label} onMouseEnter={() => open !== null && setOpen(index)}>
          <button
            className={open === index ? "menu-button active" : "menu-button"}
            type="button"
            onClick={() => setOpen(open === index ? null : index)}
          >
            {menu.label}
          </button>
          {open === index ? (
            <div className="menu-dropdown">
              {(menu.entries?.length ? menu.entries : [{ label: "Aucune action", disabled: true }]).map((entry, entryIndex) => (
                entry.separator ? (
                  <div className="menu-separator" key={`separator-${entryIndex}`} />
                ) : (
                  <button
                    className="menu-entry"
                    type="button"
                    disabled={entry.disabled}
                    key={entry.label}
                    onClick={() => runEntry(entry)}
                  >
                    <span>{entry.label}</span>
                    {entry.shortcut ? <small>{entry.shortcut}</small> : null}
                  </button>
                )
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </nav>
  );
}

function LoginView({ initialProfile, initialSettings, initialCodexStatus, onSignedIn }) {
  const [email, setEmail] = useState(initialProfile.email);
  const [displayName, setDisplayName] = useState(initialProfile.displayName ?? initialProfile.email.split("@")[0]);
  const [personalMessage, setPersonalMessage] = useState(initialProfile.personalMessage ?? "");
  const [status, setStatus] = useState(initialProfile.status);
  const [language, setLanguage] = useState(normalizeLanguage(initialProfile.language ?? initialSettings?.language ?? "fr"));
  const [codexPath, setCodexPath] = useState(initialSettings?.codexPath ?? "");
  const [unreadWizzDelaySeconds, setUnreadWizzDelaySeconds] = useState(() => normalizeWizzDelaySeconds((initialSettings?.unreadWizzDelayMs ?? 60_000) / 1000));
  const [codexStatus, setCodexStatus] = useState(initialCodexStatus);
  const [state, setState] = useState("idle");
  const [error, setError] = useState("");
  const [pressedPathAction, setPressedPathAction] = useState("");
  const pathActionTimer = useRef(null);
  const text = loginCopyFor(language);

  useEffect(() => () => {
    if (pathActionTimer.current) window.clearTimeout(pathActionTimer.current);
  }, []);

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
    setState("connecting");
    try {
      const result = await api.signIn({
        email,
        displayName,
        personalMessage,
        status,
        language,
        codexPath,
        unreadWizzDelayMs: normalizeWizzDelaySeconds(unreadWizzDelaySeconds) * 1000,
        displayPicturePath: initialProfile.displayPicturePath ?? "",
        displayPictureAsset: initialProfile.displayPictureAsset ?? ""
      });
      onSignedIn(result.profile, result.userAgent, result.settings, result.codexStatus);
    } catch (err) {
      setError(err.message);
      setState("idle");
    }
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

  return (
    <form className="login-panel" onSubmit={submit}>
      <div className="identity">
        <Logo />
        <div>
          <h1>Codex Messenger</h1>
          <p>{text.subtitle}</p>
        </div>
      </div>
      <label className="field">
        <span>{text.language}</span>
        <select value={language} onChange={(event) => setLanguage(normalizeLanguage(event.target.value))}>
          {supportedLanguages.map((item) => <option value={item.code} key={item.code}>{item.label}</option>)}
        </select>
      </label>
      <label className="field">
        <span>{text.email}</span>
        <input value={email} onChange={(event) => setEmail(event.target.value)} />
      </label>
      <label className="field">
        <span>{text.displayName}</span>
        <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
      </label>
      <label className="field">
        <span>{text.personalMessage}</span>
        <input value={personalMessage} onChange={(event) => setPersonalMessage(event.target.value)} maxLength={140} />
      </label>
      <label className="field">
        <span>{text.status}</span>
        <select value={status} onChange={(event) => setStatus(event.target.value)}>
          {statusOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
        </select>
      </label>
      <label className="field">
        <span>{text.codexPath}</span>
        <input value={codexPath} onChange={(event) => setCodexPath(event.target.value)} placeholder={text.autoPath} />
      </label>
      <label className="field">
        <span>Delai Wizz rappel (secondes)</span>
        <input
          type="number"
          min="10"
          max="1800"
          step="5"
          value={unreadWizzDelaySeconds}
          onChange={(event) => setUnreadWizzDelaySeconds(normalizeWizzDelaySeconds(event.target.value))}
        />
      </label>
      <div className="codex-path-actions">
        <button className={pressedPathAction === "browse" ? "pressed" : ""} type="button" onClick={chooseCodex}>{text.browse}</button>
        <button className={pressedPathAction === "test" ? "pressed" : ""} type="button" onClick={testCodex}>{text.test}</button>
      </div>
      <p className={codexStatus?.ok ? "codex-status ok" : "codex-status"}>
        {codexStatus?.ok ? `${text.found}: ${codexStatus.command}` : (codexStatus?.error ?? text.missing)}
      </p>
      <label className="remember"><input type="checkbox" defaultChecked /> {text.remember}</label>
      <button className="primary" disabled={state !== "idle"}>{state === "idle" ? text.connect : text.connecting}</button>
      <div className={state === "idle" ? "progress" : "progress active"}><span /></div>
      {error ? <p className="error-box">{error}</p> : null}
      <p className="server-hint">{text.hint}</p>
    </form>
  );
}

function ProfileEditor({ profile, onChange, onChoosePicture, onClearPicture, onClose }) {
  const [draft, setDraft] = useState(profile);

  useEffect(() => {
    setDraft(profile);
  }, [profile]);

  function update(field, value) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function submit(event) {
    event.preventDefault();
    onChange(draft);
  }

  function chooseDefaultPicture(picture) {
    setDraft((current) => ({
      ...current,
      displayPictureAsset: picture.src,
      displayPicturePath: ""
    }));
  }

  return (
    <form className="profile-editor" onSubmit={submit}>
      <div className="profile-editor-picture">
        <Avatar contact={{ ...draft, avatar: "butterfly", color: "#11a77a" }} />
        <div className="profile-picture-tools">
          <button type="button" onClick={onChoosePicture}>Changer</button>
          <button type="button" onClick={onClearPicture}>Defaut</button>
        </div>
      </div>
      <div className="profile-picture-gallery" aria-label="Images MSN par defaut">
        {msnDisplayPictures.map((picture) => (
          <button
            className={draft.displayPictureAsset === picture.src ? "active" : ""}
            key={picture.id}
            title={picture.label}
            type="button"
            onClick={() => chooseDefaultPicture(picture)}
          >
            <img src={picture.src} alt="" draggable="false" />
          </button>
        ))}
      </div>
      <label>
        <span>Nom affiche</span>
        <input value={draft.displayName ?? ""} onChange={(event) => update("displayName", event.target.value)} />
      </label>
      <label>
        <span>Message personnel</span>
        <input value={draft.personalMessage ?? ""} onChange={(event) => update("personalMessage", event.target.value)} maxLength={140} />
      </label>
      <label>
        <span>Statut</span>
        <select value={draft.status ?? "online"} onChange={(event) => update("status", event.target.value)}>
          {statusOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
        </select>
      </label>
      <div className="profile-editor-actions">
        <button type="submit">Appliquer</button>
        <button type="button" onClick={onClose}>Fermer</button>
      </div>
    </form>
  );
}

function AgentCreator({ onCreate, onClose, error }) {
  const [draft, setDraft] = useState({
    name: "Agent Specifique",
    group: "Agents personnalises",
    mood: "role sur mesure",
    status: "online",
    avatar: "lens",
    color: agentColorOptions[0],
    instructions: "Tu es un agent Codex specialise. Reponds en francais, garde ton role, pose les questions utiles, puis execute la tache de maniere pragmatique."
  });
  const [saving, setSaving] = useState(false);

  function update(field, value) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  async function submit(event) {
    event.preventDefault();
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
      {error ? <p className="agent-error">{error}</p> : null}
      <div className="agent-editor-actions">
        <button type="submit" disabled={saving}>{saving ? "Creation..." : "Creer et ouvrir"}</button>
        <button type="button" onClick={onClose}>Annuler</button>
      </div>
    </form>
  );
}

function RosterView({
  bootstrap,
  profile,
  userAgent,
  refreshTick,
  profileEditorOpen,
  agentEditorOpen,
  onProfileEditorOpenChange,
  onAgentEditorOpenChange,
  onProfileChange,
  onAgentsChange
}) {
  const [finished, setFinished] = useState(null);
  const [conversations, setConversations] = useState(bootstrap.conversations);
  const [unread, setUnread] = useState(bootstrap.unread ?? {});
  const [collapsed, setCollapsed] = useState({});
  const [query, setQuery] = useState("");
  const [agentError, setAgentError] = useState("");
  const [projectSort, setProjectSort] = useState(() => normalizeProjectSort(bootstrap.settings?.projectSort));
  const [projectSortMenu, setProjectSortMenu] = useState(null);
  const rosterRef = useRef(null);

  useEffect(() => {
    api.listConversations().then(setConversations).catch(() => {});
  }, [refreshTick]);

  useEffect(() => {
    const closeMenu = () => setProjectSortMenu(null);
    const closeOnEscape = (event) => {
      if (event.key === "Escape") closeMenu();
    };
    window.addEventListener("click", closeMenu);
    window.addEventListener("blur", closeMenu);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("blur", closeMenu);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  useEffect(() => api.on("conversation:finished", ({ contactId }) => {
    const contact = bootstrap.contacts.find((item) => item.id === contactId);
    if (!contact) return;
    setFinished(`${contact.name} a termine.`);
    window.setTimeout(() => setFinished(null), 4200);
  }), [bootstrap.contacts]);

  useEffect(() => {
    const offUnread = api.on("conversation:unread", ({ unread: nextUnread }) => {
      setUnread(nextUnread ?? {});
    });
    const offNotify = api.on("conversation:notify", () => {
      playNewMessage();
    });
    return () => {
      offUnread();
      offNotify();
    };
  }, []);

  const groups = useMemo(() => {
    const search = query.trim().toLowerCase();
    const match = (item) => `${item.name} ${item.statusText ?? ""} ${item.mood ?? ""}`.toLowerCase().includes(search);
    const byGroup = [];

    byGroup.push({
      id: "agents",
      title: "Codex Agents",
      items: bootstrap.contacts.map((contact) => ({
        id: contact.id,
        name: contact.name,
        mood: contact.mood,
        status: contact.status,
        statusText: statusLabels[contact.status] ?? contact.status,
        contact,
        onOpen: () => api.openConversation(contact.id)
      }))
    });

    const projectItems = sortProjects(conversations?.projects ?? [], projectSort).map((project) => {
      const contact = {
        id: project.id,
        name: project.name,
        mail: `${project.name.toLowerCase().replace(/[^a-z0-9]+/g, ".")}@project.local`,
        group: "Projets",
        mood: project.cwd,
        status: project.threads.length ? "online" : "offline",
        color: "#1f8fcf",
        avatar: "terminal",
        kind: "project",
        cwd: project.cwd,
        createdAt: project.createdAt,
        modifiedAt: project.modifiedAt,
        threadCount: projectThreadCount(project)
      };
      return {
        ...contact,
        statusText: projectThreadCount(project) ? `${projectThreadCount(project)} conversation${projectThreadCount(project) > 1 ? "s" : ""}` : "nouveau",
        contact,
        onOpen: () => api.openProject(project.cwd)
      };
    });
    if (projectItems.length) byGroup.push({ id: "projects", title: "Projects", items: projectItems });

    const threadItems = (conversations?.projects ?? [])
      .flatMap((project) => project.threads.map((thread) => ({ ...thread, projectName: project.name, cwd: project.cwd })))
      .sort((a, b) => String(b.timestamp ?? "").localeCompare(String(a.timestamp ?? "")))
      .slice(0, 28)
      .map((thread) => {
        const contact = {
          id: thread.contactId,
          name: thread.preview || thread.projectName,
          mail: `${thread.projectName.toLowerCase().replace(/[^a-z0-9]+/g, ".")}@thread.local`,
          group: thread.projectName,
          mood: thread.cwd,
          status: "online",
          color: "#2874d9",
          avatar: "terminal",
          kind: "thread",
          cwd: thread.cwd,
          threadId: thread.id
        };
        return {
          ...contact,
          statusText: thread.projectName,
          contact,
          onOpen: () => api.openThread(thread.id)
        };
      });
    if (threadItems.length) byGroup.push({ id: "threads", title: "Conversations recentes", items: threadItems });

    return byGroup.map((group) => ({
      ...group,
      items: search ? group.items.filter(match) : group.items
    })).filter((group) => group.items.length);
  }, [bootstrap.contacts, conversations, projectSort, query]);

  function toggleGroup(groupId) {
    setCollapsed((current) => ({ ...current, [groupId]: !current[groupId] }));
  }

  function openProjectSortMenu(event) {
    event.preventDefault();
    event.stopPropagation();
    const bounds = rosterRef.current?.getBoundingClientRect();
    const width = bounds?.width ?? window.innerWidth;
    const height = bounds?.height ?? window.innerHeight;
    const left = bounds ? event.clientX - bounds.left : event.clientX;
    const top = bounds ? event.clientY - bounds.top : event.clientY;
    setProjectSortMenu({
      x: Math.max(4, Math.min(left, width - 214)),
      y: Math.max(4, Math.min(top, height - 272))
    });
  }

  async function changeProjectSort(sort) {
    const nextSort = normalizeProjectSort(sort);
    setProjectSort(nextSort);
    setProjectSortMenu(null);
    try {
      await api.setSettings({ projectSort: nextSort });
    } catch {
      // Sorting still works for the current session if persistence fails.
    }
  }

  async function saveProfile(nextProfile) {
    const result = await api.setSettings({
      language: nextProfile.language ?? profile.language,
      profile: nextProfile
    });
    onProfileChange(result.settings.profile, userAgent, result.settings);
  }

  function changeStatus(status) {
    saveProfile({ ...profile, status });
  }

  async function chooseProfilePicture() {
    const result = await api.chooseProfilePicture();
    if (result?.canceled) return;
    onProfileChange(result.profile, userAgent, result.settings);
  }

  async function clearProfilePicture() {
    const result = await api.clearProfilePicture();
    onProfileChange(result.profile, userAgent, result.settings);
  }

  async function createAgent(draft) {
    setAgentError("");
    try {
      const result = await api.createAgent(draft);
      if (!result?.ok) throw new Error(result?.error || "Creation impossible.");
      onAgentsChange(result.contacts, result.settings);
      onAgentEditorOpenChange(false);
      await api.openConversation(result.contact.id);
    } catch (error) {
      setAgentError(error.message);
      throw error;
    }
  }

  return (
    <section className="roster" ref={rosterRef}>
      <div className="me">
        <button className="display-picture-button" type="button" onClick={() => onProfileEditorOpenChange(!profileEditorOpen)}>
          <Avatar contact={{ ...profile, avatar: "butterfly", color: "#11a77a" }} />
        </button>
        <div>
          <div className="me-line">
            <strong>{profile.displayName || profile.email}</strong>
            <select value={profile.status} onChange={(event) => changeStatus(event.target.value)}>
              {statusOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
            </select>
          </div>
          <small className="me-email">{profile.email}</small>
          <p>{profile.personalMessage || userAgent || "Codex local connecte"}</p>
        </div>
      </div>
      {profileEditorOpen ? (
        <ProfileEditor
          profile={profile}
          onChange={saveProfile}
          onChoosePicture={chooseProfilePicture}
          onClearPicture={clearProfilePicture}
          onClose={() => onProfileEditorOpenChange(false)}
        />
      ) : null}
      {agentEditorOpen ? (
        <AgentCreator
          error={agentError}
          onCreate={createAgent}
          onClose={() => {
            setAgentError("");
            onAgentEditorOpenChange(false);
          }}
        />
      ) : null}
      <div className="msn-tabs">
        <button type="button" onClick={() => api.openConversation("codex")}><Logo small /> Codex Today</button>
      </div>
      <div className="search"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search..." /></div>
      <div className="groups">
        {groups.map((group) => {
          const online = group.items.filter((item) => item.status !== "offline").length;
          return (
          <section className="roster-group" key={group.id}>
            <button
              className="group-heading"
              type="button"
              title={group.id === "projects" ? "Clic droit pour trier les projets" : undefined}
              onClick={() => toggleGroup(group.id)}
              onContextMenu={group.id === "projects" ? openProjectSortMenu : undefined}
            >
              <span className={collapsed[group.id] ? "group-box collapsed" : "group-box"} />
              <strong>{group.title} ({online}/{group.items.length})</strong>
              {group.id === "projects" ? <span className="group-sort-label">tri: {projectSortOption(projectSort).short}</span> : null}
            </button>
            {!collapsed[group.id] ? group.items.map((item) => {
              const pending = unread[item.id] ?? 0;
              return (
                <button className={pending ? "contact-line has-unread" : "contact-line"} type="button" key={item.id} onClick={item.onOpen}>
                  <span className={`msn-presence ${item.status}`} />
                  <span className="contact-mini-avatar"><Avatar contact={item.contact ?? item} /></span>
                  <span className="contact-line-copy">
                    <span className="contact-name">{item.name}</span>
                    <span className="contact-state">({item.statusText})</span>
                    <span className="contact-mood">{item.mood}</span>
                  </span>
                  {pending ? <span className="contact-unread-bubble" title={`${pending} message${pending > 1 ? "s" : ""} en attente`}>{pending > 9 ? "9+" : pending}</span> : <span className="contact-unread-spacer" />}
                </button>
              );
            }) : null}
          </section>
        );})}
      </div>
      {projectSortMenu ? (
        <div
          className="group-context-menu"
          style={{ left: projectSortMenu.x, top: projectSortMenu.y }}
          role="menu"
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <div className="group-context-title">Trier Projects par</div>
          {projectSortOptions.map((option) => (
            <button
              className={normalizeProjectSort(projectSort) === option.id ? "active" : ""}
              key={option.id}
              type="button"
              role="menuitemradio"
              aria-checked={normalizeProjectSort(projectSort) === option.id}
              onClick={() => changeProjectSort(option.id)}
            >
              <span>{option.label}</span>
              <small>{option.detail}</small>
            </button>
          ))}
        </div>
      ) : null}
      <button className="add-contact" type="button" onClick={() => onAgentEditorOpenChange(true)}><span className="mini plus" /> Add a Contact</button>
      <div className="wordmark"><span>Codex</span><Logo small /><strong>Messenger</strong></div>
      {finished ? <div className="toast"><Logo small /><span>{finished}</span></div> : null}
    </section>
  );
}

function MainWindow() {
  const [bootstrap, setBootstrap] = useState(null);
  const [profile, setProfile] = useState(null);
  const [userAgent, setUserAgent] = useState("");
  const [settings, setSettings] = useState(null);
  const [codexStatus, setCodexStatus] = useState(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [profileEditorOpen, setProfileEditorOpen] = useState(false);
  const [agentEditorOpen, setAgentEditorOpen] = useState(false);

  useEffect(() => {
    api.bootstrap().then((data) => {
      setBootstrap(data);
      setProfile(data.profile);
      setUserAgent(data.userAgent ?? "");
      setSettings(data.settings);
      setCodexStatus(data.codexStatus);
    });
  }, []);

  if (!bootstrap || !profile) return <div className="loading">Connexion...</div>;

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
    const value = window.prompt("Delai Wizz de rappel (secondes)", String(currentSeconds));
    if (value === null) return;
    const seconds = normalizeWizzDelaySeconds(value);
    const result = await api.setSettings({ unreadWizzDelayMs: seconds * 1000 });
    setSettings(result.settings);
    setBootstrap((current) => current ? { ...current, settings: result.settings } : current);
  }

  function openAgentCreator() {
    setAgentEditorOpen(true);
  }

  const uploadsPath = `${bootstrap.cwd}\\uploads`;
  const mainMenus = [
    {
      label: "Fichier",
      entries: [
        { label: "Nouvelle conversation Codex", action: () => api.openConversation("codex") },
        { label: "Ouvrir un projet...", action: () => api.openProjectPicker() },
        { label: "Modifier mon profil...", action: () => setProfileEditorOpen(true) },
        { separator: true },
        { label: "Ouvrir le dossier de l'app", action: () => api.app.openPath(bootstrap.cwd) },
        { label: "Quitter", shortcut: "Alt+F4", action: () => api.app.quit() }
      ]
    },
    {
      label: "Contacts",
      entries: [
        ...bootstrap.contacts.map((contact) => ({
          label: `${contact.name} (${statusLabels[contact.status] ?? contact.status})`,
          action: () => api.openConversation(contact.id)
        })),
        { separator: true },
        { label: "Add a Contact", action: openAgentCreator }
      ]
    },
    {
      label: "Actions",
      entries: [
        { label: "Codex Today", action: () => api.openConversation("codex") },
        { label: "Rafraichir la liste", shortcut: "F5", action: () => setRefreshTick((tick) => tick + 1) },
        { separator: true },
        ...statusOptions.map(([status, label]) => ({
          label: `Statut: ${label}`,
          action: () => saveProfilePatch({ status })
        })),
        { separator: true },
        {
          label: "Wizz Codex",
          action: async () => {
            await api.openConversation("codex");
            window.setTimeout(() => api.wizz("codex"), 250);
          }
        }
      ]
    },
    {
      label: "Outils",
      entries: [
        { label: "Dossier uploads", action: () => api.app.openPath(uploadsPath) },
        { label: "Relancer cette fenetre", shortcut: "Ctrl+R", action: () => api.app.reload() },
        { label: "Delai Wizz rappel...", action: changeWizzDelay },
        { separator: true },
        { label: "Minimiser", action: () => api.window.minimize() },
        { label: "Maximiser / restaurer", action: () => api.window.maximize() }
      ]
    },
    {
      label: "Aide",
      entries: [
        {
          label: "A propos de Codex Messenger",
          action: () => window.alert("Codex Messenger\n\nClient Electron local inspire de MSN Messenger 7, connecte a codex app-server.\n\nDeveloppe par Anis AYARI et Codex.")
        },
        { label: "Serveur Codex", action: () => window.alert(userAgent || "Serveur Codex non connecte.") }
      ]
    }
  ];

  return (
    <main className="msn-window">
      <Titlebar title="Codex Messenger" />
      <Menu items={mainMenus} />
      {userAgent ? (
        <RosterView
          bootstrap={bootstrap}
          profile={profile}
          userAgent={userAgent}
          refreshTick={refreshTick}
          profileEditorOpen={profileEditorOpen}
          agentEditorOpen={agentEditorOpen}
          onProfileEditorOpenChange={setProfileEditorOpen}
          onAgentEditorOpenChange={setAgentEditorOpen}
          onAgentsChange={updateAgents}
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

function Tool({ icon, label, onClick, active = false }) {
  return (
    <button className={active ? `tool ${icon} active` : `tool ${icon}`} type="button" onClick={(event) => onClick?.(event)}>
      <span className={`tool-icon ${icon}`}><img src={toolbarIcons[icon]} alt="" draggable="false" /></span>
      <span>{label}</span>
    </button>
  );
}

function FormatButton({ icon, title, onClick, label, active = false }) {
  return (
    <button className={`${label ? "format-button wide" : "format-button"}${active ? " active" : ""}`} type="button" title={title} onClick={(event) => onClick?.(event)}>
      <img src={formatIcons[icon]} alt="" draggable="false" />
      {label ? <span>{label}</span> : null}
    </button>
  );
}

function PopupPanel({ title, children }) {
  return (
    <div className="popup-panel">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

function InvitePanel({ contact, onRun, onOpenProject }) {
  const statusText = statusLabels[contact.status] ?? contact.status ?? "En ligne";
  return (
    <PopupPanel title="Invite">
      <div className="popup-contact-row">
        <Avatar contact={contact} />
        <div><strong>{contact.name}</strong><span>{statusText}</span></div>
      </div>
      <div className="popup-command-list">
        <button type="button" onClick={() => onRun(`Invite ${contact.name} dans cette conversation Codex et resume son role.`)}>Inviter dans la conversation</button>
        <button type="button" onClick={() => onRun(`Resume le role de ${contact.name}, puis propose la prochaine action concrete.`)}>Resume le contact</button>
        <button type="button" onClick={onOpenProject} disabled={!contact.cwd}>Ouvrir le projet</button>
      </div>
    </PopupPanel>
  );
}

function FilesPanel({ onSendFile, onCamera, onOpenProject, canOpenProject }) {
  return (
    <PopupPanel title="Send Files">
      <div className="popup-command-list">
        <button type="button" onClick={onSendFile}>Envoyer un fichier ou une image...</button>
        <button type="button" onClick={onCamera}>Capture webcam...</button>
        <button type="button" onClick={onOpenProject} disabled={!canOpenProject}>Ouvrir le dossier projet</button>
      </div>
    </PopupPanel>
  );
}

function VoicePanel({ recording, mediaError, onToggle }) {
  return (
    <PopupPanel title="Voice Clip">
      <div className="popup-command-list">
        <button className={recording ? "recording" : ""} type="button" onClick={onToggle}>
          {recording ? "Arreter et envoyer" : "Demarrer l'enregistrement"}
        </button>
      </div>
      {mediaError ? <p className="popup-error">{mediaError}</p> : null}
    </PopupPanel>
  );
}

function TextStylePanel({ textStyle, onChange, onReset }) {
  const style = normalizeTextStyle(textStyle);
  return (
    <PopupPanel title="Rendu du texte">
      <label className="text-style-field">
        <span>Police</span>
        <select value={style.fontFamily} onChange={(event) => onChange({ fontFamily: event.target.value })}>
          {textFontOptions.map((font) => <option value={font} key={font}>{font}</option>)}
        </select>
      </label>
      <label className="text-style-field">
        <span>Taille</span>
        <input type="number" min="9" max="18" value={style.fontSize} onChange={(event) => onChange({ fontSize: event.target.value })} />
      </label>
      <div className="text-style-field">
        <span>Texte</span>
        <div className="text-style-swatches">
          {textColorOptions.map((color) => (
            <button
              className={style.color === color ? "active" : ""}
              type="button"
              key={color}
              title={color}
              style={{ backgroundColor: color }}
              onClick={() => onChange({ color })}
            />
          ))}
        </div>
      </div>
      <div className="text-style-field">
        <span>Bulle Codex</span>
        <div className="text-style-swatches">
          {bubbleColorOptions.map((color) => (
            <button
              className={style.bubble === color ? "active" : ""}
              type="button"
              key={color}
              title={color}
              style={{ backgroundColor: color }}
              onClick={() => onChange({ bubble: color })}
            />
          ))}
        </div>
      </div>
      <div className="text-style-field">
        <span>Ma bulle</span>
        <div className="text-style-swatches">
          {bubbleColorOptions.map((color) => (
            <button
              className={style.meBubble === color ? "active" : ""}
              type="button"
              key={color}
              title={color}
              style={{ backgroundColor: color }}
              onClick={() => onChange({ meBubble: color })}
            />
          ))}
        </div>
      </div>
      <div
        className="text-style-preview"
        style={{
          color: style.color,
          fontFamily: style.fontFamily,
          fontSize: `${style.fontSize}px`,
          background: `linear-gradient(#ffffff, ${style.bubble})`
        }}
      >
        Salut, je garde ce rendu pour cette conversation :)
      </div>
      <div className="popup-command-list">
        <button type="button" onClick={onReset}>Revenir au rendu par defaut</button>
      </div>
    </PopupPanel>
  );
}

function CameraPanel({ videoRef, cameraStream, mediaError, onSnapshot, onStop }) {
  return (
    <div className="media-panel camera-panel">
      <video ref={videoRef} autoPlay muted playsInline />
      <div className="media-actions">
        <button type="button" onClick={onSnapshot} disabled={!cameraStream}>Snapshot</button>
        <button type="button" onClick={onStop} disabled={!cameraStream}>Stop</button>
      </div>
      {mediaError ? <p>{mediaError}</p> : null}
    </div>
  );
}

function ThreadTabs({ project, contact, activeThreadId, onOpenProject, onOpenThread, onDeleteThread, onReorderThreads }) {
  const [dragThreadId, setDragThreadId] = useState("");
  const threads = project?.threads ?? [];
  if (!project) {
    return <div className="to-line">A: {contact.name}</div>;
  }

  function reorder(targetThreadId) {
    if (!dragThreadId || dragThreadId === targetThreadId) return;
    const ids = threads.map((thread) => thread.id);
    const from = ids.indexOf(dragThreadId);
    const to = ids.indexOf(targetThreadId);
    if (from < 0 || to < 0) return;
    const next = [...ids];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onReorderThreads(next);
  }

  return (
    <div className="thread-tab-bar">
      <span className="thread-to-label" title={project.cwd}>A: {project.name}</span>
      <div className="thread-tab-strip" aria-label="Fils Codex">
        {threads.length ? threads.map((thread) => (
          <div
            className={dragThreadId === thread.id ? "thread-tab-wrap dragging" : "thread-tab-wrap"}
            draggable
            key={thread.id}
            onDragStart={(event) => {
              setDragThreadId(thread.id);
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", thread.id);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
            }}
            onDrop={(event) => {
              event.preventDefault();
              reorder(thread.id);
              setDragThreadId("");
            }}
            onDragEnd={() => setDragThreadId("")}
          >
            <button
              className={activeThreadId === thread.id ? "thread-tab active" : "thread-tab"}
              type="button"
              title={thread.preview}
              onClick={() => onOpenThread(thread.id)}
            >
              <span>{thread.preview}</span>
            </button>
            <button
              className="thread-tab-close"
              type="button"
              title="Supprimer ce fil"
              aria-label={`Supprimer ${thread.preview}`}
              onClick={(event) => {
                event.stopPropagation();
                onDeleteThread(thread);
              }}
            >
              x
            </button>
          </div>
        )) : (
          <button className="thread-tab active new-thread-tab" type="button" onClick={() => onOpenProject(project.cwd)}>
            <span>Nouveau fil</span>
          </button>
        )}
      </div>
    </div>
  );
}

function ActivitiesPanel({ onRun, onSendWink, onAskWink, onPreviewSound }) {
  return (
    <div className="activities-panel">
      <section className="activity-section">
        <h3>Clins d'oeil</h3>
        <div className="wink-grid">
          {winkCatalog.map((wink) => (
            <button type="button" key={wink.id} onClick={() => onSendWink(wink)}>
              <img src={wink.src} alt="" draggable="false" />
              <span>{wink.label}</span>
            </button>
          ))}
        </div>
        <button className="activity-command" type="button" onClick={() => onAskWink(winkCatalog[Math.floor(Math.random() * winkCatalog.length)])}>
          Demander a Codex
        </button>
      </section>
      <section className="activity-section">
        <h3>Sons MSN</h3>
        <div className="sound-grid">
          {soundCatalog.map(([id, label]) => (
            <button type="button" key={id} onClick={() => onPreviewSound(id)}>{label}</button>
          ))}
        </div>
      </section>
      <section className="activity-section">
        <h3>Actions</h3>
        {activityPrompts.map(([label, prompt]) => (
          <button className="activity-command" type="button" key={label} onClick={() => onRun(prompt)}>{label}</button>
        ))}
      </section>
    </div>
  );
}

function EmoticonsPanel({ onInsert }) {
  return (
    <div className="emoticons-panel">
      <section className="activity-section">
        <h3>Emoticones MSN 7.5</h3>
        <div className="emoticon-grid">
          {msnEmoticons.map((emoticon) => (
            <button type="button" key={emoticon.id} title={`${emoticon.label} ${emoticon.code}`} onClick={() => onInsert(emoticon)}>
              <img src={emoticon.src} alt="" draggable="false" />
              <span>{emoticon.code}</span>
            </button>
          ))}
        </div>
      </section>
      <section className="activity-section">
        <h3>Emoticones animees</h3>
        <div className="emoticon-grid animated">
          {animatedInlineEmoticons.map((emoticon) => (
            <button type="button" key={emoticon.id} title={`${emoticon.label} ${emoticon.code}`} onClick={() => onInsert(emoticon)}>
              <img src={emoticon.src} alt="" draggable="false" />
              <span>{emoticon.code}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function gameWinner(board) {
  for (const [a, b, c] of ticLines) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
  }
  if (board.every(Boolean)) return "draw";
  return null;
}

function chooseCodexMove(board) {
  const empty = board.map((cell, index) => cell ? null : index).filter((index) => index !== null);
  const testMove = (mark) => empty.find((index) => {
    const next = [...board];
    next[index] = mark;
    return gameWinner(next) === mark;
  });
  return testMove("O") ?? testMove("X") ?? (board[4] ? null : 4) ?? [0, 2, 6, 8].find((index) => !board[index]) ?? empty[0] ?? null;
}

function createMemoryDeck() {
  return memorySymbols
    .flatMap((symbol) => [symbol, symbol])
    .sort(() => Math.random() - 0.5)
    .map((symbol, index) => ({ id: `${symbol.id}-${index}-${Math.random()}`, symbol, matched: false }));
}

function nextReflexTarget(current = -1) {
  let next = Math.floor(Math.random() * 9);
  if (next === current) next = (next + 1) % 9;
  return next;
}

function GamesPanel({ activeGame, onSelectGame, onRun, waiting }) {
  return (
    <div className="games-panel">
      <div className={waiting ? "game-presence thinking" : "game-presence"}>
        <Logo small />
        <span>{waiting ? "Codex reflechit..." : "Codex joue aussi"}</span>
      </div>
      <div className="game-tabs">
        {gameCatalog.map((game) => (
          <button className={activeGame === game.id ? "active" : ""} type="button" key={game.id} onClick={() => onSelectGame(game.id)}>
            {game.label}
          </button>
        ))}
      </div>
      {activeGame === "morpion" ? <TicTacToeGame /> : null}
      {activeGame === "memory" ? <MemoryGame /> : null}
      {activeGame === "wizz" ? <WizzReflexGame /> : null}
      <div className="chat-game-prompts">
        <button type="button" onClick={() => onRun(gamePrompts[Math.floor(Math.random() * gamePrompts.length)][1])}>Defi chat Codex</button>
      </div>
    </div>
  );
}

function TicTacToeGame() {
  const [board, setBoard] = useState(Array(9).fill(""));
  const [status, setStatus] = useState("A toi de jouer.");
  const [codexThinking, setCodexThinking] = useState(false);
  const winner = gameWinner(board);

  function reset() {
    setBoard(Array(9).fill(""));
    setStatus("A toi de jouer.");
    setCodexThinking(false);
  }

  function play(index) {
    if (board[index] || winner || codexThinking) return;
    const playerBoard = [...board];
    playerBoard[index] = "X";
    const playerWinner = gameWinner(playerBoard);
    setBoard(playerBoard);
    if (playerWinner === "X") {
      setStatus("Tu gagnes contre Codex.");
      return;
    }
    if (playerWinner === "draw") {
      setStatus("Match nul.");
      return;
    }
    setCodexThinking(true);
    setStatus("Codex joue...");
    window.setTimeout(() => {
      const move = chooseCodexMove(playerBoard);
      const codexBoard = [...playerBoard];
      if (move !== null) codexBoard[move] = "O";
      const result = gameWinner(codexBoard);
      setBoard(codexBoard);
      setCodexThinking(false);
      if (result === "O") setStatus("Codex gagne cette manche.");
      else if (result === "draw") setStatus("Match nul.");
      else setStatus("A toi de jouer.");
    }, 380);
  }

  return (
    <section className="game-card">
      <div className="game-head"><strong>Morpion</strong><button type="button" onClick={reset}>New</button></div>
      <div className="tic-grid">
        {board.map((cell, index) => (
          <button className={cell ? `tic-cell ${cell.toLowerCase()}` : "tic-cell"} type="button" key={index} onClick={() => play(index)} disabled={Boolean(cell) || Boolean(winner) || codexThinking}>
            {cell === "X" ? <img src={gameAssets.x} alt="X" /> : null}
            {cell === "O" ? <img src={gameAssets.o} alt="O" /> : null}
          </button>
        ))}
      </div>
      <p className="game-status">{status}</p>
    </section>
  );
}

function MemoryGame() {
  const [deck, setDeck] = useState(createMemoryDeck);
  const [open, setOpen] = useState([]);
  const [moves, setMoves] = useState(0);
  const [status, setStatus] = useState("Trouve les paires Codex.");

  function reset() {
    setDeck(createMemoryDeck());
    setOpen([]);
    setMoves(0);
    setStatus("Trouve les paires Codex.");
  }

  function flip(index) {
    if (open.length === 2 || open.includes(index) || deck[index].matched) return;
    const nextOpen = [...open, index];
    setOpen(nextOpen);
    if (nextOpen.length !== 2) return;
    setMoves((current) => current + 1);
    const [first, second] = nextOpen;
    if (deck[first].symbol.id === deck[second].symbol.id) {
      const nextDeck = deck.map((card, cardIndex) => cardIndex === first || cardIndex === second ? { ...card, matched: true } : card);
      setDeck(nextDeck);
      setOpen([]);
      setStatus(nextDeck.every((card) => card.matched) ? "Toutes les paires sont trouvees." : "Paire trouvee.");
      return;
    }
    setStatus("Codex a vu la paire. Reessaie.");
    window.setTimeout(() => setOpen([]), 650);
  }

  return (
    <section className="game-card">
      <div className="game-head"><strong>Memory</strong><button type="button" onClick={reset}>New</button></div>
      <div className="memory-grid">
        {deck.map((card, index) => {
          const visible = card.matched || open.includes(index);
          return (
            <button className={visible ? "memory-card visible" : "memory-card"} type="button" key={card.id} onClick={() => flip(index)}>
              {visible ? <img src={card.symbol.src} alt={card.symbol.label} /> : <img src="./msn-assets/games/game-card.png" alt="?" />}
            </button>
          );
        })}
      </div>
      <p className="game-status">{status} Coups: {moves}</p>
    </section>
  );
}

function WizzReflexGame() {
  const [target, setTarget] = useState(() => nextReflexTarget());
  const [score, setScore] = useState({ me: 0, codex: 0 });
  const [running, setRunning] = useState(true);
  const [status, setStatus] = useState("Clique le Wizz avant Codex.");

  useEffect(() => {
    if (!running) return undefined;
    const timeout = window.setTimeout(() => {
      setScore((current) => {
        const codex = current.codex + 1;
        if (codex >= 10) {
          setRunning(false);
          setStatus("Codex gagne au reflexe.");
        } else {
          setStatus("Codex marque.");
          setTarget((currentTarget) => nextReflexTarget(currentTarget));
        }
        return { ...current, codex };
      });
    }, 1900);
    return () => window.clearTimeout(timeout);
  }, [target, running]);

  function reset() {
    setScore({ me: 0, codex: 0 });
    setTarget(nextReflexTarget());
    setRunning(true);
    setStatus("Clique le Wizz avant Codex.");
  }

  function hit(index) {
    if (!running || index !== target) return;
    setScore((current) => {
      const me = current.me + 1;
      if (me >= 10) {
        setRunning(false);
        setStatus("Tu gagnes le Wizz Reflex.");
      } else {
        setStatus("Point pour toi.");
        setTarget((currentTarget) => nextReflexTarget(currentTarget));
      }
      return { ...current, me };
    });
  }

  return (
    <section className="game-card">
      <div className="game-head"><strong>Wizz Reflex</strong><button type="button" onClick={reset}>New</button></div>
      <div className="game-score"><span>Toi {score.me}</span><span>Codex {score.codex}</span></div>
      <div className="reflex-grid">
        {Array.from({ length: 9 }).map((_, index) => (
          <button className={index === target && running ? "reflex-cell target" : "reflex-cell"} type="button" key={index} onClick={() => hit(index)}>
            {index === target && running ? <img src={gameAssets.bell} alt="Wizz" /> : null}
          </button>
        ))}
      </div>
      <p className="game-status">{status}</p>
    </section>
  );
}

function ChatWindow({ bootstrap }) {
  const contact = bootstrap.contact ?? bootstrap.contacts.find((item) => item.id === bootstrap.contactId) ?? bootstrap.contacts[0];
  const conversationAgentName = contact.kind === "project" || contact.kind === "thread" ? "Codex" : contact.name;
  const selfContact = {
    id: "self",
    name: bootstrap.profile.displayName,
    status: bootstrap.profile.status,
    displayPicturePath: bootstrap.profile.displayPicturePath,
    displayPictureAsset: bootstrap.profile.displayPictureAsset,
    personalMessage: bootstrap.profile.personalMessage,
    color: "#6e8799",
    avatar: "butterfly"
  };
  const [messages, setMessages] = useState(bootstrap.historyMessages ?? []);
  const [draft, setDraft] = useState("");
  const [typing, setTyping] = useState(false);
  const [conversations, setConversations] = useState(bootstrap.conversations);
  const [chatSettings, setChatSettings] = useState(bootstrap.settings ?? {});
  const [textStyle, setTextStyle] = useState(() => textStyleForContact(bootstrap.settings, contact.id));
  const [openFlyout, setOpenFlyout] = useState("");
  const [flyoutPosition, setFlyoutPosition] = useState({ left: 8, top: 88, arrowX: 24, placement: "below" });
  const [activeGame, setActiveGame] = useState("morpion");
  const [cameraStream, setCameraStream] = useState(null);
  const [recording, setRecording] = useState(false);
  const [mediaError, setMediaError] = useState("");
  const [activeThreadId, setActiveThreadId] = useState(contact.threadId ?? "");
  const scrollRef = useRef(null);
  const stickToBottomRef = useRef(true);
  const videoRef = useRef(null);
  const textareaRef = useRef(null);
  const recorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const flyoutRef = useRef(null);
  const chatWindowRef = useRef(null);
  const currentProject = useMemo(() => {
    const projects = conversations?.projects ?? [];
    if (contact.cwd) return projects.find((project) => project.cwd === contact.cwd) ?? null;
    return null;
  }, [contact.cwd, conversations]);

  useEffect(() => {
    setActiveThreadId(contact.threadId ?? "");
  }, [contact.id, contact.threadId]);

  useEffect(() => {
    const projectName = contact.cwd ? (currentProject?.name ?? contact.name) : "";
    document.title = contact.kind === "project"
      ? `${contact.name} - Codex Messenger`
      : contact.kind === "thread"
        ? `${contact.name} - ${projectName || "Codex"}`
        : `${contact.name} - Conversation`;
  }, [contact.kind, contact.name, contact.cwd, currentProject?.name]);

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
    api.listConversations().then(setConversations).catch(() => {});
  }, [contact.id]);

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

  useEffect(() => {
    const offDelta = api.on("codex:delta", ({ contactId, delta }) => {
      if (contactId !== contact.id) return;
      setTyping(false);
      setMessages((current) => {
        if (!current[current.length - 1]?.streaming) playNewMessage();
        return appendAgentDelta(current, conversationAgentName, delta);
      });
    });
    const offCompleted = api.on("codex:completed-item", ({ contactId, text }) => {
      if (contactId !== contact.id || !text) return;
      const incomingWink = extractWinkFromText(text).wink;
      if (incomingWink) playWink(incomingWink);
      setTyping(false);
      setMessages((current) => {
        if (!current[current.length - 1]?.streaming && !incomingWink) playNewMessage();
        return finishAgentMessage(current, conversationAgentName, text);
      });
    });
    const offTyping = api.on("codex:typing", ({ contactId }) => {
      if (contactId === contact.id) setTyping(true);
    });
    const offDone = api.on("codex:done", ({ contactId }) => {
      if (contactId === contact.id) setTyping(false);
    });
    const offError = api.on("codex:error", ({ contactId, text }) => {
      if (contactId !== contact.id) return;
      setTyping(false);
      setMessages((current) => [...current, makeMessage("system", "system", text)]);
    });
    const offWizz = api.on("window:wizz", () => {
      playWizz();
    });
    return () => {
      offDelta(); offCompleted(); offTyping(); offDone(); offError(); offWizz();
    };
  }, [contact.id, conversationAgentName]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element || !stickToBottomRef.current) return;
    element.scrollTo({ top: element.scrollHeight, behavior: "auto" });
  }, [messages, typing]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return undefined;
    const updateStickiness = () => {
      const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
      stickToBottomRef.current = distanceFromBottom < 48;
    };
    element.addEventListener("scroll", updateStickiness, { passive: true });
    updateStickiness();
    return () => element.removeEventListener("scroll", updateStickiness);
  }, []);

  async function sendItems(items, displayText, options = {}) {
    const cleanText = String(displayText ?? "").trim();
    if (!items.length || !cleanText) return;
    stickToBottomRef.current = true;
    setMessages((current) => [...current, makeMessage("me", bootstrap.profile.displayName, cleanText, options)]);
    setTyping(true);
    api.markRead(contact.id);
    try {
      const result = await api.sendItems(contact.id, items);
      if (result?.threadId) setActiveThreadId(result.threadId);
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
    sendItems([{ type: "text", text: clean }], clean);
    setDraft("");
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

  function flyoutSize(name) {
    if (name === "emoticons") return { width: 344, height: 278 };
    if (name === "text") return { width: 284, height: 318 };
    if (name === "activities") return { width: 318, height: 360 };
    if (name === "games") return { width: 288, height: 322 };
    if (name === "camera") return { width: 250, height: 240 };
    if (name === "files") return { width: 254, height: 136 };
    if (name === "voice") return { width: 246, height: 112 };
    return { width: 246, height: 146 };
  }

  function placeFlyout(name, event) {
    const root = chatWindowRef.current?.getBoundingClientRect();
    const target = event?.currentTarget?.getBoundingClientRect?.();
    const { width, height } = flyoutSize(name);
    const rootWidth = root?.width ?? window.innerWidth;
    const rootHeight = root?.height ?? window.innerHeight;
    const center = target
      ? target.left + target.width / 2 - (root?.left ?? 0)
      : Math.min(rootWidth - 24, Math.max(24, rootWidth / 2));
    const rawLeft = Math.round(center - width / 2);
    const left = Math.max(8, Math.min(rawLeft, rootWidth - width - 8));
    const targetTop = target ? target.top - (root?.top ?? 0) : 82;
    const targetBottom = target ? target.bottom - (root?.top ?? 0) : 118;
    const hasRoomAbove = targetTop > height + 12;
    const placement = hasRoomAbove && targetTop > rootHeight * 0.42 ? "above" : "below";
    const top = placement === "above"
      ? Math.max(8, targetTop - height - 6)
      : Math.min(rootHeight - height - 8, targetBottom - 1);
    setFlyoutPosition({
      left,
      top: Math.max(8, top),
      arrowX: Math.max(12, Math.min(width - 12, center - left)),
      placement
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

  function handleSearch() {
    const query = window.prompt("Search transcript", "");
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

  function changeConversationFontSize() {
    const value = window.prompt("Taille du texte (9-18)", String(textStyle.fontSize));
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

  function sendWink(wink) {
    playWink(wink);
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
    setActiveThreadId(threadId);
    if (contact.kind === "project") {
      const result = await api.loadThread({ contactId: contact.id, threadId });
      if (result?.messages) {
        stickToBottomRef.current = true;
        setMessages(result.messages);
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

  const chatMenus = [
    {
      label: "File",
      entries: [
        { label: "Send Files...", action: handleSendFile },
        { label: "Open Project...", action: () => api.openProjectPicker() },
        { label: "Save Conversation...", action: saveTranscript },
        { separator: true },
        { label: "Close", shortcut: "Alt+F4", action: () => api.window.close() }
      ]
    },
    {
      label: "Edit",
      entries: [
        { label: "Undo", shortcut: "Ctrl+Z", action: () => document.execCommand("undo") },
        { separator: true },
        { label: "Cut", shortcut: "Ctrl+X", action: () => copyDraft(true) },
        { label: "Copy", shortcut: "Ctrl+C", action: () => copyDraft(false) },
        { label: "Paste", shortcut: "Ctrl+V", action: pasteDraft },
        { label: "Select All", shortcut: "Ctrl+A", action: selectAllDraft },
        { separator: true },
        { label: "Clear Text", action: () => setDraft("") }
      ]
    },
    {
      label: "Format",
      entries: [
        { label: "Text Appearance...", action: () => openPanel("text") },
        { label: "Font: Tahoma", action: () => saveConversationTextStyle({ ...textStyle, fontFamily: "Tahoma" }) },
        { label: "Font: Verdana", action: () => saveConversationTextStyle({ ...textStyle, fontFamily: "Verdana" }) },
        { label: "Font: Comic Sans MS", action: () => saveConversationTextStyle({ ...textStyle, fontFamily: "Comic Sans MS" }) },
        { label: "Text Size...", action: changeConversationFontSize },
        { separator: true },
        { label: "Reset Conversation Text", action: resetConversationTextStyle }
      ]
    },
    {
      label: "Actions",
      entries: [
        { label: "Invite", action: () => toggleFlyout("invite") },
        { label: "Wizz", action: () => api.wizz(contact.id) },
        { label: "Send Wink", action: () => toggleFlyout("activities") },
        { label: "Emoticons", action: () => toggleFlyout("emoticons") },
        { label: "Search Transcript...", action: handleSearch },
        { separator: true },
        { label: "Activities", action: () => toggleFlyout("activities") },
        { label: "Games", action: () => toggleFlyout("games") },
        { label: "Play Morpion", action: () => { setActiveGame("morpion"); openPanel("games"); } },
        { label: "Play Memory", action: () => { setActiveGame("memory"); openPanel("games"); } },
        { label: "Play Wizz Reflex", action: () => { setActiveGame("wizz"); openPanel("games"); } }
      ]
    },
    {
      label: "Tools",
      entries: [
        { label: "Start Camera", action: startCamera },
        { label: recording ? "Stop Voice Clip" : "Voice Clip", action: toggleVoiceClip },
        { label: "Send Image/File...", action: handleSendFile },
        { separator: true },
        { label: "Open App Folder", action: () => api.app.openPath(bootstrap.cwd) },
        { label: "Open Uploads Folder", action: () => api.app.openPath(`${bootstrap.cwd}\\uploads`) },
        { label: "Reload Window", shortcut: "Ctrl+R", action: () => api.app.reload() }
      ]
    },
    {
      label: "Help",
      entries: [
        {
          label: "About Codex Messenger",
          action: () => window.alert("Codex Messenger\n\nFenetre de conversation MSN 7 reliee a codex app-server.\n\nDeveloppe par Anis AYARI et Codex.")
        },
        {
          label: "Keyboard Shortcuts",
          action: () => window.alert("Enter: envoyer\nShift+Enter: nouvelle ligne\nCtrl+A/C/X/V: edition du message\nWizz: secoue la fenetre et joue le son.")
        }
      ]
    }
  ];

  return (
    <main className="msn-window chat" ref={chatWindowRef}>
      <Titlebar title={`${contact.name} - Conversation`} />
      <Menu items={chatMenus} />
      <div className="toolbar-shell">
        <div className="toolbar">
          <Tool icon="invite" label="Invite" active={openFlyout === "invite"} onClick={(event) => toggleFlyout("invite", event)} />
          <Tool icon="files" label="Send Files" active={openFlyout === "files"} onClick={(event) => toggleFlyout("files", event)} />
          <Tool icon="video" label="Video" active={openFlyout === "camera"} onClick={startCamera} />
          <Tool icon="voice" label={recording ? "Stop" : "Voice"} active={openFlyout === "voice" || recording} onClick={(event) => toggleFlyout("voice", event)} />
          <Tool icon="activities" label="Activities" active={openFlyout === "activities"} onClick={(event) => toggleFlyout("activities", event)} />
          <Tool icon="games" label="Games" active={openFlyout === "games"} onClick={(event) => toggleFlyout("games", event)} />
          <div className="toolbar-brand"><span>Codex</span><Logo small /></div>
        </div>
      </div>
      {openFlyout ? (
        <div
          ref={flyoutRef}
          className={`toolbar-flyout ${openFlyout} ${flyoutPosition.placement}`}
          style={{ left: flyoutPosition.left, top: flyoutPosition.top, "--arrow-x": `${flyoutPosition.arrowX}px` }}
        >
          {openFlyout === "invite" ? (
            <InvitePanel
              contact={contact}
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
              onRun={sendQuickPrompt}
              onSendWink={sendWink}
              onAskWink={askCodexWink}
              onPreviewSound={playSoundKey}
            />
          ) : null}
          {openFlyout === "emoticons" ? (
            <EmoticonsPanel
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
        <div className="chat-main">
          <ThreadTabs
            project={currentProject}
            contact={contact}
            activeThreadId={activeThreadId}
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
            {messages.map((message) => <Message key={message.id} message={message} />)}
            {typing ? <div className="typing"><i /><i /><i />{conversationAgentName} ecrit...</div> : null}
          </div>
          <div className="format-strip">
            <FormatButton icon="font" title="Rendu texte" active={openFlyout === "text"} onClick={(event) => toggleFlyout("text", event)} />
            <FormatButton icon="smile" title="Emoticones MSN" active={openFlyout === "emoticons"} onClick={(event) => toggleFlyout("emoticons", event)} />
            <FormatButton icon="voice" title="Voice Clip" label={recording ? "Stop" : "Voice Clip"} active={openFlyout === "voice" || recording} onClick={(event) => toggleFlyout("voice", event)} />
            <FormatButton icon="wink" title="Clin d'oeil" active={openFlyout === "activities"} onClick={(event) => toggleFlyout("activities", event)} />
            <FormatButton icon="image" title="Image" active={openFlyout === "files"} onClick={(event) => toggleFlyout("files", event)} />
            <FormatButton icon="gift" title="Activites" active={openFlyout === "activities"} onClick={(event) => toggleFlyout("activities", event)} />
            <FormatButton icon="wizz" title="Wizz" onClick={() => api.wizz(contact.id)} />
            <FormatButton icon="laugh" title="Rire" onClick={() => insertDraft(" :D")} />
            {recording ? <span className="format-status recording">Recording...</span> : null}
            {!recording && mediaError && !openFlyout ? <span className="format-status error">{mediaError}</span> : null}
          </div>
          <form className="composer" onSubmit={submit}>
            <textarea ref={textareaRef} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) submit(event);
            }} />
            <div><button type="submit">Send</button><button type="button" onClick={handleSearch}>Search</button></div>
          </form>
        </div>
        <aside className="chat-side">
          <div className="display-frame top"><Avatar contact={contact} large /></div>
          <div className="display-frame bottom"><Avatar contact={selfContact} large /></div>
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

function Message({ message }) {
  if (message.from === "system") return <p className="system"><span>{message.time}</span> {message.text}</p>;
  const parsed = message.wink ? { text: message.text, wink: message.wink } : extractWinkFromText(message.text);
  const wink = message.wink ?? parsed.wink;
  return (
    <article className={message.from === "me" ? "message me-message" : "message"}>
      <header><strong>{message.author}</strong><time>{message.time}</time></header>
      <p>{renderTextWithEmoticons(parsed.text)}</p>
      {wink ? (
        <div className="message-wink">
          <img src={wink.src} alt="" draggable="false" />
          <span>{wink.label}</span>
        </div>
      ) : null}
      {message.attachment?.type === "image" ? <img className="message-attachment" src={message.attachment.src} alt={message.attachment.name ?? ""} /> : null}
      {message.attachment?.type === "audio" ? <audio className="message-audio" controls src={message.attachment.src} /> : null}
      {message.attachment?.type === "file" ? <small className="message-file">{message.attachment.name}</small> : null}
    </article>
  );
}

function App() {
  const [bootstrap, setBootstrap] = useState(null);

  useEffect(() => {
    api.bootstrap().then(setBootstrap);
  }, []);

  if (!bootstrap) return <div className="loading">Chargement...</div>;
  return bootstrap.view === "chat" ? <ChatWindow bootstrap={bootstrap} /> : <MainWindow />;
}

createRoot(document.getElementById("root")).render(<App />);
