import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import https from "node:https";
import path from "node:path";
import { codexNpmPackageName, quoteWindowsArg } from "../shared/codexSetup.js";
import { assetDigestSha256, releaseVersionLabel, safeAssetFileName, selectFrontReleaseAsset } from "../shared/updateAssets.js";
import { displayVersion, updateAvailable, versionLabelForResult } from "../shared/versionUtils.js";

const repositoryUrl = "https://github.com/anisayari/codex-messenger";
const frontPackageUrl = "https://raw.githubusercontent.com/anisayari/codex-messenger/main/package.json";
export const frontReleasesUrl = `${repositoryUrl}/releases`;
const frontLatestReleaseApiUrl = "https://api.github.com/repos/anisayari/codex-messenger/releases/latest";
const codexNpmRegistryUrl = "https://registry.npmjs.org/@openai%2Fcodex/latest";
export const codexNpmUrl = "https://www.npmjs.com/package/@openai/codex";
const updateCheckCacheMs = 10 * 60_000;

function updateCheckError(error) {
  return String(error?.message || error || "Update check failed");
}

function fetchJson(url, appVersion, timeoutMs = 6500) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": `Codex-Messenger/${appVersion}`
      },
      timeout: timeoutMs
    }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        fetchJson(new URL(response.headers.location, url).toString(), appVersion, timeoutMs).then(resolve, reject);
        return;
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }
      let raw = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { raw += chunk; });
      response.on("end", () => {
        try {
          resolve(JSON.parse(raw));
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on("timeout", () => {
      request.destroy(new Error("Update check timeout"));
    });
    request.on("error", reject);
  });
}

function downloadFile(url, targetPath, appVersion, options = {}) {
  const expectedSha256 = String(options.expectedSha256 || "").trim().toLowerCase();
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
  const timeoutMs = Math.max(30_000, Number(options.timeoutMs) || 10 * 60_000);
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      fs.unlink(targetPath).catch(() => {});
      reject(error);
    };

    const request = https.get(url, {
      headers: {
        Accept: "application/octet-stream",
        "User-Agent": `Codex-Messenger/${appVersion}`
      },
      timeout: timeoutMs
    }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        downloadFile(new URL(response.headers.location, url).toString(), targetPath, appVersion, options).then(resolve, reject);
        return;
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        fail(new Error(`Download failed with HTTP ${response.statusCode}`));
        return;
      }

      const hash = createHash("sha256");
      const file = createWriteStream(targetPath);
      let bytes = 0;
      const total = Number(response.headers["content-length"]) || 0;
      let lastProgressAt = 0;
      let lastPercent = -1;
      onProgress?.({ phase: "download", transferred: 0, total, percent: total > 0 ? 0 : null });
      response.on("data", (chunk) => {
        bytes += chunk.length;
        hash.update(chunk);
        const percent = total > 0 ? Math.min(99, Math.floor((bytes / total) * 100)) : null;
        const now = Date.now();
        if (onProgress && (percent !== lastPercent || now - lastProgressAt > 700)) {
          lastProgressAt = now;
          lastPercent = percent;
          onProgress({ phase: "download", transferred: bytes, total, percent });
        }
      });
      response.on("error", fail);
      file.on("error", fail);
      file.on("finish", () => {
        file.close(() => {
          if (settled) return;
          const sha256 = hash.digest("hex");
          if (expectedSha256 && sha256 !== expectedSha256) {
            fail(new Error(`Downloaded update checksum mismatch: expected ${expectedSha256}, got ${sha256}`));
            return;
          }
          onProgress?.({ phase: "download", transferred: bytes, total: total || bytes, percent: 100 });
          settled = true;
          resolve({ path: targetPath, bytes, sha256 });
        });
      });
      response.pipe(file);
    });
    request.on("timeout", () => {
      request.destroy(new Error("Update download timeout"));
    });
    request.on("error", fail);
  });
}

function formatCommandForDisplay(command, args = []) {
  return [command, ...args].join(" ");
}

function compactUpdateOutput(stdout = "", stderr = "") {
  const combined = [stdout, stderr].filter(Boolean).join("\n").trim();
  if (!combined) return "";
  return combined.length > 4000 ? `${combined.slice(-4000)}` : combined;
}

