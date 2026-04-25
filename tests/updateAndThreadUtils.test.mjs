import assert from "node:assert/strict";
import test from "node:test";
import { codexImageFromItem, imageSrcFromBase64Png, imageSrcFromPathOrUrl, isCodexImageItem } from "../shared/codexImages.js";
import { windowsUpdateInstallerLaunch, windowsUpdateInstallerScript } from "../electron/updateService.js";
import { appCopyFor, supportedLanguages } from "../shared/languages.js";
import { newestThreadForProject } from "../shared/threadSelection.js";
import { assetDigestSha256, safeAssetFileName, selectFrontReleaseAsset } from "../shared/updateAssets.js";
import { displayVersion, updateAvailable } from "../shared/versionUtils.js";
import { versionLabel } from "../src/versionLabel.js";

test("version helpers support package and release tag formats", () => {
  assert.equal(displayVersion("0.0.2-5"), "0.0.2.5");
  assert.equal(displayVersion("v0.0.2.5"), "0.0.2.5");
  assert.equal(updateAvailable("v0.0.2.5", "0.0.2-4"), true);
  assert.equal(updateAvailable("0.0.2-5", "0.0.2.5"), false);
  assert.equal(versionLabel("0.0.2-7"), "0.0.2.7");
  assert.equal(versionLabel("", "inconnue"), "inconnue");
});

test("front release asset selection prefers platform installer assets", () => {
  const release = {
    assets: [
      { name: "Codex-Messenger-0.0.2-arm64.dmg", browser_download_url: "https://github.com/a.dmg" },
      { name: "Codex-Messenger-0.0.2-x64.dmg", browser_download_url: "https://github.com/x.dmg" },
      { name: "CodexMessenger Setup 0.0.2.exe", browser_download_url: "https://github.com/setup.exe" },
      { name: "CodexMessenger.exe.blockmap", browser_download_url: "https://github.com/blockmap" }
    ]
  };
  assert.equal(selectFrontReleaseAsset(release, { platform: "win32" })?.name, "CodexMessenger Setup 0.0.2.exe");
  assert.equal(selectFrontReleaseAsset(release, { platform: "darwin", arch: "x64" })?.name, "Codex-Messenger-0.0.2-x64.dmg");
  assert.equal(selectFrontReleaseAsset(release, { platform: "darwin", arch: "arm64" })?.name, "Codex-Messenger-0.0.2-arm64.dmg");
  assert.equal(selectFrontReleaseAsset(release, { platform: "linux" }), null);
  assert.equal(assetDigestSha256({ digest: "sha256:ABC" }), "abc");
  assert.equal(safeAssetFileName("../bad:name.exe"), "..-bad-name.exe");
});

test("Codex image items expose renderable image attachments", () => {
  const tmpCodexImageUrl = process.platform === "win32"
    ? "file:///C:/tmp/codex%20image.png"
    : "file:///tmp/codex%20image.png";
  const tmpViewedUrl = process.platform === "win32"
    ? "file:///C:/tmp/viewed.png"
    : "file:///tmp/viewed.png";
  const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
  const pngDataUrl = `data:image/png;base64,${pngBase64}`;
  const generated = codexImageFromItem({
    id: "ig_123",
    type: "imageGeneration",
    status: "completed",
    revisedPrompt: "final prompt",
    savedPath: "/tmp/codex image.png",
    result: pngBase64
  });
  assert.equal(generated.kind, "imageGeneration");
  assert.equal(generated.src, pngDataUrl);
  assert.equal(generated.path, "/tmp/codex image.png");
  assert.equal(generated.name, "codex image.png");
  assert.match(generated.text, /Image generee: final prompt/);
  assert.equal(isCodexImageItem({ type: "imageGeneration" }), true);

  const savedPathFallback = codexImageFromItem({
    id: "ig_path",
    type: "imageGeneration",
    savedPath: "/tmp/codex image.png",
    result: "ignored"
  });
  assert.equal(savedPathFallback.src, tmpCodexImageUrl);
  assert.equal(savedPathFallback.status, "completed");

  const viewed = codexImageFromItem({ type: "imageView", path: "/tmp/viewed.png" });
  assert.equal(viewed.kind, "imageView");
  assert.equal(viewed.src, tmpViewedUrl);
  assert.equal(isCodexImageItem({ type: "imageView" }), true);

  const rawCall = codexImageFromItem({
    id: "ig_raw",
    type: "image_generation_call",
    status: "completed",
    result: pngBase64
  });
  assert.equal(rawCall.src, pngDataUrl);
  const pendingCall = codexImageFromItem({
    id: "ig_pending",
    type: "imageGeneration",
    status: "generating",
    revisedPrompt: "low poly cat",
    result: ""
  });
  assert.equal(pendingCall.src, "");
  assert.equal(pendingCall.status, "generating");
  assert.match(pendingCall.text, /Image en generation/);
  const officialSrc = codexImageFromItem({
    id: "ig_src",
    type: "imageGeneration",
    status: "completed",
    src: pngDataUrl,
    result: "ignored"
  });
  assert.equal(officialSrc.src, pngDataUrl);
  assert.equal(officialSrc.path, "");
  assert.equal(imageSrcFromBase64Png(pngDataUrl), pngDataUrl);
  assert.equal(imageSrcFromBase64Png(Buffer.from("not a png").toString("base64")), "");
  assert.equal(imageSrcFromBase64Png("a".repeat(64)), "");
  assert.equal(isCodexImageItem({ type: "image_generation_call" }), true);
  assert.equal(isCodexImageItem({ type: "message" }), false);
  assert.equal(imageSrcFromPathOrUrl("C:\\Users\\Anis\\Pictures\\image 1.png"), "file:///C:/Users/Anis/Pictures/image%201.png");
});

