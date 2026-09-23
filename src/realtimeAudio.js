export const realtimeSampleRate = 24000;

function encodeBytes(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary);
}

export function encodePcm16(samples, sampleRate = realtimeSampleRate) {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Number.isFinite(samples[index]) ? Math.max(-1, Math.min(1, samples[index])) : 0;
    view.setInt16(index * 2, Math.round(sample < 0 ? sample * 32768 : sample * 32767), true);
  }
  return { data: encodeBytes(bytes), sampleRate, numChannels: 1, samplesPerChannel: samples.length };
}

export function decodePcm16(audio) {
  if (!audio || !Number.isInteger(audio.numChannels) || audio.numChannels < 1 || audio.numChannels > 8
      || !Number.isInteger(audio.sampleRate) || audio.sampleRate < 8000 || audio.sampleRate > 192000
      || typeof audio.data !== "string" || audio.data.length > 1048576
      || audio.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(audio.data)) {
    throw new Error("Codex a envoyé un format audio invalide");
  }
  const binary = atob(audio.data);
  if (!binary.length || binary.length % (audio.numChannels * 2) !== 0) throw new Error("L'audio Codex contient un échantillon incomplet");
  const samples = binary.length / (audio.numChannels * 2);
  if (audio.samplesPerChannel != null && audio.samplesPerChannel !== samples) throw new Error("La taille de l'audio Codex est invalide");
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  const view = new DataView(bytes.buffer);
  const channels = Array.from({ length: audio.numChannels }, () => new Float32Array(samples));
  for (let index = 0; index < samples; index += 1) {
    for (let channel = 0; channel < audio.numChannels; channel += 1) {
      channels[channel][index] = view.getInt16((index * audio.numChannels + channel) * 2, true) / 32768;
    }
  }
  return { channels, sampleRate: audio.sampleRate, samples };
}

/** A continuous box-filter resampler; fractional input samples survive worklet boundaries. */
export class StreamingPcmEncoder {
  constructor(sourceRate, frameSamples = 2400) {
    if (!Number.isFinite(sourceRate) || sourceRate < 8000 || sourceRate > 192000
        || !Number.isInteger(frameSamples) || frameSamples < 1 || frameSamples > 48000) {
      throw new Error("Invalid PCM sample rate or frame size");
    }
    this.ratio = sourceRate / realtimeSampleRate;
    this.frameSamples = frameSamples;
    this.reset();
  }

  reset() {
    this.remaining = this.ratio;
    this.weighted = 0;
    this.frame = new Float32Array(this.frameSamples);
    this.count = 0;
  }

  append(input) {
    const frames = [];
    for (const value of input) {
      const sample = Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
      let inputRemaining = 1;
      while (inputRemaining > 1e-9) {
        const weight = Math.min(inputRemaining, this.remaining);
        this.weighted += sample * weight;
        this.remaining -= weight;
        inputRemaining -= weight;
        if (this.remaining <= 1e-9) {
          this.frame[this.count++] = this.weighted / this.ratio;
          this.weighted = 0;
          this.remaining = this.ratio;
          if (this.count === this.frameSamples) {
            frames.push(encodePcm16(this.frame));
            this.frame = new Float32Array(this.frameSamples);
            this.count = 0;
          }
        }
      }
    }
    return frames;
  }
}

export function describeMicrophoneError(error) {
  if (["NotAllowedError", "SecurityError"].includes(error?.name)) {
    return "L'accès au microphone a été refusé. Autorisez Codex Messenger dans les réglages de confidentialité, puis relancez l'appel.";
  }
  if (["NotFoundError", "DevicesNotFoundError"].includes(error?.name)) return "Aucun microphone n'est disponible sur cet ordinateur.";
  if (["NotReadableError", "TrackStartError"].includes(error?.name)) return "Le microphone est occupé ou ne peut pas être ouvert.";
  return error?.message ?? String(error);
}

/** Browser microphone capture and PCM playback. Nothing is persisted or uploaded outside Codex. */
export class RealtimeAudioSession {
  constructor({ onAudio, onError, environment = globalThis, workletUrl = new URL("./realtimePcmProcessor.js", globalThis.document?.baseURI ?? import.meta.url).href }) {
    this.environment = environment;
    this.workletUrl = workletUrl;
    this.onAudio = onAudio;
    this.onError = onError;
    this.sources = new Set();
    this.active = false;
    this.muted = false;
    this.closed = false;
    this.generation = 0;
    this.captureEpoch = 0;
    this.pendingFrames = 0;
    this.sendQueue = Promise.resolve();
  }

  prepare() {
    if (this.closed) return Promise.resolve();
    this.preparePromise ??= this.prepareCapture();
    return this.preparePromise;
  }

