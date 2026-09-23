import assert from "node:assert/strict";
import test from "node:test";
import {
  applyCodexItemUpdate,
  applyCodexAgentMessageMetadata,
  codexActivityMessage,
  createBoundedCodexOutputDecoder,
  finalizeCodexTurnMessages,
  handleStoppedCodexStatus,
  isCodexActiveTurnEvent,
  isCodexConversationEvent
} from "../src/useCodexEvents.js";
import { mapCodexActivityNotification, renderCodexItem } from "../shared/codexTimeline.js";

const presentation = { author: "Nomade", time: "12:34" };
const correlation = { contactId: "alice", threadId: "thread-1", turnId: "turn-1" };

function item(value) {
  return renderCodexItem(value, presentation);
}

function activity(activity, extras = {}) {
  return { ...correlation, method: "turn/plan/updated", activity, ...extras };
}

function output(processId, stream, value) {
  return { processId, stream, deltaBase64: Buffer.from(value).toString("base64") };
}

test("command deltas append to the same item while retaining the command and cwd", () => {
  const original = [{
    ...item({ id: "command-1", type: "commandExecution", command: "git status", cwd: "/project", status: "inProgress", aggregatedOutput: "initial\n" }),
    pending: true
  }];
  const first = applyCodexItemUpdate(original, {
    id: "command-1", itemType: "commandExecution", deltaField: "aggregatedOutput", delta: "next\n"
  }, presentation);
  const final = applyCodexItemUpdate(first, {
    id: "command-1", itemType: "commandExecution", deltaField: "aggregatedOutput", delta: "done"
  }, presentation);
  assert.equal(final.length, 1);
  assert.equal(final[0].aggregatedOutput, "initial\nnext\ndone");
  assert.equal(final[0].command, "git status");
  assert.equal(final[0].cwd, "/project");
  assert.match(final[0].text, /git status/);
  assert.match(final[0].text, /initial\nnext\ndone/);
  assert.equal(original[0].aggregatedOutput, "initial\n");
  assert.notEqual(first, original);
});

test("interleaved items preserve separate streamed output", () => {
  let messages = [
    item({ id: "command-a", type: "commandExecution", command: "first", aggregatedOutput: "" }),
    item({ id: "command-b", type: "commandExecution", command: "second", aggregatedOutput: "" })
  ];
  for (const [id, delta] of [["command-a", "A1"], ["command-b", "B1"], ["command-a", "A2"]]) {
    messages = applyCodexItemUpdate(messages, { id, itemType: "commandExecution", deltaField: "aggregatedOutput", delta }, presentation);
  }
  assert.deepEqual(messages.map(({ id, aggregatedOutput }) => ({ id, aggregatedOutput })), [
    { id: "command-a", aggregatedOutput: "A1A2" }, { id: "command-b", aggregatedOutput: "B1" }
  ]);
});

test("subagent completion interleaved with a parent response preserves the parent stream", () => {
  const parent = {
    ...item({ id: "parent-agent", type: "agentMessage", text: "Parent partial", phase: "commentary" }),
    threadId: "parent-thread", turnId: "parent-turn", streaming: true, pending: true
  };
  const childStarted = {
    ...item({ id: "child-activity", type: "subAgentActivity", agentPath: "/root/audit", agentThreadId: "child-thread", kind: "started" }),
    pending: true
  };
  const childCompleted = {
    ...item({ id: "child-activity", type: "subAgentActivity", agentPath: "/root/audit", agentThreadId: "child-thread", kind: "completed" }),
    pending: false
  };
  let messages = applyCodexItemUpdate([parent, childStarted], childCompleted, presentation);
  assert.equal(messages[0], parent);
  assert.equal(messages[0].streaming, true);
  assert.equal(messages[0].pending, true);
  assert.equal(messages[0].text, "Parent partial");
  assert.equal(messages[1].pending, false);
  messages = applyCodexItemUpdate(messages, {
    id: "parent-agent", itemType: "agentMessage", deltaField: "text", delta: " continued"
  }, presentation);
  assert.equal(messages[0].text, "Parent partial continued");
  assert.equal(messages[0].streaming, true);
  assert.match(messages[1].text, /audit: completed/);
});

