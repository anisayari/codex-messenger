import React from "react";

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

export function Message({ message, extractWinkFromText, renderFormattedMessageText, onOpenAttachment }) {
  if (message.itemType === "commandExecution") {
    const commandText = message.command || message.text || "Commande Codex";
    const outputText = message.text && message.text !== message.command
      ? message.text.replace(message.command ?? "", "").trim()
      : "";
    const statusText = `${message.status || "completed"}${message.exitCode !== null && message.exitCode !== undefined ? ` / exit ${message.exitCode}` : ""}`;
    return (
      <details className={`codex-item command ${message.status ?? ""}`}>
        <summary>
          <span className="command-summary-title">{commandText}</span>
          <span className="command-summary-status">{statusText}</span>
          <time>{message.time}</time>
        </summary>
        {message.cwd ? <small>{message.cwd}</small> : null}
        {outputText ? <pre>{outputText}</pre> : null}
      </details>
    );
  }
  if (message.itemType === "fileChange") {
    return (
      <article className={`codex-item file ${message.status ?? ""}`}>
        <header><strong>Fichiers modifies</strong><time>{message.time}</time></header>
        <pre>{message.text}</pre>
        <footer>{message.status || "termine"}</footer>
      </article>
    );
  }
  if (message.itemType === "mcpToolCall" || message.itemType === "dynamicToolCall") {
    return (
      <article className="codex-item tool">
        <header><strong>Outil Codex</strong><time>{message.time}</time></header>
        <p>{message.text}</p>
      </article>
    );
  }
  if (message.from === "system") {
    return <p className={message.noticeKind ? `system notice-${message.noticeKind}` : "system"}><span>{message.time}</span> {message.text}</p>;
  }
  const parsed = message.wink ? { text: message.text, wink: message.wink } : extractWinkFromText(message.text);
  const wink = message.wink ?? parsed.wink;
  const imageAttachments = [
    ...(Array.isArray(message.images) ? message.images : []),
    message.attachment?.type === "image" ? message.attachment : null
  ].filter((attachment, index, all) => attachment?.src && all.findIndex((candidate) => candidate?.src === attachment.src) === index);
  const imageCommand = message.imageCommand ?? null;
  const imageCommandStatus = imageCommand ? imageCommandStatusLabel(imageCommand.status) : "";
  return (
    <article className={message.from === "me" ? "message me-message" : "message"}>
      <header><strong>{message.author}</strong><time>{message.time}</time></header>
      {imageCommand ? (
        <details className={`codex-item command image-generation-call ${imageCommand.status ?? ""}`}>
          <summary>
            <span className="command-summary-title">{imageCommand.command || "image_generation_call"}</span>
            <span className="command-summary-status">{imageCommandStatus}</span>
            <time>{message.time}</time>
          </summary>
          {!message.attachment?.src ? <small>Generation d'image en cours...</small> : null}
          {imageCommand.path ? <small>{imageCommand.path}</small> : null}
          {imageCommand.prompt ? <pre>{imageCommand.prompt}</pre> : null}
        </details>
      ) : null}
      {parsed.text ? <div className="message-content">{renderFormattedMessageText(parsed.text)}</div> : null}
      {wink ? (
        <div className="message-wink">
          <img src={wink.src} alt="" draggable="false" />
          <span>{wink.label}</span>
        </div>
      ) : null}
      {imageAttachments.length ? (
        <div className={message.itemType === "imageGeneration" || message.itemType === "image_generation_call" ? "message-gallery generated" : "message-gallery"}>
          {imageAttachments.map((attachment, index) => (
            <button
              type="button"
              className="message-image-link"
              key={`${attachment.src}-${index}`}
              onClick={() => onOpenAttachment?.(attachment)}
              title={attachment.prompt || attachment.name || "Image"}
            >
              <img className="message-attachment" src={attachment.src} alt={attachment.name ?? "Image"} loading="lazy" draggable="false" />
            </button>
          ))}
        </div>
      ) : null}
      {message.attachment?.type === "audio" ? <audio className="message-audio" controls src={message.attachment.src} /> : null}
      {message.attachment?.type === "file" ? <small className="message-file">{message.attachment.name}</small> : null}
    </article>
  );
}
