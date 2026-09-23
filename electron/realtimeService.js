import { assertObject, assertString } from "./security.js";

const realtimePrefix = "thread/realtime/";
const supportedVersions = new Set(["v1", "v2", "v3"]);

export function normalizeRealtimeVoicePreference(value, voices) {
  return typeof value === "string" && voices?.v1?.includes(value) ? value : null;
}

export function validateRealtimeAudio(value) {
  const audio = assertObject(value, "audio");
  const data = assertString(audio.data, "audio.data", { maxLength: 131072 });
  if (data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
    throw new Error("Microphone audio must be base64 PCM16");
  }
  const bytes = Buffer.from(data, "base64");
  if (bytes.toString("base64") !== data || bytes.length % 2 !== 0 || bytes.length === 0) {
    throw new Error("Microphone audio must contain complete PCM16 samples");
  }
  if (audio.sampleRate !== 24000 || audio.numChannels !== 1) {
    throw new Error("Microphone audio must be 24 kHz mono PCM16");
  }
  const samples = bytes.length / 2;
  if (samples > 48000 || (audio.samplesPerChannel != null && audio.samplesPerChannel !== samples)) {
    throw new Error("Invalid microphone audio sample count");
  }
  return { data, sampleRate: 24000, numChannels: 1, samplesPerChannel: samples };
}

export function describeRealtimeError(error) {
  const message = String(error?.message ?? error ?? "Unknown voice error");
  if (/unknown (method|variant)|method not found|experimental.*(disabled|enabled)|not supported/i.test(message)) {
    return `Les appels vocaux ne sont pas disponibles dans ce serveur Codex. Mettez Codex à jour. ${message}`;
  }
  if (/401|403|unauthori[sz]ed|forbidden|login|sign.in|authentication|access.*denied/i.test(message)) {
    return `Codex a refusé l'appel vocal. Vérifiez votre connexion et l'accès vocal de votre compte ChatGPT. ${message}`;
  }
  return `L'appel vocal Codex a échoué : ${message}`;
}

/** Thread-scoped app-server signaling. Audio is forwarded in memory and never written to disk. */
export class RealtimeService {
  sessions = new Map();
  voices = null;
  voicePreference = null;

  constructor({ codex, resolveContact, ensureThread, deliverEvent }) {
    this.codex = codex;
    this.resolveContact = resolveContact;
    this.ensureThread = ensureThread;
    this.deliverEvent = deliverEvent;
  }

  contact(contactId) {
    const id = assertString(contactId, "contactId", { maxLength: 200 });
    const contact = this.resolveContact(id);
    if (!contact) throw new Error("Contact introuvable");
    return contact;
  }

  publicState(session) {
    return {
      contactId: session.contactId,
      threadId: session.threadId ?? null,
      status: session.status,
      muted: Boolean(session.muted),
      realtimeSessionId: session.realtimeSessionId ?? null,
      version: session.version,
      voice: session.voice ?? null,
      error: session.error ?? null
    };
  }

  publish(session) {
    const state = this.publicState(session);
    this.deliverEvent(session.contactId, { method: "realtime/state", params: state });
    return state;
  }

  getState(contactId) {
    this.contact(contactId);
    return this.publicState(this.sessions.get(contactId) ?? { contactId, status: "idle", version: "v3" });
  }

  async listVoices() {
    await this.codex.ensureReady();
    try {
      const result = await this.codex.request(`${realtimePrefix}listVoices`, {});
      this.voices = result.voices;
      return result;
    } catch (error) {
      throw new Error(describeRealtimeError(error));
    }
  }

  async getVoicePreference() {
    await this.codex.ensureReady();
    const [available, result] = await Promise.all([
      this.listVoices(),
      this.codex.request("config/read", { includeLayers: false, cwd: null })
    ]);
    const configured = result.config?.realtime?.voice;
    const voice = normalizeRealtimeVoicePreference(configured, available.voices);
    const unavailable = configured != null && voice === null;
    this.voicePreference = {
      scope: "codexUser", voice, voices: available.voices, unavailable,
      note: unavailable ? "La voix enregistrée n'est plus proposée par Codex. Auto utilisera la voix par défaut du serveur." : null
    };
    return this.voicePreference;
  }

