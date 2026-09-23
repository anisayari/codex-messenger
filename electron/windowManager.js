import { BrowserWindow, shell } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isTrustedRendererUrl } from "./security.js";

export function setStableWindowTitle(win, title) {
  if (!win || win.isDestroyed()) return;
  win.codexMessengerTitle = title;
  win.setTitle(title);
}

export function createBaseWindowFactory({
  dirname,
  appIconPath,
  windows,
  showDockIcon,
  smokeTest = false,
  onSmokeReady = null,
  openExternalUrl,
  rendererUrl = pathToFileURL(path.join(dirname, "..", "dist", "index.html")).href,
  logDebug = () => {}
}) {
  const localPlayerUrl = new URL("msn-assets/flash-player/index.html", rendererUrl).href;
  return function createBaseWindow(key, options) {
    const initialTitle = options.title ?? "Codex Messenger";
    const win = new BrowserWindow({
      frame: false,
      show: false,
      resizable: true,
      backgroundColor: "#edf6ff",
      titleBarStyle: "hidden",
      icon: appIconPath,
      webPreferences: {
        preload: path.join(dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      },
      ...options
    });
    win.codexMessengerTitle = initialTitle;
    windows.set(key, win);
    const logWindowEvent = (event, details = {}) => {
      try {
        const webContentsDestroyed = win.webContents?.isDestroyed?.() ?? true;
        logDebug(`window.${event}`, {
          key,
          title: win.codexMessengerTitle || initialTitle,
          url: win.isDestroyed() || webContentsDestroyed ? "" : win.webContents.getURL() || "",
          ...details
        });
      } catch (error) {
        logDebug(`window.${event}`, {
          key,
          title: initialTitle,
          url: "",
          logError: error?.message || String(error || "")
        });
      }
    };
    win.setMenuBarVisibility(false);
    win.on("page-title-updated", (event) => {
      if (!win.codexMessengerTitle) return;
      event.preventDefault();
      win.setTitle(win.codexMessengerTitle);
    });
    win.once("ready-to-show", () => {
      logWindowEvent("ready-to-show");
      showDockIcon();
      win.show();
      if (smokeTest) setTimeout(() => onSmokeReady?.(), 500);
    });
    win.webContents.on("render-process-gone", (_event, details = {}) => {
      logWindowEvent("render-process-gone", details);
    });
    win.webContents.on("unresponsive", () => {
      logWindowEvent("unresponsive");
    });
    win.webContents.on("responsive", () => {
      logWindowEvent("responsive");
    });
    win.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      logWindowEvent("did-fail-load", { errorCode, errorDescription, validatedURL, isMainFrame });
    });
    win.webContents.on("preload-error", (_event, preloadPath, error) => {
      logWindowEvent("preload-error", {
        preloadPath,
        error: error?.message || String(error || ""),
        stack: error?.stack || ""
      });
    });
    win.webContents.on("console-message", (event) => {
      const level = event.level;
      const message = event.message || "";
      const numericLevel = Number(level);
      if (Number.isFinite(numericLevel) && numericLevel < 2 && !/error|warn/i.test(message)) return;
      logWindowEvent("console-message", {
        level,
        message,
        line: event.lineNumber ?? null,
        sourceId: event.sourceId || ""
      });
    });
    win.on("closed", () => {
      logWindowEvent("closed");
      for (const [currentKey, currentWin] of windows) if (currentWin === win) windows.delete(currentKey);
    });
    win.webContents.setWindowOpenHandler(({ url }) => {
      const result = openExternalUrl ? openExternalUrl(url) : { ok: false };
      if (!result.ok) shell.beep();
      return { action: "deny" };
    });
    const preventExternalNavigation = (event, url) => {
      if (isTrustedRendererUrl(url, rendererUrl)) return;
      event.preventDefault();
      logDebug("security.navigation.blocked", { key, url });
      openExternalUrl?.(url);
    };
    win.webContents.on("will-navigate", preventExternalNavigation);
    win.webContents.on("will-redirect", preventExternalNavigation);
    win.webContents.on("will-frame-navigate", (event) => {
      const expectedDocument = event.isMainFrame ? rendererUrl : localPlayerUrl;
      if (!isTrustedRendererUrl(event.url, expectedDocument)) event.preventDefault();
    });
    return win;
  };
}
