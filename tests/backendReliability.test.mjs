import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import { createSettingsStore } from "../electron/settingsStore.js";
import { assertTrustedIpcSender, installIpcSenderValidation, isTrustedRendererUrl } from "../electron/security.js";
import { assertUpdateDigest, assertUpdateUrl, downloadUpdateFile, launchUpdateInstaller, macUpdateInstallerScript, verifyUpdateFile, windowsInstallerSignatureCommand } from "../electron/updateService.js";

const execFileAsync = promisify(execFile);
const digest = (value) => createHash("sha256").update(value).digest("hex");
async function temporary(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-messenger-backend-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

test("settings commit atomically, preserve cache after write failure, and recover the queue", async (t) => {
  const dir = await temporary(t);
  const settingsPath = path.join(dir, "settings.json");
  let failRename = false;
  const fileSystem = { ...fs, async rename(...args) {
    if (failRename) { failRename = false; throw new Error("injected commit failure"); }
    return fs.rename(...args);
  } };
  const store = createSettingsStore({ settingsFilePath: () => settingsPath, defaultSettings: { count: 0 }, fileSystem });
  await store.loadRaw();
  await store.save({ count: 1 });
  failRename = true;
  await assert.rejects(store.save({ count: 2 }), /injected/);
  assert.deepEqual(store.current(), { count: 1 });
  assert.deepEqual(JSON.parse(await fs.readFile(settingsPath, "utf8")), { count: 1 });
  assert.deepEqual(await fs.readdir(dir), ["settings.json"]);
  await store.save({ count: 3 });
  assert.deepEqual(JSON.parse(await fs.readFile(settingsPath, "utf8")), { count: 3 });
  if (process.platform !== "win32") assert.equal((await fs.stat(settingsPath)).mode & 0o777, 0o600);
});

test("settings isolate nested defaults, saved snapshots and readers, while preserving write order", async (t) => {
  const dir = await temporary(t);
  const defaults = { profile: { name: "default" } };
  const store = createSettingsStore({ settingsFilePath: () => path.join(dir, "settings.json"), defaultSettings: defaults });
  const initial = await store.loadRaw();
  initial.settings.profile.name = "modified externally";
  assert.equal(defaults.profile.name, "default");
  const snapshot = { profile: { name: "first" } };
  const first = store.save(snapshot);
  snapshot.profile.name = "mutated";
  const second = store.save({ profile: { name: "second" } });
  assert.equal((await first).profile.name, "first");
  await second;
  const returned = store.current(); returned.profile.name = "external";
  assert.equal(store.current().profile.name, "second");
  assert.equal(JSON.parse(await fs.readFile(path.join(dir, "settings.json"), "utf8")).profile.name, "second");
});

test("malformed settings are retained for recovery and never treated as valid stored settings", async (t) => {
  const dir = await temporary(t);
  const file = path.join(dir, "settings.json");
  await fs.writeFile(file, "{broken");
  const store = createSettingsStore({ settingsFilePath: () => file, defaultSettings: { language: "fr" } });
  assert.deepEqual(await store.loadRaw(), { settings: { language: "fr" }, loadedStoredSettings: false });
  const backup = (await fs.readdir(dir)).find((entry) => entry.startsWith("settings.json.corrupt-"));
  assert.ok(backup);
  assert.equal(await fs.readFile(path.join(dir, backup), "utf8"), "{broken");
});

test("renderer trust requires exact document, origin, credentials absence and the main frame", () => {
  const document = "file:///Applications/Codex%20Messenger.app/Contents/Resources/app/dist/index.html";
  assert.equal(isTrustedRendererUrl(`${document}?view=chat`, document), true);
  assert.equal(isTrustedRendererUrl("file:///tmp/index.html", document), false);
  assert.equal(isTrustedRendererUrl("https://example.com/index.html", document), false);
  assert.equal(isTrustedRendererUrl("http://localhost:5174/?view=chat", "http://localhost:5174/"), true);
  assert.equal(isTrustedRendererUrl("http://localhost:5175/", "http://localhost:5174/"), false);
  assert.equal(isTrustedRendererUrl("http://name:pass@localhost:5174/", "http://localhost:5174/"), false);
  assert.equal(isTrustedRendererUrl("https://example.com/", "https://example.com/"), false);
  const frame = { url: document, parent: null };
  assert.doesNotThrow(() => assertTrustedIpcSender({ senderFrame: frame, sender: { mainFrame: frame } }, document));
  assert.throws(() => assertTrustedIpcSender({ senderFrame: { ...frame, parent: frame } }, document), /blocked/);
  assert.throws(() => assertTrustedIpcSender({ senderFrame: frame, sender: { mainFrame: {} } }, document), /blocked/);
});

test("the IPC registration guard protects callbacks without changing results", () => {
  const callbacks = new Map();
  const ipc = { handle(channel, callback) { callbacks.set(channel, callback); } };
  const rendererUrl = "file:///app/dist/index.html";
  installIpcSenderValidation(ipc, { rendererUrl });
  installIpcSenderValidation(ipc, { rendererUrl });
  let calls = 0;
  ipc.handle("test", (_event, value) => { calls += 1; return value + 1; });
  assert.throws(() => callbacks.get("test")({ senderFrame: { url: "https://example.com" } }, 3), /blocked/);
  assert.equal(calls, 0);
  assert.equal(callbacks.get("test")({ senderFrame: { url: rendererUrl } }, 3), 4);
});

test("updater accepts only official HTTPS hosts and complete digests", () => {
  assert.equal(assertUpdateUrl("https://github.com/anisayari/codex-messenger/releases/download/v1/app.dmg"), "https://github.com/anisayari/codex-messenger/releases/download/v1/app.dmg");
  for (const url of ["http://github.com/app", "file:///tmp/app", "https://github.com.attacker.test/app", "https://name:secret@github.com/app"]) assert.throws(() => assertUpdateUrl(url), /blocked/);
  assert.equal(assertUpdateDigest("A".repeat(64)), "a".repeat(64));
  for (const value of ["", "abc", "g".repeat(64)]) assert.throws(() => assertUpdateDigest(value), /digest/);
});

test("download commits only verified complete bytes and rechecks a later modified file", async (t) => {
  const dir = await temporary(t);
  const target = path.join(dir, "app.dmg");
  const bytes = Buffer.from("verified fixture");
  const progress = [];
  let fetches = 0;
  const result = await downloadUpdateFile("https://github.com/app.dmg", target, "1", {
    expectedSha256: digest(bytes), expectedBytes: bytes.length,
    fetchImpl: async () => { fetches += 1; return new Response(bytes, { headers: { "content-length": String(bytes.length) } }); },
    onProgress: (value) => progress.push(value)
  });
  assert.equal(fetches, 1); assert.equal(result.sha256, digest(bytes));
  assert.deepEqual(await fs.readFile(target), bytes);
  assert.equal(progress.at(-1).percent, 100);
  await verifyUpdateFile(target, result.sha256, result.bytes);
  await fs.writeFile(target, "tampered fixture");
  await assert.rejects(verifyUpdateFile(target, result.sha256, result.bytes), /checksum/);
});

test("failed downloads keep the previous final file and remove all partial files", async (t) => {
  const dir = await temporary(t);
  const target = path.join(dir, "app.dmg");
  await fs.writeFile(target, "previous valid file");
  await assert.rejects(downloadUpdateFile("https://github.com/app.dmg", target, "1", {
    expectedSha256: digest("expected fixture"), fetchImpl: async () => new Response("wrong fixture")
  }), /checksum/);
  assert.equal(await fs.readFile(target, "utf8"), "previous valid file");
  assert.deepEqual(await fs.readdir(dir), ["app.dmg"]);
  await assert.rejects(downloadUpdateFile("https://github.com/app.dmg", target, "1", {
    expectedSha256: digest("fixture"), expectedBytes: 99, fetchImpl: async () => new Response("fixture")
  }), /size/);
  assert.deepEqual(await fs.readdir(dir), ["app.dmg"]);
});

test("downloads reject redirect escapes, loops and absent release digests before committing", async (t) => {
  const dir = await temporary(t);
  const target = path.join(dir, "app.dmg");
  let calls = 0;
  await assert.rejects(downloadUpdateFile("https://github.com/app.dmg", target, "1", {
    fetchImpl: async () => { calls += 1; return new Response("unused"); }
  }), /digest/);
  assert.equal(calls, 0);
  await assert.rejects(downloadUpdateFile("https://github.com/app.dmg", target, "1", {
    expectedSha256: digest("fixture"), fetchImpl: async () => new Response(null, { status: 302, headers: { location: "http://attacker.test/app" } })
  }), /blocked/);
  await assert.rejects(downloadUpdateFile("https://github.com/app.dmg", target, "1", {
    expectedSha256: digest("fixture"), fetchImpl: async () => { calls += 1; return new Response(null, { status: 302, headers: { location: "/loop" } }); }
  }), /redirects/);
  assert.equal(calls, 6); assert.deepEqual(await fs.readdir(dir), []);
});

test("installer launch rejects a spawn failure and waits for successful process startup", async () => {
  const failure = new EventEmitter(); failure.unref = () => {};
  const failed = launchUpdateInstaller("missing", [], {}, () => failure);
  failure.emit("error", new Error("missing executable"));
  await assert.rejects(failed, /missing executable/);
  const success = new EventEmitter(); let unreferenced = false;
  success.unref = () => { unreferenced = true; };
  const started = launchUpdateInstaller("fixture", [], {}, () => success);
  assert.equal(unreferenced, false); success.emit("spawn"); await started;
  assert.equal(unreferenced, true);
});

test("Windows signature verification checks both publisher identities and quotes literal paths", () => {
  const check = windowsInstallerSignatureCommand("C:\\Updates\\Anis' setup.exe", "C:\\App\\Messenger.exe");
  assert.equal(check.command, "powershell.exe");
  const script = check.args.at(-1);
  assert.match(script, /Get-AuthenticodeSignature -LiteralPath 'C:\\Updates\\Anis'' setup.exe'/);
  assert.match(script, /installed\.Status -ne 'Valid'/);
  assert.match(script, /SignerCertificate\.Subject/);
});

test("macOS updater rolls back after relaunch failure, preserving the prior app", { skip: !existsSync("/bin/zsh") }, async (t) => {
  const dir = await temporary(t);
  const target = path.join(dir, "Codex Messenger.app");
  const source = path.join(dir, "source.app");
  const mount = path.join(dir, "mount");
  await fs.mkdir(target); await fs.mkdir(source); await fs.mkdir(mount);
  await fs.writeFile(path.join(target, "version"), "previous");
  await fs.writeFile(path.join(source, "version"), "new");
  const quote = (value) => `'${value.replace(/'/g, "'\\''")}'`;
  const stubs = {
    "/usr/bin/mktemp": `printf '%s\\n' ${quote(mount)}`,
    "/usr/bin/hdiutil": `if [ "$1" = attach ]; then /bin/cp -R ${quote(source)} ${quote(path.join(mount, "Codex Messenger.app"))}; else /bin/rm -rf ${quote(path.join(mount, "Codex Messenger.app"))}; fi`,
    "/usr/bin/codesign": "if [ \"$1\" = -dv ]; then printf 'TeamIdentifier=ABCDE12345\\n' >&2; fi; exit 0",
    "/usr/sbin/spctl": "exit 0",
    "/usr/bin/ditto": '/bin/cp -R "$1" "$2"',
    "/usr/bin/open": "exit 1"
  };
  let script = macUpdateInstallerScript("ABCDE12345");
  assert.doesNotMatch(script, /xattr|quarantine/);
  for (const [command, body] of Object.entries(stubs)) {
    const fixture = path.join(dir, `${path.basename(command)}-fixture`);
    await fs.writeFile(fixture, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    script = script.replaceAll(command, quote(fixture));
  }
  const file = path.join(dir, "update.zsh"); await fs.writeFile(file, script);
  await assert.rejects(execFileAsync("/bin/zsh", [file, "99999999", path.join(dir, "unused.dmg"), target, path.join(dir, "update.log")]));
  assert.equal(await fs.readFile(path.join(target, "version"), "utf8"), "previous");
  assert.equal((await fs.readdir(dir)).some((entry) => entry.includes(".backup.") || entry.includes(".update.")), false);
});
