import React, { useEffect, useRef, useState } from "react";
import "./terminalPanel.css";
import { isCompositionEvent } from "./composerUtils.js";

const MAX_VISIBLE = 128_000;
const blockComposedEnter = (event) => { if (event.key === "Enter" && isCompositionEvent(event)) event.preventDefault(); };
const policyLabel = (value) => ({ readOnly: "lecture seule", workspaceWrite: "écriture dans le projet", dangerFullAccess: "accès complet", externalSandbox: "sandbox externe" }[value] || `profil ${value}`);
// This panel is a plain text PTY transcript; full screen ANSI applications need a terminal emulator.
const readable = (text) => String(text || "").replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "").replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");

export function TerminalPanel({ contactId, threadId, cwd, api = window.codexMsn, onClose }) {
  const [command, setCommand] = useState(""); const [input, setInput] = useState("");
  const [output, setOutput] = useState(""); const [error, setError] = useState("");
  const [running, setRunning] = useState(false); const [pending, setPending] = useState(false);
  const [session, setSession] = useState(null); const [status, setStatus] = useState("Prêt");
  const sessionRef = useRef(null); const outputRef = useRef(null); const queued = useRef(new Map());
  const activeRef = useRef(true);
  const contextGeneration = useRef(0);
  function append(text) { setOutput((previous) => (previous + readable(text)).slice(-MAX_VISIBLE)); }
  function accept(payload) {
    append(payload.text); if (payload.truncated) setStatus("Sortie limitée par le serveur");
    if (payload.done) { setRunning(false); setStatus(payload.error ? "Erreur" : `Terminé — code ${payload.exitCode ?? "inconnu"}`); if (payload.error) setError(payload.error); }
  }
  useEffect(() => {
    activeRef.current = true;
    contextGeneration.current += 1;
    sessionRef.current = null; setSession(null); setRunning(false); setPending(false); setOutput(""); setStatus("Prêt"); queued.current.clear();
    const unsubscribe = api?.on?.("terminal:output", (payload) => {
      if (payload.sessionId === sessionRef.current) accept(payload);
      else { const buffer = queued.current.get(payload.sessionId) || []; if (buffer.length < 100) buffer.push(payload); queued.current.set(payload.sessionId, buffer); }
    });
    return () => { activeRef.current = false; unsubscribe?.(); if (sessionRef.current) void api.terminalStop({ sessionId: sessionRef.current }).catch(() => {}); queued.current.clear(); };
  }, [api, contactId, threadId]);
  useEffect(() => { if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight; }, [output]);
  useEffect(() => {
    const element = outputRef.current; if (!element || !session || !running || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const cols = Math.max(20, Math.min(500, Math.floor(entry.contentRect.width / 8)));
      const rows = Math.max(5, Math.min(500, Math.floor(entry.contentRect.height / 16)));
      void api.terminalResize({ sessionId: session, cols, rows }).catch(() => {});
    });
    observer.observe(element); return () => observer.disconnect();
  }, [session, running, api]);
  async function run(event) {
    event.preventDefault(); if (!command.trim() || pending || running) return;
    if (!api?.terminalStart) { setError("Le terminal est disponible dans l’app de bureau."); return; }
    const generation = contextGeneration.current;
    setPending(true); setError(""); setOutput(""); setStatus("Démarrage…");
    try {
      const result = await api.terminalStart({ contactId, threadId, command, cols: 80, rows: 24 });
      if (!activeRef.current || generation !== contextGeneration.current) { void api.terminalStop({ sessionId: result.sessionId }).catch(() => {}); return; }
      if (!result?.ok) throw new Error(result?.error || "Terminal indisponible.");
      sessionRef.current = result.sessionId; setSession(result.sessionId); setRunning(true); setStatus(`En cours — ${policyLabel(result.sandbox)} — limite 60 s`);
      for (const payload of queued.current.get(result.sessionId) || []) accept(payload); queued.current.clear();
    } catch (failure) { if (generation === contextGeneration.current) { setError(failure.message); setStatus("Erreur"); } } finally { if (activeRef.current && generation === contextGeneration.current) setPending(false); }
  }
  async function write(data) { try { await api.terminalWrite({ sessionId: sessionRef.current, data }); setInput(""); } catch (failure) { setError(failure.message); } }
  async function stop() { try { await api.terminalStop({ sessionId: sessionRef.current }); } catch (failure) { setError(failure.message); } }
  return <section className="terminal-panel" aria-label="Terminal Codex">
    <header><strong>Terminal Codex</strong><button type="button" onClick={onClose} aria-label="Fermer le terminal">×</button></header>
    <p className="terminal-context" title={cwd}>{cwd || "Dossier de la conversation"}</p>
    <form onSubmit={run} className="terminal-command"><label htmlFor="terminal-command">Commande explicite</label><input id="terminal-command" onKeyDown={blockComposedEnter} value={command} onChange={(event) => setCommand(event.target.value)} disabled={running || pending} maxLength={16000} placeholder="Commande shell…" /><button disabled={running || pending || !command.trim()}>Exécuter</button></form>
    <pre ref={outputRef} className="terminal-transcript" tabIndex={0} aria-label="Sortie du terminal">{output || "La sortie de votre commande s’affichera ici."}</pre>
    <form className="terminal-input" onSubmit={(event) => { event.preventDefault(); void write(`${input}\n`); }}><input aria-label="Entrée du terminal" value={input} onChange={(event) => setInput(event.target.value)} disabled={!running} onKeyDown={(event) => { if (event.key === "Enter" && isCompositionEvent(event)) { event.preventDefault(); return; } if (event.ctrlKey && event.key.toLowerCase() === "c") { event.preventDefault(); void write("\x03"); } }} /><button disabled={!running}>Envoyer</button><button type="button" disabled={!running} onClick={() => write("\x03")}>Ctrl+C</button><button type="button" disabled={!running} onClick={stop}>Arrêter</button></form>
    <p className="terminal-status" role="status">{status}</p>{error ? <p className="terminal-error" role="alert">{error}</p> : null}
    <small>Transcript texte : les applications plein écran et les couleurs ANSI ne sont pas rendues. Les dernières 128 000 caractères sont conservés à l’écran.</small>
  </section>;
}
