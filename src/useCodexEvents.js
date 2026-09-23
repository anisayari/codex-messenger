import { useEffect, useRef } from "react";
import { createCodexOutputDecoder } from "../shared/codexTimeline.js";

const displayLimit = 256 * 1024;
const trimOutput = (value, limit = displayLimit) => {
  const truncated = String(value ?? "").slice(-limit);
  const first = truncated.charCodeAt(0);
  return first >= 0xdc00 && first <= 0xdfff ? truncated.slice(1) : truncated;
};

function upsertMessageById(messages, message) {
  if (!message?.id) return [...messages, message];
  const index = messages.findIndex((item) => item.id === message.id);
  if (index === -1) return [...messages, message];
  return messages.map((item, itemIndex) => itemIndex === index ? { ...item, ...message } : item);
}

// Output updates arrive between item/started and item/completed. Update the
// matching item, even when another agent or tool has appended a later message.
export function applyCodexItemUpdate(messages, update, { author = "Codex", time = "--:--" } = {}) {
  if (!update || typeof update.id !== "string" || !update.id) return messages;
  const previous = messages.find((message) => message.id === update.id);
  const merged = { from: "system", author, time, text: "", ...previous, ...update };
  delete merged.delta;
  delete merged.deltaField;
  delete merged.summaryPartAdded;
  if (merged.itemType === "reasoning") { delete merged.content; delete merged.encryptedContent; }
  // The interaction is useful status; its stdin can contain a password.
  if (update.terminalInteraction) merged.terminalInteraction = { processId: update.terminalInteraction.processId, hasInput: true };
  if (update.deltaField === "summary" || update.summaryPartAdded) {
    const index = update.summaryIndex;
    if (!Number.isSafeInteger(index) || index < 0 || index >= 128) return messages;
    const summary = Array.isArray(previous?.summary) ? [...previous.summary] : [];
    if (update.summaryPartAdded && summary[index] === undefined) summary[index] = "";
    if (typeof update.delta === "string") summary[index] = trimOutput((summary[index] ?? "") + update.delta, 16 * 1024);
    merged.summary = summary;
    merged.text = summary.filter((entry) => typeof entry === "string").join("\n");
  } else if (["aggregatedOutput", "output", "text"].includes(update.deltaField) && typeof update.delta === "string") {
    const field = update.deltaField;
    const output = String(previous?.[field] ?? "") + update.delta;
    merged[field] = trimOutput(output);
    merged.outputCapped = previous?.outputCapped || output.length > displayLimit;
    if (field === "aggregatedOutput") merged.text = [merged.command, merged.aggregatedOutput].filter(Boolean).join("\n");
    if (field === "output") {
      merged.fileChangeText = previous?.fileChangeText ?? previous?.text ?? "";
      merged.text = [merged.fileChangeText, merged.output].filter(Boolean).join("\n");
    }
  }
  if (Array.isArray(update.changes) && typeof update.text === "string") {
    merged.fileChangeText = update.text;
    merged.text = [update.text, merged.output].filter(Boolean).join("\n");
  }
  if (["mcpToolCall", "dynamicToolCall"].includes(merged.itemType) && typeof update.text === "string" && update.progress === undefined) merged.toolResultText = update.text;
  if (update.progress !== undefined) {
    merged.progress = trimOutput(update.progress, 4096);
    const heading = `${merged.server ? `${merged.server}: ` : ""}${merged.tool || "Outil Codex"}`;
    merged.toolResultText = previous?.toolResultText ?? previous?.text ?? heading;
    merged.text = [merged.toolResultText, merged.progress].filter(Boolean).join("\n");
  }
  if (merged.processOutput) merged.text = [merged.command || "Processus Codex", merged.stdout, merged.stderr].filter(Boolean).join("\n");
  for (const field of ["stdout", "stderr", "aggregatedOutput", "output", "text"]) if (typeof merged[field] === "string") merged[field] = trimOutput(merged[field]);
  return upsertMessageById(messages, merged);
}

