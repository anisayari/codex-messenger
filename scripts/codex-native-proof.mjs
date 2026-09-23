import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolveNpmCodexNativeExecutable } from '../shared/codexExecutable.js';
import { canonicalReleaseVersion } from './release-metadata.mjs';
import { isolatedSmokeEnvironment } from './packaged-smoke.mjs';

export function parseNativeProofArguments(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]?.replace(/^--/, '');
    assert.ok(['runtime', 'version', 'platform', 'arch', 'report', 'tap'].includes(key), 'Unknown native proof argument');
    assert.ok(args[index].startsWith('--') && typeof args[index + 1] === 'string' && args[index + 1].trim() && !args[index + 1].startsWith('--') && !args[index + 1].includes('\0'), 'Missing native proof argument');
    assert.ok(!Object.hasOwn(options, key), 'Duplicate native proof argument');
    options[key] = args[index + 1];
  }
  assert.deepEqual(Object.keys(options).sort(), ['arch', 'platform', 'report', 'runtime', 'tap', 'version'], 'All native proof arguments are required');
  canonicalReleaseVersion(options.version);
  nativeCodexTarget(options.platform, options.arch);
  assert.notEqual(path.resolve(options.report), path.resolve(options.tap), 'JSON and TAP outputs must differ');
  return options;
}

export function nativeCodexTarget(platform, arch) {
  assert.ok(['windows', 'macos'].includes(platform) && ['x64', 'arm64'].includes(arch), 'Unsupported native Codex target');
  return { nodePlatform: platform === 'windows' ? 'win32' : 'darwin',
    triple: `${arch === 'x64' ? 'x86_64' : 'aarch64'}-${platform === 'windows' ? 'pc-windows-msvc' : 'apple-darwin'}`,
    binary: platform === 'windows' ? 'codex.exe' : 'codex' };
}

export function validateNativeExecutableLayout(executable, wrapper, target) {
  assert.ok(typeof executable === 'string' && executable !== wrapper, 'The npm Node wrapper is not a native executable');
  const normalized = executable.replace(/\\/g, '/');
  assert.ok(normalized.endsWith(`/vendor/${target.triple}/bin/${target.binary}`), 'The native executable must match the official platform package layout');
}

export function validateNativeBinaryHeader(bytes, { platform, arch }) {
  if (platform === 'macos') {
    assert.ok(bytes.length >= 8 && bytes.readUInt32LE(0) === 0xfeedfacf &&
      bytes.readUInt32LE(4) === (arch === 'arm64' ? 0x0100000c : 0x01000007), 'Expected the requested native Mach-O architecture');
  } else {
    assert.ok(bytes.length >= 64 && bytes.readUInt16LE(0) === 0x5a4d, 'Expected a native Windows executable');
    const offset = bytes.readUInt32LE(0x3c);
    assert.ok(offset + 6 <= bytes.length && bytes.readUInt32LE(offset) === 0x00004550 &&
      bytes.readUInt16LE(offset + 4) === (arch === 'arm64' ? 0xaa64 : 0x8664), 'Expected the requested native PE architecture');
  }
}

export function validateNativeVersion(stdout, version) {
  canonicalReleaseVersion(version);
  assert.ok([`codex-cli ${version}`, `codex-cli ${version}\n`, `codex-cli ${version}\r\n`].includes(stdout), 'The native Codex version must match exactly');
}

