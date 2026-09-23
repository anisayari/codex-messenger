export function normalizeMarkdownHref(value) {
  const source = String(value ?? "").trim();
  return source.startsWith("<") && source.endsWith(">") ? source.slice(1, -1).trim() : source;
}

export function localFilePathForHref(value) {
  let source = normalizeMarkdownHref(value);
  if (!source || /[\u0000-\u001f\u007f]/.test(source)) return "";
  if (/^file:/i.test(source)) {
    try {
      const url = new URL(source);
      if (url.hostname && url.hostname !== "localhost") return "";
      source = decodeURIComponent(url.pathname);
      if (/[\u0000-\u001f\u007f]/.test(source)) return "";
      if (/^\/[a-z]:\//i.test(source)) source = source.slice(1);
    } catch {
      return "";
    }
  }
  if (!/^\/(?!\/)/.test(source) && !/^[a-z]:[\\/]/i.test(source)) return "";
  return source.replace(/:\d+(?::\d+)?$/, "");
}
