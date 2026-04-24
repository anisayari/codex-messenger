import path from "node:path";
import { pathToFileURL } from "node:url";

// Official protocol names from `codex app-server generate-ts --experimental`.
const imageGenerationTypes = new Set(["imagegeneration", "image_generation_call"]);
const imageViewTypes = new Set(["imageview"]);

function cleanType(item) {
  return String(item?.type ?? "").toLowerCase();
}

export function isCodexImageItem(item) {
  const type = cleanType(item);
  return imageGenerationTypes.has(type) || imageViewTypes.has(type);
}

function safeFileUrlForWindowsPath(value) {
  const normalized = String(value).replace(/\\/g, "/");
  if (!/^[a-zA-Z]:\//.test(normalized)) return "";
  return `file:///${encodeURI(normalized).replace(/[#?]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)}`;
}

export function imageSrcFromPathOrUrl(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(text)) return text;
  if (/^https?:\/\//i.test(text) || /^file:\/\//i.test(text)) return text;
  const windowsFileUrl = safeFileUrlForWindowsPath(text);
  if (windowsFileUrl) return windowsFileUrl;
  if (path.isAbsolute(text)) return pathToFileURL(text).href;
  return "";
}

export function imageSrcFromBase64Png(value) {
  const text = String(value ?? "").trim();
  const dataUrlMatch = text.match(/^data:image\/png;base64,([\s\S]+)$/i);
  const compact = (dataUrlMatch ? dataUrlMatch[1] : text).replace(/\s+/g, "");
  if (compact.length < 32) return "";
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) return "";
  const bytes = Buffer.from(compact, "base64");
  const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < pngSignature.length || !pngSignature.every((byte, index) => bytes[index] === byte)) return "";
  return `data:image/png;base64,${compact}`;
}

function basenameForImage(value, fallback = "image.png") {
  const text = String(value ?? "").trim();
  if (!text) return fallback;
  if (/^https?:\/\//i.test(text) || /^file:\/\//i.test(text)) {
    try {
      const url = new URL(text);
      const name = path.basename(decodeURIComponent(url.pathname));
      return name || fallback;
    } catch {
      return fallback;
    }
  }
  return path.basename(text.replace(/\\/g, "/")) || fallback;
}

export function codexImageFromItem(item) {
  const type = cleanType(item);
  if (imageViewTypes.has(type)) {
    const imagePath = item.path ?? item.filePath ?? item.file_path ?? "";
    const src = imageSrcFromPathOrUrl(imagePath);
    if (!src) return null;
    return {
      kind: "imageView",
      src,
      path: imagePath,
      name: basenameForImage(imagePath),
      text: `Image consultee: ${imagePath}`,
      status: "completed",
      prompt: ""
    };
  }
  if (!imageGenerationTypes.has(type)) return null;

  const savedPath = item.savedPath ?? item.saved_path ?? item.path ?? "";
  const prompt = String(item.revisedPrompt ?? item.revised_prompt ?? item.prompt ?? "").trim();
  const status = String(item.status ?? "generating").trim() || "generating";
  const src =
    imageSrcFromBase64Png(item.src) ||
    imageSrcFromPathOrUrl(item.src) ||
    imageSrcFromBase64Png(item.result) ||
    imageSrcFromPathOrUrl(savedPath);
  if (!src && !prompt && !status) return null;
  const text = [
    src ? "Image generee" : `Image en generation (${status})`,
    prompt
  ].filter(Boolean).join(": ");
  return {
    kind: "imageGeneration",
    src,
    path: savedPath,
    name: basenameForImage(savedPath, `${item.id || "generated-image"}.png`),
    text,
    status,
    prompt
  };
}
