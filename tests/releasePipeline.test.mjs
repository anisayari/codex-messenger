import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { canonicalReleaseVersion, validateReleaseMetadata } from '../scripts/release-metadata.mjs';
import { builderInvocation } from '../scripts/electron-builder-release-version.mjs';
import { expectedInstallers, stageReleaseArtifacts } from '../scripts/release-artifacts.mjs';

const commit = 'a'.repeat(40);
const packageJson = { version: '0.0.3', build: { buildVersion: '0.0.3', asar: true } };
const packageLock = { version: '0.0.3', packages: { '': { version: '0.0.3' } } };

test('release metadata derives an immutable tag and rejects different source or inconsistent package versions', () => {
  assert.deepEqual(validateReleaseMetadata(packageJson, packageLock, { sourceCommit: commit }), { version: '0.0.3', tag: 'v0.0.3', commit });
  assert.throws(() => validateReleaseMetadata(packageJson, packageLock, { tag: 'v0.0.2.9', sourceCommit: commit }));
  assert.throws(() => validateReleaseMetadata(packageJson, packageLock, { commit: 'b'.repeat(40), sourceCommit: commit }));
  assert.throws(() => validateReleaseMetadata(packageJson, { ...packageLock, version: '0.0.2-9' }, { sourceCommit: commit }));
  assert.throws(() => validateReleaseMetadata({ ...packageJson, build: { ...packageJson.build, buildVersion: '0.0.2.9' } }, packageLock, { sourceCommit: commit }));
  for (const version of ['0.0.03', '0.0.3-beta', '0.0.3\n', '../0.0.3']) {
    assert.throws(() => canonicalReleaseVersion(version));
    assert.throws(() => validateReleaseMetadata({ ...packageJson, version }, packageLock, { sourceCommit: commit }));
  }
  assert.throws(() => validateReleaseMetadata(packageJson, packageLock, { sourceCommit: commit + '\n' }));
});

test('builder uses Node and the JS CLI, preserving literal arguments without Windows cmd or shell interpolation', () => {
  const args = ['--win', 'nsis', '--publish', 'never', '-c.directories.output=directory with spaces', 'literal&value'];
  const root = path.join(os.tmpdir(), 'project with spaces');
  const invocation = builderInvocation(root, args, 'node.exe');
  assert.equal(invocation.command, 'node.exe');
  assert.equal(invocation.args[0], path.join(root, 'node_modules', 'electron-builder', 'cli.js'));
  assert.deepEqual(invocation.args.slice(1), args);
  assert.ok(!invocation.args[0].endsWith('.cmd'));
});

test('installer names distinguish all supported platforms and reject unsupported architectures or unsafe versions', () => {
  assert.deepEqual(expectedInstallers({ platform: 'windows', arch: 'x64', version: '0.0.3' }), ['Codex Messenger Setup 0.0.3.exe', 'Codex Messenger 0.0.3.exe']);
  assert.deepEqual(expectedInstallers({ platform: 'macos', arch: 'arm64', version: '0.0.3' }), ['Codex-Messenger-0.0.3-arm64.dmg', 'Codex-Messenger-0.0.3-arm64.zip']);
  assert.ok(expectedInstallers({ platform: 'macos', arch: 'x64', version: '0.0.3' }).every((name) => name.includes('-x64.')));
  assert.throws(() => expectedInstallers({ platform: 'windows', arch: 'arm64', version: '0.0.3' }));
  assert.throws(() => expectedInstallers({ platform: 'linux', arch: 'x64', version: '0.0.3' }));
});

test('artifact staging requires a matching successful packaged smoke and hashes the exact uploaded fixture bytes', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'release-artifacts-unit-'));
  try {
    const outputDir = path.join(temp, 'output');
    const uploadDir = path.join(temp, 'upload');
    const proofPath = path.join(temp, 'proof.json');
    const codexProofPath = path.join(temp, 'codex-proof.json');
    const codexTapPath = path.join(temp, 'codex.tap');
    await fs.mkdir(outputDir);
    const names = expectedInstallers({ platform: 'macos', arch: 'x64', version: '0.0.3' });
    for (const name of names) await fs.writeFile(path.join(outputDir, name), Buffer.alloc(2048, 7));
    await fs.writeFile(proofPath, JSON.stringify({ passed: false, version: '0.0.3', platform: 'macos', arch: 'x64' }));
    const options = { outputDir, uploadDir, proofPath, codexProofPath, codexTapPath, codexVersion: '0.156.1', platform: 'macos', arch: 'x64', version: '0.0.3', commit };
    await assert.rejects(stageReleaseArtifacts(options), /smoke must pass/);
    await fs.writeFile(proofPath, JSON.stringify({ passed: true, version: '0.0.3', platform: 'macos', arch: 'arm64' }));
    await assert.rejects(stageReleaseArtifacts(options), /architecture/);
    await fs.writeFile(proofPath, JSON.stringify({ passed: true, version: '0.0.3', platform: 'macos', arch: 'x64' }));
    const codexProof = { passed: true, version: '0.156.1', platform: 'macos', arch: 'x64', nativeSha256: 'c'.repeat(64) };
    await fs.writeFile(codexProofPath, JSON.stringify(codexProof));
    await fs.writeFile(codexTapPath, '# pass 0\n# fail 0\n# skipped 1\n');
    await assert.rejects(stageReleaseArtifacts(options), /one passing contract/);
    await fs.writeFile(codexTapPath, '# pass 1\n# fail 0\n# skipped 0\n');
    await fs.writeFile(codexProofPath, JSON.stringify({ ...codexProof, version: '0.156.0' }));
    await assert.rejects(stageReleaseArtifacts(options), /version must match/);
    await fs.writeFile(codexProofPath, JSON.stringify(codexProof));
    const manifest = await stageReleaseArtifacts(options);
    assert.equal(manifest.files.length, 2);
    assert.equal(manifest.nativeCodex.version, '0.156.1');
    assert.equal(await fs.readFile(path.join(uploadDir, 'codex-native-macos-x64.tap'), 'utf8'), '# pass 1\n# fail 0\n# skipped 0\n');
    for (const file of manifest.files) {
      assert.equal(file.bytes, 2048);
      assert.match(file.sha256, /^[0-9a-f]{64}$/);
      assert.deepEqual(await fs.readFile(path.join(uploadDir, file.name)), await fs.readFile(path.join(outputDir, file.name)));
    }
    const checksums = await fs.readFile(path.join(uploadDir, 'SHA256SUMS-macos-x64.txt'), 'utf8');
    assert.ok(manifest.files.every((file) => checksums.includes(`${file.sha256} *${file.name}\n`)));
    await assert.rejects(stageReleaseArtifacts(options), { code: 'EEXIST' });
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
});
