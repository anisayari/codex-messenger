import test from "node:test";
import assert from "node:assert/strict";
import { createCodexFeatureService, registerCodexFeatureIpcHandlers } from "../electron/codexFeatureService.js";
import { advertisedModels, advertisedOptionPatch, rateLimitWindows } from "../shared/codexFeatures.js";

const cwd = "/projects/messenger";
const models = [{ id: "test", model: "test-model", displayName: "Test model", isDefault: true, defaultReasoningEffort: "ultra", supportedReasoningEfforts: [{ reasoningEffort: "ultra", description: "Advertised effort" }, { reasoningEffort: "future", description: "Future effort" }], serviceTiers: [{ id: "priority", name: "Priority", description: "Advertised service" }], inputModalities: ["text", "audio"], additionalSpeedTiers: ["invented"] }];

function setup(overrides = {}) {
  const calls = [];
  const responses = {
    "account/read": { account: { type: "chatgpt", email: "member@example.test", planType: "plus" }, requiresOpenaiAuth: true },
    "account/rateLimits/read": { rateLimits: { primary: { usedPercent: 20 } } },
    "model/list": { data: models, nextCursor: null },
    "skills/list": { data: [{ cwd, skills: [{ name: "verified-skill", path: "/skills/verified/SKILL.md", enabled: true, description: "Installed skill", scope: "user" }, { name: "disabled-skill", path: "/skills/disabled/SKILL.md", enabled: false }], errors: [] }] },
    "app/list": { data: [{ id: "app-id", name: "Verified app", isAccessible: true }], nextCursor: null },
    "app/installed": { apps: [{ id: "app-id", enabled: true, callable: true }] },
    "mcpServerStatus/list": { data: [{ name: "verified-mcp", authStatus: "notLoggedIn", runtimeStatus: "authenticationRequired", tools: { tool: { name: "verified-tool", description: "Installed tool", inputSchema: { secret: "not-needed-in-renderer" } } }, resources: [], resourceTemplates: [] }], nextCursor: null },
    "collaborationMode/list": { data: [{ name: "Plan", mode: "plan", model: "test-model" }, { name: "Default", mode: "default", model: "test-model" }] },
    "configRequirements/read": { requirements: { allowedSandboxModes: ["workspace-write"], additionalDeveloperInstructions: "Not for the settings screen", allowedPermissionProfiles: { safe: true } } },
    "permissionProfile/list": { data: [{ id: "safe", allowed: true }], nextCursor: null },
    "account/usage/read": { summary: { lifetimeTokens: null }, dailyUsageBuckets: null, threadUsage: null },
    "plugin/installed": { marketplaces: [], marketplaceLoadErrors: [] },
    "thread/goal/get": { goal: null },
    "thread/queue/list": { data: [], nextCursor: null },
    "memory/status": { v2Ready: false, v2ConsolidatedThreads: 0 },
    "modelProvider/capabilities/read": { webSearch: true, imageGeneration: false, namespaceTools: true },
    "thread/backgroundTerminals/list": { data: [{ processId: "process-1", command: "test command", cwd, itemId: "item-1" }], nextCursor: null },
    "thread/read": { thread: { id: "thread-1", name: "Conversation" } },
    "mcpServer/oauth/login": { authorizationUrl: "https://example.test/oauth" },
    ...overrides
  };
  const codex = { ensureReady: async () => {}, request: async (method, params) => {
    calls.push({ method, params });
    const response = responses[method];
    if (response instanceof Error) throw response;
    if (typeof response === "function") return response(params);
    return response ?? {};
  } };
  const service = createCodexFeatureService({ codex, defaultCwd: () => cwd, resolveContext: ({ contactId }) => {
    if (contactId && contactId !== "contact-1") throw new Error("Contact inconnu");
    return { cwd, threadId: contactId ? "thread-1" : null };
  } });
  return { service, calls };
}

test("the catalog uses real capabilities and preserves independent sections on an unsupported endpoint", async () => {
  const { service, calls } = setup({ "app/list": new Error("Unknown method app/list") });
  const result = await service.catalog({ contactId: "contact-1", threadId: "thread-1" });
  assert.equal(result.sections.apps.available, false);
  assert.equal(result.sections.apps.status, "unsupported");
  assert.equal(result.sections.account.data.account.email, "member@example.test");
  assert.equal(result.sections.models.data.data[0].supportedReasoningEfforts[1].reasoningEffort, "future");
  assert.equal(result.sections.models.data.data[0].serviceTiers[0].id, "priority");
  assert.equal(result.sections.mcpServers.data.data[0].tools[0].inputSchema, undefined);
  assert.equal(result.sections.requirements.data.requirements.additionalDeveloperInstructions, undefined);
  assert.ok(calls.some((call) => call.method === "permissionProfile/list" && call.params.cwd === cwd));
  assert.ok(calls.some((call) => call.method === "thread/read" && call.params.includeTurns === false));
  assert.ok(calls.some((call) => call.method === "plugin/installed"));
  assert.ok(!calls.some((call) => ["plugin/list", "plugin/install", "plugin/uninstall"].includes(call.method)));
});

