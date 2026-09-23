import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeServerRequest,
  permissionChoices,
  permissionsFromChoices,
  serverRequestDecisions,
  serverRequestResponse,
  validateElicitationContent
} from "../shared/serverRequestUtils.js";
import { createServerRequestsController } from "../electron/serverRequests.js";

const context = { id: "server-request-1", contactId: "alice" };
const correlation = { threadId: "thread-alice", turnId: "turn-1", itemId: "item-1" };

function commandRequest(id = 17, params = {}) {
  return {
    id,
    method: "item/commandExecution/requestApproval",
    params: { ...correlation, startedAtMs: 1000, command: "git status", cwd: "/project", ...params }
  };
}

function inputRequest(id = 18, params = {}) {
  return {
    id,
    method: "item/tool/requestUserInput",
    params: {
      ...correlation,
      isBlocking: true,
      questions: [{
        id: "route", header: "Approach", question: "Which approach?", isOther: false,
        options: [{ label: "Keep", description: "Keep the current behavior." }, { label: "Replace", description: "Replace it." }]
      }],
      ...params
    }
  };
}

const requestedPermissions = {
  fileSystem: {
    read: ["/data/report.csv", "/data/reference.csv"],
    write: ["/project/export"],
    entries: [{ access: "read", path: { type: "glob_pattern", pattern: "/logs/*.txt" } }],
    globScanMaxDepth: 3
  },
  network: { enabled: true }
};

function permissionsRequest(id = 19, permissions = requestedPermissions) {
  return {
    id,
    method: "item/permissions/requestApproval",
    params: { ...correlation, startedAtMs: 1000, cwd: "/project", permissions }
  };
}

function elicitationRequest(id = 20, params = {}) {
  return {
    id,
    method: "mcpServer/elicitation/request",
    params: {
      threadId: "thread-alice", turnId: "turn-1", serverName: "calendar", mode: "form",
      message: "Choose the meeting details.",
      requestedSchema: {
        type: "object", required: ["name"], properties: { name: { type: "string", minLength: 2 } }
      },
      ...params
    }
  };
}

function fixture() {
  const replies = [];
  const errors = [];
  const deliveries = [];
  const resolutions = [];
  const controller = createServerRequestsController({
    codex: {
      respond: (id, result) => replies.push({ id, result }),
      respondError: (id, message, code) => errors.push({ id, message, code })
    },
    resolveContact: (params) => {
      const threadId = params.threadId ?? params.conversationId;
      return threadId === "thread-alice" ? "alice" : threadId === "thread-bob" ? "bob" : null;
    },
    deliver: (payload) => deliveries.push(payload),
    resolved: (payload) => resolutions.push(payload),
    now: () => 1234
  });
  return { controller, replies, errors, deliveries, resolutions };
}

test("server requests retain wire IDs and expose a separate local ID", () => {
  for (const requestId of [0, 17, "17", "callback/opaque"]) {
    const payload = normalizeServerRequest(commandRequest(requestId), context);
    assert.equal(payload.id, context.id);
    assert.equal(payload.serverRequestId, context.id);
    assert.equal(payload.requestId, requestId);
    assert.equal(payload.contactId, "alice");
    assert.equal(payload.kind, "command");
    assert.equal(payload.threadId, correlation.threadId);
    assert.equal(payload.turnId, correlation.turnId);
  }
});

test("unsupported and malformed requests cannot become actionable prompts", () => {
  for (const message of [
    null,
    { method: "item/commandExecution/requestApproval", params: {} },
    { ...commandRequest(), id: {} },
    { ...commandRequest(), params: null },
    { ...commandRequest(), params: { ...commandRequest().params, threadId: null } },
    { ...commandRequest(), method: "imaginary/approveEverything" },
    inputRequest(18, { questions: "not questions" }),
    inputRequest(18, { questions: [{ id: "route", header: "Approach" }] })
  ]) {
    assert.throws(() => normalizeServerRequest(message, context));
  }
});