test("public reasoning summaries assemble by index without exposing raw reasoning", () => {
  let messages = [item({ id: "reasoning-1", type: "reasoning", summary: [], content: ["PRIVATE-REASONING"] })];
  for (const [summaryIndex, delta] of [[2, "Third"], [0, "First"], [2, " part"]]) {
    messages = applyCodexItemUpdate(messages, {
      id: "reasoning-1", itemType: "reasoning", deltaField: "summary", summaryIndex, delta,
      content: ["PRIVATE-REASONING-DELTA"], encryptedContent: "PRIVATE-CIPHERTEXT"
    }, presentation);
  }
  messages = applyCodexItemUpdate(messages, {
    id: "reasoning-1", itemType: "reasoning", summaryIndex: 1, summaryPartAdded: true
  }, presentation);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].summary[0], "First");
  assert.equal(messages[0].summary[1], "");
  assert.equal(messages[0].summary[2], "Third part");
  assert.match(messages[0].text, /First/);
  assert.match(messages[0].text, /Third part/);
  assert.ok(!JSON.stringify(messages).includes("PRIVATE-REASONING"));
  assert.ok(!JSON.stringify(messages).includes("PRIVATE-CIPHERTEXT"));
});

test("patch updates replace the previous file snapshot with the actual new diff", () => {
  const oldChanges = [{ path: "/project/old.txt", kind: { type: "add" }, diff: "+old snapshot" }];
  const changes = [{ path: "/project/new.txt", kind: { type: "update" }, diff: "@@ -1 +1 @@\n-before\n+after" }];
  const original = [item({ id: "patch-1", type: "fileChange", status: "inProgress", changes: oldChanges })];
  const update = mapCodexActivityNotification({
    method: "item/fileChange/patchUpdated", params: { ...correlation, itemId: "patch-1", changes }
  }).itemUpdate;
  const messages = applyCodexItemUpdate(original, update, presentation);
  assert.equal(messages.length, 1);
  assert.deepEqual(messages[0].changes, changes);
  assert.match(messages[0].text, /new\.txt/);
  assert.match(messages[0].text, /\+after/);
  assert.ok(!messages[0].text.includes("old snapshot"));
  assert.deepEqual(original[0].changes, oldChanges);
});

test("MCP progress updates preserve tool attribution", () => {
  const original = [item({
    id: "tool-1", type: "mcpToolCall", server: "calendar", tool: "lookup", status: "inProgress"
  })];
  const messages = applyCodexItemUpdate(original, { id: "tool-1", itemType: "mcpToolCall", progress: "Fetching next page" }, presentation);
  assert.equal(messages[0].tool, "lookup");
  assert.equal(messages[0].server, "calendar");
  assert.equal(messages[0].progress, "Fetching next page");
  assert.match(messages[0].text, /calendar: lookup/);
  assert.match(messages[0].text, /Fetching next page/);
});

test("MCP progress preserves the result once and replaces the previous progress", () => {
  const result = "Previously provided public result";
  let messages = [item({
    id: "tool-1", type: "mcpToolCall", server: "calendar", tool: "lookup", status: "inProgress",
    result: { content: [{ type: "text", text: result }] }
  })];
  messages = applyCodexItemUpdate(messages, { id: "tool-1", itemType: "mcpToolCall", progress: "Fetching first page" }, presentation);
  assert.equal(messages[0].text.split(result).length - 1, 1);
  messages = applyCodexItemUpdate(messages, { id: "tool-1", itemType: "mcpToolCall", progress: "Fetching second page" }, presentation);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].text.split(result).length - 1, 1);
  assert.match(messages[0].text, /Fetching second page/);
  assert.ok(!messages[0].text.includes("Fetching first page"));
});

test("later MCP progress keeps the completed authoritative result body", () => {
  let messages = [{
    ...item({ id: "tool-1", type: "mcpToolCall", server: "calendar", tool: "lookup", status: "inProgress" }),
    pending: true
  }];
  messages = applyCodexItemUpdate(messages, { id: "tool-1", itemType: "mcpToolCall", progress: "Fetching result" }, presentation);
  const authoritative = "Authoritative server result";
  const completed = {
    ...item({
      id: "tool-1", type: "mcpToolCall", server: "calendar", tool: "lookup", status: "completed",
      result: { content: [{ type: "text", text: authoritative }] }
    }),
    pending: false
  };
  messages = applyCodexItemUpdate(messages, completed, presentation);
  assert.equal(messages[0].text, completed.text);
  assert.equal(messages[0].pending, false);
  messages = applyCodexItemUpdate(messages, { id: "tool-1", itemType: "mcpToolCall", progress: "Final status received" }, presentation);
  assert.equal(messages[0].status, "completed");
  assert.equal(messages[0].pending, false);
  assert.equal(messages[0].text.split(authoritative).length - 1, 1);
  assert.match(messages[0].text, /Final status received/);
  assert.ok(!messages[0].text.includes("Fetching result"));
});

