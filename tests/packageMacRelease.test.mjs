import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { developerIdIdentity, notarizationCredentialSource, assertReleasePrerequisites, resolveNpmCli, macReleaseInvocations,
  runReleaseProcess, verifySigningIdentity, verifyMacRelease, packageMacRelease } from '../scripts/package-mac-release.mjs';

const teamId = 'A123456789';
const certificateHash = 'A'.repeat(40);
const certificateLine = (name = 'Fixture Signing Subject', hash = certificateHash, team = teamId) =>
  '  1) ' + hash + ' "Developer ID Application: ' + name + ' (' + team + ')"\n';
const identity = { hash: certificateHash, subject: 'Developer ID Application: Fixture Signing Subject (' + teamId + ')',
  name: 'Fixture Signing Subject (' + teamId + ')', teamId };
const signatureDetails = (selected = identity, appId = 'com.codex.messenger') =>
  'Identifier=' + appId + '\nAuthority=' + selected.subject + '\nAuthority=Developer ID Certification Authority\nTeamIdentifier=' + selected.teamId + '\n';

async function npmFixture(t, name = 'npm') {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'mac-release-npm unit ')));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const cli = path.join(directory, 'npm', 'bin', 'npm-cli.js');
  await fs.mkdir(path.dirname(cli), { recursive: true });
  await fs.writeFile(cli, '// Explicit npm CLI unit fixture, never executed.\n');
  await fs.writeFile(path.join(directory, 'npm', 'package.json'), JSON.stringify({ name, version: '0.0.0' }));
  return { directory, cli };
}

test('macOS signing selects the exact parsed certificate subject and hash for the configured team', () => {
  assert.deepEqual(developerIdIdentity(certificateLine(), teamId), identity);
  assert.deepEqual(developerIdIdentity(certificateLine() + certificateLine(), teamId), identity);
  const mixed = certificateLine('Other Subject', 'B'.repeat(40), 'B123456789') + certificateLine();
  assert.deepEqual(developerIdIdentity(mixed, teamId), identity);
  assert.throws(() => developerIdIdentity(mixed, 'C123456789'), /not found/);
  assert.throws(() => developerIdIdentity(certificateLine(), 'invalid'), /identifier/);
  assert.throws(() => developerIdIdentity(certificateLine().replace('Developer ID Application:', 'Apple Development:'), teamId), /not found/);
  assert.throws(() => developerIdIdentity(certificateLine().trimEnd() + ' (CSSMERR_TP_CERT_REVOKED)\n', teamId), /not found/);
});

test('macOS signing refuses an ambiguous team identity unless an actual subject or hash is selected', () => {
  const output = certificateLine() + certificateLine('Second Subject', 'B'.repeat(40));
  assert.throws(() => developerIdIdentity(output, teamId), /Multiple/);
  for (const preference of [certificateHash.toLowerCase(), identity.subject, identity.name]) {
    assert.deepEqual(developerIdIdentity(output, teamId, preference), identity);
  }
  assert.throws(() => developerIdIdentity(output, teamId, 'Invented Signing Subject'), /not found/);
});

test('notarization uses electron-builder credential precedence and rejects partial credentials without probing or exposing them', async () => {
  let calls = 0;
  const exec = async () => { calls += 1; throw Error('fixture failure'); };
  const api = { APPLE_API_KEY: 'fixture key path', APPLE_API_KEY_ID: 'fixture id', APPLE_API_ISSUER: 'fixture issuer' };
  assert.equal(await notarizationCredentialSource(api, exec), 'App Store Connect API key');
  assert.equal(await notarizationCredentialSource({ ...api, APPLE_ID: 'fixture apple id', APPLE_APP_SPECIFIC_PASSWORD: 'fixture password', APPLE_TEAM_ID: teamId }, exec), 'Apple ID app-specific password');
  for (const env of [{ APPLE_ID: 'fixture apple id', ...api }, { APPLE_API_KEY: 'fixture key path' },
    { APPLE_ID: 'fixture apple id', APPLE_APP_SPECIFIC_PASSWORD: 'fixture password' }]) {
    await assert.rejects(notarizationCredentialSource(env, exec), /Complete/);
  }
  assert.equal(calls, 0);
});