test("command decisions honor server restrictions and exact proposed amendments", () => {
  const amendment = { acceptWithExecpolicyAmendment: { execpolicy_amendment: ["git", "status"] } };
  const networkRule = { applyNetworkPolicyAmendment: { network_policy_amendment: { host: "example.com", action: "allow" } } };
  const payload = normalizeServerRequest(commandRequest(17, {
    availableDecisions: ["decline", amendment, networkRule],
    proposedExecpolicyAmendment: ["git", "status"],
    proposedNetworkPolicyAmendments: [{ host: "example.com", action: "allow" }]
  }), context);
  assert.deepEqual(serverRequestDecisions(payload).map((entry) => entry.value), ["decline", amendment, networkRule]);
  assert.deepEqual(serverRequestResponse(payload, { decision: amendment }), { decision: amendment });
  assert.deepEqual(serverRequestResponse(payload, { decision: networkRule }), { decision: networkRule });
  assert.throws(() => serverRequestResponse(payload, { decision: "acceptForSession" }));
  assert.throws(() => serverRequestResponse(payload, {
    decision: { acceptWithExecpolicyAmendment: { execpolicy_amendment: ["git"] } }
  }));
  assert.throws(() => serverRequestResponse(payload, {
    decision: { applyNetworkPolicyAmendment: { network_policy_amendment: { host: "other.example", action: "allow" } } }
  }));
});

test("file approvals use file decisions and display the actual changed files", () => {
  const payload = normalizeServerRequest({
    id: 21, method: "item/fileChange/requestApproval",
    params: { ...correlation, startedAtMs: 1000, grantRoot: "/project/export" }
  }, {
    ...context,
    item: { id: "item-1", type: "fileChange", changes: [{ path: "/project/export/report.txt", kind: { type: "add" }, diff: "+hello" }] }
  });
  assert.equal(payload.kind, "file");
  assert.match(JSON.stringify(payload), /report\.txt/);
  assert.deepEqual(serverRequestResponse(payload, { decision: "decline" }), { decision: "decline" });
  assert.throws(() => serverRequestResponse(payload, {
    decision: { acceptWithExecpolicyAmendment: { execpolicy_amendment: ["git"] } }
  }));
});

test("legacy approvals emit the structured denied decision required by Codex", () => {
  for (const message of [
    {
      id: "legacy-command", method: "execCommandApproval",
      params: { conversationId: "thread-alice", callId: "old-1", command: ["git", "status"], cwd: "/project", parsedCmd: [] }
    },
    {
      id: "legacy-patch", method: "applyPatchApproval",
      params: { conversationId: "thread-alice", callId: "old-2", fileChanges: { "/project/a.txt": { type: "add", content: "hello" } } }
    }
  ]) {
    const payload = normalizeServerRequest(message, context);
    const decline = serverRequestDecisions(payload).find(({ value }) => typeof value === "object" && value?.denied);
    assert.ok(decline, "A legacy decline must carry a rejection explanation.");
    assert.equal(typeof decline.value.denied.rejection, "string");
    assert.deepEqual(serverRequestResponse(payload, { decision: decline.value }), { decision: decline.value });
    assert.deepEqual(serverRequestResponse(payload, { decision: "denied" }), { decision: decline.value });
    assert.throws(() => serverRequestResponse(payload, { decision: "timed_out" }));
  }
});

test("question responses require valid question IDs and option labels", () => {
  const payload = normalizeServerRequest(inputRequest(), context);
  const response = { answers: { route: { answers: ["Replace"] } } };
  assert.equal(payload.kind, "user-input");
  assert.deepEqual(serverRequestResponse(payload, response), response);
  for (const invalid of [
    { answers: { route: { answers: ["unoffered label"] } } },
    { answers: { route: { answers: [1] } } },
    { answers: { otherQuestion: { answers: ["Replace"] } } }
  ]) assert.throws(() => serverRequestResponse(payload, invalid));
});

