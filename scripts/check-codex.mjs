import { execFile } from "node:child_process";
import { spawn } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const lookupCommand = process.platform === "win32" ? "where.exe" : "which";

async function findCodex() {
  const explicit = process.env.CODEX_MESSENGER_CODEX_PATH?.trim();
  if (explicit) return { command: explicit, source: "CODEX_MESSENGER_CODEX_PATH" };

  const { stdout } = await execFileAsync(lookupCommand, ["codex"], { windowsHide: true });
  const matches = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const command = process.platform === "win32"
    ? matches.find((line) => [".cmd", ".bat"].includes(path.extname(line).toLowerCase()))
      || matches.find((line) => path.extname(line).toLowerCase() === ".exe")
      || matches[0]
    : matches[0];
  if (!command) throw new Error("codex introuvable dans le PATH");
  return { command, source: "PATH" };
}

function shouldUseShell(command) {
  if (process.platform !== "win32") return false;
  const ext = path.extname(command).toLowerCase();
  return !path.isAbsolute(command) && ext !== ".cmd" && ext !== ".bat";
}

function quoteWindowsArg(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function runVersion(command) {
  return new Promise((resolve, reject) => {
    const ext = path.extname(command).toLowerCase();
    const child = process.platform === "win32" && (ext === ".cmd" || ext === ".bat")
      ? spawn(quoteWindowsArg(command), ["--version"], {
        shell: true,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"]
      })
      : spawn(command, ["--version"], {
        shell: shouldUseShell(command),
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"]
      });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve((stdout || stderr).trim());
      else reject(new Error((stderr || stdout || `codex exited with ${code}`).trim()));
    });
  });
}

try {
  const found = await findCodex();
  const version = await runVersion(found.command);
  console.log(`Codex detecte (${found.source}): ${found.command}`);
  console.log(version);
} catch (error) {
  console.error("Codex CLI non detecte.");
  console.error("Installez Codex CLI, ajoutez-le au PATH, ou definissez CODEX_MESSENGER_CODEX_PATH.");
  console.error(error.message);
  process.exitCode = 1;
}