export function codexActivityMessage(payload, { author = "Codex", time = "--:--" } = {}) {
  const activity = payload?.activity;
  if (!activity || typeof activity !== "object") return null;
  let text = "";
  let itemType = "activity";
  if (Array.isArray(activity.plan)) {
    itemType = "plan";
    text = [activity.explanation, ...activity.plan.map((entry) => typeof entry?.step === "string" ? `${entry.status ? `[${entry.status}] ` : ""}${entry.step}` : "")].filter(Boolean).join("\n");
  } else if (typeof activity.diff === "string" && activity.diff) { itemType = "turnDiff"; text = activity.diff; }
  else if (activity.tokenUsage) {
    const total = activity.tokenUsage.total?.totalTokens;
    const last = activity.tokenUsage.last?.totalTokens;
    const window = activity.tokenUsage.modelContextWindow;
    if (Number.isFinite(total)) text = `Tokens cumulés: ${total}`;
    else if (Number.isFinite(last)) text = `Tokens récents: ${last}`;
    if (text && Number.isFinite(window)) text += ` · contexte: ${window}`;
    itemType = "tokenUsage";
  } else if (activity.warning) text = activity.warning.message || activity.warning.summary || "Codex a signalé un avertissement.";
  else if (activity.compacted) text = "Le contexte Codex a été compacté.";
  else if (activity.modelReroute) text = `Codex a changé de modèle${activity.modelReroute.toModel ? `: ${activity.modelReroute.toModel}` : ""}.`;
  else if (activity.hook) text = `Hook ${activity.hook.name || activity.hook.eventName || "Codex"}: ${activity.hookPending ? "en cours" : "terminé"}`;
  else if (activity.threadSettings) text = `Les paramètres Codex ont été mis à jour${activity.threadSettings.model ? `: ${activity.threadSettings.model}` : ""}.`;
  else if (activity.authRecovery) text = `Authentification ${activity.authRecovery.modelProvider || "Codex"}: ${activity.authRecoveryPending ? "rétablissement en cours" : "tentative de rétablissement terminée"}.`;
  else if (activity.queueChanged) text = "La file de messages Codex a changé.";
  if (!text) return null;
  return {
    id: `codex-activity:${payload.threadId || payload.contactId || "codex"}:${payload.turnId || ""}:${payload.method || itemType}`,
    from: "system", author, time, itemType, text: trimOutput(text),
    ...(Array.isArray(activity.plan) ? { plan: activity.plan, explanation: activity.explanation ?? null } : {}),
    ...(activity.tokenUsage ? { tokenUsage: activity.tokenUsage } : {}),
    ...(activity.warning ? { noticeKind: "warning" } : {})
  };
}


// Internal envelopes preserve the wire thread identity. Worker items can belong
// to the displayed parent conversation while their lifecycle stays independent.
export function isCodexConversationEvent(payload, { contactId, threadId } = {}) {
  if (!payload || payload.contactId !== contactId) return false;
  if (!threadId || !payload.threadId) return true;
  return payload.threadId === threadId || (payload.isWorker === true && (payload.parentThreadId === threadId || (Array.isArray(payload.ancestorThreadIds) && payload.ancestorThreadIds.includes(threadId))));
}

export function isCodexActiveTurnEvent(payload, { threadId } = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  return payload.isWorker !== true || Boolean(threadId && payload.threadId === threadId);
}

export function applyCodexAgentMessageMetadata(messages, payload) {
  const index = payload?.itemId ? messages.findIndex((message) => message.id === payload.itemId) : messages.findLastIndex((message) => message.from === "them");
  if (index < 0) return messages;
  const metadata = {};
  for (const key of ["threadId", "turnId", "parentThreadId", "ancestorThreadIds", "isWorker", "phase", "delivery", "questions", "memoryCitation"]) if (payload[key] !== undefined) metadata[key] = payload[key];
  if (!Object.keys(metadata).length) return messages;
  return messages.map((message, i) => i === index ? { ...message, ...metadata } : message);
}

