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
const publicVersion = releaseTag.slice(1);

assert.equal(packageLock.version, packageJson.version, "package-lock top-level version must match package.json");
assert.equal(packageLock.packages[""].version, packageJson.version, "package-lock root package version must match package.json");
assert.equal(packageJson.build?.buildVersion, publicVersion, "build.buildVersion must match the public dotted release version");
assert.ok(
  JSON.stringify(packageJson.build).includes("CODEX_MESSENGER_RELEASE_VERSION"),
  "electron-builder artifact names must use the public dotted release version"
);

assertIncludes("README.md", releaseTag);
assertIncludes("README.md", publicVersion);
assertIncludes("README.md", "actions/workflows/ci.yml/badge.svg");
assertIncludes("README.md", "actions/workflows/codeql.yml/badge.svg");
assertIncludes("README.md", "actions/workflows/dependency-review.yml/badge.svg");
assertIncludes("README.md", "npm run audit:security");
assertIncludes("codexmessenger.net/index.html", releaseTag);
assertIncludes("codexmessenger.net/index.html", "https://github.com/anisayari/codex-messenger/releases/latest");

assertIncludes("SECURITY.md", "Reporting a Vulnerability");
assertIncludes(".github/dependabot.yml", "package-ecosystem: \"npm\"");

const main = read("electron/main.js");
const appServerClient = read("electron/codexAppServerClient.js");
const codexSetup = read("shared/codexSetup.js");
const protocolSource = `${main}\n${appServerClient}`;
assert.ok(protocolSource.includes("experimentalApi: true"), "initialize should opt into app-server capabilities");
assert.ok(protocolSource.includes("--analytics-default-enabled"), "release must use the tested app-server analytics flag");
assert.ok(protocolSource.includes("--disable") && protocolSource.includes("plugins"), "release must disable Codex plugin startup unless connectors are explicitly enabled");
assert.ok(main.includes("requestSingleInstanceLock"), "release must prevent duplicate app instances on the same profile");
assert.ok(read("electron/windowManager.js").includes("render-process-gone"), "release must log renderer process crashes");
assert.ok(codexSetup.includes('minimumCodexVersion = "0.125.0"'), "release must declare the minimum tested Codex CLI version");
assert.ok(read("README.md").includes("Codex CLI 0.125.0 or newer"), "README must document the minimum tested Codex CLI version");
assert.ok(!/persistExtendedHistory|experimentalRawEvents|persistFullHistory/.test(protocolSource), "release must not send experimental thread history fields");
assert.ok(!protocolSource.includes("acceptSettings"), "release must not send non-protocol approval acceptSettings");
assert.ok(protocolSource.includes("acceptForSession"), "release must support protocol approval acceptForSession decisions");
assert.ok(main.includes("codex-messenger.log"), "release must keep the debug log file");
assert.ok(main.includes("ensureLoadedThread"), "release must resume existing threads before sending turns");
assertIncludes("package.json", "\"include\": \"build/installer.nsh\"");
assertIncludes("build/installer.nsh", "!macro customInstall");
assertIncludes("build/installer.nsh", "IfSilent 0 +3");

const siteHtml = read("codexmessenger.net/index.html");
assert.ok(!/\.\/downloads\/CodexMessenger(?:-mac-arm64)?[^"']*\.(?:exe|dmg)/.test(siteHtml), "site must not link to local installer assets");
assert.ok(!/\sdownload="CodexMessenger/.test(siteHtml), "site release links must not use browser download attributes");
assert.ok((siteHtml.match(/https:\/\/github\.com\/anisayari\/codex-messenger\/releases\/latest/g) || []).length >= 2, "site should point platform buttons to GitHub Releases");
assert.ok(!siteHtml.includes("v0.0.2.3"), "site must not keep stale release tags");

const workflow = read(".github/workflows/deploy-codexmessenger-net.yml");
const ciWorkflow = read(".github/workflows/ci.yml");
const codeqlWorkflow = read(".github/workflows/codeql.yml");
const dependencyReviewWorkflow = read(".github/workflows/dependency-review.yml");
assert.ok(ciWorkflow.includes("npm run audit:security"), "CI workflow must run npm security audit");
assert.ok(codeqlWorkflow.includes("github/codeql-action/analyze"), "CodeQL workflow must run GitHub code scanning");
assert.ok(dependencyReviewWorkflow.includes("actions/dependency-review-action"), "dependency review workflow must inspect PR dependency changes");
assert.ok(workflow.includes("Release preflight"), "deploy workflow must run release preflight before deployment");
assert.ok(workflow.includes("npm run audit:security"), "deploy workflow must run npm security audit before deployment");
assert.ok(workflow.includes("npm run test:release"), "deploy workflow must verify release metadata");
assert.ok(workflow.includes("npm run test"), "deploy workflow must run API/formatting tests");
assert.ok(workflow.includes("ELECTRON_DISABLE_SANDBOX: 1"), "deploy workflow must disable Electron sandbox only for Linux smoke tests");
assert.ok(workflow.includes("github.event.release.tag_name"), "deploy workflow must use the triggering release tag when available");

console.log(`Release check OK for ${packageJson.version} (${releaseTag})`);