test("completed snapshots explicitly end pending items and replace streamed output", () => {
  const initial = [{
    ...item({ id: "command-1", type: "commandExecution", command: "git status", status: "inProgress", aggregatedOutput: "partial" }),
    pending: true
  }];
  const completed = {
    ...item({ id: "command-1", type: "commandExecution", command: "git status", status: "completed", aggregatedOutput: "authoritative", exitCode: 0 }),
    pending: false
  };
  const messages = applyCodexItemUpdate(initial, completed, presentation);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].pending, false);
  assert.equal(messages[0].status, "completed");
  assert.equal(messages[0].exitCode, 0);
  assert.equal(messages[0].aggregatedOutput, "authoritative");
  assert.ok(!messages[0].text.includes("partial"));
});

test("deltas received before a snapshot create one visible item", () => {
  let messages = applyCodexItemUpdate([], { id: "new-plan", itemType: "plan", deltaField: "text", delta: "First " }, presentation);
  messages = applyCodexItemUpdate(messages, { id: "new-plan", itemType: "plan", deltaField: "text", delta: "step" }, presentation);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].id, "new-plan");
  assert.equal(messages[0].text, "First step");
});

test("plan activities keep one stable identity per turn and preserve server steps", () => {
  const firstPlan = [{ step: "Inspect", status: "inProgress" }, { step: "Test", status: "pending" }];
  const nextPlan = [{ step: "Inspect", status: "completed" }, { step: "Test", status: "inProgress" }];
  const first = codexActivityMessage(activity({ plan: firstPlan, explanation: "Check the real behavior." }), presentation);
  const second = codexActivityMessage(activity({ plan: nextPlan, explanation: null }), presentation);
  const otherTurn = codexActivityMessage(activity({ plan: nextPlan }, { turnId: "turn-2" }), presentation);
  assert.ok(first?.id);
  assert.equal(first.id, second.id);
  assert.notEqual(first.id, otherTurn.id);
  assert.match(first.text, /Inspect/);
  assert.match(first.text, /Test/);
  assert.match(first.text, /Check the real behavior/);
  assert.match(second.text, /completed.*Inspect/);
  assert.match(second.text, /inProgress.*Test/);
  assert.deepEqual(first.plan, firstPlan);
  assert.equal(first.explanation, "Check the real behavior.");
  assert.deepEqual(second.plan, nextPlan);
  assert.equal(second.explanation, null);
  const messages = applyCodexItemUpdate([first], second, presentation);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].text, second.text);
  assert.deepEqual(messages[0].plan, nextPlan);
});

test("plans from separate threads sharing a contact and turn ID retain separate identities", () => {
  const event = (threadId, step) => activity({ plan: [{ step, status: "inProgress" }] }, { threadId });
  const first = codexActivityMessage(event("thread-1", "Inspect first thread"), presentation);
  const second = codexActivityMessage(event("thread-2", "Inspect second thread"), presentation);
  assert.notEqual(first.id, second.id);
  const resumed = codexActivityMessage(activity({
    plan: [{ step: "Inspect first thread", status: "completed" }]
  }, { threadId: "thread-1" }), presentation);
  assert.equal(first.id, resumed.id);
  const messages = applyCodexItemUpdate([first, second], resumed, presentation);
  assert.equal(messages.length, 2);
  assert.deepEqual(messages[0].plan, resumed.plan);
  assert.equal(messages[1], second);
  assert.match(messages[1].text, /Inspect second thread/);
});

test("token usage distinguishes real zero counts from unavailable counts", () => {
  const counts = { cachedInputTokens: 0, inputTokens: 200, outputTokens: 121, reasoningOutputTokens: 0, totalTokens: 321 };
  const zeroCounts = { cachedInputTokens: 0, inputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0, totalTokens: 0 };
  const usage = { total: counts, last: counts, modelContextWindow: 1000 };
  const event = (tokenUsage) => activity({ tokenUsage }, { method: "thread/tokenUsage/updated" });
  const first = codexActivityMessage(event(usage), presentation);
  const missing = codexActivityMessage(event({ total: {}, last: {}, modelContextWindow: null }), presentation);
  const zero = codexActivityMessage(event({ total: zeroCounts, last: zeroCounts, modelContextWindow: null }), presentation);
  assert.ok(first?.id);
  assert.equal(first.id, zero.id);
  assert.match(first.text, /321/);
  assert.deepEqual(first.tokenUsage, usage);
  // Incomplete usage data is unavailable. The helper intentionally emits no
  // transcript entry rather than manufacturing a count that the server omitted.
  assert.equal(missing, null);
  assert.match(zero.text, /\b0\b/);
  assert.notEqual(first.id, codexActivityMessage(activity({ plan: [{ step: "Inspect", status: "pending" }] }), presentation).id);
});

