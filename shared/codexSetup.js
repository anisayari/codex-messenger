import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { resolveExecutableCandidate, resolveNpmCodexNativeExecutable } from "./codexExecutable.js";
import { compareVersions, displayVersion, parseVersion } from "./versionUtils.js";

const execFileAsync = promisify(execFile);

export const codexNpmPackageName = "@openai/codex";
export const minimumCodexVersion = "0.156.1";
export const nodeDownloadUrl = "https://nodejs.org/en/download";

function lookupCommandForPlatform() {
  return process.platform === "win32" ? "where.exe" : "which";
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

async function firstExisting(candidates = []) {
  for (const candidate of candidates.filter(Boolean)) {
    if (await fileExists(candidate)) return candidate;
  }
  return "";
}

function commonNpmCandidates() {
  if (process.platform === "win32") {
    return [
      process.env.APPDATA ? path.join(process.env.APPDATA, "npm", "npm.cmd") : "",
      process.env.ProgramFiles ? path.join(process.env.ProgramFiles, "nodejs", "npm.cmd") : "",
      process.env["ProgramFiles(x86)"] ? path.join(process.env["ProgramFiles(x86)"], "nodejs", "npm.cmd") : ""
    ];
  }
  return [
    "/opt/homebrew/bin/npm",
    "/usr/local/bin/npm",
    path.join(os.homedir(), ".nvm", "current", "bin", "npm")
  ];
}

function commonCodexCandidates() {
  if (process.platform === "win32") {
    return [
      process.env.APPDATA ? path.join(process.env.APPDATA, "npm", "codex.cmd") : "",
      process.env.APPDATA ? path.join(process.env.APPDATA, "npm", "codex.exe") : ""
    ];
  }
  return [
    "/Applications/Codex.app/Contents/Resources/codex",
    "/opt/homebrew/bin/codex",
    "/usr/local/bin/codex",
    path.join(os.homedir(), ".nvm", "current", "bin", "codex")
  ];
}

async function npmAdjacentCodexCandidates() {
  const npm = await findNpmCommand();
  if (!npm.ok || !npm.command) return [];
  const binDir = path.dirname(npm.command);
  return process.platform === "win32"
    ? [path.join(binDir, "codex.cmd"), path.join(binDir, "codex.exe"), path.join(binDir, "codex")]
    : [path.join(binDir, "codex")];
}

function shouldUseShell(command) {
  if (process.platform !== "win32") return false;
  const ext = path.extname(command).toLowerCase();
  return !path.isAbsolute(command) && ext !== ".cmd" && ext !== ".bat";
}

export function quoteWindowsArg(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

export function spawnCommand(command, args, options = {}) {
  const ext = path.extname(command).toLowerCase();
  if (process.platform === "win32" && (ext === ".cmd" || ext === ".bat")) {
    const commandLine = `"${[quoteWindowsArg(command), ...args.map(quoteWindowsArg)].join(" ")}"`;
    return spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", commandLine], {
      ...options,
      shell: false,
      windowsVerbatimArguments: true
    });
  }
  return spawn(command, args, {
    ...options,
    ...(process.platform !== "win32" && path.isAbsolute(command) && path.basename(command) === "npm" ? { env: { ...(options.env ?? process.env), PATH: `${path.dirname(command)}${path.delimiter}${(options.env ?? process.env).PATH ?? ""}` } } : {}),
    shell: shouldUseShell(command)
  });
}

async function findOnPath(commandName) {
  const { stdout } = await execFileAsync(lookupCommandForPlatform(), [commandName], {
    windowsHide: true,
    timeout: 7000
  });
  const matches = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (process.platform === "win32") {
    return matches.find((line) => [".cmd", ".bat"].includes(path.extname(line).toLowerCase()))
      || matches.find((line) => path.extname(line).toLowerCase() === ".exe")
      || matches[0]
      || "";
  }
  return matches[0] || "";
}

export async function findNpmCommand() {
  try {
    const command = await findOnPath(process.platform === "win32" ? "npm.cmd" : "npm");
    return command ? { ok: true, command: await resolveExecutableCandidate(command) } : { ok: false, command: "", error: "npm was not found in PATH" };
  } catch (error) {
    const fallback = await firstExisting([...commonNpmCandidates(), ...await nvmCommandCandidates("npm")]);
    if (fallback) return { ok: true, command: await resolveExecutableCandidate(fallback), source: "fallback" };
    return { ok: false, command: "", error: error.message || "npm was not found in PATH" };
  }
}