test('notarytool validates the selected keychain profile and keychain before a build', async () => {
  const calls = [];
  const env = { APPLE_TEAM_ID: teamId, APPLE_KEYCHAIN_PROFILE: 'profile with spaces', APPLE_KEYCHAIN: '/private fixture/keychain with spaces' };
  assert.equal(await notarizationCredentialSource(env, async (...args) => { calls.push(args); return {}; }), 'notarytool keychain profile');
  assert.deepEqual(calls[0].slice(0, 2), ['xcrun', ['notarytool', 'history', '--keychain-profile', env.APPLE_KEYCHAIN_PROFILE, '--keychain', env.APPLE_KEYCHAIN]]);
  assert.equal(calls[0][2].env.APPLE_TEAM_ID, teamId);
  await assert.rejects(notarizationCredentialSource(env, async () => { throw Error('fixture credential secret should not escape'); }),
    error => /usable/.test(error.message) && !error.message.includes('secret'));
  const fallback = { APPLE_TEAM_ID: teamId };
  await notarizationCredentialSource(fallback, async () => ({}));
  assert.equal(fallback.APPLE_KEYCHAIN_PROFILE, 'codex-messenger');
});

test('release prerequisites honor the explicit team without mutating the original environment and fail before building', async () => {
  const env = { APPLE_TEAM_ID: teamId, APPLE_KEYCHAIN_PROFILE: 'fixture profile' };
  const calls = [];
  const result = await assertReleasePrerequisites({ platform: 'darwin', env, exec: async (command, args, options) => {
    calls.push({ command, args, options });
    return { stdout: command === 'security' ? certificateLine() : '' };
  } });
  assert.deepEqual(result.identity, identity);
  assert.equal(result.env.APPLE_TEAM_ID, teamId);
  assert.notEqual(result.env, env);
  assert.equal(calls.length, 2);
  let builds = 0;
  const dependencies = { run: async () => { builds += 1; }, exec: async () => ({ stdout: '0 valid identities found\n' }), log: () => {} };
  await assert.rejects(packageMacRelease({ platform: 'darwin', env }, dependencies), /not found/);
  await assert.rejects(packageMacRelease({ platform: 'linux', env }, dependencies), /macOS/);
  await assert.rejects(packageMacRelease({ platform: 'darwin', env }, { ...dependencies,
    exec: async command => { if (command === 'xcrun') throw Error('fixture keychain rejection'); return { stdout: certificateLine() }; } }), /usable/);
  assert.equal(builds, 0);
});

test('npm CLI resolution uses a real npm JS entry point and can fall back without relying on a shell or PATH Node', async t => {
  const { cli, directory } = await npmFixture(t);
  let lookups = 0;
  assert.equal(await resolveNpmCli({ env: { npm_execpath: cli }, nodeExecutable: path.join(directory, 'node'),
    findNpm: async () => { lookups += 1; throw Error('should not look up PATH'); } }), cli);
  assert.equal(lookups, 0);
  const unrelated = await npmFixture(t, 'unrelated-package');
  assert.equal(await resolveNpmCli({ env: { npm_execpath: unrelated.cli }, nodeExecutable: path.join(directory, 'missing-node'),
    findNpm: async () => ({ ok: true, command: cli }) }), cli);
  await assert.rejects(resolveNpmCli({ env: {}, nodeExecutable: path.join(directory, 'missing-node'),
    findNpm: async () => ({ ok: true, command: unrelated.cli }) }), /npm JavaScript CLI/);
});

test('release invocations preserve literal spaces, pin the parsed certificate hash and require actual DMG signing', () => {
  const root = path.join(os.tmpdir(), 'project with spaces and & literal');
  const nodeExecutable = path.join(root, 'runtime', 'node');
  const npmCli = path.join(root, 'npm', 'bin', 'npm-cli.js');
  const [build, pack] = macReleaseInvocations({ root, nodeExecutable, npmCli, identity, arch: 'arm64' });
  assert.deepEqual(build, { command: nodeExecutable, args: [npmCli, 'run', 'build'] });
  assert.equal(pack.command, nodeExecutable);
  assert.equal(pack.args[0], path.join(root, 'scripts/electron-builder-release-version.mjs'));
  for (const required of ['--arm64', '-c.mac.identity=' + certificateHash, '-c.mac.forceCodeSigning=true', '-c.dmg.sign=true', '--publish', 'never']) {
    assert.ok(pack.args.includes(required));
  }
  assert.ok(!pack.args.some(arg => arg.includes('Fixture Signing Subject')));
  assert.throws(() => macReleaseInvocations({ root, nodeExecutable, npmCli, identity, arch: 'ia32' }), /architecture/);
});

test('release runner uses shared spawn semantics with explicit cwd and resolves only on a successful clean close', async () => {
  let invocation;
  const spawn = (command, args, options) => {
    invocation = { command, args, options };
    const child = new EventEmitter();
    queueMicrotask(() => child.emit('close', 0, null));
    return child;
  };
  await runReleaseProcess('/node path/node', ['/npm path/npm-cli.js', 'run', 'build'], { spawn, cwd: '/project path', env: { PATH: '/runtime bin' }, shell: true });
  assert.equal(invocation.options.shell, false);
  assert.equal(invocation.options.cwd, '/project path');
  assert.deepEqual(invocation.args, ['/npm path/npm-cli.js', 'run', 'build']);
  for (const [code, signal] of [[1, null], [null, 'SIGTERM'], [0, 'SIGTERM']]) {
    await assert.rejects(runReleaseProcess('/node', [], { spawn: () => {
      const child = new EventEmitter();
      queueMicrotask(() => child.emit('close', code, signal));
      return child;
    } }), /did not complete/);
  }
});