export function validateLiveTap(text, exitCode, version) {
  assert.equal(exitCode, 0, 'Live test process must exit successfully');
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  assert.equal(lines[0], 'TAP version 13', 'Expected the Node TAP reporter');
  assert.equal(lines.filter(line => /^1\.\./.test(line)).length, 1, 'Expected one complete test plan');
  assert.ok(lines.includes('1..1'), 'Live fixture must execute exactly one test');
  assert.equal(lines.filter(line => /^(?:not )?ok \d+/.test(line)).length, 1, 'Expected one actual live outcome');
  const outcome = lines.find(line => /^(?:not )?ok \d+/.test(line));
  assert.equal(outcome, `ok 1 - actual ${version} binary: discovery, metadata and unmaterialized history capability`, 'Expected the real live contract fixture without skip or TODO');
  assert.ok(!lines.some(line => /^\s*Bail out!/i.test(line)), 'A bailed out fixture cannot pass');
  assert.ok(!lines.some(line => /^\s+(?:(?:not )?ok \d+|\d+\.\.)/.test(line)), 'The live fixture must have no nested outcomes or plans');
  const summary = {};
  for (const key of ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo']) {
    const entries = lines.filter(line => new RegExp(`^# ${key} [0-9]+$`).test(line));
    assert.equal(entries.length, 1, 'Expected an unambiguous complete test summary');
    summary[key] = Number(entries[0].slice(entries[0].lastIndexOf(' ') + 1));
  }
  assert.deepEqual(summary, { tests: 1, pass: 1, fail: 0, cancelled: 0, skipped: 0, todo: 0 }, 'Live fixture cannot be skipped, cancelled, failed or empty');
  return summary;
}

