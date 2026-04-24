import assert from "node:assert/strict";
import test from "node:test";
import { assertEnum, assertObject, assertString, isSafeExternalUrl } from "../electron/security.js";

test("external URL guard only allows known safe protocols and hosts", () => {
  assert.equal(isSafeExternalUrl("https://github.com/anisayari/codex-messenger"), true);
  assert.equal(isSafeExternalUrl("https://www.npmjs.com/package/@openai/codex"), true);
  assert.equal(isSafeExternalUrl("https://nodejs.org/en/download"), true);
  assert.equal(isSafeExternalUrl("http://127.0.0.1:5174/"), true);
  assert.equal(isSafeExternalUrl("mailto:hello@example.com"), true);

  assert.equal(isSafeExternalUrl("javascript:alert(1)"), false);
  assert.equal(isSafeExternalUrl("file:///etc/passwd"), false);
  assert.equal(isSafeExternalUrl("https://example.com/phishing"), false);
  assert.equal(isSafeExternalUrl("http://github.com/insecure"), false);
});

test("IPC validation helpers reject unsafe payload shapes", () => {
  assert.equal(assertString("codex", "contactId"), "codex");
  assert.throws(() => assertString("", "contactId"), /required/);
  assert.throws(() => assertString(42, "contactId"), /string/);
  assert.throws(() => assertString("x".repeat(20), "text", { maxLength: 10 }), /too long/);

  assert.deepEqual(assertObject({ ok: true }, "payload"), { ok: true });
  assert.throws(() => assertObject([], "payload"), /object/);

  assert.equal(assertEnum("front", ["front", "codex"], "target"), "front");
  assert.equal(assertEnum(undefined, ["front", "codex"], "target", "codex"), "codex");
  assert.throws(() => assertEnum("shell", ["front", "codex"], "target"), /one of/);
});