test("a catalog without a conversation omits thread-only calls", async () => {
  const { service, calls } = setup();
  const result = await service.catalog();
  assert.equal(result.context.threadId, null);
  assert.equal(result.sections.goal, undefined);
  assert.ok(!calls.some((call) => call.method.startsWith("thread/")));
});

test("catalog pagination fetches every page and detects repeated cursors", async () => {
  let page = 0;
  const { service, calls } = setup({ "model/list": () => ++page === 1 ? { data: models, nextCursor: "second" } : { data: [{ ...models[0], id: "second", model: "second-model" }], nextCursor: null } });
  const result = await service.catalog();
  assert.equal(result.sections.models.data.data.length, 2);
  assert.equal(calls.find((call) => call.method === "model/list" && call.params.cursor).params.cursor, "second");
  const cyclic = setup({ "model/list": { data: models, nextCursor: "same" } });
  assert.match((await cyclic.service.catalog()).sections.models.error, /répétée/);
});

test("goal edits send only requested fields, support explicit pause, and validate budgets", async () => {
  const { service, calls } = setup();
  const ctx = { contactId: "contact-1", threadId: "thread-1" };
  await service.action("goal-set", { ...ctx, objective: "Complete this work", tokenBudget: 10000 });
  assert.deepEqual(calls.at(-1), { method: "thread/goal/set", params: { threadId: "thread-1", objective: "Complete this work", tokenBudget: 10000 } });
  await service.action("goal-set", { ...ctx, status: "paused" });
  assert.deepEqual(calls.at(-1).params, { threadId: "thread-1", status: "paused" });
  await assert.rejects(service.action("goal-set", { ...ctx, tokenBudget: -1 }), /Budget/);
  await assert.rejects(service.action("goal-set", { ...ctx, tokenBudget: 1.5 }), /Budget/);
  await assert.rejects(service.action("goal-set", { ...ctx, status: "invented" }), /État/);
  await assert.rejects(service.action("goal-set", ctx), /Aucun changement/);
  await assert.rejects(service.action("goal-set", { objective: "No conversation" }), /Conversation/);
});

test("skill and app mentions must belong to the installed effective runtime", async () => {
  const { service } = setup();
  const ctx = { contactId: "contact-1", threadId: "thread-1" };
  assert.deepEqual(await service.action("skill-input", { ...ctx, path: "/skills/verified/SKILL.md" }), { type: "skill", name: "verified-skill", path: "/skills/verified/SKILL.md" });
  await assert.rejects(service.action("skill-input", { ...ctx, path: "/etc/passwd" }), /absente/);
  await assert.rejects(service.action("skill-input", { ...ctx, path: "/skills/disabled/SKILL.md" }), /désactivée/);
  assert.deepEqual(await service.action("app-input", { ...ctx, id: "app-id" }), { type: "mention", name: "Verified app", path: "app://app-id" });
  const disabled = setup({ "app/installed": { apps: [{ id: "app-id", enabled: true, callable: false }] } });
  await assert.rejects(disabled.service.action("app-input", { ...ctx, id: "app-id" }), /outil actif/);
});

test("connector authentication and reload use schema-supported methods", async () => {
  const { service, calls } = setup();
  const ctx = { contactId: "contact-1", threadId: "thread-1" };
  assert.equal((await service.action("mcp-login", { ...ctx, name: "verified-mcp" })).authorizationUrl, "https://example.test/oauth");
  assert.deepEqual(calls.at(-1), { method: "mcpServer/oauth/login", params: { name: "verified-mcp", threadId: "thread-1", timeoutSecs: 300 } });
  await assert.rejects(service.action("mcp-login", { ...ctx, name: "invented-mcp" }), /OAuth/);
  await service.action("mcp-reload", ctx);
  assert.deepEqual(calls.at(-1), { method: "config/mcpServer/reload", params: null });
});

