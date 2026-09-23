import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parseInstallerSmokeArguments, isOwnedPath, nsisInstallArguments, validateInstallerApplication, validateOriginAsar,
  validatePortableWrapper, validateReadOnlyMount, validateBundleIdentity, validateInstalledRegistration, uniqueRegularPayload,
  installerChecks, validateInstallerEntry, requireNativeCommandExit, validateOwnedRegistrationCleanup, runInstallerSmoke,
  nsisUninstallArguments, nsisVerbatimCommand, copyOwnedUninstaller, runWithOwnedCleanup, privateEnvironment, powershell,
  parseInstallerTrace, sanitizeWindowsTimeoutDiagnostics, captureWindowsTimeoutDiagnostics, snapshotInstallerCaches,
  cleanupInstallerCaches, validateNativeInstallerFolders, snapshotInstalledPayload, validateRunningInstalledApplication,
  readRunningApplicationLog, waitForRunningInstalledApplication, snapshotPortableTemp, classifyPortableTemp,
  requirePortableTempCleanup } from '../scripts/installer-smoke.mjs';

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

test('portable diagnostic CLI is explicitly marked and accepts only the Windows x64 portable target', () => {
  const args = Object.entries(options).flatMap(([key, value]) => ['--' + key, value]);
  assert.deepEqual(parseInstallerSmokeArguments([...args, '--diagnostic-container', 'portable']), { ...options, diagnosticContainer: 'portable' });
  for (const value of ['nsis', 'dmg', '', 'portable\n']) assert.throws(() => parseInstallerSmokeArguments([...args, '--diagnostic-container', value]));
  assert.throws(() => parseInstallerSmokeArguments([...args, '--diagnostic-container', 'portable', '--diagnostic-container', 'portable']));
  const macArgs = Object.entries({ ...options, platform: 'macos', arch: 'arm64' }).flatMap(([key, value]) => ['--' + key, value]);
  assert.throws(() => parseInstallerSmokeArguments([...macArgs, '--diagnostic-container', 'portable']));
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
  for (const key of ['runningAppInstallRefused', 'runningAppPreserved', 'foreignFilePreserved', 'legacySharedDirectoryRefused', 'legacyFilesPreserved']) {
    entry.checks[key] = false; assert.throws(() => validateInstallerEntry(entry, 'nsis', options)); entry.checks[key] = true;
  }
  entry.smoke.appAsarSha256 = 'b'.repeat(64); assert.throws(() => validateInstallerEntry(entry, 'nsis', options));
});

test('running installed application readiness requires one fresh packaged start and the exact installed renderer, with zero runtime errors', () => {
  const expected = { version: '0.0.4', userData: 'C:\\private\\profile', asar: 'C:\\private\\installed app\\resources\\app.asar' };
  const records = [
    { event: 'app.start', version: expected.version, packaged: true, dev: false, logPath: 'C:\\private\\profile\\codex-messenger.log' },
    { event: 'window.ready-to-show', key: 'main', url: 'file:///C:/private/installed%20app/resources/app.asar/dist/index.html' }
  ];
  const log = records.map(record => JSON.stringify(record)).join('\n');
  validateRunningInstalledApplication(log, expected);
  for (const changed of [records.slice(0, 1), [...records, records[0]], [records[0], { ...records[1], url: 'file:///C:/foreign/resources/app.asar/dist/index.html' }],
    [{ ...records[0], packaged: false }, records[1]], [{ ...records[0], version: '0.0.3' }, records[1]],
    [{ ...records[0], logPath: 'C:\\foreign\\codex-messenger.log' }, records[1]], [...records, { event: 'window.render-process-gone' }]]) {
    assert.throws(() => validateRunningInstalledApplication(changed.map(record => JSON.stringify(record)).join('\n'), expected));
  }
});

test('running application log offsets exclude stale readiness and refuse truncation or links', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'installer-running-log-unit-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'codex-messenger.log');
  const previous = Buffer.from('{"event":"app.start","version":"stale"}\n');
  await fs.writeFile(file, previous);
  assert.equal(await readRunningApplicationLog(file, previous.length), '');
  const fresh = '{"event":"app.start","version":"fresh"}\n';
  await fs.appendFile(file, fresh);
  assert.equal(await readRunningApplicationLog(file, previous.length), fresh);
  await fs.writeFile(file, 'truncated');
  await assert.rejects(readRunningApplicationLog(file, previous.length));
  await fs.unlink(file); await fs.symlink(root, file, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(readRunningApplicationLog(file, 0));
});

