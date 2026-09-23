import test from 'node:test';
import assert from 'node:assert/strict';
import { patchPortableTemplate } from '../scripts/portable-launcher-patch.mjs';
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