  async setVoicePreference(value) {
    if (value != null && value !== "") assertString(value, "voice", { maxLength: 40 });
    const available = await this.listVoices();
    const voice = normalizeRealtimeVoicePreference(value, available.voices);
    // A null leaf removes the user setting, as Codex's /voice settings does.
    const result = await this.codex.request("config/value/write", {
      keyPath: "realtime.voice", value: voice, mergeStrategy: "upsert",
      filePath: null, expectedVersion: null
    });
    const overridden = result.status === "okOverridden";
    const effective = overridden ? result.overriddenMetadata?.effectiveValue : voice;
    const actual = normalizeRealtimeVoicePreference(effective, available.voices);
    const unavailable = effective != null && actual === null;
    const message = overridden
      ? result.overriddenMetadata?.message ?? "Une règle de configuration Codex impose une autre voix."
      : "Voix enregistrée dans vos réglages utilisateur Codex pour les prochains appels.";
    this.voicePreference = {
      scope: "codexUser", voice: actual, voices: available.voices, unavailable,
      note: unavailable ? "La voix imposée n'est pas proposée pour cet appel. Auto utilisera la voix par défaut du serveur." : null
    };
    return { ...this.voicePreference, status: result.status, filePath: result.filePath, message };
  }

  async start(contactId, options = {}) {
    const contact = this.contact(contactId);
    assertObject(options, "options");
    const existing = this.sessions.get(contactId);
    if (existing && ["connecting", "active", "stopping"].includes(existing.status)) {
      throw new Error("Un appel vocal est déjà ouvert pour ce contact");
    }
    // A microphone belongs to one conversation at a time.
    if ([...this.sessions.values()].some((session) => ["connecting", "active", "stopping"].includes(session.status))) {
      throw new Error("Terminez l'appel vocal en cours avant d'appeler un autre contact");
    }
    const version = options.version ?? "v3";
    if (!supportedVersions.has(version)) throw new Error("Invalid realtime protocol version");
    const voice = options.voice == null || options.voice === "" ? null : assertString(options.voice, "voice", { maxLength: 40 });
    const session = { contactId, version, voice, status: "connecting", muted: false, cancelled: false };
    this.sessions.set(contactId, session);
    this.publish(session);
    session.startPromise = this.startSession(session, contact);
    return session.startPromise;
  }

  async startSession(session, contact) {
    try {
      await this.codex.ensureReady();
      session.threadId = await this.ensureThread(contact);
      if (typeof session.threadId !== "string" || !session.threadId) throw new Error("Codex n'a pas créé de conversation pour cet appel");
      if (session.cancelled) return this.publicState(session);
      if (!session.voice && this.voicePreference && (this.voicePreference.voice || this.voicePreference.unavailable)) {
        const voices = this.voices ?? (await this.listVoices()).voices;
        // Explicit Auto bypasses a previous or unavailable user voice for this call.
        const defaultVoice = session.version === "v2" ? voices?.defaultV2 : voices?.defaultV1;
        const available = session.version === "v2" ? voices?.v2 : voices?.v1;
        if (available?.includes(defaultVoice)) session.voice = defaultVoice;
        else throw new Error("Codex n'a pas fourni de voix par défaut disponible pour cet appel");
      }
      if (session.voice) {
        const voices = this.voices ?? (await this.listVoices()).voices;
        // Codex 0.155.1 intentionally shares the V1 voice set with V3.
        const available = session.version === "v2" ? voices?.v2 : voices?.v1;
        if (!available?.includes(session.voice)) throw new Error("Cette voix n'est pas disponible pour cet appel Codex");
      }
      if (session.cancelled) return this.publicState(session);
      session.requested = true;
      await this.codex.request(`${realtimePrefix}start`, {
        threadId: session.threadId,
        outputModality: "audio",
        transport: { type: "websocket" },
        version: session.version,
        voice: session.voice,
        includeStartupContext: true,
        clientManagedHandoffs: false
      });
      // The empty RPC response acknowledges the request; only /started proves connection.
      return this.publicState(session);
    } catch (error) {
      if (!session.cancelled) {
        session.status = "error";
        session.error = describeRealtimeError(error);
        this.publish(session);
      }
      throw new Error(describeRealtimeError(error));
    }
  }

  async stop(contactId) {
    this.contact(contactId);
    const session = this.sessions.get(contactId);
    if (!session) return this.getState(contactId);
    if (session.stopPromise) return session.stopPromise;
    if (session.status === "idle" && !session.requested) return this.publicState(session);
    session.cancelled = true;
    session.status = "stopping";
    this.publish(session);
    session.stopPromise = this.stopSession(session).finally(() => { session.stopPromise = null; });
    return session.stopPromise;
  }

