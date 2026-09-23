import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNativeProofArguments, nativeCodexTarget, validateNativeExecutableLayout, validateNativeBinaryHeader,
  validateNativeVersion, validateLiveTap, redactNativeTap } from '../scripts/codex-native-proof.mjs';

const options = { runtime: 'native-runtime', version: '0.156.1', platform: 'windows', arch: 'x64', report: 'proof/native.json', tap: 'proof/native.tap' };
const args = object => Object.entries(object).flatMap(([key, value]) => ['--' + key, value]);
const validTap = 'TAP version 13\n# Subtest: actual 0.156.1 binary: discovery, metadata and unmaterialized history capability\nok 1 - actual 0.156.1 binary: discovery, metadata and unmaterialized history capability\n  ---\n  duration_ms: 500\n  type: test\n  ...\n1..1\n# tests 1\n# suites 0\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n# duration_ms 501\n';

test('native Codex proof CLI requires exact version and separate complete report outputs', () => {
  assert.deepEqual(parseNativeProofArguments(args(options)), options);
  for (const invalid of [[], [...args(options), '--version', '0.156.1'], ['--runtime'], args({ ...options, version: '0.156.1\n' }),
    args({ ...options, platform: 'linux' }), args({ ...options, arch: 'ia32' }), args({ ...options, tap: options.report })]) {
    assert.throws(() => parseNativeProofArguments(invalid));
  }
});

test('official native Codex layouts match the requested OS and architecture and reject npm wrappers', () => {
  for (const [platform, arch, triple, binary] of [['windows', 'x64', 'x86_64-pc-windows-msvc', 'codex.exe'],
    ['windows', 'arm64', 'aarch64-pc-windows-msvc', 'codex.exe'], ['macos', 'x64', 'x86_64-apple-darwin', 'codex'],
    ['macos', 'arm64', 'aarch64-apple-darwin', 'codex']]) {
    const target = nativeCodexTarget(platform, arch);
    assert.equal(target.triple, triple); assert.equal(target.binary, binary);
    validateNativeExecutableLayout('/runtime/node_modules/@openai/package/vendor/' + triple + '/bin/' + binary, '/runtime/codex.js', target);
    assert.throws(() => validateNativeExecutableLayout('/runtime/codex.js', '/runtime/codex.js', target));
    assert.throws(() => validateNativeExecutableLayout('/runtime/vendor/wrong-platform/bin/' + binary, '/runtime/codex.js', target));
  }
});

test('native binary validation rejects renamed scripts and wrong Mach-O or PE architecture', () => {
  for (const arch of ['x64', 'arm64']) {
    const mach = Buffer.alloc(8); mach.writeUInt32LE(0xfeedfacf); mach.writeUInt32LE(arch === 'arm64' ? 0x0100000c : 0x01000007, 4);
    validateNativeBinaryHeader(mach, { platform: 'macos', arch });
    assert.throws(() => validateNativeBinaryHeader(mach, { platform: 'macos', arch: arch === 'x64' ? 'arm64' : 'x64' }));
    const pe = Buffer.alloc(128); pe.writeUInt16LE(0x5a4d); pe.writeUInt32LE(64, 0x3c); pe.writeUInt32LE(0x00004550, 64); pe.writeUInt16LE(arch === 'arm64' ? 0xaa64 : 0x8664, 68);
    validateNativeBinaryHeader(pe, { platform: 'windows', arch });
    assert.throws(() => validateNativeBinaryHeader(pe, { platform: 'windows', arch: arch === 'x64' ? 'arm64' : 'x64' }));
    pe.writeUInt32LE(100000, 0x3c); assert.throws(() => validateNativeBinaryHeader(pe, { platform: 'windows', arch }));
  }
  for (const platform of ['windows', 'macos']) assert.throws(() => validateNativeBinaryHeader(Buffer.from('#!/bin/sh'), { platform, arch: 'x64' }));
});

test('native --version accepts only the exact binary version with an ordinary output newline', () => {
  for (const value of ['codex-cli 0.156.1', 'codex-cli 0.156.1\n', 'codex-cli 0.156.1\r\n']) validateNativeVersion(value, '0.156.1');
  for (const value of ['codex-cli 0.156.0\n', 'codex-cli 0.156.1-alpha\n', ' codex-cli 0.156.1\n', 'codex-cli 0.156.1\nextra', 'codex-cli 0.156.1\n\n']) {
    assert.throws(() => validateNativeVersion(value, '0.156.1'));
  }
});

test('live TAP proof requires an actual single PASS and exit zero, never SKIP, TODO or an incomplete summary', () => {
  assert.deepEqual(validateLiveTap(validTap, 0, '0.156.1'), { tests: 1, pass: 1, fail: 0, cancelled: 0, skipped: 0, todo: 0 });
  assert.equal(Object.hasOwn(validateLiveTap(validTap, 0, '0.156.1'), 'passed'), false);
  assert.throws(() => validateLiveTap(validTap, 1, '0.156.1'));
  for (const invalid of [validTap.replace('ok 1 - actual', 'not ok 1 - actual'), validTap.replace('capability\n  ---', 'capability # SKIP\n  ---'),
    validTap.replace('capability\n  ---', 'capability # TODO\n  ---'), validTap.replace('# skipped 0', '# skipped 1'),
    validTap.replace('# cancelled 0', '# cancelled 1'), validTap.replace('# todo 0', '# todo 1'), validTap.replace('# tests 1', '# tests 0'),
    validTap.replace('# pass 1', '# pass 0'), validTap.replace('# fail 0', '# fail 1'), validTap.replace('1..1', '1..0'),
    validTap.replace('# tests 1', ''), validTap + '# pass 1\n', validTap + 'Bail out!\n', validTap + 'ok 2 - another fixture\n',
    validTap.replaceAll('actual 0.156.1 binary', 'actual 0.156.0 binary'), validTap + '    Bail out! nested abort\n',
    validTap + '    ok 1 - nested # SKIP\n', validTap + '    ok 1 - nested # TODO\n', validTap + '    not ok 1 - nested failure\n',
    validTap + '    1..1\n']) {
    assert.throws(() => validateLiveTap(invalid, 0, '0.156.1'));
  }
});

test('native TAP redaction removes private Windows, POSIX and file URL paths while preserving the test outcome', () => {
  const diagnostics = '\n# path C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\fixture\n# escaped C:\\\\Users\\\\private\\\\Temp\\\\fixture\n' +
    '# source file:///Users/private/project/tests/codexLiveContract.test.mjs:8:5\n# tempfile /private/var/folders/private/fixture\n' +
    '# runtime /custom/private-runtime/vendor/binary\n# UNC \\\\private-server\\secret\\native.tap\n# config /etc/custom/private-config\n' +
    '# quoted "/arbitrary root/private fixture/file.tap"\n# Unmaterialized-history response: -32600: thread/turns/list unavailable\n';
  const safe = redactNativeTap(validTap + diagnostics, ['/custom/private-runtime']);
  assert.ok(!safe.includes('RUNNER~1') && !safe.includes('/Users') && !safe.includes('/private/var') && !safe.includes('/custom/private-runtime') &&
    !safe.includes('private-server') && !safe.includes('/etc') && !safe.includes('private-config') && !safe.includes('arbitrary root'));
  assert.ok(safe.includes('[private-path]'));
  assert.ok(safe.includes('thread/turns/list'));
  assert.deepEqual(validateLiveTap(safe, 0, '0.156.1'), { tests: 1, pass: 1, fail: 0, cancelled: 0, skipped: 0, todo: 0 });
});
