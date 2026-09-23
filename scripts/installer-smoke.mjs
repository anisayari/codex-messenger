import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { expectedInstallers, sha256File } from './release-artifacts.mjs';
import { parseSmokeArguments, findPackagedExecutable, runPackagedSmoke, isolatedSmokeEnvironment, errorsFromPrivateLog } from './packaged-smoke.mjs';

const packagedChecks = ['packaged', 'asar', 'version', 'platform', 'architecture', 'privateProfile', 'sandbox', 'contextIsolation',
  'nodeIntegrationDisabled', 'webSecurity', 'preloadBootstrap', 'rendererNodeIsolated', 'packagedDocument', 'renderedDom'];
const errorKinds = ['preloadError', 'loadFailure', 'rendererGone', 'pageError', 'consoleError'];
const nativeScope = new AsyncLocalStorage();
const abortError = () => Object.assign(new Error('HARD_TIMEOUT'), { installerSmokeCode: 'HARD_TIMEOUT' });
const checkAbort = () => { if (nativeScope.getStore()?.signal?.aborted) throw abortError(); };
const cleanupOwned = task => nativeScope.run({ ...nativeScope.getStore(), cleanup: true }, task);
export const installerChecks = {
  nsis: ['installed', 'silentNoAutoLaunch', 'foreignUninstallRefused', 'foreignFilePreserved', 'uninstalled', 'registrationRemoved', 'protectedFilesPreserved', 'legacySharedDirectoryRefused', 'legacyFilesPreserved', 'originAsar', 'privateTempCleanup'],
  portable: ['actualWrapperExecution', 'wrapperVersion', 'wrapperPackaged', 'wrapperRendererReady', 'wrapperCleanExit', 'wrapperRuntimeErrorsZero', 'originAsar', 'privateTempCleanup'],
  dmg: ['mountedReadOnly', 'copiedApplication', 'mountDetached', 'bundleArchitecture', 'bundleVersion', 'originAsar', 'privateTempCleanup'],
  zip: ['extractedApplication', 'bundleArchitecture', 'bundleVersion', 'originAsar', 'privateTempCleanup']
};

export const parseInstallerSmokeArguments = parseSmokeArguments;

export function isOwnedPath(root, candidate, platform = process.platform) {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  if (!paths.isAbsolute(root) || !paths.isAbsolute(candidate)) return false;
  const relative = paths.relative(root, candidate);
  return Boolean(relative && relative !== '..' && !relative.startsWith('..' + paths.sep) && !paths.isAbsolute(relative));
}

