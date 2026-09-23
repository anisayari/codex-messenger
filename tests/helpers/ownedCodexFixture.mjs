import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function waitForClose(observation, milliseconds) {
  if (observation.closed) return true;
  let timer;
  try {
    return await Promise.race([observation.close.then(() => true), new Promise(resolve => {
      timer = setTimeout(() => resolve(false), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

export async function createOwnedCodexFixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "messenger-codex-contract-"));
  const identity = await fs.lstat(directory), canonical = await fs.realpath(directory);
  const observations = [];
  return {
    directory,
    observe(child) {
      const observation = { child, pid: child.pid, closed: false };
      observation.close = new Promise(resolve => child.once("close", (code, signal) => {
        observation.closed = true;
        resolve({ code, signal });
      }));
      observations.push(observation);
      return Object.freeze({ get closed() { return observation.closed; } });
    },
    async disposeAndRemove(dispose, { graceMs = 2000, forceMs = 2000 } = {}) {
      assert.ok(Number.isSafeInteger(graceMs) && graceMs > 0 && graceMs <= 2000);
      assert.ok(Number.isSafeInteger(forceMs) && forceMs > 0 && forceMs <= 2000);
      dispose();
      for (const observation of observations) {
        if (await waitForClose(observation, graceMs)) continue;
        const child = observation.child;
        if (Number.isSafeInteger(observation.pid) && observation.pid > 0 && child.pid === observation.pid &&
          child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        if (!await waitForClose(observation, forceMs)) {
          child.stdin?.destroy(); child.stdout?.destroy(); child.stderr?.destroy(); child.unref?.();
          throw new Error("CODEX_FIXTURE_CHILD_CLOSE_TIMEOUT");
        }
      }
      const before = await fs.lstat(directory);
      assert.ok(before.isDirectory() && !before.isSymbolicLink() && before.dev === identity.dev && before.ino === identity.ino &&
        await fs.realpath(directory) === canonical, "Codex fixture directory identity changed");
      const retryable = new Set(["ENOTEMPTY", "EBUSY", "EACCES", "EPERM"]);
      for (let attempt = 0; attempt < 6; attempt++) {
        try { await fs.rm(directory, { recursive: true, force: true }); break; }
        catch (error) {
          if (!retryable.has(error.code) || attempt === 5) throw error;
          await delay(100 * (attempt + 1));
        }
      }
      await assert.rejects(fs.lstat(directory), { code: "ENOENT" });
    }
  };
}
