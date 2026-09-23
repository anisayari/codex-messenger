import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import https from "node:https";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { codexNpmPackageName, findNpmCommand } from "../shared/codexSetup.js";
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

const updateHosts = new Set([
  "api.github.com", "github.com", "raw.githubusercontent.com", "registry.npmjs.org",
  "release-assets.githubusercontent.com", "objects.githubusercontent.com"
]);

export function assertUpdateUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || !updateHosts.has(url.hostname)) {
    throw new Error("Update URL blocked: expected an official HTTPS update host");
  }
  return url.toString();
}

export function assertUpdateDigest(value) {
  const digest = String(value || "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    throw new Error("This release has no valid SHA-256 digest. Open the release page to install it manually.");
  }
  return digest;
}

export async function verifyUpdateFile(filePath, expectedSha256, expectedBytes = null) {
  const expected = assertUpdateDigest(expectedSha256);
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(filePath)) { hash.update(chunk); bytes += chunk.length; }
  if (hash.digest("hex") !== expected) throw new Error("Downloaded update checksum mismatch");
  if (expectedBytes != null && bytes !== expectedBytes) throw new Error("Downloaded update size mismatch");
  return { path: filePath, bytes, sha256: expected };
}

async function fetchJson(url, appVersion, timeoutMs = 6500, redirects = 0) {
  assertUpdateUrl(url);
  if (redirects > 5) return Promise.reject(new Error("Too many update redirects"));
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
        fetchJson(new URL(response.headers.location, url).toString(), appVersion, timeoutMs, redirects + 1).then(resolve, reject);
        return;
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }
      let raw = "";
      response.setEncoding("utf8");
      response.on("error", reject);
      response.on("data", (chunk) => {
        raw += chunk;
        if (raw.length > 2_000_000) request.destroy(new Error("Update metadata is too large"));
      });
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

export async function downloadUpdateFile(url, targetPath, appVersion, options = {}) {
  const expectedSha256 = assertUpdateDigest(options.expectedSha256);
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
  const timeoutMs = Math.max(30_000, Number(options.timeoutMs) || 10 * 60_000);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const signal = AbortSignal.timeout(timeoutMs);
  const temporaryPath = `${targetPath}.${randomUUID()}.part`;
  let source;
  let currentUrl = assertUpdateUrl(url);
  try {
    let response;
    for (let redirects = 0; redirects <= 5; redirects += 1) {
      response = await fetchImpl(currentUrl, {
        headers: { Accept: "application/octet-stream", "User-Agent": `Codex-Messenger/${appVersion}` },
        redirect: "manual", signal
      });
      if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
        await response.body?.cancel();
        currentUrl = assertUpdateUrl(new URL(response.headers.get("location"), currentUrl).toString());
        if (redirects === 5) throw new Error("Too many update redirects");
        continue;
      }
      break;
    }
    if (!response.ok || !response.body) throw new Error(`Download failed with HTTP ${response.status}`);
    const hash = createHash("sha256");
    let bytes = 0;
    const total = Number(response.headers.get("content-length")) || 0;
    let lastProgressAt = 0;
    let lastPercent = -1;
    onProgress?.({ phase: "download", transferred: 0, total, percent: total > 0 ? 0 : null });
    const progress = new Transform({ transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      hash.update(chunk);
      const percent = total > 0 ? Math.min(99, Math.floor((bytes / total) * 100)) : null;
      const now = Date.now();
      if (onProgress && (percent !== lastPercent || now - lastProgressAt > 700)) {
        lastProgressAt = now; lastPercent = percent;
        onProgress({ phase: "download", transferred: bytes, total, percent });
      }
      callback(null, chunk);
    } });
    source = Readable.fromWeb(response.body);
    await pipeline(source, progress, createWriteStream(temporaryPath, { flags: "wx", mode: 0o600 }), { signal });
    const sha256 = hash.digest("hex");
    if (sha256 !== expectedSha256) throw new Error("Downloaded update checksum mismatch");
    if ((total && total !== bytes) || (options.expectedBytes != null && options.expectedBytes !== bytes)) {
      throw new Error("Downloaded update size mismatch");
    }
    await fs.rename(temporaryPath, targetPath);
    onProgress?.({ phase: "download", transferred: bytes, total: total || bytes, percent: 100 });
    return { path: targetPath, bytes, sha256 };
  } catch (error) {
    source?.destroy();
    await fs.unlink(temporaryPath).catch(() => {});
    throw error;
  }
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
      stdout = (stdout + chunk.toString()).slice(-64_000);
    });
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-64_000);
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
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

function escapeWindowsBatchSetValue(value = "") {
  return String(value).replace(/%/g, "%%");
}

