export function registerUpdateIpcHandlers({
  ipcMain,
  updates,
  assertEnum,
  openExternalUrl,
  frontReleasesUrl,
  codexNpmUrl,
  restartApp
}) {
  ipcMain.handle("updates:check", async (_event, options = {}) => {
    return updates.checkUpdates({ force: Boolean(options.force) });
  });

  ipcMain.handle("updates:open", (_event, target = "front") => {
    const cleanTarget = assertEnum(target, ["front", "codex"], "target", "front");
    const url = cleanTarget === "codex" ? codexNpmUrl : frontReleasesUrl;
    return openExternalUrl(url);
  });

  ipcMain.handle("updates:install", async (_event, target = "codex") => {
    const cleanTarget = assertEnum(target, ["front", "codex"], "target", "codex");
    if (cleanTarget === "front") return updates.installFrontUpdate();
    return updates.installCodexUpdate();
  });

  ipcMain.handle("updates:restart", () => {
    restartApp();
    return { ok: true };
  });
}

export function registerWindowIpcHandlers({ ipcMain, BrowserWindow }) {
  ipcMain.handle("window:minimize", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });

  ipcMain.handle("window:maximize", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });

  ipcMain.handle("window:close", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  ipcMain.handle("window:get-bounds", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return null;
    return win.getBounds();
  });

  ipcMain.handle("window:resize-to", (event, nextBounds = {}) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed() || win.isMaximized() || win.isFullScreen()) return { ok: false };
    const current = win.getBounds();
    const [minWidth, minHeight] = win.getMinimumSize();
    const width = Math.max(minWidth || 320, Math.round(Number(nextBounds.width) || current.width));
    const height = Math.max(minHeight || 320, Math.round(Number(nextBounds.height) || current.height));
    win.setBounds({ ...current, width, height }, false);
    return { ok: true, bounds: win.getBounds() };
  });

  ipcMain.handle("window:set-zoom-factor", (event, factor = 1) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return { ok: false, zoomFactor: 1 };
    const zoomFactor = Math.max(0.7, Math.min(1.6, Number(factor) || 1));
    win.webContents.setZoomFactor(zoomFactor);
    return { ok: true, zoomFactor: win.webContents.getZoomFactor() };
  });
}
