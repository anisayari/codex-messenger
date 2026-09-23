import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { RealtimeService, registerRealtimeIpcHandlers, validateRealtimeAudio, describeRealtimeError } from "../electron/realtimeService.js";
import { encodePcm16, decodePcm16, StreamingPcmEncoder, RealtimeAudioSession, describeMicrophoneError } from "../src/realtimeAudio.js";
import { initialRealtimeTranscript, reduceRealtimeTranscript } from "../src/realtimeTranscript.js";
import { isRealtimeCallShortcut } from "../src/realtimeShortcut.js";

function serviceFixture({ ensureThread = async () => "thread-1", request } = {}) {
  const requests = [];
  const events = [];
  const codex = {
    child: {}, ensureReady: async () => {},
    request: async (method, params) => {
      requests.push({ method, params });
      if (request) return request(method, params);
      if (method === "thread/realtime/listVoices") return { voices: { v1: ["cedar"], v2: ["verse"], defaultV1: "cedar", defaultV2: "verse" } };
      return {};
    }
  };
  const service = new RealtimeService({
    codex, resolveContact: (id) => ["alice", "bob"].includes(id) ? { id } : null,
    ensureThread, deliverEvent: (contactId, message) => events.push({ contactId, message })
  });
  const activate = () => service.onNotification({ method: "thread/realtime/started", params: { threadId: "thread-1", realtimeSessionId: "voice-1", version: "v3" } });
  return { service, codex, requests, events, activate };
}

