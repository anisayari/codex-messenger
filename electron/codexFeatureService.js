import { advertisedModels, codexSurfaceLimits } from "../shared/codexFeatures.js";

const MAX_PAGES = 20;
const GOAL_STATUSES = new Set(["active", "paused", "blocked", "usageLimited", "budgetLimited", "complete"]);

function cleanString(value, name, { optional = false, max = 4096 } = {}) {
  if (optional && (value === undefined || value === null || value === "")) return null;
  if (typeof value !== "string" || !value.trim() || value.length > max || value.includes("\0")) throw new Error(`${name} invalide.`);
  return value.trim();
}

function featureError(error) {
  const message = String(error?.message || error || "Codex n’a pas répondu.").slice(0, 1500);
  return { available: false, status: /method not found|unknown method|unknown variant|unsupported|not supported|experimental.*(?:disabled|not enabled)/i.test(message) ? "unsupported" : "unavailable", error: message, data: null };
}

async function readSection(read) {
  try { return { available: true, status: "available", data: await read(), error: null }; }
  catch (error) { return featureError(error); }
}

function requirementsSummary(response) {
  const requirements = response?.requirements;
  if (!requirements || typeof requirements !== "object") return { requirements: null };
  return { requirements: Object.fromEntries([
    "allowedLoginMethods", "modelProvider", "allowedWindowsSandboxImplementations", "allowedApprovalPolicies", "allowedApprovalsReviewers", "allowedPermissionProfiles", "allowedSandboxModes", "allowedWebSearchModes", "defaultPermissions", "featureRequirements", "allowBrowserAndComputerUse", "allowAppshots", "allowRemoteControl", "allowLoginShell"
  ].filter((key) => Object.hasOwn(requirements, key)).map((key) => [key, requirements[key]])) };
}

