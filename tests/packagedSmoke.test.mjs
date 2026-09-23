import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseSmokeArguments, packagedPaths, findPackagedExecutable, isolatedSmokeEnvironment, errorsFromPrivateLog,
  validatePackagedObservation, initialSmokeReport } from '../scripts/packaged-smoke.mjs';

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
    JSON.stringify({ event: 'codex.spawn.error', text: 'Expected missing CLI' })].join('\r\n');
  assert.deepEqual(errorsFromPrivateLog(text), { preloadError: 1, loadFailure: 1, rendererGone: 1, pageError: 2, consoleError: 2 });
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