export function redactNativeTap(text, privatePrefixes = []) {
  let redacted = text.replace(/\x1b\[[0-9;]*m/g, '');
  for (const prefix of privatePrefixes.filter(Boolean).sort((a, b) => b.length - a.length)) {
    for (const variant of new Set([prefix, prefix.replace(/\\/g, '/'), prefix.replace(/\\/g, '\\\\'), encodeURI(prefix)])) {
      redacted = redacted.split(variant).join('[private-path]');
    }
  }
  return redacted.replace(/(['"])(?:file:\/\/|[a-z]:[\\/]|\\{2,}|\/)[^'"\r\n]*\1/gi, '$1[private-path]$1')
    .replace(/file:\/\/[^\s'"\)]*/gi, '[private-path]')
    .replace(/\b[a-z]:[\\/][^\s'"\)]*/gi, '[private-path]')
    .replace(/\\{2,}[^\s'"\)]*/g, '[private-path]')
    .replace(/(?<![\w:])\/[^\s'"\)]*/g, '[private-path]')
    .replace(/\[private-path\][^\s'"\)]*/g, '[private-path]');
}

async function runOwnedProcess(command, args, { env, cwd, timeoutMs }) {
  return new Promise(resolve => {
    const child = spawn(command, args, { env, cwd, shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', timedOut = false, overflow = false, started = true, fallback;
    const terminate = () => {
      if (child.pid && child.exitCode === null && child.signalCode === null) {
        if (process.platform === 'win32') execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { timeout: 2000, windowsHide: true }, () => {});
        else { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
      }
      fallback ||= setTimeout(() => finish(null, null), 2500);
    };
    const finish = (code, signal) => { clearTimeout(timer); clearTimeout(fallback); resolve({ code, signal, started, timedOut, overflow, stdout, stderr }); };
    const timer = setTimeout(() => { timedOut = true; terminate(); }, timeoutMs);
    for (const [stream, key] of [[child.stdout, 'stdout'], [child.stderr, 'stderr']]) {
      stream.setEncoding('utf8');
      stream.on('data', value => {
        if (key === 'stdout') stdout += value; else stderr += value;
        if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > 1_000_000) { stdout = stdout.slice(0, 500_000); stderr = stderr.slice(0, 500_000); overflow = true; terminate(); }
      });
    }
    child.once('error', () => { started = false; finish(null, null); });
    child.once('close', finish);
  });
}

async function main(options) {
  const started = Date.now();
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const report = { passed: false, version: options.version, platform: options.platform, arch: options.arch, source: 'official npm package',
    fixture: 'codexLiveContract', nativeSha256: null, testSummary: null, failure: null,
    scope: 'Unauthenticated local metadata and unmaterialized-history capability only; no model inference or persisted-history validation' };
  let stage = 'HOST_TARGET', privateRoot, tap = '';
  try {
    const target = nativeCodexTarget(options.platform, options.arch);
    assert.equal(process.platform, target.nodePlatform, 'Native proof must run on its target platform');
    assert.equal(process.arch, options.arch, 'Native proof must run on its target architecture');
    stage = 'OFFICIAL_RUNTIME';
    const runtime = await fs.realpath(path.resolve(options.runtime));
    const wrapper = path.join(runtime, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
    const manifest = JSON.parse(await fs.readFile(path.join(runtime, 'node_modules', '@openai', 'codex', 'package.json'), 'utf8'));
    assert.equal(manifest.name, '@openai/codex', 'Expected the official npm package');
    assert.equal(manifest.version, options.version, 'Installed npm package must match the requested version');
    const executable = await fs.realpath(await resolveNpmCodexNativeExecutable(wrapper));
    validateNativeExecutableLayout(executable, wrapper, target);
    const relative = path.relative(runtime, executable);
    assert.ok(relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative), 'Native executable must belong to the installed runtime');
    const handle = await fs.open(executable, 'r');
    try { const bytes = Buffer.alloc(65536); const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0); validateNativeBinaryHeader(bytes.subarray(0, bytesRead), options); }
    finally { await handle.close(); }
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(executable)) hash.update(chunk);
    report.nativeSha256 = hash.digest('hex');
    privateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-native-proof-'));
    await fs.chmod(privateRoot, 0o700);
    const home = path.join(privateRoot, 'codex-home');
    await fs.mkdir(home, { mode: 0o700 });
    const environment = { ...isolatedSmokeEnvironment(process.env, { userData: path.join(privateRoot, 'profile'), codexHome: home,
      unavailableCodex: path.join(privateRoot, 'codex-unavailable') }), CODEX_MESSENGER_TEST_CODEX: executable };
    stage = 'NATIVE_VERSION';
    const version = await runOwnedProcess(executable, ['--version'], { env: environment, cwd: privateRoot, timeoutMs: 5000 });
    assert.ok(version.started && !version.timedOut && !version.overflow && version.code === 0 && version.signal === null, 'Native version process must complete successfully');
    validateNativeVersion(version.stdout, options.version);
    stage = 'LIVE_CONTRACT';
    const live = await runOwnedProcess(process.execPath, ['--test', '--test-reporter=tap', path.join(root, 'tests', 'codexLiveContract.test.mjs')],
      { env: environment, cwd: root, timeoutMs: 40000 });
    tap = redactNativeTap(live.stdout, [runtime, executable, privateRoot, root, os.tmpdir(), os.homedir(), path.resolve(options.report), path.resolve(options.tap)]);
    assert.ok(live.started && !live.timedOut && !live.overflow && live.signal === null, 'Live contract process must complete without timeout or forced termination');
    report.testSummary = validateLiveTap(live.stdout, live.code, options.version);
  } catch { report.failure = stage; }
  finally {
    if (privateRoot) {
      try { await fs.rm(privateRoot, { recursive: true, force: true, maxRetries: 2, retryDelay: 200 }); }
      catch { report.failure ||= 'PRIVATE_PROFILE_CLEANUP'; }
    }
  }
  report.passed = Boolean(report.failure === null && report.testSummary?.pass === 1 && report.testSummary.skipped === 0);
  report.durationMs = Date.now() - started;
  await Promise.all([options.report, options.tap].map(file => fs.mkdir(path.dirname(path.resolve(file)), { recursive: true })));
  await fs.writeFile(options.tap, tap, { mode: 0o600 });
  await fs.writeFile(options.report, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify(report));
  process.exitCode = report.passed ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let watchdog;
  try {
    const options = parseNativeProofArguments(process.argv.slice(2));
    watchdog = setTimeout(() => { console.error('Codex native proof failed (HARD_TIMEOUT).'); process.exit(1); }, 60000);
    await main(options);
  } catch { console.error('Codex native proof failed (ARGUMENTS_OR_REPORT).'); process.exitCode = 1; }
  finally { clearTimeout(watchdog); }
}
