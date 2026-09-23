import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { runDevelopment, electronArguments, rootDir } from '../scripts/dev-electron.mjs';
import { startPreviewServer, runWebPreview, stopChild } from '../scripts/web-preview.mjs';

test('Windows cleanup terminates the owned tree before losing the parent process', async () => {
  const child = new EventEmitter();
  Object.assign(child, { pid: 1234, exitCode: null, signalCode: null, kill: () => { throw new Error('A parent-only kill would orphan its Electron child'); } });
  let terminated;
  await stopChild(child, { platform: 'win32', terminateTree: async pid => {
    terminated = pid;
    child.exitCode = 1;
    child.emit('close', 1, null);
  } });
  assert.equal(terminated, 1234);
});

test('cancelling preview while its server starts closes the server without opening a browser', async () => {
  let opened = false, closed = false;
  await runWebPreview({
    createServer: async () => ({ listen: async () => { process.emit('SIGINT'); }, close: async () => { closed = true; } }),
    openBrowser: async () => { opened = true; }
  });
  assert.equal(opened, false);
  assert.equal(closed, true);
});

test('cancelling a stalled browser opener closes the preview without waiting for it', async () => {
  let closed = false, release;
  await runWebPreview({
    createServer: async () => ({ listen: async () => {}, close: async () => { closed = true; } }),
    openBrowser: () => {
      queueMicrotask(() => process.emit('SIGTERM'));
      return new Promise(resolve => { release = resolve; });
    }
  });
  assert.equal(closed, true);
  release();
});

test('development startup closes its Vite server and propagates Electron failure', async () => {
  let closed = 0, launch;
  const code = await runDevelopment(['--smoke-test'], {
    createServer: async () => ({ listen: async () => {}, close: async () => { closed++; } }),
    command: async args => { launch = args; return { command: process.execPath, args: ['-e', 'process.exit(7)'] }; }
  });
  assert.equal(code, 7);
  assert.deepEqual(launch, ['--smoke-test']);
  assert.equal(closed, 1);
});

test('failed Electron creation releases the owned server', async () => {
  let closed = 0;
  await assert.rejects(runDevelopment([], {
    createServer: async () => ({ listen: async () => {}, close: async () => { closed++; } }),
    command: async () => ({ command: '/nonexistent-codex-messenger-test-executable', args: [] })
  }), /ENOENT/);
  assert.equal(closed, 1);
});

test('occupied Vite port prevents launching Electron or opening an unrelated web server', async () => {
  let closed = 0, launched = false;
  const failure = () => ({ listen: async () => { throw new Error('Port 5174 occupied'); }, close: async () => { closed++; } });
  await assert.rejects(runDevelopment([], { createServer: async () => failure(), command: async () => { launched = true; } }), /occupied/);
  await assert.rejects(runWebPreview({ createServer: async () => failure(), openBrowser: async () => { launched = true; } }), /occupied/);
  assert.equal(launched, false);
  assert.equal(closed, 2);
});

test('actual Vite rejects an occupied port and leaves the existing listener alive', async t => {
  const listener = net.createServer(socket => socket.end('existing server'));
  await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(5174, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => listener.close(resolve)));
  await assert.rejects(startPreviewServer({ root: rootDir }), /5174.*already in use/i);
  assert.equal(listener.listening, true);
});

test('absolute Electron project path and user arguments retain spaces as separate native arguments', () => {
  assert.deepEqual(electronArguments('/some project/Codex Messenger', ['--smoke-test', 'value with spaces']),
    [path.resolve('/some project/Codex Messenger'), '--smoke-test', 'value with spaces']);
});
