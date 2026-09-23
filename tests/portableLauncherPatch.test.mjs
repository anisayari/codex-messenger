import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { patchPortableTemplate, preparePortableLauncher } from '../scripts/portable-launcher-patch.mjs';
import { needsPortableLauncherPatch } from '../scripts/electron-builder-release-version.mjs';

test('portable patch also covers configured Windows defaults and builder aliases', () => {
  for (const args of [[], ['--win'], ['--windows'], ['-w'], ['--win=portable'], ['-w=portable'], ['portable']]) {
    assert.equal(needsPortableLauncherPatch(args, 'win32'), true);
    if (args.length) assert.equal(needsPortableLauncherPatch(args, 'darwin'), true);
  }
  assert.equal(needsPortableLauncherPatch(['--mac', 'dmg'], 'darwin'), false);
  assert.equal(needsPortableLauncherPatch(['--linux', 'AppImage'], 'linux'), false);
});

test('portable packaging quotes the actual executable, checks creation failure and keeps the real child exit code', () => {
  const source = 'Section\n\tExecWait "$INSTDIR\\${APP_EXECUTABLE_FILENAME} $R0" $0\n  SetErrorLevel $0\nSectionEnd';
  const patched = patchPortableTemplate(source);
  assert.ok(patched.includes('ExecWait \'"$INSTDIR\\${APP_EXECUTABLE_FILENAME}" $R0\' $0'));
  assert.ok(patched.includes('ClearErrors\n  StrCpy $0 1'));
  assert.ok(patched.includes('IfErrors 0 +2\n  StrCpy $0 1\n  SetErrorLevel $0'));
  assert.equal(patchPortableTemplate(patched), patched);
  assert.throws(() => patchPortableTemplate(source + source), /Unknown/);
  assert.throws(() => patchPortableTemplate('unknown upstream template'), /Unknown/);
});

async function preparationFixture(t, unpackDirName) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'portable-preparation-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dependency = path.join(root, 'node_modules', 'app-builder-lib');
  const template = path.join(dependency, 'templates', 'nsis', 'portable.nsi');
  await fs.mkdir(path.dirname(template), { recursive: true });
  const source = 'Section\n\tExecWait "$INSTDIR\\${APP_EXECUTABLE_FILENAME} $R0" $0\n  SetErrorLevel $0\nSectionEnd';
  await Promise.all([
    fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ build: { portable: { unpackDirName } } })),
    fs.writeFile(path.join(root, 'package-lock.json'), JSON.stringify({ packages: { 'node_modules/app-builder-lib': { version: '26.15.3' } } })),
    fs.writeFile(path.join(dependency, 'package.json'), JSON.stringify({ version: '26.15.3' })),
    fs.writeFile(template, source)
  ]);
  return { root, template, source };
}

test('portable preparation refuses shared or unspecified extraction before changing the vendor template', async t => {
  for (const shared of [false, 'fixed-product-folder', undefined]) {
    const fixture = await preparationFixture(t, shared);
    await assert.rejects(preparePortableLauncher(fixture.root), /new private extraction directory for each launch/);
    assert.equal(await fs.readFile(fixture.template, 'utf8'), fixture.source);
  }
});

test('portable preparation patches an isolated launch configuration and remains idempotent', async t => {
  const fixture = await preparationFixture(t, true);
  await preparePortableLauncher(fixture.root);
  const patched = await fs.readFile(fixture.template, 'utf8');
  assert.equal(patched, patchPortableTemplate(fixture.source));
  await preparePortableLauncher(fixture.root);
  assert.equal(await fs.readFile(fixture.template, 'utf8'), patched);
});
