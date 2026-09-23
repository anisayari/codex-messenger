// Display adapters for the official 0.156.0 app-server ThreadItem and
// ServerNotification schemas (including the experimental API). No raw reasoning
// content or encrypted tool output is turned into a displayed message.
const strings = (values) => (Array.isArray(values) ? values : []).filter((value) => typeof value === "string");
const text = (value) => typeof value === "string" ? value : "";
const lines = (...values) => values.filter((value) => typeof value === "string" && value.length).join("\n");
const canonicalTypes = new Map(["userMessage", "hookPrompt", "agentMessage", "functionCallOutput", "plan", "reasoning", "commandExecution", "fileChange", "mcpToolCall", "dynamicToolCall", "collabAgentToolCall", "subAgentActivity", "webSearch", "imageView", "sleep", "imageGeneration", "enteredReviewMode", "exitedReviewMode", "contextCompaction"].map((type) => [type.toLowerCase(), type]));
const aliases = {
  user_message: "userMessage", user: "userMessage", agent_message: "agentMessage",
  assistant: "agentMessage", assistant_message: "agentMessage"
};

function mediaContent(parts) {
  const attachments = [];
  const output = [];
  for (const part of Array.isArray(parts) ? parts : []) {
    if (!part || typeof part !== "object") continue;
    const type = text(part.type);
    if (["text", "inputText", "input_text"].includes(type)) output.push(text(part.text));
    else if (["image", "localImage", "inputImage", "input_image"].includes(type)) {
      const src = text(part.imageUrl || part.image_url || part.url) ||
        (/^image\/[a-z0-9.+-]+$/i.test(text(part.mimeType)) && typeof part.data === "string" ? `data:${part.mimeType};base64,${part.data}` : "");
      const path = text(part.path);
      const fileId = text(part.fileId || part.file_id);
      attachments.push({ type: "image", ...(src ? { src } : {}), ...(path ? { path } : {}), ...(fileId ? { fileId } : {}), ...(part.detail ? { detail: part.detail } : {}) });
      if (path) output.push(`Image: ${path}`);
      else if (fileId) output.push(`Image Codex: ${fileId}`);
    } else if (["audio", "localAudio", "inputAudio", "input_audio"].includes(type)) {
      const src = text(part.audioUrl || part.audio_url || part.url) ||
        (/^audio\/[a-z0-9.+-]+$/i.test(text(part.mimeType)) && typeof part.data === "string" ? `data:${part.mimeType};base64,${part.data}` : "");
      const path = text(part.path);
      attachments.push({ type: "audio", ...(src ? { src } : {}), ...(path ? { path } : {}) });
      if (path) output.push(`Audio: ${path}`);
    } else if (["skill", "mention"].includes(type)) output.push(`${part.name || type}: ${part.path || ""}`);
    else if (type === "encrypted_content") output.push("Sortie chiffree");
    else if (type === "resource_link") output.push(lines(text(part.name), text(part.uri)));
    else if (type === "resource" && part.resource) output.push(lines(text(part.resource.uri), text(part.resource.text)));
    else if (typeof part.text === "string") output.push(part.text);
  }
  return { text: lines(...output), attachments };
}

function toolResult(item) {
  const result = item.result;
  const content = mediaContent(item.contentItems || (typeof item.output !== "string" && item.output) || result?.content);
  const parts = [typeof item.output === "string" ? item.output : "", content.text, text(item.error?.message)];
  if (!content.text && result?.structuredContent !== undefined && result?.structuredContent !== null) {
    try { parts.push(JSON.stringify(result.structuredContent, null, 2)); } catch { /* Not a JSON wire value. */ }
  }
  return { text: lines(...parts), attachments: content.attachments };
}

function filesText(changes) {
  return (Array.isArray(changes) ? changes : []).map((change) => lines(text(change.path), text(change.diff))).filter(Boolean).join("\n\n");
}

function normalizedType(item) {
  const original = text(item.type);
  return aliases[original.toLowerCase()] || canonicalTypes.get(original.toLowerCase()) || original;
}

