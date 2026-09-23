import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { EventEmitter } from "node:events";
import vm from "node:vm";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isTrustedRendererUrl } from "../electron/security.js";

const windowSource = await readFile(new URL("../electron/windowManager.js", import.meta.url), "utf8");
function navigationGate(rendererUrl) {
  class MockWindow extends EventEmitter {
    constructor(options) {
      super(); this.options = options; this.webContents = new EventEmitter();
      this.webContents.isDestroyed = () => false;
      this.webContents.getURL = () => rendererUrl;
      this.webContents.setWindowOpenHandler = () => {};
    }
    setMenuBarVisibility() {}
    setTitle() {}
    isDestroyed() { return false; }
    show() {}
  }
  const exports = vm.runInNewContext(
    windowSource.replace(/^import .*;$/gm, "").replace(/export function /g, "function ") + "\n({ createBaseWindowFactory });",
    { BrowserWindow: MockWindow, shell: { beep() {} }, path, pathToFileURL, isTrustedRendererUrl, URL, setTimeout }
  );
  const create = exports.createBaseWindowFactory({
    dirname: "/tmp/app/electron", appIconPath: "", windows: new Map(), showDockIcon() {}, rendererUrl
  });
  const win = create("main", {});
  return { win, allows(url, isMainFrame = false) {
    let prevented = false;
    win.webContents.emit("will-frame-navigate", { url, isMainFrame, preventDefault() { prevented = true; } });
    return !prevented;
  } };
}

test("production iframe can load only the exact packaged WINK player document", () => {
  const gate = navigationGate("file:///tmp/app/dist/index.html?view=main");
  assert.equal(gate.allows("file:///tmp/app/dist/msn-assets/flash-player/index.html?channel=local#player"), true);
  for (const url of [
    "file:///tmp/app/dist/index.html", "file:///tmp/app/dist/msn-assets/flash-player/player.js",
    "file:///tmp/another-app/dist/msn-assets/flash-player/index.html",
    "file:///tmp/app/dist/msn-assets/flash-player/index.html/other",
    "https://example.com/msn-assets/flash-player/index.html", "about:blank", "javascript:alert(1)"
  ]) assert.equal(gate.allows(url), false, url);
});

test("development iframe requires the same loopback origin and exact player document", () => {
  const gate = navigationGate("http://127.0.0.1:5173/?view=main");
  assert.equal(gate.allows("http://127.0.0.1:5173/msn-assets/flash-player/index.html?channel=local"), true);
  for (const url of [
    "http://localhost:5173/msn-assets/flash-player/index.html",
    "http://127.0.0.1:5174/msn-assets/flash-player/index.html",
    "http://user:password@127.0.0.1:5173/msn-assets/flash-player/index.html",
    "http://127.0.0.1:5173/msn-assets/flash-player/index.html.bad",
    "http://127.0.0.1:5173/msn-assets/flash-player/%2Findex.html",
    "http://127.0.0.1:5173/other/index.html"
  ]) assert.equal(gate.allows(url), false, url);
});

test("main frame remains restricted to the renderer while the player keeps browser sandbox isolation", () => {
  const renderer = "file:///tmp/app/dist/index.html?view=main";
  const gate = navigationGate(renderer);
  assert.equal(gate.allows("file:///tmp/app/dist/index.html?view=chat", true), true);
  assert.equal(gate.allows("file:///tmp/app/dist/msn-assets/flash-player/index.html", true), false);
  assert.equal(gate.win.options.webPreferences.sandbox, true);
  assert.equal(gate.win.options.webPreferences.contextIsolation, true);
  assert.equal(gate.win.options.webPreferences.nodeIntegration, false);
});
