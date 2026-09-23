import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { AsarPackager } = require('app-builder-lib/out/asar/asarUtil.js');
const { getFileMatchers } = require('app-builder-lib/out/fileMatcher.js');
const asar = require('@electron/asar');
const projectRoot = fileURLToPath(new URL('../', import.meta.url));

test('Windows ICO assets retain their original bytes outside ASAR while PNG and JavaScript remain archived', async t => {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'asar-icon-packaging-'));
  t.after(() => fs.rm(fixture, { recursive: true, force: true }));
  const appDir = path.join(fixture, 'app');
  const resourcePath = path.join(fixture, 'resources');
  const defaultDestination = path.join(resourcePath, 'app');
  const iconNames = ['public/icons/codex-messenger.ico', 'public/icons/codex-messenger-people.ico'];
  const packedNames = ['public/icons/codex-messenger-people-256.png', 'electron/fixture.js'];
  const originalBytes = new Map();
  for (const name of [...iconNames, packedNames[0]]) {
    originalBytes.set(name, await fs.readFile(path.join(projectRoot, name)));
  }
  originalBytes.set(packedNames[1], Buffer.from('export const archived = true;\n'));
  for (const [name, bytes] of originalBytes) {
    const destination = path.join(appDir, name);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, bytes);
  }
  await fs.mkdir(resourcePath);
  const config = JSON.parse(await fs.readFile(path.join(projectRoot, 'package.json'), 'utf8')).build;
  assert.notEqual(config.asar, false, 'the production application uses ASAR packaging');
  // Use the same matcher and packager as platformPackager.copyAppFiles, including Windows overrides.
  const matchers = getFileMatchers(config, 'asarUnpack', defaultDestination, {
    macroExpander: value => value,
    customBuildOptions: config.win,
    globalOutDir: path.join(fixture, 'output'),
    defaultSrc: appDir
  });
  const files = [...originalBytes.keys()].map(name => path.join(appDir, name));
  const metadata = new Map(await Promise.all(files.map(async file => [file, await fs.stat(file)])));
  await new AsarPackager({ info: { getWorkspaceRoot: async () => appDir } }, {
    defaultDestination,
    resourcePath,
    options: typeof config.asar === 'object' ? config.asar : {},
    unpackPattern: matchers?.[0].createFilter()
  }).pack([{ src: appDir, destination: defaultDestination, files, metadata }]);

  const archive = path.join(resourcePath, 'app.asar');
  for (const [name, bytes] of originalBytes) {
    assert.deepEqual(asar.extractFile(archive, name), bytes, `${name} is readable through ASAR with unchanged bytes`);
    const shouldBeUnpacked = iconNames.includes(name);
    assert.equal(Boolean(asar.statFile(archive, name).unpacked), shouldBeUnpacked,
      `${name} must ${shouldBeUnpacked ? 'be available as a real ICO file' : 'remain in the archive'}`);
    const unpackedFile = path.join(archive + '.unpacked', name);
    if (shouldBeUnpacked) {
      assert.deepEqual(await fs.readFile(unpackedFile), bytes, `${name} has unchanged bytes in the real unpacked file`);
    } else {
      await assert.rejects(fs.stat(unpackedFile), { code: 'ENOENT' });
    }
  }
});
