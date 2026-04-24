import React, { useEffect, useRef, useState } from "react";

function PromptDialog({ title, initialValue = "", inputType = "text", okLabel = "OK", cancelLabel = "Annuler", onSubmit, onCancel }) {
  const [value, setValue] = useState(initialValue);
  useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  function submit(event) {
    event.preventDefault();
    onSubmit(value);
  }

  return (
    <div className="settings-dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onCancel()}>
      <form className="settings-dialog rename-contact-dialog" onSubmit={submit} role="dialog" aria-modal="true" aria-label={title}>
        <header>
          <strong>{title}</strong>
          <button type="button" aria-label={cancelLabel} onClick={onCancel}>x</button>
        </header>
        <section>
          <label className="settings-row">
            <span>{title}</span>
            <input
              autoFocus
              type={inputType}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") onCancel();
              }}
            />
          </label>
        </section>
        <footer>
          <button type="submit">{okLabel}</button>
          <button type="button" onClick={onCancel}>{cancelLabel}</button>
        </footer>
      </form>
    </div>
  );
}

export function usePromptDialog({ okLabel = "OK", cancelLabel = "Annuler" } = {}) {
  const [promptState, setPromptState] = useState(null);
  const resolverRef = useRef(null);

  function askPrompt(options = {}) {
    return new Promise((resolve) => {
      resolverRef.current = resolve;
      setPromptState({
        title: options.title ?? "",
        initialValue: String(options.initialValue ?? ""),
        inputType: options.inputType ?? "text",
        okLabel: options.okLabel ?? okLabel,
        cancelLabel: options.cancelLabel ?? cancelLabel
      });
    });
  }

  function resolvePrompt(value) {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setPromptState(null);
    resolve?.(value);
  }

  const promptDialog = promptState ? (
    <PromptDialog
      {...promptState}
      onSubmit={(value) => resolvePrompt(value)}
      onCancel={() => resolvePrompt(null)}
    />
  ) : null;

  return [askPrompt, promptDialog];
}
