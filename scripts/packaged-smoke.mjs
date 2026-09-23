import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { canonicalReleaseVersion } from './release-metadata.mjs';
import { sha256File } from './release-artifacts.mjs';

const errorKinds = ['preloadError', 'loadFailure', 'rendererGone', 'pageError', 'consoleError'];
const emptyErrors = () => Object.fromEntries(errorKinds.map(key => [key, 0]));

export function parseSmokeArguments(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]?.replace(/^--/, '');
    assert.ok(['platform', 'arch', 'output', 'version', 'report'].includes(key), 'Unknown smoke argument');
    assert.ok(args[index].startsWith('--') && typeof args[index + 1] === 'string' && args[index + 1].trim() && !args[index + 1].startsWith('--') && !args[index + 1].includes('\0'), 'Missing smoke argument');
    assert.ok(!Object.hasOwn(options, key), 'Duplicate smoke argument');
    options[key] = args[index + 1];
  }
  assert.deepEqual(Object.keys(options).sort(), ['arch', 'output', 'platform', 'report', 'version'], 'All smoke arguments are required');
  assert.ok(['windows', 'macos'].includes(options.platform), 'Unsupported smoke platform');
  assert.ok(['x64', 'arm64'].includes(options.arch), 'Unsupported smoke architecture');
  assert.ok(options.platform !== 'windows' || options.arch === 'x64', 'Windows release is x64 only');
  canonicalReleaseVersion(options.version);
  return options;
}

export function packagedPaths({ platform, arch, output }) {
  assert.ok(['windows', 'macos'].includes(platform) && ['x64', 'arm64'].includes(arch), 'Unsupported package layout');
  assert.ok(platform !== 'windows' || arch === 'x64', 'Windows release is x64 only');
  const layout = platform === 'windows' ? 'win-unpacked' : arch === 'arm64' ? 'mac-arm64' : 'mac';
  const application = platform === 'windows' ? layout : path.join(layout, 'Codex Messenger.app', 'Contents');
  return {
    layout,
    executable: path.resolve(output, application, platform === 'windows' ? 'Codex Messenger.exe' : path.join('MacOS', 'Codex Messenger')),
    asar: path.resolve(output, application, platform === 'windows' ? 'resources' : 'Resources', 'app.asar')
  };
}

export async function findPackagedExecutable(options) {
  const files = packagedPaths(options);
  const [executable, archive] = await Promise.all([fs.stat(files.executable), fs.stat(files.asar)]);
  assert.ok(executable.isFile() && executable.size > 0 && archive.isFile() && archive.size > 0, 'Packaged executable and app.asar must be present');
  return files;
}

