import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

// electron-builder 26.15.3 has no portable custom-script option. Apply the small
// upstream-template correction before invoking its CLI; refuse an unknown template.
const original = '\tExecWait "$INSTDIR\\${APP_EXECUTABLE_FILENAME} $R0" $0\n  SetErrorLevel $0';
const corrected = ['  ClearErrors', '  StrCpy $0 1', '  ExecWait \'"$INSTDIR\\${APP_EXECUTABLE_FILENAME}" $R0\' $0',
  '  IfErrors 0 +2', '  StrCpy $0 1', '  SetErrorLevel $0'].join('\n');

export function patchPortableTemplate(source) {
  if (source.includes(corrected)) {
    assert.equal(source.split(corrected).length, 2, 'Ambiguous portable launcher patch');
    assert.ok(!source.includes(original), 'Mixed portable launcher templates');
    return source;
  }
  assert.equal(source.split(original).length, 2, 'Unknown portable launch template; review the upstream change before packaging');
  return source.replace(original, corrected);
}

export async function preparePortableLauncher(root) {
  // In 26.15.3, false generates one fixed unpack directory per EXE. true keeps
  // $PLUGINSDIR\app private to each execution, including concurrent launches.
  const config = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  assert.equal(config.build?.portable?.unpackDirName, true, 'Portable builds must use a new private extraction directory for each launch');
  const directory = path.join(root, 'node_modules', 'app-builder-lib');
  const installed = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'));
  const lock = JSON.parse(await fs.readFile(path.join(root, 'package-lock.json'), 'utf8'));
  assert.equal(installed.version, lock.packages['node_modules/app-builder-lib'].version, 'Packaging dependencies must match the lockfile');
  const file = path.join(directory, 'templates', 'nsis', 'portable.nsi');
  const source = await fs.readFile(file, 'utf8');
  const patched = patchPortableTemplate(source);
  if (source !== patched) await fs.writeFile(file, patched);
}
