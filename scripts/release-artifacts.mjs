import assert from 'node:assert/strict';
import { createReadStream, constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { canonicalReleaseVersion } from './release-metadata.mjs';

export const requiredPackagedChecks = Object.freeze(['packaged', 'asar', 'version', 'platform', 'architecture', 'privateProfile',
  'sandbox', 'contextIsolation', 'nodeIntegrationDisabled', 'webSecurity', 'preloadBootstrap', 'rendererNodeIsolated', 'packagedDocument', 'renderedDom']);
export const requiredLauncherChecks = Object.freeze(['developmentStartup', 'developmentVersion', 'developmentRendererReady',
  'developmentCleanExit', 'developmentServerClosed', 'previewHttpReady', 'previewCleanStop', 'previewPortClosed', 'privateProfileCleanup']);
const errorKinds = ['preloadError', 'loadFailure', 'rendererGone', 'pageError', 'consoleError'];
const hashPattern = /^[0-9a-f]{64}(?![\s\S])/;

export function expectedInstallers({ platform, arch, version }) {
  canonicalReleaseVersion(version);
  assert.ok(platform === 'windows' || platform === 'macos', 'Unsupported installer platform');
  assert.ok(arch === 'x64' || (platform === 'macos' && arch === 'arm64'), 'Unsupported installer architecture');
  return platform === 'windows'
    ? ['Codex-Messenger-Setup-' + version + '.exe', 'Codex-Messenger-' + version + '.exe']
    : ['Codex-Messenger-' + version + '-' + arch + '.dmg', 'Codex-Messenger-' + version + '-' + arch + '.zip'];
}

export function requiredInstallerChecks(name, { platform, arch, version }) {
  const names = expectedInstallers({ platform, arch, version });
  assert.ok(names.includes(name), 'Unexpected installer receipt');
  if (platform === 'macos') return [...(name.endsWith('.dmg') ? ['mountedReadOnly', 'copiedApplication', 'mountDetached'] : ['extractedApplication']),
    'bundleArchitecture', 'bundleVersion', 'originAsar', 'privateTempCleanup'];
  return name === names[0]
    ? ['installed', 'silentNoAutoLaunch', 'runningAppInstallRefused', 'runningAppPreserved', 'foreignUninstallRefused', 'foreignFilePreserved', 'legacySharedDirectoryRefused', 'legacyFilesPreserved', 'uninstalled', 'registrationRemoved', 'protectedFilesPreserved', 'originAsar', 'privateTempCleanup']
    : ['actualWrapperExecution', 'wrapperVersion', 'wrapperPackaged', 'wrapperRendererReady', 'wrapperCleanExit', 'wrapperRuntimeErrorsZero', 'originAsar', 'privateTempCleanup'];
}

function matchingTarget(proof, { version, platform, arch }, label) {
  assert.equal(proof?.schemaVersion, 1, label + ' schema must be supported');
  assert.equal(proof.passed, true, label + ' must pass before upload');
  assert.equal(proof.version, version, label + ' version must match installers');
  assert.equal(proof.platform, platform, label + ' platform must match installers');
  assert.equal(proof.arch, arch, label + ' architecture must match installers');
}

function successfulChecks(checks, required, label) {
  assert.ok(checks && typeof checks === 'object' && !Array.isArray(checks), label + ' checks are required');
  for (const key of required) assert.equal(checks[key], true, label + ' check must pass: ' + key);
  assert.ok(Object.values(checks).every(value => value === true), label + ' must have no failed checks');
}

function cleanRuntime(proof, label) {
  assert.equal(proof.failure, null, label + ' must have no failure');
  assert.deepEqual(Object.keys(proof.errors || {}).sort(), [...errorKinds].sort(), label + ' must contain all runtime error counters');
  for (const key of errorKinds) assert.equal(proof.errors[key], 0, label + ' must contain zero ' + key + ' errors');
  assert.equal(proof.process?.closed, true, label + ' process must close');
  assert.equal(proof.process?.forced, false, label + ' process must not be forcibly terminated');
  assert.equal(proof.process?.exitCode, 0, label + ' process must exit successfully');
}

export function validatePackagedSmoke(proof, target, label = 'Packaged application smoke') {
  matchingTarget(proof, target, label);
  successfulChecks(proof.checks, requiredPackagedChecks, label);
  cleanRuntime(proof, label);
  assert.match(proof.appAsarSha256, hashPattern, label + ' must contain the tested application archive SHA256');
  return proof;
}

export function validateInstallerSmoke(proof, target, appAsarSha256) {
  matchingTarget(proof, target, 'Installer smoke');
  assert.ok(Array.isArray(proof.installers), 'Installer smoke must contain installer receipts');
  const names = expectedInstallers(target);
  assert.deepEqual(proof.installers.map(receipt => receipt?.name).sort(), [...names].sort(), 'Installer smoke must cover each expected installer exactly once');
  for (const receipt of proof.installers) {
    assert.equal(receipt.passed, true, 'Each actual installer must pass');
    assert.ok(Number.isSafeInteger(receipt.bytes) && receipt.bytes >= 1024, 'Installer receipt must contain its original byte count');
    assert.match(receipt.sha256, hashPattern, 'Installer receipt must contain the original installer SHA256');
    assert.match(receipt.appAsarSha256, hashPattern, 'Installer receipt must contain its application archive SHA256');
    assert.equal(receipt.appAsarSha256, appAsarSha256, 'Installed application archive must match the packaged application');
    successfulChecks(receipt.checks, requiredInstallerChecks(receipt.name, target), 'Installer ' + receipt.name);
    validatePackagedSmoke(receipt.smoke, target, 'Installed application smoke');
    assert.equal(receipt.smoke.appAsarSha256, receipt.appAsarSha256, 'Executed application archive must match the installer receipt');
  }
  return proof;
}

export function validateLauncherSmoke(proof, target) {
  matchingTarget(proof, target, 'Launcher smoke');
  successfulChecks(proof.checks, requiredLauncherChecks, 'Launcher smoke');
  cleanRuntime(proof, 'Launcher smoke');
  return proof;
}

export function validateNativeCodexTap(text, version) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  assert.equal(lines[0], 'TAP version 13', 'Native Codex TAP must contain a complete Node TAP report');
  assert.deepEqual(lines.filter(line => /^1\.\./.test(line)), ['1..1'], 'Native Codex TAP must contain exactly one complete test plan');
  assert.deepEqual(lines.filter(line => /^(?:not )?ok \d+/.test(line)),
    ['ok 1 - actual ' + version + ' binary: discovery, metadata and unmaterialized history capability'], 'Native Codex TAP must contain one passing contract without skip or TODO');
  assert.ok(!lines.some(line => /^\s*Bail out!/i.test(line) || /^\s+(?:(?:not )?ok \d+|\d+\.\.)/.test(line)), 'Native Codex TAP cannot contain bailout or nested outcomes');
  const summary = {};
  for (const key of ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo']) {
    const counts = lines.filter(line => new RegExp('^# ' + key + ' [0-9]+$').test(line));
    assert.equal(counts.length, 1, 'Native Codex TAP must contain an unambiguous complete test summary');
    summary[key] = Number(counts[0].slice(counts[0].lastIndexOf(' ') + 1));
  }
  assert.deepEqual(summary, { tests: 1, pass: 1, fail: 0, cancelled: 0, skipped: 0, todo: 0 }, 'Native Codex contract cannot be skipped, failed or empty');
  return summary;
}