// A failed/interrupted turn may have no authoritative item/completed. Keep all
// received answer/plan source and stop its local stream without claiming tool
// success. Known identities keep late worker completions off the parent stream.
export function finalizeCodexTurnMessages(messages, payload = {}) {
  if (payload.isWorker === true && !payload.threadId) return messages;
  return messages.map((message) => {
    if (payload.threadId && message.threadId && message.threadId !== payload.threadId) return message;
    if (payload.isWorker === true && message.threadId !== payload.threadId) return message;
    if (payload.turnId && message.turnId && message.turnId !== payload.turnId) return message;
    const stopStream = message.streaming === true;
    const stopPlan = message.itemType === "plan" && message.pending === true;
    if (!stopStream && !stopPlan) return message;
    return { ...message, ...(stopStream ? { streaming: false } : {}), ...(stopPlan ? { pending: false } : {}), ...(["completed", "interrupted", "failed"].includes(payload.status) ? { turnStatus: payload.status } : {}) };
  });
}

export function createBoundedCodexOutputDecoder({ maxStreams = 64, maxChars = displayLimit } = {}) {
  const decoder = createCodexOutputDecoder();
  const streams = new Map();
  const maximum = Math.max(1, Math.min(256, Number(maxStreams) || 64));
  const limit = Math.max(1, Math.min(displayLimit, Number(maxChars) || displayLimit));
  const key = (update) => JSON.stringify([update.processId ?? update.processHandle, update.stream]);
  let lastChunkCapped = false;
  return {
    displayLimit: limit,
    decode(update) {
      lastChunkCapped = false;
      if (!update || !["stdout", "stderr"].includes(update.stream)) return "";
      const encoded = typeof update.deltaBase64 === "string" ? update.deltaBase64.replace(/\s+/g, "") : "";
      if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) return "";
      const id = key(update);
      if (!streams.has(id) && streams.size >= maximum) {
        const [oldKey, oldUpdate] = streams.entries().next().value;
        decoder.flush(oldUpdate);
        streams.delete(oldKey);
      }
      streams.set(id, { processId: update.processId, processHandle: update.processHandle, stream: update.stream });
      const decoded = decoder.decode(update);
      lastChunkCapped = decoded.length > limit;
      return trimOutput(decoded, limit);
    },
    flush(update) { if (!update) return ""; streams.delete(key(update)); return trimOutput(decoder.flush(update), limit); },
    clear() { streams.clear(); decoder.clear(); },
    lastChunkCapped() { return lastChunkCapped; },
    activeStreams() { return streams.size; }
  };
}

// Connection lifecycle is authoritative even when its reason is a custom label
// such as "CLI updated" that is not recognized by the localized notice parser.
export function handleStoppedCodexStatus(status, {
  contactId, blockingRequests, outputDecoder, flushAgentDeltas,
  deltaFlushTimerRef, deltaQueueRef, deltaFirstQueuedAtRef, playedStreamingSoundRef,
  setTyping, setTurnActive, setMessages, setApprovalRequests, setServerRequests
}) {
  if (!["exit", "error", "stopped"].includes(status?.kind)) return false;
  blockingRequests?.current?.clear();
  outputDecoder?.clear();
  flushAgentDeltas?.();
  if (deltaFlushTimerRef?.current) globalThis.clearTimeout(deltaFlushTimerRef.current);
  if (deltaFlushTimerRef) deltaFlushTimerRef.current = null;
  if (deltaQueueRef) deltaQueueRef.current = [];
  if (deltaFirstQueuedAtRef) deltaFirstQueuedAtRef.current = 0;
  if (playedStreamingSoundRef) playedStreamingSoundRef.current = false;
  setTyping(false);
  setTurnActive(false);
  setMessages?.((current) => current.map((message) => message.streaming ? { ...message, streaming: false } : message));
  setApprovalRequests?.((current) => current.filter((request) => request.contactId !== contactId));
  setServerRequests?.((current) => current.filter((request) => request.contactId !== contactId));
  return true;
}

