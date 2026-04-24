import assert from "node:assert/strict";
import test from "node:test";
import { appCopyFor, supportedLanguages } from "../shared/languages.js";
import { newestThreadForProject } from "../shared/threadSelection.js";
import { assetDigestSha256, safeAssetFileName, selectFrontReleaseAsset } from "../shared/updateAssets.js";
import { displayVersion, updateAvailable } from "../shared/versionUtils.js";

test("version helpers support package and release tag formats", () => {
  assert.equal(displayVersion("0.0.2-5"), "0.0.2.5");
  assert.equal(displayVersion("v0.0.2.5"), "0.0.2.5");
  assert.equal(updateAvailable("v0.0.2.5", "0.0.2-4"), true);
  assert.equal(updateAvailable("0.0.2-5", "0.0.2.5"), false);
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
  }
});