test("turn diff activity displays the actual diff and has a stable per-turn ID", () => {
  const diff = "diff --git a/a.txt b/a.txt\n@@ -1 +1 @@\n-before\n+actual server change";
  const first = codexActivityMessage(activity({ diff }, { method: "turn/diff/updated" }), presentation);
  const second = codexActivityMessage(activity({ diff: "+updated" }, { method: "turn/diff/updated" }), presentation);
  assert.ok(first?.id);
  assert.equal(first.id, second.id);
  assert.match(first.text, /\+actual server change/);
  assert.ok(!second.text.includes("actual server change"));
});

test("unknown activities and raw reasoning activity do not create transcript text", () => {
  assert.equal(codexActivityMessage(activity({ reasoningActive: true }, { method: "item/reasoning/textDelta" }), presentation), null);
  assert.equal(codexActivityMessage(activity({ futureUnknownField: "ignored" }, { method: "unknown/event" }), presentation), null);
});

test("bounded output decoder preserves UTF-8 bytes independently across stdout and stderr", () => {
  const decoder = createBoundedCodexOutputDecoder({ maxStreams: 4, maxChars: 100 });
  const stdout = Buffer.from("hé😀");
  const stderr = Buffer.from("😀");
  assert.equal(decoder.decode(output("process-1", "stdout", stdout.subarray(0, 2))), "h");
  assert.equal(decoder.decode(output("process-1", "stderr", stderr.subarray(0, 2))), "");
  assert.equal(decoder.decode(output("process-1", "stdout", stdout.subarray(2))), "é😀");
  assert.equal(decoder.decode(output("process-1", "stderr", stderr.subarray(2))), "😀");
  assert.equal(decoder.flush({ processId: "process-1", stream: "stdout" }), "");
  assert.equal(decoder.flush({ processId: "process-1", stream: "stderr" }), "");
  assert.equal(decoder.activeStreams(), 0);
});

test("process handles decode separately from other processes", () => {
  const decoder = createBoundedCodexOutputDecoder({ maxStreams: 4, maxChars: 100 });
  const first = Buffer.from("é");
  const second = Buffer.from("😀");
  assert.equal(decoder.decode({ processHandle: "handle-1", stream: "stdout", deltaBase64: first.subarray(0, 1).toString("base64") }), "");
  assert.equal(decoder.decode(output("process-2", "stdout", second.subarray(0, 2))), "");
  assert.equal(decoder.decode({ processHandle: "handle-1", stream: "stdout", deltaBase64: first.subarray(1).toString("base64") }), "é");
  assert.equal(decoder.decode(output("process-2", "stdout", second.subarray(2))), "😀");
});

test("decoder limits displayed chunks and clear resets its state", () => {
  assert.equal(createBoundedCodexOutputDecoder().displayLimit, 256 * 1024);
  const decoder = createBoundedCodexOutputDecoder({ maxStreams: 2, maxChars: 5 });
  assert.equal(decoder.displayLimit, 5);
  const chunks = [
    decoder.decode(output("process-1", "stdout", "abc")),
    decoder.decode(output("process-1", "stdout", "defghijk")),
    decoder.decode(output("process-1", "stdout", "more output")),
    decoder.flush({ processId: "process-1", stream: "stdout" })
  ];
  assert.ok(chunks.every((chunk) => chunk.length <= 5));
  assert.equal(chunks[0], "abc");
  assert.ok(chunks[1].includes("ghijk"));
  decoder.clear();
  assert.equal(decoder.activeStreams(), 0);
  assert.equal(decoder.decode(output("process-1", "stdout", "again")), "again");
});

test("decoder reports when the current chunk was clipped", () => {
  const decoder = createBoundedCodexOutputDecoder({ maxStreams: 2, maxChars: 5 });
  assert.equal(decoder.lastChunkCapped(), false);
  assert.equal(decoder.decode(output("process-1", "stdout", "abc")), "abc");
  assert.equal(decoder.lastChunkCapped(), false);
  assert.equal(decoder.decode(output("process-1", "stdout", "0123456789")), "56789");
  assert.equal(decoder.lastChunkCapped(), true);
  assert.equal(decoder.decode(output("process-1", "stdout", "next")), "next");
  assert.equal(decoder.lastChunkCapped(), false);
});

test("decoder never retains more than the configured stream count", () => {
  const decoder = createBoundedCodexOutputDecoder({ maxStreams: 2, maxChars: 100 });
  for (let index = 0; index < 20; index++) {
    assert.equal(decoder.decode(output(`process-${index}`, "stdout", "x")), "x");
    assert.ok(decoder.activeStreams() <= 2);
  }
  assert.equal(decoder.activeStreams(), 2);
  decoder.clear();
  assert.equal(decoder.activeStreams(), 0);
});