/** A complete display message for every real ThreadItem, including future types. */
export function renderCodexItem(item, { author = "Codex", time = "--:--", userAuthor = author } = {}) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const type = normalizedType(item);
  if (!type) return null;
  const message = {
    id: text(item.id) || `codex-${type}`, itemType: type,
    from: "system", author, text: "", time
  };
  for (const key of ["status", "durationMs"]) if (item[key] !== undefined) message[key] = item[key];
  switch (type) {
    case "userMessage": {
      const content = mediaContent(item.content);
      Object.assign(message, content, { from: "me", author: userAuthor, text: content.text || text(item.text) || "Piece jointe" });
      if (item.clientId !== undefined) message.clientId = item.clientId;
      break;
    }
    case "agentMessage":
      message.from = "them";
      message.text = text(item.text) || mediaContent(item.content).text;
      for (const key of ["phase", "delivery", "questions", "memoryCitation"]) if (item[key] !== undefined) message[key] = item[key];
      break;
    case "commandExecution":
      Object.assign(message, {
        author: "command", command: text(item.command), cwd: item.cwd,
        aggregatedOutput: text(item.aggregatedOutput),
        text: lines(text(item.command) || "Commande Codex", text(item.aggregatedOutput))
      });
      for (const key of ["exitCode", "processId", "source", "commandActions", "pluginId", "scriptPath"]) if (item[key] !== undefined) message[key] = item[key];
      break;
    case "fileChange":
      Object.assign(message, { author: "files", changes: Array.isArray(item.changes) ? item.changes : [], text: filesText(item.changes) || "Modification de fichiers" });
      break;
    case "mcpToolCall":
    case "dynamicToolCall":
    case "functionCallOutput": {
      const output = toolResult(item);
      const name = text(item.tool || item.name) || "outil";
      const namespace = text(item.server || item.namespace);
      Object.assign(message, output, {
        author: "tool", tool: name,
        text: lines(`${namespace ? `${namespace}: ` : ""}${name}${item.status ? ` (${item.status})` : ""}`, output.text)
      });
      for (const key of ["server", "namespace", "success", "appContext", "mcpAppUi", "mcpAppResourceUri", "readOnlyHint", "pluginId"]) if (item[key] !== undefined) message[key] = item[key];
      break;
    }
    case "collabAgentToolCall": {
      const states = item.agentsStates && typeof item.agentsStates === "object" ? item.agentsStates : {};
      const stateText = Object.entries(states).map(([id, state]) => lines(`${id}: ${text(state?.status)}`, text(state?.message))).join("\n");
      Object.assign(message, {
        author: "agents", tool: item.tool, agentsStates: states,
        senderThreadId: item.senderThreadId, receiverThreadIds: item.receiverThreadIds,
        text: lines(`Agents: ${text(item.tool)}${item.status ? ` (${item.status})` : ""}`, text(item.prompt), stateText)
      });
      for (const key of ["model", "reasoningEffort"]) if (item[key] !== undefined) message[key] = item[key];
      break;
    }
    case "subAgentActivity":
      Object.assign(message, { author: "agents", agentPath: item.agentPath, agentThreadId: item.agentThreadId, kind: item.kind, text: `Agent ${text(item.agentPath) || text(item.agentThreadId)}: ${text(item.kind)}` });
      break;
    case "plan":
      message.author = "plan";
      message.text = text(item.text);
      break;
    case "reasoning":
      message.author = "reasoning";
      message.summary = strings(item.summary);
      message.text = lines(...message.summary) || "Activite de raisonnement";
      break;
    case "hookPrompt":
      message.author = "hook";
      message.text = lines(...(Array.isArray(item.fragments) ? item.fragments : []).map((fragment) => text(fragment?.text))) || "Contexte de hook";
      break;
    case "webSearch": {
      const action = item.action;
      const queries = strings(action?.queries);
      message.author = "web";
      message.text = lines(action?.type === "openPage" ? "Page web" : action?.type === "findInPage" ? "Recherche dans une page" : "Recherche web", text(item.query), ...queries, text(action?.url), text(action?.pattern));
      for (const key of ["query", "action", "results"]) if (item[key] !== undefined) message[key] = item[key];
      break;
    }
    case "imageView":
      message.text = `Image consultee: ${text(item.path)}`;
      message.path = item.path;
      break;
    case "imageGeneration":
      message.text = lines(`Generation d'image${item.status ? ` (${item.status})` : ""}`, text(item.revisedPrompt), text(item.savedPath), item.failure?.type === "usageLimitExceeded" ? `Limite atteinte: ${text(item.failure.limitId)}` : "");
      for (const key of ["savedPath", "revisedPrompt", "failure", "transparentBackground"]) if (item[key] !== undefined) message[key] = item[key];
      // Existing codexImages.js owns decoding and displaying the actual image.
      break;
    case "sleep":
      message.durationMs = item.durationMs;
      message.text = `Attente: ${item.durationMs} ms`;
      break;
    case "enteredReviewMode":
    case "exitedReviewMode":
      message.text = lines(type === "enteredReviewMode" ? "Debut de review" : "Fin de review", text(item.review));
      break;
    case "contextCompaction":
      message.text = "Contexte compacte";
      break;
    default:
      // Preserve an unfamiliar item's identity and public display text. Dumping
      // its entire object could expose encrypted content or megabytes of media.
      message.text = lines(`Element Codex: ${type}${item.status ? ` (${item.status})` : ""}`, text(item.text), text(item.message), text(item.command), text(item.path), text(item.error?.message));
  }
  return message;
}

/**
 * Map notifications into a partial activity snapshot or an item update.
 * `deltaField` updates append; plan/diff/patch snapshots replace. Base64 command
 * and process streams remain labelled bytes for a stateful UTF-8 decoder.
 */
