import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { resolve, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import emoticons from '../src/msnEmoticons.js';
import displayPictures from '../src/msnDisplayPictures.js';
import { winkCatalog } from '../src/winks.js';
import { MSN_BACKGROUNDS, MSN_DYNAMIC_BACKGROUNDS, MSN_ALL_BACKGROUNDS, getMsnBackground } from '../src/msnBackgrounds.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicRoot = join(root, 'public');
const asset = (src) => join(publicRoot, src.replace(/^\.\//, ''));
const recordedFile = (file) => join(root, file);
const json = async (path) => JSON.parse(await readFile(path, 'utf8'));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function assertMedia(path) {
  const info = await stat(path);
  assert.ok(info.isFile() && info.size > 0, path);
  const bytes = await readFile(path);
  assert.equal(bytes.length, info.size, path + ': full body is readable');
  const extension = extname(path).toLowerCase();
  if (extension === '.png') assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', path);
  if (extension === '.jpg' || extension === '.jpeg') assert.equal(bytes.subarray(0, 3).toString('hex'), 'ffd8ff', path);
  if (extension === '.gif') assert.match(bytes.subarray(0, 6).toString(), /^GIF8[79]a$/, path);
  if (extension === '.swf') assert.ok(['FWS', 'CWS', 'ZWS'].includes(bytes.subarray(0, 3).toString()), path);
  if (extension === '.mct') assert.equal(bytes.subarray(0, 4).toString(), 'MSCF', path);
  return bytes;
}

function decodeRgba(bytes) {
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  assert.equal(bytes[24], 8); assert.equal(bytes[25], 6); assert.equal(bytes[28], 0);
  const chunks = [];
  for (let offset = 8; offset < bytes.length;) {
    const length = bytes.readUInt32BE(offset), type = bytes.subarray(offset + 4, offset + 8).toString();
    if (type === 'IDAT') chunks.push(bytes.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const filtered = inflateSync(Buffer.concat(chunks)), stride = width * 4;
  assert.equal(filtered.length, (stride + 1) * height);
  const rgba = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = filtered[y * (stride + 1)];
    assert.ok(filter >= 0 && filter <= 4);
    for (let x = 0; x < stride; x++) {
      const position = y * stride + x, left = x >= 4 ? rgba[position - 4] : 0;
      const up = y > 0 ? rgba[position - stride] : 0, upperLeft = y > 0 && x >= 4 ? rgba[position - stride - 4] : 0;
      let prediction = 0;
      if (filter === 1) prediction = left;
      if (filter === 2) prediction = up;
      if (filter === 3) prediction = Math.floor((left + up) / 2);
      if (filter === 4) {
        const p = left + up - upperLeft, a = Math.abs(p - left), b = Math.abs(p - up), c = Math.abs(p - upperLeft);
        prediction = a <= b && a <= c ? left : b <= c ? up : upperLeft;
      }
      rgba[position] = (filtered[y * (stride + 1) + x + 1] + prediction) & 255;
    }
  }
  return { width, height, rgba };
}

test('every active original emoticon, display picture and wink is readable media', async () => {
  assert.ok(emoticons.length >= 5);
  assert.equal(new Set(emoticons.map(item => item.code)).size, emoticons.length);
  assert.equal(displayPictures.length, 11);
  assert.equal(winkCatalog.length, 15);
  for (const catalog of [emoticons, displayPictures, winkCatalog]) {
    assert.equal(new Set(catalog.map(item => item.id)).size, catalog.length);
    for (const item of catalog) {
      await assertMedia(asset(item.src));
      if (item.swf) await assertMedia(asset(item.swf));
    }
  }
});

test('background catalog uses the original media and honest callback support', async () => {
  assert.equal(MSN_BACKGROUNDS.length, 5);
  assert.equal(MSN_DYNAMIC_BACKGROUNDS.length, 4);
  assert.equal(MSN_ALL_BACKGROUNDS.length, 9);
  assert.equal(getMsnBackground('unknown'), null);
  for (const background of MSN_ALL_BACKGROUNDS) {
    assert.equal(getMsnBackground(background.id), background);
    await assertMedia(asset(background.src));
    if (background.kind === 'dynamic') {
      assert.equal(background.runtimeSupported, false);
      assert.ok(background.reason);
      assert.equal(background.src, background.poster);
      for (const key of ['poster', 'backgroundSrc', 'animationSrc', 'sourceArchive']) await assertMedia(asset(background[key]));
    } else assert.equal(background.runtimeSupported, true);
  }
});

test('42 preserved exports and 79 classic icons match original pixels and Microsoft labels', async () => {
  const main = await json(join(publicRoot, 'msn-assets/msn75/manifest.json'));
  const named = await json(join(publicRoot, 'msn-assets/msn75/emoticons/manifest.json'));
  assert.equal(main.emoticonCount, 42);
  assert.equal(main.emoticons.length, 42);
  assert.equal(named.count, 42);
  assert.equal(named.items.length, 42);
  assert.deepEqual(main.emoticons.map(item => item.src).sort(), named.items.map(item => item.src).sort());
  const pngFiles = (await readdir(join(publicRoot, 'msn-assets/msn75/emoticons'))).filter(file => file.endsWith('.png'));
  assert.equal(pngFiles.length, 42);
  for (const item of named.items) {
    assert.ok(main.emoticons.some(record => record.src === item.src && record.frame === item.frame));
    await assertMedia(asset(item.src));
  }
  const classic = await json(join(publicRoot, 'msn-assets/msn75/emoticons-classic/manifest.json'));
  assert.equal(classic.count, 79); assert.equal(classic.items.length, 79);
  const stripBytes = await readFile(recordedFile(classic.sourceResource));
  assert.equal(hash(stripBytes), '066a0f046032e3b9a1c889e31d4d1950683e1cd9fedce51894f6dbce6491852f');
  assert.equal(hash(stripBytes), classic.sourceSha256);
  const strip = decodeRgba(stripBytes);
  assert.deepEqual([strip.width, strip.height], [1501, 19]);
  assert.equal(hash(strip.rgba), classic.sourceRgbaSha256);
    const tableStrings = new Map();
  for (const table of classic.sourceStringTables) {
    const bytes = await readFile(recordedFile(table.sourceFile));
    assert.equal(bytes.length, table.size); assert.equal(hash(bytes), table.sha256);
    const strings = []; let offset = 0;
    for (let index = 0; index < 16; index++) {
      const units = bytes.readUInt16LE(offset); offset += 2;
      strings.push(bytes.subarray(offset, offset + units * 2).toString('utf16le')); offset += units * 2;
    }
    tableStrings.set(table.sourceFile, strings);
  }
  for (const item of classic.items) {
    const bytes = await assertMedia(recordedFile(item.file));
    assert.equal(bytes.length, item.size); assert.equal(hash(bytes), item.sha256);
    assert.ok(item.label && item.sourceStringId === 46000 + item.index);
    assert.equal(item.label, tableStrings.get(item.sourceFile)[item.sourceStringIndex]);
    const tile = decodeRgba(bytes), expected = Buffer.alloc(19 * 19 * 4);
    assert.deepEqual([tile.width, tile.height], [19, 19]);
    for (let row = 0; row < 19; row++) {
      const start = (row * strip.width + item.index * 19) * 4;
      strip.rgba.copy(expected, row * 19 * 4, start, start + 19 * 4);
    }
    assert.deepEqual(tile.rgba, expected, item.file + ': exact original RGBA crop');
    assert.equal(hash(tile.rgba), item.rgbaSha256);
  }
});

test('all 16 decoded dynamic-background members match their SHA256 and size', async () => {
  const manifest = await json(join(publicRoot, 'msn-assets/msn75/packages/dynamic-backgrounds/extracted-manifest.json'));
  assert.equal(manifest.count, 16);
  assert.equal(manifest.items.length, 16);
  for (const record of manifest.items) {
    const bytes = await assertMedia(recordedFile(record.file));
    assert.equal(bytes.length, record.size, record.file);
    assert.equal(hash(bytes), record.sha256, record.file);
  }
});

test('all 68 preserved package members and 8 bundled Ruffle files match original hashes', async () => {
  const packages = await json(join(publicRoot, 'msn-assets/msn75/packages/manifest.json'));
  assert.equal(packages.count, 68);
  assert.equal(packages.items.length, 68);
  for (const record of packages.items) {
    const bytes = await assertMedia(recordedFile(record.file));
    assert.equal(bytes.length, record.size, record.file);
    assert.equal(hash(bytes), record.sha256, record.file);
  }
  const runtimeBase = join(publicRoot, 'msn-assets/ruffle/0.6.0');
  const runtime = await json(join(runtimeBase, 'manifest.json'));
  assert.equal(runtime.version, '0.6.0');
  assert.equal(runtime.files.length, 8);
  for (const record of runtime.files) {
    const bytes = await readFile(join(runtimeBase, record.file));
    assert.equal(bytes.length, record.size, record.file);
    assert.equal(hash(bytes), record.sha256, record.file);
  }
});

test('literal asset references and the isolated-player documents are present', async () => {
  const sourceDir = join(root, 'src');
  for (const file of await readdir(sourceDir)) {
    if (!/\.(?:js|jsx|css)$/.test(file)) continue;
    const source = await readFile(join(sourceDir, file), 'utf8');
    for (const match of source.matchAll(/["'`](\.\/msn-assets\/[^"'`$]+\.(?:png|jpe?g|gif|swf|wav))["'`]/g)) await assertMedia(asset(match[1]));
  }
  const adapterBase = join(publicRoot, 'msn-assets/flash-player');
  assert.ok((await readFile(join(adapterBase, 'index.html'), 'utf8')).includes('player.js'));
  const script = await readFile(join(adapterBase, 'player.js'), 'utf8');
  for (const wink of winkCatalog) assert.ok(script.includes(wink.swf.replace('./msn-assets/msn75/', '')));
  for (const background of MSN_DYNAMIC_BACKGROUNDS) assert.ok(script.includes(background.animationSrc.replace('./msn-assets/msn75/', '')));
});
