import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { privateEnvironment } from './installer-smoke.mjs';

const findEntry = (environment, name) => Object.entries(environment).find(([key]) => key.toUpperCase() === name);
const primitives = {
  minimal: { marker: 'PS_PROBE_READY', script: "[Console]::WriteLine('PS_PROBE_READY')" },
  commandDiscovery: { marker: 'PS_PROBE_CIM_AVAILABLE', script: "$ErrorActionPreference='Stop'; if($null -ne (Get-Command Get-CimInstance -ErrorAction SilentlyContinue)){[Console]::WriteLine('PS_PROBE_CIM_AVAILABLE');exit 0}else{exit 1}" }
};

export function diagnosticEnvironments(root, original) {
  const native = { ...original, CODEX_MESSENGER_USER_DATA_DIR: path.win32.join(root, 'profile'), CODEX_HOME: path.win32.join(root, 'codex-home'), CODEX_MESSENGER_CODEX_PATH: path.win32.join(root, 'codex-unavailable') };
  const folders = privateEnvironment(root, { ...original, CODEX_MESSENGER_INSTALLER_KEEP_OS_FOLDERS: '1' }, { platform: 'win32' });
  const modules = privateEnvironment(root, { ...original, CODEX_MESSENGER_INSTALLER_KEEP_OS_FOLDERS: '0' }, { platform: 'win32' });
  const moduleEntry = findEntry(original, 'PSMODULEPATH');
  for (const key of Object.keys(modules)) if (key.toUpperCase() === 'PSMODULEPATH') delete modules[key];
  if (moduleEntry) modules[moduleEntry[0]] = moduleEntry[1];
  return [
    { mode: 'nativeEnvironment', environment: native },
    { mode: 'isolatedNativeFolders', environment: folders },
    { mode: 'isolatedPrivateFoldersWithOriginalModulePath', environment: modules }
  ];
}

export async function measureProbe(command, args, environment, marker, { timeoutMs = 25000, launch = spawn, platform = process.platform } = {}) {
  assert.ok(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 45000);
  const startedAt = Date.now();
  return new Promise(resolve => {
    let child, timer, cleanupTimer, exitTimer, output = '', outputOverflow = false, stderrPresent = false;
    let settled = false, started = false, closed = false, timedOut = false, forced = false, pipesOpenAfterExit = false, code = null, signal = null;
    const finish = () => {
      if (settled) return; settled = true;
      clearTimeout(timer); clearTimeout(cleanupTimer); clearTimeout(exitTimer);
      child?.stdin?.destroy(); child?.stdout?.destroy(); child?.stderr?.destroy(); child?.unref();
      const markerObserved = !outputOverflow && output.trim() === marker;
      const outcome = !started ? 'NOT_STARTED' : timedOut ? 'TIMEOUT' : pipesOpenAfterExit ? 'EXIT_WITH_OPEN_PIPES' :
        code !== 0 || signal !== null ? 'FAILED_EXIT' : !markerObserved ? 'UNEXPECTED_OUTPUT' : 'PASS';
      resolve({ outcome, durationMs: Date.now() - startedAt, started, closed, timedOut, forced, pipesOpenAfterExit,
        exitCode: Number.isSafeInteger(code) ? code : null, signal: typeof signal === 'string' && /^[A-Z0-9]{1,16}$/.test(signal) ? signal : null,
        markerObserved, stderrPresent });
    };
    const stop = () => {
      forced = true;
      const signalOwnedParent = () => {
        if (child?.pid && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      };
      // Keep the owned process referenced until its real close event. Closing
      // its streams and unref'ing immediately can hide a pending termination.
      cleanupTimer = setTimeout(() => { signalOwnedParent(); finish(); }, 1250);
      if (child?.pid && child.exitCode === null && child.signalCode === null) {
        if (platform === 'win32') execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { timeout: 1000, windowsHide: true }, signalOwnedParent);
        else { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
      }
    };
    try { child = launch(command, args, { env: environment, shell: false, windowsHide: true, detached: platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch { finish(); return; }
    timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
    child.once('spawn', () => { started = true; });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      if (Buffer.byteLength(output) + Buffer.byteLength(chunk) > 256) { outputOverflow = true; return; }
      output += chunk;
    });
    child.stderr.on('data', () => { stderrPresent = true; });
    child.once('error', finish);
    child.once('exit', (exitCode, exitSignal) => {
      code = exitCode; signal = exitSignal;
      if (!timedOut) exitTimer = setTimeout(() => { pipesOpenAfterExit = true; finish(); }, 500);
    });
    child.once('close', (exitCode, exitSignal) => { code = exitCode; signal = exitSignal; closed = true; finish(); });
  });
}

export async function runWindowsPowerShellDiagnostics({ reportPath } = {}) {
  const report = { schemaVersion: 1, platform: process.platform, arch: process.arch, diagnosticOnly: true, observations: [], scope: 'Fixed local PowerShell startup and command discovery; no installer or application validation' };
  if (process.platform !== 'win32') { report.status = 'UNSUPPORTED_HOST'; return report; }
  const startedAt = Date.now(), root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'codex-messenger-powershell-probe-')));
  try {
    await Promise.all(['profile', 'codex-home', 'temp with spaces', 'appdata', 'localappdata'].map(name => fs.mkdir(path.join(root, name))));
    const systemRoot = findEntry(process.env, 'SYSTEMROOT')?.[1];
    assert.ok(typeof systemRoot === 'string' && path.win32.isAbsolute(systemRoot));
    const executable = path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    for (const { mode, environment } of diagnosticEnvironments(root, process.env)) {
      for (const [primitive, definition] of Object.entries(primitives)) {
        const remaining = 170000 - (Date.now() - startedAt);
        if (remaining < 2500) { report.observations.push({ mode, primitive, outcome: 'TOTAL_BUDGET_EXHAUSTED' }); continue; }
        const args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(definition.script, 'utf16le').toString('base64')];
        const result = await measureProbe(executable, args, environment, definition.marker, { timeoutMs: Math.min(25000, remaining - 1500) });
        report.observations.push({ mode, primitive, originalModulePathProvided: Boolean(findEntry(environment, 'PSMODULEPATH')), ...result });
      }
    }
    report.status = 'RECORDED';
  } catch { report.status = 'PROBE_SETUP_FAILED'; }
  finally {
    try { await fs.rm(root, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 }); report.privateTempCleanup = true; }
    catch { report.privateTempCleanup = false; report.status = 'PROBE_CLEANUP_FAILED'; }
    report.durationMs = Date.now() - startedAt;
  }
  if (reportPath) { await fs.mkdir(path.dirname(path.resolve(reportPath)), { recursive: true }); await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n'); }
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert.equal(process.argv.length, 4); assert.equal(process.argv[2], '--report');
    const report = await runWindowsPowerShellDiagnostics({ reportPath: process.argv[3] });
    console.log(JSON.stringify(report));
    // These observations never substitute for the actual installer checks.
    process.exitCode = 0;
  } catch { console.error('PowerShell diagnostics could not write their report.'); process.exitCode = 1; }
}