test("credit consumption requires explicit confirmation and fresh eligibility, and reuses its idempotency key", async () => {
  const { service, calls } = setup({ "account/rateLimits/read": { rateLimits: { primary: { usedPercent: 95 } }, rateLimitResetCredits: { availableCount: 1 } }, "account/rateLimitResetCredit/consume": { outcome: "reset" } });
  await assert.rejects(service.action("credits-consume", { idempotencyKey: "reset-attempt" }), /Confirmez/);
  assert.ok(!calls.length);
  const payload = { confirmed: true, idempotencyKey: "reset-attempt" };
  assert.equal((await service.action("credits-consume", payload)).outcome, "reset");
  assert.deepEqual(calls.at(-1), { method: "account/rateLimitResetCredit/consume", params: { idempotencyKey: "reset-attempt" } });
  await service.action("credits-consume", payload);
  assert.equal(calls.at(-1).params.idempotencyKey, "reset-attempt");
  const ineligible = setup();
  assert.equal((await ineligible.service.action("credits-consume", payload)).outcome, "nothingToReset");
  assert.ok(!ineligible.calls.some((call) => call.method.endsWith("/consume")));
  const noCredit = setup({ "account/rateLimits/read": { rateLimits: { primary: { usedPercent: 99 } }, rateLimitResetCredits: { availableCount: 0 } } });
  assert.equal((await noCredit.service.action("credits-consume", payload)).outcome, "noCredit");
});

test("archive, restore, rename and terminal actions target only the verified conversation", async () => {
  const { service, calls } = setup();
  const ctx = { contactId: "contact-1", threadId: "thread-1" };
  await service.action("archive", ctx);
  assert.deepEqual(calls.at(-1), { method: "thread/archive", params: { threadId: "thread-1" } });
  await service.action("unarchive", ctx);
  assert.equal(calls.at(-1).method, "thread/unarchive");
  await service.action("rename", { ...ctx, name: "Verified conversation" });
  assert.deepEqual(calls.at(-1).params, { threadId: "thread-1", name: "Verified conversation" });
  await service.action("terminal-terminate", { ...ctx, processId: "process-1" });
  assert.deepEqual(calls.at(-1), { method: "thread/backgroundTerminals/terminate", params: { threadId: "thread-1", processId: "process-1" } });
  await assert.rejects(service.action("terminal-terminate", { ...ctx, processId: "other-process" }), /plus actif/);
  const previous = calls.length;
  await assert.rejects(service.action("archive", { ...ctx, threadId: "other-thread" }), /n’appartient/);
  assert.equal(calls.length, previous);
  await assert.rejects(service.action("thread/arbitrary", ctx), /non prise en charge/);
});

test("the IPC surface never accepts an arbitrary RPC method", async () => {
  const { service } = setup();
  const handlers = new Map();
  registerCodexFeatureIpcHandlers({ ipcMain: { handle: (name, handler) => handlers.set(name, handler) }, service });
  assert.deepEqual([...handlers.keys()], ["codex:features", "codex:feature-action"]);
  await assert.rejects(handlers.get("codex:feature-action")({}, "config/value/write", {}), /non prise en charge/);
});

test("model options use advertised reasoning and service values and clear incompatible selections", () => {
  const catalog = advertisedModels({ data: models });
  assert.deepEqual(catalog[0].serviceTiers.map((tier) => tier.id), ["priority"]);
  assert.deepEqual(advertisedOptionPatch(catalog, {}, { model: "test-model", reasoningEffort: "future", serviceTier: "priority" }), { model: "test-model", reasoningEffort: "future", serviceTier: "priority" });
  assert.throws(() => advertisedOptionPatch(catalog, { model: "test-model" }, { reasoningEffort: "invented" }), /raisonnement/);
  assert.throws(() => advertisedOptionPatch(catalog, { model: "test-model" }, { serviceTier: "invented" }), /service/);
  assert.throws(() => advertisedOptionPatch(catalog, {}, { model: "invented" }), /modèle/);
  assert.deepEqual(advertisedOptionPatch(catalog, { model: "old", reasoningEffort: "old", serviceTier: "old" }, { model: "test-model" }), { model: "test-model", reasoningEffort: "", serviceTier: "" });
});

test("quota rendering prefers multi-bucket usage and does not invent unavailable usage", () => {
  assert.deepEqual(rateLimitWindows({ rateLimits: { primary: { usedPercent: null } } }), []);
  const result = rateLimitWindows({ rateLimits: { primary: { usedPercent: 99 } }, rateLimitsByLimitId: { codex: { primary: { usedPercent: 20, windowDurationMins: 300, resetsAt: 1 }, secondary: null }, other: { primary: { usedPercent: 150 } } } });
  assert.equal(result.length, 2);
  assert.equal(result[0].remainingPercent, 80);
  assert.equal(result[0].resetsAt, 1);
  assert.equal(result[1].remainingPercent, 0);
  assert.deepEqual(rateLimitWindows(null), []);
});


