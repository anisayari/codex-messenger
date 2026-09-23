import { randomUUID } from "node:crypto";
import { StringDecoder } from "node:string_decoder";
import path from "node:path";
import { normalizeCodexOptions, sandboxPolicyForMode } from "../shared/codexOptions.js";

const OUTPUT_CAP = 4 * 1024 * 1024;
const COMMAND_TIMEOUT = 60_000;
const MAX_SESSIONS = 8;

function text(value, name, maximum = 16_000) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum || value.includes("\0")) throw new Error(`${name} invalide.`);
  return value;
}

function size(payload = {}) {
  const cols = payload.cols ?? 80; const rows = payload.rows ?? 24;
  if (![cols, rows].every((value) => Number.isInteger(value) && value >= 2 && value <= 500)) throw new Error("Dimensions du terminal invalides.");
  return { cols, rows };
}

export function terminalCommandArgv(command, { platform = process.platform, shell = process.env.SHELL } = {}) {
  text(command, "Commande");
  if (platform === "win32") return [process.env.ComSpec || "cmd.exe", "/d", "/s", "/c", command];
  const executable = shell && path.isAbsolute(shell) && !shell.includes("\0") ? shell : "/bin/sh";
  return [executable, "-c", command];
}

/** Explicit user commands use the server executor and effective sandbox, never a local spawn. */
export function createTerminalService({ codex, resolveContext, optionsForContext = (context) => context.codexOptions || {},
  deliver = (sender, payload) => sender.send("terminal:output", payload), platform = process.platform, shell = process.env.SHELL }) {
  if (!codex?.request || !codex?.ensureReady || typeof resolveContext !== "function") throw new Error("Trusted Codex executor and context resolver required");
  const sessions = new Map();

  function emit(session, payload) {
    if (session.sender.isDestroyed?.()) return;
    try { deliver(session.sender, { sessionId: session.id, contactId: session.contactId, threadId: session.threadId, ...payload }); } catch { /* Renderer closed. */ }
  }

  function finish(session, payload) {
    if (!sessions.has(session.id)) return;
    for (const [stream, decoder] of Object.entries(session.decoders)) {
      const tail = decoder.end(); if (tail) emit(session, { stream, text: tail });
    }
    sessions.delete(session.id);
    clearTimeout(session.deadline);
    session.sender.removeListener?.("destroyed", session.onDestroyed);
    emit(session, { done: true, ...payload });
  }

  function requireSession(event, payload) {
    const session = sessions.get(text(payload?.sessionId, "Session", 128));
    if (!session || session.sender !== event?.sender || event.sender.isDestroyed?.()) throw new Error("Cette session n’appartient pas à cette fenêtre ou est terminée.");
    return session;
  }

  async function terminate(session) {
    try { await codex.request("command/exec/terminate", { processId: session.id }); }
    catch (error) { finish(session, { error: String(error.message || error) }); throw error; }
  }

  function notification(message) {
    if (message?.method !== "command/exec/outputDelta") return;
    const payload = message.params;
    const session = sessions.get(payload?.processId);
    if (!session || !["stdout", "stderr"].includes(payload?.stream)) return;
    if (typeof payload.deltaBase64 !== "string" || payload.deltaBase64.length > OUTPUT_CAP * 2
        || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(payload.deltaBase64)) {
      finish(session, { error: "Flux de terminal invalide." }); void terminate(session).catch(() => {}); return;
    }
    const bytes = Buffer.from(payload.deltaBase64, "base64");
    const remaining = OUTPUT_CAP - session.bytes[payload.stream];
    const accepted = bytes.subarray(0, Math.max(0, remaining));
    session.bytes[payload.stream] += accepted.length;
    const decoded = session.decoders[payload.stream].write(accepted);
    if (decoded || payload.capReached || bytes.length > remaining) emit(session, { stream: payload.stream, text: decoded, truncated: payload.capReached || bytes.length > remaining });
  }
  codex.on?.("notification", notification);
  const status = (payload) => {
    if (!["exit", "error", "stopped"].includes(payload?.kind)) return;
    for (const session of [...sessions.values()]) finish(session, { error: "Connexion au terminal Codex interrompue." });
  };
  codex.on?.("status", status);

  async function start(event, payload = {}) {
    if (!event?.sender || event.sender.isDestroyed?.()) throw new Error("Fenêtre invalide.");
    const command = text(payload.command, "Commande");
    const dimensions = size(payload);
    const context = await resolveContext({ contactId: payload.contactId, threadId: payload.threadId });
    const cwd = text(context?.cwd, "Dossier", 4096);
    if (!path.isAbsolute(cwd)) throw new Error("Le dossier du terminal doit être absolu.");
    const options = normalizeCodexOptions(await optionsForContext(context));
    await codex.ensureReady();
    if (event.sender.isDestroyed?.()) throw new Error("Fenêtre fermée.");
    if (sessions.size >= MAX_SESSIONS || [...sessions.values()].filter((session) => session.sender === event.sender).length >= 2) throw new Error("Limite de sessions terminal atteinte.");
    const id = `messenger-terminal-${randomUUID()}`;
    const session = { id, sender: event.sender, contactId: context.contactId || payload.contactId || null, threadId: context.threadId || null,
      decoders: { stdout: new StringDecoder("utf8"), stderr: new StringDecoder("utf8") }, bytes: { stdout: 0, stderr: 0 } };
    session.onDestroyed = () => { void terminate(session).catch(() => {}); finish(session, { error: "Fenêtre fermée." }); };
    event.sender.once?.("destroyed", session.onDestroyed);
    sessions.set(id, session);
    session.deadline = setTimeout(() => { void terminate(session).catch(() => {}); finish(session, { error: "Limite de 60 secondes atteinte." }); }, COMMAND_TIMEOUT + 2_000);
    const params = { command: terminalCommandArgv(command, { platform, shell }), cwd, processId: id, tty: true,
      streamStdin: true, streamStdoutStderr: true, size: dimensions, timeoutMs: COMMAND_TIMEOUT, outputBytesCap: OUTPUT_CAP,
      ...(options.permissions ? { permissionProfile: options.permissions } : { sandboxPolicy: sandboxPolicyForMode(options.sandbox) }) };
    // The response arrives after process exit, so return the owned session id immediately.
    Promise.resolve().then(() => codex.request("command/exec", params)).then((result) => {
      if (!sessions.has(session.id)) return;
      if (result?.stdout) emit(session, { stream: "stdout", text: String(result.stdout).slice(0, OUTPUT_CAP) });
      if (result?.stderr) emit(session, { stream: "stderr", text: String(result.stderr).slice(0, OUTPUT_CAP) });
      finish(session, { exitCode: result?.exitCode ?? null });
    }).catch((error) => finish(session, { error: String(error?.message || error).slice(0, 1500) }));
    return { ok: true, sessionId: id, cwd, timeoutMs: COMMAND_TIMEOUT, sandbox: options.permissions || options.sandbox };
  }

  async function write(event, payload = {}) {
    const session = requireSession(event, payload);
    if (typeof payload.data !== "string" || Buffer.byteLength(payload.data) > 64_000 || payload.data.includes("\0")) throw new Error("Entrée du terminal invalide.");
    return codex.request("command/exec/write", { processId: session.id, deltaBase64: Buffer.from(payload.data, "utf8").toString("base64"), closeStdin: payload.closeStdin === true });
  }
  async function resize(event, payload = {}) {
    const session = requireSession(event, payload);
    return codex.request("command/exec/resize", { processId: session.id, size: size(payload) });
  }
  async function stop(event, payload = {}) { const session = requireSession(event, payload); return terminate(session); }
  function dispose() {
    codex.removeListener?.("notification", notification); codex.removeListener?.("status", status);
    for (const session of [...sessions.values()]) { void terminate(session).catch(() => {}); finish(session, { error: "Terminal fermé." }); }
  }
  return { start, write, resize, stop, dispose };
}

export function registerTerminalIpcHandlers({ ipcMain, service }) {
  ipcMain.handle("terminal:start", (event, payload) => service.start(event, payload));
  ipcMain.handle("terminal:write", (event, payload) => service.write(event, payload));
  ipcMain.handle("terminal:resize", (event, payload) => service.resize(event, payload));
  ipcMain.handle("terminal:stop", (event, payload) => service.stop(event, payload));
}
