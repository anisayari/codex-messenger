import React, { useEffect, useRef, useState } from "react";
import { advertisedOptionPatch, rateLimitWindows } from "../shared/codexFeatures.js";
import "./codexFeaturesPanel.css";
import { useModalFocus } from "./useModalFocus.js";

const tabs = [
  ["account", "Mon compte"], ["options", "Options Codex"], ["skills", "Activités"], ["connections", "Connexions"], ["thread", "Conversation"], ["search", "Rechercher"], ["usage", "Mon usage"]
];
const goalStatusLabels = { active: "En cours", paused: "En pause", blocked: "Bloqué", usageLimited: "Limite d’utilisation", budgetLimited: "Budget atteint", complete: "Terminé" };

function queuedMessageText(submission) {
  return (submission?.input || []).map((item) => item.type === "text" ? item.text : "[" + item.type + "]").join("\n");
}

function usageCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value.toLocaleString() : "Non renseigné";
}

function usageMicros(value, usd = false) {
  if (!Number.isSafeInteger(value) || value < 0) return "Non renseigné";
  return usd ? (value / 1000000).toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 6 }) : (value / 1000000).toLocaleString(undefined, { maximumFractionDigits: 6 });
}

function SearchSnippet({ occurrence }) {
  const snippet = occurrence?.snippet || "";
  const range = occurrence?.snippetMatchRange;
  if (!Number.isInteger(range?.start) || !Number.isInteger(range?.end) || range.start < 0 || range.end < range.start || range.end > snippet.length) return <p style={{ whiteSpace: "pre-wrap" }}>{snippet}</p>;
  return <p style={{ whiteSpace: "pre-wrap" }}>{snippet.slice(0, range.start)}<mark>{snippet.slice(range.start, range.end)}</mark>{snippet.slice(range.end)}</p>;
}

function SectionStatus({ section, children, empty = "Aucune information disponible." }) {
  if (!section) return <p className="codex-feature-note">{empty}</p>;
  if (!section.available) return <p className="codex-feature-error" role="status">{section.status === "unsupported" ? "Cette version de Codex ne propose pas cette fonction. " : "Codex n’a pas pu charger cette information. "}{section.error}</p>;
  return children;
}

function LimitMeter({ window }) {
  const duration = window.windowDurationMins;
  const label = duration === 300 ? "5 heures" : duration === 10080 ? "7 jours" : duration ? `${duration} min` : window.kind === "primary" ? "Fenêtre principale" : "Fenêtre secondaire";
  return <div className="codex-feature-limit">
    <div><strong>{window.name} · {label}</strong><span>{window.remainingPercent} % restants</span></div>
    <progress max="100" value={window.remainingPercent} aria-label={`${window.name}, ${label}, quota restant`} />
    {window.resetsAt ? <small>Renouvellement : {new Date(window.resetsAt * 1000).toLocaleString()}</small> : null}
  </div>;
}