export function isolatedSmokeEnvironment(environment, { userData, codexHome, unavailableCodex }) {
  const result = {};
  const allowed = new Set(['PATH', 'PATHEXT', 'COMSPEC', 'SYSTEMROOT', 'SYSTEMDRIVE', 'WINDIR', 'OS', 'HOME', 'USER', 'LOGNAME',
    'USERPROFILE', 'USERNAME', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA', 'PROGRAMFILES',
    'PROGRAMFILES(X86)', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL', 'TZ', 'CI', 'GITHUB_ACTIONS']);
  for (const [key, value] of Object.entries(environment)) {
    if (typeof value === 'string' && allowed.has(key.toUpperCase())) result[key] = value;
  }
  return { ...result, CODEX_MESSENGER_USER_DATA_DIR: userData, CODEX_HOME: codexHome,
    CODEX_MESSENGER_CODEX_PATH: unavailableCodex, CSC_IDENTITY_AUTO_DISCOVERY: 'false' };
}

export function errorsFromPrivateLog(text) {
  const errors = emptyErrors();
  const events = { 'window.preload-error': 'preloadError', 'window.did-fail-load': 'loadFailure', 'window.render-process-gone': 'rendererGone' };
  for (const line of text.split(/\r?\n/)) {
    let record;
    try { record = JSON.parse(line); } catch { continue; }
    if (!record || typeof record !== 'object' || Array.isArray(record)) continue;
    if (Object.hasOwn(events, record.event)) errors[events[record.event]] += 1;
    const rendererEvent = typeof record.event === 'string' ? record.event.replace(/^renderer\./, '') : record.event;
    if (['react.render.error', 'bootstrap.main.error', 'bootstrap.app.error', 'window.error', 'window.unhandledrejection'].includes(rendererEvent)) errors.pageError += 1;
    if (record.event === 'window.console-message' && (Number(record.level) >= 3 || record.level === 'error')) errors.consoleError += 1;
  }
  return errors;
}

export function validatePackagedObservation(metadata, renderer, options) {
  const checks = {
    packaged: metadata?.isPackaged === true,
    asar: typeof metadata?.appPath === 'string' && /(?:^|\/)resources\/app\.asar$/i.test(metadata.appPath.replace(/\\/g, '/')),
    version: metadata?.version === options.version && renderer?.bootstrapVersion === options.version,
    platform: metadata?.platform === (options.platform === 'windows' ? 'win32' : 'darwin'),
    architecture: metadata?.arch === options.arch,
    privateProfile: metadata?.privateUserData === true && metadata?.privateCodexHome === true,
    sandbox: metadata?.webPreferences?.sandbox === true,
    contextIsolation: metadata?.webPreferences?.contextIsolation === true,
    nodeIntegrationDisabled: metadata?.webPreferences?.nodeIntegration === false,
    webSecurity: metadata?.webPreferences?.webSecurity !== false,
    preloadBootstrap: renderer?.bootstrapAvailable === true && renderer?.bootstrapObject === true && renderer?.bootstrapView === 'main' && renderer?.bootstrapContacts === true,
    rendererNodeIsolated: renderer?.requireType === 'undefined' && renderer?.processType === 'undefined',
    packagedDocument: renderer?.protocol === 'file:' && typeof renderer?.pathname === 'string' && /\/app\.asar\/dist\/index\.html$/.test(renderer.pathname.replace(/\\/g, '/')),
    renderedDom: renderer?.readyState === 'complete' && renderer?.rootRendered === true && renderer?.bodyHasText === true && renderer?.applicationRendered === true
  };
  const failed = Object.keys(checks).filter(key => !checks[key]);
  assert.equal(failed.length, 0, `Packaged checks failed: ${failed.join(', ')}`);
  return checks;
}

export function initialSmokeReport(options) {
  return { schemaVersion: 1, passed: false, version: options.version, platform: options.platform, arch: options.arch,
    packageLayout: packagedPaths(options).layout, checks: {}, errors: emptyErrors(), failure: null,
    isolation: 'temporary userData and CODEX_HOME; host CLI disabled; no credentials supplied',
    signing: { buildMode: options.platform === 'macos' ? 'unsigned' : 'not_assessed', verified: false, credentialsProvided: false },
    scope: 'Packaged startup, renderer, preload and isolation only; no Codex model, authentication, terminal or audio tests' };
}

async function within(promise, milliseconds, code) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error(code), { smokeCode: code })), milliseconds); })]); }
  finally { clearTimeout(timer); }
}

async function forceStopOwnedChild(child) {
  if (process.platform === 'win32') {
    await new Promise((resolve, reject) => execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'],
      { timeout: 2000, windowsHide: true }, error => error ? reject(error) : resolve()));
  } else child.kill('SIGKILL');
}

export async function requestQuitFromPage(page) {
  return page.evaluate(() => {
    if (typeof window.codexMsn?.app?.quit !== 'function') throw new Error('QUIT_BRIDGE_UNAVAILABLE');
    // Let the evaluation return before the existing user action destroys its renderer.
    setTimeout(() => { void window.codexMsn.app.quit().catch(() => {}); }, 0);
    return true;
  });
}

