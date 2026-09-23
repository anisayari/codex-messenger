import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { renderCodexItem, mapCodexActivityNotification, createCodexOutputDecoder } from "../shared/codexTimeline.js";

const fixture = JSON.parse(fs.readFileSync(new URL("./fixtures/codexTimelineSchema-0.156.0.json", import.meta.url), "utf8"));
const definitions = fixture.definitions;
const resolve = (schema) => schema?.$ref ? definitions[schema.$ref.split("/").at(-1)] : schema;

// Check these constructed examples against the exact generated schema, rather
// than treating a fake server's accepted shape as evidence of the real contract.
function valid(value, schema) {
  schema = resolve(schema);
  if (schema === true) return true;
  if (!schema || schema === false) return false;
  if (schema.oneOf && schema.oneOf.filter((part) => valid(value, part)).length !== 1) return false;
  if (schema.anyOf && !schema.anyOf.some((part) => valid(value, part))) return false;
  if (schema.allOf && !schema.allOf.every((part) => valid(value, part))) return false;
  if (schema.enum && !schema.enum.some((part) => JSON.stringify(part) === JSON.stringify(value))) return false;
  const actualType = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => type === actualType || type === "integer" && Number.isInteger(value))) return false;
  }
  if (typeof value === "string" && schema.minLength && value.length < schema.minLength) return false;
  if (typeof value === "number" && schema.minimum !== undefined && value < schema.minimum) return false;
  if (Array.isArray(value) && schema.items && !value.every((part) => valid(part, schema.items))) return false;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if ((schema.required || []).some((key) => !(key in value))) return false;
    for (const [key, part] of Object.entries(value)) {
      if (schema.properties?.[key] && !valid(part, schema.properties[key])) return false;
      if (!(key in (schema.properties || {}))) {
        if (schema.additionalProperties === false) return false;
        if (typeof schema.additionalProperties === "object" && !valid(part, schema.additionalProperties)) return false;
      }
    }
  }
  return true;
}

function example(schema) {
  schema = resolve(schema);
  if (schema === true) return null;
  if (schema.enum) return schema.enum[0];
  if (schema.oneOf || schema.anyOf) return example((schema.oneOf || schema.anyOf)[0]);
  if (schema.allOf) return example(schema.allOf[0]);
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  if (type === "object" || schema.properties) return Object.fromEntries((schema.required || []).map((key) => [key, example(schema.properties[key])]));
  if (type === "array") return [];
  if (type === "integer" || type === "number") return schema.minimum ?? 0;
  if (type === "boolean") return false;
  if (type === "null") return null;
  return "fixture";
}

function item(value) {
  assert.equal(valid(value, definitions.ThreadItem), true, `invalid generated ThreadItem example: ${value.type}`);
  return renderCodexItem(value, { author: "Nomade", userAuthor: "Anis", time: "12:34" });
}
function notification(method, params) {
  assert.equal(valid(params, definitions[fixture.notificationSchemas[method]]), true, `invalid generated notification example: ${method}`);
  return mapCodexActivityNotification({ method, params });
}
const ids = { threadId: "thread-1", turnId: "turn-1", itemId: "item-1" };

test("every 0.156.0 generated ThreadItem type retains its identity and a display representation", () => {
  const seen = [];
  for (const schema of definitions.ThreadItem.oneOf) {
    const value = example(schema);
    const rendered = item(value);
    assert.equal(rendered.id, value.id);
    assert.equal(rendered.itemType, value.type);
    assert.equal(rendered.time, "12:34");
    assert.equal(typeof rendered.text, "string");
    assert.equal(rendered.text.includes("Element Codex:"), false, `missing adapter: ${value.type}`);
    seen.push(value.type);
  }
  assert.equal(seen.length, 19);
  assert.ok(seen.includes("functionCallOutput") && seen.includes("subAgentActivity") && seen.includes("contextCompaction"));
});