export async function sha256File(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

export async function stageReleaseArtifacts({ platform, arch, version, commit, outputDir, uploadDir, proofPath, installerProofPath,
  launcherProofPath, codexVersion, codexProofPath, codexTapPath }) {
  const target = { platform, arch, version };
  const names = expectedInstallers(target);
  assert.match(commit, /^[0-9a-f]{40}(?![\s\S])/, 'Source commit must be a full lowercase Git SHA');
  const readProof = async file => { const bytes = await fs.readFile(file); return { bytes, proof: JSON.parse(bytes.toString('utf8')) }; };
  const packaged = await readProof(proofPath);
  validatePackagedSmoke(packaged.proof, target);
  const installer = await readProof(installerProofPath);
  validateInstallerSmoke(installer.proof, target, packaged.proof.appAsarSha256);
  const launcher = await readProof(launcherProofPath);
  validateLauncherSmoke(launcher.proof, target);
  canonicalReleaseVersion(codexVersion);
  const codex = await readProof(codexProofPath);
  const codexProof = codex.proof;
  assert.equal(codexProof.passed, true, 'Native Codex contract must pass before upload');
  assert.equal(codexProof.version, codexVersion, 'Native Codex version must match the verified runtime');
  assert.equal(codexProof.platform, platform, 'Native Codex platform must match installers');
  assert.equal(codexProof.arch, arch, 'Native Codex architecture must match installers');
  assert.match(codexProof.nativeSha256, hashPattern, 'Native Codex proof must contain the executable SHA256');
  assert.equal(codexProof.failure, null, 'Native Codex proof must have no failure');
  const codexTap = await fs.readFile(codexTapPath);
  assert.deepEqual(codexProof.testSummary, validateNativeCodexTap(codexTap.toString('utf8'), codexVersion), 'Native Codex JSON and TAP summaries must match');
  // Complete preflight before creating any upload files.
  const files = [];
  for (const name of names) {
    const source = path.join(outputDir, name);
    const stat = await fs.lstat(source);
    assert.ok(stat.isFile() && !stat.isSymbolicLink(), 'Installer must be a regular file: ' + name);
    assert.ok(stat.size >= 1024, 'Installer is unexpectedly small: ' + name);
    const sha256 = await sha256File(source);
    const receipt = installer.proof.installers.find(entry => entry.name === name);
    assert.equal(stat.size, receipt.bytes, 'Installer byte count differs from the tested original: ' + name);
    assert.equal(sha256, receipt.sha256, 'Installer SHA256 differs from the tested original: ' + name);
    files.push({ name, bytes: stat.size, sha256 });
  }
  await fs.mkdir(uploadDir, { recursive: true });
  for (const file of files) {
    const destination = path.join(uploadDir, file.name);
    await fs.copyFile(path.join(outputDir, file.name), destination, constants.COPYFILE_EXCL);
    assert.equal((await fs.lstat(destination)).size, file.bytes, 'Installer changed while copying: ' + file.name);
    assert.equal(await sha256File(destination), file.sha256, 'Installer changed while copying: ' + file.name);
  }
  const proofName = 'packaged-smoke-' + platform + '-' + arch + '.json';
  const installerProofName = 'installer-smoke-' + platform + '-' + arch + '.json';
  const launcherProofName = 'launcher-smoke-' + platform + '-' + arch + '.json';
  const codexProofName = 'codex-native-' + platform + '-' + arch + '.json';
  const codexTapName = 'codex-native-' + platform + '-' + arch + '.tap';
  // Write the same bytes validated above; a changed source receipt cannot replace the evidence.
  for (const [name, bytes] of [[proofName, packaged.bytes], [installerProofName, installer.bytes], [launcherProofName, launcher.bytes],
    [codexProofName, codex.bytes], [codexTapName, codexTap]]) await fs.writeFile(path.join(uploadDir, name), bytes, { flag: 'wx' });
  const manifest = {
    version, tag: 'v' + version, commit, platform, arch,
    developerIdSigningOrNotarization: 'not performed by this workflow',
    windowsAuthenticodeSigning: 'not performed by this workflow',
    packagedSmoke: proofName, installerSmoke: installerProofName, launcherSmoke: launcherProofName,
    applicationArchiveSha256: packaged.proof.appAsarSha256,
    nativeCodex: { version: codexVersion, sha256: codexProof.nativeSha256, proof: codexProofName, tap: codexTapName },
    files
  };
  await fs.writeFile(path.join(uploadDir, 'artifact-manifest-' + platform + '-' + arch + '.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  await fs.writeFile(path.join(uploadDir, 'SHA256SUMS-' + platform + '-' + arch + '.txt'), files.map(file => file.sha256 + ' *' + file.name + '\n').join(''), { flag: 'wx' });
  return manifest;
}

export function parseArtifactArguments(args) {
  const supported = ['--platform', '--arch', '--version', '--commit', '--output', '--upload-dir', '--proof', '--installer-proof',
    '--launcher-proof', '--codex-version', '--codex-proof', '--codex-tap'];
  const result = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index], value = args[index + 1];
    assert.ok(supported.includes(key) && typeof value === 'string' && value.trim() && !value.startsWith('--') && !value.includes('\0'), 'Expected a supported argument and value');
    assert.ok(!Object.hasOwn(result, key), 'Duplicate argument');
    result[key] = value;
  }
  assert.deepEqual(Object.keys(result).sort(), [...supported].sort(), 'All artifact arguments and evidence paths are required');
  return result;
}

async function main() {
  const args = parseArtifactArguments(process.argv.slice(2));
  const manifest = await stageReleaseArtifacts({
    platform: args['--platform'], arch: args['--arch'], version: args['--version'], commit: args['--commit'],
    outputDir: path.resolve(args['--output']), uploadDir: path.resolve(args['--upload-dir']), proofPath: path.resolve(args['--proof']),
    installerProofPath: path.resolve(args['--installer-proof']), launcherProofPath: path.resolve(args['--launcher-proof']),
    codexVersion: args['--codex-version'], codexProofPath: path.resolve(args['--codex-proof']), codexTapPath: path.resolve(args['--codex-tap'])
  });
  console.log(JSON.stringify(manifest));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
