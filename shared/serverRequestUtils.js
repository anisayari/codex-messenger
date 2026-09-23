// Wire shapes verified against `codex app-server generate-json-schema --experimental`
// from Codex 0.155.1. Responses contain only fields accepted by that protocol.
const methods = new Map([
  ["item/commandExecution/requestApproval", "command"],
  ["item/fileChange/requestApproval", "file"],
  ["execCommandApproval", "command"],
  ["applyPatchApproval", "file"],
  ["item/tool/requestUserInput", "user-input"],
  ["item/permissions/requestApproval", "permissions"],
  ["mcpServer/elicitation/request", "elicitation"]
]);

const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const copy = (value) => JSON.parse(JSON.stringify(value));
const same = (a, b) => {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => same(v, b[i]));
  if (object(a) && object(b)) return Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((k) => Object.hasOwn(b, k) && same(a[k], b[k]));
  return false;
};
const requireString = (value, name) => {
  if (typeof value !== "string" || !value) throw new Error(`Codex: champ ${name} manquant ou invalide.`);
  return value;
};

export function isSupportedServerRequest(method) {
  return methods.has(method);
}

export function serverRequestWireKey(id) {
  if (!(typeof id === "string" || Number.isSafeInteger(id))) throw new Error("Identifiant de demande Codex invalide.");
  return `${typeof id}:${id}`;
}

export function isSecretSchemaField(name, schema = {}) {
  return schema.writeOnly === true || schema.format === "password" || /password|passwd|secret|token|credential|api[_-]?key/i.test(name);
}

function schemaWithoutSecretDefaults(schema, name = "") {
  if (!object(schema)) return schema;
  const result = copy(schema);
  if (isSecretSchemaField(name, result)) delete result.default;
  for (const [key, value] of Object.entries(result)) {
    if (["properties", "$defs", "definitions", "patternProperties"].includes(key) && object(value)) result[key] = Object.fromEntries(Object.entries(value).map(([fieldName, field]) => [fieldName, schemaWithoutSecretDefaults(field, fieldName)]));
    else if (["items", "additionalProperties", "not", "if", "then", "else"].includes(key) && object(value)) result[key] = schemaWithoutSecretDefaults(value, name);
    else if (["anyOf", "oneOf", "allOf", "prefixItems"].includes(key) && Array.isArray(value)) result[key] = value.map((field) => schemaWithoutSecretDefaults(field, name));
  }
  return result;
}