test('signature details must report the selected real subject, team and application identifier', () => {
  verifySigningIdentity(signatureDetails(), { identity, appId: 'com.codex.messenger' });
  for (const output of [signatureDetails().replace('A123456789', 'B123456789'),
    signatureDetails().replace('Fixture Signing Subject', 'Forged Subject'),
    signatureDetails().replace('Identifier=com.codex.messenger', 'Identifier=another.app')]) {
    assert.throws(() => verifySigningIdentity(output, { identity, appId: 'com.codex.messenger' }));
  }
});

test('post-build verification only reports mock checks after codesign, Gatekeeper and stapler all succeed, without claiming DMG notarization', async () => {
  const options = { application: '/fixture app/Codex Messenger.app', diskImage: '/fixture dmg/file.dmg', identity, appId: 'com.codex.messenger' };
  const calls = [];
  const exec = async (command, args) => {
    calls.push({ command, args });
    return { stdout: '', stderr: args.includes('--display') ? signatureDetails() : '' };
  };
  const result = await verifyMacRelease({ ...options, exec });
  assert.equal(result.application.notarizationTicket, true);
  assert.equal(result.diskImage.signature, true);
  assert.equal(result.diskImage.notarizationVerified, false);
  assert.equal(calls.length, 6);
  assert.deepEqual(calls[2], { command: 'spctl', args: ['--assess', '--type', 'execute', '--verbose=4', options.application] });
  assert.deepEqual(calls[3], { command: 'xcrun', args: ['stapler', 'validate', options.application] });
  for (const failingIndex of [0, 1, 2, 3, 4, 5]) {
    let index = 0;
    await assert.rejects(verifyMacRelease({ ...options, exec: async (command, args) => {
      if (index++ === failingIndex) throw Error('mock tool failed');
      return exec(command, args);
    } }), /mock tool failed/);
  }
});

test('complete mocked packaging builds in the repository with current Node and logs verified claims only after post-build tools', async t => {
  const { cli, directory } = await npmFixture(t);
  const root = path.join(directory, 'project with spaces');
  await fs.mkdir(root);
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ version: '0.0.3', build: { appId: 'com.codex.messenger' } }));
  const logs = [], runs = [], tools = [];
  const env = { APPLE_TEAM_ID: teamId, APPLE_KEYCHAIN_PROFILE: 'fixture profile', npm_execpath: cli, PATH: '/usr/bin:/bin' };
  const dependencies = {
    exec: async (command, args) => {
      tools.push({ command, args });
      return { stdout: command === 'security' ? certificateLine() : '', stderr: args.includes('--display') ? signatureDetails() : '' };
    },
    run: async (command, args, options) => {
      runs.push({ command, args, options });
      if (runs.length === 2) {
        const output = path.join(root, 'release', 'macos');
        await fs.mkdir(path.join(output, 'mac-arm64', 'Codex Messenger.app'), { recursive: true });
        for (const extension of ['dmg', 'zip']) await fs.writeFile(path.join(output, 'Codex-Messenger-0.0.3-arm64.' + extension), Buffer.alloc(2048));
      }
    },
    log: value => logs.push(value)
  };
  const result = await packageMacRelease({ root, platform: 'darwin', arch: 'arm64', nodeExecutable: process.execPath, env }, dependencies);
  assert.equal(result.identity.subject, identity.subject);
  assert.equal(result.checks.diskImage.notarizationVerified, false);
  assert.equal(runs.length, 2);
  assert.ok(runs.every(run => run.command === process.execPath && run.options.cwd === root));
  assert.equal(runs[0].args[0], cli);
  assert.ok(runs[0].options.env.PATH.startsWith(path.dirname(process.execPath) + path.delimiter));
  assert.equal(env.PATH, '/usr/bin:/bin');
  assert.match(logs.at(-1), /DMG notarization has not been verified/);
  const failedLogs = [];
  await assert.rejects(packageMacRelease({ root, platform: 'darwin', arch: 'arm64', env }, {
    ...dependencies, log: value => failedLogs.push(value),
    exec: async (command, args) => { if (command === 'spctl') throw Error('mock Gatekeeper rejection'); return dependencies.exec(command, args); }
  }), /mock Gatekeeper/);
  assert.ok(!failedLogs.some(value => value.includes('notarization ticket verified')));
});