export function mapCodexActivityNotification(message) {
  if (!message || typeof message.method !== "string") return null;
  const p = message.params;
  if (!p || typeof p !== "object" || Array.isArray(p)) return null;
  const base = { method: message.method, ...(p.threadId ? { threadId: p.threadId } : {}), ...(p.turnId ? { turnId: p.turnId } : {}) };
  const activity = (value) => ({ ...base, activity: value });
  const update = (value) => ({ ...base, itemId: p.itemId, itemUpdate: { id: p.itemId, ...value } });
  switch (message.method) {
    case "turn/plan/updated": return activity({ plan: Array.isArray(p.plan) ? p.plan : [], explanation: p.explanation ?? null });
    case "turn/diff/updated": return activity({ diff: text(p.diff) });
    case "thread/tokenUsage/updated": return activity({ tokenUsage: p.tokenUsage });
    case "thread/status/changed": return activity({ threadStatus: p.status });
    case "thread/settings/updated": return activity({ threadSettings: p.threadSettings });
    case "thread/queue/changed": return activity({ queueChanged: true });
    case "turn/started":
    case "turn/completed": return activity({ turnId: p.turn?.id, turnStatus: p.turn?.status, error: p.turn?.error ?? null, startedAt: p.turn?.startedAt, completedAt: p.turn?.completedAt });
    case "item/commandExecution/outputDelta": return update({ itemType: "commandExecution", deltaField: "aggregatedOutput", delta: text(p.delta) });
    case "item/commandExecution/terminalInteraction": return update({ itemType: "commandExecution", terminalInteraction: { processId: p.processId, stdin: p.stdin } });
    case "item/fileChange/outputDelta": return update({ itemType: "fileChange", deltaField: "output", delta: text(p.delta) });
    case "item/fileChange/patchUpdated": return update({ itemType: "fileChange", changes: p.changes, text: filesText(p.changes) || "Modification de fichiers" });
    case "item/mcpToolCall/progress": return update({ itemType: "mcpToolCall", progress: text(p.message) });
    case "item/plan/delta": return update({ itemType: "plan", deltaField: "text", delta: text(p.delta) });
    case "item/reasoning/summaryTextDelta": return update({ itemType: "reasoning", deltaField: "summary", summaryIndex: p.summaryIndex, delta: text(p.delta) });
    case "item/reasoning/summaryPartAdded": return update({ itemType: "reasoning", summaryIndex: p.summaryIndex, summaryPartAdded: true });
    case "item/reasoning/textDelta": return activity({ reasoningActive: true });
    case "item/started":
    case "item/completed": {
      const rendered = renderCodexItem(p.item);
      return rendered ? { ...base, itemId: rendered.id, itemUpdate: { ...rendered, pending: message.method === "item/started", ...(p.startedAtMs !== undefined ? { startedAtMs: p.startedAtMs } : {}), ...(p.completedAtMs !== undefined ? { completedAtMs: p.completedAtMs } : {}) } } : null;
    }
    case "command/exec/outputDelta":
    case "process/outputDelta": return { ...base, processUpdate: { ...(p.processId ? { processId: p.processId } : { processHandle: p.processHandle }), stream: p.stream, deltaBase64: text(p.deltaBase64), capReached: p.capReached, outputEncoding: "base64" } };
    case "process/exited": return { ...base, processUpdate: { processHandle: p.processHandle, exitCode: p.exitCode, stdout: p.stdout, stderr: p.stderr, stdoutCapReached: p.stdoutCapReached, stderrCapReached: p.stderrCapReached, exited: true } };
    case "thread/compacted": return activity({ compacted: true });
    case "hook/started":
    case "hook/completed": return activity({ hook: p.run, hookPending: message.method === "hook/started" });
    case "model/rerouted": return activity({ modelReroute: p });
    case "modelProvider/authRecoveryStarted":
    case "modelProvider/authRecoveryCompleted": return activity({ authRecovery: p, authRecoveryPending: message.method.endsWith("Started") });
    case "warning":
    case "guardianWarning":
    case "deprecationNotice":
    case "configWarning": return activity({ warning: p });
    default: return null;
  }
}

/** Decode connection-scoped command/process bytes without corrupting split UTF-8. */
export function createCodexOutputDecoder() {
  const decoders = new Map();
  function key(update) { return JSON.stringify([update.processId ?? update.processHandle, update.stream]); }
  return {
    decode(update, { final = false } = {}) {
      const encoded = text(update?.deltaBase64).replace(/\s+/g, "");
      if (!update || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) return "";
      let bytes;
      try { bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0)); } catch { return ""; }
      const id = key(update);
      const decoder = decoders.get(id) || new TextDecoder();
      const decoded = decoder.decode(bytes, { stream: !final });
      if (final) decoders.delete(id); else decoders.set(id, decoder);
      return decoded;
    },
    flush(update) {
      const id = key(update);
      const decoder = decoders.get(id);
      decoders.delete(id);
      return decoder?.decode() || "";
    },
    clear() { decoders.clear(); }
  };
}
