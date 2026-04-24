import React from "react";

export default function CodexConfigurationDialog({
  copy,
  summary,
  codexOptions,
  modelOptions,
  reasoningOptions,
  cwdOptions,
  sandboxOptions,
  approvalOptions,
  onChange,
  onClose
}) {
  function changeModel(value) {
    const nextReasoningOptions = reasoningOptions.forModel(value);
    const supportsCurrentReasoning = nextReasoningOptions.some((option) => option.value === codexOptions.reasoningEffort);
    onChange({
      model: value,
      reasoningEffort: supportsCurrentReasoning ? codexOptions.reasoningEffort : ""
    });
  }

  const effectiveReasoningOptions = reasoningOptions.current;

  return (
    <div className="settings-dialog-backdrop codex-config-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="settings-dialog codex-config-dialog" role="dialog" aria-modal="true" aria-label={copy.chat.configuration}>
        <header>
          <strong>{copy.chat.configuration}</strong>
          <button type="button" aria-label={copy.common.close} onClick={onClose}>x</button>
        </header>
        <section>
          <div className="codex-config-summary">{summary}</div>
          <label className="settings-row">
            <span>{copy.chat.model}</span>
            <select value={codexOptions.model} onChange={(event) => changeModel(event.target.value)}>
              {modelOptions.map((option) => (
                <option key={option.value || "auto"} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className="settings-row">
            <span>{copy.chat.reasoning}</span>
            <select value={codexOptions.reasoningEffort} onChange={(event) => onChange({ reasoningEffort: event.target.value })}>
              {effectiveReasoningOptions.map((option) => (
                <option key={option.value || "auto"} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className="settings-row">
            <span>{copy.chat.execution}</span>
            <select value={codexOptions.cwdMode} onChange={(event) => onChange({ cwdMode: event.target.value })}>
              {cwdOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className="settings-row">
            <span>{copy.chat.sandbox}</span>
            <select value={codexOptions.sandbox} onChange={(event) => onChange({ sandbox: event.target.value })}>
              {sandboxOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className="settings-row">
            <span>{copy.chat.confirmation}</span>
            <select value={codexOptions.approvalPolicy} onChange={(event) => onChange({ approvalPolicy: event.target.value })}>
              {approvalOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        </section>
        <footer>
          <button type="button" onClick={onClose}>{copy.common.close}</button>
        </footer>
      </section>
    </div>
  );
}