test("realtime uses exact V3 websocket contract and waits for the connected notification", async () => {
  const { service, requests, activate } = serviceFixture();
  const state = await service.start("alice");
  assert.equal(state.status, "connecting");
  assert.deepEqual(requests[0], {
    method: "thread/realtime/start", params: {
      threadId: "thread-1", outputModality: "audio", transport: { type: "websocket" }, version: "v3", voice: null,
      includeStartupContext: true, clientManagedHandoffs: false
    }
  });
  await assert.rejects(service.appendAudio("alice", encodePcm16([0])), /n'est pas connecté/);
  assert.equal(activate(), true);
  assert.equal(service.getState("alice").status, "active");
  assert.equal(service.getState("alice").realtimeSessionId, "voice-1");
  await service.appendAudio("alice", encodePcm16([0, .5]));
  assert.equal(requests.at(-1).method, "thread/realtime/appendAudio");
  assert.equal(requests.at(-1).params.audio.samplesPerChannel, 2);
  service.setMuted("alice", true);
  const count = requests.length;
  assert.deepEqual(await service.appendAudio("alice", encodePcm16([0])), { muted: true });
  assert.equal(requests.length, count);
  await service.appendText("alice", "Bonjour");
  assert.deepEqual(requests.at(-1), { method: "thread/realtime/appendText", params: { threadId: "thread-1", text: "Bonjour", role: "user" } });
  await service.appendSpeech("alice", "Salut");
  assert.deepEqual(requests.at(-1), { method: "thread/realtime/appendSpeech", params: { threadId: "thread-1", text: "Salut" } });
  assert.equal((await service.stop("alice")).status, "idle");
  assert.deepEqual(requests.at(-1), { method: "thread/realtime/stop", params: { threadId: "thread-1" } });
});

test("V3 validates voices against the actual V1 voice list and enforces one call", async () => {
  const { service, requests } = serviceFixture();
  await assert.rejects(service.start("alice", { voice: "verse" }), /n'est pas disponible/);
  assert.equal(requests.some((entry) => entry.method === "thread/realtime/start"), false);
  await service.start("alice", { voice: "cedar" });
  assert.equal(requests.at(-1).params.voice, "cedar");
  await assert.rejects(service.start("alice"), /déjà ouvert/);
  await assert.rejects(service.start("bob"), /Terminez l'appel/);
  await service.stop("alice");
  await assert.rejects(service.start("unknown"), /Contact introuvable/);
  await assert.rejects(service.start("alice", { version: "invented" }), /protocol version/);
});

test("stop cancels a pending thread lookup before microphone transport starts", async () => {
  let resolveThread;
  const { service, requests } = serviceFixture({ ensureThread: () => new Promise((resolve) => { resolveThread = resolve; }) });
  const starting = service.start("alice");
  await Promise.resolve();
  const stopping = service.stop("alice");
  resolveThread("thread-1");
  await starting;
  assert.equal((await stopping).status, "idle");
  assert.equal(requests.length, 0);
});

test("realtime events stay scoped to a known call and server loss releases call state", async () => {
  const { service, events, activate } = serviceFixture();
  await service.start("alice");
  assert.equal(service.onNotification({ method: "thread/realtime/outputAudio/delta", params: { threadId: "another-thread", audio: {} } }), false);
  activate();
  service.onStatus({ kind: "exit", text: "Server disconnected" });
  assert.equal(service.getState("alice").status, "error");
  assert.match(service.getState("alice").error, /Server disconnected/);
  assert.equal(events.every((event) => event.contactId === "alice"), true);
});

test("a Codex voice error cleans the remote session and concurrent stops send one request", async () => {
  let finishStop;
  let beganStop;
  const stopBegan = new Promise((resolve) => { beganStop = resolve; });
  const { service, requests, activate } = serviceFixture({ request: async (method) => {
    if (method === "thread/realtime/stop") {
      beganStop();
      await new Promise((resolve) => { finishStop = resolve; });
    }
    return {};
  } });
  await service.start("alice");
  activate();
  service.onNotification({ method: "thread/realtime/error", params: { threadId: "thread-1", message: "upstream boom" } });
  const stopAgain = service.stop("alice");
  await stopBegan;
  assert.equal(requests.filter((entry) => entry.method === "thread/realtime/stop").length, 1);
  finishStop();
  assert.equal((await stopAgain).status, "idle");
  await service.stop("alice");
  assert.equal(requests.filter((entry) => entry.method === "thread/realtime/stop").length, 1);
});

test("microphone frames reject corrupt base64, wrong sample rates, stereo and inconsistent lengths", () => {
  const valid = encodePcm16([-.5, 0, .5]);
  assert.deepEqual(validateRealtimeAudio(valid), valid);
  for (const audio of [
    { ...valid, data: "!!!!" }, { ...valid, data: "AA==" }, { ...valid, data: "AB==" },
    { ...valid, data: "" }, { ...valid, sampleRate: 48000 }, { ...valid, numChannels: 2 },
    { ...valid, samplesPerChannel: 4 }, { ...valid, data: Buffer.alloc(96002).toString("base64") }
  ]) assert.throws(() => validateRealtimeAudio(audio));
});

test("unavailable and unauthorized voice errors explain the actual Codex limitation", () => {
  assert.match(describeRealtimeError(new Error("Method not found")), /Mettez Codex à jour/);
  assert.match(describeRealtimeError(new Error("401 Unauthorized")), /compte ChatGPT/);
  assert.match(describeRealtimeError(new Error("upstream closed")), /upstream closed/);
  assert.match(describeMicrophoneError({ name: "NotAllowedError" }), /confidentialité/);
  assert.match(describeMicrophoneError({ name: "NotFoundError" }), /Aucun microphone/);
});

test("realtime IPC maps only the verified request endpoints", async () => {
  const handlers = new Map();
  const { service } = serviceFixture();
  registerRealtimeIpcHandlers({ ipcMain: { handle: (channel, callback) => handlers.set(channel, callback) }, service });
  assert.deepEqual([...handlers.keys()].sort(), ["realtime:append-audio", "realtime:append-speech", "realtime:append-text", "realtime:list-voices", "realtime:mute", "realtime:set-voice-preference", "realtime:start", "realtime:state", "realtime:stop", "realtime:voice-preference"]);
  assert.equal(handlers.get("realtime:state")({}, "alice").status, "idle");
  assert.deepEqual((await handlers.get("realtime:list-voices")({})).voices.v1, ["cedar"]);
});

test("PCM encoding clips finite samples and reads little endian interleaved channels", () => {
  const encoded = encodePcm16([-2, -1, 0, .5, 1, 2, NaN]);
  const bytes = Buffer.from(encoded.data, "base64");
  assert.deepEqual(Array.from({ length: 7 }, (_, index) => bytes.readInt16LE(index * 2)), [-32768, -32768, 0, 16384, 32767, 32767, 0]);
  const decoded = decodePcm16({ data: Buffer.from([0, 128, 255, 127, 0, 0, 0, 64]).toString("base64"), sampleRate: 24000, numChannels: 2, samplesPerChannel: 2 });
  assert.deepEqual([...decoded.channels[0]], [-1, 0]);
  assert.equal(decoded.channels[1][0], 32767 / 32768);
  assert.equal(decoded.channels[1][1], .5);
  assert.throws(() => decodePcm16({ ...encoded, samplesPerChannel: 3 }), /taille/);
  assert.throws(() => decodePcm16({ ...encoded, data: "!!!!" }), /format/);
});

test("PCM resampling preserves fractional timing across input chunk boundaries", () => {
  const input = Float32Array.from({ length: 4410 }, (_, index) => Math.sin(index / 16) * .7);
  const whole = new StreamingPcmEncoder(44100, 240).append(input);
  const chunkedEncoder = new StreamingPcmEncoder(44100, 240);
  const chunked = [];
  for (let index = 0; index < input.length; index += 127) chunked.push(...chunkedEncoder.append(input.subarray(index, index + 127)));
  assert.equal(whole.length, 10);
  assert.deepEqual(chunked, whole);
  const silence = new StreamingPcmEncoder(48000, 2400).append(new Float32Array(4800));
  assert.equal(silence.length, 1);
  assert.equal(silence[0].samplesPerChannel, 2400);
});

function fakeAudioEnvironment({ getUserMedia, resume, addModule } = {}) {
  const track = { enabled: true, stopped: 0, addEventListener() {}, stop() { this.stopped += 1; } };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const sources = [];
  const contexts = [];
  const connection = () => ({ connect() {}, disconnect() {} });
  class Context {
    constructor() { this.sampleRate = 48000; this.currentTime = 100; this.destination = {}; this.closed = false; this.audioWorklet = { addModule: addModule ?? (async () => {}) }; contexts.push(this); }
    resume() { return resume ? resume() : Promise.resolve(); }
    async close() { this.closed = true; }
    createMediaStreamSource() { return connection(); }
    createGain() { return { ...connection(), gain: {} }; }
    createBuffer(channels, samples, sampleRate) { return { duration: samples / sampleRate, copyToChannel() {} }; }
    createBufferSource() { const source = { ...connection(), start(time) { this.startsAt = time; }, stop() { this.stopped = true; } }; sources.push(source); return source; }
  }
  class Worklet { constructor() { this.port = { close() {} }; } connect() {} disconnect() {} }
  return { environment: { AudioContext: Context, AudioWorkletNode: Worklet, navigator: { mediaDevices: { getUserMedia: getUserMedia ?? (async () => stream) } } }, track, stream, sources, contexts };
}

test("browser audio captures PCM, immediately mutes the real track and schedules contiguous playback", async () => {
  const { environment, track, contexts, sources } = fakeAudioEnvironment();
  const frames = [];
  const audio = new RealtimeAudioSession({ environment, onAudio: async (frame) => frames.push(frame), onError: assert.fail });
  await audio.prepare();
  audio.setActive(true);
  audio.processor.port.onmessage({ data: new Float32Array(4800).fill(.25) });
  await audio.sendQueue;
  assert.equal(frames.length, 1);
  assert.equal(frames[0].sampleRate, 24000);
  audio.setMuted(true);
  assert.equal(track.enabled, false);
  audio.processor.port.onmessage({ data: new Float32Array(4800) });
  await audio.sendQueue;
  assert.equal(frames.length, 1);
  audio.play(encodePcm16(new Float32Array(2400)));
  audio.play(encodePcm16(new Float32Array(2400)));
  assert.equal(sources[0].startsAt, 100.02);
  assert.ok(Math.abs(sources[1].startsAt - 100.12) < 1e-8);
  audio.interruptPlayback();
  assert.equal(sources.every((source) => source.stopped), true);
  await audio.close();
  await audio.close();
  assert.equal(track.stopped, 1);
  assert.equal(contexts[0].closed, true);
});

test("closing a call during the microphone permission prompt stops a late acquired microphone", async () => {
  let grant;
  const fixture = fakeAudioEnvironment({ getUserMedia: () => new Promise((resolve) => { grant = resolve; }) });
  const audio = new RealtimeAudioSession({ environment: fixture.environment, onAudio: assert.fail });
  const preparing = audio.prepare();
  await Promise.resolve();
  await audio.close();
  grant(fixture.stream);
  await preparing;
  assert.equal(fixture.track.stopped, 1);
  assert.equal(fixture.contexts[0].closed, true);
});


test("closing during asynchronous audio setup releases resources without starting a late capture", async () => {
  let finishResume;
  let microphoneRequests = 0;
  const resuming = new Promise((resolve) => { finishResume = resolve; });
  const resumeFixture = fakeAudioEnvironment({
    resume: () => resuming,
    getUserMedia: async () => { microphoneRequests += 1; return resumeFixture.stream; }
  });
  const beforeMicrophone = new RealtimeAudioSession({ environment: resumeFixture.environment, onAudio: assert.fail, onError: assert.fail });
  const resumePreparing = beforeMicrophone.prepare();
  await beforeMicrophone.close();
  finishResume();
  await resumePreparing;
  assert.equal(microphoneRequests, 0);
  assert.equal(resumeFixture.contexts[0].closed, true);
  assert.equal(beforeMicrophone.processor, null);

  let finishModule;
  let beganModule;
  const moduleStarted = new Promise((resolve) => { beganModule = resolve; });
  const loadingModule = new Promise((resolve) => { finishModule = resolve; });
  const moduleFixture = fakeAudioEnvironment({ addModule: () => { beganModule(); return loadingModule; } });
  const beforeWorklet = new RealtimeAudioSession({ environment: moduleFixture.environment, onAudio: assert.fail, onError: assert.fail });
  const modulePreparing = beforeWorklet.prepare();
  await moduleStarted;
  await beforeWorklet.close();
  finishModule();
  await modulePreparing;
  assert.equal(moduleFixture.track.stopped, 1);
  assert.equal(moduleFixture.contexts[0].closed, true);
  assert.equal(beforeWorklet.processor, null);
});

test("a worklet startup failure releases the microphone and context exactly once", async () => {
  const fixture = fakeAudioEnvironment({ addModule: async () => { throw new Error("worklet load failed"); } });
  const audio = new RealtimeAudioSession({ environment: fixture.environment, onAudio: assert.fail, onError: assert.fail });
  await assert.rejects(audio.prepare(), /worklet load failed/);
  assert.equal(audio.closed, true);
  assert.equal(fixture.track.stopped, 1);
  assert.equal(fixture.contexts[0].closed, true);
  await audio.close();
  assert.equal(fixture.track.stopped, 1);
});

test("audio congestion closes the microphone instead of retaining an unbounded recording", async () => {
  const { environment, track } = fakeAudioEnvironment();
  const errors = [];
  const sent = [];
  const audio = new RealtimeAudioSession({ environment, onAudio: async (frame) => sent.push(frame), onError: (error) => errors.push(error) });
  await audio.prepare();
  audio.setActive(true);
  audio.processor.port.onmessage({ data: new Float32Array(264000) });
  await audio.sendQueue;
  assert.equal(audio.closed, true);
  assert.equal(track.stopped, 1);
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /cinq secondes/);
  assert.equal(sent.length, 0);
});

test("audio worklet averages input channels and sends complete float frames", async () => {
  const source = await readFile(new URL("../public/realtimePcmProcessor.js", import.meta.url), "utf8");
  let Processor;
  const frames = [];
  vm.runInNewContext(source, {
    AudioWorkletProcessor: class { constructor() { this.port = { postMessage: (frame) => frames.push(frame) }; } },
    registerProcessor(name, value) { assert.equal(name, "codex-messenger-pcm"); Processor = value; }
  });
  const processor = new Processor();
  assert.equal(processor.process([[new Float32Array(1024).fill(1), new Float32Array(1024).fill(0)]]), true);
  assert.equal(frames.length, 0);
  processor.process([[new Float32Array(1024).fill(1), new Float32Array(1024).fill(0)]]);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].length, 2048);
  assert.equal(frames[0].every((sample) => sample === .5), true);
});

