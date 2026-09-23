import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parseInstallerSmokeArguments, isOwnedPath, nsisInstallArguments, validateInstallerApplication, validateOriginAsar,
  validatePortableWrapper, validateReadOnlyMount, validateBundleIdentity, validateInstalledRegistration, uniqueRegularPayload,
  installerChecks, validateInstallerEntry, requireNativeCommandExit, validateOwnedRegistrationCleanup, runInstallerSmoke,
  nsisUninstallArguments, nsisVerbatimCommand, copyOwnedUninstaller } from '../scripts/installer-smoke.mjs';

const options = { version: '0.0.4', platform: 'windows', arch: 'x64', output: 'release/windows', report: 'proof.json' };
const checkNames = ['packaged', 'asar', 'version', 'platform', 'architecture', 'privateProfile', 'sandbox', 'contextIsolation', 'nodeIntegrationDisabled', 'webSecurity', 'preloadBootstrap', 'rendererNodeIsolated', 'packagedDocument', 'renderedDom'];
const smoke = () => ({ schemaVersion: 1, passed: true, version: options.version, platform: options.platform, arch: options.arch,
  checks: Object.fromEntries(checkNames.map(key => [key, true])), errors: { preloadError: 0, loadFailure: 0, rendererGone: 0, pageError: 0, consoleError: 0 },
  process: { closed: true, forced: false, exitCode: 0 }, failure: null, appAsarSha256: 'a'.repeat(64) });
const result = { started: true, timedOut: false, forced: false, code: 0, signal: null };
const wrapperOptions = { version: options.version, privateRoot: 'C:\\private\\temp', userData: 'C:\\private\\profile' };
const wrapperLog = () => [
  { event: 'app.start', version: options.version, packaged: true, dev: false, logPath: 'C:\\private\\profile\\codex-messenger.log' },
  { event: 'window.ready-to-show', key: 'main', url: 'file:///C:/private/temp/payload/resources/app.asar/dist/index.html' }
].map(record => JSON.stringify(record)).join('\n');

test('installer smoke CLI and NSIS arguments preserve the last unquoted private custom directory with spaces', () => {
  assert.deepEqual(parseInstallerSmokeArguments(Object.entries(options).flatMap(([key, value]) => ['--' + key, value])), options);
  assert.deepEqual(nsisInstallArguments('C:\\private\\custom path'), ['/S', '/currentuser', '--no-desktop-shortcut', '/D=C:\\private\\custom path']);
  for (const bad of ['relative', 'C:\\private\\bad"path', 'C:\\private\\bad\npath']) assert.throws(() => nsisInstallArguments(bad));
  assert.throws(() => parseInstallerSmokeArguments(['--version', '0.0.4\n']));
});

test('direct NSIS uninstall waits on the copied executable with only argv0 quoted and the install directory last and unquoted', () => {
  const directory = 'C:\\private root\\custom install with spaces\\Codex Messenger';
  assert.deepEqual(nsisUninstallArguments(directory), ['/S', '/currentuser', `_?=${directory}`]);
  const executable = 'C:\\private root\\uninstall execution with spaces\\Uninstall Codex Messenger.exe';
  assert.deepEqual(nsisVerbatimCommand(executable), { windowsVerbatimArguments: true, argv0: `"${executable}"` });
  for (const bad of ['relative', 'C:\\private\\bad"path', 'C:\\private\\bad\npath']) {
    assert.throws(() => nsisUninstallArguments(bad)); assert.throws(() => nsisVerbatimCommand(bad));
  }
});