/** Only explicit, schema-supported actions cross IPC. No arbitrary RPC method is exposed. */
export function createCodexFeatureService({ codex, defaultCwd, resolveContext }) {
  if (!codex?.request || !codex?.ensureReady) throw new Error("Codex client required");
  if (typeof resolveContext !== "function") throw new Error("A trusted context resolver is required");
  const initiatedLogins = new Set();
  const attemptedResets = new Map();
  const uncertainResets = new Map();
  const pendingQueueAdds = new Map();
  const historyMutations = new Set();

  async function context(payload = {}, requireThread = false) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Contexte Codex invalide.");
    const contactId = cleanString(payload.contactId, "Contact", { optional: true, max: 256 });
    const requestedThreadId = cleanString(payload.threadId, "Conversation", { optional: true, max: 256 });
    const resolved = await resolveContext({ contactId, threadId: requestedThreadId });
    const threadId = cleanString(resolved?.threadId, "Conversation", { optional: !requireThread, max: 256 });
    if (requestedThreadId && requestedThreadId !== threadId) throw new Error("Cette conversation n’appartient pas au contact sélectionné.");
    const fallback = typeof defaultCwd === "function" ? defaultCwd() : defaultCwd;
    const cwd = cleanString(resolved?.cwd || fallback, "Dossier");
    return { contactId, threadId, cwd };
  }

  async function request(method, params) {
    await codex.ensureReady();
    return codex.request(method, params);
  }

  async function list(method, params) {
    const data = [];
    const seen = new Set();
    let cursor = null;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const result = await request(method, { ...params, limit: 100, ...(cursor ? { cursor } : {}) });
      if (!Array.isArray(result?.data)) throw new Error(`Réponse ${method} invalide.`);
      data.push(...result.data);
      cursor = result.nextCursor || null;
      if (!cursor) return { data, nextCursor: null, truncated: false };
      if (seen.has(cursor)) throw new Error(`Pagination ${method} répétée.`);
      seen.add(cursor);
    }
    return { data, nextCursor: cursor, truncated: true };
  }

  async function usage(threadId = null) {
    const response = await request("account/usage/read", threadId ? { threadId } : null);
    if (!response?.summary || typeof response.summary !== "object" || Array.isArray(response.summary)) throw new Error("Réponse d’usage Codex invalide.");
    if (response.dailyUsageBuckets != null && !Array.isArray(response.dailyUsageBuckets)) throw new Error("Activité quotidienne Codex invalide.");
    if (threadId && response.threadUsage != null && (response.threadUsage.threadId !== threadId || !Array.isArray(response.threadUsage.groups))) throw new Error("L’estimation d’usage ne correspond pas à cette conversation.");
    return { summary: response.summary, dailyUsageBuckets: response.dailyUsageBuckets ?? null, ...(threadId ? { threadUsage: response.threadUsage ?? null } : {}) };
  }

  async function latestHistory(ctx) {
    const response = await request("thread/read", { threadId: ctx.threadId, includeTurns: false });
    const thread = response?.thread;
    if (!thread || thread.id !== ctx.threadId) throw new Error("Métadonnées de conversation invalides.");
    let turn;
    if (thread.historyMode === "paginated") {
      const page = await request("thread/turns/list", { threadId: ctx.threadId, limit: 1, sortDirection: "desc", itemsView: "full" });
      if (!Array.isArray(page?.data)) throw new Error("Réponse d’historique invalide.");
      turn = page.data[0] || null;
    } else if (thread.historyMode === "legacy") {
      const legacy = await request("thread/read", { threadId: ctx.threadId, includeTurns: true });
      if (!Array.isArray(legacy?.thread?.turns)) throw new Error("Réponse d’historique legacy invalide.");
      turn = legacy.thread.turns.at(-1) || null;
    } else throw new Error("Codex n’annonce pas de contrat d’historique compatible.");
    const userMessages = (turn?.items || []).filter((item) => item.type === "userMessage");
    const preview = userMessages.flatMap((item) => (item.content || []).map((input) => input.type === "text" ? input.text : "[" + input.type + "]")).join("\n").slice(0, 600);
    const lastTurn = turn ? { id: turn.id, status: turn.status, hasUserMessage: userMessages.length > 0, preview } : null;
    const ready = thread.historyMode === "paginated" && thread.ephemeral === false && thread.status?.type === "idle" && thread.canAcceptDirectInput === true && Boolean(lastTurn?.hasUserMessage) && lastTurn.status !== "inProgress";
    return { thread: { id: thread.id, historyMode: thread.historyMode, ephemeral: thread.ephemeral, status: thread.status, canAcceptDirectInput: thread.canAcceptDirectInput }, lastTurn, ready };
  }

  async function searchPage(method, params) {
    const result = await request(method, params);
    if (!Array.isArray(result?.data)) throw new Error("Réponse de recherche invalide.");
    if (result.nextCursor != null && typeof result.nextCursor !== "string") throw new Error("Curseur de recherche invalide.");
    return { data: result.data, nextCursor: result.nextCursor || null };
  }

  async function skills(ctx, forceReload = false) {
    const response = await request("skills/list", { cwds: [ctx.cwd], forceReload });
    return { data: (response?.data || []).flatMap((entry) => entry.skills || []), errors: (response?.data || []).flatMap((entry) => entry.errors || []) };
  }

  async function catalog(payload = {}) {
    const ctx = await context(payload);
    const force = payload.force === true;
    const entries = {
      account: () => request("account/read", { refreshToken: false }),
      rateLimits: () => request("account/rateLimits/read", null),
      accountUsage: () => usage(),
      plugins: async () => {
        const response = await request("plugin/installed", { cwds: [ctx.cwd] });
        if (!Array.isArray(response?.marketplaces)) throw new Error("Réponse de plugins installés invalide.");
        const installed = new Map();
        for (const marketplace of response.marketplaces) {
          if (!Array.isArray(marketplace.plugins) || typeof marketplace.name !== "string") throw new Error("Catalogue d’extensions Codex invalide.");
          for (const plugin of marketplace.plugins) {
            if (typeof plugin.installed !== "boolean" || typeof plugin.enabled !== "boolean" || typeof plugin.id !== "string" || typeof plugin.name !== "string") throw new Error("État d’extension Codex invalide.");
            if (plugin.installed) installed.set(marketplace.name + ":" + plugin.id, { id: plugin.id, name: plugin.name, enabled: plugin.enabled, installed: plugin.installed, version: plugin.localVersion ?? plugin.version ?? null, marketplace: marketplace.name });
          }
        }
        return { data: [...installed.values()], errors: response.marketplaceLoadErrors || [] };
      },
      models: async () => { const response = await list("model/list", { includeHidden: false }); return { ...response, data: advertisedModels(response) }; },
      skills: () => skills(ctx, force),
      apps: () => list("app/list", { threadId: ctx.threadId, forceRefetch: force }),
      installedApps: () => request("app/installed", { threadId: ctx.threadId, forceRefresh: force }),
      mcpServers: async () => {
        const response = await list("mcpServerStatus/list", { threadId: ctx.threadId, detail: "full" });
        return { ...response, data: response.data.map((server) => ({ name: server.name, authStatus: server.authStatus, runtimeStatus: server.runtimeStatus ?? null, toolsError: server.toolsError ?? null, serverInfo: server.serverInfo ?? null, pluginId: server.pluginId ?? null, serverCapabilities: server.serverCapabilities ?? null, tools: Object.values(server.tools || {}).map((tool) => ({ name: tool.name, title: tool.title || tool.name, description: tool.description || "" })), resourceCount: server.resources?.length || 0, templateCount: server.resourceTemplates?.length || 0 })) };
      },
      memory: () => request("memory/status", {}),
      providerCapabilities: () => request("modelProvider/capabilities/read", {}),
      collaborationModes: () => request("collaborationMode/list", {}),
      requirements: async () => requirementsSummary(await request("configRequirements/read", null)),
      permissionProfiles: () => list("permissionProfile/list", { cwd: ctx.cwd }),
      ...(ctx.threadId ? {
        queue: () => list("thread/queue/list", { threadId: ctx.threadId }),
        goal: () => request("thread/goal/get", { threadId: ctx.threadId }),
        historyTail: () => latestHistory(ctx),
        threadUsage: () => usage(ctx.threadId),
        backgroundTerminals: () => list("thread/backgroundTerminals/list", { threadId: ctx.threadId }),
        thread: () => request("thread/read", { threadId: ctx.threadId, includeTurns: false })
      } : {})
    };
    const names = Object.keys(entries);
    const results = await Promise.allSettled(names.map((name) => readSection(entries[name])));
    const sections = Object.fromEntries(names.map((name, index) => [name, results[index].status === "fulfilled" ? results[index].value : featureError(results[index].reason)]));
    const pendingResetAttempt = sections.rateLimits?.available ? uncertainResets.get(sections.rateLimits.data?.accountId ?? null) || null : null;
    const observed = ctx.threadId && typeof codex.getObservedCollaborationMode === "function" ? codex.getObservedCollaborationMode(ctx.threadId) : null;
    const observedCollaborationMode = observed && ["plan", "default"].includes(observed.mode) && typeof observed.settings?.model === "string" && observed.settings.model
      ? { mode: observed.mode, settings: { model: observed.settings.model, reasoning_effort: typeof observed.settings.reasoning_effort === "string" ? observed.settings.reasoning_effort : null } }
      : null;
    return { localState: { observedCollaborationMode, pendingResetAttempt, pendingQueueSubmission: ctx.threadId ? pendingQueueAdds.get(ctx.threadId) || null : null }, context: ctx, fetchedAt: new Date().toISOString(), sections, limitations: codexSurfaceLimits };
  }

  async function action(name, payload = {}) {
    const cleanAction = cleanString(name, "Action", { max: 64 });
    // Resolve membership before any action, including connector authentication.
    const ctx = await context(payload, ["goal-set", "goal-clear", "archive", "unarchive", "rename", "terminals-clean", "terminal-terminate", "search-occurrences", "search-open", "compact", "history-revert"].includes(cleanAction) || cleanAction.startsWith("queue-") || cleanAction === "memory-mode");
    switch (cleanAction) {
      case "search-threads": {
        if (!ctx.contactId) throw new Error("Choisissez un contact pour rechercher ses conversations.");
        if (payload.archived != null && typeof payload.archived !== "boolean") throw new Error("Filtre d’archive invalide.");
        const searchTerm = cleanString(payload.searchTerm, "Recherche", { max: 4096 });
        const cursor = cleanString(payload.cursor, "Curseur", { optional: true, max: 16384 });
        const page = await searchPage("thread/search", { searchTerm, archived: payload.archived === true, limit: 25, sortKey: "updated_at", sortDirection: "desc", ...(cursor ? { cursor } : {}) });
        const data = [];
        for (const hit of page.data) {
          if (!hit?.thread?.id || typeof hit.snippet !== "string") throw new Error("Résultat de recherche invalide.");
          try {
            const allowed = await context({ contactId: ctx.contactId, threadId: hit.thread.id }, true);
            if (allowed.threadId === hit.thread.id) data.push({ snippet: hit.snippet, thread: { id: hit.thread.id, name: hit.thread.name ?? null, preview: hit.thread.preview, cwd: hit.thread.cwd, historyMode: hit.thread.historyMode } });
          } catch { /* Do not expose another contact’s conversation. */ }
        }
        return { ...page, data };
      }
      case "search-occurrences": {
        const searchTerm = cleanString(payload.searchTerm, "Recherche", { max: 4096 });
        const cursor = cleanString(payload.cursor, "Curseur", { optional: true, max: 16384 });
        return searchPage("thread/searchOccurrences", { threadId: ctx.threadId, searchTerm, limit: 25, ...(cursor ? { cursor } : {}) });
      }
      case "search-open": return request("thread/read", { threadId: ctx.threadId, includeTurns: false });
      case "compact": {
        const thread = (await request("thread/read", { threadId: ctx.threadId, includeTurns: false }))?.thread;
        if (thread?.id !== ctx.threadId || thread.status?.type !== "idle" || thread.canAcceptDirectInput !== true) throw new Error("Attendez que cette conversation soit chargée et inactive avant le compactage.");
        return request("thread/compact/start", { threadId: ctx.threadId });
      }
      case "history-revert": {
        if (payload.confirmed !== true) throw new Error("Confirmez le retrait du dernier échange de l’historique ; les fichiers restent modifiés.");
        const expectedLastTurnId = cleanString(payload.expectedLastTurnId, "Échange attendu", { max: 256 });
        if (historyMutations.has(ctx.threadId)) throw new Error("Un retrait historique est déjà en cours dans cette conversation.");
        historyMutations.add(ctx.threadId);
        try {
          const tail = await latestHistory(ctx);
          if (tail.thread.historyMode !== "paginated") throw new Error("Codex 0.156.0 a supprimé rollback : le retrait d’un échange exige un historique paginé. Cet historique legacy reste consultable.");
          if (!tail.ready) throw new Error("Le retrait exige un dernier échange utilisateur persisté et une conversation chargée, inactive et modifiable.");
          if (tail.lastTurn.id !== expectedLastTurnId) throw new Error("Le dernier échange a changé. Actualisez et vérifiez l’historique avant de confirmer à nouveau.");
          const result = await request("thread/revert", { threadId: ctx.threadId, beforeTurnId: expectedLastTurnId });
          if (result?.thread?.id !== ctx.threadId) throw new Error("Réponse de retrait inconnue ; relisez l’historique avant toute nouvelle action.");
          return result;
        } finally { historyMutations.delete(ctx.threadId); }
      }
      case "memory-mode": {
        if (!["enabled", "disabled"].includes(payload.mode)) throw new Error("Mode mémoire invalide.");
        return request("thread/memoryMode/set", { threadId: ctx.threadId, mode: payload.mode });
      }
      case "queue-add": {
        const text = cleanString(payload.text, "Message", { max: 200000 });
        const clientUserMessageId = cleanString(payload.clientUserMessageId, "Identifiant du message", { max: 256 });
        const pending = pendingQueueAdds.get(ctx.threadId);
        if (pending) throw new Error("Un envoi en file attend vérification. Vérifiez la file et l’historique avant un nouvel envoi.");
        pendingQueueAdds.set(ctx.threadId, { text, clientUserMessageId });
        try {
          const result = await request("thread/queue/add", { threadId: ctx.threadId, clientUserMessageId, input: [{ type: "text", text, text_elements: [] }] });
          if (!result?.queuedSubmission?.id) throw new Error("Réponse de mise en file inconnue ; vérifiez l’historique avant de réessayer.");
          pendingQueueAdds.delete(ctx.threadId);
          return result;
        } catch (error) {
          if (!/timed out|timeout|stopped|not running|transport|closed|pipe|connection|EPIPE|ECONN|réponse.*inconnue/i.test(error?.message || "")) pendingQueueAdds.delete(ctx.threadId);
          throw error;
        }
      }
      case "queue-reconcile": {
        const pending = pendingQueueAdds.get(ctx.threadId);
        if (!pending) return { state: "notPending" };
        const queue = await list("thread/queue/list", { threadId: ctx.threadId });
        const submission = queue.data.find((item) => item.clientUserMessageId === pending.clientUserMessageId);
        if (submission) { pendingQueueAdds.delete(ctx.threadId); return { state: "queued", queuedSubmission: submission }; }
        return { state: "uncertain" };
      }
      case "queue-acknowledge": {
        if (payload.confirmed !== true) throw new Error("Confirmez avoir vérifié l’historique de ce message.");
        pendingQueueAdds.delete(ctx.threadId);
        return { acknowledged: true };
      }
      case "queue-update":
      case "queue-delete":
      case "queue-start": {
        const queuedSubmissionId = cleanString(payload.queuedSubmissionId, "Message en file", { max: 256 });
        const queue = await list("thread/queue/list", { threadId: ctx.threadId });
        const submission = queue.data.find((item) => item.id === queuedSubmissionId);
        if (!submission) throw new Error("Ce message n’est plus dans la file de cette conversation.");
        const params = { threadId: ctx.threadId, queuedSubmissionId };
        if (cleanAction === "queue-update") {
          if (!submission.input?.every((item) => item.type === "text")) throw new Error("Ce message contient des pièces jointes ; sa modification texte ne peut pas les remplacer.");
          params.input = [{ type: "text", text: cleanString(payload.text, "Message", { max: 200000 }), text_elements: [] }];
        }
        return request("thread/queue/" + cleanAction.slice(6), params);
      }
      case "queue-reorder": {
        if (!Array.isArray(payload.queuedSubmissionIds)) throw new Error("Ordre de file invalide.");
        const queuedSubmissionIds = payload.queuedSubmissionIds.map((id) => cleanString(id, "Message en file", { max: 256 }));
        const queue = await list("thread/queue/list", { threadId: ctx.threadId });
        if (queue.truncated || queuedSubmissionIds.length !== queue.data.length || new Set(queuedSubmissionIds).size !== queuedSubmissionIds.length || queue.data.some((item) => !queuedSubmissionIds.includes(item.id))) throw new Error("L’ordre doit contenir chaque message actuel une seule fois. Actualisez la file.");
        return request("thread/queue/reorder", { threadId: ctx.threadId, queuedSubmissionIds });
      }
      case "account-login": {
        const result = await request("account/login/start", { type: "chatgpt" });
        if (result?.loginId) initiatedLogins.add(result.loginId);
        return result;
      }
      case "account-login-cancel": {
        const loginId = cleanString(payload.loginId, "Connexion", { max: 256 });
        if (!initiatedLogins.has(loginId)) throw new Error("Cette connexion n’a pas été ouverte par Messenger.");
        const result = await request("account/login/cancel", { loginId });
        initiatedLogins.delete(loginId);
        return result;
      }
      case "account-logout": {
        if (payload.confirmed !== true) throw new Error("Confirmez la déconnexion de Codex sur cet ordinateur.");
        const result = await request("account/logout", null);
        initiatedLogins.clear();
        attemptedResets.clear();
        uncertainResets.clear();
        return result;
      }
      case "skill-input": {
        const path = cleanString(payload.path, "Chemin de l’activité");
        const skill = (await skills(ctx)).data.find((entry) => entry.path === path && entry.enabled);
        if (!skill) throw new Error("Cette activité est absente ou désactivée dans ce dossier.");
        return { type: "skill", name: skill.name, path: skill.path };
      }
      case "app-input": {
        const id = cleanString(payload.id, "Application", { max: 256 });
        const installed = await request("app/installed", { threadId: ctx.threadId, forceRefresh: false });
        if (!installed?.apps?.some((app) => app.id === id && app.enabled && app.callable)) throw new Error("Cette application n’expose pas d’outil actif à Codex.");
        const apps = await list("app/list", { threadId: ctx.threadId, forceRefetch: false });
        const app = apps.data.find((entry) => entry.id === id);
        if (!app) throw new Error("Application introuvable dans le catalogue Codex.");
        return { type: "mention", name: app.name, path: `app://${id}` };
      }
      case "mcp-login": {
        const serverName = cleanString(payload.name, "Serveur", { max: 256 });
        const servers = await list("mcpServerStatus/list", { threadId: ctx.threadId, detail: "toolsAndAuthOnly" });
        const server = servers.data.find((entry) => entry.name === serverName);
        if (!server || !["notLoggedIn", "oAuth"].includes(server.authStatus)) throw new Error("Ce serveur ne propose pas de connexion OAuth.");
        return request("mcpServer/oauth/login", { name: serverName, threadId: ctx.threadId, timeoutSecs: 300 });
      }
      case "mcp-reload": return request("config/mcpServer/reload", null);
      case "credits-consume": {
        if (payload.confirmed !== true) throw new Error("Confirmez explicitement l’utilisation d’un crédit de réinitialisation.");
        const idempotencyKey = cleanString(payload.idempotencyKey, "Identifiant de réinitialisation", { max: 256 });
        const snapshot = await request("account/rateLimits/read", null);
        const accountScope = snapshot?.accountId ?? null;
        const outstandingKey = uncertainResets.get(accountScope);
        if (outstandingKey && outstandingKey !== idempotencyKey) throw new Error("Une réinitialisation précédente doit être vérifiée avec sa même clé. Actualisez ce panneau pour la reprendre.");
        const retrying = attemptedResets.has(idempotencyKey);
        if (retrying && attemptedResets.get(idempotencyKey) !== (snapshot?.accountId ?? null)) throw new Error("Le compte a changé depuis cette tentative de réinitialisation.");
        const core = snapshot?.rateLimitsByLimitId?.codex || snapshot?.rateLimits;
        if (!retrying && ![core?.primary, core?.secondary].some((window) => typeof window?.usedPercent === "number" && window.usedPercent >= 90)) return { outcome: "nothingToReset" };
        const count = snapshot?.rateLimitResetCredits?.availableCount;
        if (!retrying && typeof count !== "number") throw new Error("Le nombre de crédits disponibles est inconnu.");
        if (!retrying && count <= 0) return { outcome: "noCredit" };
        const params = { idempotencyKey };
        if (payload.creditId != null) {
          const creditId = cleanString(payload.creditId, "Crédit", { max: 256 });
          if (!retrying && !snapshot.rateLimitResetCredits.credits?.some((credit) => credit.id === creditId && credit.status === "available")) throw new Error("Ce crédit n’est pas disponible.");
          params.creditId = creditId;
        }
        // A timed-out response may already have consumed the credit. Reconcile the
        // same key with the backend even if its reset changed fresh eligibility.
        attemptedResets.set(idempotencyKey, snapshot?.accountId ?? null);
        uncertainResets.set(accountScope, idempotencyKey);
        const result = await request("account/rateLimitResetCredit/consume", params);
        if (!["reset", "alreadyRedeemed", "noCredit", "nothingToReset"].includes(result?.outcome)) throw new Error("Réponse de réinitialisation inconnue ; la tentative doit être vérifiée.");
        uncertainResets.delete(accountScope);
        return result;
      }
      case "goal-set": {
        const params = { threadId: ctx.threadId };
        if (Object.hasOwn(payload, "objective")) params.objective = cleanString(payload.objective, "Objectif", { max: 32000 });
        if (Object.hasOwn(payload, "status")) {
          if (!GOAL_STATUSES.has(payload.status)) throw new Error("État d’objectif invalide.");
          params.status = payload.status;
        }
        if (Object.hasOwn(payload, "tokenBudget")) {
          if (payload.tokenBudget !== null && (!Number.isSafeInteger(payload.tokenBudget) || payload.tokenBudget <= 0)) throw new Error("Budget de jetons invalide.");
          params.tokenBudget = payload.tokenBudget;
        }
        if (Object.keys(params).length === 1) throw new Error("Aucun changement d’objectif demandé.");
        return request("thread/goal/set", params);
      }
      case "goal-clear": return request("thread/goal/clear", { threadId: ctx.threadId });
      case "archive": return request("thread/archive", { threadId: ctx.threadId });
      case "unarchive": return request("thread/unarchive", { threadId: ctx.threadId });
      case "rename": return request("thread/name/set", { threadId: ctx.threadId, name: cleanString(payload.name, "Nom", { max: 512 }) });
      case "terminals-clean": return request("thread/backgroundTerminals/clean", { threadId: ctx.threadId });
      case "terminal-terminate": {
        const processId = cleanString(payload.processId, "Processus", { max: 256 });
        const terminals = await list("thread/backgroundTerminals/list", { threadId: ctx.threadId });
        if (!terminals.data.some((terminal) => terminal.processId === processId)) throw new Error("Ce terminal n’est plus actif dans cette conversation.");
        return request("thread/backgroundTerminals/terminate", { threadId: ctx.threadId, processId });
      }
      default: throw new Error("Action Codex non prise en charge.");
    }
  }
  return { catalog, action };
}

export function registerCodexFeatureIpcHandlers({ ipcMain, service }) {
  ipcMain.handle("codex:features", (_event, payload = {}) => service.catalog(payload));
  ipcMain.handle("codex:feature-action", (_event, name, payload = {}) => service.action(name, payload));
}