test("canonical voice transcripts replace compatibility streams without duplicate speech", () => {
  let state = reduceRealtimeTranscript(initialRealtimeTranscript, { method: "thread/realtime/transcript/delta", params: { role: "user", delta: "Bon" } });
  state = reduceRealtimeTranscript(state, { method: "thread/realtime/transcript/done", params: { role: "user", text: "Bonjour" } });
  assert.equal(state.entries[0].text, "Bonjour");
  state = reduceRealtimeTranscript(state, { method: "thread/realtime/item/started", params: { item: { type: "transcriptSegment", id: "item-1", role: "user", text: "" } } });
  state = reduceRealtimeTranscript(state, { method: "thread/realtime/item/transcript/delta", params: { itemId: "item-1", delta: "Bonjour" } });
  state = reduceRealtimeTranscript(state, { method: "thread/realtime/transcript/done", params: { role: "user", text: "Bonjour" } });
  state = reduceRealtimeTranscript(state, { method: "thread/realtime/item/completed", params: { item: { type: "transcriptSegment", id: "item-1", role: "user", text: "Bonjour" } } });
  assert.equal(state.entries.length, 1);
  assert.equal(state.entries[0].text, "Bonjour");
  assert.equal(state.entries[0].complete, true);
});


test("short microphone transport bursts preserve every unmuted PCM frame", async () => {
  const { environment, track } = fakeAudioEnvironment();
  let release;
  let began;
  const held = new Promise((resolve) => { release = resolve; });
  const firstFrame = new Promise((resolve) => { began = resolve; });
  const sent = [];
  const audio = new RealtimeAudioSession({ environment, onError: assert.fail, onAudio: async (frame) => {
    sent.push(frame);
    if (sent.length === 1) { began(); await held; }
  } });
  await audio.prepare();
  audio.setActive(true);
  audio.processor.port.onmessage({ data: new Float32Array(144000).fill(.25) });
  await firstFrame;
  assert.equal(audio.closed, false);
  assert.equal(audio.pendingFrames, 30);
  release();
  await audio.sendQueue;
  assert.equal(sent.length, 30);
  assert.equal(sent.every((frame) => frame.data === sent[0].data), true);
  assert.equal(track.stopped, 0);
  await audio.close();
});

