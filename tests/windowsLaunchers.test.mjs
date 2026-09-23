import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('Windows PowerShell launchers preserve installation identity, safe deletion and child exit codes', {
  skip: process.platform !== 'win32' ? 'Requires native Windows PowerShell; run by the Windows release lane.' : false,
  timeout: 120_000,
}, () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    fileURLToPath(new URL('./windows-launchers.test.ps1', import.meta.url))], {
    cwd: root, encoding: 'utf8', timeout: 110_000, windowsHide: true,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /Windows launcher fixtures: \d+ passed, 0 failed/);
});
