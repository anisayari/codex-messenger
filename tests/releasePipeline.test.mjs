import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { canonicalReleaseVersion, validateReleaseMetadata } from '../scripts/release-metadata.mjs';
import { builderInvocation } from '../scripts/electron-builder-release-version.mjs';
import { expectedInstallers, stageReleaseArtifacts, sha256File, requiredPackagedChecks, requiredLauncherChecks, requiredInstallerChecks,
  validatePackagedSmoke, validateInstallerSmoke, validateLauncherSmoke, validateNativeCodexTap, parseArtifactArguments } from '../scripts/release-artifacts.mjs';

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

const target = { platform: 'macos', arch: 'x64', version: '0.0.3' };
const applicationSha = 'd'.repeat(64);
const checksFor = keys => Object.fromEntries(keys.map(key => [key, true]));
const runtimeErrors = () => ({ preloadError: 0, loadFailure: 0, rendererGone: 0, pageError: 0, consoleError: 0 });
const packagedProof = (selected = target) => ({ schemaVersion: 1, passed: true, ...selected, checks: checksFor(requiredPackagedChecks),
  errors: runtimeErrors(), failure: null, process: { closed: true, forced: false, exitCode: 0 }, appAsarSha256: applicationSha });
const launcherProof = () => ({ ...packagedProof(), checks: checksFor(requiredLauncherChecks) });
const nativeTap = 'TAP version 13\n# Subtest: actual 0.156.1 binary: discovery, metadata and unmaterialized history capability\n' +
  'ok 1 - actual 0.156.1 binary: discovery, metadata and unmaterialized history capability\n1..1\n# tests 1\n# suites 0\n' +
  '# pass 1\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n# duration_ms 1\n';
const nativeSummary = { tests: 1, pass: 1, fail: 0, cancelled: 0, skipped: 0, todo: 0 };

async function stagingFixture(t) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'release-artifacts-unit-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const options = { ...target, commit, outputDir: path.join(temp, 'output'), uploadDir: path.join(temp, 'upload'),
    proofPath: path.join(temp, 'packaged.json'), installerProofPath: path.join(temp, 'installer.json'),
    launcherProofPath: path.join(temp, 'launcher.json'), codexVersion: '0.156.1', codexProofPath: path.join(temp, 'codex.json'), codexTapPath: path.join(temp, 'codex.tap') };
  await fs.mkdir(options.outputDir);
  const installers = [];
  for (const [index, name] of expectedInstallers(target).entries()) {
    // These are explicit unit fixture bytes, not evidence of a native installation.
    const bytes = Buffer.alloc(2048 + index, 7 + index);
    const file = path.join(options.outputDir, name);
    await fs.writeFile(file, bytes);
    installers.push({ name, bytes: bytes.length, sha256: await sha256File(file), passed: true, appAsarSha256: applicationSha,
      smoke: packagedProof(), checks: checksFor(requiredInstallerChecks(name, target)) });
  }
  const proofs = { packaged: packagedProof(), installer: { schemaVersion: 1, passed: true, ...target, installers },
    launcher: launcherProof(), codex: { passed: true, version: '0.156.1', platform: target.platform, arch: target.arch,
      nativeSha256: 'c'.repeat(64), testSummary: nativeSummary, failure: null } };
  const write = async () => {
    for (const [kind, file] of [['packaged', options.proofPath], ['installer', options.installerProofPath],
      ['launcher', options.launcherProofPath], ['codex', options.codexProofPath]]) await fs.writeFile(file, JSON.stringify(proofs[kind]));
  };
  await write();
  await fs.writeFile(options.codexTapPath, nativeTap);
  return { options, proofs, write };
}