  async prepareCapture() {
    const { navigator, AudioContext, AudioWorkletNode } = this.environment;
    if (!navigator?.mediaDevices?.getUserMedia || !AudioContext || !AudioWorkletNode) {
      throw new Error("Cet environnement ne permet pas d'ouvrir un microphone pour un appel vocal.");
    }
    const generation = ++this.generation;
    const context = new AudioContext({ sampleRate: realtimeSampleRate, latencyHint: "interactive" });
    this.context = context;
    const cancelled = () => this.closed || generation !== this.generation;
    try {
      await context.resume();
      if (cancelled()) return;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false
      });
      if (cancelled()) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      this.stream = stream;
      for (const track of stream.getAudioTracks()) {
        track.enabled = !this.muted;
        track.addEventListener("ended", () => {
          if (!cancelled()) this.fail(new Error("Le microphone a été déconnecté."));
        }, { once: true });
      }
      await context.audioWorklet.addModule(this.workletUrl);
      if (cancelled()) return;
      this.encoder = new StreamingPcmEncoder(context.sampleRate);
      this.input = context.createMediaStreamSource(stream);
      this.processor = new AudioWorkletNode(context, "codex-messenger-pcm", { numberOfInputs: 1, numberOfOutputs: 1 });
      this.silence = context.createGain();
      this.silence.gain.value = 0;
      this.processor.port.onmessage = ({ data }) => {
        if (cancelled() || !this.active || this.muted) return;
        for (const frame of this.encoder.append(data)) this.send(frame);
      };
      this.processor.onprocessorerror = () => {
        if (!cancelled()) this.fail(new Error("La capture audio s'est arrêtée."));
      };
      this.input.connect(this.processor);
      this.processor.connect(this.silence);
      this.silence.connect(context.destination);
    } catch (error) {
      if (cancelled()) return;
      await this.close();
      throw error;
    }
  }

  setActive(active) {
    const next = Boolean(active);
    if (this.active !== next) this.captureEpoch += 1;
    this.active = next;
    this.encoder?.reset();
  }

  setMuted(muted) {
    const next = Boolean(muted);
    if (this.muted !== next) this.captureEpoch += 1;
    this.muted = next;
    this.encoder?.reset();
    for (const track of this.stream?.getAudioTracks() ?? []) track.enabled = !this.muted;
  }

  send(frame) {
    if (this.closed || !this.active || this.muted) return;
    if (this.pendingFrames >= 50) {
      this.fail(new Error("La connexion Codex retient plus de cinq secondes de microphone. Relancez l'appel."));
      return;
    }
    const epoch = this.captureEpoch;
    this.pendingFrames += 1;
    this.sendQueue = this.sendQueue.then(async () => {
      if (!this.closed && this.active && !this.muted && epoch === this.captureEpoch) await this.onAudio(frame);
    }).catch((error) => this.fail(error)).finally(() => { this.pendingFrames -= 1; });
  }

  play(audio) {
    const context = this.context;
    if (this.closed || !context) return;
    if (context.state === "suspended" && !this.playbackResume) {
      const generation = this.generation;
      this.playbackResume = Promise.resolve(context.resume()).catch((error) => {
        if (!this.closed && generation === this.generation) this.fail(error);
      }).finally(() => { this.playbackResume = null; });
    }
    const { channels, samples, sampleRate } = decodePcm16(audio);
    const buffer = context.createBuffer(channels.length, samples, sampleRate);
    channels.forEach((channel, index) => buffer.copyToChannel(channel, index));
    const startsAt = Math.max(context.currentTime + 0.02, this.nextPlaybackTime ?? 0);
    if (startsAt + buffer.duration - context.currentTime > 120) throw new Error("La file de lecture vocale Codex est pleine.");
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    this.nextPlaybackTime = startsAt + buffer.duration;
    this.sources.add(source);
    source.onended = () => { this.sources.delete(source); source.disconnect(); };
    source.start(startsAt);
  }

  interruptPlayback() {
    for (const source of this.sources) {
      try { source.stop(); } catch { /* Already stopped. */ }
      try { source.disconnect(); } catch { /* Already disconnected. */ }
    }
    this.sources.clear();
    this.nextPlaybackTime = 0;
  }

  fail(error) {
    if (this.closed) return;
    void this.close();
    this.onError?.(error);
  }

  close() {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    this.active = false;
    this.generation += 1;
    this.captureEpoch += 1;
    for (const track of this.stream?.getTracks() ?? []) {
      try { track.stop(); } catch { /* Keep releasing the remaining resources. */ }
    }
    if (this.processor) {
      this.processor.port.onmessage = null;
      this.processor.onprocessorerror = null;
      try { this.processor.port.close(); } catch { /* Already closed. */ }
    }
    for (const node of [this.processor, this.input, this.silence]) {
      try { node?.disconnect(); } catch { /* Already disconnected. */ }
    }
    this.interruptPlayback();
    this.encoder?.reset();
    const context = this.context;
    this.stream = null;
    this.context = null;
    this.processor = null;
    this.input = null;
    this.silence = null;
    this.closePromise = Promise.resolve().then(() => context?.close()).catch(() => {});
    return this.closePromise;
  }
}
