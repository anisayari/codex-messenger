import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startPreviewServer, waitForChild, stopChild } from './web-preview.mjs';

export const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function run(command, args) {
  const child = spawn(command, args, { cwd: rootDir, stdio: 'ignore', shell: false });
  const code = await waitForChild(child);
  if (code !== 0) throw new Error(`${path.basename(command)} failed (${code}).`);
}

export function electronArguments(projectRoot, args = []) {
  return [path.resolve(projectRoot), ...args];
}

export async function devElectronCommand(args = []) {
  if (process.platform !== 'darwin') {
    const { default: executable } = await import('electron');
    return { command: executable, args: electronArguments(rootDir, args) };
  }
  const sourceApp = path.join(rootDir, 'node_modules', 'electron', 'dist', 'Electron.app');
  const devApp = path.join(rootDir, '.tmp', 'Codex Messenger Dev.app');
  const plist = path.join(devApp, 'Contents', 'Info.plist');
  await fs.mkdir(path.dirname(devApp), { recursive: true });
  await fs.rm(devApp, { recursive: true, force: true });
  await run('/bin/cp', ['-R', sourceApp, devApp]);
  await fs.copyFile(path.join(rootDir, 'public', 'icons', 'codex-messenger.icns'), path.join(devApp, 'Contents', 'Resources', 'electron.icns'));
  for (const [key, value] of Object.entries({ CFBundleName: 'Codex Messenger Dev', CFBundleDisplayName: 'Codex Messenger Dev', CFBundleIdentifier: 'com.codex.messenger.dev' })) {
    await run('/usr/libexec/PlistBuddy', ['-c', `Set :${key} ${value}`, plist]);
  }
  const config = JSON.parse(await fs.readFile(path.join(rootDir, 'package.json'), 'utf8'));
  for (const key of ['NSCameraUsageDescription', 'NSMicrophoneUsageDescription']) {
    const value = config.build?.mac?.extendInfo?.[key];
    if (typeof value !== 'string' || !value.trim() || /[\r\n]/.test(value)) throw new Error(`Missing ${key}.`);
    await run('/usr/libexec/PlistBuddy', ['-c', `Delete :${key}`, plist]).catch(() => {});
    await run('/usr/libexec/PlistBuddy', ['-c', `Add :${key} string ${value}`, plist]);
  }
  // Changing the vendor bundle's metadata invalidates its resource seal. Keep
  // this development identity locally signed after updating its icon and plist.
  await run('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', '--preserve-metadata=entitlements', devApp]);
  await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', devApp]);
  return { command: path.join(devApp, 'Contents', 'MacOS', 'Electron'), args: electronArguments(rootDir, args) };
}

export async function runDevelopment(args = [], { createServer, command = devElectronCommand, spawnChild = spawn } = {}) {
  let server, child;
  let interrupted = false;
  const onSignal = () => { interrupted = true; void stopChild(child).catch(() => {}); };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  try {
    server = await startPreviewServer({ root: rootDir, createServer });
    if (interrupted) return 130;
    const launch = await command(args);
    if (interrupted) return 130;
    child = spawnChild(launch.command, launch.args, { cwd: rootDir, stdio: 'inherit', shell: false,
      env: { ...process.env, VITE_DEV_SERVER_URL: 'http://127.0.0.1:5174/' } });
    const code = await waitForChild(child);
    return interrupted ? 130 : code;
  } finally {
    try { await stopChild(child); }
    finally {
      await server?.close();
      process.removeListener('SIGINT', onSignal);
      process.removeListener('SIGTERM', onSignal);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = await runDevelopment(process.argv.slice(2)); }
  catch (error) { console.error(`Codex Messenger development launch failed: ${error.message}`); process.exitCode = 1; }
}
