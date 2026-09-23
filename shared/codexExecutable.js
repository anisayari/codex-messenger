import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

async function exists(filePath) {
  if (!filePath) return false;
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function resolveExecutableCandidate(command) {
  const value = String(command ?? "").trim();
  if (!value || process.platform !== "win32" || !path.isAbsolute(value)) return value;
  if (path.extname(value)) return value;

  for (const suffix of [".cmd", ".exe", ".bat"]) {
    const candidate = `${value}${suffix}`;
    if (await exists(candidate)) return candidate;
  }

  if (await exists(value)) return value;
  return value;
}

// The official npm launcher needs Node on PATH; Electron may inherit only an app bundle PATH.
export async function resolveNpmCodexNativeExecutable(command) {
  const fallback = await resolveExecutableCandidate(command);
  if (!path.isAbsolute(fallback)) return fallback;
  try {
    const real = await fs.realpath(fallback);
    if (path.basename(real) !== "codex.js" || path.basename(path.dirname(real)) !== "bin") return fallback;
    const packageRoot = path.dirname(path.dirname(real));
    const manifestPath = path.join(packageRoot, "package.json");
    if (JSON.parse(await fs.readFile(manifestPath, "utf8")).name !== "@openai/codex") return fallback;
    const triples = { linux: {x64:"x86_64-unknown-linux-musl",arm64:"aarch64-unknown-linux-musl"}, android: {x64:"x86_64-unknown-linux-musl",arm64:"aarch64-unknown-linux-musl"}, darwin: {x64:"x86_64-apple-darwin",arm64:"aarch64-apple-darwin"}, win32: {x64:"x86_64-pc-windows-msvc",arm64:"aarch64-pc-windows-msvc"} };
    const triple = triples[process.platform]?.[process.arch];
    if (!triple) return fallback;
    const platformName = process.platform === "android" ? "linux" : process.platform;
    const platformPackage = `@openai/codex-${platformName}-${process.arch}`;
    let vendorRoot = path.join(packageRoot, "vendor");
    try { vendorRoot = path.join(path.dirname(createRequire(manifestPath).resolve(`${platformPackage}/package.json`)), "vendor"); } catch {}
    const executable = path.join(vendorRoot, triple, "bin", process.platform === "win32" ? "codex.exe" : "codex");
    const stat = await fs.stat(executable);
    if (stat.isFile()) { await fs.access(executable, process.platform === "win32" ? fs.constants.F_OK : fs.constants.X_OK); return executable; }
  } catch {}
  return fallback;
}