export function useCodexEvents({
  api,
  contact,
  threadId,
  conversationAgentName,
  deltaFlushTimerRef,
  deltaQueueRef,
  deltaFirstQueuedAtRef,
  playedStreamingSoundRef,
  queueAgentDelta,
  flushAgentDeltas,
  codexConnectionNotice,
  appendSystemNotice,
  finishAgentMessage,
  extractWinkFromText,
  isCodexHistoryContact,
  playWink,
  playWizz,
  triggerWinkAnimation,
  playNewMessageIfEnabled,
  setMessages,
  setTyping,
  setTurnActive,
  setThreadsLoading,
  setThreadsLoadError,
  setConversations,
  setCodexModels,
  setApprovalRequests,
  setServerRequests,
  serverRequests,
  setCodexActivity
}) {
  const blockingRequests = useRef(new Set());
  const blockingContact = useRef(contact.id);
  const conversationThread = useRef(threadId || contact.threadId);
  conversationThread.current = threadId || contact.threadId;
  useEffect(() => {
    if (!Array.isArray(serverRequests)) return;
    blockingRequests.current = new Set(serverRequests.filter((request) => request.contactId === contact.id && request.isBlocking !== false).map((request) => request.id ?? request.serverRequestId));
  }, [serverRequests, contact.id]);
  useEffect(() => {
    if (blockingContact.current !== contact.id) {
      if (!Array.isArray(serverRequests)) blockingRequests.current.clear();
      blockingContact.current = contact.id;
    }
    const matchesConversation = (payload) => isCodexConversationEvent(payload, { contactId: contact.id, threadId: conversationThread.current });
    const isActiveTurn = (payload) => isCodexActiveTurnEvent(payload, { threadId: conversationThread.current });
    const outputDecoder = createBoundedCodexOutputDecoder();
    const activeAfterDone = () => blockingRequests.current.size > 0;
    const displayContext = () => ({ author: conversationAgentName, time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) });
    function processUpdate(update) {
      const handle = update?.processId ?? update?.processHandle;
      if (handle === undefined || handle === null) return;
      const id = `codex-process:${String(handle)}`;
      if (update.exited) {
        const stdout = outputDecoder.flush({ ...update, stream: "stdout" });
        const stderr = outputDecoder.flush({ ...update, stream: "stderr" });
        setMessages((current) => {
          const previous = current.find((message) => message.id === id);
          return applyCodexItemUpdate(current, { id, itemType: "commandExecution", processOutput: true, processId: handle, exitCode: update.exitCode, pending: false, status: update.exitCode === 0 ? "completed" : "failed", stdout: trimOutput(update.stdout ?? (previous?.stdout ?? "") + stdout), stderr: trimOutput(update.stderr ?? (previous?.stderr ?? "") + stderr), outputCapped: Boolean(previous?.outputCapped || update.stdoutCapReached || update.stderrCapReached) }, displayContext());
        });
      } else {
        const decoded = outputDecoder.decode(update);
        const chunkCapped = outputDecoder.lastChunkCapped();
        setMessages((current) => {
          const previous = current.find((message) => message.id === id);
          const stream = update.stream;
          if (!["stdout", "stderr"].includes(stream)) return current;
          const combined = String(previous?.[stream] ?? "") + decoded;
          return applyCodexItemUpdate(current, { id, itemType: "commandExecution", processOutput: true, processId: handle, pending: true, status: "inProgress", [stream]: trimOutput(combined), outputCapped: Boolean(previous?.outputCapped || update.capReached || chunkCapped || combined.length > displayLimit) }, displayContext());
        });
      }
    }
    function applyActivity(payload) {
      if (!matchesConversation(payload)) return;
      if (payload.itemUpdate) setMessages((current) => applyCodexItemUpdate(current, { ...payload.itemUpdate, ...Object.fromEntries(["threadId", "turnId", "parentThreadId", "ancestorThreadIds", "isWorker"].filter((key) => payload[key] !== undefined).map((key) => [key, payload[key]])) }, displayContext()));
      if (payload.processUpdate) processUpdate(payload.processUpdate);
      if (payload.activity) {
        setCodexActivity?.((current) => ({ ...current, ...payload.activity, threadId: payload.threadId, turnId: payload.turnId }));
        const message = codexActivityMessage(payload, displayContext());
        if (message) setMessages((current) => upsertMessageById(current, message));
        if (payload.activity.turnStatus === "inProgress" && isActiveTurn(payload)) setTurnActive(true);
        if (["completed", "interrupted", "failed"].includes(payload.activity.turnStatus)) {
          flushAgentDeltas();
          setMessages((current) => finalizeCodexTurnMessages(current, { ...payload, turnId: payload.turnId ?? payload.activity.turnId, status: payload.activity.turnStatus }));
          if (isActiveTurn(payload)) { setTyping(false); setTurnActive(activeAfterDone()); }
        }
      }
    }
    const offActivity = api.on("codex:activity", applyActivity);
    const offItemUpdate = api.on("codex:item-update", applyActivity);
    const offDelta = api.on("codex:delta", (payload) => {
      if (!matchesConversation(payload)) return;
      const { delta, itemId } = payload;
      queueAgentDelta(delta, itemId, Object.fromEntries(["threadId", "turnId", "parentThreadId", "ancestorThreadIds", "isWorker"].filter((key) => payload[key] !== undefined).map((key) => [key, payload[key]])));
    });
    const offCompleted = api.on("codex:completed-item", (payload) => {
      if (!matchesConversation(payload) || typeof payload.text !== "string") return;
      const { text, itemId } = payload;
      flushAgentDeltas();
      const notice = codexConnectionNotice(text);
      if (notice) {
        if (isActiveTurn(payload)) { setTyping(false); setTurnActive(activeAfterDone()); }
        setMessages((current) => appendSystemNotice(current, notice));
        return;
      }
      const incomingWink = extractWinkFromText(text).wink;
      if (incomingWink) {
        playWink(incomingWink);
        triggerWinkAnimation(incomingWink, "incoming");
      }
      setMessages((current) => {
        const streaming = itemId ? current.find((message) => message.id === itemId)?.streaming : current[current.length - 1]?.streaming;
        if (!streaming && !incomingWink) playNewMessageIfEnabled();
        playedStreamingSoundRef.current = false;
        return applyCodexAgentMessageMetadata(finishAgentMessage(current, conversationAgentName, text, itemId), payload);
      });
    });
    const offItemStarted = api.on("codex:item-started", (payload) => {
      if (!matchesConversation(payload) || !payload.message) return;
      const { message } = payload;
      flushAgentDeltas();
      if (isActiveTurn(payload)) { setTyping(!activeAfterDone()); setTurnActive(true); }
      setMessages((current) => upsertMessageById(current, { ...message, ...Object.fromEntries(["threadId", "turnId", "parentThreadId", "ancestorThreadIds", "isWorker"].filter((key) => payload[key] !== undefined).map((key) => [key, payload[key]])) }));
    });
    const offItemCompleted = api.on("codex:item-completed", (payload) => {
      if (!matchesConversation(payload) || !payload.message) return;
      const { message } = payload;
      flushAgentDeltas();
      setMessages((current) => {
        const alreadyVisible = Boolean(message.id && current.some((item) => item.id === message.id));
        if (!alreadyVisible && message.from === "them") playNewMessageIfEnabled();
        return applyCodexItemUpdate(current, { ...message, ...Object.fromEntries(["threadId", "turnId", "parentThreadId", "ancestorThreadIds", "isWorker"].filter((key) => payload[key] !== undefined).map((key) => [key, payload[key]])) }, displayContext());
      });
    });
    const offTyping = api.on("codex:typing", (payload) => {
      if (matchesConversation(payload) && isActiveTurn(payload)) {
        setTyping(!activeAfterDone());
        setTurnActive(true);
      }
    });
    const offDone = api.on("codex:done", (payload) => {
      if (matchesConversation(payload)) {
        flushAgentDeltas();
        setMessages((current) => finalizeCodexTurnMessages(current, payload));
        if (!isActiveTurn(payload)) return;
        playedStreamingSoundRef.current = false;
        setTyping(false);
        setTurnActive(activeAfterDone());
      }
    });
    const offError = api.on("codex:error", (payload) => {
      if (!matchesConversation(payload)) return;
      const { text } = payload;
      flushAgentDeltas();
      setMessages((current) => finalizeCodexTurnMessages(current, { ...payload, status: "failed" }));
      if (!isActiveTurn(payload)) {
        setMessages((current) => appendSystemNotice(current, { kind: "warning", text }));
        return;
      }
      playedStreamingSoundRef.current = false;
      setTyping(false);
      setTurnActive(activeAfterDone());
      setMessages((current) => appendSystemNotice(current, codexConnectionNotice(text) || { kind: "offline", text }));
    });
    const offStatus = api.on("codex:status", (status) => {
      const stopped = handleStoppedCodexStatus(status, {
        contactId: contact.id, blockingRequests, outputDecoder, flushAgentDeltas,
        deltaFlushTimerRef, deltaQueueRef, deltaFirstQueuedAtRef, playedStreamingSoundRef,
        setTyping, setTurnActive, setMessages, setApprovalRequests, setServerRequests
      });
      if (stopped) {
        const notice = codexConnectionNotice(status?.text);
        if (notice) setMessages((current) => appendSystemNotice(current, notice));
        return;
      }
      if (status?.kind === "ready") {
        outputDecoder.clear();
        flushAgentDeltas();
        setTyping(false);
        setTurnActive(activeAfterDone());
        const showThreadLoader = isCodexHistoryContact(contact);
        if (showThreadLoader) {
          setThreadsLoading(true);
          setThreadsLoadError("");
        }
        api.listConversations()
          .then(setConversations)
          .catch((error) => {
            if (showThreadLoader) setThreadsLoadError(error.message || "Fils indisponibles");
          })
          .finally(() => {
            if (showThreadLoader) setThreadsLoading(false);
          });
        api.listCodexModels()
          .then((result) => {
            if (!result?.ok) throw new Error(result?.error || "Codex models unavailable");
            setCodexModels(Array.isArray(result?.models) ? result.models : []);
          })
          .catch(() => setCodexModels([]));
        return;
      }
      const notice = codexConnectionNotice(status?.text);
      if (!notice) return;
      outputDecoder.clear();
      flushAgentDeltas();
      setTyping(false);
      setTurnActive(activeAfterDone());
      setMessages((current) => appendSystemNotice(current, notice));
    });
    const offStatusNote = api.on("codex:status-note", ({ contactId, text, kind }) => {
      if (contactId !== contact.id || !text) return;
      setMessages((current) => appendSystemNotice(current, {
        kind: kind || "warning",
        text
      }));
    });
    const offApprovalRequest = api.on("codex:approval-request", (request) => {
      if (!request?.approvalId || request.contactId !== contact.id) return;
      blockingRequests.current.add(request.approvalId);
      setApprovalRequests?.((current) => [
        ...current.filter((item) => item.approvalId !== request.approvalId),
        request
      ]);
      if (request.contactId === contact.id) {
        setTyping(false);
        setTurnActive(true);
      }
    });
    const offApprovalResolved = api.on("codex:approval-resolved", ({ approvalId, decision }) => {
      blockingRequests.current.delete(approvalId);
      setApprovalRequests?.((current) => current.filter((item) => item.approvalId !== approvalId));
      if (decision === "expired" && !activeAfterDone()) { setTyping(false); setTurnActive(false); }
    });
    const offServerRequest = api.on("codex:server-request", (request) => {
      const id = request?.id ?? request?.serverRequestId;
      if (!id || request.contactId !== contact.id) return;
      setServerRequests?.((current) => [...current.filter((item) => (item.id ?? item.serverRequestId) !== id), request]);
      if (request.isBlocking !== false) { blockingRequests.current.add(id); setTyping(false); setTurnActive(true); }
    });
    const offServerResolved = api.on("codex:server-request-resolved", ({ id, serverRequestId, contactId, decision }) => {
      if (contactId !== contact.id) return;
      const key = id ?? serverRequestId;
      const wasBlocking = blockingRequests.current.delete(key);
      setServerRequests?.((current) => current.filter((item) => (item.id ?? item.serverRequestId) !== key));
      if (wasBlocking && decision === "answered") setTyping(!activeAfterDone());
      if (decision === "expired" && !activeAfterDone()) { setTyping(false); setTurnActive(false); }
    });
    const offWizz = api.on("window:wizz", () => {
      playWizz();
    });
    return () => {
      if (deltaFlushTimerRef.current) window.clearTimeout(deltaFlushTimerRef.current);
      deltaFlushTimerRef.current = null;
      deltaQueueRef.current = [];
      deltaFirstQueuedAtRef.current = 0;
      outputDecoder.clear();
      [offDelta, offCompleted, offItemStarted, offItemCompleted, offTyping, offDone, offError, offStatus, offStatusNote, offApprovalRequest, offApprovalResolved, offServerRequest, offServerResolved, offActivity, offItemUpdate, offWizz].forEach((off) => off?.());
    };
  }, [api, contact.id, contact.kind, contact.cwd, conversationAgentName]);
}
