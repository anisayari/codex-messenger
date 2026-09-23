#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { codexLoginStatus, codexVersion, codexVersionSupport, findCodexCommand, findNpmCommand, installCodexCli, nodeDownloadUrl, spawnCommand, unsupportedCodexVersionMessage } from "../shared/codexSetup.js";

const mode = process.argv.includes("--check")
  ? "check"
  : process.argv.includes("--install")
    ? "install"
    : process.argv.includes("--login")
      ? "login"
      : "ensure";

function printStep(message) {
  console.log(`[codex-setup] ${message}`);
}

async function resolveCodexOrNull() {
  try {
    return await findCodexCommand();
  } catch {
    return null;
  }
}

function runInteractive(command, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawnCommand(command, args, {
      stdio: "inherit",
      shell: false
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    });
  });
}

export async function ensureInstalled({ resolve = resolveCodexOrNull, versionOf = codexVersion, npmOf = findNpmCommand, install = installCodexCli } = {}) {
  let found = await resolve();
  if (found && codexVersionSupport(await versionOf(found.command)).ok) return found;

  const npm = await npmOf();
  if (!npm.ok) {
    throw new Error(`npm is missing. Install Node.js/npm first: ${nodeDownloadUrl}`);
  }

  printStep(found ? "Updating the unsupported Codex CLI with npm..." : "Codex CLI not found. Installing @openai/codex with npm...");
  await install({ stdio: "inherit" });
  found = await resolve();
  if (!found) throw new Error("Codex CLI was installed, but it is still not visible in PATH. Restart your terminal/session and try again.");
  const version = await versionOf(found.command);
  if (!codexVersionSupport(version).ok) throw new Error(`${unsupportedCodexVersionMessage(version)} Select the updated CLI path if CODEX_MESSENGER_CODEX_PATH points to another installation.`);
  return found;
}

async function ensureLoggedIn(command) {
  const login = await codexLoginStatus(command);
  if (login.ok) {
    printStep(login.text);
    return;
  }

  printStep("Codex CLI is not logged in. Starting OpenAI/Codex login...");
  await runInteractive(command, ["login"]);

  const after = await codexLoginStatus(command);
  if (!after.ok) throw new Error("Codex login did not complete. Run `codex login` manually and retry.");
  printStep(after.text);
}

async function ensureSupportedVersion(command) {
  const version = await codexVersion(command);
  const support = codexVersionSupport(version);
  printStep(version);
  if (!support.ok) {
    throw new Error(unsupportedCodexVersionMessage(version, support.minimumVersion));
  }
  return version;
}

async function main() {
if (mode === "check") {
  const npm = await findNpmCommand();
  console.log(`npm: ${npm.ok ? npm.command : "missing"}`);
  const found = await resolveCodexOrNull();
  if (!found) {
    console.log("codex: missing");
    process.exitCode = 1;
  } else {
    console.log(`codex: ${found.command}`);
    const version = await codexVersion(found.command);
    const support = codexVersionSupport(version);
    console.log(version);
    if (!support.ok) {
      console.log(`version: unsupported (${unsupportedCodexVersionMessage(version, support.minimumVersion)})`);
      process.exitCode = 1;
    }
    const login = await codexLoginStatus(found.command);
    console.log(`login: ${login.ok ? login.text : `missing (${login.text})`}`);
    if (!support.ok || !login.ok) process.exitCode = 1;
  }
} else if (mode === "install") {
  await ensureInstalled();
} else if (mode === "login") {
  const found = await ensureInstalled();
  await ensureSupportedVersion(found.command);
  await ensureLoggedIn(found.command);
} else {
  const found = await ensureInstalled();
  printStep(`Codex CLI ready: ${found.command}`);
  await ensureSupportedVersion(found.command);
  await ensureLoggedIn(found.command);
}
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); }
  catch (error) { console.error(`[codex-setup] ${error.message}`); process.exitCode = 1; }
}