test('running application readiness remains bounded and never converts missing startup, exit or renderer errors into a pass', async () => {
  // An injected unit probe is not evidence of a running native Windows app.
  const child = { pid: 123, exitCode: null, signalCode: null }, probe = () => {};
  const expected = { version: '0.0.4', userData: 'C:\\private\\profile', asar: 'C:\\private\\resources\\app.asar' };
  const started = Date.now();
  await assert.rejects(waitForRunningInstalledApplication(child, expected, { readLog: async () => '', probe, timeoutMs: 25, pollMs: 5 }), error => error.installerSmokeCode === 'RUNNING_APP_READY_TIMEOUT');
  assert.ok(Date.now() - started < 1000);
  await assert.rejects(waitForRunningInstalledApplication(child, expected, { readLog: () => new Promise(() => {}), probe, timeoutMs: 25, pollMs: 5 }), error => error.installerSmokeCode === 'RUNNING_APP_READY_TIMEOUT');
  await assert.rejects(waitForRunningInstalledApplication(child, expected, { readLog: async () => '{"event":"window.preload-error"}', probe, timeoutMs: 25, pollMs: 5 }), error => error.installerSmokeCode === 'RUNNING_APP_RUNTIME_ERRORS');
  await assert.rejects(waitForRunningInstalledApplication(child, expected, { readLog: async () => '', probe: () => { throw Object.assign(new Error('RUNNING_APP_EXITED'), { installerSmokeCode: 'RUNNING_APP_EXITED' }); }, timeoutMs: 25, pollMs: 5 }), error => error.installerSmokeCode === 'RUNNING_APP_EXITED');
  await assert.rejects(waitForRunningInstalledApplication(child, expected, { readLog: async () => '', probe, timeoutMs: 15001 }));
});