export function windowsUpdateInstallerScript({ logPath }) {
  return [
    "@echo off",
    "setlocal EnableExtensions",
    "set \"APP_PID=%~1\"",
    "set \"INSTALLER=%~2\"",
    "set \"APP_EXE=%~3\"",
    "set \"ORIGINAL_APP_EXE=%APP_EXE%\"",
    `set "LOG_PATH=${escapeWindowsBatchSetValue(logPath)}"`,
    "echo Installing Codex Messenger update > \"%LOG_PATH%\"",
    "echo Script: %~f0 >> \"%LOG_PATH%\"",
    "echo Installer: %INSTALLER% >> \"%LOG_PATH%\"",
    "echo Previous app exe: %APP_EXE% >> \"%LOG_PATH%\"",
    "if not exist \"%INSTALLER%\" (",
    "  echo Installer missing: %INSTALLER% >> \"%LOG_PATH%\"",
    "  exit /b 1",
    ")",
    ":wait_app",
    "tasklist /FI \"PID eq %APP_PID%\" 2>NUL | find \"%APP_PID%\" >NUL",
    "if \"%ERRORLEVEL%\"==\"0\" (",
    "  timeout /t 1 /nobreak >NUL",
    "  goto wait_app",
    ")",
    "\"%INSTALLER%\" /S >> \"%LOG_PATH%\" 2>&1",
    "set \"INSTALL_EXIT=%ERRORLEVEL%\"",
    "echo Installer exit code: %INSTALL_EXIT% >> \"%LOG_PATH%\"",
    "if not \"%INSTALL_EXIT%\"==\"0\" exit /b %INSTALL_EXIT%",
    "call :resolve_app_exe",
    "if defined APP_EXE if exist \"%APP_EXE%\" (",
    "  echo Relaunching: %APP_EXE% >> \"%LOG_PATH%\"",
    "  for %%I in (\"%APP_EXE%\") do set \"APP_DIR=%%~dpI\"",
    "  start \"\" /D \"%APP_DIR%\" \"%APP_EXE%\"",
    ") else (",
    "  echo Codex Messenger exe not found after update. >> \"%LOG_PATH%\"",
    ")",
    "endlocal",
    "exit /b 0",
    "",
    ":resolve_app_exe",
    "call :sanitize_app_exe",
    "call :try_app_exe \"%LOCALAPPDATA%\\Programs\\codex-messenger\\Codex Messenger.exe\"",
    "if defined APP_EXE exit /b 0",
    "call :try_app_exe \"%LOCALAPPDATA%\\Programs\\Codex Messenger\\Codex Messenger.exe\"",
    "if defined APP_EXE exit /b 0",
    "call :try_app_exe \"%ProgramFiles%\\Codex Messenger\\Codex Messenger.exe\"",
    "if defined APP_EXE exit /b 0",
    "call :try_app_exe \"%ProgramFiles(x86)%\\Codex Messenger\\Codex Messenger.exe\"",
    "if defined APP_EXE exit /b 0",
    "if defined ORIGINAL_APP_EXE (",
    "  set \"APP_EXE=%ORIGINAL_APP_EXE%\"",
    "  call :sanitize_app_exe",
    "  if defined APP_EXE if exist \"%APP_EXE%\" exit /b 0",
    ")",
    "set \"APP_EXE=\"",
    "exit /b 0",
    "",
    ":sanitize_app_exe",
    "if not defined APP_EXE exit /b 0",
    "if \"%APP_EXE%\"==\"\\\" set \"APP_EXE=\"",
    "if \"%APP_EXE%\"==\"\\\\\" set \"APP_EXE=\"",
    "if /I \"%APP_EXE:~0,4%\"==\"\\\\?\\\" set \"APP_EXE=%APP_EXE:~4%\"",
    "exit /b 0",
    "",
    ":try_app_exe",
    "if exist \"%~1\" set \"APP_EXE=%~1\"",
    "exit /b 0"
  ].join("\r\n");
}

export function windowsUpdateInstallerLaunch({ scriptPath, appPid, installerPath, appExe }) {
  return {
    command: "cmd.exe",
    args: ["/d", "/c", "call", scriptPath, String(appPid), installerPath, appExe]
  };
}

