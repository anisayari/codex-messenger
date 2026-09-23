import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { findNpmCommand, spawnCommand } from "../shared/codexSetup.js";
import { canonicalReleaseVersion } from "./release-metadata.mjs";

const execFileAsync = promisify(execFile);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultAppleTeamId = "T99D3SZXLB";
const defaultNotaryProfile = "codex-messenger";

export function developerIdIdentity(output, teamId, preferred = "") {
  assert.match(teamId, /^[A-Z0-9]{10}$/, "APPLE_TEAM_ID must be an Apple team identifier");
  const found = [...String(output).matchAll(/^\s*\d+\)\s+([a-f0-9]{40})\s+"(Developer ID Application: ([^"\r\n]+) \(([A-Z0-9]{10})\))"\s*$/gmi)]
    .filter(match => match[4] === teamId)
    .map(match => ({ hash: match[1].toUpperCase(), subject: match[2], name: match[3] + " (" + match[4] + ")", teamId: match[4] }));
  const matches = [...new Map(found.map(identity => [identity.hash, identity])).values()];
  const selected = matches.filter(identity => !preferred || identity.hash === preferred.toUpperCase() || [identity.subject, identity.name].includes(preferred));
  assert.equal(selected.length, 1, selected.length === 0
    ? "A valid Developer ID Application identity for team " + teamId + " was not found"
    : "Multiple Developer ID Application identities match; select the exact certificate with CSC_NAME");
  return selected[0];
}

export async function notarizationCredentialSource(env, exec = execFileAsync) {
  // Match electron-builder's credential precedence, including rejection of partial credentials.
  if (env.APPLE_ID || env.APPLE_APP_SPECIFIC_PASSWORD) {
    assert.ok(env.APPLE_ID && env.APPLE_APP_SPECIFIC_PASSWORD && env.APPLE_TEAM_ID, "Complete Apple ID notarization credentials are required");
    return "Apple ID app-specific password";
  }
  if (env.APPLE_API_KEY || env.APPLE_API_KEY_ID || env.APPLE_API_ISSUER) {
    assert.ok(env.APPLE_API_KEY && env.APPLE_API_KEY_ID && env.APPLE_API_ISSUER, "Complete App Store Connect notarization credentials are required");
    return "App Store Connect API key";
  }
  const profile = env.APPLE_KEYCHAIN_PROFILE || defaultNotaryProfile;
  const args = ["notarytool", "history", "--keychain-profile", profile];
  if (env.APPLE_KEYCHAIN) args.push("--keychain", env.APPLE_KEYCHAIN);
  try { await exec("xcrun", args, { timeout: 15000, env }); }
  catch { throw new Error("A usable notarytool keychain profile or complete notarization credentials are required"); }
  env.APPLE_KEYCHAIN_PROFILE = profile;
  return "notarytool keychain profile";
}

export async function assertReleasePrerequisites({ platform = process.platform, env = process.env, exec = execFileAsync } = {}) {
  assert.equal(platform, "darwin", "macOS release packaging must be run on macOS");
  const releaseEnv = { ...env, APPLE_TEAM_ID: env.APPLE_TEAM_ID || defaultAppleTeamId };
  const { stdout } = await exec("security", ["find-identity", "-v", "-p", "codesigning"], { timeout: 15000, env: releaseEnv });
  const identity = developerIdIdentity(stdout, releaseEnv.APPLE_TEAM_ID, releaseEnv.CSC_NAME || "");
  const credentials = await notarizationCredentialSource(releaseEnv, exec);
  return { identity, credentials, env: releaseEnv };
}

export async function resolveNpmCli({ nodeExecutable = process.execPath, env = process.env, findNpm = findNpmCommand } = {}) {
  const nodeDirectory = path.dirname(nodeExecutable);
  const candidates = [env.npm_execpath,
    path.join(nodeDirectory, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
    path.join(nodeDirectory, "node_modules", "npm", "bin", "npm-cli.js"),
    path.join(nodeDirectory, "npm")].filter(Boolean);
  const usable = async candidate => {
    try {
      const resolved = await fs.realpath(candidate);
      if (path.basename(resolved) !== "npm-cli.js" || !(await fs.stat(resolved)).isFile()) return "";
      const manifest = JSON.parse(await fs.readFile(path.resolve(resolved, "..", "..", "package.json"), "utf8"));
      return manifest.name === "npm" ? resolved : "";
    } catch { return ""; }
  };
  for (const candidate of candidates) { const resolved = await usable(candidate); if (resolved) return resolved; }
  const found = await findNpm();
  const resolved = found.ok && found.command ? await usable(found.command) : "";
  assert.ok(resolved, "The npm JavaScript CLI could not be resolved; install Node.js/npm before packaging");
  return resolved;
}

export function macReleaseInvocations({ root = rootDir, nodeExecutable = process.execPath, npmCli, identity, arch }) {
  assert.ok(["x64", "arm64"].includes(arch), "Unsupported macOS release architecture");
  assert.match(identity.hash, /^[A-F0-9]{40}$/, "Signing must select an actual certificate hash");
  return [
    { command: nodeExecutable, args: [npmCli, "run", "build"] },
    { command: nodeExecutable, args: [path.join(root, "scripts/electron-builder-release-version.mjs"), "--mac", "dmg", "zip", "--" + arch,
      "-c.mac.identity=" + identity.hash, "-c.mac.forceCodeSigning=true", "-c.dmg.sign=true", "--publish", "never", "-c.directories.output=release/macos"] }
  ];
}

export function runReleaseProcess(command, args, { spawn = spawnCommand, ...options } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", ...options, shell: false });
    child.once("error", reject);
    child.once("close", (code, signal) => code === 0 && !signal ? resolve() : reject(new Error("macOS release subprocess did not complete successfully")));
  });
}

