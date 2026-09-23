import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const previewModule = new URL('../scripts/web-preview.mjs', import.meta.url).href;
const developmentModule = new URL('../scripts/dev-electron.mjs', import.meta.url).href;

function signalScenario(mode, signal) {
  return `
    import assert from 'node:assert/strict';
    import { spawn } from 'node:child_process';
    import { runWebPreview } from ${JSON.stringify(previewModule)};
    import { runDevelopment } from ${JSON.stringify(developmentModule)};

    const mode = ${JSON.stringify(mode)}, signal = ${JSON.stringify(signal)};
    const observed = { serverCloseStarted: 0, serverCloseCompleted: 0 };
    const createServer = async () => {
      // Match production ordering: the wrapper owns its signal listeners before
      // Vite imports Rolldown and installs the real signal-exit listeners.
      await import('vite');
      return {
        listen: async () => {},
        close: async () => {
          observed.serverCloseStarted++;
          await Promise.resolve();
          observed.serverCloseCompleted++;
        }
      };
    };
    const interrupt = () => {
      process.emit(signal);
      process.emit(signal);
    };

    if (mode === 'preview') {
      observed.apiResult = (await runWebPreview({ createServer, openBrowser: async () => interrupt() })) ?? null;
    } else {
      let helper;
      observed.helperReady = false;
      observed.helperCloseEvents = 0;
      observed.helperStopSignals = [];
      observed.apiResult = await runDevelopment([], {
        createServer,
        command: async () => ({
          command: process.execPath,
          args: ['-e', 'process.on("message", () => {}); process.send("ready");']
        }),
        spawnChild: (command, args, options) => {
          // Use an owned Node process instead of Electron so stopChild's actual
          // process cleanup is exercised without launching an application.
          helper = spawn(command, args, { ...options, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
          const kill = helper.kill.bind(helper);
          helper.kill = requestedSignal => {
            observed.helperStopSignals.push(requestedSignal);
            return kill(requestedSignal);
          };
          helper.once('close', (code, closedSignal) => {
            observed.helperCloseEvents++;
            observed.helperExit = { code, signal: closedSignal };
          });
          helper.once('message', message => {
            assert.equal(message, 'ready');
            observed.helperReady = true;
            interrupt();
          });
          return helper;
        }
      });
      observed.helperClosed = helper.exitCode !== null || helper.signalCode !== null;
    }
    console.log(JSON.stringify(observed));
  `;
}

for (const mode of ['preview', 'development']) {
  for (const signal of ['SIGINT', 'SIGTERM']) {
    test(`${mode} handles ${signal} after Vite imports and completes owned cleanup`, { timeout: 15_000 }, () => {
      const child = spawnSync(process.execPath, ['--input-type=module', '-e', signalScenario(mode, signal)], {
        cwd: root, encoding: 'utf8', timeout: 10_000, killSignal: 'SIGKILL', windowsHide: true
      });
      const diagnostic = JSON.stringify({ code: child.status, signal: child.signal, stdout: child.stdout, stderr: child.stderr });
      assert.ifError(child.error);
      assert.equal(child.signal, null, diagnostic);
      assert.equal(child.status, 0, diagnostic);
      const observed = JSON.parse(child.stdout.trim());
      assert.equal(observed.serverCloseStarted, 1);
      assert.equal(observed.serverCloseCompleted, 1);
      assert.equal(observed.apiResult, mode === 'preview' ? null : 130);
      if (mode === 'development') {
        assert.equal(observed.helperReady, true);
        assert.equal(observed.helperCloseEvents, 1);
        assert.equal(observed.helperClosed, true);
        if (process.platform !== 'win32') {
          assert.deepEqual(observed.helperStopSignals, ['SIGTERM']);
          assert.deepEqual(observed.helperExit, { code: null, signal: 'SIGTERM' });
        }
      }
    });
  }
}
