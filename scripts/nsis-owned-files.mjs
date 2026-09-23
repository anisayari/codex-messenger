import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

function nsisLiteral(value) {
  assert.ok(typeof value === 'string' && value && !/["\r\n\0]/.test(value), 'Unsafe NSIS payload path');
  return value.replaceAll('$', () => '$$');
}

export async function createNsisPayloadManifest(appOutDir, productFilename) {
  assert.ok(path.isAbsolute(appOutDir), 'Packaged app directory must be absolute');
  assert.ok(productFilename && !/[\\/:"\r\n\0]/.test(productFilename), 'Unsafe product filename');
  assert.ok((await fs.lstat(appOutDir)).isDirectory(), 'Packaged app directory is missing');
  const files = new Set();
  const directories = new Set();
  async function visit(relative = '') {
    for (const name of await fs.readdir(path.join(appOutDir, ...relative.split('\\')))) {
      assert.ok(name !== '.' && name !== '..' && !/[\\/:"\r\n\0]/.test(name), 'Unsafe packaged filename');
      const entry = relative ? `${relative}\\${name}` : name;
      const native = path.join(appOutDir, ...entry.split('\\'));
      const stat = await fs.lstat(native);
      assert.ok(!stat.isSymbolicLink(), 'NSIS payload must not contain linked files or directories');
      if (stat.isDirectory()) { directories.add(entry); await visit(entry); }
      else { assert.ok(stat.isFile(), 'NSIS payload must contain only regular files'); files.add(entry); }
    }
  }
  await visit();
  assert.ok(files.has(`${productFilename}.exe`) && files.has('resources\\app.asar'), 'Packaged Electron application is incomplete');
  // These files are added by the NSIS target after afterPack, rather than by Electron packing.
  files.add(`Uninstall ${productFilename}.exe`);
  files.add('uninstallerIcon.ico');
  files.add('resources\\elevate.exe');
  files.add('resources\\app-update.yml');
  const sorted = (values) => [...values].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  return { files: sorted(files), directories: sorted(directories) };
}

export function renderNsisPayloadManifest(manifest) {
  return [
    '; Generated from this build\'s exact Windows Electron payload. Do not edit.',
    '!macro CM_CHECK_PAYLOAD_ENTRY',
    ...manifest.files.map((entry) => `  StrCmp $cmGuardEntry "${nsisLiteral(entry)}" cm_entry_file`),
    ...manifest.directories.map((entry) => `  StrCmp $cmGuardEntry "${nsisLiteral(entry)}" cm_entry_directory`),
    '!macroend', ''
  ].join('\n');
}

export default async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const manifest = await createNsisPayloadManifest(context.appOutDir, context.packager.appInfo.productFilename);
  const destination = path.join(context.packager.info.buildResourcesDir, 'installer-files.generated.nsh');
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, renderNsisPayloadManifest(manifest), { flag: 'wx', mode: 0o600 });
    await fs.rename(temporary, destination);
  } catch (error) { await fs.unlink(temporary).catch(() => {}); throw error; }
}