export function nsisInstallArguments(directory) {
  assert.ok(path.win32.isAbsolute(directory) && !/["\r\n\0]/.test(directory), 'Expected an absolute private NSIS directory');
  return ['/S', '/currentuser', '--no-desktop-shortcut', `/D=${directory}`];
}

export function nsisUninstallArguments(directory) {
  assert.ok(path.win32.isAbsolute(directory) && !/["\r\n\0]/.test(directory), 'Expected an absolute private NSIS directory');
  return ['/S', '/currentuser', `_?=${directory}`];
}

export function nsisVerbatimCommand(command) {
  assert.ok(path.win32.isAbsolute(command) && !/["\r\n\0]/.test(command), 'Expected an absolute NSIS executable');
  return { windowsVerbatimArguments: true, argv0: `"${command}"` };
}

export async function copyOwnedUninstaller(root, directory, expectedSha256) {
  assert.ok(isOwnedPath(root, directory));
  assert.match(expectedSha256, /^[0-9a-f]{64}(?![\s\S])/);
  assert.ok(isOwnedPath(await fs.realpath(root), await fs.realpath(directory)));
  const source = path.join(directory, 'Uninstall Codex Messenger.exe');
  const stat = await fs.lstat(source);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size >= 1024, 'Expected the actual installed uninstaller');
  assert.equal(await sha256File(source), expectedSha256, 'Uninstaller identity changed');
  const copyDirectory = await fs.mkdtemp(path.join(root, 'uninstall execution with spaces-'));
  try {
    await fs.chmod(copyDirectory, 0o700);
    const executable = path.join(copyDirectory, 'Uninstall Codex Messenger.exe');
    await fs.copyFile(source, executable, fsConstants.COPYFILE_EXCL);
    assert.ok((await fs.lstat(executable)).isFile());
    assert.equal(await sha256File(executable), expectedSha256);
    assert.equal(await sha256File(source), expectedSha256);
    return { executable, copyDirectory };
  } catch (error) {
    await fs.rm(copyDirectory, { recursive: true, force: true });
    throw error;
  }
}

export function validateInstallerApplication(smoke, options) {
  assert.equal(smoke?.schemaVersion, 1);
  assert.equal(smoke.passed, true);
  for (const key of ['version', 'platform', 'arch']) assert.equal(smoke[key], options[key]);
  assert.deepEqual(Object.keys(smoke.checks || {}).sort(), [...packagedChecks].sort());
  assert.ok(packagedChecks.every(key => smoke.checks[key] === true));
  assert.deepEqual(Object.keys(smoke.errors || {}).sort(), [...errorKinds].sort());
  assert.ok(errorKinds.every(key => smoke.errors[key] === 0));
  assert.equal(smoke.failure, null);
  assert.deepEqual(smoke.process, { closed: true, forced: false, exitCode: 0 });
  assert.match(smoke.appAsarSha256, /^[0-9a-f]{64}(?![\s\S])/);
}

export function validateOriginAsar(actual, origin) {
  assert.match(actual, /^[0-9a-f]{64}(?![\s\S])/);
  assert.equal(actual, origin, 'Installer application must contain the original unpacked app.asar');
}

export function validatePortableWrapper(log, result, { version, privateRoot, userData }) {
  assert.ok(result.started && !result.timedOut && !result.forced && result.code === 0 && result.signal === null, 'Portable wrapper must exit naturally with its child exit zero');
  const records = log.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  assert.ok(records.every(record => record && typeof record === 'object' && !Array.isArray(record)));
  const starts = records.filter(record => record.event === 'app.start');
  assert.equal(starts.length, 1, 'The actual wrapper must start one packaged application');
  assert.equal(starts[0].version, version);
  assert.equal(starts[0].packaged, true);
  assert.equal(starts[0].dev, false);
  assert.equal(starts[0].logPath, path.win32.join(userData, 'codex-messenger.log'));
  const ready = records.filter(record => record.event === 'window.ready-to-show' && record.key === 'main');
  assert.equal(ready.length, 1, 'The wrapper must load its actual main renderer');
  const document = fileURLToPath(ready[0].url, { windows: true });
  assert.ok(isOwnedPath(privateRoot, document, 'win32') && /\\resources\\app\.asar\\dist\\index\.html$/i.test(document));
  const normalized = records.map(record => ({ ...record, event: String(record.event || '').replace(/^renderer\./, '') })).map(record => JSON.stringify(record)).join('\n');
  assert.ok(Object.values(errorsFromPrivateLog(normalized)).every(count => count === 0), 'Portable wrapper cannot contain runtime errors');
  return Object.fromEntries(installerChecks.portable.filter(key => key !== 'originAsar' && key !== 'privateTempCleanup').map(key => [key, true]));
}

export function validateReadOnlyMount(output, mountPoint) {
  const matches = output.split(/\r?\n/).filter(line => line.includes(` on ${mountPoint} (`));
  assert.equal(matches.length, 1, 'Expected the owned DMG mount');
  assert.match(matches[0], /\([^)]*(?:^|[, ])read-only(?:[, )])/);
}

export function validateBundleIdentity(plist, architectures, options) {
  assert.equal(plist?.CFBundleIdentifier, 'com.codex.messenger');
  assert.equal(plist.CFBundleShortVersionString, options.version);
  assert.equal(plist.CFBundleVersion, options.version);
  assert.deepEqual(architectures.trim().split(/\s+/), [options.arch === 'x64' ? 'x86_64' : 'arm64']);
}

export function validateInstallerEntry(entry, kind, options) {
  assert.equal(entry.passed, true);
  assert.ok(Number.isSafeInteger(entry.bytes) && entry.bytes >= 1024);
  assert.match(entry.sha256, /^[0-9a-f]{64}(?![\s\S])/);
  assert.match(entry.appAsarSha256, /^[0-9a-f]{64}(?![\s\S])/);
  assert.deepEqual(Object.keys(entry.checks || {}).sort(), [...installerChecks[kind]].sort());
  assert.ok(installerChecks[kind].every(key => entry.checks[key] === true));
  validateInstallerApplication(entry.smoke, options);
  assert.equal(entry.smoke.appAsarSha256, entry.appAsarSha256);
}

const nsisOperation = operation => /^NSIS_(?:INSTALL|UNINSTALL|LEGACY_INSTALL)$/.test(operation);
const traceFileName = 'codex-messenger-installer-smoke.trace';
const diagnosticStatuses = new Set(['CAPTURED', 'PROCESS_NOT_FOUND', 'EXECUTABLE_MISMATCH', 'DIAGNOSTIC_FAILED', 'DIAGNOSTIC_TIMEOUT']);
const diagnosticClasses = new Set(['#32770', 'NSISDialog', 'NSIS:Dialog', 'ConsoleWindowClass']);

export function parseInstallerTrace(text) {
  assert.ok(typeof text === 'string' && Buffer.byteLength(text) <= 16384, 'Trace exceeds its private diagnostic limit');
  const tokens = text.split(/\r?\n/).filter(Boolean);
  assert.ok(tokens.length <= 128 && tokens.every(token => /^[A-Z0-9_]{1,64}$/.test(token)), 'Trace must contain only bounded phase tokens');
  return tokens;
}

export function sanitizeWindowsTimeoutDiagnostics(raw, pid) {
  assert.ok(Number.isSafeInteger(pid) && pid > 0);
  const result = { pid, status: diagnosticStatuses.has(raw?.status) ? raw.status : 'DIAGNOSTIC_FAILED' };
  if (result.status !== 'CAPTURED') return result;
  for (const key of ['running', 'executableMatches', 'visible', 'silentSwitchPresent', 'currentUserSwitchPresent', 'targetLast']) {
    if (typeof raw[key] === 'boolean') result[key] = raw[key];
  }
  if (raw.visible === true) {
    result.title = typeof raw.title === 'string' && raw.title.length <= 96 && /^(?:Uninstall )?Codex Messenger(?: \d+\.\d+\.\d+)?(?: Setup| Uninstall)?$/.test(raw.title) ? raw.title : 'OTHER_TITLE';
    result.className = diagnosticClasses.has(raw.className) ? raw.className : 'OTHER_CLASS';
  }
  return result;
}

async function prepareNsisTrace(env, operation) {
  if (process.platform !== 'win32' || !nsisOperation(operation) || env.CODEX_MESSENGER_INSTALLER_SMOKE_TRACE !== '1') return null;
  assert.ok(typeof env.TEMP === 'string' && path.isAbsolute(env.TEMP));
  const directory = await fs.lstat(env.TEMP);
  assert.ok(directory.isDirectory() && !directory.isSymbolicLink());
  const file = path.join(env.TEMP, traceFileName);
  const existing = await fs.lstat(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (existing) { assert.ok(existing.isFile() && !existing.isSymbolicLink()); await fs.unlink(file); }
  return file;
}

async function readNsisTrace(file) {
  if (!file) return null;
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16384) return { traceStatus: 'INVALID_TRACE' };
    return { traceStatus: 'READ', trace: parseInstallerTrace(await fs.readFile(file, 'utf8')) };
  } catch (error) { return { traceStatus: error.code === 'ENOENT' ? 'NO_TRACE' : 'INVALID_TRACE' }; }
}

function executeWindowsDiagnostic(script, env) {
  return new Promise(resolve => {
    let settled = false, hard;
    const finish = result => { if (settled) return; settled = true; clearTimeout(hard); resolve(result); };
    const child = execFile('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { env, windowsHide: true, timeout: 6000, maxBuffer: 16384 }, (error, stdout) => {
        if (error) finish({ status: error.killed ? 'DIAGNOSTIC_TIMEOUT' : 'DIAGNOSTIC_FAILED' });
        else { try { finish(JSON.parse(stdout.trim())); } catch { finish({ status: 'DIAGNOSTIC_FAILED' }); } }
      });
    hard = setTimeout(() => {
      // An exited process can leave pipes inherited by a descendant. Do not
      // let those diagnostic pipes keep the installer driver alive.
      const close = () => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        child.stdin?.destroy(); child.stdout?.destroy(); child.stderr?.destroy(); child.unref();
        finish({ status: 'DIAGNOSTIC_TIMEOUT' });
      };
      if (child.pid && child.exitCode === null && child.signalCode === null) {
        execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { timeout: 1000, windowsHide: true }, close);
      } else close();
    }, 6500);
  });
}

