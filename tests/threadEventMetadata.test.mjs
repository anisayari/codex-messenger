import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { EventEmitter } from "node:events";
import vm from "node:vm";
import { renderCodexItem, mapCodexActivityNotification } from "../shared/codexTimeline.js";

const main = (await readFile(new URL("../electron/main.js", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
function productionFunction(name) {
  const start = main.indexOf("function " + name + "(");
  assert.ok(start >= 0, "Production function missing: " + name);
  const end = main.indexOf("\n}\n", start);
  assert.ok(end > start);
  return main.slice(start, end + 3);
}
function productionNotifications() {
  const start = main.indexOf('codex.on("notification", (message) => {');
  const end = main.indexOf("\n});", start);
  assert.ok(start >= 0 && end > start);
  return main.slice(start, end + 4);
}
const normalize = value => JSON.parse(JSON.stringify(value));
function fixture({ childContact = false } = {}) {
  const codex = new EventEmitter();
  const chats = [], mainEvents = [], recovered = [];
  const knownThreads = new Map([["parent", { id: "parent", parentThreadId: null }]]);
  const contactByThread = new Map([["parent", "parent-contact"]]);
  const threadByContact = new Map([["parent-contact", "parent"]]);
  if (childContact) {
    contactByThread.set("child", "child-contact");
    threadByContact.set("child-contact", "child");
  }
  const activeTurnByThread = new Map([["parent", "parent-turn"]]);
  const activeTurnMetaByThread = new Map([["parent", { visibleOutputCount: 1 }]]);
  const delivered = new Set();
  const context = vm.createContext({
    codex, knownThreads, contactByThread, threadByContact, activeTurnByThread, activeTurnMetaByThread,
    loadedThreads: new Set(), renderCodexItem, mapCodexActivityNotification,
    serverRequests: { handleNotification: () => false }, realtime: { onNotification: () => false },
    contactFor: id => ({ id, name: id }),
    threadIdFromContactId: id => id?.startsWith("thread:") ? id.slice(7) : null,
    messagesFromTurns: (turns, contact) => turns.flatMap(turn => turn.items.map(item => renderCodexItem(item, { author: contact.name })).filter(Boolean)),
    sendToChat: (contactId, event, payload) => chats.push({ contactId, event, payload: normalize(payload) }),
    sendToMain: (event, payload) => mainEvents.push({ event, payload: normalize(payload) }),
    sendToOpenChats: () => {}, logDebug: () => {}, registerIncomingMessage: () => {},
    noteTurnActivity: () => {}, storeThreadItem: () => {},
    threadItemWasDelivered: (threadId, itemId) => delivered.has(threadId + ":" + itemId),
    markThreadItemDelivered: (threadId, itemId) => delivered.add(threadId + ":" + itemId),
    noteVisibleTurnOutput: threadId => {
      const meta = activeTurnMetaByThread.get(threadId);
      if (meta) meta.visibleOutputCount += 1;
    },
    trackActiveTurn: threadId => activeTurnMetaByThread.set(threadId, { visibleOutputCount: 0 }),
    clearActiveTurn: threadId => activeTurnMetaByThread.delete(threadId),
    recoverCompletedTurnOutput: (...args) => recovered.push(args)
  });
  for (const name of ["textFromCompletedItem", "isAgentMessageItem", "isUserMessageItem", "renderedMessageFromThreadItem", "threadMessageContext", "isWorkerForContact", "publicAgentMessageMetadata", "deliverStartedThreadItemToChat", "deliverThreadItemToChat", "deliverTurnItemsToChat"]) {
    vm.runInContext(productionFunction(name), context);
  }
  vm.runInContext(productionNotifications(), context);
  const emit = (method, params) => codex.emit("notification", { method, params });
  return { context, emit, chats, mainEvents, recovered, knownThreads, contactByThread, activeTurnByThread, activeTurnMetaByThread };
}

test("worker deltas, public message metadata and item lifecycle keep the parent turn active", () => {
  const f = fixture();
  f.emit("thread/started", { thread: { id: "child", parentThreadId: "parent" } });
  f.emit("turn/started", { threadId: "child", turn: { id: "child-turn" } });
  f.emit("item/agentMessage/delta", { threadId: "child", turnId: "child-turn", itemId: "answer", delta: "Answer" });
  const answer = { type: "agentMessage", id: "answer", text: "Answer", phase: "final_answer", delivery: "async", questions: [{ title: "Continue?", options: ["Yes", "No"] }], memoryCitation: { entries: [], threadIds: ["parent"] }, privateUnexpected: "must not cross the bridge" };
  f.emit("item/completed", { threadId: "child", turnId: "child-turn", item: answer });
  const tool = { type: "commandExecution", id: "command", command: "printf done", cwd: "/tmp", status: "inProgress", aggregatedOutput: "" };
  f.emit("item/started", { threadId: "child", turnId: "child-turn", item: tool });
  f.emit("item/completed", { threadId: "child", turnId: "child-turn", item: { ...tool, status: "completed", exitCode: 0, aggregatedOutput: "done" } });
  f.emit("turn/completed", { threadId: "child", turn: { id: "child-turn", status: "failed", error: { message: "Worker failed" }, items: [answer] } });
  for (const event of f.chats) {
    assert.equal(event.contactId, "parent-contact");
    assert.equal(event.payload.threadId, "child");
    assert.equal(event.payload.turnId, "child-turn");
    assert.equal(event.payload.parentThreadId, "parent");
    assert.deepEqual(event.payload.ancestorThreadIds, ["parent"]);
    assert.equal(event.payload.isWorker, true);
  }
  const final = f.chats.find(event => event.event === "codex:completed-item").payload;
  assert.equal(final.phase, "final_answer"); assert.equal(final.delivery, "async");
  assert.deepEqual(final.questions, answer.questions); assert.deepEqual(final.memoryCitation, answer.memoryCitation);
  assert.equal(final.privateUnexpected, undefined);
  assert.equal(f.chats.find(event => event.event === "codex:item-started").payload.message.pending, true);
  assert.equal(f.chats.find(event => event.event === "codex:item-completed").payload.message.status, "completed");
  assert.equal(f.chats.find(event => event.event === "codex:done").payload.status, "failed");
  assert.equal(f.activeTurnByThread.get("parent"), "parent-turn");
  assert.equal(f.activeTurnMetaByThread.has("parent"), true);
  assert.equal(f.activeTurnByThread.has("child"), false);
  assert.deepEqual(f.mainEvents, []); assert.deepEqual(f.recovered, []);
});

test("an explicitly opened child conversation receives its own interrupted completion", () => {
  const f = fixture({ childContact: true });
  f.emit("thread/started", { thread: { id: "child", parentThreadId: "parent" } });
  f.emit("turn/started", { threadId: "child", turn: { id: "child-turn" } });
  f.emit("turn/completed", { threadId: "child", turn: { id: "child-turn", status: "interrupted", items: [] } });
  const done = f.chats.find(event => event.event === "codex:done");
  assert.equal(done.contactId, "child-contact");
  assert.equal(done.payload.threadId, "child"); assert.equal(done.payload.isWorker, true);
  assert.equal(done.payload.status, "interrupted");
  assert.equal(f.mainEvents[0].event, "conversation:finished");
  assert.equal(f.mainEvents[0].payload.contactId, "child-contact");
  assert.equal(f.activeTurnByThread.get("parent"), "parent-turn");
  assert.deepEqual(f.recovered, []);
});

test("nested workers route to their ancestor contact with bounded cycle-safe public IDs", () => {
  const f = fixture();
  f.emit("thread/started", { thread: { id: "child", parentThreadId: "parent" } });
  f.emit("thread/started", { thread: { id: "grandchild", parentThreadId: "child" } });
  f.emit("item/agentMessage/delta", { threadId: "grandchild", turnId: "nested-turn", itemId: "nested-answer", delta: "Progress" });
  assert.deepEqual(f.chats[0].payload.ancestorThreadIds, ["child", "parent"]);
  assert.equal(f.chats[0].payload.parentThreadId, "child"); assert.equal(f.chats[0].contactId, "parent-contact");
  f.knownThreads.set("cycle-a", { parentThreadId: "cycle-b" }); f.knownThreads.set("cycle-b", { parentThreadId: "cycle-a" });
  const cyclic = normalize(f.context.threadMessageContext("cycle-a"));
  assert.deepEqual(cyclic.ancestorThreadIds, ["cycle-b"]); assert.equal(cyclic.contactId, null);
  for (let index = 0; index < 100; index++) f.knownThreads.set("depth-" + index, { parentThreadId: "depth-" + (index + 1) });
  assert.equal(f.context.threadMessageContext("depth-0").ancestorThreadIds.length, 64);
  f.emit("item/agentMessage/delta", { threadId: "unknown", turnId: "unknown-turn", itemId: "unknown-answer", delta: "Drop unmapped output" });
  assert.equal(f.chats.length, 1);
});
