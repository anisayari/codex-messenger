import test from 'node:test';
import assert from 'node:assert/strict';
import { patchPortableTemplate } from '../scripts/portable-launcher-patch.mjs';

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
