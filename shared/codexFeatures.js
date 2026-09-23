/** Values in this module come from the Codex app-server catalog, not a model preset. */
export function advertisedModels(response) {
  return (Array.isArray(response?.data) ? response.data : []).filter((model) => model && typeof model.model === "string").map((model) => ({
    id: String(model.id || model.model),
    model: model.model,
    displayName: String(model.displayName || model.model),
    description: String(model.description || ""),
    isDefault: Boolean(model.isDefault),
    hidden: Boolean(model.hidden),
    defaultReasoningEffort: String(model.defaultReasoningEffort || ""),
    supportedReasoningEfforts: (Array.isArray(model.supportedReasoningEfforts) ? model.supportedReasoningEfforts : []).filter((entry) => entry && typeof entry.reasoningEffort === "string" && entry.reasoningEffort).map((entry) => ({ reasoningEffort: entry.reasoningEffort, description: String(entry.description || "") })),
    serviceTiers: (Array.isArray(model.serviceTiers) ? model.serviceTiers : []).filter((tier) => tier && typeof tier.id === "string" && tier.id).map((tier) => ({ id: tier.id, name: String(tier.name || tier.id), description: String(tier.description || "") })),
    defaultServiceTier: typeof model.defaultServiceTier === "string" ? model.defaultServiceTier : null,
    inputModalities: (Array.isArray(model.inputModalities) ? model.inputModalities : []).filter((value) => ["text", "image", "audio"].includes(value)),
    multiAgentVersion: typeof model.multiAgentVersion === "string" ? model.multiAgentVersion : null
  }));
}

export function rateLimitWindows(response) {
  const buckets = response?.rateLimitsByLimitId && typeof response.rateLimitsByLimitId === "object"
    ? Object.entries(response.rateLimitsByLimitId)
    : response?.rateLimits ? [[response.rateLimits.limitId || "codex", response.rateLimits]] : [];
  return buckets.flatMap(([id, bucket]) => ["primary", "secondary"].flatMap((kind) => {
    const window = bucket?.[kind];
    // Missing usage is unavailable, never zero percent used.
    if (!window || typeof window.usedPercent !== "number" || !Number.isFinite(window.usedPercent)) return [];
    return [{
      id: `${id}:${kind}`, bucketId: id, name: bucket.limitName || id, kind,
      remainingPercent: Math.max(0, Math.min(100, 100 - window.usedPercent)),
      windowDurationMins: typeof window.windowDurationMins === "number" ? window.windowDurationMins : null,
      resetsAt: typeof window.resetsAt === "number" ? window.resetsAt : null
    }];
  }));
}

export function advertisedOptionPatch(models, current, patch) {
  const next = { ...current, ...patch };
  const model = models.find((entry) => entry.model === next.model) || (!next.model ? models.find((entry) => entry.isDefault) : null);
  if (next.model && !model) throw new Error("Ce modèle n’est pas annoncé par votre serveur Codex.");
  if (Object.hasOwn(patch, "model")) {
    if (!model?.supportedReasoningEfforts.some((entry) => entry.reasoningEffort === next.reasoningEffort)) next.reasoningEffort = "";
    if (!model?.serviceTiers.some((entry) => entry.id === next.serviceTier)) next.serviceTier = "";
  }
  if (next.reasoningEffort && model && !model.supportedReasoningEfforts.some((entry) => entry.reasoningEffort === next.reasoningEffort)) throw new Error("Ce niveau de raisonnement n’est pas annoncé pour ce modèle.");
  if (next.serviceTier && (!model || !model.serviceTiers.some((entry) => entry.id === next.serviceTier))) throw new Error("Ce niveau de service n’est pas annoncé pour ce modèle.");
  return next;
}

export const codexSurfaceLimits = Object.freeze([
  { feature: "Plugins", status: "under-development", detail: "Les méthodes plugin/list et plugin/install restent en développement dans la documentation officielle. La gestion se fait dans Codex ; les activités installées sont listées ici." },
  { feature: "Automatisations et tâches cloud", status: "desktop-only", detail: "L’API locale app-server n’expose pas le planificateur ni les tâches cloud de l’application Codex." },
  { feature: "Épinglage", status: "not-advertised", detail: "Le schéma local expose des sections de tâches, sans opération publique d’épinglage. Les favoris Messenger restent locaux." },
  { feature: "Voix temps réel", status: "experimental", detail: "Les appels utilisent les méthodes thread/realtime du serveur lorsqu’elles sont activées et acceptées pour votre compte." },
  { feature: "Navigateur et contrôle de l’ordinateur", status: "runtime-dependent", detail: "Disponibles seulement si le modèle, les outils installés et la politique de votre environnement les exposent." }
]);
