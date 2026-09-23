import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseSmokeArguments, isolatedSmokeEnvironment, errorsFromPrivateLog } from './packaged-smoke.mjs';
import { runWebPreview, stopChild, waitForChild } from './web-preview.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function portIsClosed() {
  return new Promise(resolve => {
    const socket = net.connect({ host: '127.0.0.1', port: 5174 });
    socket.once('connect', () => { socket.destroy(); resolve(false); });
    socket.once('error', () => { socket.destroy(); resolve(true); });
    socket.setTimeout(1000, () => { socket.destroy(); resolve(false); });
  });
}

export async function runLauncherSmoke(options) {
  const started = Date.now();
  const report = { schemaVersion: 1, passed: false, version: options.version, platform: options.platform, arch: options.arch,
    checks: {}, errors: errorsFromPrivateLog(''), failure: null,
    scope: 'Native development runner and owned Vite preview; no authentication, model calls or hardware tests.' };
  let temporary, child, timer;
  try {
    assert.equal(process.platform, options.platform === 'windows' ? 'win32' : 'darwin');
    assert.equal(process.arch, options.arch);
    assert.equal(await portIsClosed(), true, 'Port 5174 must be free before launcher smoke');
    temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-messenger-launcher-'));
    const userData = path.join(temporary, 'private profile'), codexHome = path.join(temporary, 'private codex home');
    await Promise.all([fs.mkdir(userData, { mode: 0o700 }), fs.mkdir(codexHome, { mode: 0o700 })]);
    const environment = isolatedSmokeEnvironment(process.env, { userData, codexHome, unavailableCodex: path.join(temporary, 'disabled-cli') });
    child = spawn(process.execPath, [path.join(root, 'scripts', 'dev-electron.mjs'), '--smoke-test'], {
      cwd: temporary, env: environment, shell: false, stdio: ['ignore', 'pipe', 'pipe']
    });
    // Keep native output private: report only bounded error categories and successful observations.
    child.stdout.resume(); child.stderr.resume();
    const code = await Promise.race([waitForChild(child), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('DEVELOPMENT_TIMEOUT')), 60000);
    })]);
    clearTimeout(timer);
    assert.equal(code, 0, 'Development Electron must exit normally');
    report.process = { closed: true, forced: false, exitCode: code };
    const log = await fs.readFile(path.join(userData, 'codex-messenger.log'), 'utf8');
    report.errors = errorsFromPrivateLog(log);
    assert.ok(Object.values(report.errors).every(count => count === 0), 'Development renderer must have zero runtime errors');
    const records = log.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
    report.checks.developmentStartup = records.some(record => record.event === 'app.start' && record.dev === true && record.packaged === false);
    report.checks.developmentVersion = records.some(record => record.event === 'app.start' && record.version === options.version);
    report.checks.developmentRendererReady = records.some(record => record.event === 'window.ready-to-show' && record.url?.startsWith('http://127.0.0.1:5174/'));
    report.checks.developmentCleanExit = code === 0;
    report.checks.developmentServerClosed = await portIsClosed();
    await runWebPreview({ openBrowser: async () => {
      const response = await fetch('http://127.0.0.1:5174/');
      const html = await response.text();
      report.checks.previewHttpReady = response.ok && html.includes('/@vite/client') && html.includes('id="root"');
      process.emit('SIGINT');
    } });
    report.checks.previewCleanStop = true;
    report.checks.previewPortClosed = await portIsClosed();
    await fs.rm(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    temporary = null;
    report.checks.privateProfileCleanup = true;
    assert.equal(Object.keys(report.checks).length, 9);
    assert.ok(Object.values(report.checks).every(value => value === true), 'Launcher checks failed');
    report.passed = true;
  } catch (error) { report.failure = error.message; }
  finally {
    clearTimeout(timer);
    await stopChild(child);
    if (temporary) await fs.rm(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }).catch(() => {});
  }
  report.durationMs = Date.now() - started;
  await fs.mkdir(path.dirname(path.resolve(options.report)), { recursive: true });
  await fs.writeFile(options.report, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify(report));
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = (await runLauncherSmoke(parseSmokeArguments(process.argv.slice(2)))).passed ? 0 : 1; }
  catch (error) { console.error(`Launcher smoke failed: ${error.message}`); process.exitCode = 1; }
}