export async function closeOwnedApplication(application, { forceStop = forceStopOwnedChild, requestQuit } = {}) {
  const child = application?.process();
  if (!child) return { process: { closed: false, forced: false, exitCode: null },
    closeDiagnostic: { apiClose: 'NOT_STARTED', processClose: 'MISSING', signaled: null, forceStop: 'NOT_ATTEMPTED' } };
  let observedClose, apiClose = 'PENDING', forced = false, forceStopResult = 'NOT_ATTEMPTED';
  let observeClose;
  const closed = new Promise(resolve => {
    observeClose = (code, signal) => { observedClose = { code, signal }; resolve(); };
    child.once('close', observeClose);
  });
  // Observe the real process before asking Playwright to quit: its protocol can reject after a clean exit.
  const apiClosed = Promise.resolve().then(() => requestQuit ? requestQuit() : application.close()).then(
    () => { apiClose = 'RESOLVED'; }, () => { apiClose = 'REJECTED'; });
  // With a user quit request, release Playwright only after the real process has closed.
  const driverClosed = requestQuit ? closed.then(() => application.close()).catch(() => {}) : Promise.resolve();
  try {
    await within(Promise.all([apiClosed, closed, driverClosed]), 6000, 'CLOSE_TIMEOUT').catch(() => {});
    if (!observedClose && child.pid && child.exitCode === null && child.signalCode === null) {
      forced = true;
      forceStopResult = 'ATTEMPTED';
      try { await forceStop(child); } catch { forceStopResult = 'FAILED'; }
      if (!observedClose) await within(closed, 1500, 'EXIT_TIMEOUT').catch(() => {});
    }
    return { process: { closed: Boolean(observedClose), forced, exitCode: observedClose?.code ?? null },
      closeDiagnostic: { apiClose: apiClose === 'PENDING' ? 'TIMEOUT' : apiClose,
        processClose: observedClose ? 'OBSERVED' : 'TIMEOUT',
        signaled: observedClose ? observedClose.signal !== null : null, forceStop: forceStopResult } };
  } finally { child.removeListener('close', observeClose); }
}