test('NSIS uninstall copies refresh the actual regular executable outside its directory and refuse an unknown or changed identity', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'installer-uninstall-unit-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const directory = path.join(root, 'custom install with spaces', 'Codex Messenger');
  await fs.mkdir(directory, { recursive: true });
  const source = path.join(directory, 'Uninstall Codex Messenger.exe'), data = Buffer.alloc(2048, 0x5a);
  await fs.writeFile(source, data);
  const digest = createHash('sha256').update(data).digest('hex');
  const first = await copyOwnedUninstaller(root, directory, digest), second = await copyOwnedUninstaller(root, directory, digest);
  assert.notEqual(first.executable, second.executable);
  for (const copy of [first, second]) {
    assert.equal(isOwnedPath(root, copy.executable), true); assert.equal(isOwnedPath(directory, copy.executable), false);
    assert.match(copy.executable, /uninstall execution with spaces/);
    assert.equal((await fs.lstat(copy.executable)).isSymbolicLink(), false);
    assert.deepEqual(await fs.readFile(copy.executable), data);
    await fs.rm(copy.copyDirectory, { recursive: true, force: true });
  }
  await assert.rejects(copyOwnedUninstaller(root, directory, undefined));
  await assert.rejects(copyOwnedUninstaller(root, directory, 'a'.repeat(64)));
  await fs.writeFile(source, Buffer.alloc(2048, 0x6b));
  await assert.rejects(copyOwnedUninstaller(root, directory, digest));
  await fs.unlink(source);
  await fs.symlink(process.platform === 'win32' ? directory : 'missing-target.exe', source, process.platform === 'win32' ? 'junction' : 'file');
  await assert.rejects(copyOwnedUninstaller(root, directory, digest));
  assert.deepEqual(await fs.readdir(root), ['custom install with spaces']);
});

test('owned paths require a distinct descendant and reject roots, siblings, traversal and another volume', () => {
  for (const [root, file, platform] of [['C:\\private', 'C:\\private\\app', 'win32'], ['/private/tmp', '/private/tmp/app', 'darwin']]) assert.equal(isOwnedPath(root, file, platform), true);
  for (const candidate of ['C:\\private', 'C:\\privateBackup\\app', 'C:\\private\\..\\foreign', 'D:\\private\\app']) assert.equal(isOwnedPath('C:\\private', candidate, 'win32'), false);
  for (const candidate of ['/private/tmp', '/private/tmpBackup/app', '/private/tmp/../foreign']) assert.equal(isOwnedPath('/private/tmp', candidate, 'darwin'), false);
});

test('installer proof requires all 14 real smoke checks, zero errors, clean exit and exact app.asar origin', () => {
  validateInstallerApplication(smoke(), options); validateOriginAsar('a'.repeat(64), 'a'.repeat(64));
  for (const mutate of [data => { data.checks.preloadBootstrap = false; }, data => { delete data.checks.sandbox; }, data => { data.errors.pageError = 1; },
    data => { data.process.forced = true; }, data => { data.process.exitCode = 1; }, data => { data.version = '0.0.3'; }, data => { data.failure = 'BOOTSTRAP'; }, data => { data.passed = false; }]) {
    const data = smoke(); mutate(data); assert.throws(() => validateInstallerApplication(data, options));
  }
  assert.throws(() => validateOriginAsar('b'.repeat(64), 'a'.repeat(64)));
  const entry = { passed: true, bytes: 1024, sha256: 'a'.repeat(64), appAsarSha256: 'a'.repeat(64), smoke: smoke(), checks: Object.fromEntries(installerChecks.nsis.map(key => [key, true])) };
  validateInstallerEntry(entry, 'nsis', options);
  for (const key of ['foreignFilePreserved', 'legacySharedDirectoryRefused', 'legacyFilesPreserved']) {
    entry.checks[key] = false; assert.throws(() => validateInstallerEntry(entry, 'nsis', options)); entry.checks[key] = true;
  }
  entry.smoke.appAsarSha256 = 'b'.repeat(64); assert.throws(() => validateInstallerEntry(entry, 'nsis', options));
});