test('installed payload comparison binds every file and directory to the canonical owned root and catches altered, added or removed files', async t => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'installer-running-payload-unit-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const directory = path.join(root, 'installed app'), resources = path.join(directory, 'resources'), executable = path.join(directory, 'Codex Messenger.exe');
  await fs.mkdir(resources, { recursive: true });
  await fs.writeFile(executable, 'unit executable fixture'); await fs.writeFile(path.join(resources, 'app.asar'), 'unit archive fixture');
  const before = await snapshotInstalledPayload(root, directory);
  assert.deepEqual(await snapshotInstalledPayload(root, directory), before);
  await fs.writeFile(executable, 'modified executable fixture');
  assert.notDeepEqual(await snapshotInstalledPayload(root, directory), before);
  await fs.writeFile(executable, 'unit executable fixture'); await fs.writeFile(path.join(directory, 'foreign.txt'), 'added fixture');
  assert.notDeepEqual(await snapshotInstalledPayload(root, directory), before);
  await fs.unlink(path.join(directory, 'foreign.txt')); await fs.unlink(executable);
  assert.notDeepEqual(await snapshotInstalledPayload(root, directory), before);
  await fs.symlink(resources, executable, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(snapshotInstalledPayload(root, directory));
  await assert.rejects(snapshotInstalledPayload(root, root));
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

test('portable TEMP diagnostics expose only bounded categories and kinds, including PowerShell policy files and NSIS or payload directories', () => {
  const records = [
    { name: '__PSScriptPolicyTest_a1b2c3.d4e5.ps1', kind: 'file' },
    { name: '__PSScriptPolicyTest_a1b2c3.d4e5.psm1', kind: 'file' },
    { name: 'nsAB12.tmp', kind: 'directory' }, { name: 'nsCD34.tmp', kind: 'file' },
    { name: 'nsAB12.tmp/app', kind: 'directory' }, { name: 'GpuCache', kind: 'directory' },
    { name: '123456789012345678901234567', kind: 'directory' },
    { name: 'secret-private-username', kind: 'file' }, { name: 'secret-private-link', kind: 'link' }
  ];
  const classified = classifyPortableTemp(records);
  assert.deepEqual(classified, [
    { category: 'CACHE_DIRECTORY', kind: 'directory', count: 1 },
    { category: 'KSUID_DIRECTORY', kind: 'directory', count: 1 },
    { category: 'NSIS_PLUGIN_DIRECTORY', kind: 'directory', count: 1 },
    { category: 'NSIS_TEMP_FILE', kind: 'file', count: 1 },
    { category: 'OTHER_TEMP', kind: 'file', count: 1 }, { category: 'OTHER_TEMP', kind: 'link', count: 1 },
    { category: 'PORTABLE_PAYLOAD_DIRECTORY', kind: 'directory', count: 1 },
    { category: 'POWERSHELL_POLICY_TEMP', kind: 'file', count: 2 }
  ]);
  assert.ok(!JSON.stringify(classified).includes('secret-private'));
  assert.throws(() => classifyPortableTemp([{ name: 'private', kind: 'arbitrary-kind' }]));
});

test('portable TEMP snapshot detects baseline content changes and leftover entries without weakening the empty-TEMP requirement', async t => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'portable-temp-unit-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const baseline = await snapshotPortableTemp(root);
  assert.deepEqual(baseline, []); requirePortableTempCleanup(baseline, baseline);
  const policy = path.join(root, '__PSScriptPolicyTest_a1.b2.ps1');
  await fs.writeFile(policy, 'unit policy fixture');
  const before = await snapshotPortableTemp(root);
  assert.throws(() => requirePortableTempCleanup(before, before), error => error.installerSmokeCode === 'PORTABLE_TEMP_NOT_EMPTY' && error.installerSmokeOperation === 'PORTABLE_TEMP_RECHECK');
  await fs.writeFile(policy, 'changed unit policy fixture');
  assert.notDeepEqual(await snapshotPortableTemp(root), before);
  await fs.mkdir(path.join(root, 'nsAB12.tmp')); await fs.writeFile(path.join(root, 'nsAB12.tmp', 'unit.txt'), 'unit temporary fixture');
  const after = await snapshotPortableTemp(root);
  assert.throws(() => requirePortableTempCleanup(baseline, after), error => error.installerSmokeCode === 'PORTABLE_TEMP_NOT_EMPTY');
  assert.throws(() => requirePortableTempCleanup(before, []), error => error.installerSmokeCode === 'PORTABLE_TEMP_BASELINE_CHANGED');
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
  assert.throws(() => requireNativeCommandExit({ ...result, code: 42, operation: 'NSIS_INSTALL' }), error => error.installerSmokeOperation === 'NSIS_INSTALL');
  assert.throws(() => requireNativeCommandExit({ ...result, code: 42, operation: '/private/secret' }), error => !Object.hasOwn(error, 'installerSmokeOperation'));
});

test('installer cleanup always runs, preserves the original native failure and reports a second cleanup failure without private output', async () => {
  let cleaned = 0;
  const original = Object.assign(new Error('NATIVE_COMMAND_EXIT_42'), { installerSmokeCode: 'NATIVE_COMMAND_EXIT_42', installerSmokeOperation: 'NSIS_INSTALL' });
  const cleanup = Object.assign(new Error('/private/secret'), { installerSmokeCode: 'NATIVE_COMMAND_TIMEOUT', installerSmokeOperation: 'APP_PROCESSES_STOP_OWNED' });
  await assert.rejects(runWithOwnedCleanup(async () => { throw original; }, async () => { cleaned++; throw cleanup; }), error =>
    error === original && error.installerSmokeCleanupCode === 'NATIVE_COMMAND_TIMEOUT' && error.installerSmokeCleanupOperation === 'APP_PROCESSES_STOP_OWNED' && !error.message.includes('/private'));
  assert.equal(cleaned, 1);
  await assert.rejects(runWithOwnedCleanup(async () => 0, async () => { throw cleanup; }), error => error === cleanup);
  assert.equal(await runWithOwnedCleanup(async () => 7, async () => { cleaned++; }), 7);
  assert.equal(cleaned, 2);
});

test('installer timeout diagnostics retain only the owned PID, public product window and bounded class and phase tokens', () => {
  assert.deepEqual(parseInstallerTrace('PREINIT_BEGIN\r\nCUSTOM_INIT_BEGIN\r\n'), ['PREINIT_BEGIN', 'CUSTOM_INIT_BEGIN']);
  for (const text of ['private/path\n', 'x'.repeat(16385), 'A\n'.repeat(129), 'A'.repeat(65), 'PUBLIC_TOKEN\nprivate message']) assert.throws(() => parseInstallerTrace(text));
  const actual = sanitizeWindowsTimeoutDiagnostics({ status: 'CAPTURED', running: true, executableMatches: true, visible: true,
    title: 'Codex Messenger 0.0.4 Setup', className: '#32770', silentSwitchPresent: true, currentUserSwitchPresent: true, targetLast: true,
    commandLine: 'C:\\private\\secret', executable: 'C:\\private\\secret.exe', pid: 77 }, 123);
  assert.deepEqual(actual, { pid: 123, status: 'CAPTURED', running: true, executableMatches: true, visible: true,
    silentSwitchPresent: true, currentUserSwitchPresent: true, targetLast: true, title: 'Codex Messenger 0.0.4 Setup', className: '#32770' });
  const redacted = sanitizeWindowsTimeoutDiagnostics({ status: 'CAPTURED', visible: true, title: 'C:\\private\\secret', className: 'private/secret' }, 123);
  assert.deepEqual(redacted, { pid: 123, status: 'CAPTURED', visible: true, title: 'OTHER_TITLE', className: 'OTHER_CLASS' });
  assert.deepEqual(sanitizeWindowsTimeoutDiagnostics({ status: 'C:\\private\\secret', title: 'private' }, 123), { pid: 123, status: 'DIAGNOSTIC_FAILED' });
  assert.deepEqual(sanitizeWindowsTimeoutDiagnostics({ status: 'PROCESS_NOT_FOUND', visible: true, title: 'private' }, 123), { pid: 123, status: 'PROCESS_NOT_FOUND' });
});

test('Windows timeout diagnostics have an independent bounded budget and never expose native stderr or a foreign process title', async () => {
  const input = { command: 'C:\\private\\Codex-Messenger-Setup-0.0.4.exe', args: ['/S', '/currentuser', '/D=C:\\private\\Codex Messenger'], pid: 123, env: {} };
  let script;
  const captured = await captureWindowsTimeoutDiagnostics(input, { execute: async value => { script = value; return { status: 'CAPTURED', visible: true, title: 'private secret', className: '#32770' }; } });
  assert.match(script, /Get-Process -Id 123/); assert.match(script, /\$p\.Path -ine/);
  assert.equal(captured.title, 'OTHER_TITLE'); assert.equal(captured.className, '#32770');
  const started = Date.now();
  assert.deepEqual(await captureWindowsTimeoutDiagnostics(input, { execute: () => new Promise(() => {}), budgetMs: 20 }), { pid: 123, status: 'DIAGNOSTIC_TIMEOUT' });
  assert.ok(Date.now() - started < 1000);
  assert.deepEqual(await captureWindowsTimeoutDiagnostics(input, { execute: async () => { throw new Error('/private/secret stderr'); } }), { pid: 123, status: 'DIAGNOSTIC_FAILED' });
});

test('native Windows PowerShell reads its own isolated AppData and real registry before installer execution', { skip: process.platform !== 'win32' }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'installer-powershell-unit-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await Promise.all(['temp with spaces', 'appdata', 'localappdata'].map(directory => fs.mkdir(path.join(root, directory))));
  const env = privateEnvironment(root);
  const script = `$version=Get-ItemProperty -LiteralPath 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion'; ` +
    `ConvertTo-Json -Compress -InputObject ([pscustomobject]@{appdata=$env:APPDATA;localappdata=$env:LOCALAPPDATA;temp=$env:TEMP;registry=([string]$version.CurrentBuildNumber).Length -gt 0})`;
  const actual = JSON.parse(requireNativeCommandExit(await powershell(script, env, 60000, 'POWERSHELL_PRIVATE_ENVIRONMENT')));
  assert.deepEqual(actual, { appdata: env.APPDATA, localappdata: env.LOCALAPPDATA, temp: env.TEMP, registry: true });
});