test("invalid base64 cannot create output or consume a stream slot", () => {
  const decoder = createBoundedCodexOutputDecoder({ maxStreams: 2, maxChars: 100 });
  assert.equal(decoder.decode({ processId: "bad", stream: "stdout", deltaBase64: "invalid$" }), "");
  assert.equal(decoder.activeStreams(), 0);
});

test("command and combined process output remain within the 256k display cap", () => {
  const limit = 256 * 1024;
  const command = item({ id: "large-command", type: "commandExecution", command: "build", aggregatedOutput: "" });
  const messages = applyCodexItemUpdate([command], {
    id: "large-command", itemType: "commandExecution", deltaField: "aggregatedOutput", delta: "x".repeat(limit + 50) + "final output"
  }, presentation);
  assert.ok(messages[0].aggregatedOutput.length <= limit);
  assert.ok(messages[0].text.length <= limit);
  assert.ok(messages[0].aggregatedOutput.endsWith("final output"));
  assert.equal(messages[0].command, "build");
  assert.equal(messages[0].outputCapped, true);
  const processMessages = applyCodexItemUpdate([], {
    id: "large-process", itemType: "commandExecution", processOutput: true,
    stdout: "o".repeat(limit), stderr: "e".repeat(limit)
  }, presentation);
  assert.ok(processMessages[0].text.length <= limit);
});

test("output caps preserve valid Unicode at the clipping boundary", () => {
  const decoder = createBoundedCodexOutputDecoder({ maxStreams: 2, maxChars: 2 });
  const displayed = decoder.decode(output("process-1", "stdout", "😀a"));
  assert.ok(displayed.length <= 2);
  assert.equal(displayed.isWellFormed(), true);
});

test("file output deltas append once and keep the latest authoritative patch", () => {
  let messages = [item({
    id: "patch-1", type: "fileChange", changes: [{ path: "a.txt", kind: { type: "add" }, diff: "+old diff" }]
  })];
  for (const delta of ["first patch output\n", "second patch output\n"]) {
    messages = applyCodexItemUpdate(messages, { id: "patch-1", itemType: "fileChange", deltaField: "output", delta }, presentation);
  }
  assert.equal(messages[0].output, "first patch output\nsecond patch output\n");
  assert.equal(messages[0].text.split("first patch output").length - 1, 1);
  const update = mapCodexActivityNotification({
    method: "item/fileChange/patchUpdated",
    params: { ...correlation, itemId: "patch-1", changes: [{ path: "b.txt", kind: { type: "add" }, diff: "+latest diff" }] }
  }).itemUpdate;
  messages = applyCodexItemUpdate(messages, update, presentation);
  assert.match(messages[0].text, /\+latest diff/);
  assert.ok(!messages[0].text.includes("old diff"));
  assert.equal(messages[0].text.split("first patch output").length - 1, 1);
  messages = applyCodexItemUpdate(messages, { id: "patch-1", itemType: "fileChange", deltaField: "output", delta: "third patch output" }, presentation);
  assert.match(messages[0].text, /\+latest diff/);
  assert.equal(messages[0].text.split("first patch output").length - 1, 1);
  assert.match(messages[0].text, /third patch output/);
});

test("terminal interaction status does not store or echo a secret stdin value", () => {
  const secret = "private-terminal-password";
  const messages = applyCodexItemUpdate([], {
    id: "terminal-1", itemType: "commandExecution", terminalInteraction: { processId: "process-1", stdin: secret }
  }, presentation);
  assert.equal(messages[0].terminalInteraction.processId, "process-1");
  assert.equal(messages[0].terminalInteraction.hasInput, true);
  assert.ok(!JSON.stringify(messages).includes(secret));
});

test("invalid output cannot evict a stream waiting for its remaining Unicode bytes", () => {
  const decoder = createBoundedCodexOutputDecoder({ maxStreams: 2, maxChars: 100 });
  const bytes = Buffer.from("é");
  assert.equal(decoder.decode(output("process-a", "stdout", bytes.subarray(0, 1))), "");
  assert.equal(decoder.decode(output("process-b", "stdout", "b")), "b");
  assert.equal(decoder.decode({ processId: "invalid", stream: "stdout", deltaBase64: "invalid$" }), "");
  assert.equal(decoder.activeStreams(), 2);
  assert.equal(decoder.decode(output("process-a", "stdout", bytes.subarray(1))), "é");
});

