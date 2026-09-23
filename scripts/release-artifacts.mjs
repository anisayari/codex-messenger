import assert from 'node:assert/strict';
import { createReadStream, constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { canonicalReleaseVersion } from './release-metadata.mjs';

export function expectedInstallers({ platform, arch, version }) {
  canonicalReleaseVersion(version);
  assert.ok(platform === 'windows' || platform === 'macos', 'Unsupported installer platform');
  assert.ok(arch === 'x64' || (platform === 'macos' && arch === 'arm64'), 'Unsupported installer architecture');
  return platform === 'windows'
    ? [`Codex Messenger Setup ${version}.exe`, `Codex Messenger ${version}.exe`]
    : [`Codex-Messenger-${version}-${arch}.dmg`, `Codex-Messenger-${version}-${arch}.zip`];
}

export async function sha256File(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

export async function stageReleaseArtifacts({ platform, arch, version, commit, outputDir, uploadDir, proofPath }) {
  const names = expectedInstallers({ platform, arch, version });
  assert.match(commit, /^[0-9a-f]{40}(?![\s\S])/, 'Source commit must be a full lowercase Git SHA');
  const proof = JSON.parse(await fs.readFile(proofPath, 'utf8'));
  assert.equal(proof.passed, true, 'Packaged application smoke must pass before upload');
  assert.equal(proof.version, version, 'Packaged smoke version must match installers');
  assert.equal(proof.platform, platform, 'Packaged smoke platform must match installers');
  assert.equal(proof.arch, arch, 'Packaged smoke architecture must match installers');
  await fs.mkdir(uploadDir, { recursive: true });
  const files = [];
  for (const name of names) {
    const source = path.join(outputDir, name);
    const stat = await fs.lstat(source);
    assert.ok(stat.isFile() && !stat.isSymbolicLink(), `Installer must be a regular file: ${name}`);
    assert.ok(stat.size >= 1024, `Installer is unexpectedly small: ${name}`);
    const sha256 = await sha256File(source);
    const target = path.join(uploadDir, name);
    await fs.copyFile(source, target, constants.COPYFILE_EXCL);
    assert.equal(await sha256File(target), sha256, `Installer changed while copying: ${name}`);
    files.push({ name, bytes: stat.size, sha256 });
  }
  const proofName = `packaged-smoke-${platform}-${arch}.json`;
  await fs.copyFile(proofPath, path.join(uploadDir, proofName), constants.COPYFILE_EXCL);
  const manifest = {
    version, tag: `v${version}`, commit, platform, arch,
    developerIdSigningOrNotarization: 'not performed by this workflow',
    windowsAuthenticodeSigning: 'not performed by this workflow',
    packagedSmoke: proofName,
    files
  };
  await fs.writeFile(path.join(uploadDir, `artifact-manifest-${platform}-${arch}.json`), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  await fs.writeFile(path.join(uploadDir, `SHA256SUMS-${platform}-${arch}.txt`), files.map((file) => `${file.sha256} *${file.name}\n`).join(''), { flag: 'wx' });
  return manifest;
}

function parseArgs(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    assert.ok(['--platform', '--arch', '--version', '--commit', '--output', '--upload-dir', '--proof'].includes(key) && args[index + 1], 'Expected a supported argument and value');
    assert.ok(!(key in result), 'Duplicate argument');
    result[key] = args[index + 1];
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifest = await stageReleaseArtifacts({
    platform: args['--platform'], arch: args['--arch'], version: args['--version'], commit: args['--commit'],
    outputDir: path.resolve(args['--output']), uploadDir: path.resolve(args['--upload-dir']), proofPath: path.resolve(args['--proof'])
  });
  console.log(JSON.stringify(manifest));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
