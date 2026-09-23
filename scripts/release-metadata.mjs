import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function canonicalReleaseVersion(value) {
  assert.equal(typeof value, 'string', 'Release version must be a string');
  assert.match(value, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?![\s\S])/, 'Release version must be a canonical stable semantic version');
  return value;
}

export function validateReleaseMetadata(packageJson, packageLock, { tag = '', commit = '', sourceCommit = '' } = {}) {
  const version = canonicalReleaseVersion(packageJson.version);
  assert.equal(packageLock.version, version, 'Lockfile version must match package version');
  assert.equal(packageLock.packages?.['']?.version, version, 'Lockfile root version must match package version');
  assert.equal(packageJson.build?.buildVersion, version, 'Build version must match stable package version');
  assert.equal(packageJson.build?.asar, true, 'Release must use app.asar');
  const expectedTag = `v${version}`;
  assert.equal(tag || expectedTag, expectedTag, 'Release tag must match the package version');
  assert.match(sourceCommit, /^[0-9a-f]{40}(?![\s\S])/, 'Workflow source commit must be a full lowercase Git SHA');
  assert.equal(commit || sourceCommit, sourceCommit, 'Requested commit must equal the dispatched workflow commit');
  return { version, tag: expectedTag, commit: sourceCommit };
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const [packageText, lockText] = await Promise.all([
    fs.readFile(path.join(root, 'package.json'), 'utf8'),
    fs.readFile(path.join(root, 'package-lock.json'), 'utf8')
  ]);
  const result = validateReleaseMetadata(JSON.parse(packageText), JSON.parse(lockText), {
    tag: process.env.RELEASE_TAG || '',
    commit: process.env.RELEASE_COMMIT || '',
    sourceCommit: process.env.GITHUB_SHA || ''
  });
  if (process.env.GITHUB_OUTPUT) {
    await fs.appendFile(process.env.GITHUB_OUTPUT, Object.entries(result).map(([key, value]) => `${key}=${value}\n`).join(''));
  }
  console.log(JSON.stringify(result));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
