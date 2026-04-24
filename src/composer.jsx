import React from "react";

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
  onRemoveAttachment
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
                  if (event.key === "Enter" && filteredPromptHistory[0]) onUseHistoryEntry(filteredPromptHistory[0]);
                }}
                placeholder="Search message history"
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
              title="Retirer cette image"
            >
              <img src={attachment.src} alt="" draggable="false" />
              <span>[Image #{index + 1}]</span>
            </button>
          ))}
        </div>
      ) : null}
      <textarea ref={textareaRef} value={draft} onChange={(event) => onDraftChange(event.target.value)} onKeyDown={onKeyDown} onPaste={onPaste} />
      <div>
        <button type="submit">{copy.chat.send}</button>
        {typing ? <button type="button" onClick={onStop}>{copy.chat.stop}</button> : <button type="button" onClick={onSearch}>{copy.chat.search}</button>}
      </div>
    </form>
  );
}
