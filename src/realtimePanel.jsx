import React, { useEffect, useReducer, useRef, useState } from "react";
import { RealtimeAudioSession, describeMicrophoneError } from "./realtimeAudio.js";
import { initialRealtimeTranscript, reduceRealtimeTranscript } from "./realtimeTranscript.js";
import { shouldSubmitOnEnter } from "./composerUtils.js";
import { isRealtimeCallShortcut } from "./realtimeShortcut.js";
import "./realtime.css";

const statusLabels = {
  idle: "Prêt à appeler", connecting: "Connexion en cours…", active: "Appel connecté", stopping: "Fin de l'appel…", error: "Appel interrompu"
};

export function RealtimePanel({ api, contactId, contactName = "Codex", onClose }) {
  const [state, setState] = useState({ status: "idle", muted: false, version: "v3" });
  const [error, setError] = useState("");
  const [voices, setVoices] = useState([]);
  const [voice, setVoice] = useState("");
  const [loadingVoices, setLoadingVoices] = useState(false);
  const [savingVoice, setSavingVoice] = useState(false);
  const [voiceMessage, setVoiceMessage] = useState("");
  const [text, setText] = useState("");
  const [sendingText, setSendingText] = useState(false);
  const [transcript, dispatchTranscript] = useReducer(reduceRealtimeTranscript, initialRealtimeTranscript);
  const audioRef = useRef(null);
  const generationRef = useRef(0);
  const mountedRef = useRef(false);
  const stateRef = useRef(state);
  const shortcutRef = useRef(null);
  const transcriptRef = useRef(null);
  stateRef.current = state;
  const available = Boolean(api?.realtimeStart && api?.realtimeStop && api?.realtimeAppendAudio && api?.on);
  const open = ["connecting", "active", "stopping"].includes(state.status);
  const connected = state.status === "active";
  shortcutRef.current = () => {
    if (["connecting", "active"].includes(stateRef.current.status)) void stop();
    else if (stateRef.current.status !== "stopping") void start();
  };

  useEffect(() => {
    mountedRef.current = true;
    if (!available) return () => { mountedRef.current = false; };
    const off = api.on("codex:realtime", (event) => {
      if (event.contactId !== contactId) return;
      const message = event.message ?? event;
      if (message.method === "realtime/state") {
        const next = message.params;
        stateRef.current = next;
        setState(next);
        audioRef.current?.setActive(next.status === "active");
        audioRef.current?.setMuted(next.muted);
        if (["idle", "error"].includes(next.status)) {
          generationRef.current += 1;
          void audioRef.current?.close();
          audioRef.current = null;
        }
        if (next.error) setError(next.error);
      } else if (message.method === "thread/realtime/outputAudio/delta") {
        try { audioRef.current?.play(message.params.audio); }
        catch (failure) { fail(failure); }
      } else if (message.method === "thread/realtime/itemAdded") {
        const type = message.params?.item?.type;
        if (["input_audio_buffer.speech_started", "response.cancelled"].includes(type)) {
          audioRef.current?.interruptPlayback();
        }
      }
      dispatchTranscript(message);
    });
    const initialGeneration = generationRef.current;
    api.realtimeState?.(contactId).then((next) => {
      if (mountedRef.current && generationRef.current === initialGeneration) setState(next);
    }).catch((failure) => { if (mountedRef.current) setError(failure.message); });
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      off?.();
      void audioRef.current?.close();
      audioRef.current = null;
      void api.realtimeStop(contactId).catch(() => {});
    };
  }, [api, contactId, available]);

  useEffect(() => {
    if (!available) return;
    const onKeyDown = (event) => {
      if (!isRealtimeCallShortcut(event)) return;
      event.preventDefault();
      shortcutRef.current?.();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [available]);

  useEffect(() => {
    if (available && (api.realtimeVoicePreference || api.realtimeListVoices)) void loadVoices();
  }, [api, available]);

  useEffect(() => {
    if (transcriptRef.current) transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
  }, [transcript]);

  function fail(failure) {
    const message = describeMicrophoneError(failure);
    generationRef.current += 1;
    void audioRef.current?.close();
    audioRef.current = null;
    if (mountedRef.current) {
      setError(message);
      setState((previous) => ({ ...previous, status: "error", muted: false }));
    }
    void api.realtimeStop(contactId).catch(() => {});
  }

  async function loadVoices() {
    if ((!api.realtimeVoicePreference && !api.realtimeListVoices) || loadingVoices || savingVoice) return;
    setLoadingVoices(true);
    setError("");
    try {
      const result = api.realtimeVoicePreference
        ? await api.realtimeVoicePreference()
        : await api.realtimeListVoices();
      if (mountedRef.current) {
        const names = result.voices?.v1 ?? [];
        setVoices(names);
        if (api.realtimeVoicePreference) {
          setVoice(names.includes(result.voice) ? result.voice : "");
          setVoiceMessage(result.note ?? "");
        } else setVoice((previous) => names.includes(previous) ? previous : "");
      }
    } catch (failure) { if (mountedRef.current) setError(failure.message); }
    finally { if (mountedRef.current) setLoadingVoices(false); }
  }

  async function saveVoicePreference() {
    if (!api.realtimeSetVoicePreference || open || loadingVoices || savingVoice) return;
    setSavingVoice(true);
    setError("");
    setVoiceMessage("");
    try {
      const result = await api.realtimeSetVoicePreference(voice || null);
      if (mountedRef.current) {
        const names = result.voices?.v1 ?? [];
        setVoices(names);
        setVoice(names.includes(result.voice) ? result.voice : "");
        setVoiceMessage([result.message, result.note].filter(Boolean).join(" "));
      }
    } catch (failure) { if (mountedRef.current) setError(failure.message); }
    finally { if (mountedRef.current) setSavingVoice(false); }
  }

  async function start() {
    if (!available || open || loadingVoices || savingVoice) return;
    const generation = ++generationRef.current;
    setError("");
    setState((previous) => ({ ...previous, status: "connecting", muted: false }));
    const audio = new RealtimeAudioSession({
      onAudio: (frame) => api.realtimeAppendAudio(contactId, frame),
      onError: (failure) => { if (generationRef.current === generation) fail(failure); }
    });
    audioRef.current = audio;
    try {
      await audio.prepare();
      if (!mountedRef.current || generation !== generationRef.current) return;
      const next = await api.realtimeStart(contactId, { version: "v3", voice: voice || null });
      if (!mountedRef.current || generation !== generationRef.current) return;
      // /started can arrive before this IPC reply; preserve the newer connected state.
      setState((previous) => previous.status === "active" ? previous : next);
      if (next.status === "active") audio.setActive(true);
    } catch (failure) {
      if (mountedRef.current && generation === generationRef.current) fail(failure);
      else await audio.close();
    }
  }

  async function stop() {
    generationRef.current += 1;
    void audioRef.current?.close();
    audioRef.current = null;
    setState((previous) => ({ ...previous, status: "stopping", muted: false }));
    try {
      const next = await api.realtimeStop(contactId);
      if (mountedRef.current) setState(next);
    } catch (failure) {
      if (mountedRef.current) {
        setError(failure.message);
        setState((previous) => ({ ...previous, status: "error" }));
      }
    }
  }

  async function toggleMuted() {
    const muted = !state.muted;
    // The microphone track closes its input immediately, before waiting on IPC.
    audioRef.current?.setMuted(muted);
    try { setState(await api.realtimeMute(contactId, muted)); }
    catch (failure) { fail(failure); }
  }

  async function sendText(asSpeech) {
    const clean = text.trim();
    if (!clean || !connected || sendingText) return;
    setSendingText(true);
    try {
      if (asSpeech) await api.realtimeAppendSpeech(contactId, clean);
      else await api.realtimeAppendText(contactId, clean);
      if (mountedRef.current) setText("");
    } catch (failure) { if (mountedRef.current) setError(failure.message); }
    finally { if (mountedRef.current) setSendingText(false); }
  }

  return (
    <section className="realtime-panel" aria-label="Appel vocal Codex">
      <div className="realtime-heading">
        <img src="./icons/toolbar/voice.png" alt="" draggable="false" />
        <div><strong>Conversation vocale avec {contactName}</strong><span role="status">{statusLabels[state.status] ?? state.status}{state.muted && connected ? " · Micro coupé" : ""}</span></div>
        {onClose ? <button type="button" aria-label="Fermer l'appel vocal" onClick={() => { if (open) void stop(); onClose(); }}>×</button> : null}
      </div>
      <p className="realtime-help">L'appel utilise votre session Codex et le microphone de cet ordinateur.</p>
      <div className="realtime-controls">
        <button type="button" onClick={start} disabled={!available || open || loadingVoices || savingVoice} title="Démarrer ou terminer l'appel : F8">Démarrer l'appel</button>
        <button type="button" onClick={toggleMuted} disabled={!connected || !api?.realtimeMute}>{state.muted ? "Activer le micro" : "Couper le micro"}</button>
        <button type="button" onClick={stop} disabled={!available || !open || state.status === "stopping"} title="Démarrer ou terminer l'appel : F8">Terminer l'appel</button>
      </div>
      <div className="realtime-voices">
        <label>Voix <select value={voice} onChange={(event) => { setVoice(event.target.value); setVoiceMessage(""); }} disabled={open || loadingVoices || savingVoice}>
          <option value="">Auto · voix par défaut de Codex</option>
          {voices.map((name) => <option key={name} value={name}>{name}</option>)}
        </select></label>
        <button type="button" onClick={loadVoices} disabled={!available || (!api?.realtimeVoicePreference && !api?.realtimeListVoices) || open || loadingVoices || savingVoice}>{loadingVoices ? "Chargement…" : "Actualiser les voix"}</button>
        {api?.realtimeSetVoicePreference ? <button type="button" onClick={saveVoicePreference} disabled={!available || open || loadingVoices || savingVoice}>{savingVoice ? "Enregistrement…" : "Enregistrer la voix"}</button> : null}
      </div>
      {api?.realtimeSetVoicePreference ? <p className="realtime-help">Enregistrez ce choix dans vos réglages Codex pour les prochains appels. Auto rétablit la voix par défaut.</p> : null}
      {voiceMessage ? <p className="realtime-help" role="status">{voiceMessage}</p> : null}
      {!available ? <p className="realtime-error" role="alert">Les appels vocaux nécessitent la version desktop de Codex Messenger avec un serveur Codex récent.</p> : null}
      {error ? <p className="realtime-error" role="alert">{error}</p> : null}
      {transcript.entries.length ? <div className="realtime-transcript" ref={transcriptRef} aria-label="Transcription de l'appel">
        {transcript.entries.map((entry) => <p key={entry.id}><strong>{entry.role === "user" ? "Vous" : contactName} :</strong> {entry.text}{entry.complete ? "" : "…"}</p>)}
      </div> : null}
      <div className="realtime-text">
        <label htmlFor={`realtime-text-${contactId}`}>Texte pendant l'appel</label>
        <input id={`realtime-text-${contactId}`} value={text} maxLength={16000} onChange={(event) => setText(event.target.value)} disabled={!connected}
          onKeyDown={(event) => { if (shouldSubmitOnEnter(event)) { event.preventDefault(); void sendText(false); } }} />
        <div>
          <button type="button" onClick={() => sendText(false)} disabled={!connected || !text.trim() || sendingText || !api?.realtimeAppendText}>Envoyer à Codex</button>
          <button type="button" onClick={() => sendText(true)} disabled={!connected || !text.trim() || sendingText || !api?.realtimeAppendSpeech}>Faire prononcer</button>
        </div>
      </div>
    </section>
  );
}