function spawnableUpdateCommand(command, args = []) {
  if (process.platform === "win32" && [".cmd", ".bat"].includes(path.extname(command).toLowerCase())) {
    return {
      command: "cmd.exe",
      args: ["/d", "/s", "/c", command, ...args]
    };
  }
  return { command, args };
}

function runUpdateCommand(command, args = [], { cwd, timeoutMs = 5 * 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    const spawnable = spawnableUpdateCommand(command, args);
    const child = spawn(spawnable.command, spawnable.args, {
      cwd,
      env: process.env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`${formatCommandForDisplay(command, args)} timed out`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const output = compactUpdateOutput(stdout, stderr);
      reject(new Error(output || `${formatCommandForDisplay(command, args)} exited with ${code}`));
    });
  });
}

export function createUpdateService({
  app,
  shell,
  defaultCwd,
  codexStatus,
  runCodexCommand,
  quitApplication,
  sendProgress,
  logDebug = () => {}
}) {
  let updateCheckCache = null;
  let updateCheckPromise = null;
  let pendingFrontUpdate = null;
  const appVersion = () => app.getVersion();

  async function latestFrontRelease() {
    return fetchJson(frontLatestReleaseApiUrl, appVersion(), 15_000);
  }

  function currentMacAppBundlePath() {
    if (process.platform !== "darwin") return "";
    const marker = `${path.sep}Contents${path.sep}MacOS${path.sep}`;
    const [bundlePath] = process.execPath.split(marker);
    return bundlePath && bundlePath.endsWith(".app")
      ? bundlePath
      : path.join("/Applications", "Codex Messenger.app");
  }

  async function checkFrontUpdate() {
    const currentVersion = appVersion();
    const result = {
      id: "front",
      name: "Codex Messenger",
      currentVersion,
      latestVersion: "",
      updateAvailable: false,
      source: "github",
      url: frontReleasesUrl,
      error: ""
    };

    try {
      const release = await latestFrontRelease();
      result.latestVersion = releaseVersionLabel(release);
      result.url = release.html_url || frontReleasesUrl;
      result.updateAvailable = updateAvailable(result.latestVersion, currentVersion);
    } catch (error) {
      try {
        const remotePackage = await fetchJson(frontPackageUrl, appVersion());
        result.latestVersion = displayVersion(remotePackage.version);
        result.updateAvailable = updateAvailable(result.latestVersion, currentVersion);
        result.error = `Latest release unavailable: ${updateCheckError(error)}`;
      } catch (fallbackError) {
        result.error = `${updateCheckError(error)}; package fallback unavailable: ${updateCheckError(fallbackError)}`;
      }
    }
    return result;
  }

  async function checkCodexUpdate() {
    const result = {
      id: "codex",
      name: "Codex app-server",
      packageName: codexNpmPackageName,
      command: "",
      currentVersion: "",
      latestVersion: "",
      updateAvailable: false,
      source: "npm",
      url: codexNpmUrl,
      installHint: `npm install -g ${codexNpmPackageName}`,
      error: ""
    };

    try {
      const status = await codexStatus();
      result.command = status.command || "";
      if (!status.ok) {
        result.error = status.error || "Codex CLI not detected";
      } else {
        const current = await runCodexCommand(status.command, ["--version"]);
        result.currentVersion = displayVersion(current.stdout || current.stderr);
      }
    } catch (error) {
      result.error = updateCheckError(error);
    }

    try {
      const latestPackage = await fetchJson(codexNpmRegistryUrl, appVersion());
      result.latestVersion = displayVersion(latestPackage.version);
    } catch (error) {
      result.error = result.error
        ? `${result.error}; latest version unavailable: ${updateCheckError(error)}`
        : updateCheckError(error);
    }

    result.updateAvailable = Boolean(result.currentVersion && result.latestVersion)
      && updateAvailable(result.latestVersion, result.currentVersion);
    return result;
  }

  async function checkUpdates({ force = false } = {}) {
    const now = Date.now();
    if (!force && updateCheckCache && now - updateCheckCache.checkedAtMs < updateCheckCacheMs) {
      return updateCheckCache.payload;
    }
    if (!force && updateCheckPromise) return updateCheckPromise;

    updateCheckPromise = Promise.all([checkFrontUpdate(), checkCodexUpdate()])
      .then(([front, codex]) => {
        const payload = {
          checkedAt: new Date().toISOString(),
          front,
          codex
        };
        updateCheckCache = { checkedAtMs: Date.now(), payload };
        return payload;
      })
      .finally(() => {
        updateCheckPromise = null;
      });
    return updateCheckPromise;
  }

  async function installCodexUpdate() {
    const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
    const args = ["install", "-g", `${codexNpmPackageName}@latest`];
    const command = formatCommandForDisplay("npm", args);
    sendProgress({ target: "codex", phase: "checking", indeterminate: true, message: "Verification de la version Codex app-server..." });
    const before = await checkCodexUpdate();
    sendProgress({ target: "codex", phase: "installing", indeterminate: true, message: "Installation de Codex app-server avec npm..." });
    const output = await runUpdateCommand(npmCommand, args, { cwd: defaultCwd() });
    updateCheckCache = null;
    sendProgress({ target: "codex", phase: "verifying", indeterminate: true, message: "Verification de l'installation Codex app-server..." });
    const after = await checkCodexUpdate();
    const currentLabel = versionLabelForResult(after.currentVersion || after.latestVersion);
    const message = after.error
      ? `Codex app-server update command finished, but verification failed: ${after.error}`
      : after.updateAvailable
        ? `Codex app-server update command finished, but detected version is still ${currentLabel}.`
        : `Codex app-server is up to date (${currentLabel}).`;
    const result = {
      ok: true,
      target: "codex",
      command,
      before,
      after,
      message,
      needsRestart: true,
      output: compactUpdateOutput(output.stdout, output.stderr)
    };
    sendProgress({ target: "codex", phase: "ready", percent: 100, needsRestart: true, message });
    return result;
  }

  async function scheduleWindowsInstaller(installerPath, latestVersion) {
    const updateDir = path.join(app.getPath("userData"), "updates");
    await fs.mkdir(updateDir, { recursive: true });
    const scriptPath = path.join(updateDir, "install-codex-messenger-update.cmd");
    const logPath = path.join(updateDir, "install-codex-messenger-update.log");
    const appExe = process.execPath;
    const script = [
      "@echo off",
      "setlocal",
      "set \"APP_PID=%~1\"",
      "set \"INSTALLER=%~2\"",
      "set \"APP_EXE=%~3\"",
      `set "LOG_PATH=${logPath}"`,
      "echo Installing Codex Messenger update > \"%LOG_PATH%\"",
      ":wait_app",
      "tasklist /FI \"PID eq %APP_PID%\" 2>NUL | find \"%APP_PID%\" >NUL",
      "if \"%ERRORLEVEL%\"==\"0\" (",
      "  timeout /t 1 /nobreak >NUL",
      "  goto wait_app",
      ")",
      "\"%INSTALLER%\" /S >> \"%LOG_PATH%\" 2>&1",
      "if exist \"%APP_EXE%\" start \"\" \"%APP_EXE%\"",
      "endlocal"
    ].join("\r\n");
    await fs.writeFile(scriptPath, script, "utf8");
    const command = [
      "start",
      "\"\"",
      quoteWindowsArg(scriptPath),
      quoteWindowsArg(String(process.pid)),
      quoteWindowsArg(installerPath),
      quoteWindowsArg(appExe)
    ].join(" ");
    const child = spawn("cmd.exe", ["/d", "/s", "/c", command], {
      detached: true,
      windowsHide: false,
      stdio: "ignore"
    });
    child.unref();
    logDebug("update.front.installer.scheduled", { platform: "win32", installerPath, scriptPath, latestVersion });
    setTimeout(() => quitApplication(), 500);
    return {
      quitStarted: true,
      message: `Mise a jour ${latestVersion} telechargee. Codex Messenger va se fermer puis lancer l'installeur automatiquement.`
    };
  }

  async function scheduleMacDmgInstaller(dmgPath, latestVersion) {
    if (!app.isPackaged) {
      const openError = await shell.openPath(dmgPath);
      if (openError) throw new Error(openError);
      return {
        quitStarted: false,
        message: `Mise a jour ${latestVersion} telechargee. Le DMG a ete ouvert; l'installation automatique complete est disponible depuis l'app packagee.`
      };
    }

    const updateDir = path.join(app.getPath("userData"), "updates");
    await fs.mkdir(updateDir, { recursive: true });
    const scriptPath = path.join(updateDir, "install-codex-messenger-update.zsh");
    const logPath = path.join(updateDir, "install-codex-messenger-update.log");
    const targetApp = currentMacAppBundlePath();
    const script = `#!/bin/zsh
set -euo pipefail
APP_PID="$1"
DMG_PATH="$2"
TARGET_APP="$3"
LOG_PATH="$4"
exec >> "$LOG_PATH" 2>&1
echo "Installing Codex Messenger update at $(date)"
while kill -0 "$APP_PID" 2>/dev/null; do
  sleep 0.25
done
MOUNT_DIR="$(mktemp -d /tmp/codex-messenger-update.XXXXXX)"
cleanup() {
  hdiutil detach "$MOUNT_DIR" -quiet >/dev/null 2>&1 || true
  rmdir "$MOUNT_DIR" >/dev/null 2>&1 || true
}
trap cleanup EXIT
hdiutil attach "$DMG_PATH" -mountpoint "$MOUNT_DIR" -nobrowse -readonly -quiet
APP_SOURCE="$MOUNT_DIR/Codex Messenger.app"
if [[ ! -d "$APP_SOURCE" ]]; then
  APP_SOURCE="$(find "$MOUNT_DIR" -maxdepth 2 -name "Codex Messenger.app" -type d -print -quit)"
fi
if [[ -z "$APP_SOURCE" || ! -d "$APP_SOURCE" ]]; then
  echo "Codex Messenger.app not found in mounted update."
  exit 1
fi
TARGET_PARENT="$(dirname "$TARGET_APP")"
TMP_TARGET="$TARGET_PARENT/.Codex Messenger.app.update.$$"
rm -rf "$TMP_TARGET"
ditto "$APP_SOURCE" "$TMP_TARGET"
rm -rf "$TARGET_APP"
mv "$TMP_TARGET" "$TARGET_APP"
xattr -dr com.apple.quarantine "$TARGET_APP" >/dev/null 2>&1 || true
open "$TARGET_APP"
`;
    await fs.writeFile(scriptPath, script, { encoding: "utf8", mode: 0o755 });
    await fs.chmod(scriptPath, 0o755);
    const child = spawn("/bin/zsh", [scriptPath, String(process.pid), dmgPath, targetApp, logPath], {
      detached: true,
      stdio: "ignore"
    });
    child.unref();
    logDebug("update.front.installer.scheduled", { platform: "darwin", dmgPath, targetApp, scriptPath, latestVersion });
    setTimeout(() => quitApplication(), 500);
    return {
      quitStarted: true,
      message: `Mise a jour ${latestVersion} telechargee. Codex Messenger va se fermer, installer l'app, puis se relancer.`
    };
  }

  function canPrepareFrontUpdateForRestart() {
    return app.isPackaged && ["darwin", "win32"].includes(process.platform);
  }

  function frontUpdateReadyMessage(latestVersion) {
    return `Mise a jour ${latestVersion} telechargee et verifiee. Clique sur Redemarrer et installer quand tu es pret.`;
  }

  function hasPendingFrontUpdate() {
    return Boolean(pendingFrontUpdate);
  }

  async function applyPendingFrontUpdate() {
    if (!pendingFrontUpdate) {
      throw new Error("Aucune mise a jour Codex Messenger n'est prete a installer.");
    }
    const pending = pendingFrontUpdate;
    await fs.access(pending.filePath);
    const message = `Installation de la mise a jour ${pending.latestVersion}. Codex Messenger va se fermer puis se relancer.`;
    logDebug("update.front.apply.requested", {
      latestVersion: pending.latestVersion,
      assetName: pending.assetName,
      filePath: pending.filePath,
      sha256: pending.sha256
    });
    sendProgress({
      target: "front",
      phase: "restarting",
      percent: 100,
      latestVersion: pending.latestVersion,
      assetName: pending.assetName,
      quitStarted: true,
      message
    });
    const launch = await launchDownloadedFrontUpdate(pending.filePath, pending.latestVersion);
    pendingFrontUpdate = null;
    return {
      ok: true,
      target: "front",
      latestVersion: pending.latestVersion,
      assetName: pending.assetName,
      filePath: pending.filePath,
      bytes: pending.bytes,
      sha256: pending.sha256,
      quitStarted: launch.quitStarted,
      needsRestart: !launch.quitStarted,
      message: launch.message || message
    };
  }

  async function launchDownloadedFrontUpdate(filePath, latestVersion) {
    if (process.platform === "win32") return scheduleWindowsInstaller(filePath, latestVersion);
    if (process.platform === "darwin") return scheduleMacDmgInstaller(filePath, latestVersion);
    const openError = await shell.openPath(filePath);
    if (openError) throw new Error(openError);
    return {
      quitStarted: false,
      message: `Mise a jour ${latestVersion} telechargee. Ouvre le fichier pour terminer l'installation.`
    };
  }

  async function installFrontUpdate() {
    pendingFrontUpdate = null;
    sendProgress({ target: "front", phase: "checking", indeterminate: true, message: "Verification de la version Codex Messenger..." });
    const before = await checkFrontUpdate();
    if (!before.updateAvailable) {
      const result = {
        ok: true,
        target: "front",
        before,
        after: before,
        alreadyCurrent: true,
        message: `Codex Messenger est deja a jour (${versionLabelForResult(before.currentVersion)}).`
      };
      sendProgress({ target: "front", phase: "ready", percent: 100, message: result.message });
      return result;
    }

    const release = await latestFrontRelease();
    const latestVersion = releaseVersionLabel(release) || versionLabelForResult(before.latestVersion);
    const asset = selectFrontReleaseAsset(release);
    if (!asset) {
      throw new Error("Aucun installeur compatible trouve dans la derniere release Codex Messenger.");
    }

    const updateDir = path.join(app.getPath("userData"), "updates");
    await fs.mkdir(updateDir, { recursive: true });
    const targetPath = path.join(updateDir, safeAssetFileName(asset.name));
    const expectedSha256 = assetDigestSha256(asset);
    sendProgress({ target: "front", phase: "download", percent: 0, assetName: asset.name, latestVersion, message: `Telechargement de ${asset.name}...` });
    const download = await downloadFile(asset.browser_download_url, targetPath, appVersion(), {
      expectedSha256,
      timeoutMs: 15 * 60_000,
      onProgress: (progress) => sendProgress({
        target: "front",
        assetName: asset.name,
        latestVersion,
        message: `Telechargement de ${asset.name}...`,
        ...progress
      })
    });
    logDebug("update.front.downloaded", {
      latestVersion,
      assetName: asset.name,
      filePath: download.path,
      bytes: download.bytes,
      sha256: download.sha256
    });
    if (canPrepareFrontUpdateForRestart()) {
      pendingFrontUpdate = {
        latestVersion,
        assetName: asset.name,
        filePath: download.path,
        bytes: download.bytes,
        sha256: download.sha256,
        createdAt: new Date().toISOString()
      };
      const message = frontUpdateReadyMessage(latestVersion);
      const result = {
        ok: true,
        target: "front",
        before,
        latestVersion,
        assetName: asset.name,
        filePath: download.path,
        bytes: download.bytes,
        sha256: download.sha256,
        quitStarted: false,
        needsRestart: true,
        message
      };
      sendProgress({
        target: "front",
        phase: "ready",
        percent: 100,
        assetName: asset.name,
        latestVersion,
        needsRestart: true,
        quitStarted: false,
        message
      });
      logDebug("update.front.ready", {
        latestVersion,
        assetName: asset.name,
        filePath: download.path,
        sha256: download.sha256
      });
      return result;
    }

    sendProgress({ target: "front", phase: "installing", percent: 100, assetName: asset.name, latestVersion, message: "Preparation de l'installation..." });
    const launch = await launchDownloadedFrontUpdate(download.path, latestVersion);
    updateCheckCache = null;
    const result = {
      ok: true,
      target: "front",
      before,
      latestVersion,
      assetName: asset.name,
      filePath: download.path,
      bytes: download.bytes,
      sha256: download.sha256,
      quitStarted: launch.quitStarted,
      needsRestart: !launch.quitStarted,
      message: launch.message
    };
    sendProgress({ target: "front", phase: launch.quitStarted ? "restarting" : "ready", percent: 100, assetName: asset.name, latestVersion, needsRestart: !launch.quitStarted, quitStarted: launch.quitStarted, message: launch.message });
    return result;
  }

  return {
    checkUpdates,
    installCodexUpdate,
    installFrontUpdate,
    applyPendingFrontUpdate,
    hasPendingFrontUpdate
  };
}
