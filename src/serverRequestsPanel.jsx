import React, { useId, useState } from "react";
import { elicitationFieldOptions, isSecretSchemaField, permissionChoices, serverRequestDecisions, validateElicitationContent } from "../shared/serverRequestUtils.js";
import "./serverRequests.css";

function Question({ question, value = {}, onChange, disabled }) {
  const options = question.options ?? [];
  const freeform = !options.length || value.choice === "other";
  return (
    <fieldset className="server-request-question" disabled={disabled}>
      <legend>{question.header || "Votre réponse"}</legend>
      <p>{question.question}</p>
      {options.map((option, index) => (
        <label className="server-request-option" key={index}>
          <input type="radio" name={`question-${question.id}`} checked={value.choice === index} onChange={() => onChange({ ...value, choice: index })} />
          <span><strong>{option.label}</strong>{option.description ? <small>{option.description}</small> : null}</span>
        </label>
      ))}
      {options.length && question.isOther ? (
        <label className="server-request-option"><input type="radio" name={`question-${question.id}`} checked={value.choice === "other"} onChange={() => onChange({ ...value, choice: "other" })} /><span>Autre réponse</span></label>
      ) : null}
      {freeform ? (
        question.isSecret ? <input aria-label={question.question} type="password" autoComplete="off" value={value.text ?? ""} onChange={(event) => onChange({ ...value, text: event.target.value })} />
          : <textarea aria-label={question.question} rows={2} value={value.text ?? ""} onChange={(event) => onChange({ ...value, text: event.target.value })} />
      ) : null}
      {question.isSecret ? <small>Cette réponse reste masquée et n'est pas ajoutée à l'historique Messenger.</small> : null}
    </fieldset>
  );
}

function UserInputRequest({ request, submit, disabled }) {
  const [answers, setAnswers] = useState({});
  const [error, setError] = useState("");
  function send(event) {
    event.preventDefault();
    const entries = request.questions.map((question) => {
      const draft = answers[question.id] ?? {};
      const text = typeof draft.choice === "number" ? question.options[draft.choice]?.label : draft.text;
      return [question.id, { answers: typeof text === "string" && text.trim() ? [text] : [] }];
    });
    if (entries.some(([, answer]) => !answer.answers.length)) { setError("Répondez à chaque question avant d'envoyer."); return; }
    setError("");
    submit({ answers: Object.fromEntries(entries) }, () => setAnswers({}));
  }
  return (
    <form onSubmit={send}>
      {!request.isBlocking ? <p className="server-request-note">Codex continue son travail. Vous pouvez répondre tant que cette demande reste ouverte.</p> : null}
      {request.questions.map((question) => <Question key={question.id} question={question} value={answers[question.id]} disabled={disabled} onChange={(draft) => setAnswers((previous) => ({ ...previous, [question.id]: draft }))} />)}
      {error ? <p className="approval-error" role="alert">{error}</p> : null}
      <div className="approval-actions"><button disabled={disabled}>Envoyer la réponse</button><button type="button" className="deny" disabled={disabled} onClick={() => submit({ answers: {} }, () => setAnswers({}))}>Ignorer la question</button></div>
    </form>
  );
}