export function macUpdateInstallerScript(expectedTeamId) {
  if (!/^[A-Z0-9]{5,20}$/.test(expectedTeamId || "")) throw new Error("A valid signing team is required for automatic updates");
  return `#!/bin/zsh
set -euo pipefail
APP_PID="$1"
DMG_PATH="$2"
TARGET_APP="$3"
LOG_PATH="$4"
EXPECTED_TEAM_ID="${expectedTeamId}"
exec >> "$LOG_PATH" 2>&1
while kill -0 "$APP_PID" 2>/dev/null; do /bin/sleep 0.25; done
MOUNT_DIR="$(/usr/bin/mktemp -d /tmp/codex-messenger-update.XXXXXX)"
TARGET_PARENT="$(/usr/bin/dirname "$TARGET_APP")"
TMP_TARGET="$TARGET_PARENT/.Codex Messenger.app.update.$$"
BACKUP_TARGET="$TARGET_PARENT/.Codex Messenger.app.backup.$$"
COMMITTED=0
BACKED_UP=0
INSTALLED=0
cleanup() {
  RESULT=$?
  trap - EXIT HUP INT TERM
  if [[ "$COMMITTED" != "1" && "$BACKED_UP" == "1" ]]; then
    if [[ "$INSTALLED" == "1" ]]; then /bin/rm -rf "$TARGET_APP"; fi
    /bin/mv "$BACKUP_TARGET" "$TARGET_APP" || echo "Rollback failed; previous app remains at $BACKUP_TARGET"
  fi
  /bin/rm -rf "$TMP_TARGET"
  if [[ "$COMMITTED" == "1" ]]; then /bin/rm -rf "$BACKUP_TARGET"; fi
  /usr/bin/hdiutil detach "$MOUNT_DIR" -quiet >/dev/null 2>&1 || true
  /bin/rmdir "$MOUNT_DIR" >/dev/null 2>&1 || true
  if [[ "$RESULT" != "0" && -d "$TARGET_APP" ]]; then /usr/bin/open "$TARGET_APP" >/dev/null 2>&1 || true; fi
  exit "$RESULT"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
[[ ! -e "$TMP_TARGET" && ! -e "$BACKUP_TARGET" ]] || { echo "An earlier update must be recovered before replacing the app"; exit 1; }
/usr/bin/hdiutil attach "$DMG_PATH" -mountpoint "$MOUNT_DIR" -nobrowse -readonly -quiet
APP_SOURCE="$MOUNT_DIR/Codex Messenger.app"
[[ -d "$APP_SOURCE" ]] || { echo "Codex Messenger.app missing from update"; exit 1; }
/usr/bin/codesign --verify --deep --strict "$APP_SOURCE"
SOURCE_TEAM="$(/usr/bin/codesign -dv --verbose=4 "$APP_SOURCE" 2>&1 | /usr/bin/sed -n 's/^TeamIdentifier=//p')"
[[ "$SOURCE_TEAM" == "$EXPECTED_TEAM_ID" ]] || { echo "Update signing team mismatch"; exit 1; }
/usr/bin/codesign --verify --strict -R 'identifier "com.codex.messenger"' "$APP_SOURCE"
/usr/sbin/spctl --assess --type execute "$APP_SOURCE"
/usr/bin/ditto "$APP_SOURCE" "$TMP_TARGET"
/usr/bin/codesign --verify --deep --strict "$TMP_TARGET"
/bin/mv "$TARGET_APP" "$BACKUP_TARGET"
BACKED_UP=1
/bin/mv "$TMP_TARGET" "$TARGET_APP"
INSTALLED=1
/usr/bin/open "$TARGET_APP"
COMMITTED=1
`;
}

export function windowsInstallerSignatureCommand(installerPath, appExe) {
  const quote = (value) => `'${String(value).replace(/'/g, "''")}'`;
  return {
    command: "powershell.exe",
    args: ["-NoProfile", "-NonInteractive", "-Command", [
      "$ErrorActionPreference = 'Stop'",
      `$installed = Get-AuthenticodeSignature -LiteralPath ${quote(appExe)}`,
      `$update = Get-AuthenticodeSignature -LiteralPath ${quote(installerPath)}`,
      "if ($installed.Status -ne 'Valid' -or $update.Status -ne 'Valid') { throw 'A signed installed app and update are required for automatic updates. Install this update from the release page manually.' }",
      "if ($installed.SignerCertificate.Subject -ne $update.SignerCertificate.Subject) { throw 'Update signing publisher mismatch' }"
    ].join("; ")]
  };
}