function commandText(command) {
  if (Array.isArray(command)) return command.map((part) => /[\s"\\]/.test(part) ? JSON.stringify(part) : part).join(" ");
  return typeof command === "string" ? command : "";
}

function fileChanges(changes) {
  return (Array.isArray(changes) ? changes : object(changes) ? Object.entries(changes).map(([path, change]) => ({ ...change, path })) : [])
    .filter((change) => typeof change?.path === "string")
    .map((change) => ({ path: change.path, kind: typeof change.kind === "string" ? change.kind : change.kind?.type ?? change.type ?? "update" }));
}

export function normalizeServerRequest(message, { id, contactId, item } = {}) {
  serverRequestWireKey(message?.id);
  const kind = methods.get(message.method);
  if (!kind) throw new Error(`Demande Codex non prise en charge: ${message?.method ?? "inconnue"}`);
  const p = message.params;
  if (!object(p)) throw new Error("Paramètres de demande Codex invalides.");
  const legacy = message.method === "execCommandApproval" || message.method === "applyPatchApproval";
  const threadId = requireString(legacy ? p.conversationId : p.threadId, "threadId");
  const localId = requireString(id, "id");
  const result = {
    id: localId, serverRequestId: localId, requestId: message.id, method: message.method, kind,
    contactId: requireString(contactId, "contactId"), threadId,
    turnId: typeof p.turnId === "string" ? p.turnId : "", itemId: p.itemId ?? p.callId ?? "",
    reason: typeof p.reason === "string" ? p.reason : "", cwd: typeof p.cwd === "string" ? p.cwd : item?.cwd ?? "",
    isBlocking: kind === "user-input" ? p.isBlocking !== false : true,
    createdAt: new Date().toISOString()
  };
  if (kind === "command" || kind === "file") {
    if (!legacy) requireString(p.itemId, "itemId");
    if (p.kind != null && !["command", "writeStdin"].includes(p.kind)) throw new Error("Type d'action de terminal invalide.");
    result.title = kind === "command" ? p.kind === "writeStdin" ? "Codex veut envoyer une entrée au terminal" : "Codex veut exécuter une commande" : "Codex veut modifier des fichiers";
    result.command = commandText(p.command ?? item?.command);
    result.fileChanges = fileChanges(p.fileChanges ?? p.changes ?? item?.changes);
    result.grantRoot = typeof p.grantRoot === "string" ? p.grantRoot : "";
    result.riskLevel = p.risk?.riskLevel ?? p.risk?.risk_level ?? "";
    result.riskDescription = p.risk?.description ?? "";
    if (p.availableDecisions != null) {
      if (!Array.isArray(p.availableDecisions) || p.availableDecisions.some((decision) => !validApprovalDecision(decision, kind))) throw new Error("Décisions d'autorisation Codex invalides.");
      result.availableDecisions = copy(p.availableDecisions);
    }
    if (Array.isArray(p.proposedExecpolicyAmendment) && p.proposedExecpolicyAmendment.every((part) => typeof part === "string")) result.proposedExecpolicyAmendment = copy(p.proposedExecpolicyAmendment);
    if (Array.isArray(p.proposedNetworkPolicyAmendments) && p.proposedNetworkPolicyAmendments.every(validNetworkAmendment)) result.proposedNetworkPolicyAmendments = copy(p.proposedNetworkPolicyAmendments);
    if (object(p.networkApprovalContext)) result.networkApprovalContext = copy(p.networkApprovalContext);
    if (object(p.additionalPermissions)) { permissionChoices(p.additionalPermissions); result.additionalPermissions = copy(p.additionalPermissions); }
  } else if (kind === "user-input") {
    requireString(p.itemId, "itemId");
    if (!Array.isArray(p.questions) || !p.questions.length) throw new Error("Codex n'a fourni aucune question.");
    const seen = new Set();
    result.title = result.isBlocking ? "Codex attend votre réponse" : "Codex vous pose une question";
    result.questions = p.questions.map((q) => {
      requireString(q?.id, "question.id");
      if (seen.has(q.id)) throw new Error("Identifiant de question dupliqué.");
      seen.add(q.id);
      requireString(q.question, "question.question");
      if (q.options != null && (!Array.isArray(q.options) || q.options.some((option) => typeof option?.label !== "string" || typeof option?.description !== "string"))) throw new Error("Options de question invalides.");
      return { id: q.id, header: typeof q.header === "string" ? q.header : "", question: q.question, isOther: q.isOther === true, isSecret: q.isSecret === true, options: copy(q.options ?? []) };
    });
  } else if (kind === "permissions") {
    if (!object(p.permissions)) throw new Error("Permissions demandées invalides.");
    result.title = "Codex demande des accès supplémentaires";
    result.permissions = copy(p.permissions);
    permissionChoices(result.permissions); // Reject malformed requests before rendering.
  } else {
    requireString(p.serverName, "serverName");
    requireString(p.message, "message");
    result.title = `${p.serverName} demande votre réponse`;
    result.serverName = p.serverName;
    result.message = p.message;
    result.mode = p.mode;
    if (p.mode === "url") {
      requireString(p.elicitationId, "elicitationId");
      requireString(p.url, "url");
      result.url = p.url;
      result.elicitationId = p.elicitationId;
    } else if (["form", "openai/form", "openaiForm"].includes(p.mode) && (object(p.requestedSchema) || typeof p.requestedSchema === "boolean")) {
      result.requestedSchema = schemaWithoutSecretDefaults(p.requestedSchema);
    } else throw new Error("Format de formulaire MCP non pris en charge.");
  }
  return result;
}

function validNetworkAmendment(value) {
  return object(value) && Object.keys(value).length === 2 && typeof value.host === "string" && value.host.length > 0 && ["allow", "deny"].includes(value.action);
}

function validApprovalDecision(value, kind) {
  if (["accept", "acceptForSession", "decline", "cancel"].includes(value)) return true;
  if (kind !== "command" || !object(value) || Object.keys(value).length !== 1) return false;
  const exec = value.acceptWithExecpolicyAmendment;
  if (object(exec) && Object.keys(exec).length === 1 && Array.isArray(exec.execpolicy_amendment) && exec.execpolicy_amendment.every((part) => typeof part === "string")) return true;
  const network = value.applyNetworkPolicyAmendment;
  return object(network) && Object.keys(network).length === 1 && validNetworkAmendment(network.network_policy_amendment);
}

function decisionLabel(value) {
  if (["accept", "approved"].includes(value)) return "Autoriser";
  if (["acceptForSession", "approved_for_session"].includes(value)) return "Autoriser pour la session";
  if (value === "decline" || object(value) && value.denied) return "Refuser";
  if (["cancel", "abort"].includes(value)) return "Refuser et arrêter";
  const exec = value?.acceptWithExecpolicyAmendment?.execpolicy_amendment;
  if (exec) return `Autoriser et mémoriser la règle: ${exec.join(" ")}`;
  const network = value?.applyNetworkPolicyAmendment?.network_policy_amendment;
  if (network) return `${network.action === "allow" ? "Autoriser" : "Bloquer"} ${network.host} à l'avenir`;
  return "";
}

export function serverRequestDecisions(request) {
  if (!["command", "file"].includes(request.kind)) return [];
  const legacy = request.method === "execCommandApproval" || request.method === "applyPatchApproval";
  let values = legacy ? ["approved", "approved_for_session", { denied: { rejection: "Refusé par l'utilisateur." } }, "abort"] : ["accept", "acceptForSession", "decline", "cancel"];
  if (Array.isArray(request.availableDecisions)) values = request.availableDecisions;
  else if (request.kind === "command" && !legacy) {
    if (request.proposedExecpolicyAmendment?.length) values.splice(2, 0, { acceptWithExecpolicyAmendment: { execpolicy_amendment: request.proposedExecpolicyAmendment } });
    for (const amendment of request.proposedNetworkPolicyAmendments ?? []) values.splice(values.length - 2, 0, { applyNetworkPolicyAmendment: { network_policy_amendment: amendment } });
  }
  return values.map((value) => ({ value: copy(value), label: decisionLabel(value) })).filter((entry) => entry.label);
}

function permissionPathLabel(path) {
  if (!object(path)) throw new Error("Chemin de permission invalide.");
  if (path.type === "path" && typeof path.path === "string") return path.path;
  if (path.type === "glob_pattern" && typeof path.pattern === "string") return path.pattern;
  if (path.type === "special" && typeof path.value?.kind === "string") return [path.value.kind, path.value.path, path.value.subpath].filter(Boolean).join(" / ");
  throw new Error("Chemin de permission invalide.");
}

export function permissionChoices(profile) {
  if (!object(profile) || Object.keys(profile).some((key) => !["fileSystem", "network"].includes(key))) throw new Error("Profil de permissions invalide.");
  const result = [];
  if (profile.network != null) {
    if (!object(profile.network) || Object.keys(profile.network).some((key) => key !== "enabled") || profile.network.enabled != null && typeof profile.network.enabled !== "boolean") throw new Error("Permission réseau invalide.");
    if (profile.network.enabled === true) result.push({ id: "network", label: "Accès réseau", value: true });
  }
  const fs = profile.fileSystem;
  if (fs != null) {
    if (!object(fs) || Object.keys(fs).some((key) => !["entries", "read", "write", "globScanMaxDepth"].includes(key))) throw new Error("Permissions de fichiers invalides.");
    for (const key of ["entries", "read", "write"]) {
      if (fs[key] != null && !Array.isArray(fs[key])) throw new Error("Permissions de fichiers invalides.");
      for (const [index, value] of (fs[key] ?? []).entries()) {
        if (key === "entries") {
          if (!object(value) || !["read", "write", "deny"].includes(value.access)) throw new Error("Mode d'accès de fichier invalide.");
          result.push({ id: `${key}:${index}`, label: `${value.access === "write" ? "Écriture" : value.access === "read" ? "Lecture" : "Interdiction"}: ${permissionPathLabel(value.path)}`, value: copy(value), fixed: value.access === "deny" });
        } else {
          if (typeof value !== "string") throw new Error("Chemin de permission invalide.");
          result.push({ id: `${key}:${index}`, label: `${key === "write" ? "Écriture" : "Lecture"}: ${value}`, value });
        }
      }
    }
    if (fs.globScanMaxDepth != null && (!Number.isSafeInteger(fs.globScanMaxDepth) || fs.globScanMaxDepth < 1)) throw new Error("Profondeur de recherche invalide.");
  }
  return result;
}

export function permissionsFromChoices(profile, ids) {
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) throw new Error("Sélection de permissions invalide.");
  const choices = permissionChoices(profile);
  const selected = new Set(ids);
  if (ids.some((id) => !choices.some((choice) => choice.id === id))) throw new Error("Une permission non demandée ne peut pas être accordée.");
  const result = {};
  if (selected.has("network")) result.network = { enabled: true };
  const fs = {};
  for (const key of ["entries", "read", "write"]) {
    const values = choices.filter((choice) => choice.id.startsWith(`${key}:`) && (selected.has(choice.id) || choice.fixed)).map((choice) => copy(choice.value));
    if (values.length) fs[key] = values;
  }
  if (Object.keys(fs).length) {
    if (profile.fileSystem.globScanMaxDepth != null) fs.globScanMaxDepth = profile.fileSystem.globScanMaxDepth;
    result.fileSystem = fs;
  }
  return result;
}

function permissionsSubset(requested, granted) {
  const wanted = permissionChoices(requested);
  const actual = permissionChoices(granted);
  if (actual.some((choice) => !wanted.some((candidate) => choice.id === "network" ? candidate.id === "network" : candidate.id.split(":")[0] === choice.id.split(":")[0] && same(candidate.value, choice.value)))) return false;
  if (granted.fileSystem?.globScanMaxDepth != null && granted.fileSystem.globScanMaxDepth !== requested.fileSystem?.globScanMaxDepth) return false;
  // Removing a deny entry can widen a selected grant. Always retain restrictions.
  const restrictions = wanted.filter((choice) => choice.fixed);
  return !actual.some((choice) => choice.id !== "network" && !choice.fixed) || restrictions.every((restriction) => actual.some((choice) => same(restriction.value, choice.value)));
}

export function elicitationFieldOptions(schema = {}) {
  const options = schema.oneOf ?? schema.anyOf;
  if (Array.isArray(schema.enum)) return schema.enum.map((value, index) => ({ value, label: schema.enumNames?.[index] ?? String(value) }));
  if (Array.isArray(options) && options.every((entry) => object(entry) && Object.hasOwn(entry, "const"))) return options.map((entry) => ({ value: entry.const, label: entry.title ?? String(entry.const) }));
  return [];
}

export function validateElicitationContent(schema, value) {
  const errors = [];
  const root = schema;
  function check(s, v, path, depth = 0) {
    const start = errors.length;
    const fail = (message) => errors.push(`${path || "Formulaire"}: ${message}`);
    if (depth > 40) { fail("schéma trop complexe"); return false; }
    if (s === true) return true;
    if (s === false) { fail("valeur interdite"); return false; }
    if (!object(s)) { fail("schéma invalide"); return false; }
    if (s.$ref) {
      if (!s.$ref.startsWith("#/")) { fail("référence de schéma externe non prise en charge"); return false; }
      const target = s.$ref.slice(2).split("/").reduce((node, part) => node?.[part.replace(/~1/g, "/").replace(/~0/g, "~")], root);
      check(target, v, path, depth + 1);
    }
    for (const entry of s.allOf ?? []) check(entry, v, path, depth + 1);
    for (const key of ["anyOf", "oneOf"]) {
      if (!Array.isArray(s[key])) continue;
      let matches = 0;
      for (const entry of s[key]) {
        const before = errors.length;
        const valid = check(entry, v, path, depth + 1);
        errors.splice(before);
        if (valid) matches++;
      }
      if (key === "oneOf" ? matches !== 1 : matches === 0) fail("valeur incompatible avec les choix autorisés");
    }
    if (s.not) {
      const before = errors.length; const valid = check(s.not, v, path, depth + 1); errors.splice(before);
      if (valid) fail("valeur interdite");
    }
    if (Object.hasOwn(s, "const") && !same(s.const, v)) fail("valeur différente du choix attendu");
    if (Array.isArray(s.enum) && !s.enum.some((entry) => same(entry, v))) fail("choix non autorisé");
    const types = s.type ? Array.isArray(s.type) ? s.type : [s.type] : [];
    const matchesType = (type) => type === "null" ? v === null : type === "object" ? object(v) : type === "array" ? Array.isArray(v) : type === "integer" ? Number.isSafeInteger(v) : type === "number" ? typeof v === "number" && Number.isFinite(v) : typeof v === type;
    if (types.length && !types.some(matchesType)) { fail(`type attendu: ${types.join(" / ")}`); return false; }
    if (object(v)) {
      for (const key of s.required ?? []) if (!Object.hasOwn(v, key)) errors.push(`${path ? `${path}.` : ""}${key}: champ obligatoire`);
      for (const [key, entry] of Object.entries(v)) {
        const next = path ? `${path}.${key}` : key;
        if (Object.hasOwn(s.properties ?? {}, key)) check(s.properties[key], entry, next, depth + 1);
        else if (s.additionalProperties === false) errors.push(`${next}: champ non autorisé`);
        else if (object(s.additionalProperties)) check(s.additionalProperties, entry, next, depth + 1);
      }
      if (s.minProperties != null && Object.keys(v).length < s.minProperties) fail("nombre de champs insuffisant");
      if (s.maxProperties != null && Object.keys(v).length > s.maxProperties) fail("trop de champs");
    }
    if (Array.isArray(v)) {
      if (s.minItems != null && v.length < s.minItems) fail(`sélectionnez au moins ${s.minItems} valeur(s)`);
      if (s.maxItems != null && v.length > s.maxItems) fail(`sélectionnez au plus ${s.maxItems} valeur(s)`);
      if (s.uniqueItems && v.some((entry, index) => v.slice(0, index).some((previous) => same(previous, entry)))) fail("valeurs dupliquées");
      if (s.items) v.forEach((entry, index) => check(Array.isArray(s.items) ? s.items[index] ?? s.additionalItems ?? true : s.items, entry, `${path}[${index}]`, depth + 1));
    }
    if (typeof v === "number") {
      if (s.minimum != null && v < s.minimum || s.maximum != null && v > s.maximum) fail("valeur hors des limites autorisées");
      if (typeof s.exclusiveMinimum === "number" && v <= s.exclusiveMinimum || typeof s.exclusiveMaximum === "number" && v >= s.exclusiveMaximum) fail("valeur hors des limites autorisées");
      if (s.multipleOf != null && Math.abs(v / s.multipleOf - Math.round(v / s.multipleOf)) > 1e-8) fail("valeur incompatible avec le pas demandé");
    }
    if (typeof v === "string") {
      const length = [...v].length;
      if (s.minLength != null && length < s.minLength || s.maxLength != null && length > s.maxLength) fail("longueur de texte invalide");
      if (s.pattern) { try { if (!new RegExp(s.pattern).test(v)) fail("format de texte invalide"); } catch { fail("règle de validation invalide"); } }
      if (s.format === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) fail("adresse e-mail invalide");
      if (s.format === "uri") { try { new URL(v); } catch { fail("adresse invalide"); } }
      if (s.format === "date" && (!/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString().slice(0, 10) !== v)) fail("date invalide");
      if (s.format === "date-time") {
        const parts = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/i.exec(v);
        const day = parts?.[1];
        if (!parts || Number(parts[2]) > 23 || Number(parts[3]) > 59 || Number(parts[4]) > 59 || parts[5] && (Number(parts[6]) > 23 || Number(parts[7]) > 59) || !Number.isFinite(Date.parse(v)) || !Number.isFinite(Date.parse(day)) || new Date(day).toISOString().slice(0, 10) !== day) fail("date et heure invalides");
      }
    }
    return errors.length === start;
  }
  check(schema, value, "");
  return errors;
}

export function serverRequestResponse(request, response) {
  if (request.kind === "command" || request.kind === "file") {
    let value = object(response) && Object.hasOwn(response, "decision") ? response.decision : response;
    const legacy = request.method === "execCommandApproval" || request.method === "applyPatchApproval";
    const aliases = legacy ? { accept: "approved", allow: "approved", acceptForSession: "approved_for_session", allow_session: "approved_for_session", decline: { denied: { rejection: "Refusé par l'utilisateur." } }, denied: { denied: { rejection: "Refusé par l'utilisateur." } }, cancel: "abort" } : { approved: "accept", allow: "accept", approved_for_session: "acceptForSession", allow_session: "acceptForSession", denied: "decline" };
    if (typeof value === "string" && Object.hasOwn(aliases, value)) value = aliases[value];
    if (!serverRequestDecisions(request).some((entry) => same(entry.value, value))) throw new Error("Cette décision n'est pas proposée par Codex.");
    return { decision: copy(value) };
  }
  if (!object(response)) throw new Error("Réponse Codex invalide.");
  if (request.kind === "user-input") {
    if (!object(response.answers)) throw new Error("Réponses aux questions invalides.");
    const known = new Map(request.questions.map((q) => [q.id, q]));
    const answers = Object.fromEntries(Object.entries(response.answers).map(([id, answer]) => {
      const q = known.get(id);
      if (!q || !object(answer) || !Array.isArray(answer.answers) || answer.answers.some((value) => typeof value !== "string")) throw new Error("Réponse de question invalide.");
      if (q.options.length && !q.isOther && answer.answers.some((value) => !q.options.some((option) => option.label === value))) throw new Error("Choisissez une des réponses proposées.");
      return [id, { answers: [...answer.answers] }];
    }));
    return { answers };
  }
  if (request.kind === "permissions") {
    const granted = Object.hasOwn(response, "selectedPermissions") ? permissionsFromChoices(request.permissions, response.selectedPermissions) : response.permissions;
    if (!object(granted) || !permissionsSubset(request.permissions, granted)) throw new Error("Les accès accordés doivent être un sous-ensemble des accès demandés.");
    const scope = response.scope ?? "turn";
    if (!["turn", "session"].includes(scope)) throw new Error("Durée de permission invalide.");
    if (response.strictAutoReview != null && typeof response.strictAutoReview !== "boolean") throw new Error("Paramètre de contrôle invalide.");
    return { permissions: copy(granted), scope, ...(response.strictAutoReview == null ? {} : { strictAutoReview: response.strictAutoReview }) };
  }
  if (!["accept", "decline", "cancel"].includes(response.action)) throw new Error("Action MCP invalide.");
  if (response.action !== "accept") return { action: response.action };
  if (request.mode === "url") return { action: "accept" };
  const errors = validateElicitationContent(request.requestedSchema, response.content);
  if (errors.length) throw new Error(errors.join("\n"));
  return { action: "accept", content: copy(response.content) };
}