test('installer names are canonical for every supported platform and reject unsafe versions and unsupported targets', () => {
  assert.deepEqual(expectedInstallers({ platform: 'windows', arch: 'x64', version: '0.0.3' }), ['Codex-Messenger-Setup-0.0.3.exe', 'Codex-Messenger-0.0.3.exe']);
  assert.deepEqual(expectedInstallers({ platform: 'macos', arch: 'arm64', version: '0.0.3' }), ['Codex-Messenger-0.0.3-arm64.dmg', 'Codex-Messenger-0.0.3-arm64.zip']);
  assert.ok(expectedInstallers(target).every(name => name.includes('-x64.')));
  for (const invalid of [{ platform: 'windows', arch: 'arm64' }, { platform: 'linux', arch: 'x64' }, { ...target, version: '../0.0.3' }]) {
    assert.throws(() => expectedInstallers({ version: '0.0.3', ...invalid }));
  }
});

test('collector rejects a success boolean without all fourteen packaged guarantees or clean runtime results', () => {
  assert.equal(validatePackagedSmoke(packagedProof(), target).passed, true);
  assert.throws(() => validatePackagedSmoke({ passed: true, ...target }, target), /schema/);
  for (const key of requiredPackagedChecks) {
    const proof = packagedProof();
    delete proof.checks[key];
    assert.throws(() => validatePackagedSmoke(proof, target), new RegExp(key));
    proof.checks[key] = false;
    assert.throws(() => validatePackagedSmoke(proof, target), new RegExp(key));
  }
  for (const key of Object.keys(runtimeErrors())) {
    const proof = packagedProof();
    proof.errors[key] = 1;
    assert.throws(() => validatePackagedSmoke(proof, target), /zero/);
  }
  for (const value of [{ closed: false, forced: false, exitCode: 0 }, { closed: true, forced: true, exitCode: 0 },
    { closed: true, forced: false, exitCode: null }, { closed: true, forced: false, exitCode: 1 }]) {
    assert.throws(() => validatePackagedSmoke({ ...packagedProof(), process: value }, target), /process/);
  }
  assert.throws(() => validatePackagedSmoke({ ...packagedProof(), failure: 'LOAD_TIMEOUT' }, target), /no failure/);
  assert.throws(() => validatePackagedSmoke({ ...packagedProof(), appAsarSha256: 'unknown' }, target), /archive SHA256/);
  assert.throws(() => validatePackagedSmoke({ ...packagedProof(), arch: 'arm64' }, target), /architecture/);
});

test('installer receipts cover each exact artifact once and bind their executed application to the original packaged archive', async t => {
  const { proofs } = await stagingFixture(t);
  validateInstallerSmoke(proofs.installer, target, applicationSha);
  for (const installers of [[], [proofs.installer.installers[0]], [proofs.installer.installers[0], proofs.installer.installers[0]],
    [...proofs.installer.installers, { ...proofs.installer.installers[0], name: '../extra.zip' }]]) {
    assert.throws(() => validateInstallerSmoke({ ...proofs.installer, installers }, target, applicationSha), /exactly once/);
  }
  for (const mutate of [receipt => { receipt.passed = false; }, receipt => { receipt.bytes = 1; },
    receipt => { receipt.sha256 = 'unknown'; }, receipt => { receipt.appAsarSha256 = 'e'.repeat(64); },
    receipt => { receipt.smoke.appAsarSha256 = 'e'.repeat(64); }, receipt => { receipt.smoke.checks.preloadBootstrap = false; },
    receipt => { receipt.checks.originAsar = false; }, receipt => { receipt.checks.privateTempCleanup = false; }]) {
    const changed = structuredClone(proofs.installer);
    mutate(changed.installers[0]);
    assert.throws(() => validateInstallerSmoke(changed, target, applicationSha));
  }
});