function PermissionsRequest({ request, submit, disabled }) {
  const choices = permissionChoices(request.permissions);
  const [selected, setSelected] = useState([]);
  const [scope, setScope] = useState("turn");
  const [strictAutoReview, setStrictAutoReview] = useState(false);
  const select = (id, checked) => setSelected((previous) => checked ? [...new Set([...previous, id])] : previous.filter((entry) => entry !== id));
  return (
    <div>
      <p className="server-request-note">Sélectionnez les accès que vous souhaitez accorder.</p>
      <fieldset className="server-request-question" disabled={disabled}>
        <legend>Accès demandés</legend>
        {choices.map((choice) => <label className="server-request-option" key={choice.id}><input type="checkbox" checked={choice.fixed || selected.includes(choice.id)} disabled={choice.fixed} onChange={(event) => select(choice.id, event.target.checked)} /><span>{choice.label}</span></label>)}
        {!choices.length ? <p>Aucun accès supplémentaire n'a été demandé.</p> : null}
        {choices.some((choice) => !choice.fixed) ? <button type="button" onClick={() => setSelected(choices.filter((choice) => !choice.fixed).map((choice) => choice.id))}>Sélectionner les accès demandés</button> : null}
      </fieldset>
      <label className="server-request-field">Durée <select disabled={disabled} value={scope} onChange={(event) => setScope(event.target.value)}><option value="turn">Ce tour seulement</option><option value="session">Cette session</option></select></label>
      <label className="server-request-option"><input type="checkbox" disabled={disabled} checked={strictAutoReview} onChange={(event) => setStrictAutoReview(event.target.checked)} /><span>Faire vérifier chaque commande suivante dans ce tour</span></label>
      <div className="approval-actions"><button type="button" disabled={disabled || !selected.length} onClick={() => submit({ selectedPermissions: selected, scope, strictAutoReview })}>Accorder les accès sélectionnés</button><button type="button" disabled={disabled} className="deny" onClick={() => submit({ selectedPermissions: [], scope: "turn" })}>Refuser les accès</button></div>
    </div>
  );
}

function defaultDraft(schema) {
  return Object.fromEntries(Object.entries(schema?.properties ?? {}).map(([name, field]) => [name, isSecretSchemaField(name, field) ? undefined : field.default ?? (field.type === "array" ? [] : undefined)]));
}

function isSimpleSchema(schema) {
  return schema?.type === "object" && schema.properties && !schema.$ref && !schema.oneOf && !schema.anyOf && !schema.allOf && Object.values(schema.properties).every((field) =>
    ["string", "number", "integer", "boolean"].includes(field.type) || field.type === "array" && elicitationFieldOptions(field.items).length > 0);
}

function McpField({ name, schema, required, value, onChange, disabled }) {
  const fieldId = useId();
  const options = elicitationFieldOptions(schema);
  const secret = isSecretSchemaField(name, schema);
  let field;
  if (options.length) field = <select id={fieldId} disabled={disabled} value={value ?? ""} onChange={(event) => onChange(event.target.value)}><option value="">Choisir…</option>{options.map((option, index) => <option key={index} value={option.value}>{option.label}</option>)}</select>;
  else if (schema.type === "boolean") field = <select id={fieldId} disabled={disabled} value={value === undefined ? "" : String(value)} onChange={(event) => onChange(event.target.value === "" ? undefined : event.target.value === "true")}><option value="">Non renseigné</option><option value="true">Oui</option><option value="false">Non</option></select>;
  else if (schema.type === "array") {
    const selected = Array.isArray(value) ? value : [];
    field = <fieldset className="server-request-multiselect"><legend>{schema.title || name}{required ? " *" : ""}</legend>{elicitationFieldOptions(schema.items).map((option, index) => <label className="server-request-option" key={index}><input type="checkbox" disabled={disabled} checked={selected.includes(option.value)} onChange={(event) => onChange(event.target.checked ? [...selected, option.value] : selected.filter((entry) => entry !== option.value))} /><span>{option.label}</span></label>)}</fieldset>;
  } else {
    const type = secret ? "password" : ["number", "integer"].includes(schema.type) ? "number" : schema.format === "email" ? "email" : schema.format === "date" ? "date" : "text";
    field = <input id={fieldId} disabled={disabled} type={type} autoComplete={secret ? "off" : undefined} step={schema.type === "integer" ? 1 : "any"} min={schema.minimum ?? undefined} max={schema.maximum ?? undefined} minLength={schema.minLength ?? undefined} maxLength={schema.maxLength ?? undefined} value={value ?? ""} onChange={(event) => onChange(event.target.value)} />;
  }
  return <div className="server-request-field">{schema.type !== "array" ? <label htmlFor={fieldId}>{schema.title || name}{required ? " *" : ""}</label> : null}{field}{schema.description ? <small>{schema.description}</small> : null}</div>;
}

function safeWebUrl(url) {
  try { const parsed = new URL(url); return ["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password ? parsed.href : ""; } catch { return ""; }
}

function ElicitationRequest({ request, submit, disabled, onOpenUrl }) {
  const schema = request.requestedSchema;
  const [draft, setDraft] = useState(() => defaultDraft(schema));
  const [json, setJson] = useState("{}");
  const [errors, setErrors] = useState([]);
  const [opened, setOpened] = useState(false);
  const [opening, setOpening] = useState(false);
  const simple = isSimpleSchema(schema);
  async function open() {
    const url = safeWebUrl(request.url);
    if (!url || !onOpenUrl) { setErrors(["Ce lien ne peut pas être ouvert dans cette application."]); return; }
    setOpening(true);
    try {
      const result = await onOpenUrl(url);
      if (result?.ok === false) throw new Error(result.error || "L'ouverture du lien a échoué.");
      setOpened(true);
      setErrors([]);
    } catch (error) { setErrors([error.message]); }
    finally { setOpening(false); }
  }
  function send(event) {
    event.preventDefault();
    let content;
    if (simple) {
      content = Object.fromEntries(Object.entries(schema.properties).flatMap(([name, field]) => {
        const value = draft[name];
        if (value === undefined || value === "" && field.type !== "string" || value === "" && !schema.required?.includes(name)) return [];
        return [[name, ["number", "integer"].includes(field.type) ? Number(value) : value]];
      }));
    } else {
      try { content = JSON.parse(json); } catch { setErrors(["Le contenu JSON est invalide."]); return; }
    }
    const validation = validateElicitationContent(schema, content);
    setErrors(validation);
    if (!validation.length) submit({ action: "accept", content }, () => { setDraft({}); setJson("{}"); });
  }
  const cancelActions = <><button type="button" className="deny" disabled={disabled} onClick={() => submit({ action: "decline" })}>Refuser</button><button type="button" disabled={disabled} onClick={() => submit({ action: "cancel" })}>Annuler</button></>;
  return (
    <form onSubmit={send}>
      <p className="server-request-message">{request.message}</p>
      {request.mode === "url" ? <div className="server-request-url"><p>Terminez la demande sur le site du service, puis confirmez ici.</p><button type="button" disabled={disabled || opening || !safeWebUrl(request.url)} onClick={open}>Ouvrir le site du service</button>{safeWebUrl(request.url) ? <small>{new URL(request.url).host}</small> : <p className="approval-error">Adresse du service invalide.</p>}</div> : simple ? Object.entries(schema.properties).map(([name, field]) => <McpField key={name} name={name} schema={field} required={schema.required?.includes(name)} value={draft[name]} disabled={disabled} onChange={(value) => setDraft((previous) => ({ ...previous, [name]: value }))} />) : <div className="server-request-field"><p>Ce service demande un formulaire structuré. Saisissez votre réponse JSON selon les champs ci-dessous.</p><details><summary>Champs demandés par le service</summary><pre>{JSON.stringify(schema, null, 2)}</pre></details><textarea aria-label="Réponse JSON au service" rows={5} disabled={disabled} value={json} onChange={(event) => setJson(event.target.value)} /></div>}
      {errors.length ? <ul className="approval-error" role="alert">{errors.map((error, index) => <li key={index}>{error}</li>)}</ul> : null}
      <div className="approval-actions">{request.mode === "url" ? <button type="button" disabled={disabled || !opened} onClick={() => submit({ action: "accept" })}>J'ai terminé sur le site</button> : <button disabled={disabled}>Envoyer au service</button>}{cancelActions}</div>
    </form>
  );
}

function ApprovalRequest({ request, submit, disabled }) {
  const changes = request.fileChanges ?? [];
  const choices = request.additionalPermissions ? permissionChoices(request.additionalPermissions) : [];
  return (
    <div>
      {request.kind === "command" ? <pre className="approval-command">{request.command || "La commande n'a pas été détaillée par Codex."}</pre> : <ul className="approval-files">{changes.map((change, index) => <li key={index}><span>{change.kind}</span>{change.path}</li>)}{!changes.length ? <li>Codex n'a pas transmis les détails des fichiers.</li> : null}</ul>}
      {request.networkApprovalContext ? <p className="server-request-note">Connexion {request.networkApprovalContext.protocol} vers {request.networkApprovalContext.host}</p> : null}
      {choices.length ? <ul className="server-request-permission-summary">{choices.map((choice) => <li key={choice.id}>{choice.label}</li>)}</ul> : null}
      {request.grantRoot ? <p className="server-request-note">Écriture demandée dans {request.grantRoot}</p> : null}
      <div className="approval-actions">{serverRequestDecisions(request).map((decision, index) => <button type="button" key={index} disabled={disabled} className={["decline", "cancel", "abort"].includes(decision.value) || decision.value?.denied ? "deny" : ""} onClick={() => submit({ decision: decision.value })}>{decision.label}</button>)}</div>
    </div>
  );
}

function RequestCard({ request, onRespond, onOpenUrl }) {
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const disabled = sending || sent || Boolean(request.sendingResponse);
  async function submit(response, onSent) {
    if (disabled) return;
    setSending(true);
    setError("");
    try {
      const result = await onRespond(request, response);
      if (result?.ok === false) throw new Error(result.error || "La réponse n'a pas pu être envoyée.");
      setSent(true);
      onSent?.();
    } catch (failure) { setError(failure.message); }
    finally { setSending(false); }
  }
  return (
    <section className={`approval-card server-request-card ${request.riskLevel || "unknown"}`} aria-label={request.title}>
      <div className="approval-head"><strong>{request.title}</strong><span>{sending ? "Envoi…" : sent ? "Réponse envoyée" : request.isBlocking ? "Réponse attendue" : "Question ouverte"}</span></div>
      {request.reason ? <p className="approval-reason">{request.reason}</p> : null}
      <div className="approval-meta">{request.cwd ? <span>{request.cwd}</span> : null}{request.riskDescription ? <span>{request.riskDescription}</span> : null}</div>
      {request.kind === "user-input" ? <UserInputRequest request={request} submit={submit} disabled={disabled} /> : request.kind === "permissions" ? <PermissionsRequest request={request} submit={submit} disabled={disabled} /> : request.kind === "elicitation" ? <ElicitationRequest request={request} submit={submit} disabled={disabled} onOpenUrl={onOpenUrl} /> : <ApprovalRequest request={request} submit={submit} disabled={disabled} />}
      {error || request.error ? <p className="approval-error" role="alert">{error || request.error}</p> : null}
    </section>
  );
}

export function ServerRequestsPanel({ requests = [], onRespond, onOpenUrl }) {
  if (!requests.length) return null;
  return <div className="approval-stack server-request-stack" aria-live="polite">{requests.map((request) => <RequestCard key={request.id ?? request.serverRequestId} request={request} onRespond={onRespond} onOpenUrl={onOpenUrl} />)}</div>;
}
