import React from "react";
import { localFilePathForHref } from "./messageLinks.js";

function imageCommandStatusLabel(status) {
  const clean = String(status ?? "").trim().toLowerCase();
  if (clean === "completed" || clean === "succeeded" || clean === "success") return "termine";
  if (clean === "failed" || clean === "error") return "erreur";
  if (clean === "pending" || clean === "queued") return "en attente";
  return "generation";
}

export function ApprovalRequestsPanel({ requests, onRespond }) {
  if (!requests.length) return null;
  return (
    <div className="approval-stack">
      {requests.map((request) => {
        const disabled = Boolean(request.sendingDecision);
        const changes = request.fileChanges ?? [];
        const hiddenChanges = Math.max(0, changes.length - 4);
        return (
          <section className={`approval-card ${request.riskLevel || "unknown"}`} key={request.approvalId}>
            <div className="approval-head">
              <strong>{request.title}</strong>
              <span>{request.riskLevel ? `risk: ${request.riskLevel}` : "limited access"}</span>
            </div>
            {request.reason ? <p className="approval-reason">{request.reason}</p> : null}
            {request.kind === "command" ? (
              <pre className="approval-command">{request.command || "Commande non detaillee"}</pre>
            ) : (
              <ul className="approval-files">
                {changes.slice(0, 4).map((change) => (
                  <li key={`${change.kind}:${change.path}`}><span>{change.kind}</span>{change.path}</li>
                ))}
                {!changes.length ? <li><span>write</span>Changements non detailles</li> : null}
                {hiddenChanges ? <li><span>plus</span>{hiddenChanges} autre(s) fichier(s)</li> : null}
              </ul>
            )}
            <div className="approval-meta">
              {request.cwd ? <span>{request.cwd}</span> : null}
              {request.riskDescription ? <span>{request.riskDescription}</span> : null}
              {request.grantRoot ? <span>grant root: {request.grantRoot}</span> : null}
            </div>
            {request.error ? <p className="approval-error">{request.error}</p> : null}
            <div className="approval-actions">
              <button type="button" disabled={disabled} onClick={() => onRespond(request, "approved")}>Allow</button>
              {request.canApproveForSession ? (
                <button type="button" disabled={disabled} onClick={() => onRespond(request, "approved_for_session")}>Allow session</button>
              ) : null}
              <button type="button" disabled={disabled} className="deny" onClick={() => onRespond(request, "denied")}>Disallow</button>
            </div>
          </section>
        );
      })}
    </div>
  );
}

