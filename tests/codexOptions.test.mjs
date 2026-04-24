import assert from "node:assert/strict";
import test from "node:test";
import {
  codexApprovalOptions,
  codexCwdOptions,
  codexSandboxOptions,
  defaultCodexOptions,
  normalizeCodexOptions,
  optionLabel,
  sandboxPolicyForMode
} from "../shared/codexOptions.js";
import { appCopyFor, codexLanguageInstruction, normalizeLanguage } from "../shared/languages.js";

test("normalizes Codex option aliases used by saved settings", () => {
  assert.deepEqual(normalizeCodexOptions({
    model: "gpt-5.4",
    reasoningEffort: "high",
    cwdMode: "local",
    sandbox: "workspace-write",
    approvalPolicy: "on-request"
  }), {
    model: "gpt-5.4",
    reasoningEffort: "high",
    cwdMode: "local",
    sandbox: "workspaceWrite",
    approvalPolicy: "on-request"
  });

  assert.deepEqual(normalizeCodexOptions({
    model: "unknown",
    reasoningEffort: "too-much",
    cwdMode: "bad",
    sandbox: "danger-full-access",
    approvalPolicy: "always"
  }), {
    ...defaultCodexOptions,
    sandbox: "dangerFullAccess"
  });
});

test("maps UI sandbox choices to app-server sandboxPolicy payloads", () => {
  assert.equal(sandboxPolicyForMode("dangerFullAccess").type, "dangerFullAccess");
  assert.equal(sandboxPolicyForMode("external_sandbox").type, "externalSandbox");

  const workspace = sandboxPolicyForMode("workspaceWrite");
  assert.equal(workspace.type, "workspaceWrite");
  assert.equal(workspace.networkAccess, true);
  assert.deepEqual(workspace.writableRoots, []);

  const readOnly = sandboxPolicyForMode("read-only");
  assert.equal(readOnly.type, "readOnly");
  assert.equal(readOnly.networkAccess, false);
});

test("labels option values for toolbar summaries", () => {
  assert.equal(optionLabel(codexSandboxOptions, "workspaceWrite"), "Ecriture workspace");
  assert.equal(optionLabel(codexApprovalOptions, "never"), "Jamais demander");
  assert.equal(optionLabel(codexCwdOptions, "local"), "Local par defaut");
  assert.equal(optionLabel(codexSandboxOptions, "missing"), "missing");
});

test("normalizes language choices and returns Codex language instructions", () => {
  assert.equal(normalizeLanguage("fr"), "fr");
  assert.equal(normalizeLanguage("ar"), "ar");
  assert.equal(normalizeLanguage("xx", "es"), "es");
  assert.match(codexLanguageInstruction("fr"), /français/i);
  assert.match(codexLanguageInstruction("en"), /English/i);
  assert.match(codexLanguageInstruction("ar"), /العربية/);
  assert.equal(appCopyFor("ar").menu.file, "ملف");
});