test('actual portable wrapper proof rejects missing startup, foreign document, renderer errors and forced or failed exits', () => {
  const checks = validatePortableWrapper(wrapperLog(), result, wrapperOptions);
  assert.equal(checks.actualWrapperExecution, true); assert.equal(Object.hasOwn(checks, 'preloadBootstrap'), false);
  for (const invalid of [wrapperLog() + '\nnull', wrapperLog() + '\n{', wrapperLog().split('\n')[0], wrapperLog().replaceAll('0.0.4', '0.0.3'),
    wrapperLog().replace('/private/temp/', '/foreign/'), wrapperLog() + '\n' + JSON.stringify({ event: 'renderer.react.render.error' }),
    wrapperLog() + '\n' + JSON.stringify({ event: 'window.preload-error' }), wrapperLog() + '\n' + JSON.stringify({ event: 'window.console-message', level: 'error' }),
    wrapperLog() + '\n' + wrapperLog().split('\n')[0]]) assert.throws(() => validatePortableWrapper(invalid, result, wrapperOptions));
  for (const changes of [{ timedOut: true }, { forced: true }, { code: 1 }, { code: null }, { signal: 'SIGKILL' }, { started: false }]) assert.throws(() => validatePortableWrapper(wrapperLog(), { ...result, ...changes }, wrapperOptions));
});

test('DMG receipt and Mac bundle identity require a readonly owned mount, exact version and exact architecture', () => {
  validateReadOnlyMount('/dev/disk4s2 on /private/owned mount (hfs, local, read-only, noowners)\n', '/private/owned mount');
  for (const output of ['/dev/disk4 on /private/foreign (hfs, read-only)', '/dev/disk4 on /private/owned mount (hfs, local)',
    '/dev/disk4 on /private/owned mount (hfs, read-only)\n/dev/disk5 on /private/owned mount (hfs, read-only)']) assert.throws(() => validateReadOnlyMount(output, '/private/owned mount'));
  const plist = { CFBundleIdentifier: 'com.codex.messenger', CFBundleShortVersionString: '0.0.4', CFBundleVersion: '0.0.4' };
  validateBundleIdentity(plist, 'arm64\n', { version: '0.0.4', arch: 'arm64' });
  assert.throws(() => validateBundleIdentity(plist, 'x86_64 arm64\n', { version: '0.0.4', arch: 'arm64' }));
  assert.throws(() => validateBundleIdentity({ ...plist, CFBundleVersion: '0.0.3' }, 'arm64', { version: '0.0.4', arch: 'arm64' }));
});

test('NSIS registration proof keeps the exact private install directory, version and Start Menu shortcut associated', () => {
  const state = { entries: [{ hive: 'HKCU', installKey: true, uninstallKey: true, location: 'C:\\private\\custom path', version: '0.0.4' }], menu: true, desktop: false };
  validateInstalledRegistration(state, 'C:\\private\\custom path', '0.0.4');
  assert.throws(() => validateInstalledRegistration(state, 'C:\\private\\other path', '0.0.4'));
  assert.throws(() => validateInstalledRegistration({ ...state, desktop: true }, 'C:\\private\\custom path', '0.0.4'));
  assert.throws(() => validateInstalledRegistration({ ...state, entries: [...state.entries, ...state.entries] }, 'C:\\private\\custom path', '0.0.4'));
});

test('portable extraction requires one regular embedded payload and never invents absent or duplicate payloads', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'installer-smoke-unit-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await assert.rejects(uniqueRegularPayload(root, 'app-64.7z'));
  await fs.mkdir(path.join(root, 'plugin')); await fs.writeFile(path.join(root, 'plugin', 'app-64.7z'), 'fixture');
  assert.equal(await uniqueRegularPayload(root, 'app-64.7z'), path.join(root, 'plugin', 'app-64.7z'));
  await fs.writeFile(path.join(root, 'app-64.7z'), 'fixture'); await assert.rejects(uniqueRegularPayload(root, 'app-64.7z'));
});