export async function findCodexCommand(explicitPath = "") {
  const explicit = String(explicitPath || "").trim();
  if (explicit) return { command: await resolveNpmCodexNativeExecutable(explicit), source: "manual" };

  const envPath = String(process.env.CODEX_MESSENGER_CODEX_PATH || "").trim();
  if (envPath) return { command: await resolveNpmCodexNativeExecutable(envPath), source: "env" };

  const pathCommand = await findOnPath("codex").catch(() => "");
  const candidates = [pathCommand, ...commonCodexCandidates(), ...await npmAdjacentCodexCandidates(), ...await nvmCommandCandidates("codex")];
  const existing = [];
  for (const candidate of [...new Set(candidates.filter(Boolean))]) {
    if (await fileExists(candidate)) existing.push(await resolveNpmCodexNativeExecutable(candidate));
  }
  const command = await chooseSupportedCodexCandidate(existing);
  if (!command) throw new Error("codex was not found in PATH or common installation locations");
  return { command, source: "path" };
}

export function runCommand(command, args = [], { timeoutMs = 30_000, cwd = process.cwd(), env = process.env, stdio = ["ignore", "pipe", "pipe"] } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnCommand(command, args, {
      cwd,
      env,
      windowsHide: true,
      stdio
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`${command} ${args.join(" ")} timed out`));
    }, timeoutMs);
    if (child.stdout) child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    if (child.stderr) child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timeout);
      const output = { code: code ?? 0, stdout, stderr };
      if (code === 0) resolve(output);
      else {
        const error = new Error((stderr || stdout || `${command} exited with ${code}`).trim());
        error.output = output;
        reject(error);
      }
    });
  });
}

export async function codexLoginStatus(command) {
  try {
    const result = await runCommand(command, ["login", "status"], { timeoutMs: 15_000 });
    return {
      ok: true,
      text: (result.stdout || result.stderr).trim() || "Logged in"
    };
  } catch (error) {
    return {
      ok: false,
      text: (error.output?.stdout || error.output?.stderr || error.message || "Not logged in").trim()
    };
  }
}

export async function codexVersion(command) {
  const result = await runCommand(command, ["--version"], { timeoutMs: 15_000 });
  return (result.stdout || result.stderr).trim();
}

export function codexVersionSupport(version, minimumVersion = minimumCodexVersion) {
  const current = parseVersion(version);
  const minimum = parseVersion(minimumVersion);
  return {
    ok: Boolean(current && minimum && compareVersions(current.raw, minimum.raw) >= 0),
    currentVersion: current?.raw || displayVersion(version),
    minimumVersion: minimum?.raw || displayVersion(minimumVersion)
  };
}

export function unsupportedCodexVersionMessage(version, minimumVersion = minimumCodexVersion) {
  const support = codexVersionSupport(version, minimumVersion);
  const current = support.currentVersion || "unknown";
  return `Codex CLI ${support.minimumVersion} or newer is required. Installed version: ${current}. Update Codex with: npm install -g ${codexNpmPackageName}@latest`;
}

export async function installCodexCli({ cwd = process.cwd(), stdio = ["ignore", "pipe", "pipe"] } = {}) {
  const npm = await findNpmCommand();
  if (!npm.ok) {
    const error = new Error("npm was not found. Install Node.js/npm first.");
    error.code = "NPM_MISSING";
    throw error;
  }
  return runCommand(npm.command, ["install", "-g", `${codexNpmPackageName}@latest`], {
    cwd,
    timeoutMs: 10 * 60_000,
    stdio
  });
}

async function nvmCommandCandidates(commandName) {
  if (process.platform === "win32") return [];
  const versionsDir = path.join(os.homedir(), ".nvm", "versions", "node");
  try {
    const versions = (await fs.readdir(versionsDir, { withFileTypes: true })).filter((entry) => entry.isDirectory() && /^v\d+\.\d+\.\d+$/.test(entry.name)).map((entry) => entry.name).sort((a,b) => compareVersions(b.slice(1), a.slice(1)));
    return versions.map((version) => path.join(versionsDir, version, "bin", commandName));
  } catch { return []; }
}

export async function chooseSupportedCodexCandidate(candidates, { readVersion = codexVersion } = {}) {
  const paths = [...new Set(candidates.filter((candidate) => typeof candidate === "string" && candidate.trim()).map((candidate) => candidate.trim()))];
  for (const candidate of paths) {
    try { if (codexVersionSupport(await readVersion(candidate)).ok) return candidate; } catch {}
  }
  return paths[0] ?? "";
}
