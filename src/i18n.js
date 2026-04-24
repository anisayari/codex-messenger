import { appCopyFor, normalizeLanguage } from "../shared/languages.js";

export const statusLabels = appCopyFor("fr").status;

export const statusOptions = [
  ["online", statusLabels.online],
  ["busy", statusLabels.busy],
  ["brb", statusLabels.brb],
  ["away", statusLabels.away],
  ["phone", statusLabels.phone],
  ["lunch", statusLabels.lunch],
  ["offline", statusLabels.appearOffline]
];

export function statusOptionsFor(copy) {
  const labels = copy?.status ?? statusLabels;
  return [
    ["online", labels.online],
    ["busy", labels.busy],
    ["brb", labels.brb],
    ["away", labels.away],
    ["phone", labels.phone],
    ["lunch", labels.lunch],
    ["offline", labels.appearOffline]
  ];
}

export function localizedStatusLabel(status, text = {}) {
  const labels = {
    online: text.online || statusLabels.online,
    busy: text.busy || statusLabels.busy,
    away: text.away || statusLabels.away,
    offline: text.offline || statusLabels.offline
  };
  return labels[status] || statusLabels[status] || status;
}

export function contactStatusFor(settings, contactId, fallback = "online") {
  const key = String(contactId ?? "").trim();
  const status = settings?.contactStatuses?.[key];
  return statusOptions.some(([value]) => value === status) ? status : fallback;
}

export function applyLanguageDirection(language) {
  const code = normalizeLanguage(language);
  document.documentElement.lang = code;
  document.documentElement.dir = code === "ar" ? "rtl" : "ltr";
}
