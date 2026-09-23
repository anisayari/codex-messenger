import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { parseSmokeArguments, packagedPaths, findPackagedExecutable, isolatedSmokeEnvironment, errorsFromPrivateLog,
  validatePackagedObservation, initialSmokeReport, closeOwnedApplication } from '../scripts/packaged-smoke.mjs';

const options = { platform: 'windows', arch: 'x64', output: 'release/windows', version: '0.0.3', report: 'release-proof/packaged-smoke.json' };
const argumentsFor = value => Object.entries(value).flatMap(([key, argument]) => ['--' + key, argument]);
const fixture = () => ({ metadata: { isPackaged: true, appPath: 'C:\\build\\resources\\app.asar', version: '0.0.3', platform: 'win32', arch: 'x64',
  privateUserData: true, privateCodexHome: true, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true } },
  renderer: { bootstrapAvailable: true, bootstrapObject: true, bootstrapVersion: '0.0.3', bootstrapView: 'main', bootstrapContacts: true,
    requireType: 'undefined', processType: 'undefined', protocol: 'file:', pathname: '/C:/build/resources/app.asar/dist/index.html',
    readyState: 'complete', rootRendered: true, bodyHasText: true, applicationRendered: true } });

test('packaged smoke CLI requires a complete canonical target and rejects ambiguous input', () => {
  assert.deepEqual(parseSmokeArguments(argumentsFor(options)), options);
  assert.deepEqual(parseSmokeArguments(argumentsFor({ ...options, platform: 'macos', arch: 'arm64' })).arch, 'arm64');
  for (const invalid of [[], [...argumentsFor(options), '--arch', 'x64'], ['--output'], ['--unknown', 'value'],
    argumentsFor({ ...options, platform: 'linux' }), argumentsFor({ ...options, arch: 'arm64' }),
    argumentsFor({ ...options, version: 'v0.0.3' }), argumentsFor({ ...options, version: '0.0.03' }), argumentsFor({ ...options, report: 'bad\0path' })]) {
    assert.throws(() => parseSmokeArguments(invalid));
  }
});

test('packaged smoke resolves only the exact unpacked release executable and archive layout', () => {
  const windows = packagedPaths(options);
  assert.equal(windows.executable, path.resolve('release/windows/win-unpacked/Codex Messenger.exe'));
  assert.equal(windows.asar, path.resolve('release/windows/win-unpacked/resources/app.asar'));
  for (const [arch, directory] of [['x64', 'mac'], ['arm64', 'mac-arm64']]) {
    const mac = packagedPaths({ ...options, platform: 'macos', arch, output: 'release/macos' });
    assert.equal(mac.executable, path.resolve('release/macos', directory, 'Codex Messenger.app/Contents/MacOS/Codex Messenger'));
    assert.equal(mac.asar, path.resolve('release/macos', directory, 'Codex Messenger.app/Contents/Resources/app.asar'));
  }
});

test('packaged smoke refuses missing or empty archive instead of using a source Electron installation', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'packaged-smoke-unit-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const target = { ...options, output: directory }, files = packagedPaths(target);
  await fs.mkdir(path.dirname(files.asar), { recursive: true });
  await fs.writeFile(files.executable, 'fixture executable');
  await assert.rejects(findPackagedExecutable(target));
  await fs.writeFile(files.asar, '');
  await assert.rejects(findPackagedExecutable(target), /must be present/);
  await fs.writeFile(files.asar, 'fixture archive');
  assert.equal((await findPackagedExecutable(target)).executable, files.executable);
});