test("rapid mute and unmute never replay microphone frames captured before mute", async () => {
  const { environment, track } = fakeAudioEnvironment();
  let release;
  let began;
  const held = new Promise((resolve) => { release = resolve; });
  const firstFrame = new Promise((resolve) => { began = resolve; });
  const sent = [];
  const audio = new RealtimeAudioSession({ environment, onError: assert.fail, onAudio: async (frame) => {
    sent.push(frame);
    if (sent.length === 1) { began(); await held; }
  } });
  await audio.prepare();
  audio.setActive(true);
  audio.processor.port.onmessage({ data: new Float32Array(14400).fill(.25) });
  await firstFrame;
  audio.setMuted(true);
  assert.equal(track.enabled, false);
  audio.setMuted(false);
  assert.equal(track.enabled, true);
  release();
  await audio.sendQueue;
  assert.equal(sent.length, 1);
  audio.processor.port.onmessage({ data: new Float32Array(4800).fill(.5) });
  await audio.sendQueue;
  assert.equal(sent.length, 2);
  assert.notEqual(sent[1].data, sent[0].data);
  await audio.close();
});

test("a paused playback clock retains a forty second incoming speech burst in order", async () => {
  const { environment, contexts, sources } = fakeAudioEnvironment();
  const audio = new RealtimeAudioSession({ environment, onAudio: assert.fail, onError: assert.fail });
  await audio.prepare();
  let resumes = 0;
  contexts[0].state = "suspended";
  contexts[0].resume = async () => { resumes += 1; };
  const speech = encodePcm16(new Float32Array(24000).fill(.25));
  for (let index = 0; index < 40; index += 1) audio.play(speech);
  assert.equal(resumes, 1);
  assert.equal(sources.length, 40);
  assert.equal(audio.sources.size, 40);
  sources.forEach((source, index) => assert.ok(Math.abs(source.startsAt - (100.02 + index)) < 1e-8));
  assert.equal(sources.some((source) => source.stopped), false);
  await audio.close();
  assert.equal(sources.every((source) => source.stopped), true);
});