test("account login cancellation targets only Messenger login IDs and logout requires explicit confirmation", async () => {
  const { service, calls } = setup({ "account/login/start": { type: "chatgpt", loginId: "login-1", authUrl: "https://example.test/login" }, "account/login/cancel": { status: "canceled" } });
  await assert.rejects(service.action("account-login-cancel", { loginId: "other-login" }), /Messenger/);
  assert.equal((await service.action("account-login")).loginId, "login-1");
  assert.deepEqual(calls.at(-1), { method: "account/login/start", params: { type: "chatgpt" } });
  assert.equal((await service.action("account-login-cancel", { loginId: "login-1" })).status, "canceled");
  assert.deepEqual(calls.at(-1).params, { loginId: "login-1" });
  await assert.rejects(service.action("account-logout"), /Confirmez/);
  await service.action("account-logout", { confirmed: true });
  assert.deepEqual(calls.at(-1), { method: "account/logout", params: null });
});

test("unreported model modalities stay unknown", () => {
  assert.deepEqual(advertisedModels({ data: [{ model: "unknown-modalities" }] })[0].inputModalities, []);
});

test("an uncertain successful reset is reconciled with its original key after fresh quotas changed", async () => {
  let consumed = false;
  const { service, calls } = setup({
    "account/rateLimits/read": () => ({ accountId: "account-1", rateLimits: { primary: { usedPercent: consumed ? 0 : 95 } }, rateLimitResetCredits: { availableCount: consumed ? 0 : 1 } }),
    "account/rateLimitResetCredit/consume": () => { if (!consumed) { consumed = true; throw new Error("Timed out after backend consumption"); } return { outcome: "alreadyRedeemed" }; }
  });
  const attempt = { confirmed: true, idempotencyKey: "uncertain-reset" };
  await assert.rejects(service.action("credits-consume", attempt), /Timed out/);
  assert.equal((await service.catalog()).localState.pendingResetAttempt, "uncertain-reset");
  await assert.rejects(service.action("credits-consume", { ...attempt, idempotencyKey: "new-reset" }), /précédente/);
  assert.equal((await service.action("credits-consume", attempt)).outcome, "alreadyRedeemed");
  assert.equal(calls.filter((call) => call.method.endsWith("/consume")).length, 2);
  assert.equal(calls.at(-1).params.idempotencyKey, "uncertain-reset");
  assert.equal((await service.catalog()).localState.pendingResetAttempt, null);
});


test("text queue CRUD preserves correlation IDs and reorders the complete current queue", async () => {
  let entries = [{ id: "queued-1", clientUserMessageId: "client-1", input: [{ type: "text", text: "First", text_elements: [] }] }];
  const { service, calls } = setup({
    "thread/queue/list": () => ({ data: entries.slice(), nextCursor: null }),
    "thread/queue/add": (params) => { const queuedSubmission = { id: "queued-2", clientUserMessageId: params.clientUserMessageId, input: params.input }; entries.push(queuedSubmission); return { queuedSubmission }; },
    "thread/queue/update": (params) => { entries = entries.map((item) => item.id === params.queuedSubmissionId ? { ...item, input: params.input } : item); return { queuedSubmission: entries.find((item) => item.id === params.queuedSubmissionId) }; },
    "thread/queue/reorder": (params) => { entries = params.queuedSubmissionIds.map((id) => entries.find((item) => item.id === id)); return {}; },
    "thread/queue/delete": (params) => { entries = entries.filter((item) => item.id !== params.queuedSubmissionId); return { deleted: true }; },
    "thread/queue/start": () => ({ turn: { id: "queued-turn", status: "inProgress", items: [] } })
  });
  const ctx = { contactId: "contact-1", threadId: "thread-1" };
  const accepted = await service.action("queue-add", { ...ctx, text: "Second", clientUserMessageId: "client-2" });
  assert.equal(accepted.queuedSubmission.clientUserMessageId, "client-2");
  assert.deepEqual(calls.at(-1).params.input, [{ type: "text", text: "Second", text_elements: [] }]);
  await service.action("queue-update", { ...ctx, queuedSubmissionId: "queued-2", text: "Edited" });
  assert.equal(entries[1].input[0].text, "Edited");
  await assert.rejects(service.action("queue-reorder", { ...ctx, queuedSubmissionIds: ["queued-2"] }), /chaque message/);
  await assert.rejects(service.action("queue-reorder", { ...ctx, queuedSubmissionIds: ["queued-2", "queued-2"] }), /chaque message/);
  await service.action("queue-reorder", { ...ctx, queuedSubmissionIds: ["queued-2", "queued-1"] });
  assert.deepEqual(entries.map((item) => item.id), ["queued-2", "queued-1"]);
  assert.equal((await service.action("queue-start", { ...ctx, queuedSubmissionId: "queued-2" })).turn.id, "queued-turn");
  assert.deepEqual(calls.at(-1).params, { threadId: "thread-1", queuedSubmissionId: "queued-2" });
  await service.action("queue-delete", { ...ctx, queuedSubmissionId: "queued-1" });
  await assert.rejects(service.action("queue-delete", { ...ctx, queuedSubmissionId: "missing" }), /plus dans la file/);
});