test('packaged smoke environment isolates profiles, disables host CLI and excludes launch overrides and credentials', () => {
  const environment = isolatedSmokeEnvironment({ PATH: 'system binaries', SystemRoot: 'system root', OPENAI_API_KEY: 'private-key',
    GITHUB_TOKEN: 'private-token', CSC_LINK: 'private-signing-certificate', CSC_KEY_PASSWORD: 'private-password',
    AWS_ACCESS_KEY_ID: 'private-cloud-key', ARBITRARY_PRIVATE_VALUE: 'private-value',
    SSH_AUTH_SOCK: 'private-agent', VITE_DEV_SERVER_URL: 'remote-development', ELECTRON_DISABLE_SANDBOX: '1',
    ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '--require private-script', DEBUG: 'pw:*', PWDEBUG: '1',
    CODEX_HOME: 'host-profile', CODEX_MESSENGER_CODEX_PATH: 'host-cli', CODEX_MESSENGER_USER_DATA_DIR: 'host-data' },
    { userData: 'temporary-user-data', codexHome: 'temporary-codex-home', unavailableCodex: 'temporary-missing-cli' });
  assert.deepEqual(environment, { PATH: 'system binaries', SystemRoot: 'system root', CODEX_HOME: 'temporary-codex-home',
    CODEX_MESSENGER_CODEX_PATH: 'temporary-missing-cli', CODEX_MESSENGER_USER_DATA_DIR: 'temporary-user-data', CSC_IDENTITY_AUTO_DISCOVERY: 'false' });
});

test('pure packaged validation rejects each missing runtime guarantee without claiming actual execution', () => {
  const original = fixture();
  assert.ok(Object.values(validatePackagedObservation(original.metadata, original.renderer, options)).every(Boolean));
  assert.equal(Object.hasOwn(validatePackagedObservation(original.metadata, original.renderer, options), 'passed'), false);
  for (const [section, key, value] of [['metadata', 'isPackaged', false], ['metadata', 'appPath', '/source/electron'],
    ['metadata', 'version', '0.0.2'], ['metadata', 'platform', 'darwin'], ['metadata', 'arch', 'arm64'],
    ['metadata', 'privateUserData', false], ['metadata', 'privateCodexHome', false], ['renderer', 'bootstrapAvailable', false],
    ['renderer', 'bootstrapObject', false], ['renderer', 'bootstrapView', 'chat'], ['renderer', 'bootstrapContacts', false],
    ['renderer', 'bootstrapVersion', '0.0.2'], ['renderer', 'requireType', 'function'], ['renderer', 'processType', 'object'],
    ['renderer', 'protocol', 'http:'], ['renderer', 'pathname', '/source/dist/index.html'],
    ['renderer', 'readyState', 'loading'], ['renderer', 'rootRendered', false], ['renderer', 'bodyHasText', false], ['renderer', 'applicationRendered', false]]) {
    const changed = fixture(); changed[section][key] = value;
    assert.throws(() => validatePackagedObservation(changed.metadata, changed.renderer, options), /Packaged checks failed/);
  }
  for (const [key, value] of [['sandbox', false], ['contextIsolation', false], ['nodeIntegration', true], ['webSecurity', false]]) {
    const changed = fixture(); changed.metadata.webPreferences[key] = value;
    assert.throws(() => validatePackagedObservation(changed.metadata, changed.renderer, options), /Packaged checks failed/);
  }
});

test('private startup log exports only bounded error category counts, including errors before listeners', () => {
  const text = ['not-json', 'null', '1', '[]', JSON.stringify({ event: '__proto__' }), JSON.stringify({ event: 'constructor' }),
    JSON.stringify({ event: 'window.preload-error', error: 'private-path-and-secret' }),
    JSON.stringify({ event: 'window.did-fail-load', url: 'private-url' }), JSON.stringify({ event: 'window.render-process-gone' }),
    JSON.stringify({ event: 'window.console-message', level: 3, message: 'private-console' }),
    JSON.stringify({ event: 'window.console-message', level: 'error' }), JSON.stringify({ event: 'window.console-message', level: 2 }),
    JSON.stringify({ event: 'react.render.error' }), JSON.stringify({ event: 'window.unhandledrejection' }),
    JSON.stringify({ event: 'renderer.bootstrap.app.error' }),
    JSON.stringify({ event: 'codex.spawn.error', text: 'Expected missing CLI' })].join('\r\n');
  assert.deepEqual(errorsFromPrivateLog(text), { preloadError: 1, loadFailure: 1, rendererGone: 1, pageError: 3, consoleError: 2 });
  assert.equal(JSON.stringify(errorsFromPrivateLog(text)).includes('private'), false);
});

test('initial release report is explicitly unexecuted and never claims signing or model validation', () => {
  const report = initialSmokeReport({ ...options, platform: 'macos', arch: 'arm64', output: '/private/runner/release' });
  assert.equal(report.passed, false);
  assert.equal(report.version, '0.0.3');
  assert.equal(report.platform, 'macos');
  assert.equal(report.arch, 'arm64');
  assert.equal(report.signing.buildMode, 'unsigned');
  assert.equal(report.signing.verified, false);
  assert.equal(report.signing.credentialsProvided, false);
  assert.equal(JSON.stringify(report).includes('/private'), false);
  assert.deepEqual(report.checks, {});
});