test("Windows update installer script avoids launching a broken root path", () => {
  const script = windowsUpdateInstallerScript({
    logPath: "C:\\Users\\Anis\\AppData\\Roaming\\Codex Messenger\\updates\\install.log"
  });
  assert.match(script, /if "%APP_EXE%"=="\\\\" set "APP_EXE="/);
  assert.match(script, /%LOCALAPPDATA%\\Programs\\codex-messenger\\Codex Messenger\.exe/);
  assert.match(script, /if defined APP_EXE if exist "%APP_EXE%"/);
  assert.doesNotMatch(script, /if exist "%APP_EXE%" start/);

  const launch = windowsUpdateInstallerLaunch({
    scriptPath: "C:\\Users\\Anis\\AppData\\Roaming\\Codex Messenger\\updates\\install.cmd",
    appPid: 1234,
    installerPath: "C:\\Users\\Anis\\Downloads\\Codex Messenger Setup.exe",
    appExe: "C:\\Users\\Anis\\AppData\\Local\\Programs\\codex-messenger\\Codex Messenger.exe"
  });
  assert.equal(launch.command, "cmd.exe");
  assert.deepEqual(launch.args.slice(0, 3), ["/d", "/c", "call"]);
  assert.equal(launch.args[3], "C:\\Users\\Anis\\AppData\\Roaming\\Codex Messenger\\updates\\install.cmd");
  assert.ok(!launch.args.includes("start"));
  assert.ok(!launch.args.includes("/s"));
});

test("project opening chooses the newest active thread, including hidden tabs", () => {
  const project = {
    threads: [
      { id: "old", timestamp: "2026-04-24T08:00:00.000Z" },
      { id: "visible-new", timestamp: "2026-04-24T11:00:00.000Z" }
    ],
    hiddenThreads: [
      { id: "hidden-newest", timestamp: "2026-04-24T12:00:00.000Z" }
    ]
  };
  assert.equal(newestThreadForProject(project)?.id, "hidden-newest");
});

test("all supported languages expose update dialog copy", () => {
  const requiredKeys = [
    "aboutTitle",
    "productFront",
    "productServer",
    "currentVersion",
    "latestVersion",
    "updateAutomatically",
    "readyToInstall",
    "restartInstall",
    "check",
    "checking",
    "restart",
    "download",
    "notChecked",
    "updateAvailableLine",
    "checkIncomplete",
    "upToDate"
  ];
  for (const language of supportedLanguages) {
    const copy = appCopyFor(language.code);
    for (const key of requiredKeys) {
      assert.equal(typeof copy.updates?.[key], "string", `${language.code}.updates.${key}`);
      assert.notEqual(copy.updates[key].trim(), "", `${language.code}.updates.${key}`);
    }
    assert.equal(typeof copy.chat?.configuration, "string", `${language.code}.chat.configuration`);
    assert.notEqual(copy.chat.configuration.trim(), "", `${language.code}.chat.configuration`);
  }
});
