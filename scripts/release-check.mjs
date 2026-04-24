import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
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

function assertIncludes(filePath, needle) {
  assert.ok(read(filePath).includes(needle), `${filePath} must include ${needle}`);
}

const packageJson = readJson("package.json");
const packageLock = readJson("package-lock.json");
const releaseTag = displayVersion(packageJson.version);

assert.equal(packageLock.version, packageJson.version, "package-lock top-level version must match package.json");
assert.equal(packageLock.packages[""].version, packageJson.version, "package-lock root package version must match package.json");

assertIncludes("README.md", releaseTag);
assertIncludes("README.md", packageJson.version);
assertIncludes("codexmessenger.net/index.html", releaseTag);
assertIncludes("codexmessenger.net/index.html", `?v=${releaseTag}`);

const main = read("electron/main.js");
assert.ok(main.includes('capabilities: {\n        experimentalApi: true\n      }'), "initialize should opt into app-server capabilities");
assert.ok(!/persistExtendedHistory|experimentalRawEvents|persistFullHistory/.test(main), "release must not send experimental thread history fields");
assert.ok(!main.includes("acceptSettings"), "release must not send non-protocol approval acceptSettings");
assert.ok(main.includes("acceptForSession"), "release must support protocol approval acceptForSession decisions");
assert.ok(main.includes("codex-messenger.log"), "release must keep the debug log file");
assert.ok(main.includes("ensureLoadedThread"), "release must resume existing threads before sending turns");

const siteHtml = read("codexmessenger.net/index.html");
assert.equal((siteHtml.match(/CodexMessenger\.exe\?v=/g) || []).length, 1, "site should expose one canonical Windows download link");
assert.equal((siteHtml.match(/CodexMessenger-mac-arm64\.dmg\?v=/g) || []).length, 1, "site should expose one canonical macOS download link");
assert.ok(!siteHtml.includes("v0.0.2.3"), "site must not keep stale release tags");

const workflow = read(".github/workflows/deploy-codexmessenger-net.yml");
assert.ok(workflow.includes("Release preflight"), "deploy workflow must run release preflight before deployment");
assert.ok(workflow.includes("npm run test:release"), "deploy workflow must verify release metadata");
assert.ok(workflow.includes("npm run test"), "deploy workflow must run API/formatting tests");

console.log(`Release check OK for ${packageJson.version} (${releaseTag})`);