export function launchUpdateInstaller(command, args, options = {}, spawnImpl = spawn) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(command, args, { detached: true, stdio: "ignore", ...options });
    child.once("error", reject);
    child.once("spawn", () => { child.unref(); resolve(); });
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
  let frontInstallPromise = null;
  let codexInstallPromise = null;
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
      : "";
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
      result.currentVersion = displayVersion(status.version || "");
      if (!status.ok) {
        result.error = status.error || "Codex CLI not detected";
      } else if (!result.currentVersion) {
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
    if (updateCheckPromise) return updateCheckPromise;

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

  async function performCodexUpdate() {
    const npm = await findNpmCommand();
    if (!npm.ok || !npm.command) throw new Error(npm.error || "npm was not found. Install Node.js/npm first.");
    const npmCommand = npm.command;
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
      ok: !after.error && !after.updateAvailable && Boolean(after.currentVersion),
      target: "codex",
      command,
      before,
      after,
      message,
      needsRestart: !after.error && !after.updateAvailable && Boolean(after.currentVersion),
      output: compactUpdateOutput(output.stdout, output.stderr)
    };
    sendProgress({ target: "codex", phase: result.ok ? "ready" : "error", percent: 100, needsRestart: result.ok, message });
    return result;
  }

  function installCodexUpdate() {
    if (!codexInstallPromise) codexInstallPromise = performCodexUpdate().finally(() => { codexInstallPromise = null; });
    return codexInstallPromise;
  }

  async function scheduleWindowsInstaller(installerPath, latestVersion) {
    const signatureCheck = windowsInstallerSignatureCommand(installerPath, process.execPath);
    await runUpdateCommand(signatureCheck.command, signatureCheck.args);
    const updateDir = path.join(app.getPath("userData"), "updates");
    await fs.mkdir(updateDir, { recursive: true });
    const scriptPath = path.join(updateDir, "install-codex-messenger-update.cmd");
    const logPath = path.join(updateDir, "install-codex-messenger-update.log");
    const appExe = process.execPath;
    const script = windowsUpdateInstallerScript({ logPath });
    await fs.writeFile(scriptPath, script, "utf8");
    const launch = windowsUpdateInstallerLaunch({
      scriptPath,
      appPid: process.pid,
      installerPath,
      appExe
    });
    await launchUpdateInstaller(launch.command, launch.args, { windowsHide: false });
    logDebug("update.front.installer.scheduled", {
      platform: "win32",
      installerPath,
      scriptPath,
      appExe,
      latestVersion
    });
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
    let signingTeam = "";
    try {
      if (!targetApp) throw new Error("Installed app bundle unavailable");
      await runUpdateCommand("/usr/bin/codesign", ["--verify", "--deep", "--strict", targetApp]);
      const identity = await runUpdateCommand("/usr/bin/codesign", ["-dv", "--verbose=4", targetApp]);
      signingTeam = [identity.stdout, identity.stderr].join("\n").match(/^TeamIdentifier=([A-Z0-9]{5,20})$/m)?.[1] || "";
    } catch (error) {
      logDebug("update.front.manual.required", { error: updateCheckError(error) });
    }
    if (!signingTeam) {
      const openError = await shell.openPath(dmgPath);
      if (openError) throw new Error(openError);
      return { quitStarted: false, needsRestart: false, manualInstall: true,
        message: `Mise a jour ${latestVersion} verifiee et DMG ouvert. Cette app n'a pas de signature editeur verifiable; installe la mise a jour manuellement.` };
    }
    const script = macUpdateInstallerScript(signingTeam);
    await fs.writeFile(scriptPath, script, { encoding: "utf8", mode: 0o755 });
    await fs.chmod(scriptPath, 0o755);
    await launchUpdateInstaller("/bin/zsh", [scriptPath, String(process.pid), dmgPath, targetApp, logPath]);
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
    await verifyUpdateFile(pending.filePath, pending.sha256, pending.bytes);
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
      needsRestart: launch.needsRestart ?? !launch.quitStarted,
      manualInstall: Boolean(launch.manualInstall),
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

  async function performFrontUpdate() {
    pendingFrontUpdate = null;
    sendProgress({ target: "front", phase: "checking", indeterminate: true, message: "Verification de la version Codex Messenger..." });
    const before = await checkFrontUpdate();
    if (before.error && !before.latestVersion) throw new Error(before.error);
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
    const expectedSha256 = assertUpdateDigest(assetDigestSha256(asset));
    sendProgress({ target: "front", phase: "download", percent: 0, assetName: asset.name, latestVersion, message: `Telechargement de ${asset.name}...` });
    const download = await downloadUpdateFile(asset.browser_download_url, targetPath, appVersion(), {
      expectedSha256,
      expectedBytes: Number.isSafeInteger(asset.size) ? asset.size : null,
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
      needsRestart: launch.needsRestart ?? !launch.quitStarted,
      manualInstall: Boolean(launch.manualInstall),
      message: launch.message
    };
    sendProgress({ target: "front", phase: launch.quitStarted ? "restarting" : "ready", percent: 100, assetName: asset.name, latestVersion, needsRestart: result.needsRestart, quitStarted: launch.quitStarted, message: launch.message });
    return result;
  }

  function installFrontUpdate() {
    if (!frontInstallPromise) frontInstallPromise = performFrontUpdate().finally(() => { frontInstallPromise = null; });
    return frontInstallPromise;
  }

  return {
    checkUpdates,
    installCodexUpdate,
    installFrontUpdate,
    applyPendingFrontUpdate,
    hasPendingFrontUpdate
  };
}