test("the official F8 call shortcut yields to repeats, modifiers and handled shortcuts", () => {
  assert.equal(isRealtimeCallShortcut({ key: "F8" }), true);
  for (const property of ["repeat", "defaultPrevented", "altKey", "ctrlKey", "metaKey", "shiftKey"]) {
    assert.equal(isRealtimeCallShortcut({ key: "F8", [property]: true }), false);
  }
  assert.equal(isRealtimeCallShortcut({ key: "F7" }), false);
});


test("voice preference reads the public Codex user setting and writes only its leaf", async () => {
  const voices = { v1: ["cedar", "marin"], v2: ["verse"], defaultV1: "cedar", defaultV2: "verse" };
  const { service, requests } = serviceFixture({ request: async (method) => {
    if (method === "thread/realtime/listVoices") return { voices };
    if (method === "config/read") return { config: { realtime: { voice: "marin" }, model: "user-choice" } };
    if (method === "config/value/write") return { status: "ok", filePath: "/user/.codex/config.toml", version: "2" };
    return {};
  } });
  const preference = await service.getVoicePreference();
  assert.equal(preference.scope, "codexUser");
  assert.equal(preference.voice, "marin");
  assert.equal(preference.unavailable, false);
  assert.deepEqual(requests.find((entry) => entry.method === "config/read").params, { includeLayers: false, cwd: null });
  assert.equal((await service.setVoicePreference("marin")).voice, "marin");
  assert.deepEqual(requests.at(-1), { method: "config/value/write", params: {
    keyPath: "realtime.voice", value: "marin", mergeStrategy: "upsert", filePath: null, expectedVersion: null
  } });
  assert.equal((await service.setVoicePreference(null)).voice, null);
  assert.equal(requests.at(-1).params.value, null);
  assert.equal(requests.some((entry) => entry.params?.keyPath?.includes("model")), false);
});

