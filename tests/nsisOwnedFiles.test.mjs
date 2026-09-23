import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import afterPack, { createNsisPayloadManifest, renderNsisPayloadManifest } from '../scripts/nsis-owned-files.mjs';

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-messenger-nsis-manifest-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const app = path.join(dir, 'app'), build = path.join(dir, 'build');
  await fs.mkdir(path.join(app, 'resources', 'app.asar.unpacked', 'nested'), { recursive: true });
  await fs.mkdir(path.join(app, 'locales')); await fs.mkdir(build);
  await fs.writeFile(path.join(app, 'Codex Messenger.exe'), 'fixture');
  await fs.writeFile(path.join(app, 'resources', 'app.asar'), 'fixture');
  await fs.writeFile(path.join(app, 'resources', 'app.asar.unpacked', 'nested', 'cost$5.wasm'), 'fixture');
  await fs.writeFile(path.join(app, 'locales', 'new-language.pak'), 'fixture');
  return { dir, app, build };
}

test('NSIS ownership comes from every actual payload entry, including future locales and nested unpacked files', async (t) => {
  const f = await fixture(t); const manifest = await createNsisPayloadManifest(f.app, 'Codex Messenger');
  assert.ok(manifest.files.includes('locales\\new-language.pak'));
  assert.ok(manifest.files.includes('resources\\app.asar.unpacked\\nested\\cost$5.wasm'));
  assert.ok(manifest.directories.includes('resources\\app.asar.unpacked\\nested'));
  assert.ok(manifest.files.includes('Uninstall Codex Messenger.exe'));
  const include = renderNsisPayloadManifest(manifest);
  assert.ok(include.includes('cost$$5.wasm')); assert.ok(include.includes('new-language.pak'));
  assert.equal(include.includes('*'), false); assert.equal(include.includes('user-project.txt'), false);
});

test('NSIS ownership rejects incomplete packages and linked payload entries before replacing the generated include', async (t) => {
  const f = await fixture(t);
  await assert.rejects(createNsisPayloadManifest(f.app, 'missing product'), /incomplete/);
  await assert.rejects(createNsisPayloadManifest(f.app, '../unsafe'), /Unsafe/);
  if (process.platform === 'win32') await fs.symlink(f.build, path.join(f.app, 'linked'), 'junction');
  else await fs.symlink(f.build, path.join(f.app, 'linked'));
  const generated = path.join(f.build, 'installer-files.generated.nsh');
  await fs.writeFile(generated, 'previous manifest');
  await assert.rejects(afterPack({ electronPlatformName: 'win32', appOutDir: f.app,
    packager: { appInfo: { productFilename: 'Codex Messenger' }, info: { buildResourcesDir: f.build } } }), /linked/);
  assert.equal(await fs.readFile(generated, 'utf8'), 'previous manifest');
});

test('afterPack writes a deterministic NSIS include for Windows and leaves other platforms untouched', async (t) => {
  const f = await fixture(t); const context = { electronPlatformName: 'win32', appOutDir: f.app,
    packager: { appInfo: { productFilename: 'Codex Messenger' }, info: { buildResourcesDir: f.build } } };
  await afterPack(context); const generated = path.join(f.build, 'installer-files.generated.nsh');
  const expected = renderNsisPayloadManifest(await createNsisPayloadManifest(f.app, 'Codex Messenger'));
  assert.equal(await fs.readFile(generated, 'utf8'), expected);
  await afterPack(context); assert.equal(await fs.readFile(generated, 'utf8'), expected);
  await afterPack({ electronPlatformName: 'darwin' }); assert.equal(await fs.readFile(generated, 'utf8'), expected);
  assert.deepEqual(await fs.readdir(f.build), ['installer-files.generated.nsh']);
});
