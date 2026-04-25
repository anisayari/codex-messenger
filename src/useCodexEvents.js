import { useEffect } from "react";

function upsertMessageById(messages, message) {
  if (!message?.id) return [...messages, message];
  const index = messages.findIndex((item) => item.id === message.id);
  if (index === -1) return [...messages, message];
  return messages.map((item, itemIndex) => itemIndex === index ? { ...item, ...message } : item);
}

export function useCodexEvents({
  api,
  contact,
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
  setApprovalRequests
}) {
  useEffect(() => {
    const offDelta = api.on("codex:delta", ({ contactId, delta }) => {
      if (contactId !== contact.id) return;
      queueAgentDelta(delta);
    });
    const offCompleted = api.on("codex:completed-item", ({ contactId, text }) => {
      if (contactId !== contact.id || !text) return;
      flushAgentDeltas();
      const notice = codexConnectionNotice(text);
      if (notice) {
        setTyping(false);
        setTurnActive(false);
        setMessages((current) => appendSystemNotice(current, notice));
        return;
      }
      const incomingWink = extractWinkFromText(text).wink;
      if (incomingWink) {
        playWink(incomingWink);
        triggerWinkAnimation(incomingWink, "incoming");
      }
      setMessages((current) => {
        if (!current[current.length - 1]?.streaming && !incomingWink) playNewMessageIfEnabled();
        playedStreamingSoundRef.current = false;
        return finishAgentMessage(current, conversationAgentName, text);
      });
    });
    const offItemStarted = api.on("codex:item-started", ({ contactId, message }) => {
      if (contactId !== contact.id || !message) return;
      flushAgentDeltas();
      setTyping(true);
      setTurnActive(true);
      setMessages((current) => upsertMessageById(current, message));
    });
    const offItemCompleted = api.on("codex:item-completed", ({ contactId, message }) => {
      if (contactId !== contact.id || !message) return;
      flushAgentDeltas();
      setTurnActive(true);
      setMessages((current) => {
        const alreadyVisible = Boolean(message.id && current.some((item) => item.id === message.id));
        if (!alreadyVisible && message.from === "them") playNewMessageIfEnabled();
        return upsertMessageById(current, message);
      });
    });
    const offTyping = api.on("codex:typing", ({ contactId }) => {
      if (contactId === contact.id) {
        setTyping(true);
        setTurnActive(true);
      }
    });
    const offDone = api.on("codex:done", ({ contactId }) => {
      if (contactId === contact.id) {
        flushAgentDeltas();
        playedStreamingSoundRef.current = false;
        setTyping(false);
        setTurnActive(false);
      }
    });
    const offError = api.on("codex:error", ({ contactId, text }) => {
      if (contactId !== contact.id) return;
      flushAgentDeltas();
      playedStreamingSoundRef.current = false;
      setTyping(false);
      setTurnActive(false);
      setMessages((current) => appendSystemNotice(current, codexConnectionNotice(text) || { kind: "offline", text }));
    });
    const offStatus = api.on("codex:status", (status) => {
      if (status?.kind === "ready") {
        flushAgentDeltas();
        setTyping(false);
        setTurnActive(false);
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
      flushAgentDeltas();
      setTyping(false);
      setTurnActive(false);
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
      if (!request?.approvalId) return;
      setApprovalRequests((current) => [
        ...current.filter((item) => item.approvalId !== request.approvalId),
        request
      ]);
      if (request.contactId === contact.id) {
        setTyping(false);
        setTurnActive(false);
      }
    });
    const offApprovalResolved = api.on("codex:approval-resolved", ({ approvalId }) => {
      setApprovalRequests((current) => current.filter((item) => item.approvalId !== approvalId));
    });
    const offWizz = api.on("window:wizz", () => {
      playWizz();
    });
    return () => {
      if (deltaFlushTimerRef.current) window.clearTimeout(deltaFlushTimerRef.current);
      deltaFlushTimerRef.current = null;
      deltaQueueRef.current = [];
      deltaFirstQueuedAtRef.current = 0;
      offDelta(); offCompleted(); offItemStarted(); offItemCompleted(); offTyping(); offDone(); offError(); offStatus(); offStatusNote(); offApprovalRequest(); offApprovalResolved(); offWizz();
    };
  }, [api, contact.id, contact.kind, contact.cwd, conversationAgentName]);
}