test("queue edits cannot silently replace attachments or another conversation", async () => {
  const { service, calls } = setup({ "thread/queue/list": { data: [{ id: "attached", clientUserMessageId: "client-1", input: [{ type: "localImage", path: "/project/image.png" }] }] } });
  await assert.rejects(service.action("queue-update", { contactId: "contact-1", threadId: "thread-1", queuedSubmissionId: "attached", text: "Replacement" }), /pièces jointes/);
  assert.ok(!calls.some((call) => call.method === "thread/queue/update"));
  await assert.rejects(service.action("queue-add", { contactId: "contact-1", threadId: "other-thread", text: "Wrong conversation", clientUserMessageId: "client-2" }), /n’appartient/);
});

test("an uncertain queue send is reconciled without replaying its submission", async () => {
  const entries = [];
  const { service, calls } = setup({
    "thread/queue/list": () => ({ data: entries, nextCursor: null }),
    "thread/queue/add": (params) => { entries.push({ id: "queued-1", clientUserMessageId: params.clientUserMessageId, input: params.input }); throw new Error("Timed out after queue accepted"); }
  });
  const ctx = { contactId: "contact-1", threadId: "thread-1" };
  await assert.rejects(service.action("queue-add", { ...ctx, text: "Accepted but response lost", clientUserMessageId: "client-1" }), /Timed out/);
  assert.equal((await service.catalog(ctx)).localState.pendingQueueSubmission.clientUserMessageId, "client-1");
  await assert.rejects(service.action("queue-add", { ...ctx, text: "Retry", clientUserMessageId: "client-2" }), /attend vérification/);
  assert.equal((await service.action("queue-reconcile", ctx)).state, "queued");
  assert.equal(calls.filter((call) => call.method === "thread/queue/add").length, 1);
  assert.equal((await service.catalog(ctx)).localState.pendingQueueSubmission, null);
});

test("memory mode is an explicit accepted action rather than an invented readable toggle", async () => {
  const { service, calls } = setup();
  const ctx = { contactId: "contact-1", threadId: "thread-1" };
  assert.equal((await service.catalog(ctx)).sections.memory.data.v2Ready, false);
  await service.action("memory-mode", { ...ctx, mode: "disabled" });
  assert.deepEqual(calls.at(-1), { method: "thread/memoryMode/set", params: { threadId: "thread-1", mode: "disabled" } });
  await assert.rejects(service.action("memory-mode", { ...ctx, mode: "invented" }), /mémoire/);
  assert.ok(!calls.some((call) => call.method === "memory/reset"));
});


test("server thread search preserves cursors and hides conversations outside the selected contact", async () => {
  const { service, calls } = setup({ "thread/search": (params) => ({ data: [{ snippet: "Matched in current", thread: { id: "thread-1", name: "Current", cwd } }, { snippet: "Private other contact", thread: { id: "other-thread", name: "Other", cwd: "/other" } }], nextCursor: params.cursor ? null : "search-next" }) });
  const ctx = { contactId: "contact-1", threadId: "thread-1", searchTerm: "Matched", archived: true };
  const first = await service.action("search-threads", ctx);
  assert.deepEqual(first.data.map((hit) => hit.thread.id), ["thread-1"]);
  assert.equal(first.nextCursor, "search-next");
  assert.deepEqual(calls[0], { method: "thread/search", params: { searchTerm: "Matched", archived: true, limit: 25, sortKey: "updated_at", sortDirection: "desc" } });
  const next = await service.action("search-threads", { ...ctx, cursor: first.nextCursor });
  assert.equal(next.nextCursor, null);
  assert.equal(calls.filter((call) => call.method === "thread/search").at(-1).params.cursor, "search-next");
  await assert.rejects(service.action("search-threads", { searchTerm: "Anything" }), /contact/);
  await assert.rejects(service.action("search-threads", { ...ctx, archived: "yes" }), /archive/);
  await assert.rejects(service.action("search-threads", { ...ctx, searchTerm: " " }), /Recherche/);
});