export function verifySigningIdentity(output, { identity, appId } = {}) {
  const lines = String(output).split(/\r?\n/);
  assert.ok(lines.includes("TeamIdentifier=" + identity.teamId), "The signed artifact has a different Apple team");
  assert.equal(lines.find(line => line.startsWith("Authority=")), "Authority=" + identity.subject, "The signed artifact has a different certificate subject");
  if (appId) assert.ok(lines.includes("Identifier=" + appId), "The signed application has a different bundle identifier");
}

export async function verifyMacRelease({ application, diskImage, identity, appId, exec = execFileAsync, env = process.env }) {
  const verify = async (target, deep, identifier) => {
    await exec("codesign", ["--verify", ...(deep ? ["--deep"] : []), "--strict", "--verbose=2", target], { timeout: 60000, env });
    const details = await exec("codesign", ["--display", "--verbose=4", target], { timeout: 15000, env });
    verifySigningIdentity((details.stdout || "") + "\n" + (details.stderr || ""), { identity, appId: identifier });
  };
  await verify(application, true, appId);
  await exec("spctl", ["--assess", "--type", "execute", "--verbose=4", application], { timeout: 60000, env });
  await exec("xcrun", ["stapler", "validate", application], { timeout: 60000, env });
  await verify(diskImage, false);
  return { application: { signature: true, certificateSubject: true, team: true, bundleIdentifier: true, gatekeeper: true, notarizationTicket: true },
    diskImage: { signature: true, certificateSubject: true, team: true, notarizationVerified: false } };
}

export async function packageMacRelease({ root = rootDir, platform = process.platform, arch = process.arch, nodeExecutable = process.execPath, env = process.env } = {},
  { exec = execFileAsync, run = runReleaseProcess, findNpm = findNpmCommand, log = console.log } = {}) {
  const prerequisites = await assertReleasePrerequisites({ platform, env, exec });
  const npmCli = await resolveNpmCli({ nodeExecutable, env: prerequisites.env, findNpm });
  const packageJson = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
  const version = canonicalReleaseVersion(packageJson.version);
  assert.ok(typeof packageJson.build?.appId === "string" && packageJson.build.appId, "The package bundle identifier is required");
  const releaseEnv = { ...prerequisites.env, npm_execpath: npmCli, npm_node_execpath: nodeExecutable,
    PATH: path.dirname(nodeExecutable) + path.delimiter + (prerequisites.env.PATH || "") };
  log("macOS release prerequisites verified for team " + prerequisites.identity.teamId + " (" + prerequisites.credentials + ").");
  for (const invocation of macReleaseInvocations({ root, nodeExecutable, npmCli, identity: prerequisites.identity, arch })) {
    await run(invocation.command, invocation.args, { cwd: root, env: releaseEnv });
  }
  const output = path.join(root, "release", "macos");
  const application = path.join(output, arch === "arm64" ? "mac-arm64" : "mac", "Codex Messenger.app");
  const diskImage = path.join(output, "Codex-Messenger-" + version + "-" + arch + ".dmg");
  const zip = path.join(output, "Codex-Messenger-" + version + "-" + arch + ".zip");
  assert.ok((await fs.lstat(application)).isDirectory(), "The signed application was not produced");
  for (const artifact of [diskImage, zip]) {
    const stat = await fs.lstat(artifact);
    assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size >= 1024, "A macOS release artifact was not produced");
  }
  const checks = await verifyMacRelease({ application, diskImage, identity: prerequisites.identity, appId: packageJson.build.appId, exec, env: releaseEnv });
  log("Application signature, Gatekeeper assessment and notarization ticket verified; DMG signature verified. DMG notarization has not been verified.");
  return { version, arch, identity: prerequisites.identity, checks };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  packageMacRelease().catch(error => { console.error(error.message); process.exitCode = 1; });
}
