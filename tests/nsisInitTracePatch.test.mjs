import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { patchNsisInitTraceTemplate, prepareNsisInitTrace, nsisInitTraceTemplates,
  nsisInitTraceBuilderVersion } from '../scripts/nsis-init-trace-patch.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const digest = source => createHash('sha256').update(source).digest('hex');
const removeTrace = source => source.replace(/^ *!insertmacro CM_INIT_TRACE [A-Z0-9_]+\n/gm, '');

async function originals() {
  return Object.fromEntries(await Promise.all(Object.keys(nsisInitTraceTemplates).map(async name => {
    const source = await fs.readFile(path.join(root, 'node_modules/app-builder-lib/templates/nsis', ...name.split('/')), 'utf8');
    const original = removeTrace(source);
    assert.equal(digest(original), nsisInitTraceTemplates[name].originalSha256);
    return [name, original];
  })));
}

async function fixture(task) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'nsis-init-trace-test-'));
  const values = await originals();
  const dependency = path.join(temporary, 'node_modules/app-builder-lib');
  try {
    await fs.mkdir(dependency, { recursive: true });
    await fs.writeFile(path.join(dependency, 'package.json'), JSON.stringify({ version: nsisInitTraceBuilderVersion }));
    await fs.writeFile(path.join(temporary, 'package-lock.json'), JSON.stringify({ packages: {
      'node_modules/app-builder-lib': { version: nsisInitTraceBuilderVersion }
    } }));
    for (const [name, source] of Object.entries(values)) {
      const file = path.join(dependency, 'templates/nsis', ...name.split('/'));
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, source);
    }
    await task(temporary, dependency, values);
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
}

test('NSIS initialization diagnostics cover the actual four locked templates without changing original instructions', async () => {
  const values = await originals();
  for (const [name, source] of Object.entries(values)) {
    const patched = patchNsisInitTraceTemplate(name, source);
    assert.equal(digest(patched), nsisInitTraceTemplates[name].patchedSha256);
    assert.equal(removeTrace(patched), source);
    assert.equal(patchNsisInitTraceTemplate(name, patched), patched);
  }
  const installer = patchNsisInitTraceTemplate('installer.nsi', values['installer.nsi']);
  assert.match(installer, /CM_INIT_TRACE BEFORE_CHECK64\n\s*!insertmacro check64BitAndSetRegView\n\s*!insertmacro CM_INIT_TRACE AFTER_CHECK64/);
  assert.match(installer, /CM_INIT_TRACE BEFORE_MULTIUSER\n\s*!insertmacro initMultiUser\n\s*!insertmacro CM_INIT_TRACE AFTER_MULTIUSER/);
  const multiUser = patchNsisInitTraceTemplate('multiUser.nsh', values['multiUser.nsh']);
  assert.match(multiUser, /CM_INIT_TRACE BEFORE_KNOWN_FOLDER\n\s*System::Call 'SHELL32::SHGetKnownFolderPath/);
  assert.match(multiUser, /CM_INIT_TRACE BEFORE_STDUTILS_PARAMETERS\n\s*\$\{StdUtils.GetAllParameters\}/);
  const mutex = patchNsisInitTraceTemplate('include/allowOnlyOneInstallerInstance.nsh', values['include/allowOnlyOneInstallerInstance.nsh']);
  assert.match(mutex, /CM_INIT_TRACE BEFORE_CREATE_MUTEX\n\s*System::Call 'kernel32::CreateMutex/);
});

test('NSIS initialization diagnostics reject unknown, partially patched, duplicated and changed upstream templates', async () => {
  const values = await originals();
  for (const [name, source] of Object.entries(values)) {
    const patched = patchNsisInitTraceTemplate(name, source);
    assert.throws(() => patchNsisInitTraceTemplate(name, source + source), /Unknown/);
    assert.throws(() => patchNsisInitTraceTemplate(name, source + '\n; changed upstream\n'), /Unknown/);
    assert.throws(() => patchNsisInitTraceTemplate(name, patched.replace(/CM_INIT_TRACE [A-Z0-9_]+/, 'CM_INIT_TRACE UNREVIEWED_PHASE')), /Unknown/);
  }
  assert.throws(() => patchNsisInitTraceTemplate('../foreign.nsi', 'unknown'), /Unknown/);
});

test('NSIS preparation patches all reviewed inputs once and preserves locked dependency metadata', async () => {
  await fixture(async (temporary, dependency, values) => {
    const lockBefore = await fs.readFile(path.join(temporary, 'package-lock.json'));
    await prepareNsisInitTrace(temporary);
    for (const [name, source] of Object.entries(values)) {
      assert.equal(await fs.readFile(path.join(dependency, 'templates/nsis', ...name.split('/')), 'utf8'), patchNsisInitTraceTemplate(name, source));
    }
    await prepareNsisInitTrace(temporary);
    assert.deepEqual(await fs.readFile(path.join(temporary, 'package-lock.json')), lockBefore);
  });
});

test('NSIS preparation validates the final input before writing any earlier template', async () => {
  await fixture(async (temporary, dependency, values) => {
    const names = Object.keys(values), last = names.at(-1);
    await fs.appendFile(path.join(dependency, 'templates/nsis', ...last.split('/')), '\n; unknown upstream revision\n');
    await assert.rejects(prepareNsisInitTrace(temporary), /Unknown/);
    for (const name of names.slice(0, -1)) {
      assert.equal(await fs.readFile(path.join(dependency, 'templates/nsis', ...name.split('/')), 'utf8'), values[name]);
    }
  });
});

test('NSIS preparation refuses an unreviewed installed version or lock mismatch without changing templates', async () => {
  await fixture(async (temporary, dependency, values) => {
    await fs.writeFile(path.join(dependency, 'package.json'), JSON.stringify({ version: '26.15.4' }));
    await assert.rejects(prepareNsisInitTrace(temporary), /reviewed app-builder-lib version/);
    await fs.writeFile(path.join(dependency, 'package.json'), JSON.stringify({ version: nsisInitTraceBuilderVersion }));
    await fs.writeFile(path.join(temporary, 'package-lock.json'), JSON.stringify({ packages: {
      'node_modules/app-builder-lib': { version: '26.15.2' }
    } }));
    await assert.rejects(prepareNsisInitTrace(temporary), /match the lockfile/);
    for (const [name, source] of Object.entries(values)) {
      assert.equal(await fs.readFile(path.join(dependency, 'templates/nsis', ...name.split('/')), 'utf8'), source);
    }
  });
});