test('an API rejection after a real Node child closes naturally does not invent a forced exit', { timeout: 10000 }, async t => {
  // This is a controlled Node fixture, not evidence of an Electron or native installer exit.
  const child = spawn(process.execPath, ['-e', 'process.once("message", () => process.disconnect()); process.send("ready");'],
    { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  const closed = new Promise(resolve => child.once('close', resolve));
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) { child.kill(); await closed; }
  });
  await once(child, 'message');
  let forcedStops = 0;
  const outcome = await closeOwnedApplication({ process: () => child, close: async () => {
    child.send('quit');
    await closed;
    throw new Error('injected private protocol rejection after exit');
  } }, { forceStop: async () => { forcedStops += 1; } });
  assert.deepEqual(outcome.process, { closed: true, forced: false, exitCode: 0 });
  assert.deepEqual(outcome.closeDiagnostic, { apiClose: 'REJECTED', processClose: 'OBSERVED', signaled: false, forceStop: 'NOT_ATTEMPTED' });
  assert.equal(forcedStops, 0);
  assert.equal(JSON.stringify(outcome).includes('private'), false);
});

const fakeChild = () => Object.assign(new EventEmitter(), { pid: 12345, exitCode: null, signalCode: null });
const flushMicrotasks = async () => { for (let index = 0; index < 8; index += 1) await Promise.resolve(); };

test('an API rejection while a process remains live waits the existing deadline and records a real force-stop attempt', async t => {
  // Explicit process double: no OS process is started or killed by this test.
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const child = fakeChild();
  let forcedStops = 0;
  const result = closeOwnedApplication({ process: () => child, close: async () => { throw new Error('injected rejection'); } },
    { forceStop: async () => { forcedStops += 1; child.exitCode = 1; child.emit('close', 1, null); } });
  await flushMicrotasks();
  t.mock.timers.tick(5999);
  await flushMicrotasks();
  assert.equal(forcedStops, 0);
  t.mock.timers.tick(1);
  const outcome = await result;
  assert.equal(forcedStops, 1);
  assert.deepEqual(outcome.process, { closed: true, forced: true, exitCode: 1 });
  assert.deepEqual(outcome.closeDiagnostic, { apiClose: 'REJECTED', processClose: 'OBSERVED', signaled: false, forceStop: 'ATTEMPTED' });
});

test('missing process close cannot pass even when its exit flags claim success', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const child = fakeChild();
  child.exitCode = 0;
  let forcedStops = 0;
  const result = closeOwnedApplication({ process: () => child, close: async () => {} },
    { forceStop: async () => { forcedStops += 1; } });
  await flushMicrotasks();
  t.mock.timers.tick(6000);
  const outcome = await result;
  assert.deepEqual(outcome.process, { closed: false, forced: false, exitCode: null });
  assert.deepEqual(outcome.closeDiagnostic, { apiClose: 'RESOLVED', processClose: 'TIMEOUT', signaled: null, forceStop: 'NOT_ATTEMPTED' });
  assert.equal(forcedStops, 0);
  assert.equal(child.listenerCount('close'), 0);
});

test('close-event observation preserves a nonzero exit and a signal instead of reporting a clean exit', async () => {
  for (const [code, signal] of [[7, null], [0, 'SIGTERM']]) {
    const child = fakeChild();
    const outcome = await closeOwnedApplication({ process: () => child, close: async () => {
      child.exitCode = code;
      child.signalCode = signal;
      child.emit('close', code, signal);
    } }, { forceStop: async () => assert.fail('a closed process must not be killed') });
    assert.deepEqual(outcome.process, { closed: true, forced: false, exitCode: code });
    assert.equal(outcome.closeDiagnostic.apiClose, 'RESOLVED');
    assert.equal(outcome.closeDiagnostic.signaled, signal !== null);
    assert.ok(code !== 0 || outcome.closeDiagnostic.signaled, 'a nonzero exit or signal fails the natural-exit contract');
  }
});