function lifecycleFixture(t) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const userMessage = { id: "user-1", from: "me", text: "Run the checks", streaming: false };
  const bobApproval = { approvalId: "approval-bob", contactId: "bob" };
  const bobQuestion = { id: "question-bob", contactId: "bob", isBlocking: false };
  const state = {
    typing: true,
    busy: true,
    messages: [{ id: "agent-1", from: "them", text: "Partial ", streaming: true }, userMessage],
    approvals: [{ approvalId: "approval-alice", contactId: "alice" }, bobApproval],
    requests: [
      { id: "question-alice", contactId: "alice", isBlocking: false },
      { id: "permission-alice", contactId: "alice", isBlocking: true },
      bobQuestion
    ],
    flushes: 0,
    flushQueue: null,
    timerFired: false
  };
  const deltaQueueRef = { current: ["response"] };
  const deltaFirstQueuedAtRef = { current: 1000 };
  const deltaFlushTimerRef = { current: setTimeout(() => { state.timerFired = true; }, 100) };
  const playedStreamingSoundRef = { current: true };
  const blockingRequests = { current: new Set(["approval-alice", "permission-alice"]) };
  const outputDecoder = createBoundedCodexOutputDecoder({ maxStreams: 2, maxChars: 100 });
  const bytes = Buffer.from("é");
  assert.equal(outputDecoder.decode(output("process-1", "stdout", bytes.subarray(0, 1))), "");
  const callbacks = {
    contactId: "alice", blockingRequests, outputDecoder,
    deltaFlushTimerRef, deltaQueueRef, deltaFirstQueuedAtRef, playedStreamingSoundRef,
    flushAgentDeltas: () => {
      state.flushes++;
      state.flushQueue = [...deltaQueueRef.current];
      state.messages = state.messages.map((message) => message.id === "agent-1" ? {
        ...message, text: message.text + deltaQueueRef.current.join("")
      } : message);
    },
    setTyping: (value) => { state.typing = value; },
    setTurnActive: (value) => { state.busy = value; },
    setMessages: (updater) => { state.messages = typeof updater === "function" ? updater(state.messages) : updater; },
    setApprovalRequests: (updater) => { state.approvals = typeof updater === "function" ? updater(state.approvals) : updater; },
    setServerRequests: (updater) => { state.requests = typeof updater === "function" ? updater(state.requests) : updater; }
  };
  return { state, callbacks, userMessage, bobApproval, bobQuestion };
}

function assertStoppedLifecycle(t, fixture) {
  const { state, callbacks, userMessage, bobApproval, bobQuestion } = fixture;
  assert.equal(state.flushes, 1);
  assert.deepEqual(state.flushQueue, ["response"], "Flush must see the queued delta before queue reset.");
  assert.equal(state.typing, false);
  assert.equal(state.busy, false);
  assert.equal(state.messages[0].text, "Partial response");
  assert.equal(state.messages[0].streaming, false);
  assert.equal(state.messages[1], userMessage);
  assert.deepEqual(state.approvals, [bobApproval]);
  assert.deepEqual(state.requests, [bobQuestion]);
  assert.equal(callbacks.blockingRequests.current.size, 0);
  assert.equal(callbacks.deltaFlushTimerRef.current, null);
  assert.deepEqual(callbacks.deltaQueueRef.current, []);
  assert.equal(callbacks.deltaFirstQueuedAtRef.current, 0);
  assert.equal(callbacks.playedStreamingSoundRef.current, false);
  assert.equal(callbacks.outputDecoder.activeStreams(), 0);
  assert.equal(callbacks.outputDecoder.decode(output("process-1", "stdout", "é")), "é", "The previous partial UTF-8 byte must have been discarded.");
  t.mock.timers.tick(100);
  assert.equal(state.timerFired, false);
}

test("custom stopped status flushes partial text and clears only the stopped contact", (t) => {
  const fixture = lifecycleFixture(t);
  assert.equal(handleStoppedCodexStatus({ kind: "stopped", text: "CLI updated" }, fixture.callbacks), true);
  assertStoppedLifecycle(t, fixture);
});

for (const kind of ["exit", "error"]) {
  test(`${kind} status cleans up a busy conversation without a recognized notice text`, (t) => {
    const fixture = lifecycleFixture(t);
    assert.equal(handleStoppedCodexStatus({ kind, text: "Custom transport reason" }, fixture.callbacks), true);
    assertStoppedLifecycle(t, fixture);
  });
}

