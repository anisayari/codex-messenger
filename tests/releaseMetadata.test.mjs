import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function displayVersion(packageVersion) {
  return `v${packageVersion.replace(/-(\d+)$/, ".$1")}`;
}

test("release metadata is consistent across package, README, and website", () => {
  const packageJson = readJson("package.json");
  const packageLock = readJson("package-lock.json");
  const tag = displayVersion(packageJson.version);

  assert.equal(packageLock.version, packageJson.version);
  assert.equal(packageLock.packages[""].version, packageJson.version);
  assert.match(packageJson.version, /^\d+\.\d+\.\d+(?:-\d+)?$/);
  assert.ok(read("README.md").includes(tag));
  assert.ok(read("codexmessenger.net/index.html").includes(tag));
});

test("release build keeps Codex app-server integration stable", () => {
  const main = read("electron/main.js");
  assert.match(main, /method === "thread\/started"/);
  assert.match(main, /method === "turn\/completed"/);
  assert.match(main, /async function ensureLoadedThread/);
  assert.match(main, /acceptForSession/);
  assert.doesNotMatch(main, /acceptSettings/);
  assert.doesNotMatch(main, /persistExtendedHistory|experimentalRawEvents|persistFullHistory/);
});