test("free answers are accepted only for questions that permit them", () => {
  const payload = normalizeServerRequest(inputRequest(18, {
    questions: [{ id: "custom", header: "Approach", question: "Which approach?", isOther: true, options: [{ label: "Keep", description: "Keep it." }] }]
  }), context);
  const response = { answers: { custom: { answers: ["A different approach"] } } };
  assert.deepEqual(serverRequestResponse(payload, response), response);
});

test("permission choices reconstruct only the requested paths, entries and network access", () => {
  const choices = permissionChoices(requestedPermissions);
  assert.equal(new Set(choices.map(({ id }) => id)).size, choices.length);
  assert.deepEqual(permissionsFromChoices(requestedPermissions, choices.map(({ id }) => id)), requestedPermissions);
  const readChoice = choices.find((choice) => choice.value === "/data/report.csv");
  assert.ok(readChoice, "The requested read path must be individually selectable.");
  const subset = permissionsFromChoices(requestedPermissions, [readChoice.id]);
  assert.deepEqual(subset.fileSystem.read, ["/data/report.csv"]);
  assert.ok(!subset.fileSystem.write?.length);
  assert.ok(!subset.network?.enabled);
  assert.throws(() => permissionsFromChoices(requestedPermissions, ["unrequested-permission"]));
});

test("permission replies cannot escalate requested access or enable unrequested network", () => {
  const payload = normalizeServerRequest(permissionsRequest(), context);
  const response = { permissions: { fileSystem: { read: ["/data/report.csv"] } }, scope: "turn" };
  assert.deepEqual(serverRequestResponse(payload, response), response);
  for (const invalid of [
    { permissions: { fileSystem: { read: ["/etc/shadow"] } }, scope: "turn" },
    { permissions: { fileSystem: { write: ["/data/report.csv"] } }, scope: "turn" },
    { permissions: { fileSystem: { entries: [{ access: "write", path: { type: "glob_pattern", pattern: "/logs/*.txt" } }] } }, scope: "turn" },
    { permissions: { fileSystem: { globScanMaxDepth: 10 } }, scope: "turn" },
    { permissions: {}, scope: "forever" }
  ]) assert.throws(() => serverRequestResponse(payload, invalid));
  const withoutNetwork = normalizeServerRequest(permissionsRequest(19, { fileSystem: { read: ["/data/report.csv"] } }), context);
  assert.throws(() => serverRequestResponse(withoutNetwork, { permissions: { network: { enabled: true } }, scope: "turn" }));
});

const meetingSchema = {
  type: "object",
  required: ["flavor", "count", "day", "at", "flags", "enabled", "email", "uri"],
  properties: {
    flavor: { type: "string", oneOf: [{ const: "vanilla", title: "Original" }, { const: "chocolate", title: "Chocolate" }] },
    count: { type: "integer", minimum: 2, maximum: 5 },
    day: { type: "string", format: "date" },
    at: { type: "string", format: "date-time" },
    flags: { type: "array", minItems: 1, maxItems: 2, items: { enum: ["quiet", "recorded"], type: "string" } },
    enabled: { type: "boolean" },
    email: { type: "string", format: "email" },
    uri: { type: "string", format: "uri" }
  }
};
const meeting = {
  flavor: "vanilla", count: 3, day: "2026-09-22", at: "2026-09-22T10:20:30+02:00",
  flags: ["quiet"], enabled: true, email: "person@example.com", uri: "https://example.com/meeting"
};