for (const kind of ["completed", "ready"]) {
  test(`${kind} status preserves pending asynchronous questions and queued deltas`, (t) => {
    const { state, callbacks } = lifecycleFixture(t);
    const originalMessages = state.messages;
    const originalApprovals = state.approvals;
    const originalRequests = state.requests;
    const originalTimer = callbacks.deltaFlushTimerRef.current;
    assert.equal(handleStoppedCodexStatus({ kind, text: "CLI updated" }, callbacks), false);
    assert.equal(state.flushes, 0);
    assert.equal(state.typing, true);
    assert.equal(state.busy, true);
    assert.equal(state.messages, originalMessages);
    assert.equal(state.messages[0].streaming, true);
    assert.equal(state.approvals, originalApprovals);
    assert.equal(state.requests, originalRequests);
    assert.equal(callbacks.blockingRequests.current.size, 2);
    assert.equal(callbacks.outputDecoder.activeStreams(), 1);
    assert.equal(callbacks.deltaFlushTimerRef.current, originalTimer);
    assert.deepEqual(callbacks.deltaQueueRef.current, ["response"]);
    assert.equal(callbacks.deltaFirstQueuedAtRef.current, 1000);
    assert.equal(callbacks.playedStreamingSoundRef.current, true);
    t.mock.timers.tick(100);
    assert.equal(state.timerFired, true);
  });
}

test("conversation routing accepts its worker envelopes and rejects another thread", () => {
  const current = { contactId: "alice", threadId: "parent-thread" };
  assert.equal(isCodexConversationEvent({ contactId: "alice", threadId: "parent-thread" }, current), true);
  assert.equal(isCodexConversationEvent({ contactId: "alice", threadId: "another-thread" }, current), false);
  assert.equal(isCodexConversationEvent({ contactId: "bob", threadId: "parent-thread" }, current), false);
  assert.equal(isCodexConversationEvent({ contactId: "alice" }, current), true, "Legacy envelopes have no thread identity.");
  assert.equal(isCodexConversationEvent({ contactId: "alice", threadId: "child-thread", parentThreadId: "parent-thread", isWorker: true }, current), true);
  assert.equal(isCodexConversationEvent({ contactId: "alice", threadId: "child-thread", parentThreadId: "another-parent", isWorker: true }, current), false);
  assert.equal(isCodexConversationEvent({ contactId: "alice", threadId: "child-thread", parentThreadId: "parent-thread" }, current), false);
  assert.equal(isCodexConversationEvent({ contactId: "alice", threadId: "grandchild-thread", parentThreadId: "child-thread", ancestorThreadIds: ["child-thread", "parent-thread"], isWorker: true }, current), true);
  assert.equal(isCodexConversationEvent({ contactId: "alice", threadId: "grandchild-thread", parentThreadId: "other-child", ancestorThreadIds: ["other-child", "other-parent"], isWorker: true }, current), false);
  assert.equal(isCodexConversationEvent({ contactId: "alice", threadId: "grandchild-thread", parentThreadId: "child-thread", ancestorThreadIds: "parent-thread", isWorker: true }, current), false);
});

test("public agent metadata attaches to its item without storing private fields", () => {
  const parent = { id: "parent-agent", from: "them", text: "Parent source", streaming: true };
  const child = { id: "child-agent", from: "them", text: "Child source", streaming: true };
  const tail = { id: "plan-tail", from: "system", itemType: "plan", text: "Plan source" };
  const questions = [{ title: "Which approach?", options: ["Keep", "Replace"] }];
  const memoryCitation = { entries: [{ path: "notes.md", lineStart: 1, lineEnd: 3, note: "Public source citation" }], threadIds: ["source-thread"] };
  const payload = {
    itemId: "child-agent", threadId: "child-thread", turnId: "turn-1", parentThreadId: "parent-thread", isWorker: true,
    phase: "commentary", delivery: "async", questions, memoryCitation,
    content: ["PRIVATE-REASONING"], encryptedContent: "PRIVATE-CIPHERTEXT", arbitraryInternalField: "PRIVATE-METADATA"
  };
  const messages = applyCodexAgentMessageMetadata([parent, child, tail], payload);
  assert.equal(messages[0], parent);
  assert.equal(messages[2], tail);
  assert.equal(messages[1].text, "Child source");
  assert.equal(messages[1].streaming, true);
  for (const key of ["threadId", "turnId", "parentThreadId", "isWorker", "phase", "delivery", "questions", "memoryCitation"]) {
    assert.deepEqual(messages[1][key], payload[key]);
  }
  assert.ok(!JSON.stringify(messages).includes("PRIVATE-"));
  assert.equal(child.threadId, undefined);
  assert.equal(child.questions, undefined);
  assert.equal(payload.questions, questions);
});

test("legacy metadata targets the latest agent answer and unknown item IDs do not fall back", () => {
  const first = { id: "first-agent", from: "them", text: "First source" };
  const latest = { id: "latest-agent", from: "them", text: "Latest source" };
  const tail = { id: "system-tail", from: "system", text: "System source" };
  const original = [first, latest, tail];
  const messages = applyCodexAgentMessageMetadata(original, { phase: "final_answer", delivery: "async" });
  assert.equal(messages[0], first);
  assert.equal(messages[2], tail);
  assert.equal(messages[1].phase, "final_answer");
  assert.equal(messages[1].delivery, "async");
  assert.equal(messages[1].text, latest.text);
  assert.equal(applyCodexAgentMessageMetadata(original, { itemId: "missing-agent", phase: "final_answer" }), original);
});

