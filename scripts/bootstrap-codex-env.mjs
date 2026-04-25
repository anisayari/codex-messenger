#!/usr/bin/env node
import { spawn } from "node:child_process";
import { codexLoginStatus, codexVersion, codexVersionSupport, findCodexCommand, findNpmCommand, installCodexCli, nodeDownloadUrl, unsupportedCodexVersionMessage } from "../shared/codexSetup.js";

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
    const child = spawn(command, args, {
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

async function ensureInstalled() {
  let found = await resolveCodexOrNull();
  if (found) return found;

  const npm = await findNpmCommand();
  if (!npm.ok) {
    throw new Error(`npm is missing. Install Node.js/npm first: ${nodeDownloadUrl}`);
  }

  printStep("Codex CLI not found. Installing @openai/codex with npm...");
  await installCodexCli({ stdio: "inherit" });
  found = await resolveCodexOrNull();
  if (!found) throw new Error("Codex CLI was installed, but it is still not visible in PATH. Restart your terminal/session and try again.");
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