test('native command failures expose only bounded exit or timeout codes and retain the expected guard exit', () => {
  assert.equal(requireNativeCommandExit({ ...result, stdout: 'receipt' }), 'receipt');
  requireNativeCommandExit({ ...result, code: 42 }, 42);
  for (const [changes, code] of [[{ code: 7 }, 'NATIVE_COMMAND_EXIT_7'], [{ code: null }, 'NATIVE_COMMAND_EXIT_UNKNOWN'],
    [{ timedOut: true }, 'NATIVE_COMMAND_TIMEOUT'], [{ forced: true }, 'NATIVE_COMMAND_FORCED'], [{ started: false }, 'NATIVE_COMMAND_NOT_STARTED'], [{ signal: 'SIGKILL' }, 'NATIVE_COMMAND_SIGNAL'], [{ aborted: true }, 'HARD_TIMEOUT']]) {
    assert.throws(() => requireNativeCommandExit({ ...result, ...changes, stderr: '/private/secret/fixture' }), error => error.installerSmokeCode === code && !error.message.includes('/private'));
  }
  assert.throws(() => requireNativeCommandExit(result, 42), error => error.installerSmokeCode === 'NATIVE_COMMAND_EXIT_0' && error.expectedExitCode === 42);
});

test('partial NSIS cleanup requires exact owned registration and shortcut targets before any deletion', () => {
  const identity = { root: 'C:\\private', directory: 'C:\\private\\Codex Messenger', version: options.version, owner: 'owned-test-nonce' };
  const record = { hive: 'HKCU', installKey: true, uninstallKey: true, location: identity.directory, version: options.version,
    installOwner: null, uninstallOwner: null, uninstallLocation: null, uninstallCommand: '"C:\\private\\Codex Messenger\\Uninstall Codex Messenger.exe" /currentuser' };
  const state = () => ({ entries: [{ ...record }], shortcuts: [{ kind: 'menu', reparse: false, target: 'C:\\private\\Codex Messenger\\Codex Messenger.exe' }] });
  validateOwnedRegistrationCleanup(state(), identity);
  validateOwnedRegistrationCleanup({ entries: [], shortcuts: [] }, identity);
  const partial = state(); Object.assign(partial.entries[0], { uninstallKey: false, version: null, uninstallCommand: null });
  assert.throws(() => validateOwnedRegistrationCleanup(partial, identity));
  partial.entries[0].installOwner = identity.owner; validateOwnedRegistrationCleanup(partial, identity);
  const arpOnly = state(); Object.assign(arpOnly.entries[0], { installKey: false, location: null }); validateOwnedRegistrationCleanup(arpOnly, identity);
  const marked = state(); Object.assign(marked.entries[0], { installOwner: identity.owner, uninstallOwner: identity.owner, uninstallLocation: identity.directory, version: null, uninstallCommand: null });
  validateOwnedRegistrationCleanup(marked, identity);
  for (const change of [{ hive: 'HKLM' }, { location: 'C:\\privateBackup\\Codex Messenger' }, { version: '0.0.3' }, { installOwner: 'foreign' },
    { uninstallOwner: 'foreign' }, { uninstallLocation: 'C:\\foreign' }, { uninstallCommand: '"C:\\foreign\\uninstall.exe" /currentuser' }]) {
    const invalid = structuredClone(marked); Object.assign(invalid.entries[0], change); assert.throws(() => validateOwnedRegistrationCleanup(invalid, identity));
  }
  for (const change of [{ target: 'C:\\foreign\\Codex Messenger.exe' }, { reparse: true }, { kind: 'foreign' }]) {
    const invalid = state(); Object.assign(invalid.shortcuts[0], change); assert.throws(() => validateOwnedRegistrationCleanup(invalid, identity));
  }
});

test('global installer timeout returns failure before host or installer I/O and leaves no fabricated pass', async () => {
  const controller = new AbortController(); controller.abort();
  const report = await runInstallerSmoke(options, { signal: controller.signal });
  assert.equal(report.passed, false); assert.equal(report.failureDetail, 'HARD_TIMEOUT'); assert.deepEqual(report.installers, []);
});
