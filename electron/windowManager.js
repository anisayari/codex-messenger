import { BrowserWindow, shell } from "electron";
import path from "node:path";

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
  openExternalUrl
}) {
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
    win.setMenuBarVisibility(false);
    win.on("page-title-updated", (event) => {
      if (!win.codexMessengerTitle) return;
      event.preventDefault();
      win.setTitle(win.codexMessengerTitle);
    });
    win.once("ready-to-show", () => {
      showDockIcon();
      win.show();
      if (smokeTest) setTimeout(() => onSmokeReady?.(), 500);
    });
    win.on("closed", () => {
      windows.delete(key);
    });
    win.webContents.setWindowOpenHandler(({ url }) => {
      const result = openExternalUrl ? openExternalUrl(url) : { ok: false };
      if (!result.ok) shell.beep();
      return { action: "deny" };
    });
    return win;
  };
}