test("MCP form validation enforces enum values, numeric limits and real dates", () => {
  assert.deepEqual(validateElicitationContent(meetingSchema, meeting), []);
  for (const changes of [
    { flavor: "Original" }, { count: "3" }, { count: 1 }, { count: 6 }, { count: 2.5 }, { count: Number.NaN },
    { day: "2026-02-29" }, { day: "2026-13-01" }, { at: "2026-09-22" },
    { at: "2026-02-29T10:20:30Z" }, { at: "2026-09-22T24:00:00Z" },
    { flags: [] }, { flags: ["unoffered"] }, { flags: ["quiet", "recorded", "quiet"] },
    { enabled: "true" }, { email: "bad-address" }, { uri: "not a URI" }
  ]) {
    const errors = validateElicitationContent(meetingSchema, { ...meeting, ...changes });
    assert.ok(errors.length > 0, `Expected validation errors for ${JSON.stringify(changes)}`);
    assert.ok(errors.every((error) => typeof error === "string"));
  }
  const missing = { ...meeting };
  delete missing.flavor;
  assert.ok(validateElicitationContent(meetingSchema, missing).length);
});

test("MCP replies validate accepted content and clear declined form content", () => {
  const payload = normalizeServerRequest(elicitationRequest(20, { requestedSchema: meetingSchema }), context);
  assert.equal(payload.kind, "elicitation");
  assert.deepEqual(serverRequestResponse(payload, { action: "accept", content: meeting }), { action: "accept", content: meeting });
  assert.throws(() => serverRequestResponse(payload, { action: "accept", content: { ...meeting, count: 8 } }));
  assert.throws(() => serverRequestResponse(payload, { action: "invented", content: meeting }));
  assert.deepEqual(serverRequestResponse(payload, { action: "decline", content: meeting }), { action: "decline" });
});

test("server resolution matches typed wire IDs and never sends a reply", () => {
  const { controller, deliveries, replies, errors, resolutions } = fixture();
  controller.receive(commandRequest(17));
  controller.receive(commandRequest("17"));
  assert.equal(deliveries.length, 2);
  assert.notEqual(deliveries[0].id, deliveries[1].id);
  controller.handleNotification({ method: "serverRequest/resolved", params: { threadId: "thread-alice", requestId: 17 } });
  assert.equal(controller.payloadsForContact("alice").length, 1);
  assert.equal(controller.payloadsForContact("alice")[0].requestId, "17");
  assert.equal(resolutions.length, 1);
  assert.deepEqual(replies, []);
  assert.deepEqual(errors, []);
});

test("another contact and stale dialogs cannot answer a pending request", async () => {
  const { controller, deliveries, replies } = fixture();
  controller.receive(commandRequest());
  const requestId = deliveries[0].id;
  assert.equal((await controller.respond({ requestId, response: { decision: "accept" } }, "bob")).ok, false);
  assert.equal(controller.payloadsForContact("alice").length, 1);
  assert.deepEqual(replies, []);
  assert.equal((await controller.respond({ requestId, response: { decision: "accept" } }, "alice")).ok, true);
  assert.deepEqual(replies, [{ id: 17, result: { decision: "accept" } }]);
  assert.equal((await controller.respond({ requestId, response: { decision: "accept" } }, "alice")).ok, false);
  assert.equal(replies.length, 1);
});

test("invalid answers leave the dialog pending for correction", async () => {
  const { controller, deliveries, replies } = fixture();
  controller.receive(inputRequest());
  const requestId = deliveries[0].id;
  assert.equal((await controller.respond({ requestId, response: { answers: { route: { answers: ["invented"] } } } }, "alice")).ok, false);
  assert.equal(controller.payloadsForContact("alice").length, 1);
  assert.deepEqual(replies, []);
  assert.equal((await controller.respond({ requestId, response: { answers: { route: { answers: ["Keep"] } } } }, "alice")).ok, true);
  assert.equal(controller.payloadsForContact("alice").length, 0);
});

test("normal turn completion preserves asynchronous questions but expires blocking prompts", () => {
  const { controller, deliveries, replies, errors } = fixture();
  controller.receive(inputRequest(18, { isBlocking: false }));
  controller.receive(commandRequest(17));
  controller.receive(inputRequest(19, { isBlocking: true }));
  controller.handleNotification({ method: "turn/completed", params: { threadId: "thread-alice", turn: { id: "turn-1", status: "completed" } } });
  const pending = controller.payloadsForContact("alice");
  assert.equal(deliveries.length, 3);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].requestId, 18);
  assert.deepEqual(replies, []);
  assert.deepEqual(errors, []);
});