test("server occurrence search uses exact thread scope and UTF-16 match metadata", async () => {
  const occurrence = { itemId: "message-1", turnId: "turn-1", turnCursor: "inclusive-turn", snippet: "😀 Match", snippetMatchRange: { start: 3, end: 8 } };
  const { service, calls } = setup({ "thread/searchOccurrences": { data: [occurrence], nextCursor: "occurrences-next" } });
  const ctx = { contactId: "contact-1", threadId: "thread-1", searchTerm: "Match", cursor: "previous" };
  assert.deepEqual((await service.action("search-occurrences", ctx)).data, [occurrence]);
  assert.deepEqual(calls.at(-1), { method: "thread/searchOccurrences", params: { threadId: "thread-1", searchTerm: "Match", limit: 25, cursor: "previous" } });
  await assert.rejects(service.action("search-occurrences", { ...ctx, threadId: "other-thread" }), /n’appartient/);
  await service.action("search-open", ctx);
  assert.deepEqual(calls.at(-1), { method: "thread/read", params: { threadId: "thread-1", includeTurns: false } });
  const unsupported = setup({ "thread/searchOccurrences": new Error("Unknown method thread/searchOccurrences") });
  await assert.rejects(unsupported.service.action("search-occurrences", ctx), /Unknown method/);
});

test("manual compact checks fresh idle direct-input metadata and sends only the schema threadId", async () => {
  const ctx = { contactId: "contact-1", threadId: "thread-1" };
  const idle = { id: "thread-1", status: { type: "idle" }, canAcceptDirectInput: true };
  const { service, calls } = setup({ "thread/read": { thread: idle } });
  await service.action("compact", ctx);
  assert.deepEqual(calls.at(-1), { method: "thread/compact/start", params: { threadId: "thread-1" } });
  for (const thread of [{ ...idle, status: { type: "active", activeFlags: [] } }, { ...idle, canAcceptDirectInput: false }, { ...idle, status: { type: "notLoaded" } }]) {
    const blocked = setup({ "thread/read": { thread } });
    await assert.rejects(blocked.service.action("compact", ctx), /inactive/);
    assert.ok(!blocked.calls.some((call) => call.method === "thread/compact/start"));
  }
});

test("modern history revert requires explicit confirmation and freshly verified last user turn", async () => {
  const ctx = { contactId: "contact-1", threadId: "thread-1" };
  const thread = { id: "thread-1", historyMode: "paginated", status: { type: "idle" }, ephemeral: false, canAcceptDirectInput: true };
  const turn = { id: "tail-2", status: "completed", items: [{ type: "userMessage", content: [{ type: "text", text: "Last user message" }] }] };
  const { service, calls } = setup({ "thread/read": { thread }, "thread/turns/list": { data: [turn], nextCursor: "older" }, "thread/revert": { thread: { ...thread, turns: [] }, turnsBackwardsCursor: "retained-prefix" } });
  const catalog = await service.catalog(ctx);
  assert.equal(catalog.sections.historyTail.data.ready, true);
  assert.equal(catalog.sections.historyTail.data.lastTurn.preview, "Last user message");
  await assert.rejects(service.action("history-revert", { ...ctx, expectedLastTurnId: "tail-2" }), /Confirmez/);
  await assert.rejects(service.action("history-revert", { ...ctx, confirmed: true, expectedLastTurnId: "stale" }), /a changé/);
  assert.ok(!calls.some((call) => call.method === "thread/revert"));
  await service.action("history-revert", { ...ctx, confirmed: true, expectedLastTurnId: "tail-2" });
  assert.deepEqual(calls.at(-1), { method: "thread/revert", params: { threadId: "thread-1", beforeTurnId: "tail-2" } });
  assert.ok(!calls.some((call) => call.method === "thread/rollback"));
  assert.deepEqual(calls.find((call) => call.method === "thread/turns/list").params, { threadId: "thread-1", limit: 1, sortDirection: "desc", itemsView: "full" });
  for (const blockedThread of [{ ...thread, ephemeral: true }, { ...thread, status: { type: "active", activeFlags: [] } }, { ...thread, canAcceptDirectInput: false }]) {
    const blocked = setup({ "thread/read": { thread: blockedThread }, "thread/turns/list": { data: [turn] } });
    await assert.rejects(blocked.service.action("history-revert", { ...ctx, confirmed: true, expectedLastTurnId: "tail-2" }), /persisté/);
    assert.ok(!blocked.calls.some((call) => call.method === "thread/revert"));
  }
});