export async function captureWindowsTimeoutDiagnostics({ command, args, pid, env }, { execute = executeWindowsDiagnostic, budgetMs = 8000 } = {}) {
  assert.ok(path.win32.isAbsolute(command) && Number.isSafeInteger(pid) && pid > 0);
  assert.ok(Number.isSafeInteger(budgetMs) && budgetMs > 0 && budgetMs <= 8000);
  const target = args.at(-1);
  const script = `$ErrorActionPreference='Stop'; $p=Get-Process -Id ${pid} -ErrorAction SilentlyContinue; ` +
    `if($null -eq $p){ConvertTo-Json -Compress -InputObject @{status='PROCESS_NOT_FOUND'};exit}; ` +
    `if($p.Path -ine ${psQuote(command)}){ConvertTo-Json -Compress -InputObject @{status='EXECUTABLE_MISMATCH'};exit}; ` +
    `$result=@{status='CAPTURED';running=$true;executableMatches=$true;visible=($p.MainWindowHandle -ne [IntPtr]::Zero)}; ` +
    `try { $c=Get-CimInstance -ClassName Win32_Process -Filter 'ProcessId=${pid}'; if($null -ne $c){$result.silentSwitchPresent=($c.CommandLine -cmatch '(?:^| )/S(?: |$)'); ` +
    `$result.currentUserSwitchPresent=($c.CommandLine -imatch '(?:^| )/currentuser(?: |$)'); $result.targetLast=([string]$c.CommandLine).EndsWith(${psQuote(target)})} }catch{}; ` +
    `if($result.visible){$result.title=$p.MainWindowTitle; try { Add-Type -AssemblyName UIAutomationClient; ` +
    `$w=[Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle); if($w.Current.ProcessId -eq ${pid}){$result.className=$w.Current.ClassName} }catch{}}; ` +
    `ConvertTo-Json -Compress -InputObject $result`;
  let timer;
  try {
    const raw = await Promise.race([execute(script, env), new Promise(resolve => { timer = setTimeout(() => resolve({ status: 'DIAGNOSTIC_TIMEOUT' }), budgetMs); })]);
    return sanitizeWindowsTimeoutDiagnostics(raw, pid);
  } catch { return { pid, status: 'DIAGNOSTIC_FAILED' }; }
  finally { clearTimeout(timer); }
}

async function runOwned(command, args, { env = process.env, cwd, timeoutMs = 30000, input, verbatim = false, operation = 'NATIVE_COMMAND' } = {}) {
  assert.match(operation, /^[A-Z0-9_]{1,64}$/);
  const signal = nativeScope.getStore()?.cleanup ? undefined : nativeScope.getStore()?.signal;
  if (signal?.aborted) return { code: null, signal: null, started: false, timedOut: false, forced: false, aborted: true, stdout: '', stderr: '', operation };
  const traceFile = await prepareNsisTrace(env, operation);
  return new Promise(resolve => {
    const child = spawn(command, args, { env, cwd, shell: false, windowsHide: true,
      ...(verbatim ? nsisVerbatimCommand(command) : { windowsVerbatimArguments: false }),
      detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', started = true, timedOut = false, forced = false, aborted = false, fallback, finished = false, diagnostic, processAtTimeout;
    const finish = async (code, childSignal) => {
      if (finished) return; finished = true;
      clearTimeout(timer); clearTimeout(fallback); signal?.removeEventListener('abort', onAbort);
      const windows = diagnostic ? await diagnostic : null;
      const trace = await readNsisTrace(traceFile);
      resolve({ code, signal: childSignal, started, timedOut, forced, aborted, stdout, stderr, operation,
        ...((windows || trace || processAtTimeout) ? { nativeDiagnostics: { ...(windows ? { windows } : {}),
          ...(processAtTimeout ? { processAtTimeout } : {}), ...trace } } : {}) });
    };
    const stop = () => {
      forced = true;
      if (child.pid && child.exitCode === null && child.signalCode === null) {
        if (process.platform === 'win32') execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { timeout: 2000, windowsHide: true }, () => {});
        else { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
      }
      fallback ||= setTimeout(() => finish(null, null), 2500);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      if (process.platform === 'win32' && nsisOperation(operation) && child.pid) {
        processAtTimeout = { pid: child.pid, exitCode: child.exitCode, signalCode: child.signalCode };
        diagnostic = captureWindowsTimeoutDiagnostics({ command, args, pid: child.pid, env });
        void diagnostic.finally(stop);
      } else stop();
    }, timeoutMs);
    const onAbort = () => { aborted = true; stop(); };
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
    for (const [stream, key] of [[child.stdout, 'stdout'], [child.stderr, 'stderr']]) {
      stream.setEncoding('utf8');
      stream.on('data', value => {
        if (key === 'stdout') stdout += value; else stderr += value;
        if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > 1000000) { stdout = stdout.slice(0, 500000); stderr = stderr.slice(0, 500000); stop(); }
      });
    }
    child.stdin.on('error', () => {});
    child.stdin.end(input);
    child.once('error', () => { started = false; finish(null, null); });
    child.once('close', finish);
  });
}

export function requireNativeCommandExit(result, expectedExitCode = 0) {
  const code = result.aborted ? 'HARD_TIMEOUT' : !result.started ? 'NATIVE_COMMAND_NOT_STARTED' : result.timedOut ? 'NATIVE_COMMAND_TIMEOUT' : result.forced ? 'NATIVE_COMMAND_FORCED' :
    result.signal !== null ? 'NATIVE_COMMAND_SIGNAL' : result.code !== expectedExitCode ? `NATIVE_COMMAND_EXIT_${Number.isSafeInteger(result.code) ? result.code : 'UNKNOWN'}` : null;
  if (code) throw Object.assign(new Error(code), { installerSmokeCode: code, expectedExitCode,
    ...(/^[A-Z0-9_]{1,64}$/.test(result.operation || '') ? { installerSmokeOperation: result.operation } : {}),
    ...(result.nativeDiagnostics ? { installerSmokeNativeDiagnostics: result.nativeDiagnostics } : {}) });
  return result.stdout;
}
const requireExitZero = result => requireNativeCommandExit(result);

const boundedFailureCode = error => /^[A-Z0-9_]{1,64}$/.test(error?.installerSmokeCode || '') ? error.installerSmokeCode :
  /^[A-Z0-9_]{1,64}$/.test(error?.code || '') ? error.code : 'VALIDATION_FAILED';

export async function runWithOwnedCleanup(task, cleanup) {
  let primary;
  try { return await task(); }
  catch (error) { primary = error; throw error; }
  finally {
    try { await cleanup(); }
    catch (error) {
      if (!primary) throw error;
      primary.installerSmokeCleanupCode = boundedFailureCode(error);
      if (/^[A-Z0-9_]{1,64}$/.test(error?.installerSmokeOperation || '')) primary.installerSmokeCleanupOperation = error.installerSmokeOperation;
      if (error?.installerSmokeNativeDiagnostics) primary.installerSmokeCleanupDiagnostics = error.installerSmokeNativeDiagnostics;
    }
  }
}

function environmentEntry(environment, name) {
  const entries = Object.entries(environment).filter(([key]) => key.toUpperCase() === name);
  assert.ok(entries.length <= 1 || entries.every(([, value]) => value === entries[0][1]), 'Conflicting Windows environment values');
  return entries[0];
}