test("interruption and process cleanup expire requests without synthesizing approvals", async () => {
  const { controller, deliveries, replies, errors } = fixture();
  controller.receive(inputRequest(18, { isBlocking: false }));
  const interruptedId = deliveries[0].id;
  controller.handleNotification({ method: "turn/completed", params: { threadId: "thread-alice", turn: { id: "turn-1", status: "interrupted" } } });
  assert.deepEqual(controller.payloadsForContact("alice"), []);
  assert.equal((await controller.respond({ requestId: interruptedId, response: { answers: { route: { answers: ["Keep"] } } } }, "alice")).ok, false);
  controller.receive(commandRequest(21));
  controller.receive(inputRequest(22, { isBlocking: false }));
  controller.clear("Codex app-server exited");
  assert.deepEqual(controller.payloadsForContact("alice"), []);
  assert.deepEqual(replies, []);
  assert.deepEqual(errors, []);
});

test("turn and thread cleanup leave other conversations intact", () => {
  const { controller, replies, errors } = fixture();
  controller.receive(commandRequest(17));
  controller.receive(commandRequest(18, { threadId: "thread-alice", turnId: "turn-2" }));
  controller.receive(commandRequest(19, { threadId: "thread-bob" }));
  controller.clearForTurn("thread-alice", "turn-1", "turn interrupted");
  assert.deepEqual(controller.payloadsForContact("alice").map(({ requestId }) => requestId), [18]);
  controller.clearForThread("different-thread", "thread closed");
  assert.equal(controller.payloadsForContact("alice").length, 1);
  controller.clearForThread("thread-alice", "thread closed");
  assert.deepEqual(controller.payloadsForContact("alice"), []);
  assert.deepEqual(controller.payloadsForContact("bob").map(({ requestId }) => requestId), [19]);
  assert.deepEqual(replies, []);
  assert.deepEqual(errors, []);
});

test("secret answers reach Codex without appearing in resolution notifications", async () => {
  const { controller, deliveries, replies, resolutions } = fixture();
  controller.receive(inputRequest(18, {
    questions: [{ id: "token", header: "Token", question: "Enter the token", isSecret: true, options: null }]
  }));
  const secret = "private-test-token-do-not-store";
  await controller.respond({ requestId: deliveries[0].id, response: { answers: { token: { answers: [secret] } } } }, "alice");
  assert.equal(replies[0].result.answers.token.answers[0], secret);
  assert.equal(resolutions.length, 1);
  assert.ok(!JSON.stringify(resolutions).includes(secret));
});

test("requests without a matching conversation return a wire error", () => {
  const { controller, deliveries, replies, errors } = fixture();
  controller.receive(commandRequest(17, { threadId: "unknown-thread" }));
  assert.deepEqual(deliveries, []);
  assert.deepEqual(replies, []);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].id, 17);
  assert.equal(typeof errors[0].message, "string");
});

test("permission subsets retain every deny restriction", () => {
  const restriction = { access: "deny", path: { type: "path", path: "/project/private" } };
  const grant = { access: "read", path: { type: "special", value: { kind: "project_roots" } } };
  const profile = { fileSystem: { entries: [grant, restriction] } };
  const choices = permissionChoices(profile);
  const grantId = choices.find((choice) => choice.value.access === "read").id;
  const subset = permissionsFromChoices(profile, [grantId]);
  assert.deepEqual(subset, profile);
  const payload = normalizeServerRequest(permissionsRequest(19, profile), context);
  assert.throws(() => serverRequestResponse(payload, { permissions: { fileSystem: { entries: [grant] } } }));
  assert.deepEqual(serverRequestResponse(payload, { selectedPermissions: [grantId] }), { permissions: profile, scope: "turn" });
  assert.deepEqual(serverRequestResponse(payload, { permissions: {} }), { permissions: {}, scope: "turn" });
});

