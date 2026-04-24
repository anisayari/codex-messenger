import React, { useEffect, useRef, useState } from "react";

export default function ThreadTabs({
  project,
  contact,
  activeThreadId,
  loading = false,
  loadingError = "",
  isHistoryContact = false,
  onOpenProject,
  onOpenThread,
  onDeleteThread,
  onReorderThreads
}) {
  const [dragThreadId, setDragThreadId] = useState("");
  const [hiddenMenuOpen, setHiddenMenuOpen] = useState(false);
  const [hiddenMenuPosition, setHiddenMenuPosition] = useState({ left: 0, top: 0 });
  const hiddenMenuRef = useRef(null);
  const threads = project?.threads ?? [];
  const hiddenThreads = project?.hiddenThreads ?? [];
  const projectName = project?.name ?? contact.name;
  const projectCwd = project?.cwd ?? contact.cwd;

  useEffect(() => {
    if (!hiddenMenuOpen) return undefined;
    const close = (event) => {
      if (!hiddenMenuRef.current?.contains(event.target)) setHiddenMenuOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setHiddenMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [hiddenMenuOpen]);

  if (!project && !isHistoryContact) {
    return <div className="to-line">A: {contact.name}</div>;
  }

  function reorder(targetThreadId) {
    if (!dragThreadId || dragThreadId === targetThreadId) return;
    const ids = threads.map((thread) => thread.id);
    const from = ids.indexOf(dragThreadId);
    const to = ids.indexOf(targetThreadId);
    if (from < 0 || to < 0) return;
    const next = [...ids];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onReorderThreads(next);
  }

  function threadLoadingStatus() {
    if (loading) {
      return <span className="thread-tab-loading"><i aria-hidden="true" />Anciens fils...</span>;
    }
    if (loadingError) {
      return <span className="thread-tab-loading error">Fils indisponibles</span>;
    }
    return null;
  }

  function toggleHiddenMenu(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    setHiddenMenuPosition({
      left: Math.max(6, Math.min(rect.left, window.innerWidth - 248)),
      top: Math.max(6, rect.bottom - 1)
    });
    setHiddenMenuOpen((open) => !open);
  }

  return (
    <div className="thread-tab-bar">
      <span className="thread-to-label" title={projectCwd || projectName}>A: {projectName}</span>
      <div className="thread-tab-strip" aria-label="Fils Codex">
        {projectCwd ? (
          <button
            className="new-thread-button"
            type="button"
            title="Nouveau fil"
            aria-label="Demarrer un nouveau fil"
            onClick={() => onOpenProject(projectCwd)}
          >
            <span aria-hidden="true">+</span>
          </button>
        ) : null}
        {threads.map((thread) => (
          <div
            className={[
              "thread-tab-wrap",
              activeThreadId === thread.id ? "active" : "",
              dragThreadId === thread.id ? "dragging" : ""
            ].filter(Boolean).join(" ")}
            draggable
            key={thread.id}
            onDragStart={(event) => {
              setDragThreadId(thread.id);
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", thread.id);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
            }}
            onDrop={(event) => {
              event.preventDefault();
              reorder(thread.id);
              setDragThreadId("");
            }}
            onDragEnd={() => setDragThreadId("")}
          >
            <button
              className={activeThreadId === thread.id ? "thread-tab active" : "thread-tab"}
              type="button"
              title={thread.preview}
              onClick={() => onOpenThread(thread.id)}
            >
              <span>{thread.preview}</span>
            </button>
            <button
              className="thread-tab-close"
              type="button"
              title="Supprimer ce fil"
              aria-label={`Supprimer ${thread.preview}`}
              onClick={(event) => {
                event.stopPropagation();
                onDeleteThread(thread);
              }}
            >
              x
            </button>
          </div>
        ))}
        {threadLoadingStatus()}
        {hiddenThreads.length ? (
          <div className="thread-hidden-wrap" ref={hiddenMenuRef}>
            <button
              className={hiddenMenuOpen ? "thread-tab thread-hidden-toggle active" : "thread-tab thread-hidden-toggle"}
              type="button"
              aria-haspopup="menu"
              aria-expanded={hiddenMenuOpen}
              title="Afficher les fils masques"
              onClick={toggleHiddenMenu}
            >
              <span>Autres ({hiddenThreads.length})</span>
            </button>
            {hiddenMenuOpen ? (
              <div className="thread-hidden-menu" role="menu" style={{ left: hiddenMenuPosition.left, top: hiddenMenuPosition.top }}>
                <div className="thread-hidden-title">Fils masques</div>
                {hiddenThreads.map((thread) => (
                  <button
                    type="button"
                    key={thread.id}
                    role="menuitem"
                    title={thread.preview}
                    onClick={() => {
                      setHiddenMenuOpen(false);
                      onOpenThread(thread.id);
                    }}
                  >
                    <span>{thread.preview || "Nouveau fil Codex"}</span>
                    <small>{thread.timestamp ? new Date(thread.timestamp).toLocaleDateString() : "Codex"}</small>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
