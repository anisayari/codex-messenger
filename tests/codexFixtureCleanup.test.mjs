import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter, once } from "node:events";
import fs from "node:fs/promises";
import test from "node:test";
import { createOwnedCodexFixture } from "./helpers/ownedCodexFixture.mjs";

test("Codex fixture waits for the actual owned Node child to finish its shutdown writes before removing its directory", { timeout: 10000 }, async t => {
  const fixture = await createOwnedCodexFixture();
  const child = spawn(process.execPath, ["--input-type=module", "-e", `
    import fs from 'node:fs';
    import path from 'node:path';
    process.on('message', message => {
      if (message === 'shutdown') setTimeout(() => {
        fs.writeFileSync(path.join(process.argv[1], 'late-shutdown-write.txt'), 'owned unit fixture');
        process.exit(0);
      }, 75);
    });
    process.send('ready');
  `, fixture.directory], { stdio: ["ignore", "ignore", "ignore", "ipc"] });
  const observed = fixture.observe(child);
  t.after(async () => {
    if (!observed.closed) { child.kill("SIGKILL"); await once(child, "close"); }
    await fs.rm(fixture.directory, { recursive: true, force: true });
  });
  assert.equal((await once(child, "message"))[0], "ready");
  await fixture.disposeAndRemove(() => child.send("shutdown"));
  assert.equal(observed.closed, true); assert.equal(child.exitCode, 0);
  await assert.rejects(fs.lstat(fixture.directory), { code: "ENOENT" });
});

test("Codex fixture remembers a close observed before disposal and does not wait for a missed event", { timeout: 10000 }, async () => {
  const fixture = await createOwnedCodexFixture();
  const child = spawn(process.execPath, ["-e", "process.exit(0)"], { stdio: "ignore" });
  const observed = fixture.observe(child);
  await once(child, "close");
  assert.equal(observed.closed, true);
  await fixture.disposeAndRemove(() => {});
  await assert.rejects(fs.lstat(fixture.directory), { code: "ENOENT" });
});

test("Codex fixture rejects a missing close after bounded waits and preserves its directory", async t => {
  const fixture = await createOwnedCodexFixture();
  t.after(() => fs.rm(fixture.directory, { recursive: true, force: true }));
  // This explicit unit double has no OS process and cannot prove native exit.
  const child = new EventEmitter();
  Object.assign(child, { pid: 123, exitCode: null, signalCode: null });
  const signals = []; child.kill = signal => { signals.push(signal); return true; };
  fixture.observe(child);
  const started = Date.now();
  await assert.rejects(fixture.disposeAndRemove(() => {}, { graceMs: 15, forceMs: 15 }), /CODEX_FIXTURE_CHILD_CLOSE_TIMEOUT/);
  assert.deepEqual(signals, ["SIGKILL"]); assert.ok(Date.now() - started < 1000);
  assert.equal((await fs.lstat(fixture.directory)).isDirectory(), true);
});