test("secret MCP defaults are removed before a form reaches the conversation", () => {
  const payload = normalizeServerRequest(elicitationRequest(20, {
    requestedSchema: {
      type: "object",
      properties: {
        api_key: { type: "string", default: "private-default-token" },
        password: { type: "string", writeOnly: true, default: "private-default-password" },
        greeting: { type: "string", default: "Hello" }
      }
    }
  }), context);
  assert.ok(!JSON.stringify(payload).includes("private-default"));
  assert.equal(payload.requestedSchema.properties.greeting.default, "Hello");
});

test("MCP URL responses carry an explicit action and no arbitrary answer content", () => {
  const payload = normalizeServerRequest(elicitationRequest(20, {
    mode: "url", url: "https://example.com/authorize", elicitationId: "elicitation-1"
  }), context);
  assert.equal(payload.mode, "url");
  assert.equal(payload.url, "https://example.com/authorize");
  assert.deepEqual(serverRequestResponse(payload, { action: "accept", content: { token: "secret" } }), { action: "accept" });
  assert.deepEqual(serverRequestResponse(payload, { action: "cancel" }), { action: "cancel" });
});

test("duplicate requests are delivered once and wrong-thread resolution has no effect", () => {
  const { controller, deliveries, errors, resolutions } = fixture();
  assert.equal(controller.receive(commandRequest()), true);
  assert.equal(controller.receive(commandRequest()), true);
  assert.equal(deliveries.length, 1);
  controller.handleNotification({ method: "serverRequest/resolved", params: { threadId: "other-thread", requestId: 17 } });
  assert.equal(controller.payloadsForContact("alice").length, 1);
  assert.deepEqual(resolutions, []);
  assert.equal(controller.receive({ id: 19, method: "not/aSupportedMethod", params: {} }), false);
  controller.receive(inputRequest(18, { questions: [{ id: "broken" }] }));
  assert.equal(errors.length, 1);
  assert.equal(errors[0].id, 18);
  assert.equal(errors[0].code, -32602);
  assert.equal(controller.payloadsForContact("alice").length, 1);
});

test("a stale local ID cannot answer a reused wire ID after a server restart", async () => {
  const { controller, deliveries, replies } = fixture();
  controller.receive(commandRequest(0));
  const oldId = deliveries[0].id;
  controller.clear("Server restarted");
  controller.receive(commandRequest(0));
  const newId = deliveries[1].id;
  assert.notEqual(oldId, newId);
  assert.equal((await controller.respond({ requestId: oldId, response: "accept" }, "alice")).ok, false);
  assert.deepEqual(replies, []);
  assert.equal((await controller.respond({ requestId: newId, response: "accept" }, "alice")).ok, true);
  assert.deepEqual(replies, [{ id: 0, result: { decision: "accept" } }]);
});

test("concurrent clicks send one wire response", async () => {
  const deliveries = [];
  const replies = [];
  let completeSend;
  const sendCompleted = new Promise((resolve) => { completeSend = resolve; });
  const controller = createServerRequestsController({
    codex: { respond: async (id, result) => { replies.push({ id, result }); await sendCompleted; }, respondError: assert.fail },
    resolveContact: () => "alice", deliver: (payload) => deliveries.push(payload), resolved: () => {}
  });
  controller.receive(commandRequest());
  const message = { requestId: deliveries[0].id, response: "accept" };
  const first = controller.respond(message, "alice");
  assert.equal((await controller.respond(message, "alice")).ok, false);
  assert.equal(replies.length, 1);
  completeSend();
  assert.equal((await first).ok, true);
  assert.deepEqual(controller.payloadsForContact("alice"), []);
});