test("user and agent messages preserve actual text, question metadata and media descriptors", () => {
  const user = item({ id: "u", type: "userMessage", content: [{ type: "text", text: "Voici l'image" }, { type: "localImage", path: "/tmp/photo.png", detail: "original" }, { type: "localAudio", path: "/tmp/voix.wav" }, { type: "mention", name: "Drive", path: "app://drive" }] });
  assert.equal(user.from, "me");
  assert.equal(user.author, "Anis");
  assert.match(user.text, /Voici l'image/);
  assert.deepEqual(user.attachments, [{ type: "image", path: "/tmp/photo.png", detail: "original" }, { type: "audio", path: "/tmp/voix.wav" }]);
  const agent = item({ id: "a", type: "agentMessage", text: "Réponse réelle", phase: "commentary", questions: [] });
  assert.equal(agent.from, "them");
  assert.equal(agent.author, "Nomade");
  assert.equal(agent.text, "Réponse réelle");
  assert.deepEqual(agent.questions, []);
});

test("commands and patches keep complete stdout, exit zero, cwd and authoritative diffs", () => {
  const command = item({ id: "c", type: "commandExecution", command: "node script.mjs", cwd: "/tmp/project", status: "completed", commandActions: [], aggregatedOutput: "Résultat\n", exitCode: 0, durationMs: 0, source: "userShell" });
  assert.equal(command.exitCode, 0);
  assert.equal(command.durationMs, 0);
  assert.equal(command.aggregatedOutput, "Résultat\n");
  assert.equal(command.cwd, "/tmp/project");
  const change = { path: "/tmp/project/file.txt", kind: { type: "update", move_path: null }, diff: "@@ -1 +1 @@\n-old\n+new" };
  const file = item({ id: "f", type: "fileChange", status: "completed", changes: [change] });
  assert.deepEqual(file.changes, [change]);
  assert.match(file.text, /\+new/);
});

test("MCP, dynamic and code-mode function outputs display only provided result content", () => {
  const mcp = item({ id: "m", type: "mcpToolCall", server: "server", tool: "lookup", arguments: {}, status: "completed", result: { content: [{ type: "text", text: "vrai résultat" }, { type: "image", mimeType: "image/png", data: "aW1hZ2U=" }] } });
  assert.match(mcp.text, /vrai résultat/);
  assert.equal(mcp.attachments[0].src, "data:image/png;base64,aW1hZ2U=");
  const dynamic = item({ id: "d", type: "dynamicToolCall", tool: "audio", arguments: {}, status: "completed", success: true, contentItems: [{ type: "inputAudio", audioUrl: "data:audio/wav;base64,YXVkaW8=" }] });
  assert.equal(dynamic.attachments[0].type, "audio");
  const code = item({ id: "code", type: "functionCallOutput", name: "exec", namespace: "functions", output: [{ type: "input_text", text: "sortie JS" }, { type: "encrypted_content", encrypted_content: "NEVER-DISPLAY-CIPHERTEXT" }] });
  assert.match(code.text, /sortie JS/);
  assert.equal(JSON.stringify(code).includes("NEVER-DISPLAY-CIPHERTEXT"), false);
  const error = item({ id: "e", type: "mcpToolCall", server: "server", tool: "lookup", arguments: {}, status: "failed", error: { message: "Échec réel" } });
  assert.match(error.text, /Échec réel/);
});

test("agent collaboration, subagent activity and web searches remain attributable", () => {
  const collab = item({ id: "collab", type: "collabAgentToolCall", senderThreadId: "root", receiverThreadIds: ["child"], tool: "followupTask", status: "completed", prompt: "Vérifie les changements", agentsStates: { child: { status: "completed", message: "Checks pass" } } });
  assert.deepEqual(collab.receiverThreadIds, ["child"]);
  assert.match(collab.text, /child: completed/);
  assert.match(collab.text, /Checks pass/);
  const child = item({ id: "child-event", type: "subAgentActivity", agentPath: "/root/audit", agentThreadId: "child", kind: "interrupted" });
  assert.match(child.text, /\/root\/audit: interrupted/);
  const web = item({ id: "web", type: "webSearch", query: "Codex changelog", action: { type: "openPage", url: "https://learn.chatgpt.com/docs/changelog" }, results: [{ title: "Codex" }] });
  assert.match(web.text, /https:\/\/learn/);
  assert.deepEqual(web.results, [{ title: "Codex" }]);
});

test("reasoning displays server-provided summaries without exposing raw content", () => {
  const rendered = item({ id: "r", type: "reasoning", summary: ["Résumé fourni"], content: ["PRIVATE-CONTENT"] });
  assert.equal(rendered.text, "Résumé fourni");
  assert.equal(JSON.stringify(rendered).includes("PRIVATE-CONTENT"), false);
  const update = notification("item/reasoning/textDelta", { ...ids, contentIndex: 0, delta: "PRIVATE-DELTA" });
  assert.deepEqual(update.activity, { reasoningActive: true });
  assert.equal(JSON.stringify(update).includes("PRIVATE-DELTA"), false);
});

test("future item types have a visible safe fallback rather than disappearing", () => {
  const future = renderCodexItem({ id: "future", type: "futurePublicItem", text: "Provided text", status: "pending", encrypted_content: "SECRET", result: "HUGE-BASE64" });
  assert.match(future.text, /futurePublicItem.*pending/);
  assert.match(future.text, /Provided text/);
  assert.equal(future.id, "future");
  assert.equal(JSON.stringify(future).includes("SECRET"), false);
  assert.equal(JSON.stringify(future).includes("HUGE-BASE64"), false);
  assert.equal(renderCodexItem(null), null);
  assert.equal(renderCodexItem({}), null);
});

test("plan, diff, usage and status notifications produce authoritative partial snapshots", () => {
  const plan = [{ step: "Test", status: "inProgress" }];
  const planned = notification("turn/plan/updated", { ...ids, plan, explanation: null });
  assert.deepEqual(planned.activity, { plan, explanation: null });
  const diff = notification("turn/diff/updated", { ...ids, diff: "@@\n+actual" });
  assert.equal(diff.activity.diff, "@@\n+actual");
  const zeroUsage = { cachedInputTokens: 0, inputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0, totalTokens: 0 };
  const usage = { total: zeroUsage, last: zeroUsage, modelContextWindow: null };
  assert.deepEqual(notification("thread/tokenUsage/updated", { ...ids, tokenUsage: usage }).activity.tokenUsage, usage);
  const status = { type: "active", activeFlags: [] };
  assert.deepEqual(notification("thread/status/changed", { threadId: ids.threadId, status }).activity.threadStatus, status);
  assert.deepEqual(notification("thread/queue/changed", { threadId: ids.threadId }).activity, { queueChanged: true });
});

test("item deltas distinguish append updates from replacement patches and progress", () => {
  const output = notification("item/commandExecution/outputDelta", { ...ids, delta: "stdout réel" });
  assert.deepEqual(output.itemUpdate, { id: ids.itemId, itemType: "commandExecution", deltaField: "aggregatedOutput", delta: "stdout réel" });
  const progress = notification("item/mcpToolCall/progress", { ...ids, message: "Processing" });
  assert.equal(progress.itemUpdate.progress, "Processing");
  const changes = [{ path: "test.txt", diff: "+patch", kind: { type: "add" } }];
  const patch = notification("item/fileChange/patchUpdated", { ...ids, changes });
  assert.deepEqual(patch.itemUpdate.changes, changes);
  assert.match(patch.itemUpdate.text, /\+patch/);
  const terminal = notification("item/commandExecution/terminalInteraction", { ...ids, processId: "p", stdin: "yes\n" });
  assert.deepEqual(terminal.itemUpdate.terminalInteraction, { processId: "p", stdin: "yes\n" });
});

test("base64 command and process notifications stay connection-scoped and decode split Unicode", () => {
  const bytes = Buffer.from("hé😀");
  const command = notification("command/exec/outputDelta", { processId: "cmd", stream: "stdout", deltaBase64: bytes.subarray(0, 2).toString("base64"), capReached: false });
  assert.equal(command.threadId, undefined);
  assert.equal(command.processUpdate.outputEncoding, "base64");
  const decoder = createCodexOutputDecoder();
  assert.equal(decoder.decode(command.processUpdate), "h");
  assert.equal(decoder.decode({ processId: "cmd", stream: "stderr", deltaBase64: Buffer.from("err").toString("base64") }), "err");
  const rest = notification("command/exec/outputDelta", { processId: "cmd", stream: "stdout", deltaBase64: bytes.subarray(2).toString("base64"), capReached: true });
  assert.equal(decoder.decode(rest.processUpdate, { final: true }), "é😀");
  const process = notification("process/outputDelta", { processHandle: "process", stream: "stdout", deltaBase64: Buffer.from("ok").toString("base64"), capReached: false });
  assert.equal(decoder.decode(process.processUpdate), "ok");
  assert.equal(decoder.flush(process.processUpdate), "");
  assert.equal(decoder.decode({ processId: "bad", stream: "stdout", deltaBase64: "invalid$" }), "");
  decoder.clear();
});

test("unknown and malformed notifications are ignored; actual lifecycle items remain visible", () => {
  assert.equal(mapCodexActivityNotification({ method: "unannounced/notification", params: {} }), null);
  assert.equal(mapCodexActivityNotification({ method: "turn/diff/updated", params: null }), null);
  const started = notification("item/started", { startedAtMs: 0, threadId: ids.threadId, turnId: ids.turnId, item: { id: "sleep", type: "sleep", durationMs: 1000 } });
  assert.equal(started.itemUpdate.pending, true);
  assert.match(started.itemUpdate.text, /1000/);
  const completed = notification("item/completed", { completedAtMs: 0, threadId: ids.threadId, turnId: ids.turnId, item: { id: "compaction", type: "contextCompaction" } });
  assert.equal(completed.itemUpdate.pending, false);
  assert.equal(completed.itemUpdate.text, "Contexte compacte");
});

test("0.156.0 file-backed image descriptors retain IDs without inventing a URL", () => {
  const userImage = definitions.UserInput.oneOf.find(part => part.properties?.type?.enum?.includes("image"));
  const outputImage = definitions.FunctionCallOutputContentItem.oneOf.find(part => part.properties?.type?.enum?.includes("input_image"));
  assert.ok(userImage.anyOf.some(part => part.properties?.fileId));
  assert.ok(outputImage.anyOf.some(part => part.properties?.file_id));
  const user = item({ id: "remote-user", type: "userMessage", content: [{ type: "image", fileId: "file-msn-user", detail: "original" }] });
  assert.deepEqual(user.attachments, [{ type: "image", fileId: "file-msn-user", detail: "original" }]);
  assert.match(user.text, /file-msn-user/);
  const output = item({ id: "remote-tool", type: "functionCallOutput", name: "image", namespace: "functions", output: [{ type: "input_image", file_id: "file-msn-tool" }] });
  assert.deepEqual(output.attachments, [{ type: "image", fileId: "file-msn-tool" }]);
  assert.equal(output.attachments[0].src, undefined);
  assert.equal(output.attachments[0].path, undefined);
  assert.match(output.text, /file-msn-tool/);
});

test("0.156.0 MCP UI descriptors preserve the resource and advertised display preference", () => {
  const mcpItemSchema = definitions.ThreadItem.oneOf.find(part => part.properties?.type?.enum?.includes("mcpToolCall"));
  assert.ok(mcpItemSchema.properties.mcpAppUi);
  for (const mode of definitions.McpAppDisplayMode.enum) {
    const mcpAppUi = { resourceUri: "ui://msn-fixture/widget.html", preferredModelDisplayMode: mode };
    const rendered = item({ id: "mcp-ui-" + mode, type: "mcpToolCall", server: "fixture", tool: "widget", arguments: {}, status: "completed", mcpAppUi, mcpAppResourceUri: "ui://msn-fixture/legacy.html" });
    assert.deepEqual(rendered.mcpAppUi, mcpAppUi);
    assert.equal(rendered.mcpAppResourceUri, "ui://msn-fixture/legacy.html");
    assert.match(rendered.text, /widget/);
  }
});