test('optional installer A/B mode keeps the native Windows folder casing without exposing host credentials or app profiles', () => {
  const root = 'C:\\Users\\runner\\AppData\\Local\\Temp\\owned-fixture';
  const base = { AppData: 'C:\\Users\\runner\\AppData\\Roaming', LocalAppData: 'C:\\Users\\runner\\AppData\\Local', Path: 'C:\\Windows\\System32',
    TEMP: 'C:\\host-temp', CODEX_MESSENGER_INSTALLER_KEEP_OS_FOLDERS: '1', OPENAI_API_KEY: 'private-key', GH_TOKEN: 'private-token' };
  const actual = privateEnvironment(root, base, { platform: 'win32' });
  assert.equal(actual.AppData, base.AppData); assert.equal(actual.LocalAppData, base.LocalAppData);
  assert.equal(Object.keys(actual).filter(key => key.toUpperCase() === 'APPDATA').length, 1);
  assert.equal(Object.keys(actual).filter(key => key.toUpperCase() === 'LOCALAPPDATA').length, 1);
  assert.equal(Object.hasOwn(actual, 'APPDATA'), false); assert.equal(Object.hasOwn(actual, 'LOCALAPPDATA'), false);
  assert.equal(actual.TEMP, root + '\\temp with spaces'); assert.equal(actual.CODEX_HOME, root + '\\codex-home');
  assert.equal(actual.CODEX_MESSENGER_USER_DATA_DIR, root + '\\profile'); assert.equal(actual.CODEX_MESSENGER_CODEX_PATH, root + '\\codex-unavailable');
  assert.equal(Object.hasOwn(actual, 'OPENAI_API_KEY'), false); assert.equal(Object.hasOwn(actual, 'GH_TOKEN'), false);
  const defaults = privateEnvironment(root, { ...base, CODEX_MESSENGER_INSTALLER_KEEP_OS_FOLDERS: '0' }, { platform: 'win32' });
  assert.equal(defaults.APPDATA, root + '\\appdata'); assert.equal(defaults.LOCALAPPDATA, root + '\\localappdata');
  for (const change of [{ AppData: undefined }, { LocalAppData: 'relative' }, { AppData: root }, { LocalAppData: root + '\\localappdata' }, { APPDATA: 'C:\\foreign' }]) {
    assert.throws(() => privateEnvironment(root, { ...base, ...change }, { platform: 'win32' }));
  }
  const duplicate = privateEnvironment(root, { ...base, APPDATA: base.AppData }, { platform: 'win32' });
  assert.equal(Object.keys(duplicate).filter(key => key.toUpperCase() === 'APPDATA').length, 1);
});