test("a failed wire send leaves the response available for retry", async () => {
  const deliveries = [];
  const resolutions = [];
  let attempts = 0;
  const controller = createServerRequestsController({
    codex: { respond: async () => { if (++attempts === 1) throw new Error("Transport unavailable"); }, respondError: assert.fail },
    resolveContact: () => "alice", deliver: (payload) => deliveries.push(payload), resolved: (payload) => resolutions.push(payload)
  });
  controller.receive(commandRequest());
  const message = { requestId: deliveries[0].id, response: "decline" };
  const failed = await controller.respond(message, "alice");
  assert.equal(failed.ok, false);
  assert.match(failed.error, /Transport unavailable/);
  assert.equal(controller.payloadsForContact("alice").length, 1);
  assert.deepEqual(resolutions, []);
  assert.equal((await controller.respond(message, "alice")).ok, true);
  assert.equal(attempts, 2);
  assert.equal(resolutions.length, 1);
});

test("failed dialog delivery does not retain an unreachable request", () => {
  const deliveries = [];
  const errors = [];
  let deliveryAttempts = 0;
  const controller = createServerRequestsController({
    codex: { respond: assert.fail, respondError: (id, message, code) => errors.push({ id, message, code }) },
    resolveContact: () => "alice",
    deliver: (payload) => {
      if (++deliveryAttempts === 1) throw new Error("Conversation window unavailable");
      deliveries.push(payload);
    }
  });
  controller.receive(commandRequest());
  assert.deepEqual(controller.payloadsForContact("alice"), []);
  assert.equal(controller.pending.size, 0);
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /Conversation window unavailable/);
  controller.receive(commandRequest());
  assert.equal(deliveries.length, 1);
  assert.equal(controller.pending.size, 1);
});

test("a failed resolution notification cannot report an already-sent answer as unsent", async () => {
  const deliveries = [];
  const replies = [];
  const callbackErrors = [];
  const controller = createServerRequestsController({
    codex: { respond: (id, result) => replies.push({ id, result }), respondError: assert.fail },
    resolveContact: () => "alice", deliver: (payload) => deliveries.push(payload),
    resolved: () => { throw new Error("Conversation notification unavailable"); },
    onError: (error) => callbackErrors.push(error.message)
  });
  controller.receive(commandRequest());
  const message = { requestId: deliveries[0].id, response: "accept" };
  assert.deepEqual(await controller.respond(message, "alice"), { ok: true });
  assert.equal(controller.pending.size, 0);
  assert.deepEqual(callbackErrors, ["Conversation notification unavailable"]);
  assert.equal((await controller.respond(message, "alice")).ok, false);
  assert.equal(replies.length, 1);
});

for (const status of ["completed", "interrupted", "failed"]) {
  test(`a ${status} subagent turn cannot expire its parent's pending question`, async () => {
    const deliveries = [];
    const replies = [];
    const resolutions = [];
    const controller = createServerRequestsController({
      codex: { respond: (id, result) => replies.push({ id, result }), respondError: assert.fail },
      resolveContact: () => "alice", deliver: (payload) => deliveries.push(payload), resolved: (payload) => resolutions.push(payload)
    });
    controller.receive(inputRequest(18, { isBlocking: false }));
    // The same contact can receive a child's approval; identical turn IDs must
    // still be scoped by thread when a child completes or is interrupted.
    controller.receive(commandRequest(19, { threadId: "child-thread", turnId: "turn-1" }));
    controller.handleNotification({ method: "turn/completed", params: { threadId: "child-thread", turn: { id: "turn-1", status } } });
    assert.deepEqual(controller.payloadsForContact("alice").map(({ requestId }) => requestId), [18]);
    assert.equal(resolutions.length, 1);
    assert.equal(resolutions[0].id, deliveries[1].id);
    assert.deepEqual(replies, []);
    assert.deepEqual(await controller.respond({ requestId: deliveries[0].id, response: { answers: { route: { answers: ["Keep"] } } } }, "alice"), { ok: true });
    assert.equal(replies[0].id, 18);
  });
}