export async function runPackagedSmoke(options, { files: suppliedFiles, writeReport = true } = {}) {
  const started = Date.now();
  const report = initialSmokeReport(options);
  let application, page, temporary, stage = 'PACKAGE_FILES';
  const pageErrors = emptyErrors();
  try {
    await within((async () => {
      const files = suppliedFiles || await findPackagedExecutable(options);
      if (suppliedFiles) {
        const stats = await Promise.all([fs.stat(files.executable), fs.stat(files.asar)]);
        assert.ok(stats.every(stat => stat.isFile() && stat.size > 0), 'Installed executable and app.asar must be present');
      }
      report.appAsarSha256 = await sha256File(files.asar);
      stage = 'HOST_PLATFORM';
      assert.equal(process.platform, options.platform === 'windows' ? 'win32' : 'darwin', 'Smoke must run on its native platform');
      temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-messenger-packaged-'));
      await fs.chmod(temporary, 0o700);
      const userData = path.join(temporary, 'profile'), codexHome = path.join(temporary, 'codex-home');
      await Promise.all([fs.mkdir(userData, { mode: 0o700 }), fs.mkdir(codexHome, { mode: 0o700 })]);
      stage = 'LAUNCH';
      const { _electron } = await import('playwright');
      application = await _electron.launch({ executablePath: files.executable, args: [], timeout: 20000,
        chromiumSandbox: true, bypassCSP: false,
        env: isolatedSmokeEnvironment(process.env, { userData, codexHome, unavailableCodex: path.join(temporary, 'codex-unavailable') }) });
      const attachedPages = new WeakSet();
      const attachPage = page => {
        if (attachedPages.has(page)) return;
        attachedPages.add(page);
        page.on('pageerror', () => { pageErrors.pageError += 1; });
        page.on('console', message => { if (message.type() === 'error') pageErrors.consoleError += 1; });
      };
      application.on('window', attachPage);
      application.windows().forEach(attachPage);
      stage = 'NATIVE_OBSERVATION';
      await application.evaluate(({ app, BrowserWindow }) => {
        globalThis.__packagedSmokeErrors = { preloadError: 0, loadFailure: 0, rendererGone: 0 };
        const attach = window => {
          for (const [event, key] of [['preload-error', 'preloadError'], ['did-fail-load', 'loadFailure'], ['render-process-gone', 'rendererGone']]) {
            window.webContents.on(event, () => { globalThis.__packagedSmokeErrors[key] += 1; });
          }
        };
        BrowserWindow.getAllWindows().forEach(attach);
        app.on('browser-window-created', (_event, window) => attach(window));
      });
      page = await application.firstWindow({ timeout: 20000 });
      stage = 'RENDERER_READY';
      await page.waitForFunction(() => typeof window.codexMsn?.bootstrap === 'function' && document.readyState === 'complete' &&
        document.querySelector('#root')?.childElementCount > 0 && document.querySelector('main.msn-window') &&
        !document.querySelector('.debug-error-card') && document.body.textContent.trim().length > 0, null, { timeout: 20000 });
      stage = 'BOOTSTRAP';
      const renderer = await page.evaluate(async () => {
        const data = await window.codexMsn.bootstrap();
        return { bootstrapAvailable: typeof window.codexMsn.bootstrap === 'function', bootstrapObject: Boolean(data && typeof data === 'object' && !Array.isArray(data)),
          bootstrapVersion: data?.appVersion, bootstrapView: data?.view, bootstrapContacts: Array.isArray(data?.contacts),
          requireType: typeof globalThis.require, processType: typeof globalThis.process, protocol: location.protocol,
          pathname: decodeURIComponent(location.pathname), readyState: document.readyState,
          rootRendered: document.querySelector('#root')?.childElementCount > 0, bodyHasText: document.body.textContent.trim().length > 0,
          applicationRendered: Boolean(document.querySelector('main.msn-window') && !document.querySelector('.debug-error-card')) };
      });
      const window = await application.browserWindow(page);
      const webPreferences = await window.evaluate(win => {
        const prefs = win.webContents.getLastWebPreferences();
        return { sandbox: prefs.sandbox, contextIsolation: prefs.contextIsolation, nodeIntegration: prefs.nodeIntegration, webSecurity: prefs.webSecurity };
      });
      await window.dispose();
      const metadata = await application.evaluate(({ app }, expected) => ({
        isPackaged: app.isPackaged, appPath: app.getAppPath(), version: app.getVersion(), platform: process.platform, arch: process.arch,
        privateUserData: app.getPath('userData') === expected.userData, privateCodexHome: process.env.CODEX_HOME === expected.codexHome,
        electronVersion: process.versions.electron, errors: globalThis.__packagedSmokeErrors
      }), { userData, codexHome });
      stage = 'VALIDATION';
      report.checks = validatePackagedObservation({ ...metadata, webPreferences }, renderer, options);
      report.electronVersion = metadata.electronVersion;
      for (const key of errorKinds) report.errors[key] = Math.max(pageErrors[key], metadata.errors?.[key] || 0);
    })(), 70000, 'GLOBAL_TIMEOUT');
  } catch (error) { report.failure = error.smokeCode || stage; }
  finally {
    const closed = await closeOwnedApplication(application, { requestQuit: page ? () => requestQuitFromPage(page) : undefined });
    report.process = closed.process;
    report.closeDiagnostic = closed.closeDiagnostic;
    if (application && (!closed.process.closed || closed.process.forced || closed.process.exitCode !== 0 || closed.closeDiagnostic.signaled !== false)) report.failure ||= 'NATIVE_EXIT';
    if (temporary) {
      try {
        const logErrors = errorsFromPrivateLog(await fs.readFile(path.join(temporary, 'profile', 'codex-messenger.log'), 'utf8'));
        for (const key of errorKinds) report.errors[key] = Math.max(report.errors[key], pageErrors[key], logErrors[key]);
      } catch (error) { if (error.code !== 'ENOENT') report.failure ||= 'LOG_READ'; }
      try { await fs.rm(temporary, { recursive: true, force: true, maxRetries: 2, retryDelay: 200 }); }
      catch { report.failure ||= 'PRIVATE_PROFILE_CLEANUP'; }
    }
  }
  if (Object.values(report.errors).some(count => count > 0)) report.failure ||= 'RUNTIME_ERRORS';
  report.passed = Boolean(application && report.failure === null && report.process.closed && !report.process.forced &&
    report.process.exitCode === 0 && report.closeDiagnostic.signaled === false);
  report.durationMs = Date.now() - started;
  if (writeReport) {
    await fs.mkdir(path.dirname(path.resolve(options.report)), { recursive: true });
    await fs.writeFile(options.report, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
    console.log(JSON.stringify(report));
  }
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let watchdog;
  try {
    const options = parseSmokeArguments(process.argv.slice(2));
    watchdog = setTimeout(() => { console.error('Packaged smoke failed (HARD_TIMEOUT).'); process.exit(1); }, 85000);
    const report = await runPackagedSmoke(options);
    process.exitCode = report.passed ? 0 : 1;
  } catch { console.error('Packaged smoke failed (ARGUMENTS_OR_REPORT).'); process.exitCode = 1; }
  finally { clearTimeout(watchdog); }
}
