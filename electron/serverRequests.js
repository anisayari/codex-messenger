import { isSupportedServerRequest, normalizeServerRequest, serverRequestResponse, serverRequestWireKey } from "../shared/serverRequestUtils.js";

// A local ID remains unique after server restarts, so a late click cannot answer
// a new request even if the app-server reuses its own wire IDs.
export function createServerRequestsController({ codex, resolveContact, deliver, resolved, findItem = () => null, onError = () => {} }) {
  const pending = new Map();
  const wireIds = new Map();
  let nextId = 1;

  function finish(record, reason, decision = "expired") {
    if (!pending.has(record.payload.id)) return;
    pending.delete(record.payload.id);
    wireIds.delete(serverRequestWireKey(record.payload.requestId));
    // Never include an answer, a permission response, or MCP content here.
    try { resolved?.({ id: record.payload.id, serverRequestId: record.payload.id, contactId: record.payload.contactId, threadId: record.payload.threadId, decision, reason }); }
    catch (error) { onError(error); }
  }

  function receive(message) {
    if (!isSupportedServerRequest(message?.method)) return false;
    let record;
    try {
      const key = serverRequestWireKey(message.id);
      if (wireIds.has(key)) return true;
      const contact = resolveContact(message.params ?? {}, message);
      const contactId = typeof contact === "string" ? contact : contact?.id;
      if (!contactId) throw new Error("La conversation de cette demande Codex est introuvable.");
      const payload = normalizeServerRequest(message, {
        id: `server-request-${nextId++}`, contactId,
        item: findItem(message.params?.threadId ?? message.params?.conversationId, message.params?.itemId ?? message.params?.callId)
      });
      record = { payload, responding: false };
      pending.set(payload.id, record);
      wireIds.set(key, payload.id);
      deliver(payload);
    } catch (error) {
      if (record) {
        pending.delete(record.payload.id);
        wireIds.delete(serverRequestWireKey(record.payload.requestId));
      }
      codex.respondError(message.id, error.message, -32602);
    }
    return true;
  }

  async function respond({ requestId, serverRequestId, id, response } = {}, contactId) {
    const record = pending.get(requestId ?? serverRequestId ?? id);
    if (!record) return { ok: false, error: "Cette demande Codex a expiré." };
    if (contactId && record.payload.contactId !== contactId) return { ok: false, error: "Cette demande appartient à une autre conversation." };
    if (record.responding) return { ok: false, error: "La réponse est déjà en cours d'envoi." };
    try {
      const wireResponse = serverRequestResponse(record.payload, response);
      record.responding = true;
      await codex.respond(record.payload.requestId, wireResponse);
      finish(record, "Réponse envoyée.", "answered");
      return { ok: true };
    } catch (error) {
      record.responding = false;
      return { ok: false, error: error.message };
    }
  }

  function clearWhere(predicate, reason) {
    for (const record of [...pending.values()]) if (predicate(record.payload)) finish(record, reason);
  }

  function clearForThread(threadId, reason = "Conversation fermée.") {
    clearWhere((payload) => payload.threadId === threadId, reason);
  }

  function clearForTurn(threadId, turnId, reason = "Tour interrompu.", { keepNonBlocking = false } = {}) {
    clearWhere((payload) => payload.threadId === threadId && payload.turnId === turnId && !(keepNonBlocking && payload.kind === "user-input" && !payload.isBlocking), reason);
  }

  function handleNotification(message) {
    const p = message?.params ?? {};
    if (message?.method === "serverRequest/resolved") {
      let id;
      try { id = wireIds.get(serverRequestWireKey(p.requestId)); } catch { return false; }
      const record = pending.get(id);
      if (record?.payload.threadId === p.threadId) finish(record, "Demande résolue par Codex.", "resolved");
      return true;
    }
    if (message?.method === "turn/completed") {
      const turn = p.turn;
      if (p.threadId && turn?.id) clearForTurn(p.threadId, turn.id, turn.status === "completed" ? "Tour terminé." : "Tour interrompu.", { keepNonBlocking: turn.status === "completed" });
    } else if (message?.method === "thread/closed" || message?.method === "thread/archived") {
      if (p.threadId) clearForThread(p.threadId, "Conversation fermée.");
    }
    // These notifications also belong to the conversation event handler.
    return false;
  }

  return {
    pending, receive, respond, handleNotification, clearForThread, clearForTurn,
    clear(reason = "Codex s'est arrêté.") { clearWhere(() => true, reason); },
    payloadsForContact(contactId) { return [...pending.values()].filter((record) => record.payload.contactId === contactId).map((record) => record.payload); }
  };
}