function sourceForAttachment(attachment, type) {
  const source = String(attachment.src || "");
  if (/^https?:\/\//i.test(source)) return source;
  if (type === "image" && /^data:image\/[a-z0-9.+-]+;base64,/i.test(source)) return source;
  if (type === "audio" && /^data:audio\/[a-z0-9.+-]+;base64,/i.test(source)) return source;
  const filePath = localFilePathForHref(attachment.path || source);
  if (!filePath) return "";
  const encoded = encodeURI(filePath.replace(/\\/g, "/")).replace(/[#?]/g, (character) => encodeURIComponent(character));
  return /^[a-z]:\//i.test(encoded) ? "file:///" + encoded : "file://" + encoded;
}

function MessageAttachments({ message, onOpenAttachment }) {
  const candidates = [
    ...(Array.isArray(message.images) ? message.images.map((image) => ({ type: "image", ...image })) : []),
    ...(Array.isArray(message.attachments) ? message.attachments : []),
    message.attachment
  ].filter(Boolean);
  const attachments = candidates.filter((attachment, index) => candidates.findIndex((candidate) => candidate.type === attachment.type && (candidate.path || candidate.src) === (attachment.path || attachment.src)) === index);
  const images = attachments.filter((attachment) => attachment.type === "image").map((attachment) => ({ ...attachment, src: sourceForAttachment(attachment, "image") })).filter((attachment) => attachment.src);
  const audio = attachments.filter((attachment) => attachment.type === "audio").map((attachment) => ({ ...attachment, src: sourceForAttachment(attachment, "audio") })).filter((attachment) => attachment.src);
  return <>
    {images.length ? <div className={message.itemType === "imageGeneration" || message.imageCommand ? "message-gallery generated" : "message-gallery"}>
      {images.map((attachment, index) => <button type="button" className="message-image-link" key={attachment.src + index} onClick={() => onOpenAttachment?.(attachment)} title={attachment.prompt || attachment.name || "Image"}>
        <img className="message-attachment" src={attachment.src} alt={attachment.name || "Image de la conversation"} loading="lazy" draggable="false" />
      </button>)}
    </div> : null}
    {audio.map((attachment, index) => <div key={attachment.src + index}><audio className="message-audio" controls src={attachment.src} aria-label={attachment.name || "Clip audio"} />{attachment.path ? <button type="button" className="message-file" onClick={() => onOpenAttachment?.(attachment)}>Ouvrir le clip audio</button> : null}</div>)}
    {attachments.filter((attachment) => attachment.type === "file").map((attachment, index) => <button className="message-file" type="button" key={(attachment.path || attachment.name) + index} onClick={() => onOpenAttachment?.(attachment)} disabled={!attachment.path}>{attachment.name || "Fichier local"}</button>)}
  </>;
}

const itemLabels = {
  mcpToolCall: "Outil MCP", dynamicToolCall: "Outil Codex", functionCallOutput: "Résultat d’outil",
  hookPrompt: "Hook Codex", plan: "Plan de travail", collabAgentToolCall: "Agents Codex",
  subAgentActivity: "Activité des agents", webSearch: "Recherche web", imageView: "Image consultée",
  sleep: "Attente", enteredReviewMode: "Revue commencée", exitedReviewMode: "Revue terminée",
  contextCompaction: "Contexte compacté"
};

export function Message({ message, extractWinkFromText, renderFormattedMessageText, onOpenAttachment }) {
  const identity = { id: "message-" + message.id, tabIndex: -1 };
  if (message.itemType === "commandExecution") {
    const commandText = message.command || message.text || "Commande Codex";
    const outputText = message.text && message.text !== message.command ? message.text.replace(message.command || "", "").trim() : "";
    const statusText = (message.status || "completed") + (message.exitCode !== null && message.exitCode !== undefined ? " / exit " + message.exitCode : "");
    return <details className={"codex-item command " + (message.status || "")} {...identity}>
      <summary><span className="command-summary-title">{commandText}</span><span className="command-summary-status">{statusText}</span><time>{message.time}</time></summary>
      {message.cwd ? <small>{message.cwd}</small> : null}{outputText ? <pre>{outputText}</pre> : null}
      <MessageAttachments message={message} onOpenAttachment={onOpenAttachment} />
    </details>;
  }
  if (message.itemType === "fileChange") {
    return <article className={"codex-item file " + (message.status || "")} {...identity}>
      <header><strong>Fichiers modifiés</strong><time>{message.time}</time></header><pre>{message.text}</pre><footer>{message.status || "terminé"}</footer>
    </article>;
  }
  if (itemLabels[message.itemType]) {
    return <article className={"codex-item tool " + message.itemType} {...identity}>
      <header><strong>{itemLabels[message.itemType]}</strong><time>{message.time}</time></header>
      <div className="message-content">{renderFormattedMessageText(message.text)}</div>
      <MessageAttachments message={message} onOpenAttachment={onOpenAttachment} />
      {message.status ? <footer>{message.status}</footer> : null}
    </article>;
  }
  if (message.from === "system") return <p className={message.noticeKind ? "system notice-" + message.noticeKind : "system"} {...identity}><span>{message.time}</span> {message.text}</p>;
  const parsed = message.wink ? { text: message.text, wink: message.wink } : extractWinkFromText(message.text);
  const wink = message.wink || parsed.wink;
  const imageCommand = message.imageCommand;
  return <article className={message.from === "me" ? "message me-message" : "message"} {...identity}>
    <header><strong>{message.author}</strong><time>{message.time}</time></header>
    {message.delivery === "failed" ? <small className="message-delivery error" role="status">Échec d’envoi. Le brouillon et les pièces jointes sont conservés.</small> : null}
    {message.delivery === "sending" ? <small className="message-delivery" role="status">Envoi…</small> : null}
    {imageCommand ? <details className={"codex-item command image-generation-call " + (imageCommand.status || "")}>
      <summary><span className="command-summary-title">{imageCommand.command || "image_generation_call"}</span><span className="command-summary-status">{imageCommandStatusLabel(imageCommand.status)}</span><time>{message.time}</time></summary>
      {imageCommand.path ? <small>{imageCommand.path}</small> : null}{imageCommand.prompt ? <pre>{imageCommand.prompt}</pre> : null}
    </details> : null}
    {parsed.text ? <div className="message-content">{renderFormattedMessageText(parsed.text)}</div> : null}
    {wink ? <div className="message-wink"><img src={wink.src} alt="" draggable="false" /><span>{wink.label} · aperçu</span></div> : null}
    <MessageAttachments message={message} onOpenAttachment={onOpenAttachment} />
  </article>;
}
