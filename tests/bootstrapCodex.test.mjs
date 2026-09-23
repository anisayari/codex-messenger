import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureInstalled } from '../scripts/bootstrap-codex-env.mjs';

test('setup updates an unsupported CLI and verifies the installed version', async () => {
  let installed = false;
  const found = { command: 'isolated CLI' };
  const result = await ensureInstalled({ resolve: async () => found, versionOf: async () => installed ? 'codex-cli 0.156.1' : 'codex-cli 0.125.0',
    npmOf: async () => ({ ok: true }), install: async () => { installed = true; } });
  assert.equal(installed, true);
  assert.equal(result, found);
});

test('setup avoids installation and login for an already supported CLI', async () => {
  const found = { command: 'supported CLI' };
  assert.equal(await ensureInstalled({ resolve: async () => found, versionOf: async () => 'codex-cli 0.156.1',
    npmOf: async () => { throw new Error('unexpected npm lookup'); }, install: async () => { throw new Error('unexpected install'); } }), found);
});

test('setup reports failed install and stale explicit CLI instead of claiming readiness', async () => {
  const deps = { resolve: async () => ({ command: 'old explicit CLI' }), versionOf: async () => 'codex-cli 0.125.0', npmOf: async () => ({ ok: true }) };
  await assert.rejects(ensureInstalled({ ...deps, install: async () => { throw new Error('installation failed'); } }), /installation failed/);
  await assert.rejects(ensureInstalled({ ...deps, install: async () => {} }), /Select the updated CLI path/);
});