test("a removed saved voice becomes Auto and uses the discovered server default without rewriting settings", async () => {
  const voices = { v1: ["cedar"], v2: ["verse"], defaultV1: "cedar", defaultV2: "verse" };
  const { service, requests } = serviceFixture({ request: async (method) => {
    if (method === "thread/realtime/listVoices") return { voices };
    if (method === "config/read") return { config: { realtime: { voice: "removed" } } };
    return {};
  } });
  const preference = await service.getVoicePreference();
  assert.equal(preference.voice, null);
  assert.equal(preference.unavailable, true);
  assert.match(preference.note, /Auto/);
  await service.start("alice", { voice: null });
  assert.equal(requests.at(-1).params.voice, "cedar");
  assert.equal(requests.some((entry) => entry.method === "config/value/write"), false);
  await service.stop("alice");
  await service.setVoicePreference("removed");
  assert.equal(requests.at(-1).params.value, null);
});

test("voice preference preserves managed overrides and exposes failed writes", async () => {
  const voices = { v1: ["cedar", "marin"], v2: [], defaultV1: "cedar", defaultV2: null };
  let deny = false;
  const { service, requests } = serviceFixture({ request: async (method) => {
    if (method === "thread/realtime/listVoices") return { voices };
    if (method === "config/value/write") {
      if (deny) throw new Error("config file is read-only");
      return { status: "okOverridden", filePath: "/user/.codex/config.toml", version: "3",
        overriddenMetadata: { effectiveValue: "cedar", message: "Managed voice policy", overridingLayer: {} } };
    }
    return {};
  } });
  const result = await service.setVoicePreference("marin");
  assert.equal(result.status, "okOverridden");
  assert.equal(result.voice, "cedar");
  assert.equal(result.message, "Managed voice policy");
  assert.equal(requests.at(-1).params.value, "marin");
  deny = true;
  await assert.rejects(service.setVoicePreference("marin"), /read-only/);
  await assert.rejects(service.setVoicePreference({ voice: "marin" }), /voice/);
});
