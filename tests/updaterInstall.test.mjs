import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { createUpdateService, runUpdateCommand } from '../electron/updateService.js';
import { selectFrontReleaseAsset } from '../shared/updateAssets.js';

async function fixture(t, options = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-messenger-update-install-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const bytes = Buffer.from('isolated installer fixture; never executed');
  const sha = createHash('sha256').update(bytes).digest('hex');
  const asset = { name: options.assetName || 'Codex-Messenger-0.0.4-x64.exe', size: bytes.length,
    digest: `sha256:${sha}`, browser_download_url: 'https://github.com/anisayari/codex-messenger/releases/download/v0.0.4/fixture' };
  const release = { tag_name: 'v0.0.4', draft: false, prerelease: false, assets: [asset] };
  const events = [], launched = [], revealed = [], opened = [], metadataUrls = [];
  let quits = 0, downloads = 0;
  const service = createUpdateService({
    app: { isPackaged: true, getVersion: () => '0.0.3', getPath: () => dir },
    shell: { showItemInFolder: (p) => revealed.push(p), openPath: async (p) => { opened.push(p); return ''; } },
    defaultCwd: () => dir, codexStatus: async () => ({ ok: true, version: '0.156.1' }),
    runCodexCommand: async () => ({ stdout: 'codex-cli 0.156.1', stderr: '' }),
    quitApplication: () => { quits++; }, scheduleQuit: (callback) => callback(),
    sendProgress: (event) => events.push(event), platform: 'win32', arch: 'x64',
    executablePath: path.join(dir, 'installed', 'Codex Messenger.exe'),
    fetchJsonImpl: async (url) => { metadataUrls.push(url); return url.includes('npmjs.org') ? { version: '0.156.1' } : release; },
    downloadFileImpl: async (_url, target) => { downloads++; await fs.writeFile(target, bytes); return { path: target, bytes: bytes.length, sha256: sha }; },
    runCommandImpl: async () => ({ stdout: '', stderr: '' }),
    launchInstallerImpl: async (...args) => launched.push(args),
    ...options
  });
  return { service, release, events, launched, revealed, opened, metadataUrls, get quits() { return quits; }, get downloads() { return downloads; } };
}

test('front update checks never advertise an unpublished branch when release lookup fails or is not stable', async (t) => {
  const f = await fixture(t);
  for (const invalid of [{ ...f.release, draft: true }, { ...f.release, prerelease: true }, { ...f.release, assets: [] }]) {
    const g = await fixture(t, { fetchJsonImpl: async (url) => url.includes('npmjs.org') ? { version: '0.156.1' } : invalid });
    const result = await g.service.checkUpdates({ force: true });
    assert.equal(result.front.updateAvailable, false); assert.equal(result.front.latestVersion, '');
    assert.match(result.front.error, /published stable release/);
  }
  const urls = [];
  const g = await fixture(t, { fetchJsonImpl: async (url) => { urls.push(url); if (url.includes('npmjs.org')) return { version: '0.156.1' }; throw Error('release API unavailable'); } });
  const result = await g.service.checkUpdates({ force: true });
  assert.equal(result.front.updateAvailable, false); assert.equal(result.front.latestVersion, '');
  assert.match(result.front.error, /release API unavailable/);
  assert.equal(urls.some((url) => url.includes('raw.githubusercontent.com') || url.includes('/main/')), false);
});

test('installer selection rejects the wrong Mac architecture and accepts an explicitly universal DMG', () => {
  const item = (name) => ({ name, browser_download_url: `https://github.com/${name}` });
  const arm = item('Codex-Messenger-0.0.4-arm64.dmg');
  assert.equal(selectFrontReleaseAsset({ assets: [arm] }, { platform: 'darwin', arch: 'x64' }), null);
  assert.equal(selectFrontReleaseAsset({ assets: [item('notx64-compatible.dmg'), arm] }, { platform: 'darwin', arch: 'x64' }), null);
  const intel = item('Codex-Messenger-0.0.4-x64.dmg'), universal = item('Codex-Messenger-0.0.4-universal.dmg');
  assert.equal(selectFrontReleaseAsset({ assets: [arm, universal, intel] }, { platform: 'darwin', arch: 'x64' }), intel);
  assert.equal(selectFrontReleaseAsset({ assets: [universal] }, { platform: 'darwin', arch: 'arm64' }), universal);
  assert.equal(selectFrontReleaseAsset({ assets: [universal] }, { platform: 'darwin', arch: 'ia32' }), null);
});

test('concurrent apply requests verify and schedule only one installer, and block a parallel download', async (t) => {
  let releaseVerify;
  const gate = new Promise((resolve) => { releaseVerify = resolve; });
  let verifications = 0;
  const f = await fixture(t, { verifyFileImpl: async () => { verifications++; await gate; } });
  await f.service.installFrontUpdate();
  const first = f.service.applyPendingFrontUpdate();
  assert.equal(f.service.applyPendingFrontUpdate(), first);
  assert.equal(f.service.installFrontUpdate(), first);
  assert.equal(verifications, 1); assert.equal(f.launched.length, 0);
  assert.equal(f.events.some((e) => e.quitStarted), false);
  releaseVerify(); const result = await first;
  assert.equal(result.quitStarted, true); assert.equal(f.launched.length, 1); assert.equal(f.quits, 1); assert.equal(f.downloads, 1);
  assert.equal(f.service.hasPendingFrontUpdate(), false);
  assert.equal(f.events.at(-1).phase, 'restarting');
  await assert.rejects(f.service.applyPendingFrontUpdate(), /prête|prete/);
});

