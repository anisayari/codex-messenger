import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const source = (await fs.readFile(new URL('../build/installer.nsh', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
const body = source.match(/Function \$\{CM_GUARD_PREFIX\}cmCheckAppRunning\n([\s\S]*?)\nFunctionEnd/)[1];

// Execute the production NSIS control flow with injected native results. This
// verifies branch outcomes; actual plugin execution is covered by Windows smoke.
function runGuard(results, { silent = true, answers = [] } = {}) {
  const lines = body.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith(';'));
  const labels = new Map(lines.flatMap((line, index) => line.endsWith(':') ? [[line.slice(0, -1), index]] : []));
  const variables = {}, stack = [], phases = [];
  let pc = 0, calls = 0, waits = 0, unloads = 0, prompts = 0, errorLevel = 0;
  const value = token => token?.replace(/^"|"$/g, '').replace(/\$[A-Za-z0-9]+/g, name => variables[name] ?? '');
  const jump = label => { assert.ok(labels.has(label), `Unknown label ${label}`); pc = labels.get(label); };
  const finish = passed => ({ passed, calls, waits, unloads, prompts, errorLevel, phases });
  for (let steps = 0; steps < 1000 && pc < lines.length; steps++) {
    const line = lines[pc++];
    if (line.endsWith(':')) continue;
    const [op, ...args] = line.match(/"[^"]*"|\S+/g);
    switch (op) {
      case 'StrCpy': variables[args[0]] = value(args[1]); break;
      case 'nsProcess::_FindProcess':
        assert.equal(args[0], '/NOUNLOAD');
        assert.equal(args[1], '"${PRODUCT_FILENAME}.exe"');
        stack.push(String(results[Math.min(calls++, results.length - 1)])); break;
      case 'Pop': variables[args[0]] = stack.pop(); break;
      case 'Push': stack.push(value(args[0])); break;
      case 'Call':
        assert.equal(args[0], '${CM_GUARD_PREFIX}cmTracePhase');
        phases.push(stack.pop()); break;
      case 'StrCmp': {
        const target = value(args[0]) === value(args[1]) ? args[2] : args[3];
        if (target) jump(target); break;
      }
      case 'IfSilent': jump(silent ? args[0] : args[1]); break;
      case 'IntCmp': {
        const left = Number(value(args[0])), right = Number(value(args[1]));
        jump(left === right ? args[2] : left < right ? args[3] : args[4]); break;
      }
      case 'Sleep': waits += Number(value(args[0])); break;
      case 'IntOp':
        assert.equal(args[2], '+');
        variables[args[0]] = String(Number(value(args[1])) + Number(value(args[3]))); break;
      case 'Goto': jump(args[0]); break;
      case 'MessageBox':
        if (!silent) prompts++;
        assert.ok(args.includes('/SD'), 'Every dialog needs a silent default');
        if (args[0].includes('MB_RETRYCANCEL')) {
          assert.ok(args.includes('IDCANCEL'));
          if (answers.shift() === 'retry') jump(args[args.indexOf('IDRETRY') + 1]);
        }
        break;
      case 'DetailPrint': break;
      case 'nsProcess::_Unload': unloads++; break;
      case 'SetErrorLevel': errorLevel = Number(args[0]); break;
      case 'ClearErrors': break;
      case 'Quit': return finish(false);
      case 'Return': assert.equal(stack.length, 0); return finish(true);
      default: assert.fail(`Unsupported production NSIS instruction: ${line}`);
    }
  }
  assert.fail('Process guard did not finish within the bounded test execution');
}

test('native confirmed absence alone permits install and removes the PowerShell dependency', () => {
  assert.deepEqual(runGuard([603]), { passed: true, calls: 1, waits: 0, unloads: 1, prompts: 0,
    errorLevel: 0, phases: ['PROCESS_ABSENT'] });
  const custom = source.match(/!macro customCheckAppRunning\n([\s\S]*?)\n!macroend/)[1];
  assert.match(custom, /Call un\.cmCheckAppRunning/);
  assert.match(custom, /Call cmCheckAppRunning/);
  assert.doesNotMatch(body + custom, /PowerShell|nsExec|KillProcess|CloseProcess|taskkill/i);
});

test('silent install refuses a running application with 42 after at most two seconds and never prompts', () => {
  const result = runGuard([0]);
  assert.equal(result.passed, false);
  assert.equal(result.errorLevel, 42);
  assert.equal(result.calls, 11);
  assert.equal(result.waits, 2000);
  assert.equal(result.unloads, 1);
  assert.equal(result.prompts, 0);
  assert.ok(result.phases.every(phase => phase === 'PROCESS_FOUND'));
});

test('an application exiting during the bounded silent wait permits install only after confirmed absence', () => {
  const result = runGuard([0, 0, 603]);
  assert.equal(result.passed, true);
  assert.equal(result.calls, 3);
  assert.equal(result.waits, 400);
  assert.deepEqual(result.phases, ['PROCESS_FOUND', 'PROCESS_FOUND', 'PROCESS_ABSENT']);
});

test('every documented native failure and unknown result stops immediately rather than treating errors as absence', () => {
  for (const code of [601, 602, 604, 605, 606, 607, 608, 609, 610, 611, 1, 999, '', 'error', 'timeout']) {
    const result = runGuard([code]);
    assert.equal(result.passed, false, String(code));
    assert.equal(result.errorLevel, 42, String(code));
    assert.equal(result.calls, 1, String(code));
    assert.equal(result.waits, 0, String(code));
    assert.equal(result.prompts, 0, String(code));
    assert.equal(result.unloads, 1, String(code));
    assert.deepEqual(result.phases, ['PROCESS_CHECK_ERROR'], String(code));
  }
});

test('interactive Retry rescans and Cancel stops without killing the application', () => {
  const retried = runGuard([0, 0, 603], { silent: false, answers: ['retry', 'retry'] });
  assert.equal(retried.passed, true);
  assert.equal(retried.prompts, 2);
  assert.equal(retried.waits, 0);
  const cancelled = runGuard([0], { silent: false, answers: ['cancel'] });
  assert.equal(cancelled.passed, false);
  assert.equal(cancelled.errorLevel, 42);
  assert.equal(cancelled.calls, 1);
  const failedRetry = runGuard([0, 608], { silent: false, answers: ['retry'] });
  assert.equal(failedRetry.passed, false);
  assert.equal(failedRetry.errorLevel, 42);
  assert.deepEqual(failedRetry.phases, ['PROCESS_FOUND', 'PROCESS_CHECK_ERROR']);
});
