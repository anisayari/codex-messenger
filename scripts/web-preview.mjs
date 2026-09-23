import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

export function waitForChild(child) {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

export async function stopChild(child, { platform = process.platform, terminateTree } = {}) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  const closed = new Promise(resolve => child.once('close', resolve));
  if (platform === 'win32') {
    // Kill the owned tree while the parent still exists; killing its Node wrapper first
    // would prevent both the wrapper's finally block and taskkill from finding Electron.
    if (terminateTree) await terminateTree(child.pid);
    else {
      const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore' });
      const killTimer = setTimeout(() => killer.kill(), 4000);
      try { await waitForChild(killer); } finally { clearTimeout(killTimer); }
    }
  } else child.kill('SIGTERM');
  let timer;
  await Promise.race([closed, new Promise(resolve => { timer = setTimeout(resolve, 4000); })]);
  clearTimeout(timer);
  if (child.exitCode === null && child.signalCode === null) {
    if (platform !== 'win32') child.kill('SIGKILL');
    const done = await Promise.race([closed.then(() => true), new Promise(resolve => { timer = setTimeout(() => resolve(false), 2000); })]);
    clearTimeout(timer);
    if (!done) throw new Error('Owned application process did not terminate.');
  }
}

export async function startPreviewServer({ root, createServer } = {}) {
  const factory = createServer || (await import('vite')).createServer;
  const server = await factory({ root: root || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
    server: { host: '127.0.0.1', port: 5174, strictPort: true } });
  try { await server.listen(); }
  catch (error) { await server.close(); throw error; }
  return server;
}

export function browserCommand(platform = process.platform) {
  const url = 'http://127.0.0.1:5174/';
  if (platform === 'darwin') return { command: '/usr/bin/open', args: [url] };
  if (platform === 'win32') return { command: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', url] };
  return { command: 'xdg-open', args: [url] };
}

export async function runWebPreview({ createServer, openBrowser } = {}) {
  let server, opener, interrupted = false;
  let stop;
  const stopped = new Promise(resolve => { stop = resolve; });
  const onSignal = () => { interrupted = true; stop(); void stopChild(opener).catch(() => {}); };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  try {
    server = await startPreviewServer({ createServer });
    if (interrupted) return;
    if (openBrowser) await Promise.race([openBrowser(), stopped]);
    else {
      const launch = browserCommand();
      opener = spawn(launch.command, launch.args, { shell: false, stdio: 'inherit' });
      const code = await waitForChild(opener);
      if (code !== 0 && !interrupted) throw new Error(`Opening the browser failed (${code}).`);
    }
    if (!interrupted) console.log('Codex Messenger web preview: http://127.0.0.1:5174/ (Ctrl+C to stop)');
    await stopped;
  } finally {
    try { await stopChild(opener); }
    finally {
      await server?.close();
      process.removeListener('SIGINT', onSignal);
      process.removeListener('SIGTERM', onSignal);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await runWebPreview(); }
  catch (error) { console.error(`Codex Messenger web preview failed: ${error.message}`); process.exitCode = 1; }
}