test('a failed installer launch preserves the verified pending update and permits a single retry', async (t) => {
  let fail = true, attempts = 0;
  const f = await fixture(t, { launchInstallerImpl: async () => { attempts++; if (fail) throw Error('fixture launch failed'); } });
  await f.service.installFrontUpdate();
  await assert.rejects(f.service.applyPendingFrontUpdate(), /fixture launch failed/);
  assert.equal(f.service.hasPendingFrontUpdate(), true); assert.equal(f.quits, 0);
  assert.equal(f.events.some((e) => e.quitStarted), false);
  fail = false; assert.equal((await f.service.applyPendingFrontUpdate()).quitStarted, true);
  assert.equal(attempts, 2); assert.equal(f.quits, 1);
});

test('unsigned Windows updates reveal the digest-verified installer without launching it or quitting', async (t) => {
  const f = await fixture(t, { runCommandImpl: async () => { throw Error('unsigned fixture'); } });
  const download = await f.service.installFrontUpdate();
  const result = await f.service.applyPendingFrontUpdate();
  assert.equal(result.manualInstall, true); assert.equal(result.quitStarted, false); assert.equal(result.needsRestart, false);
  assert.deepEqual(f.revealed, [download.filePath]); assert.equal(f.launched.length, 0); assert.equal(f.quits, 0);
  assert.equal(f.events.some((e) => e.quitStarted), false); assert.equal(f.events.at(-1).manualInstall, true);
  assert.equal(f.events.at(-1).phase, 'ready');
});

test('tampered pending downloads cannot reach Windows manual installation or signature checks', async (t) => {
  let checks = 0;
  const f = await fixture(t, { runCommandImpl: async () => { checks++; throw Error('unsigned fixture'); } });
  const download = await f.service.installFrontUpdate(); await fs.writeFile(download.filePath, 'tampered');
  await assert.rejects(f.service.applyPendingFrontUpdate(), /checksum/);
  assert.equal(checks, 0); assert.equal(f.revealed.length, 0); assert.equal(f.quits, 0);
});

test('unsigned packaged Mac updates open the verified DMG and finish with an explicit manual result', async (t) => {
  const f = await fixture(t, { platform: 'darwin', arch: 'arm64', assetName: 'Codex-Messenger-0.0.4-arm64.dmg',
    executablePath: '/Fixture/Codex Messenger.app/Contents/MacOS/Codex Messenger', runCommandImpl: async () => { throw Error('unsigned fixture'); } });
  const download = await f.service.installFrontUpdate(); const result = await f.service.applyPendingFrontUpdate();
  assert.equal(result.manualInstall, true); assert.equal(result.quitStarted, false); assert.equal(result.needsRestart, false);
  assert.deepEqual(f.opened, [download.filePath]); assert.equal(f.quits, 0); assert.equal(f.launched.length, 0);
  assert.equal(f.events.at(-1).phase, 'ready'); assert.equal(f.events.at(-1).quitStarted, false);
});

test('updater command execution handles an absolute npm path containing spaces and an adjacent Node outside PATH', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex messenger npm fixture '));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const command = path.join(dir, process.platform === 'win32' ? 'npm.cmd' : 'npm');
  if (process.platform === 'win32') await fs.writeFile(command, '@echo off\r\necho portable npm fixture\r\n');
  else {
    await fs.writeFile(command, '#!/usr/bin/env node\n// isolated fixture\n', { mode: 0o700 });
    await fs.writeFile(path.join(dir, 'node'), '#!/bin/sh\nprintf "portable npm fixture\\n"\n', { mode: 0o700 });
  }
  const output = await runUpdateCommand(command, ['--version'], { env: { ...process.env, PATH: process.platform === 'win32' ? process.env.SystemRoot : '/usr/bin:/bin' }, timeoutMs: 5000 });
  assert.equal(output.stdout.trim(), 'portable npm fixture');
});

test('manual restart results release the hook busy state and replace optimistic restart progress', async () => {
  let source = await fs.readFile(new URL('../src/useUpdates.js', import.meta.url), 'utf8');
  source = source.replace(/^import[^\n]*\n/, '').replace('export function useUpdates', 'function useUpdates');
  for (const manualInstall of [true, false]) {
    const states = []; let index = 0;
    const context = vm.createContext({ useState: (value) => { const slot = index++; states[slot] = value; return [value, (next) => { states[slot] = typeof next === 'function' ? next(states[slot]) : next; }]; },
      useEffect: () => {}, useRef: (current) => ({ current }), result: { ok: true, manualInstall, quitStarted: false, needsRestart: false, message: 'manual operation complete' } });
    vm.runInContext(source + '\nglobalThis.hook=useUpdates({api:{restartForUpdate:async()=>result}});', context);
    assert.equal((await context.hook.restartForUpdate('front')).quitStarted, false);
    assert.equal(states[3], ''); assert.equal(states[4], 'manual operation complete');
    assert.equal(states[5].phase, 'ready'); assert.equal(states[5].quitStarted, false); assert.equal(states[5].manualInstall, manualInstall);
  }
});
