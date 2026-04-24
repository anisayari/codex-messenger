import React, { useEffect, useRef, useState } from "react";

const api = window.codexMsn;

export const brandPeopleLogo = new URL("./icons/codex-messenger-people.png", window.location.href).href;

export function Logo({ small = false }) {
  return (
    <span className={small ? "logo small" : "logo"} aria-hidden="true">
      <img src={brandPeopleLogo} alt="" draggable="false" />
    </span>
  );
}

export function Titlebar({ title }) {
  return (
    <header className="titlebar">
      <div className="title-left">
        <span className="titlebar-logo"><Logo small /></span>
        <span>{title}</span>
      </div>
      <div className="window-buttons">
        <button type="button" aria-label="Minimiser" onClick={() => api.window.minimize()}><span /></button>
        <button type="button" aria-label="Maximiser" onClick={() => api.window.maximize()}><span /></button>
        <button type="button" aria-label="Fermer" onClick={() => api.window.close()}><span /></button>
      </div>
    </header>
  );
}

export function ResizeGrip() {
  const dragRef = useRef(null);

  function startResize(event) {
    if (event.button !== 0 || !api.window?.getBounds || !api.window?.resizeTo) return;
    event.preventDefault();
    event.stopPropagation();

    const target = event.currentTarget;
    const state = {
      active: true,
      startX: event.screenX,
      startY: event.screenY,
      bounds: null,
      frame: 0,
      latest: null,
      pendingEvent: null
    };
    dragRef.current = state;
    target.classList.add("resizing");
    try {
      target.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture can fail on older embedded Chromium builds; resize still works inside the window.
    }

    const flush = () => {
      state.frame = 0;
      if (!state.active || !state.latest) return;
      api.window.resizeTo(state.latest).catch?.(() => {});
    };

    const scheduleResize = (moveEvent) => {
      if (!state.bounds) {
        state.pendingEvent = moveEvent;
        return;
      }
      state.latest = {
        width: state.bounds.width + moveEvent.screenX - state.startX,
        height: state.bounds.height + moveEvent.screenY - state.startY
      };
      if (!state.frame) state.frame = window.requestAnimationFrame(flush);
    };

    const cleanup = (moveEvent) => {
      if (!state.active) return;
      if (moveEvent?.screenX !== undefined) scheduleResize(moveEvent);
      state.active = false;
      if (state.frame) window.cancelAnimationFrame(state.frame);
      if (state.latest) api.window.resizeTo(state.latest).catch?.(() => {});
      target.classList.remove("resizing");
      target.removeEventListener("pointermove", scheduleResize);
      target.removeEventListener("pointerup", cleanup);
      target.removeEventListener("pointercancel", cleanup);
      target.removeEventListener("lostpointercapture", cleanup);
      if (dragRef.current === state) dragRef.current = null;
    };

    target.addEventListener("pointermove", scheduleResize);
    target.addEventListener("pointerup", cleanup, { once: true });
    target.addEventListener("pointercancel", cleanup, { once: true });
    target.addEventListener("lostpointercapture", cleanup, { once: true });

    api.window.getBounds()
      .then((bounds) => {
        if (!state.active || !bounds) return;
        state.bounds = bounds;
        if (state.pendingEvent) scheduleResize(state.pendingEvent);
      })
      .catch(cleanup);
  }

  return (
    <button
      type="button"
      className="resize-grip"
      aria-label="Redimensionner la fenetre"
      onPointerDown={startResize}
    />
  );
}

export function Menu({ items }) {
  const [open, setOpen] = useState(null);
  const ref = useRef(null);
  const normalized = items.map((item) => typeof item === "string" ? { label: item, entries: [] } : item);

  useEffect(() => {
    const close = (event) => {
      if (!ref.current?.contains(event.target)) setOpen(null);
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setOpen(null);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  async function runEntry(entry) {
    if (entry.disabled) return;
    setOpen(null);
    try {
      await entry.action?.();
    } catch (error) {
      window.alert(error.message ?? "Action impossible");
    }
  }

  return (
    <nav className="menu" ref={ref}>
      {normalized.map((menu, index) => (
        <div className="menu-item" key={menu.label} onMouseEnter={() => open !== null && setOpen(index)}>
          <button
            className={open === index ? "menu-button active" : "menu-button"}
            type="button"
            onClick={() => setOpen(open === index ? null : index)}
          >
            {menu.label}
          </button>
          {open === index ? (
            <div className="menu-dropdown">
              {(menu.entries?.length ? menu.entries : [{ label: "Aucune action", disabled: true }]).map((entry, entryIndex) => (
                entry.separator ? (
                  <div className="menu-separator" key={`separator-${entryIndex}`} />
                ) : (
                  <button
                    className="menu-entry"
                    type="button"
                    disabled={entry.disabled}
                    key={entry.label}
                    onClick={() => runEntry(entry)}
                  >
                    <span>{entry.label}</span>
                    {entry.shortcut ? <small>{entry.shortcut}</small> : null}
                  </button>
                )
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </nav>
  );
}