  async stopSession(session) {
    try {
      await session.startPromise?.catch(() => {});
      if (session.requested && session.threadId && this.codex.child !== null) {
        await this.codex.request(`${realtimePrefix}stop`, { threadId: session.threadId });
      }
      session.requested = false;
      session.status = "idle";
      session.muted = false;
      session.error = null;
      return this.publish(session);
    } catch (error) {
      session.status = "error";
      session.error = describeRealtimeError(error);
      this.publish(session);
      throw new Error(session.error);
    }
  }

  activeSession(contactId) {
    this.contact(contactId);
    const session = this.sessions.get(contactId);
    if (session?.status !== "active") throw new Error("L'appel vocal Codex n'est pas connecté");
    return session;
  }

  setMuted(contactId, muted) {
    const session = this.activeSession(contactId);
    if (typeof muted !== "boolean") throw new Error("muted must be a boolean");
    session.muted = muted;
    return this.publish(session);
  }

  async appendAudio(contactId, audio) {
    const session = this.activeSession(contactId);
    const clean = validateRealtimeAudio(audio);
    if (session.muted) return { muted: true };
    return this.codex.request(`${realtimePrefix}appendAudio`, { threadId: session.threadId, audio: clean });
  }

  appendText(contactId, text) {
    const session = this.activeSession(contactId);
    return this.codex.request(`${realtimePrefix}appendText`, {
      threadId: session.threadId, text: assertString(text, "text", { maxLength: 16000 }), role: "user"
    });
  }

  appendSpeech(contactId, text) {
    const session = this.activeSession(contactId);
    return this.codex.request(`${realtimePrefix}appendSpeech`, {
      threadId: session.threadId, text: assertString(text, "text", { maxLength: 16000 })
    });
  }

  onNotification(message) {
    if (!message.method?.startsWith(realtimePrefix)) return false;
    const session = [...this.sessions.values()].find((entry) => entry.threadId === message.params?.threadId);
    if (!session) return false;
    if (message.method === `${realtimePrefix}started`) {
      if (!session.cancelled) session.status = "active";
      session.realtimeSessionId = message.params.realtimeSessionId;
      session.version = message.params.version ?? session.version;
      this.publish(session);
    } else if (message.method === `${realtimePrefix}closed`) {
      session.status = "idle";
      session.muted = false;
      session.requested = false;
      this.publish(session);
    } else if (message.method === `${realtimePrefix}error`) {
      session.status = "error";
      session.error = describeRealtimeError(message.params.message);
      this.publish(session);
    }
    this.deliverEvent(session.contactId, message);
    if (message.method === `${realtimePrefix}error`) void this.stop(session.contactId).catch(() => {});
    return true;
  }

  onStatus(status) {
    if (!["exit", "error", "stopped"].includes(status?.kind)) return;
    this.voices = null;
    this.voicePreference = null;
    for (const session of this.sessions.values()) {
      if (!["connecting", "active", "stopping"].includes(session.status)) continue;
      session.cancelled = true;
      session.status = "error";
      session.error = describeRealtimeError(status.text ?? "Le serveur Codex s'est arrêté");
      this.publish(session);
    }
  }

  async dispose() {
    await Promise.allSettled([...this.sessions.values()].filter((session) => ["connecting", "active", "stopping"].includes(session.status))
      .map((session) => this.stop(session.contactId)));
    this.sessions.clear();
  }
}

export function registerRealtimeIpcHandlers({ ipcMain, service }) {
  ipcMain.handle("realtime:list-voices", () => service.listVoices());
  ipcMain.handle("realtime:voice-preference", () => service.getVoicePreference());
  ipcMain.handle("realtime:set-voice-preference", (_event, voice) => service.setVoicePreference(voice));
  ipcMain.handle("realtime:state", (_event, contactId) => service.getState(contactId));
  ipcMain.handle("realtime:start", (_event, contactId, options = {}) => service.start(contactId, options));
  ipcMain.handle("realtime:stop", (_event, contactId) => service.stop(contactId));
  ipcMain.handle("realtime:mute", (_event, contactId, muted) => service.setMuted(contactId, muted));
  ipcMain.handle("realtime:append-audio", (_event, contactId, audio) => service.appendAudio(contactId, audio));
  ipcMain.handle("realtime:append-text", (_event, contactId, text) => service.appendText(contactId, text));
  ipcMain.handle("realtime:append-speech", (_event, contactId, text) => service.appendSpeech(contactId, text));
}