test('installer cache cleanup deletes only a newly created regular cache with exact observed installer bytes and preserves adjacent files', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'installer-cache-unit-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const data = Buffer.alloc(2048, 0x43), digest = createHash('sha256').update(data).digest('hex');
  const snapshots = await snapshotInstallerCaches([root, root], digest, data.length);
  assert.equal(snapshots.length, 1);
  const [snapshot] = snapshots;
  await fs.mkdir(snapshot.directory); await fs.writeFile(snapshot.file, data); await fs.writeFile(path.join(snapshot.directory, 'preserve.txt'), 'foreign adjacent file');
  await cleanupInstallerCaches(snapshots);
  await assert.rejects(fs.stat(snapshot.file), { code: 'ENOENT' });
  assert.equal(await fs.readFile(path.join(snapshot.directory, 'preserve.txt'), 'utf8'), 'foreign adjacent file');
  await fs.writeFile(snapshot.file, data);
  await assert.rejects(snapshotInstallerCaches([root], digest, data.length), error => error.installerSmokeCode === 'CACHE_PREEXISTING');
  assert.deepEqual(await fs.readFile(snapshot.file), data);
});

test('cache identity and links are checked for every candidate before any cache deletion', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'installer-cache-guard-unit-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const bases = ['first', 'second'].map(name => path.join(root, name));
  await Promise.all(bases.map(base => fs.mkdir(base)));
  const data = Buffer.alloc(2048, 0x44), digest = createHash('sha256').update(data).digest('hex');
  const snapshots = await snapshotInstallerCaches(bases, digest, data.length);
  await Promise.all(snapshots.map(snapshot => fs.mkdir(snapshot.directory)));
  await fs.writeFile(snapshots[0].file, data); await fs.writeFile(snapshots[1].file, Buffer.alloc(data.length, 0x45));
  await assert.rejects(cleanupInstallerCaches(snapshots), error => error.installerSmokeCode === 'CACHE_IDENTITY_MISMATCH');
  assert.deepEqual(await fs.readFile(snapshots[0].file), data);
  await fs.unlink(snapshots[1].file);
  await fs.symlink(process.platform === 'win32' ? snapshots[0].directory : snapshots[0].file, snapshots[1].file, process.platform === 'win32' ? 'junction' : 'file');
  await assert.rejects(cleanupInstallerCaches(snapshots), error => error.installerSmokeCode === 'CACHE_IDENTITY_MISMATCH');
  assert.deepEqual(await fs.readFile(snapshots[0].file), data);
});

test('native Windows A/B setup folders must exist before launching an installer', { skip: process.platform !== 'win32' }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'installer-native-folders-unit-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const env = privateEnvironment(root, { ...process.env, CODEX_MESSENGER_INSTALLER_KEEP_OS_FOLDERS: '1' });
  await validateNativeInstallerFolders(root, env);
  const modified = { ...env };
  const key = Object.keys(modified).find(name => name.toUpperCase() === 'APPDATA');
  modified[key] = path.join(path.dirname(root), 'missing-native-folder-' + path.basename(root));
  await assert.rejects(validateNativeInstallerFolders(root, modified));
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
  assert.equal(Object.hasOwn(report, 'diagnosticOnly'), false);
  const diagnostic = await runInstallerSmoke({ ...options, diagnosticContainer: 'portable' }, { signal: controller.signal });
  assert.equal(diagnostic.diagnosticOnly, true); assert.equal(diagnostic.passed, false);
  assert.equal(diagnostic.failureDetail, 'HARD_TIMEOUT'); assert.deepEqual(diagnostic.installers, []);
});
