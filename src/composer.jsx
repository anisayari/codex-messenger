import React from "react";
import { isCompositionEvent } from "./composerUtils.js";

export default function Composer({
  copy,
  draft,
  onDraftChange,
  onSubmit,
  textareaRef,
  onKeyDown,
  onPaste,
  typing,
  onStop,
  onSearch,
  historySearchOpen,
  historySearchQuery,
  onHistorySearchChange,
  onHistorySearchClose,
  filteredPromptHistory,
  onUseHistoryEntry,
  slashMatches,
  onRunSlashCommand,
  draftAttachments,
  onRemoveAttachment,
  sending = false,
  onDropFiles
}) {
  return (
    <form className="composer" onSubmit={onSubmit}>
      {(historySearchOpen || slashMatches.length) ? (
        <div className="composer-popup">
          {historySearchOpen ? (
            <>
              <input
                autoFocus
                value={historySearchQuery}
                onChange={(event) => onHistorySearchChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") onHistorySearchClose();
                  if (event.key === "Enter" && !isCompositionEvent(event) && filteredPromptHistory[0]) {
                    event.preventDefault();
                    onUseHistoryEntry(filteredPromptHistory[0]);
                  }
                }}
                placeholder="Search message history"
                aria-label={copy.menu.searchTranscript}
              />
              {filteredPromptHistory.length ? filteredPromptHistory.map((entry) => (
                <button type="button" key={entry} onClick={() => onUseHistoryEntry(entry)}>
                  <span>{entry}</span>
                </button>
              )) : <small>Aucun message</small>}
            </>
          ) : slashMatches.map((command) => (
            <button type="button" key={command.id} onClick={() => onRunSlashCommand(command.id)}>
              <span>{command.label}</span>
              <small>{command.detail}</small>
            </button>
          ))}
        </div>
      ) : null}
      {draftAttachments.length ? (
        <div className="composer-attachments">
          {draftAttachments.map((attachment, index) => (
            <button
              type="button"
              key={`${attachment.path}-${index}`}
              onClick={() => onRemoveAttachment(index)}
              title={`Retirer ${attachment.name || "cette pièce jointe"}`}
              aria-label={`Retirer ${attachment.name || "cette pièce jointe"}`}
            >
              {attachment.type === "image" ? <img src={attachment.src} alt="" draggable="false" /> : <span aria-hidden="true">📎</span>}
              <span>{attachment.name || `Image ${index + 1}`}</span>
            </button>
          ))}
        </div>
      ) : null}
      <textarea
        ref={textareaRef}
        aria-label={copy.chat.messageLabel || "Message à Codex"}
        value={draft}
        onChange={(event) => onDraftChange(event.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes("Files")) event.preventDefault();
        }}
        onDrop={onDropFiles}
      />
      <div>
        <button type="submit" disabled={sending || (!draft.trim() && !draftAttachments.length)}>{sending ? "Envoi…" : copy.chat.send}</button>
        {typing ? <button type="button" onClick={onStop}>{copy.chat.stop}</button> : <button type="button" onClick={onSearch}>{copy.chat.search}</button>}
      </div>
    </form>
  );
}