test("Codex 0.156.0 does not dispatch the removed legacy rollback RPC", async () => {
  const ctx = { contactId: "contact-1", threadId: "thread-1" };
  const turn = { id: "legacy-tail", status: "completed", items: [{ type: "userMessage", content: [{ type: "text", text: "Legacy input" }] }] };
  const thread = { id: "thread-1", historyMode: "legacy", status: { type: "idle" }, ephemeral: false, canAcceptDirectInput: true, turns: [turn] };
  const { service, calls } = setup({ "thread/read": { thread } });
  const catalog = await service.catalog(ctx);
  assert.equal(catalog.sections.historyTail.data.ready, false);
  assert.equal(catalog.sections.historyTail.data.lastTurn.id, turn.id);
  await assert.rejects(service.action("history-revert", { ...ctx, confirmed: true, expectedLastTurnId: turn.id }), /supprimé rollback/);
  assert.ok(!calls.some((call) => call.method === "thread/rollback" || call.method === "thread/revert"));
});

test("lost successful history revert cannot delete another turn on a stale retry", async () => {
  const ctx = { contactId: "contact-1", threadId: "thread-1", confirmed: true, expectedLastTurnId: "original-tail" };
  const thread = { id: "thread-1", historyMode: "paginated", status: { type: "idle" }, ephemeral: false, canAcceptDirectInput: true };
  let tailId = "original-tail";
  const { service, calls } = setup({ "thread/read": { thread }, "thread/turns/list": () => ({ data: [{ id: tailId, status: "completed", items: [{ type: "userMessage", content: [{ type: "text", text: "Input" }] }] }] }), "thread/revert": () => { tailId = "retained-previous"; throw new Error("Timed out after history was replaced"); } });
  await assert.rejects(service.action("history-revert", ctx), /Timed out/);
  await assert.rejects(service.action("history-revert", ctx), /a changé/);
  assert.equal(calls.filter((call) => call.method === "thread/revert").length, 1);
  assert.equal((await service.catalog(ctx)).sections.historyTail.data.lastTurn.id, "retained-previous");
});


test("same-service historical mutations serialize before any second deletion RPC", async () => {
  const thread = { id: "thread-1", historyMode: "paginated", status: { type: "idle" }, ephemeral: false, canAcceptDirectInput: true, turns: [{ id: "tail", status: "completed", items: [{ type: "userMessage", content: [{ type: "text", text: "Input" }] }] }] };
  let release;
  const blockedResponse = new Promise((resolve) => { release = resolve; });
  const { service, calls } = setup({ "thread/read": { thread }, "thread/turns/list": { data: thread.turns }, "thread/revert": () => blockedResponse });
  const ctx = { contactId: "contact-1", threadId: "thread-1", confirmed: true, expectedLastTurnId: "tail" };
  const first = service.action("history-revert", ctx);
  while (!calls.some((call) => call.method === "thread/revert")) await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(service.action("history-revert", ctx), /déjà en cours/);
  release({ thread: { ...thread, turns: [] } });
  await first;
  assert.equal(calls.filter((call) => call.method === "thread/revert").length, 1);
});

test("unmaterialized paginated history preserves visible server refusal and performs no mutation", async () => {
  const thread = { id: "thread-1", historyMode: "paginated", status: { type: "idle" }, ephemeral: false, canAcceptDirectInput: true };
  const { service, calls } = setup({ "thread/read": { thread }, "thread/turns/list": new Error("thread is not materialized yet; thread/turns/list is unavailable before first user message") });
  const ctx = { contactId: "contact-1", threadId: "thread-1" };
  const catalog = await service.catalog(ctx);
  assert.equal(catalog.sections.historyTail.available, false);
  assert.match(catalog.sections.historyTail.error, /not materialized/);
  await assert.rejects(service.action("history-revert", { ...ctx, confirmed: true, expectedLastTurnId: "unknown" }), /not materialized/);
  assert.ok(!calls.some((call) => call.method === "thread/revert" || call.method === "thread/rollback"));
});


test("usage dashboard reads account and verified thread scopes without fabricating missing counters", async () => {
  const snapshot = { summary: { lifetimeTokens: null, peakDailyTokens: 0, currentStreakDays: null }, dailyUsageBuckets: [{ startDate: "2026-09-22", tokens: 0 }] };
  const threadUsage = { threadId: "thread-1", estimatedUsageCreditsMicros: 1250000, estimatedUsageUsdMicros: null, groups: [{ model: "advertised-model", totalTokens: null, inputTokens: 0, cachedInputTokens: null, netNewInputTokens: null, outputTokens: 0, estimatedUsageCreditsMicros: 1250000 }] };
  const { service, calls } = setup({ "account/usage/read": (params) => ({ ...snapshot, ...(params?.threadId ? { threadUsage } : {}) }) });
  const result = await service.catalog({ contactId: "contact-1", threadId: "thread-1" });
  assert.deepEqual(result.sections.accountUsage.data, snapshot);
  assert.equal(result.sections.accountUsage.data.summary.lifetimeTokens, null);
  assert.equal(result.sections.accountUsage.data.summary.peakDailyTokens, 0);
  assert.deepEqual(result.sections.threadUsage.data.threadUsage, threadUsage);
  assert.deepEqual(calls.filter((call) => call.method === "account/usage/read").map((call) => call.params), [null, { threadId: "thread-1" }]);
});