for (const status of ["completed", "interrupted", "failed"]) {
  test(`${status} turn finalizes partial answer and plan without rewriting their source`, () => {
    const answerSource = "Partial calculation: x² + y²\n```js\nconst result = x ** 2";
    const planSource = "1. Inspect the code\n2. Check the actual output";
    const steps = [{ step: "Inspect the code", status: "inProgress" }, { step: "Check the actual output", status: "pending" }];
    const questions = [{ title: "Which approach?", options: ["Keep", "Replace"] }];
    const answer = { id: "agent-1", from: "them", itemType: "agentMessage", threadId: "parent-thread", turnId: "turn-1", text: answerSource, streaming: true, delivery: "async", questions };
    const plan = { id: "plan-1", from: "them", itemType: "plan", threadId: "parent-thread", turnId: "turn-1", text: planSource, plan: steps, streaming: true, pending: true };
    const otherThread = { ...answer, id: "other-thread-agent", threadId: "other-thread" };
    const otherTurn = { ...answer, id: "other-turn-agent", turnId: "turn-2" };
    const unfinishedTool = { id: "tool-1", itemType: "commandExecution", threadId: "parent-thread", turnId: "turn-1", status: "inProgress", pending: true, text: "build" };
    const messages = finalizeCodexTurnMessages([answer, plan, otherThread, otherTurn, unfinishedTool], { threadId: "parent-thread", turnId: "turn-1", status });
    assert.equal(messages[0].text, answerSource);
    assert.equal(messages[0].streaming, false);
    assert.equal(messages[0].turnStatus, status);
    assert.equal(messages[0].delivery, "async");
    assert.deepEqual(messages[0].questions, questions);
    assert.equal(messages[1].text, planSource);
    assert.equal(messages[1].streaming, false);
    assert.equal(messages[1].pending, false);
    assert.equal(messages[1].turnStatus, status);
    assert.deepEqual(messages[1].plan, steps, "The server's unfinished steps must not be marked successful locally.");
    assert.equal(messages[2], otherThread);
    assert.equal(messages[3], otherTurn);
    assert.equal(messages[4], unfinishedTool);
    assert.equal(answer.streaming, true);
    assert.equal(plan.pending, true);
  });
}

test("worker turn finalization cannot stop the parent stream with an identical turn ID", () => {
  const parent = { id: "parent-agent", threadId: "parent-thread", turnId: "turn-1", text: "Parent partial", streaming: true };
  const child = { id: "child-agent", threadId: "child-thread", turnId: "turn-1", parentThreadId: "parent-thread", isWorker: true, text: "Child partial", streaming: true };
  const unknownThread = { id: "legacy-agent", turnId: "turn-1", text: "Legacy partial", streaming: true };
  const original = [parent, child, unknownThread];
  for (const status of ["completed", "interrupted", "failed"]) {
    const messages = finalizeCodexTurnMessages(original, { threadId: "child-thread", parentThreadId: "parent-thread", turnId: "turn-1", isWorker: true, status });
    assert.equal(messages[0], parent);
    assert.equal(messages[0].streaming, true);
    assert.equal(messages[1].text, "Child partial");
    assert.equal(messages[1].streaming, false);
    assert.equal(messages[1].turnStatus, status);
    assert.equal(messages[2], unknownThread);
  }
  assert.equal(finalizeCodexTurnMessages(original, { parentThreadId: "parent-thread", turnId: "turn-1", isWorker: true, status: "completed" }), original);
});

test("worker lifecycle stops the worker conversation when opened and keeps its parent active", () => {
  const worker = { contactId: "alice", threadId: "child-thread", parentThreadId: "parent-thread", isWorker: true, status: "completed" };
  assert.equal(isCodexActiveTurnEvent(worker, { threadId: "parent-thread" }), false);
  assert.equal(isCodexActiveTurnEvent(worker, { threadId: "child-thread" }), true);
  assert.equal(isCodexActiveTurnEvent(worker, { threadId: "other-child" }), false);
  assert.equal(isCodexActiveTurnEvent({ ...worker, threadId: undefined }, { threadId: "parent-thread" }), false);
  assert.equal(isCodexActiveTurnEvent({ contactId: "alice", status: "completed" }, { threadId: "parent-thread" }), true);
  for (const invalid of [null, undefined, "completed", []]) {
    assert.equal(isCodexActiveTurnEvent(invalid, { threadId: "parent-thread" }), false);
  }
});
