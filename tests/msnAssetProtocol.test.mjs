import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createMsnAssetHandler, resolveMsnAssetPath } from "../electron/msnAssetProtocol.js";
const movie = "msn-assets/msn75/packages/winks/msgslang_WINK_1129_9/heart.swf";
const wasm = "msn-assets/ruffle/0.6.0/72a20ef1c0b8ceb37720.wasm";
const script = "msn-assets/ruffle/0.6.0/ruffle.js";
const url = asset => "msn-asset://local/" + asset;

test("native assets return exact known local bytes with MIME and opaque-file CORS", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "msn-asset-bytes-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const [asset, body, mime] of [[movie, "FWS-original-fixture", "application/x-shockwave-flash"], [wasm, "wasm-fixture", "application/wasm"], [script, "local-runtime-fixture", "application/javascript"]]) {
    await fs.mkdir(path.dirname(path.join(root, asset)), { recursive: true });
    await fs.writeFile(path.join(root, asset), body);
    const response = await createMsnAssetHandler({ assetRoot: root })({ url: url(asset), method: "GET" });
    assert.equal(response.status, 200); assert.equal(await response.text(), body);
    assert.equal(response.headers.get("content-type"), mime);
    assert.equal(response.headers.get("access-control-allow-origin"), "null");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  }
});

test("native asset allowlist rejects unknown resources, methods, credentials and traversal without disk reads", async () => {
  let reads = 0;
  const handler = createMsnAssetHandler({ assetRoot: "/tmp/nonexistent", fileSystem: {
    realpath() { reads++; throw new Error("Unexpected disk read"); }
  } });
  for (const candidate of [
    "msn-asset://local/package.json", "msn-asset://other/" + movie,
    "msn-asset://user:password@local/" + movie, "msn-asset://local:9000/" + movie,
    url(movie) + "?extra=1", url(movie) + "#extra", "msn-asset://local/../" + movie,
    "msn-asset://local/%2e%2e/" + movie, "msn-asset://local/" + movie.replace("heart", "%68eart"),
    "file:///tmp/" + movie, "https://local/" + movie
  ]) {
    assert.equal(resolveMsnAssetPath(candidate), null, candidate);
    const response = await handler({ url: candidate, method: "GET" });
    assert.equal(response.status, 404, candidate);
  }
  assert.equal((await handler({ url: url(movie), method: "POST" })).status, 405);
  assert.equal(reads, 0);
});

test("native asset handler refuses symlinks outside the asset root and oversized files", async t => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "msn-asset-boundary-"));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const root = path.join(parent, "assets"); const target = path.join(root, movie);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const outside = path.join(parent, "outside.txt"); await fs.writeFile(outside, "private-fixture");
  await fs.symlink(outside, target);
  const handler = createMsnAssetHandler({ assetRoot: root, maxAssetBytes: 4 });
  const escaped = await handler({ url: url(movie), method: "GET" });
  assert.equal(escaped.status, 404); assert.equal(await escaped.text(), "Asset unavailable");
  await fs.unlink(target); await fs.writeFile(target, "oversized-fixture");
  const oversized = await handler({ url: url(movie), method: "GET" });
  assert.equal(oversized.status, 404); assert.equal(await oversized.text(), "Asset unavailable");
});