test("usage provider failures remain independent and unknown daily activity remains null", async () => {
  const unsupported = setup({ "account/usage/read": new Error("Unknown method account/usage/read") });
  const rejected = await unsupported.service.catalog();
  assert.equal(rejected.sections.accountUsage.status, "unsupported");
  assert.equal(rejected.sections.models.available, true);
  const unknown = setup({ "account/usage/read": { summary: {}, dailyUsageBuckets: null } });
  assert.equal((await unknown.service.catalog()).sections.accountUsage.data.dailyUsageBuckets, null);
  const malformed = setup({ "account/usage/read": { summary: null } });
  assert.equal((await malformed.service.catalog()).sections.accountUsage.available, false);
});

test("a thread usage estimate cannot expose another thread billing route", async () => {
  const { service } = setup({ "account/usage/read": (params) => ({ summary: {}, ...(params?.threadId ? { threadUsage: { threadId: "other-thread", estimatedUsageCreditsMicros: 1, groups: [] } } : {}) }) });
  const result = await service.catalog({ contactId: "contact-1", threadId: "thread-1" });
  assert.equal(result.sections.accountUsage.available, true);
  assert.equal(result.sections.threadUsage.available, false);
  assert.match(result.sections.threadUsage.error, /ne correspond pas/);
  assert.equal(result.sections.threadUsage.data, null);
});

test("plugin inventory uses installed booleans and MCP capabilities only as advertised", async () => {
  const installed = { id: "plugin-one", name: "Installed", installed: true, enabled: false, localVersion: "1.2.3" };
  const capabilities = { logging: {}, tools: { listChanged: true }, resources: { subscribe: false }, experimental: { advertised: true } };
  const { service, calls } = setup({
    "plugin/installed": { marketplaces: [{ name: "Local", plugins: [installed, installed, { id: "suggestion", name: "Suggestion", installed: false, enabled: true }] }], marketplaceLoadErrors: [{ message: "A configured marketplace could not be loaded" }] },
    "mcpServerStatus/list": { data: [{ name: "capable-server", authStatus: "unsupported", tools: {}, resources: [], resourceTemplates: [], serverCapabilities: capabilities }] }
  });
  const result = await service.catalog();
  assert.deepEqual(result.sections.plugins.data.data, [{ id: "plugin-one", name: "Installed", installed: true, enabled: false, version: "1.2.3", marketplace: "Local" }]);
  assert.equal(result.sections.plugins.data.errors.length, 1);
  assert.deepEqual(result.sections.mcpServers.data.data[0].serverCapabilities, capabilities);
  assert.deepEqual(calls.find((call) => call.method === "plugin/installed").params, { cwds: [cwd] });
  assert.equal((await setup().service.catalog()).sections.mcpServers.data.data[0].serverCapabilities, null);
});


test("observed resume mode is readonly sanitized runtime metadata and never pins user settings", async () => {
  const calls = [];
  const observed = { mode: "plan", settings: { model: "runtime-advertised-model", reasoning_effort: "high", developer_instructions: "Never expose or save" } };
  const service = createCodexFeatureService({ defaultCwd: () => cwd, resolveContext: () => ({ cwd, threadId: "thread-1" }), codex: { ensureReady: async () => {}, getObservedCollaborationMode: (id) => { assert.equal(id, "thread-1"); return observed; }, request: async (method, params) => { calls.push({ method, params }); throw new Error("Unknown method " + method); } } });
  const result = await service.catalog({ threadId: "thread-1" });
  assert.deepEqual(result.localState.observedCollaborationMode, { mode: "plan", settings: { model: "runtime-advertised-model", reasoning_effort: "high" } });
  result.localState.observedCollaborationMode.settings.model = "mutated-copy";
  assert.equal(observed.settings.model, "runtime-advertised-model");
  assert.ok(!calls.some(call => /config.*write|thread.*update|turn.start/.test(call.method)));
  assert.equal((await setup().service.catalog()).localState.observedCollaborationMode, null);
});