test('Windows receipt requires real portable wrapper execution and protected NSIS install/uninstall checks', () => {
  const selected = { platform: 'windows', arch: 'x64', version: '0.0.3' };
  const installers = expectedInstallers(selected).map(name => ({ name, bytes: 2048, sha256: 'a'.repeat(64), passed: true,
    appAsarSha256: applicationSha, smoke: packagedProof(selected), checks: checksFor(requiredInstallerChecks(name, selected)) }));
  const proof = { schemaVersion: 1, passed: true, ...selected, installers };
  validateInstallerSmoke(proof, selected, applicationSha);
  assert.throws(() => validateInstallerSmoke({ ...proof, diagnosticOnly: true }, selected, applicationSha), /Diagnostic-only/);
  assert.throws(() => validateInstallerSmoke({ ...proof, diagnosticOnly: true, installers: [installers[1]] }, selected, applicationSha), /Diagnostic-only/);
  for (const [index, key] of [[0, 'runningAppInstallRefused'], [0, 'runningAppPreserved'], [0, 'foreignUninstallRefused'], [0, 'foreignFilePreserved'], [0, 'protectedFilesPreserved'],
    [0, 'uninstalled'], [0, 'registrationRemoved'], [1, 'actualWrapperExecution'], [1, 'wrapperCleanExit'], [1, 'wrapperRuntimeErrorsZero']]) {
    const changed = structuredClone(proof);
    delete changed.installers[index].checks[key];
    assert.throws(() => validateInstallerSmoke(changed, selected, applicationSha), new RegExp(key));
  }
});

test('launcher evidence requires all development and preview checks plus private cleanup', () => {
  validateLauncherSmoke(launcherProof(), target);
  for (const key of requiredLauncherChecks) {
    const proof = launcherProof();
    proof.checks[key] = false;
    assert.throws(() => validateLauncherSmoke(proof, target), new RegExp(key));
  }
  assert.throws(() => validateLauncherSmoke({ ...launcherProof(), arch: 'arm64' }, target), /architecture/);
  assert.throws(() => validateLauncherSmoke({ ...launcherProof(), errors: { ...runtimeErrors(), consoleError: 1 } }, target), /zero/);
});

test('native Codex staging validates a complete actual outcome rather than three fabricated summary lines', () => {
  assert.deepEqual(validateNativeCodexTap(nativeTap, '0.156.1'), nativeSummary);
  for (const text of ['# pass 1\n# fail 0\n# skipped 0\n', nativeTap.replace('1..1', '1..0'),
    nativeTap.replace('ok 1 -', 'not ok 1 -'), nativeTap.replace('# skipped 0', '# skipped 1'),
    nativeTap + '# pass 1\n', nativeTap.replace('ok 1 - actual', 'ok 1 - fixture'), nativeTap + 'Bail out! failed\n']) {
    assert.throws(() => validateNativeCodexTap(text, '0.156.1'));
  }
  assert.throws(() => validateNativeCodexTap(nativeTap, '0.156.0'));
});

test('artifact staging rejects a changed original installer hash before creating any upload files', async t => {
  const fixture = await stagingFixture(t);
  const name = fixture.proofs.installer.installers[1].name;
  await fs.writeFile(path.join(fixture.options.outputDir, name), Buffer.alloc(2049, 9));
  await assert.rejects(stageReleaseArtifacts(fixture.options), /SHA256 differs/);
  await assert.rejects(fs.stat(fixture.options.uploadDir), { code: 'ENOENT' });
});

test('artifact staging rejects incorrect receipt size, symlinks and wrong native or installer target', async t => {
  const { options, proofs, write } = await stagingFixture(t);
  proofs.installer.installers[1].bytes += 1;
  await write();
  await assert.rejects(stageReleaseArtifacts(options), /byte count differs/);
  proofs.installer.installers[1].bytes -= 1;
  proofs.codex.version = '0.156.0';
  await write();
  await assert.rejects(stageReleaseArtifacts(options), /version must match/);
  proofs.codex.version = '0.156.1';
  proofs.installer.arch = 'arm64';
  await write();
  await assert.rejects(stageReleaseArtifacts(options), /architecture/);
  proofs.installer.arch = 'x64';
  await write();
  const artifact = path.join(options.outputDir, proofs.installer.installers[0].name);
  const moved = artifact + '.unit-original';
  await fs.rename(artifact, moved);
  await fs.symlink(moved, artifact);
  await assert.rejects(stageReleaseArtifacts(options), /regular file/);
  await assert.rejects(fs.stat(options.uploadDir), { code: 'ENOENT' });
});

