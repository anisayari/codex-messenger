import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { diagnosticEnvironments, measureProbe } from '../scripts/windows-powershell-diagnostics.mjs';

test('PowerShell diagnostic modes preserve only the requested module environment and keep Messenger profiles isolated', () => {
  const root = 'C:\\Users\\runner\\AppData\\Local\\Temp\\probe';
  const original = { APPDATA: 'C:\\Users\\runner\\AppData\\Roaming', LOCALAPPDATA: 'C:\\Users\\runner\\AppData\\Local',
    PSModulePath: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules', OPENAI_API_KEY: 'private-key' };
  const [native, folders, modules] = diagnosticEnvironments(root, original);
  assert.equal(native.environment.PSModulePath, original.PSModulePath);
  assert.equal(folders.environment.APPDATA, original.APPDATA); assert.equal(folders.environment.LOCALAPPDATA, original.LOCALAPPDATA);
  assert.equal(Object.hasOwn(folders.environment, 'PSModulePath'), false); assert.equal(Object.hasOwn(folders.environment, 'OPENAI_API_KEY'), false);
  assert.equal(modules.environment.APPDATA, root + '\\appdata'); assert.equal(modules.environment.LOCALAPPDATA, root + '\\localappdata');
  assert.equal(modules.environment.PSModulePath, original.PSModulePath); assert.equal(Object.hasOwn(modules.environment, 'OPENAI_API_KEY'), false);
  for (const mode of [native, folders, modules]) {
    assert.equal(mode.environment.CODEX_MESSENGER_USER_DATA_DIR, root + '\\profile');
    assert.equal(mode.environment.CODEX_HOME, root + '\\codex-home');
    assert.equal(mode.environment.CODEX_MESSENGER_CODEX_PATH, root + '\\codex-unavailable');
  }
});

test('diagnostic command outcomes use actual child exits and public markers without preserving private stdout or stderr', async () => {
  const actual = await measureProbe(process.execPath, ['-e', "process.stdout.write('PUBLIC_MARKER');process.stderr.write('/private/secret');"], process.env, 'PUBLIC_MARKER');
  assert.equal(actual.outcome, 'PASS'); assert.equal(actual.exitCode, 0); assert.equal(actual.markerObserved, true); assert.equal(actual.stderrPresent, true);
  assert.equal(JSON.stringify(actual).includes('/private/secret'), false);
  const failed = await measureProbe(process.execPath, ['-e', "process.stdout.write('/private/secret');process.exit(7);"], process.env, 'PUBLIC_MARKER');
  assert.equal(failed.outcome, 'FAILED_EXIT'); assert.equal(failed.exitCode, 7); assert.equal(JSON.stringify(failed).includes('/private/secret'), false);
  const wrongOutput = await measureProbe(process.execPath, ['-e', "process.stdout.write('/private/secret');"], process.env, 'PUBLIC_MARKER');
  assert.equal(wrongOutput.outcome, 'UNEXPECTED_OUTPUT'); assert.equal(wrongOutput.markerObserved, false);
});

test('stalled diagnostic commands are bounded, forcibly stop only their owned process and produce no fabricated pass', async () => {
  let owned;
  const startedAt = Date.now();
  const actual = await measureProbe(process.execPath, ['-e', 'setInterval(()=>{},1000);'], process.env, 'PUBLIC_MARKER', {
    timeoutMs: 50, launch: (...args) => { owned = spawn(...args); return owned; }
  });
  assert.equal(actual.outcome, 'TIMEOUT'); assert.equal(actual.timedOut, true); assert.equal(actual.forced, true); assert.equal(actual.markerObserved, false);
  assert.ok(Date.now() - startedAt < 2500);
  if (owned.exitCode === null && owned.signalCode === null) await new Promise(resolve => owned.once('exit', resolve));
  assert.ok(owned.exitCode !== null || owned.signalCode !== null);
});