export function privateEnvironment(root, baseEnvironment = process.env, { platform = process.platform } = {}) {
  const paths = platform === 'win32' ? path.win32 : path;
  const result = isolatedSmokeEnvironment(baseEnvironment, { userData: paths.join(root, 'profile'), codexHome: paths.join(root, 'codex-home'), unavailableCodex: paths.join(root, 'codex-unavailable') });
  for (const key of Object.keys(result)) if (['TEMP', 'TMP', 'TMPDIR', 'APPDATA', 'LOCALAPPDATA'].includes(key.toUpperCase())) delete result[key];
  const nativeFolders = platform === 'win32' && environmentEntry(baseEnvironment, 'CODEX_MESSENGER_INSTALLER_KEEP_OS_FOLDERS')?.[1] === '1';
  if (nativeFolders) {
    for (const name of ['APPDATA', 'LOCALAPPDATA']) {
      const entry = environmentEntry(baseEnvironment, name);
      assert.ok(entry && typeof entry[1] === 'string' && paths.isAbsolute(entry[1]) && !/[\r\n\0]/.test(entry[1]), 'Missing native Windows folder');
      assert.ok(paths.relative(root, entry[1]) !== '' && !isOwnedPath(root, entry[1], 'win32'), 'Native Windows folder must remain outside the private fixture');
      result[entry[0]] = entry[1];
    }
  } else { result.APPDATA = paths.join(root, 'appdata'); result.LOCALAPPDATA = paths.join(root, 'localappdata'); }
  return { ...result, TEMP: paths.join(root, 'temp with spaces'), TMP: paths.join(root, 'temp with spaces'), TMPDIR: paths.join(root, 'temp with spaces'),
    CODEX_MESSENGER_INSTALLER_SMOKE_TRACE: '1', CODEX_MESSENGER_INSTALLER_KEEP_OS_FOLDERS: nativeFolders ? '1' : '0' };
}

export async function validateNativeInstallerFolders(root, environment, { platform = process.platform } = {}) {
  if (platform !== 'win32' || environment.CODEX_MESSENGER_INSTALLER_KEEP_OS_FOLDERS !== '1') return;
  const realRoot = await fs.realpath(root);
  for (const name of ['APPDATA', 'LOCALAPPDATA']) {
    const folder = environmentEntry(environment, name)?.[1];
    assert.ok(typeof folder === 'string' && path.win32.isAbsolute(folder) && !isOwnedPath(root, folder, 'win32'));
    const native = environmentEntry(process.env, name)?.[1];
    assert.ok(typeof native === 'string' && path.win32.relative(native, folder) === '', 'The setup must retain the actual OS environment folder');
    assert.ok((await fs.stat(folder)).isDirectory(), 'The native Windows folder must exist');
    const realFolder = await fs.realpath(folder);
    assert.ok(path.win32.relative(realRoot, realFolder) !== '' && !isOwnedPath(realRoot, realFolder, 'win32'));
  }
}

const updaterCacheDirectory = 'codex-messenger-updater';
const cacheError = code => Object.assign(new Error(code), { installerSmokeCode: code, installerSmokeOperation: 'INSTALLER_CACHE_CLEANUP' });

export async function snapshotInstallerCaches(localFolders, expectedSha256, expectedBytes) {
  assert.match(expectedSha256, /^[0-9a-f]{64}$/);
  assert.ok(Number.isSafeInteger(expectedBytes) && expectedBytes >= 1024);
  const result = [], seen = new Set();
  for (const base of localFolders) {
    assert.ok(typeof base === 'string' && path.isAbsolute(base));
    const realBase = await fs.realpath(base), normalized = process.platform === 'win32' ? realBase.toLowerCase() : realBase;
    if (seen.has(normalized)) continue; seen.add(normalized);
    const directory = path.join(realBase, updaterCacheDirectory), file = path.join(directory, 'installer.exe');
    const parent = await fs.lstat(directory).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (parent && (!parent.isDirectory() || parent.isSymbolicLink() || await fs.realpath(directory) !== directory)) throw cacheError('CACHE_DIRECTORY_UNOWNED');
    const existing = await fs.lstat(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (existing) throw cacheError('CACHE_PREEXISTING');
    result.push({ base: realBase, directory, file, directoryExisted: Boolean(parent), expectedSha256, expectedBytes });
  }
  return result;
}

export async function cleanupInstallerCaches(snapshots) {
  const files = [];
  for (const snapshot of snapshots) {
    assert.equal(snapshot.directory, path.join(snapshot.base, updaterCacheDirectory));
    assert.equal(snapshot.file, path.join(snapshot.directory, 'installer.exe'));
    const stat = await fs.lstat(snapshot.file).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (!stat) continue;
    const parent = await fs.lstat(snapshot.directory);
    if (!parent.isDirectory() || parent.isSymbolicLink() || await fs.realpath(snapshot.directory) !== snapshot.directory) throw cacheError('CACHE_DIRECTORY_UNOWNED');
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== snapshot.expectedBytes || await sha256File(snapshot.file) !== snapshot.expectedSha256) throw cacheError('CACHE_IDENTITY_MISMATCH');
    files.push(snapshot);
  }
  // Validate every candidate before deleting any cache file.
  for (const snapshot of files) {
    await fs.unlink(snapshot.file);
    if (!snapshot.directoryExisted) await fs.rmdir(snapshot.directory).catch(error => { if (!['ENOTEMPTY', 'EEXIST', 'ENOENT'].includes(error.code)) throw error; });
  }
}

