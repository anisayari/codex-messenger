const allowedExternalProtocols = new Set(["https:", "http:", "mailto:"]);
const allowedHttpHosts = new Set([
  "api.github.com",
  "github.com",
  "nodejs.org",
  "npmjs.com",
  "www.npmjs.com",
  "registry.npmjs.org",
  "raw.githubusercontent.com"
]);

export function isSafeExternalUrl(value) {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch {
    return false;
  }
  if (!allowedExternalProtocols.has(url.protocol)) return false;
  if (url.protocol === "mailto:") return Boolean(url.pathname);
  if (url.protocol === "http:" && !["127.0.0.1", "localhost"].includes(url.hostname)) return false;
  return allowedHttpHosts.has(url.hostname) || ["127.0.0.1", "localhost"].includes(url.hostname);
}

export function assertString(value, field, { required = true, maxLength = 2000 } = {}) {
  if (value == null || value === "") {
    if (!required) return "";
    throw new Error(`${field} is required`);
  }
  if (typeof value !== "string") throw new Error(`${field} must be a string`);
  if (value.length > maxLength) throw new Error(`${field} is too long`);
  return value;
}

export function assertObject(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  return value;
}

export function assertEnum(value, allowed, field, fallback = null) {
  const clean = String(value ?? fallback ?? "");
  if (!allowed.includes(clean)) {
    throw new Error(`${field} must be one of ${allowed.join(", ")}`);
  }
  return clean;
}
