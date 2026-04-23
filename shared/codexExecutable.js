import fs from "node:fs/promises";
import path from "node:path";

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
