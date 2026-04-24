import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const port = 5174;
const url = `http://127.0.0.1:${port}/`;
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function waitForVite(target, timeoutMs = 30000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(target, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() - started > timeoutMs) {
          reject(new Error(`Vite did not answer on ${target}`));
          return;
        }
        setTimeout(tick, 250);
      });
      req.setTimeout(1000, () => {
        req.destroy();
      });
    };
    tick();
  });
}

async function run(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "ignore", shell: false });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    });
    child.on("error", reject);
  });
}

async function devElectronCommand() {
  if (process.platform !== "darwin") return { command: npxCommand, args: ["electron", "."] };

  const sourceApp = path.join(rootDir, "node_modules", "electron", "dist", "Electron.app");
  const devApp = path.join(rootDir, ".tmp", "Codex Messenger Dev.app");
  const resourcesDir = path.join(devApp, "Contents", "Resources");
  const plistPath = path.join(devApp, "Contents", "Info.plist");
  const iconPath = path.join(rootDir, "public", "icons", "codex-messenger.icns");

  await fs.rm(devApp, { recursive: true, force: true });
  await fs.mkdir(path.dirname(devApp), { recursive: true });
  await run("/bin/cp", ["-R", sourceApp, devApp]);
  await fs.copyFile(iconPath, path.join(resourcesDir, "electron.icns"));
  await run("/usr/libexec/PlistBuddy", ["-c", "Set :CFBundleName Codex Messenger Dev", plistPath]);
  await run("/usr/libexec/PlistBuddy", ["-c", "Set :CFBundleDisplayName Codex Messenger Dev", plistPath]);
  await run("/usr/libexec/PlistBuddy", ["-c", "Set :CFBundleIdentifier com.codex.messenger.dev", plistPath]);

  return { command: path.join(devApp, "Contents", "MacOS", "Electron"), args: ["."] };
}

const vite = spawn(npmCommand, ["run", "dev", "--", "--strictPort"], {
  stdio: "inherit",
  shell: false
});

try {
  await waitForVite(url);
  const electronCommand = await devElectronCommand();
  const electron = spawn(electronCommand.command, electronCommand.args, {
    stdio: "inherit",
    shell: false,
    env: {
      ...process.env,
      VITE_DEV_SERVER_URL: url
    }
  });

  electron.on("exit", (code) => {
    vite.kill();
    process.exit(code ?? 0);
  });
} catch (error) {
  console.error(error);
  vite.kill();
  process.exit(1);
}