test('artifact staging requires matching native JSON and TAP summaries and both new evidence paths', async t => {
  const { options, proofs, write } = await stagingFixture(t);
  await fs.writeFile(options.codexTapPath, '# pass 1\n# fail 0\n# skipped 0\n');
  await assert.rejects(stageReleaseArtifacts(options), /complete Node TAP/);
  await fs.writeFile(options.codexTapPath, nativeTap);
  proofs.codex.testSummary = { ...nativeSummary, skipped: 1 };
  await write();
  await assert.rejects(stageReleaseArtifacts(options), /summaries must match/);
  await assert.rejects(stageReleaseArtifacts({ ...options, installerProofPath: undefined }));
  await assert.rejects(stageReleaseArtifacts({ ...options, launcherProofPath: undefined }));
});

test('artifact staging copies the exact unit fixture bytes and evidence into nine files without claiming native execution', async t => {
  const { options, proofs } = await stagingFixture(t);
  const manifest = await stageReleaseArtifacts(options);
  assert.equal(manifest.files.length, 2);
  assert.equal(manifest.applicationArchiveSha256, applicationSha);
  assert.equal(manifest.nativeCodex.version, '0.156.1');
  assert.equal(manifest.installerSmoke, 'installer-smoke-macos-x64.json');
  assert.equal(manifest.launcherSmoke, 'launcher-smoke-macos-x64.json');
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(options.uploadDir, manifest.installerSmoke), 'utf8')), proofs.installer);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(options.uploadDir, manifest.launcherSmoke), 'utf8')), proofs.launcher);
  assert.equal(await fs.readFile(path.join(options.uploadDir, manifest.nativeCodex.tap), 'utf8'), nativeTap);
  assert.equal((await fs.readdir(options.uploadDir)).length, 9);
  for (const file of manifest.files) {
    assert.match(file.sha256, /^[0-9a-f]{64}$/);
    assert.equal(file.sha256, await sha256File(path.join(options.uploadDir, file.name)));
    assert.deepEqual(await fs.readFile(path.join(options.uploadDir, file.name)), await fs.readFile(path.join(options.outputDir, file.name)));
  }
  const checksums = await fs.readFile(path.join(options.uploadDir, 'SHA256SUMS-macos-x64.txt'), 'utf8');
  assert.ok(manifest.files.every(file => checksums.includes(file.sha256 + ' *' + file.name + '\n')));
  await assert.rejects(stageReleaseArtifacts(options), { code: 'EEXIST' });
});

test('artifact CLI requires installer and launcher receipts and rejects duplicate, missing and malformed arguments', () => {
  const argumentsFor = options => Object.entries(options).flatMap(([key, value]) => ['--' + key, value]);
  const options = { platform: 'macos', arch: 'x64', version: '0.0.3', commit, output: 'directory with spaces', 'upload-dir': 'upload directory',
    proof: 'packaged.json', 'installer-proof': 'installer.json', 'launcher-proof': 'launcher.json',
    'codex-version': '0.156.1', 'codex-proof': 'codex.json', 'codex-tap': 'codex.tap' };
  assert.equal(parseArtifactArguments(argumentsFor(options))['--installer-proof'], 'installer.json');
  for (const args of [[], argumentsFor({ ...options, 'installer-proof': '' }), argumentsFor({ ...options, 'launcher-proof': 'bad\0path' }),
    [...argumentsFor(options), '--arch', 'x64'], [...argumentsFor(options), '--unknown', 'value']]) assert.throws(() => parseArtifactArguments(args));
});