export default function CodexFeaturesPanel({ api, contact, threadId, onInsertSkill, onThreadChanged, onOptionsChange, effectiveCollaborationMode, onClose }) {
  const [tab, setTab] = useState("account");
  const [catalog, setCatalog] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [filter, setFilter] = useState("");
  const [options, setOptions] = useState(contact?.codexOptions || {});
  const [objective, setObjective] = useState("");
  const [budget, setBudget] = useState("");
  const [resetConfirmation, setResetConfirmation] = useState(false);
  const [logoutConfirmation, setLogoutConfirmation] = useState(false);
  const [pendingLogin, setPendingLogin] = useState(null);
  const [queueDraft, setQueueDraft] = useState("");
  const [queueEditingId, setQueueEditingId] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchScope, setSearchScope] = useState("current");
  const [searchArchived, setSearchArchived] = useState(false);
  const [searchResults, setSearchResults] = useState(null);
  const [historyConfirmation, setHistoryConfirmation] = useState(null);
  const resetAttempt = useRef(null);
  const dialogRef = useRef(null);
  useModalFocus(dialogRef, onClose);
  const generation = useRef(0);
  const fetchGeneration = useRef(0);
  const contactId = contact?.id || null;
  const resolvedThreadId = threadId || contact?.threadId || null;
  const context = { contactId, threadId: resolvedThreadId };
  const sections = catalog?.sections || {};
  const models = sections.models?.data?.data || [];
  const model = models.find((entry) => entry.model === options.model) || (!options.model ? models.find((entry) => entry.isDefault) : null);
  const goal = sections.goal?.data?.goal;
  const reportedMode = effectiveCollaborationMode !== undefined ? effectiveCollaborationMode : catalog?.localState?.observedCollaborationMode;
  const observedMode = reportedMode && ["plan", "default"].includes(reportedMode.mode) && typeof reportedMode.settings?.model === "string" && reportedMode.settings.model ? reportedMode : null;
  const profiles = sections.permissionProfiles?.data?.data || [];
  const requirements = sections.requirements?.data?.requirements;
  const skills = sections.skills?.data?.data || [];
  const apps = sections.apps?.data?.data || [];
  const installedApps = sections.installedApps?.data?.apps || [];
  const servers = sections.mcpServers?.data?.data || [];
  const modes = sections.collaborationModes?.data?.data || [];
  const terminals = sections.backgroundTerminals?.data?.data || [];
  const queue = sections.queue?.data?.data || [];
  const pendingQueue = catalog?.localState?.pendingQueueSubmission;
  const threadMetadata = sections.thread?.data?.thread;
  const queueActive = threadMetadata?.status?.type === "active";
  const historyTail = sections.historyTail?.data;
  const windows = rateLimitWindows(sections.rateLimits?.data);
  const usageSummary = sections.accountUsage?.data?.summary;
  const dailyUsage = sections.accountUsage?.data?.dailyUsageBuckets;
  const usageBuckets = Array.isArray(dailyUsage) ? [...dailyUsage].sort((a, b) => String(a.startDate).localeCompare(String(b.startDate))).slice(-31) : null;
  const estimatedThreadUsage = sections.threadUsage?.data?.threadUsage;
  const plugins = sections.plugins?.data?.data || [];
  const canChangeOptions = Boolean(onOptionsChange) && !busy;

  async function refresh(force = false, clearError = true) {
    const contextGeneration = generation.current;
    const requestGeneration = ++fetchGeneration.current;
    const isCurrent = () => contextGeneration === generation.current && requestGeneration === fetchGeneration.current;
    setLoading(true);
    if (clearError) setError("");
    try {
      if (!api?.codexFeatures) throw new Error("Le panneau Codex nécessite la connexion locale à l’application Messenger.");
      const result = await api.codexFeatures({ ...context, force });
      if (isCurrent()) setCatalog(result);
    } catch (cause) { if (isCurrent()) setError(cause.message); }
    finally { if (isCurrent()) setLoading(false); }
  }

  useEffect(() => {
    setCatalog(null);
    setOptions(contact?.codexOptions || {});
    setObjective("");
    setBudget("");
    setResetConfirmation(false);
    setLogoutConfirmation(false);
    setPendingLogin(null);
    setQueueDraft("");
    setQueueEditingId(null);
    setSearchTerm("");
    setSearchScope(resolvedThreadId ? "current" : "contact");
    setSearchArchived(false);
    setSearchResults(null);
    setHistoryConfirmation(null);
    resetAttempt.current = null;
    refresh();
    return () => { generation.current += 1; };
  }, [api, contactId, resolvedThreadId]);

  useEffect(() => { setOptions(contact?.codexOptions || {}); }, [contact?.codexOptions]);
  useEffect(() => {
    if (catalog?.localState?.pendingResetAttempt) { resetAttempt.current = catalog.localState.pendingResetAttempt; setResetConfirmation(true); }
  }, [catalog?.localState?.pendingResetAttempt]);
  useEffect(() => { setHistoryConfirmation(null); }, [historyTail?.lastTurn?.id]);
  useEffect(() => { setObjective(goal?.objective || ""); setBudget(goal?.tokenBudget == null ? "" : String(goal.tokenBudget)); }, [goal?.objective, goal?.tokenBudget]);

  useEffect(() => {
    if (!api?.on) return;
    try {
      return api.on("codex:account-updated", (event) => { setPendingLogin(null); setLogoutConfirmation(false); if (event?.error) setNotice(event.error); refresh(); });
    } catch { /* Older Messenger preload does not expose this notification. */ }
  }, [api, contactId, resolvedThreadId]);

  useEffect(() => {
    if (!api?.on) return;
    try { return api.on("codex:queue-updated", (event) => { if (!event?.threadId || event.threadId === resolvedThreadId) refresh(false, false); }); }
    catch { /* Older preload: the Actualiser button still reloads the queue. */ }
  }, [api, contactId, resolvedThreadId]);

  async function runAction(name, payload = {}, after) {
    if (busy) return;
    setBusy(name);
    setError("");
    setNotice("");
    const actionGeneration = generation.current;
    try {
      if (!api?.codexFeatureAction) throw new Error("La connexion Codex est indisponible.");
      const result = await api.codexFeatureAction(name, { ...context, ...payload });
      if (actionGeneration !== generation.current) return;
      if (after) await after(result);
      if (actionGeneration !== generation.current) return;
      if (!["skill-input", "app-input", "mcp-login", "account-login", "search-threads", "search-occurrences", "search-open", "compact"].includes(name)) await refresh();
      return result;
    } catch (cause) {
      if (actionGeneration === generation.current) {
        if (name === "history-revert") {
          setHistoryConfirmation(null);
          try { await onThreadChanged?.({ action: name, threadId: resolvedThreadId, historyChanged: true, uncertain: true }); }
          catch { /* Preserve the original error; the next explicit refresh remains available. */ }
          await refresh(false, false);
        }
        setError(cause.message);
      }
    }
    finally { setBusy(""); }
  }

  async function changeOptions(patch) {
    setError("");
    try {
      const next = advertisedOptionPatch(models, options, patch);
      if (next.collaborationMode && (Object.hasOwn(patch, "model") || Object.hasOwn(patch, "reasoningEffort"))) {
        const selectedModel = models.find((entry) => entry.model === next.model) || models.find((entry) => entry.isDefault);
        next.collaborationMode = { mode: next.collaborationMode.mode, settings: { model: selectedModel?.model, reasoning_effort: next.reasoningEffort || null, developer_instructions: null } };
      }
      await onOptionsChange?.(next);
      setOptions(next);
    } catch (cause) { setError(cause.message); }
  }

  function changeMode(value) {
    const preset = modes.find((entry) => entry.mode === value);
    const modeModel = model?.model || preset?.model;
    if (!value) return changeOptions({ collaborationMode: null });
    if (!preset || !modeModel) { setError("Codex n’a pas annoncé de modèle pour ce mode."); return; }
    return changeOptions({ collaborationMode: { mode: preset.mode, settings: { model: modeModel, reasoning_effort: options.reasoningEffort || null, developer_instructions: null } } });
  }

  function consumeResetCredit() {
    if (!resetConfirmation) { setResetConfirmation(true); return; }
    if (!resetAttempt.current) resetAttempt.current = crypto.randomUUID();
    return runAction("credits-consume", { confirmed: true, idempotencyKey: resetAttempt.current }, (result) => {
      setNotice({ reset: "Un crédit a été utilisé et les fenêtres éligibles ont été réinitialisées.", alreadyRedeemed: "Cette réinitialisation a déjà réussi ; aucun crédit supplémentaire n’a été utilisé.", noCredit: "Aucun crédit disponible. Aucun crédit n’a été utilisé.", nothingToReset: "Aucune fenêtre éligible à réinitialiser. Aucun crédit n’a été utilisé." }[result.outcome] || "Réponse de réinitialisation reçue.");
      setResetConfirmation(false);
      resetAttempt.current = null;
    });
  }

  function navigateTabs(event) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) || event.target.getAttribute("role") !== "tab") return;
    event.preventDefault();
    const current = tabs.findIndex(([id]) => id === tab);
    const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    const id = tabs[next][0];
    setTab(id);
    dialogRef.current?.querySelector("#codex-tab-" + id)?.focus();
  }

  async function submitQueueMessage() {
    const action = queueEditingId ? "queue-update" : "queue-add";
    const payload = queueEditingId ? { queuedSubmissionId: queueEditingId, text: queueDraft } : { text: queueDraft, clientUserMessageId: crypto.randomUUID() };
    const result = await runAction(action, payload, () => setNotice(queueEditingId ? "Message en file modifié." : "Message accepté par la file Codex."));
    if (result) { setQueueDraft(""); setQueueEditingId(null); }
    else await refresh(false, false);
  }

  function moveQueuedMessage(index, offset) {
    const ids = queue.map((submission) => submission.id);
    [ids[index], ids[index + offset]] = [ids[index + offset], ids[index]];
    return runAction("queue-reorder", { queuedSubmissionIds: ids });
  }

  async function searchHistory(more = false) {
    const query = more ? searchResults : { searchTerm: searchTerm.trim(), scope: searchScope, archived: searchArchived };
    if (!query?.searchTerm || (more && !query.nextCursor)) return;
    const name = query.scope === "current" ? "search-occurrences" : "search-threads";
    const result = await runAction(name, { searchTerm: query.searchTerm, ...(query.scope === "contact" ? { archived: query.archived } : {}), ...(more ? { cursor: query.nextCursor } : {}) });
    if (result) setSearchResults({ ...query, data: more ? [...query.data, ...result.data] : result.data, nextCursor: result.nextCursor });
    else if (!more) setSearchResults(null);
  }

  function revertLatestHistory() {
    const expectedLastTurnId = historyConfirmation;
    setHistoryConfirmation(null);
    return runAction("history-revert", { confirmed: true, expectedLastTurnId }, async (result) => {
      await onThreadChanged?.({ action: "history-revert", threadId: resolvedThreadId, historyChanged: true, uncertain: false, result });
      setNotice("Dernier échange retiré de l’historique Codex. Les modifications de fichiers sont conservées.");
    });
  }

  async function beginAccountLogin(result) {
    setPendingLogin(result);
    if (result.authUrl && api.openExternal) await api.openExternal(result.authUrl);
    else if (result.authUrl) setNotice(`Ouvrez cette adresse pour vous connecter : ${result.authUrl}`);
  }

  return <div className="settings-dialog-backdrop codex-features-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose?.()}>
    <section ref={dialogRef} className="settings-dialog codex-features-dialog" role="dialog" aria-modal="true" aria-labelledby="codex-features-title">
      <header><strong id="codex-features-title">Codex Messenger · Services et activités</strong><button type="button" aria-label="Fermer" onClick={onClose}>×</button></header>
      <nav className="codex-feature-tabs" role="tablist" aria-label="Services Codex" onKeyDown={navigateTabs}>{tabs.map(([id, label]) => <button key={id} id={`codex-tab-${id}`} role="tab" tabIndex={tab === id ? 0 : -1} aria-selected={tab === id} aria-controls={`codex-panel-${id}`} type="button" onClick={() => setTab(id)}>{label}</button>)}</nav>
      <div className="codex-feature-body" role="tabpanel" id={`codex-panel-${tab}`} aria-labelledby={`codex-tab-${tab}`} aria-busy={loading}>
        {loading ? <p className="codex-feature-note" role="status">Connexion aux services Codex…</p> : null}
        {error ? <p className="codex-feature-error" role="alert">{error}</p> : null}
        {notice ? <p className="codex-feature-note" role="status">{notice}</p> : null}
        {tab === "account" ? <>
          <fieldset><legend>Carte de membre Codex</legend><SectionStatus section={sections.account}>
            {sections.account?.data?.account ? <>
              <dl className="codex-feature-details"><dt>Connexion</dt><dd>{sections.account.data.account.type === "chatgpt" ? "ChatGPT" : sections.account.data.account.type === "apiKey" ? "Clé API" : sections.account.data.account.type}</dd>{sections.account.data.account.email ? <><dt>Compte</dt><dd>{sections.account.data.account.email}</dd></> : null}{sections.account.data.account.planType ? <><dt>Offre</dt><dd>{sections.account.data.account.planType}</dd></> : null}</dl>
              {logoutConfirmation ? <p className="codex-feature-note">Cette déconnexion concerne le compte Codex sur cet ordinateur.</p> : null}
              <div className="codex-feature-buttons"><button type="button" disabled={Boolean(busy)} onClick={() => logoutConfirmation ? runAction("account-logout", { confirmed: true }, () => { setLogoutConfirmation(false); setNotice("Compte Codex déconnecté."); }) : setLogoutConfirmation(true)}>{logoutConfirmation ? "Confirmer la déconnexion de Codex" : "Se déconnecter de Codex"}</button>{logoutConfirmation ? <button type="button" disabled={Boolean(busy)} onClick={() => setLogoutConfirmation(false)}>Annuler</button> : null}</div>
            </> : <><p>Connectez votre compte ChatGPT pour retrouver vos modèles et vos applications.</p><button type="button" disabled={Boolean(busy) || Boolean(pendingLogin)} onClick={() => runAction("account-login", {}, beginAccountLogin)}>Se connecter avec ChatGPT</button></>}
            {pendingLogin?.loginId ? <div className="codex-feature-buttons"><span className="codex-feature-note">Terminez la connexion dans votre navigateur, puis actualisez ce panneau.</span><button type="button" disabled={Boolean(busy)} onClick={() => runAction("account-login-cancel", { loginId: pendingLogin.loginId }, () => { setPendingLogin(null); setNotice("Connexion annulée."); })}>Annuler la connexion</button></div> : null}
          </SectionStatus></fieldset>
          <fieldset><legend>Utilisation de votre compte</legend><SectionStatus section={sections.rateLimits}>
            {windows.length ? windows.map((window) => <LimitMeter key={window.id} window={window} />) : <p>Le serveur ne fournit pas de quota pour ce compte.</p>}
            {sections.rateLimits?.data?.ordinaryUsageAllowed === false ? <p className="codex-feature-error">Le serveur indique que l’utilisation incluse est actuellement suspendue pour ce compte.</p> : null}
            {sections.rateLimits?.data?.rateLimitResetCredits?.availableCount > 0 || catalog?.localState?.pendingResetAttempt ? <div>
              <p>{sections.rateLimits.data.rateLimitResetCredits.availableCount} crédit(s) de réinitialisation disponible(s) dans Codex.</p>
              {resetConfirmation ? <p className="codex-feature-note">{resetAttempt.current ? "Une tentative précédente attend confirmation. La même clé vérifiera le résultat sans consommer un deuxième crédit." : "Confirmez l’utilisation d’un crédit pour réinitialiser les fenêtres éligibles. Cette action consomme le crédit."}</p> : null}
              <div className="codex-feature-buttons"><button type="button" disabled={Boolean(busy) || (!resetAttempt.current && !windows.some((window) => window.bucketId === "codex" && window.remainingPercent <= 10))} onClick={consumeResetCredit}>{resetConfirmation ? resetAttempt.current ? "Réessayer cette réinitialisation" : "Confirmer : utiliser un crédit" : "Utiliser un crédit de réinitialisation"}</button>{resetConfirmation ? <button type="button" disabled={Boolean(busy) || Boolean(resetAttempt.current)} onClick={() => setResetConfirmation(false)}>Annuler</button> : null}</div>
            </div> : null}
          </SectionStatus></fieldset>
        </> : null}
        {tab === "options" ? <>
          <fieldset><legend>Options de la conversation</legend><SectionStatus section={sections.models}>
            <label className="settings-row"><span>Modèle</span><select disabled={!canChangeOptions} value={options.model || ""} onChange={(event) => changeOptions({ model: event.target.value })}><option value="">Automatique · configuration Codex</option>{options.model && !models.some((entry) => entry.model === options.model) ? <option value={options.model}>{options.model} · non annoncé</option> : null}{models.map((entry) => <option key={entry.id} value={entry.model}>{entry.displayName}{entry.isDefault ? " · par défaut" : ""}</option>)}</select></label>
            {model?.description ? <p className="codex-feature-note">{model.description}</p> : null}
            <label className="settings-row"><span>Raisonnement</span><select disabled={!canChangeOptions || !model} value={options.reasoningEffort || ""} onChange={(event) => changeOptions({ reasoningEffort: event.target.value })}><option value="">Automatique</option>{options.reasoningEffort && !model?.supportedReasoningEfforts.some((entry) => entry.reasoningEffort === options.reasoningEffort) ? <option value={options.reasoningEffort}>{options.reasoningEffort} · non annoncé</option> : null}{model?.supportedReasoningEfforts.map((entry) => <option key={entry.reasoningEffort} value={entry.reasoningEffort}>{entry.reasoningEffort}{entry.description ? ` · ${entry.description}` : ""}</option>)}</select></label>
            <label className="settings-row"><span>Niveau de service</span><select disabled={!canChangeOptions || !model?.serviceTiers.length} value={options.serviceTier || ""} onChange={(event) => changeOptions({ serviceTier: event.target.value })}><option value="">Automatique</option>{options.serviceTier && !model?.serviceTiers.some((entry) => entry.id === options.serviceTier) ? <option value={options.serviceTier}>{options.serviceTier} · non annoncé</option> : null}{model?.serviceTiers.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
            {model ? <p className="codex-feature-note">Entrées annoncées : {model.inputModalities.length ? model.inputModalities.join(", ") : "non renseignées"}{model.multiAgentVersion && model.multiAgentVersion !== "disabled" ? ` · agents ${model.multiAgentVersion}` : ""}.</p> : null}
          </SectionStatus></fieldset>
          <fieldset><legend>Outils du fournisseur</legend><SectionStatus section={sections.providerCapabilities}>
            <dl className="codex-feature-details">{[["webSearch", "Recherche Web"], ["imageGeneration", "Création d’images"], ["namespaceTools", "Outils regroupés"]].map(([key, label]) => <React.Fragment key={key}><dt>{label}</dt><dd>{sections.providerCapabilities?.data?.[key] === true ? "Pris en charge" : sections.providerCapabilities?.data?.[key] === false ? "Non pris en charge" : "Non renseigné"}</dd></React.Fragment>)}</dl><p className="codex-feature-note">L’accès dépend aussi des outils et permissions de la conversation.</p>
          </SectionStatus></fieldset>
          <fieldset><legend>Mode de collaboration</legend><SectionStatus section={sections.collaborationModes}>
            <p className="codex-feature-note">{observedMode ? `Mode observé lors de la reprise : ${observedMode.mode === "plan" ? "Plan" : "Default"} · ${observedMode.settings.model} · raisonnement ${observedMode.settings.reasoning_effort || "non renseigné"}.` : "Mode du moteur non observé lors d’une reprise."} Vos choix ci-dessous restent indépendants de cette observation.</p>
            <label className="settings-row"><span>Mode</span><select disabled={!canChangeOptions} value={options.collaborationMode?.mode || ""} onChange={(event) => changeMode(event.target.value)}><option value="">Configuration Codex</option>{modes.filter((entry) => ["plan", "default"].includes(entry.mode)).map((entry) => <option key={entry.mode} value={entry.mode}>{entry.name}</option>)}</select></label>
            <p className="codex-feature-note">Plan prépare le travail ; Default permet à Codex de l’exécuter. Le mode est envoyé avec votre prochain message.</p>
          </SectionStatus></fieldset>
          <fieldset><legend>Permissions disponibles</legend><SectionStatus section={sections.permissionProfiles}>
            <label className="settings-row"><span>Profil</span><select disabled={!canChangeOptions} value={options.permissions || ""} onChange={(event) => changeOptions({ permissions: event.target.value })}><option value="">Réglage de sandbox de Messenger</option>{profiles.map((profile) => <option key={profile.id} value={profile.id} disabled={!profile.allowed}>{profile.id}{profile.allowed ? "" : " · interdit"}</option>)}</select></label>
            {profiles.find((profile) => profile.id === options.permissions)?.description ? <p className="codex-feature-note">{profiles.find((profile) => profile.id === options.permissions).description}</p> : null}
          </SectionStatus><SectionStatus section={sections.requirements}>{requirements ? <p className="codex-feature-note">Politique gérée active.{requirements.allowedSandboxModes ? ` Sandbox autorisées : ${requirements.allowedSandboxModes.join(", ")}.` : ""}{requirements.allowedApprovalPolicies ? ` Approbations : ${requirements.allowedApprovalPolicies.map((entry) => typeof entry === "string" ? entry : "granulaires").join(", ")}.` : ""}</p> : <p className="codex-feature-note">Aucune politique gérée supplémentaire annoncée.</p>}</SectionStatus></fieldset>
        </> : null}
        {tab === "skills" ? <>
          <label className="codex-feature-search">Chercher une activité <input type="search" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Nom ou description" /></label>
          <SectionStatus section={sections.skills}><div className="codex-feature-list">{skills.filter((skill) => `${skill.name} ${skill.description}`.toLowerCase().includes(filter.toLowerCase())).map((skill) => <article className="codex-feature-card" key={skill.path}><div><strong>{skill.interface?.displayName || skill.name}</strong><small>{skill.scope} · {skill.enabled ? "Disponible" : "Désactivée"}</small><p>{skill.interface?.shortDescription || skill.shortDescription || skill.description}</p></div><button type="button" disabled={Boolean(busy) || !skill.enabled || !onInsertSkill} onClick={() => runAction("skill-input", { path: skill.path }, async (input) => { await onInsertSkill(input); setNotice(`${skill.name} ajouté au prochain message.`); })}>Ajouter au message</button></article>)}{!skills.length ? <p>Aucune activité installée pour ce dossier.</p> : null}</div>{sections.skills?.data?.errors?.map((failure) => <p className="codex-feature-error" key={failure.path}>{failure.path} : {failure.message}</p>)}</SectionStatus>
        </> : null}
        {tab === "connections" ? <>
          <fieldset><legend>Applications et connecteurs</legend><SectionStatus section={sections.apps}><div className="codex-feature-list">{apps.map((app) => { const installed = installedApps.find((entry) => entry.id === app.id); return <article className="codex-feature-card" key={app.id}><div><strong>{app.name}</strong><small>{installed?.callable ? "Outils actifs" : installed?.enabled ? "Installée · aucun outil actif" : app.isAccessible ? "Accessible · connexion requise" : "Non connectée"}{app.isEnabled === false ? " · désactivée" : ""}</small>{app.description ? <p>{app.description}</p> : null}</div><button type="button" disabled={Boolean(busy) || !installed?.callable || !onInsertSkill} onClick={() => runAction("app-input", { id: app.id }, async (input) => { await onInsertSkill(input); setNotice(`${app.name} ajouté au prochain message.`); })}>Ajouter au message</button></article>; })}{!apps.length ? <p>Aucune application annoncée. Vérifiez votre compte et les connecteurs configurés dans Codex.</p> : null}</div></SectionStatus><SectionStatus section={sections.installedApps} /></fieldset>
          <fieldset><legend>Serveurs MCP</legend><SectionStatus section={sections.mcpServers}><div className="codex-feature-list">{servers.map((server) => <article className="codex-feature-card" key={server.name}><div><strong>{server.serverInfo?.title || server.name}</strong><small>{server.runtimeStatus || "État indisponible"} · {server.authStatus} · {server.tools.length} outil(s)</small>{server.toolsError ? <p className="codex-feature-error">{server.toolsError}</p> : null}{server.serverCapabilities != null ? <details><summary>Capacités annoncées par le serveur</summary><pre className="codex-feature-capabilities">{JSON.stringify(server.serverCapabilities, null, 2)}</pre></details> : <p className="codex-feature-note">Capacités du serveur non renseignées.</p>}{server.tools.length ? <details><summary>Voir les outils</summary><ul>{server.tools.map((tool) => <li key={tool.name}><strong>{tool.title}</strong>{tool.description ? ` — ${tool.description}` : ""}</li>)}</ul></details> : null}</div>{["notLoggedIn", "oAuth"].includes(server.authStatus) ? <button type="button" disabled={Boolean(busy)} onClick={() => runAction("mcp-login", { name: server.name }, async (result) => { if (api.openExternal) await api.openExternal(result.authorizationUrl); else setNotice(`Ouvrez cette adresse pour vous connecter : ${result.authorizationUrl}`); })}>Se connecter</button> : null}</article>)}{!servers.length ? <p>Aucun serveur MCP configuré.</p> : null}</div></SectionStatus><button type="button" disabled={Boolean(busy)} onClick={() => runAction("mcp-reload", {}, () => setNotice("Configuration MCP rechargée."))}>Recharger les connexions</button></fieldset>
        </> : null}
        {tab === "usage" ? <>
          <fieldset><legend>Activité de votre compte Codex</legend><SectionStatus section={sections.accountUsage}>
            <p className="codex-feature-note">Statistiques annoncées par Codex pour le compte connecté. Les valeurs absentes restent non renseignées.</p>
            <dl className="codex-feature-details">{[["lifetimeTokens", "Jetons cumulés"], ["peakDailyTokens", "Maximum quotidien de jetons"], ["currentStreakDays", "Jours consécutifs actuels"], ["longestStreakDays", "Plus longue série de jours"], ["longestRunningTurnSec", "Tour le plus long (secondes)"]].map(([key, label]) => <React.Fragment key={key}><dt>{label}</dt><dd>{usageCount(usageSummary?.[key])}</dd></React.Fragment>)}</dl>
            <p className="codex-feature-note">Activité quotidienne · 31 dates maximum</p>
            {usageBuckets?.length ? <div className="codex-feature-table-scroll"><table className="codex-feature-table"><thead><tr><th scope="col">Date</th><th scope="col">Jetons</th></tr></thead><tbody>{usageBuckets.map((bucket, index) => <tr key={bucket.startDate + ":" + index}><td>{bucket.startDate}</td><td>{usageCount(bucket.tokens)}</td></tr>)}</tbody></table></div> : <p className="codex-feature-note">{usageBuckets ? "Aucune activité quotidienne annoncée." : "Le serveur ne fournit pas d’activité quotidienne."}</p>}
          </SectionStatus></fieldset>
          <fieldset><legend>Usage estimé de cette conversation</legend>{!resolvedThreadId ? <p className="codex-feature-note">Créez une conversation pour consulter son usage estimé.</p> : <SectionStatus section={sections.threadUsage}>
            {estimatedThreadUsage ? <>
              <dl className="codex-feature-details"><dt>Crédits estimés</dt><dd>{usageMicros(estimatedThreadUsage.estimatedUsageCreditsMicros)}</dd><dt>Montant estimé (USD)</dt><dd>{usageMicros(estimatedThreadUsage.estimatedUsageUsdMicros, true)}</dd></dl>
              <p className="codex-feature-note">Estimations renvoyées par Codex ; elles ne constituent pas une facture.</p>
              {estimatedThreadUsage.groups?.length ? <div className="codex-feature-table-scroll"><table className="codex-feature-table"><thead><tr>{["Modèle", "Raisonnement", "Vitesse", "Total", "Entrée", "Cache", "Entrée nouvelle", "Sortie", "Crédits estimés"].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{estimatedThreadUsage.groups.map((group, index) => <tr key={index}><td>{group.model || "Non renseigné"}</td><td>{group.reasoningEffort || "Non renseigné"}</td><td>{group.speed || "Non renseigné"}</td><td>{usageCount(group.totalTokens)}</td><td>{usageCount(group.inputTokens)}</td><td>{usageCount(group.cachedInputTokens)}</td><td>{usageCount(group.netNewInputTokens)}</td><td>{usageCount(group.outputTokens)}</td><td>{usageMicros(group.estimatedUsageCreditsMicros)}</td></tr>)}</tbody></table></div> : <p className="codex-feature-note">Aucun détail par modèle annoncé.</p>}
            </> : <p className="codex-feature-note">Codex ne fournit pas d’estimation pour la facturation de cette conversation.</p>}
          </SectionStatus>}</fieldset>
          <fieldset><legend>Activités et extensions disponibles</legend>
            <SectionStatus section={sections.skills}><p>{skills.length} activité(s) annoncée(s), dont {skills.filter(skill => skill.enabled === true).length} activée(s).</p><button type="button" onClick={() => setTab("skills")}>Ouvrir les activités</button></SectionStatus>
            <SectionStatus section={sections.plugins}><p>{plugins.length} extension(s) installée(s), dont {plugins.filter(plugin => plugin.enabled === true).length} activée(s).</p>{plugins.map(plugin => <article className="codex-feature-card" key={plugin.marketplace + ":" + plugin.id}><div><strong>{plugin.name}</strong><small>{plugin.marketplace}{plugin.version ? " · " + plugin.version : ""} · {plugin.enabled === true ? "Activée" : plugin.enabled === false ? "Désactivée" : "État non renseigné"}</small></div></article>)}{sections.plugins?.data?.errors?.map((issue, index) => <p className="codex-feature-error" key={index}>{issue.message || issue.error || "Codex n’a pas pu charger ce catalogue d’extensions."}</p>)}</SectionStatus>
            <p className="codex-feature-note">Ces inventaires indiquent la disponibilité actuelle. Le serveur ne fournit pas de compteur d’exécution par activité ou extension.</p><button type="button" onClick={() => setTab("connections")}>Ouvrir les connexions</button>
          </fieldset>
        </> : null}
        {tab === "search" ? <fieldset><legend>Recherche dans l’historique Codex</legend>
          <p className="codex-feature-note">Recherche serveur dans les messages utilisateur et les réponses finales persistées. Les conversations affichées appartiennent au contact sélectionné.</p>
          <form onSubmit={(event) => { event.preventDefault(); searchHistory(); }}>
            <label className="codex-feature-search">Texte à rechercher<input type="search" value={searchTerm} maxLength="4096" onChange={(event) => { setSearchTerm(event.target.value); setSearchResults(null); }} /></label>
            <label className="settings-row"><span>Rechercher dans</span><select value={searchScope} disabled={Boolean(busy)} onChange={(event) => { setSearchScope(event.target.value); setSearchResults(null); }}><option value="current" disabled={!resolvedThreadId}>Cette conversation</option><option value="contact">Les conversations de ce contact</option></select></label>
            {searchScope === "contact" ? <label className="settings-row"><span>Conversations archivées uniquement</span><input type="checkbox" checked={searchArchived} disabled={Boolean(busy)} onChange={(event) => { setSearchArchived(event.target.checked); setSearchResults(null); }} /></label> : null}
            <button type="submit" disabled={Boolean(busy) || !searchTerm.trim() || (searchScope === "current" && !resolvedThreadId)}>Rechercher dans Codex</button>
          </form>
          {searchResults ? <>
            <p className="codex-feature-note">{searchResults.data.length} résultat(s) chargé(s) pour « {searchResults.searchTerm} ».</p>
            {searchResults.data.map((hit, index) => <article className="codex-feature-card" key={(hit.thread?.id || hit.itemId || "hit") + ":" + index}><div>{searchResults.scope === "contact" ? <><strong>{hit.thread.name || hit.thread.preview || "Conversation Codex"}</strong><p style={{ whiteSpace: "pre-wrap" }}>{hit.snippet}</p><button type="button" disabled={Boolean(busy)} onClick={() => runAction("search-open", { threadId: hit.thread.id }, async (result) => { await onThreadChanged?.({ action: "search-open", threadId: hit.thread.id, result }); onClose?.(); })}>Ouvrir cette conversation</button></> : <><strong>Échange {hit.turnId}</strong><SearchSnippet occurrence={hit} /></>}</div></article>)}
            {!searchResults.data.length ? <p className="codex-feature-note">Aucun résultat de ce contact dans cette page.</p> : null}
            {searchResults.nextCursor ? <button type="button" disabled={Boolean(busy)} onClick={() => searchHistory(true)}>Charger les résultats suivants</button> : null}
          </> : null}
        </fieldset> : null}
        {tab === "thread" ? <>
          {!resolvedThreadId ? <p>Envoyez un premier message pour créer la conversation Codex.</p> : <>
            <fieldset><legend>Messages à la suite</legend><SectionStatus section={sections.queue}>
              <p className="codex-feature-note">Ces messages partent après le tour en cours. Si Codex est libre, la mise en file démarre le message immédiatement. Pour corriger le tour en cours, utilisez « Envoyer » dans la conversation (Steer).</p>
              {pendingQueue ? <div className="codex-feature-error"><p>L’acceptation du dernier message est incertaine. Consultez la file et l’historique avant un nouvel envoi.</p><div className="codex-feature-buttons"><button type="button" disabled={Boolean(busy)} onClick={() => runAction("queue-reconcile", {}, (result) => setNotice(result.state === "queued" ? "Message retrouvé dans la file." : "Message absent de la file : il peut déjà avoir démarré. Vérifiez l’historique."))}>Vérifier la file</button><button type="button" disabled={Boolean(busy)} onClick={() => runAction("queue-acknowledge", { confirmed: true }, () => setNotice("Vérification de l’historique confirmée. Un nouvel envoi est possible."))}>J’ai vérifié l’historique</button></div></div> : null}
              <label className="codex-feature-input">{queueEditingId ? "Modifier le message en file" : "Nouveau message à la suite"}<textarea rows="3" value={queueDraft} onChange={(event) => setQueueDraft(event.target.value)} placeholder="Le prochain message destiné à Codex" /></label>
              <div className="codex-feature-buttons"><button type="button" disabled={Boolean(busy) || !queueDraft.trim() || Boolean(pendingQueue)} onClick={submitQueueMessage}>{queueEditingId ? "Enregistrer le message" : "Mettre à la suite"}</button>{queueEditingId ? <button type="button" disabled={Boolean(busy)} onClick={() => { setQueueEditingId(null); setQueueDraft(""); }}>Annuler la modification</button> : null}</div>
              {queue.map((submission, index) => <article className="codex-feature-card" key={submission.id}><div><strong>Message {index + 1}</strong><p style={{ whiteSpace: "pre-wrap" }}>{queuedMessageText(submission)}</p><div className="codex-feature-buttons"><button type="button" disabled={Boolean(busy) || !submission.input.every((item) => item.type === "text")} onClick={() => { setQueueEditingId(submission.id); setQueueDraft(queuedMessageText(submission)); }}>Modifier</button><button type="button" disabled={Boolean(busy) || index === 0} onClick={() => moveQueuedMessage(index, -1)}>Monter</button><button type="button" disabled={Boolean(busy) || index === queue.length - 1} onClick={() => moveQueuedMessage(index, 1)}>Descendre</button><button type="button" disabled={Boolean(busy)} onClick={() => runAction("queue-delete", { queuedSubmissionId: submission.id })}>Retirer de la file</button><button type="button" disabled={Boolean(busy) || queueActive} onClick={() => runAction("queue-start", { queuedSubmissionId: submission.id }, (result) => onThreadChanged?.({ action: "queue-start", threadId: resolvedThreadId, result }))}>Démarrer maintenant</button></div></div></article>)}
              {!queue.length ? <p className="codex-feature-note">Aucun message en attente.</p> : null}
            </SectionStatus></fieldset>
            <fieldset><legend>Mémoire Codex</legend><SectionStatus section={sections.memory}>
              <p className="codex-feature-note">Service de mémoire : {sections.memory?.data?.v2Ready === true ? "prêt" : sections.memory?.data?.v2Ready === false ? "en préparation" : "non renseigné"} · {sections.memory?.data?.v2ConsolidatedThreads ?? "inconnu"} conversation(s) consolidée(s). Le serveur n’annonce pas le mode mémoire actuel de cette conversation.</p>
              <div className="codex-feature-buttons"><button type="button" disabled={Boolean(busy)} onClick={() => runAction("memory-mode", { mode: "enabled" }, () => setNotice("Activation de la mémoire acceptée pour cette conversation."))}>Activer pour cette conversation</button><button type="button" disabled={Boolean(busy)} onClick={() => runAction("memory-mode", { mode: "disabled" }, () => setNotice("Désactivation de la mémoire acceptée pour cette conversation."))}>Désactiver pour cette conversation</button></div>
            </SectionStatus></fieldset>
            <fieldset><legend>Objectif de la conversation</legend><SectionStatus section={sections.goal}>
              {goal ? <p className="codex-feature-note">{goalStatusLabels[goal.status] || goal.status} · {goal.tokensUsed.toLocaleString()} jetons utilisés · {Math.round(goal.timeUsedSeconds / 60)} min</p> : <p className="codex-feature-note">Aucun objectif actif.</p>}
              <label className="codex-feature-input">Objectif<textarea rows="3" value={objective} onChange={(event) => setObjective(event.target.value)} placeholder="Le travail que Codex doit mener à terme" /></label>
              <label className="settings-row"><span>Budget facultatif de jetons</span><input type="number" min="1" step="1" value={budget} onChange={(event) => setBudget(event.target.value)} placeholder="Sans limite définie" /></label>
              <div className="codex-feature-buttons"><button type="button" disabled={Boolean(busy) || !objective.trim()} onClick={() => runAction("goal-set", { objective, tokenBudget: budget ? Number(budget) : null, ...(goal ? {} : { status: "active" }) })}>{goal ? "Enregistrer l’objectif" : "Démarrer l’objectif"}</button>{goal ? <><button type="button" disabled={Boolean(busy)} onClick={() => runAction("goal-set", { status: goal.status === "active" ? "paused" : "active" })}>{goal.status === "active" ? "Mettre en pause" : "Reprendre"}</button><button type="button" disabled={Boolean(busy)} onClick={() => runAction("goal-clear")}>Effacer l’objectif</button></> : null}</div>
            </SectionStatus></fieldset>
            <fieldset><legend>Terminaux en arrière-plan</legend><SectionStatus section={sections.backgroundTerminals}>{terminals.map((terminal) => <article className="codex-feature-card" key={terminal.processId}><div><strong>{terminal.command}</strong><small>{terminal.cwd}{terminal.cpuPercent == null ? "" : ` · CPU ${terminal.cpuPercent.toFixed(1)} %`}</small></div><button type="button" disabled={Boolean(busy)} onClick={() => runAction("terminal-terminate", { processId: terminal.processId })}>Arrêter</button></article>)}{!terminals.length ? <p>Aucun terminal actif.</p> : <button type="button" disabled={Boolean(busy)} onClick={() => runAction("terminals-clean")}>Fermer les terminaux</button>}</SectionStatus></fieldset>
            <fieldset><legend>Historique Codex</legend>
              <p className="codex-feature-note">Le compactage résume le contexte de travail de Codex. Son achèvement apparaît dans l’activité de la conversation.</p>
              <div className="codex-feature-buttons"><button type="button" disabled={Boolean(busy) || threadMetadata?.status?.type !== "idle" || threadMetadata?.canAcceptDirectInput !== true} onClick={() => runAction("compact", {}, async (result) => { await onThreadChanged?.({ action: "compact", threadId: resolvedThreadId, result }); setNotice("Demande de compactage acceptée par Codex."); })}>Compacter le contexte</button><button type="button" disabled={Boolean(busy)} onClick={() => runAction("archive", {}, (result) => onThreadChanged?.({ action: "archive", threadId: resolvedThreadId, result }))}>Archiver dans Codex</button><button type="button" disabled={Boolean(busy)} onClick={() => runAction("unarchive", {}, (result) => onThreadChanged?.({ action: "unarchive", threadId: resolvedThreadId, result }))}>Restaurer dans Codex</button></div>
              <SectionStatus section={sections.historyTail}>
                {historyTail?.lastTurn ? <p className="codex-feature-note">Dernier échange : {historyTail.lastTurn.preview || "aucun message utilisateur dans ce tour"}</p> : <p className="codex-feature-note">Aucun échange persisté à retirer.</p>}
                {!historyTail?.ready && historyTail?.lastTurn ? <p className="codex-feature-note">{historyTail.thread?.historyMode === "legacy" ? "Le retrait des historiques legacy n’est plus proposé par Codex 0.156.0. L’historique reste consultable." : "Le retrait exige un échange utilisateur persisté, un historique paginé et une conversation chargée et inactive."}</p> : null}
                {historyConfirmation ? <div className="codex-feature-error"><p>Confirmez le retrait du dernier échange de l’historique Codex. Les fichiers modifiés restent inchangés. Codex redémarre le moteur de cette conversation et ferme ses terminaux en arrière-plan pour l’historique paginé.</p><div className="codex-feature-buttons"><button type="button" disabled={Boolean(busy)} onClick={revertLatestHistory}>Confirmer le retrait du dernier échange</button><button type="button" disabled={Boolean(busy)} onClick={() => setHistoryConfirmation(null)}>Annuler</button></div></div> : <button type="button" disabled={Boolean(busy) || !historyTail?.ready} onClick={() => setHistoryConfirmation(historyTail.lastTurn.id)}>Retirer le dernier échange de l’historique</button>}
              </SectionStatus>
            </fieldset>
          </>}
          <details className="codex-feature-compatibility"><summary>Disponibilité des fonctions Codex</summary><ul>{catalog?.limitations?.map((entry) => <li key={entry.feature}><strong>{entry.feature}</strong> : {entry.detail}</li>)}</ul></details>
        </> : null}
      </div>
      <footer><small>{catalog?.context?.cwd || "Services locaux Codex"}</small><button type="button" disabled={loading || Boolean(busy)} onClick={() => refresh(true)}>Actualiser</button><button type="button" onClick={onClose}>Fermer</button></footer>
    </section>
  </div>;
}