const psQuote = value => "'" + value.replace(/'/g, "''") + "'";
export async function powershell(script, env, timeoutMs = 60000, operation = 'POWERSHELL') {
  return runOwned('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from("$ErrorActionPreference='Stop'; " + script, 'utf16le').toString('base64')], { env, timeoutMs, operation });
}

async function registryState(guid, env) {
  const script = `$entries=@(); foreach($hive in @('HKCU','HKLM')) { $install="$hive\`:\\Software\\${guid}"; $uninstall="$hive\`:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${guid}"; ` +
    `if((Test-Path -LiteralPath $install) -or (Test-Path -LiteralPath $uninstall)) { $i=Get-ItemProperty -LiteralPath $install -ErrorAction SilentlyContinue; $u=Get-ItemProperty -LiteralPath $uninstall -ErrorAction SilentlyContinue; ` +
    `$entries += [pscustomobject]@{hive=$hive;installKey=(Test-Path -LiteralPath $install);uninstallKey=(Test-Path -LiteralPath $uninstall);location=$i.InstallLocation;version=$u.DisplayVersion} } }; ` +
    `$menu=Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs\\Codex Messenger.lnk'; $desktop=Join-Path ([Environment]::GetFolderPath('Desktop')) 'Codex Messenger.lnk'; ` +
    `ConvertTo-Json -Compress -InputObject ([pscustomobject]@{entries=@($entries);menu=(Test-Path -LiteralPath $menu);desktop=(Test-Path -LiteralPath $desktop)})`;
  return JSON.parse(requireExitZero(await powershell(script, env, 60000, 'REGISTRY_STATE')));
}

export function validateInstalledRegistration(state, directory, version) {
  assert.equal(state?.entries?.length, 1);
  assert.deepEqual(state.entries[0], { hive: 'HKCU', installKey: true, uninstallKey: true, location: directory, version });
  assert.equal(state.desktop, false, 'The test must not create a desktop shortcut');
  assert.equal(state.menu, true, 'The actual Start Menu shortcut must be created');
}

export function validateOwnedRegistrationCleanup(state, { root, directory, version, owner }) {
  assert.ok(isOwnedPath(root, directory, 'win32') && typeof owner === 'string' && owner);
  assert.ok(Array.isArray(state.entries) && state.entries.length <= 1);
  const uninstallCommand = `"${path.win32.join(directory, 'Uninstall Codex Messenger.exe')}" /currentuser`;
  for (const record of state.entries) {
    assert.equal(record.hive, 'HKCU');
    assert.equal(typeof record.installKey, 'boolean'); assert.equal(typeof record.uninstallKey, 'boolean');
    assert.ok(record.installKey || record.uninstallKey);
    if (record.installKey) {
      assert.equal(record.location, directory);
      assert.ok(record.installOwner === null || record.installOwner === owner);
      assert.ok(record.installOwner === owner || (record.uninstallKey && record.version === version));
    }
    if (record.uninstallKey) {
      assert.ok(record.version === null || record.version === version);
      assert.ok(record.uninstallOwner === null || record.uninstallOwner === owner);
      assert.ok(record.uninstallCommand === null || record.uninstallCommand === uninstallCommand);
      assert.ok(record.uninstallLocation === null || record.uninstallLocation === directory);
      assert.ok((record.version === version && record.uninstallCommand === uninstallCommand) ||
        (record.uninstallOwner === owner && record.uninstallLocation === directory));
    }
  }
  assert.ok(Array.isArray(state.shortcuts) && state.shortcuts.length <= 2);
  assert.equal(new Set(state.shortcuts.map(link => link.kind)).size, state.shortcuts.length);
  for (const link of state.shortcuts) {
    assert.ok(['menu', 'desktop'].includes(link.kind) && link.reparse === false);
    assert.equal(path.win32.relative(path.win32.join(directory, 'Codex Messenger.exe'), link.target), '');
  }
}

function cleanupSnapshotScript(guid) {
  assert.match(guid, /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i);
  return `function Get-OwnedState { $entries=@(); foreach($hive in @('HKCU','HKLM')) { ` +
    `$iKey="$hive\`:\\Software\\${guid}"; $uKey="$hive\`:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${guid}"; ` +
    `$hasI=Test-Path -LiteralPath $iKey; $hasU=Test-Path -LiteralPath $uKey; if($hasI -or $hasU){ ` +
    `$i=Get-ItemProperty -LiteralPath $iKey -ErrorAction SilentlyContinue; $u=Get-ItemProperty -LiteralPath $uKey -ErrorAction SilentlyContinue; ` +
    `$entries += [pscustomobject]@{hive=$hive;installKey=$hasI;uninstallKey=$hasU;location=$i.InstallLocation;version=$u.DisplayVersion;` +
    `installOwner=$i.InstallerSmokeOwner;uninstallOwner=$u.InstallerSmokeOwner;uninstallLocation=$u.InstallerSmokeLocation;uninstallCommand=$u.UninstallString} } }; ` +
    `$shortcuts=@(); $shell=$null; try { foreach($kind in @('menu','desktop')) { ` +
    `$base=if($kind -eq 'menu'){Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs'}else{[Environment]::GetFolderPath('Desktop')}; ` +
    `$file=Join-Path $base 'Codex Messenger.lnk'; if(Test-Path -LiteralPath $file){ $item=Get-Item -LiteralPath $file; ` +
    `if($null -eq $shell){$shell=New-Object -ComObject WScript.Shell}; $link=$null; try { $link=$shell.CreateShortcut($file); ` +
    `$shortcuts += [pscustomobject]@{kind=$kind;reparse=($item.PSIsContainer -or (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0));target=$link.TargetPath} ` +
    `}finally{if($null -ne $link){[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($link)}} } } ` +
    `}finally{if($null -ne $shell){[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell)}}; ` +
    `return [pscustomobject]@{entries=@($entries);shortcuts=@($shortcuts)} }; `;
}

async function mutateOwnedRegistration(guid, identity, env, mark = false) {
  const snapshotScript = cleanupSnapshotScript(guid);
  const state = JSON.parse(requireExitZero(await powershell(snapshotScript + 'ConvertTo-Json -Compress -Depth 6 -InputObject (Get-OwnedState)', env, 60000, 'REGISTRATION_CLEANUP_SNAPSHOT')));
  validateOwnedRegistrationCleanup(state, identity);
  const iKey = `HKCU:\\Software\\${guid}`, uKey = `HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${guid}`;
  const recheck = snapshotScript + `$before=ConvertFrom-Json -InputObject ${psQuote(JSON.stringify(state))}; $fresh=Get-OwnedState; ` +
    `if((ConvertTo-Json -Compress -Depth 6 -InputObject $fresh) -cne (ConvertTo-Json -Compress -Depth 6 -InputObject $before)){throw 'Registration changed'}; `;
  let mutation;
  if (mark) {
    mutation = `foreach($key in @(${psQuote(iKey)},${psQuote(uKey)})){if(Test-Path -LiteralPath $key){New-ItemProperty -LiteralPath $key -Name InstallerSmokeOwner -Value ${psQuote(identity.owner)} -PropertyType String -Force | Out-Null}}; ` +
      `if(Test-Path -LiteralPath ${psQuote(uKey)}){New-ItemProperty -LiteralPath ${psQuote(uKey)} -Name InstallerSmokeLocation -Value ${psQuote(identity.directory)} -PropertyType String -Force | Out-Null};`;
  } else {
    mutation = `foreach($key in @(${psQuote(iKey)},${psQuote(uKey)})){if(Test-Path -LiteralPath $key){Remove-Item -LiteralPath $key -Recurse -Force}}; ` +
      `foreach($link in $fresh.shortcuts){$base=if($link.kind -eq 'menu'){Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs'}else{[Environment]::GetFolderPath('Desktop')}; Remove-Item -LiteralPath (Join-Path $base 'Codex Messenger.lnk') -Force};`;
  }
  requireExitZero(await powershell(recheck + mutation, env, 60000, mark ? 'REGISTRATION_MARK_OWNER' : 'REGISTRATION_REMOVE_OWNED'));
}

async function ownedAppProcesses(executable, env, stop = false) {
  const script = `$apps=@(Get-Process -Name ${psQuote(path.win32.parse(executable).name)} -ErrorAction SilentlyContinue | Where-Object { try { $_.Path -eq ${psQuote(executable)} } catch { $false } }); ` +
    (stop ? '$apps | Stop-Process -Force; ' : '') + 'ConvertTo-Json -Compress -InputObject @($apps | ForEach-Object {$_.Id})';
  return JSON.parse(requireExitZero(await powershell(script, env, 60000, stop ? 'APP_PROCESSES_STOP_OWNED' : 'APP_PROCESSES_STATE')));
}

async function legacyMigrationSmoke(installer, options, root, entry, guid, env) {
  checkAbort();
  assert.deepEqual(await registryState(guid, env), { entries: [], menu: false, desktop: false });
  const directory = path.join(root, 'Codex Messenger Playground');
  const target = path.join(root, 'migration target with spaces', 'Codex Messenger');
  await fs.mkdir(directory, { mode: 0o700 });
  const sentinel = 'owned legacy migration fixture; must never execute\n';
  const files = ['foreign-project.txt', 'Codex Messenger.exe', 'Uninstall Codex Messenger.exe'].map(name => path.join(directory, name));
  await Promise.all(files.map(file => fs.writeFile(file, sentinel, { flag: 'wx', mode: 0o600 })));
  const installKey = `HKCU:\\Software\\${guid}`, uninstallKey = `HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${guid}`;
  const owner = path.basename(root);
  const fixture = `$i=${psQuote(installKey)}; $u=${psQuote(uninstallKey)}; if((Test-Path -LiteralPath $i) -or (Test-Path -LiteralPath $u)){throw 'Preexisting product'}; ` +
    `New-Item -Path $i -Force | Out-Null; New-ItemProperty -LiteralPath $i -Name InstallerSmokeOwner -Value ${psQuote(owner)} -PropertyType String | Out-Null; ` +
    `New-ItemProperty -LiteralPath $i -Name InstallLocation -Value ${psQuote(directory)} -PropertyType String | Out-Null; ` +
    `New-Item -Path $u -Force | Out-Null; New-ItemProperty -LiteralPath $u -Name InstallerSmokeOwner -Value ${psQuote(owner)} -PropertyType String | Out-Null; ` +
    `New-ItemProperty -LiteralPath $u -Name DisplayName -Value 'Codex Messenger 0.0.3' -PropertyType String | Out-Null; ` +
    `New-ItemProperty -LiteralPath $u -Name DisplayVersion -Value '0.0.3' -PropertyType String | Out-Null; ` +
    `New-ItemProperty -LiteralPath $u -Name UninstallString -Value ${psQuote('"' + files[2] + '" /currentuser')} -PropertyType String | Out-Null;`;
  let attempted = false;
  try {
    attempted = true; requireExitZero(await powershell(fixture, env));
    const before = await registryState(guid, env);
    validateInstalledRegistration({ ...before, menu: true }, directory, '0.0.3');
    const refused = await runOwned(installer, nsisInstallArguments(target), { env, cwd: root, timeoutMs: 30000, verbatim: true, operation: 'NSIS_LEGACY_INSTALL' });
    requireNativeCommandExit(refused, 42);
    entry.checks.legacySharedDirectoryRefused = true;
    assert.deepEqual(await registryState(guid, env), before);
    for (const file of files) assert.equal(await fs.readFile(file, 'utf8'), sentinel);
    await assert.rejects(fs.stat(path.join(target, 'Codex Messenger.exe')), { code: 'ENOENT' });
    entry.checks.legacyFilesPreserved = true;
  } finally {
    if (attempted) {
      const cleanup = `$i=${psQuote(installKey)}; $u=${psQuote(uninstallKey)}; ` +
        `if(Test-Path -LiteralPath $i){$p=Get-ItemProperty -LiteralPath $i; if(($p.InstallerSmokeOwner -cne ${psQuote(owner)}) -or ($p.InstallLocation -cne ${psQuote(directory)})){throw 'Unowned install registration'}}; ` +
        `if(Test-Path -LiteralPath $u){$p=Get-ItemProperty -LiteralPath $u; if(($p.InstallerSmokeOwner -cne ${psQuote(owner)}) -or ($p.DisplayVersion -cne '0.0.3')){throw 'Unowned uninstall registration'}}; ` +
        `foreach($key in @($i,$u)){if(Test-Path -LiteralPath $key){Remove-Item -LiteralPath $key -Recurse -Force}}`;
      await cleanupOwned(async () => {
        requireExitZero(await powershell(cleanup, env));
        assert.deepEqual(await registryState(guid, env), { entries: [], menu: false, desktop: false });
      });
    }
  }
}

async function nsisSmoke(installer, options, root, entry, origin) {
  const env = privateEnvironment(root), directory = path.join(root, 'custom install with spaces', 'Codex Messenger');
  await validateNativeInstallerFolders(root, env);
  entry.environmentMode = env.CODEX_MESSENGER_INSTALLER_KEEP_OS_FOLDERS === '1' ? 'native' : 'private';
  const files = { executable: path.join(directory, 'Codex Messenger.exe'), asar: path.join(directory, 'resources', 'app.asar') };
  const pkg = JSON.parse(await fs.readFile(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'));
  const { UUID } = createRequire(import.meta.url)('builder-util-runtime');
  const guid = pkg.build.nsis.guid || UUID.v5(pkg.build.appId, UUID.parse('50e065bc-3134-11e6-9bab-38c9862bdaf3'));
  const identity = { root, directory, version: options.version, owner: randomUUID() };
  const baselineStarted = Date.now();
  const before = await registryState(guid, env);
  entry.registryBaselineDurationMs = Date.now() - baselineStarted;
  assert.deepEqual(before, { entries: [], menu: false, desktop: false }, 'Refuse to touch a pre-existing installation or shortcut');
  assert.equal(pkg.name, 'codex-messenger', 'The cache namespace must match the packaged product');
  const nativeLocalFolder = environmentEntry(process.env, 'LOCALAPPDATA')?.[1];
  assert.ok(typeof nativeLocalFolder === 'string' && path.isAbsolute(nativeLocalFolder), 'Missing native Windows cache folder');
  const cacheSnapshots = await snapshotInstallerCaches([nativeLocalFolder, environmentEntry(env, 'LOCALAPPDATA')[1]], entry.sha256, entry.bytes);
  const foreign = path.join(directory, 'installer-smoke-foreign.txt'), sentinel = 'owned installer smoke sentinel\n';
  const protectedFiles = [path.join(root, 'profile', 'preserve.txt'), path.join(root, 'codex-home', 'preserve.txt'), path.join(root, 'project', 'preserve.txt')];
  await Promise.all(protectedFiles.map(file => fs.writeFile(file, sentinel, { flag: 'wx', mode: 0o600 })));
  let uninstallerSha256;
  const uninstall = async () => {
    const copy = await copyOwnedUninstaller(root, directory, uninstallerSha256);
    try {
      return await runOwned(copy.executable, nsisUninstallArguments(directory), { env, cwd: root, timeoutMs: 30000, verbatim: true, operation: 'NSIS_UNINSTALL' });
    } finally { await fs.rm(copy.copyDirectory, { recursive: true, force: true }); }
  };
  let attempted = false;
  await runWithOwnedCleanup(async () => {
    attempted = true;
    requireExitZero(await runOwned(installer, nsisInstallArguments(directory), { env, cwd: root, timeoutMs: 60000, verbatim: true, operation: 'NSIS_INSTALL' }));
    validateInstalledRegistration(await registryState(guid, env), directory, options.version);
    await mutateOwnedRegistration(guid, identity, env, true);
    assert.ok((await fs.stat(files.executable)).isFile());
    const uninstaller = path.join(directory, 'Uninstall Codex Messenger.exe');
    const uninstallerStat = await fs.lstat(uninstaller);
    assert.ok(uninstallerStat.isFile() && !uninstallerStat.isSymbolicLink() && uninstallerStat.size >= 1024);
    uninstallerSha256 = await sha256File(uninstaller);
    entry.checks.installed = true;
    await new Promise(resolve => setTimeout(resolve, 1000));
    assert.deepEqual(await ownedAppProcesses(files.executable, env), []);
    await assert.rejects(fs.stat(path.join(root, 'profile', 'codex-messenger.log')), { code: 'ENOENT' });
    entry.checks.silentNoAutoLaunch = true;
    entry.appAsarSha256 = await sha256File(files.asar); validateOriginAsar(entry.appAsarSha256, origin); entry.checks.originAsar = true;
    checkAbort();
    entry.smoke = await runPackagedSmoke(options, { files, writeReport: false }); validateInstallerApplication(entry.smoke, options);
    checkAbort();
    await fs.writeFile(foreign, sentinel, { flag: 'wx', mode: 0o600 });
    const refused = await uninstall();
    requireNativeCommandExit(refused, 42);
    entry.checks.foreignUninstallRefused = true;
    assert.equal(await fs.readFile(foreign, 'utf8'), sentinel); assert.ok((await fs.stat(files.executable)).isFile());
    validateInstalledRegistration(await registryState(guid, env), directory, options.version);
    entry.checks.foreignFilePreserved = true;
    await fs.unlink(foreign);
    requireExitZero(await uninstall());
    await assert.rejects(fs.stat(files.executable), { code: 'ENOENT' }); entry.checks.uninstalled = true;
    assert.deepEqual(await registryState(guid, env), { entries: [], menu: false, desktop: false }); entry.checks.registrationRemoved = true;
    for (const file of protectedFiles) assert.equal(await fs.readFile(file, 'utf8'), sentinel);
    entry.checks.protectedFilesPreserved = true;
    await legacyMigrationSmoke(installer, options, root, entry, guid, env);
  }, async () => {
    if (attempted) {
      await cleanupOwned(() => runWithOwnedCleanup(async () => {
        await ownedAppProcesses(files.executable, env, true);
        if (await fs.stat(foreign).then(() => true, () => false)) { assert.equal(await fs.readFile(foreign, 'utf8'), sentinel); await fs.unlink(foreign); }
        const state = await registryState(guid, env);
        if (state.entries.length || state.menu || state.desktop || await fs.stat(files.executable).then(() => true, () => false)) {
          const cleanupState = JSON.parse(requireExitZero(await powershell(cleanupSnapshotScript(guid) + 'ConvertTo-Json -Compress -Depth 6 -InputObject (Get-OwnedState)', env, 60000, 'NSIS_CLEANUP_SNAPSHOT')));
          validateOwnedRegistrationCleanup(cleanupState, identity);
          const uninstallFile = path.join(directory, 'Uninstall Codex Messenger.exe');
          const regular = await fs.lstat(uninstallFile).then(stat => stat.isFile() && !stat.isSymbolicLink(), () => false);
          if (regular && uninstallerSha256 && state.entries.every(record => record.location === directory)) await uninstall();
          const remaining = await registryState(guid, env);
          if (remaining.entries.length || remaining.menu || remaining.desktop) await mutateOwnedRegistration(guid, identity, env);
        }
        assert.deepEqual(await registryState(guid, env), { entries: [], menu: false, desktop: false });
      }, () => cleanupInstallerCaches(cacheSnapshots)));
    }
  });
}

export async function uniqueRegularPayload(root, name) {
  const found = [];
  const visit = async (directory, depth) => {
    assert.ok(depth <= 8, 'Extracted payload exceeds the expected depth');
    for (const child of await fs.readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, child.name);
      if (child.isSymbolicLink()) continue;
      if (child.isDirectory()) await visit(file, depth + 1);
      else if (child.isFile() && child.name === name) found.push(file);
    }
  };
  await visit(root, 0);
  assert.equal(found.length, 1, 'Expected one actual embedded portable payload');
  return found[0];
}

async function portableSmoke(installer, options, root, entry, origin) {
  const env = privateEnvironment(root), outer = path.join(root, 'outer'), payload = path.join(root, 'payload');
  await validateNativeInstallerFolders(root, env);
  entry.environmentMode = env.CODEX_MESSENGER_INSTALLER_KEEP_OS_FOLDERS === '1' ? 'native' : 'private';
  await Promise.all([outer, payload].map(directory => fs.mkdir(directory, { mode: 0o700 })));
  const zip = requireExitZero(await powershell("(Get-Command 7z.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source", env)).trim();
  assert.ok(path.isAbsolute(zip) && (await fs.stat(zip)).isFile(), 'Full 7-Zip is required for the actual NSIS portable payload');
  requireExitZero(await runOwned(zip, ['x', installer, `-o${outer}`, '-y'], { env, timeoutMs: 60000 }));
  const embedded = await uniqueRegularPayload(outer, 'app-64.7z');
  requireExitZero(await runOwned(zip, ['x', embedded, `-o${payload}`, '-y'], { env, timeoutMs: 60000 }));
  const files = { executable: path.join(payload, 'Codex Messenger.exe'), asar: path.join(payload, 'resources', 'app.asar') };
  entry.appAsarSha256 = await sha256File(files.asar); validateOriginAsar(entry.appAsarSha256, origin); entry.checks.originAsar = true;
  checkAbort();
  entry.smoke = await runPackagedSmoke(options, { files, writeReport: false }); validateInstallerApplication(entry.smoke, options);
  checkAbort();
  const wrapperDirectory = path.join(root, 'actual portable with spaces');
  await fs.mkdir(wrapperDirectory, { mode: 0o700 });
  const wrapperFile = path.join(wrapperDirectory, path.basename(installer));
  await fs.copyFile(installer, wrapperFile); assert.equal(await sha256File(wrapperFile), entry.sha256);
  const wrapper = await runOwned(wrapperFile, ['--smoke-test'], { env, cwd: wrapperDirectory, timeoutMs: 45000 });
  Object.assign(entry.checks, validatePortableWrapper(await fs.readFile(path.join(root, 'profile', 'codex-messenger.log'), 'utf8'), wrapper,
    { version: options.version, privateRoot: path.join(root, 'temp with spaces'), userData: path.join(root, 'profile') }));
  assert.deepEqual(await fs.readdir(path.join(root, 'temp with spaces')), [], 'Portable wrapper must remove its temporary payload');
}

async function macSmoke(installer, kind, options, root, entry, origin) {
  const mountPoint = path.join(root, 'mount'), destination = path.join(root, 'extracted');
  await fs.mkdir(destination, { mode: 0o700 });
  let attached = false, attachAttempted = false;
  try {
    if (kind === 'dmg') {
      await fs.mkdir(mountPoint, { mode: 0o700 });
      attachAttempted = true;
      requireExitZero(await runOwned('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-noautoopen', '-mountpoint', mountPoint, installer], { timeoutMs: 45000 }));
      attached = true;
      validateReadOnlyMount(requireExitZero(await runOwned('/sbin/mount', [])), mountPoint); entry.checks.mountedReadOnly = true;
      requireExitZero(await runOwned('/usr/bin/ditto', [path.join(mountPoint, 'Codex Messenger.app'), path.join(destination, 'Codex Messenger.app')], { timeoutMs: 45000 }));
      entry.checks.copiedApplication = true;
    } else {
      requireExitZero(await runOwned('/usr/bin/ditto', ['-x', '-k', installer, destination], { timeoutMs: 45000 }));
      entry.checks.extractedApplication = true;
    }
    const contents = path.join(destination, 'Codex Messenger.app', 'Contents');
    const files = { executable: path.join(contents, 'MacOS', 'Codex Messenger'), asar: path.join(contents, 'Resources', 'app.asar') };
    const plist = JSON.parse(requireExitZero(await runOwned('/usr/bin/plutil', ['-convert', 'json', '-o', '-', path.join(contents, 'Info.plist')])));
    const architectures = requireExitZero(await runOwned('/usr/bin/lipo', ['-archs', files.executable]));
    validateBundleIdentity(plist, architectures, options); entry.checks.bundleArchitecture = true; entry.checks.bundleVersion = true;
    entry.appAsarSha256 = await sha256File(files.asar); validateOriginAsar(entry.appAsarSha256, origin); entry.checks.originAsar = true;
    checkAbort();
    entry.smoke = await runPackagedSmoke(options, { files, writeReport: false }); validateInstallerApplication(entry.smoke, options);
    checkAbort();
  } finally {
    if (attachAttempted) {
      await cleanupOwned(async () => {
      const mounted = requireExitZero(await runOwned('/sbin/mount', [])).split(/\r?\n/).some(line => line.includes(` on ${mountPoint} (`));
      if (mounted) {
        const detached = await runOwned('/usr/bin/hdiutil', ['detach', mountPoint], { timeoutMs: 15000 });
        if (detached.code !== 0 || detached.forced) requireExitZero(await runOwned('/usr/bin/hdiutil', ['detach', '-force', mountPoint], { timeoutMs: 15000 }));
      }
      assert.ok(!requireExitZero(await runOwned('/sbin/mount', [])).split(/\r?\n/).some(line => line.includes(` on ${mountPoint} (`)));
      if (attached) entry.checks.mountDetached = true;
      });
    }
  }
}

export async function runInstallerSmoke(options, { signal } = {}) {
  return nativeScope.run({ signal, cleanup: false }, () => executeInstallerSmoke(options));
}

async function executeInstallerSmoke(options) {
  const report = { schemaVersion: 1, passed: false, version: options.version, platform: options.platform, arch: options.arch, installers: [], failure: null, failureDetail: null,
    scope: 'Actual installer containers and local packaged startup only; no credentials, inference, signing or notarization validation' };
  let stage = 'HOST_TARGET';
  try {
    checkAbort();
    assert.equal(process.platform, options.platform === 'windows' ? 'win32' : 'darwin'); assert.equal(process.arch, options.arch);
    const origin = await sha256File((await findPackagedExecutable(options)).asar);
    for (const [index, name] of expectedInstallers(options).entries()) {
      checkAbort();
      const kind = options.platform === 'windows' ? (index === 0 ? 'nsis' : 'portable') : (index === 0 ? 'dmg' : 'zip');
      stage = kind.toUpperCase();
      const installer = path.resolve(options.output, name), stat = await fs.lstat(installer);
      assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size >= 1024);
      const entry = { name, bytes: stat.size, sha256: await sha256File(installer), passed: false, checks: {}, appAsarSha256: null, smoke: null };
      report.installers.push(entry);
      const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), `codex-messenger-${kind}-`)));
      await fs.chmod(root, 0o700);
      try {
        await Promise.all(['profile', 'codex-home', 'project', 'temp with spaces', 'appdata', 'localappdata'].map(directory => fs.mkdir(path.join(root, directory), { mode: 0o700 })));
        if (kind === 'nsis') await nsisSmoke(installer, options, root, entry, origin);
        else if (kind === 'portable') await portableSmoke(installer, options, root, entry, origin);
        else await macSmoke(installer, kind, options, root, entry, origin);
        assert.equal(await sha256File(installer), entry.sha256, 'Actual installer must not change during validation');
      } finally {
        await fs.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
        entry.checks.privateTempCleanup = true;
      }
      checkAbort();
      entry.passed = true;
      try { validateInstallerEntry(entry, kind, options); } catch (error) { entry.passed = false; throw error; }
    }
    report.passed = report.installers.length === 2 && report.installers.every(entry => entry.passed);
  } catch (error) {
    report.failure = stage;
    report.failureDetail = nativeScope.getStore()?.signal?.aborted ? 'HARD_TIMEOUT' : error.installerSmokeCode || (/^[A-Z0-9_]{1,64}$/.test(error.code || '') ? error.code : 'VALIDATION_FAILED');
    if (Number.isSafeInteger(error.expectedExitCode)) report.expectedExitCode = error.expectedExitCode;
    if (/^[A-Z0-9_]{1,64}$/.test(error.installerSmokeOperation || '')) report.failureOperation = error.installerSmokeOperation;
    if (/^[A-Z0-9_]{1,64}$/.test(error.installerSmokeCleanupCode || '')) report.cleanupFailureDetail = error.installerSmokeCleanupCode;
    if (/^[A-Z0-9_]{1,64}$/.test(error.installerSmokeCleanupOperation || '')) report.cleanupFailureOperation = error.installerSmokeCleanupOperation;
    if (error.installerSmokeNativeDiagnostics) report.nativeDiagnostics = error.installerSmokeNativeDiagnostics;
    if (error.installerSmokeCleanupDiagnostics) report.cleanupNativeDiagnostics = error.installerSmokeCleanupDiagnostics;
  }
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let watchdog;
  try {
    const options = parseInstallerSmokeArguments(process.argv.slice(2));
    const controller = new AbortController();
    watchdog = setTimeout(() => controller.abort(), 360000);
    const report = await runInstallerSmoke(options, { signal: controller.signal });
    await fs.mkdir(path.dirname(path.resolve(options.report)), { recursive: true });
    await fs.writeFile(options.report, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
    console.log(JSON.stringify(report)); process.exitCode = report.passed ? 0 : 1;
  } catch { console.error('Installer smoke failed (ARGUMENTS_OR_REPORT).'); process.exitCode = 1; }
  finally { clearTimeout(watchdog); }
}
