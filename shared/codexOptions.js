export const codexModelOptions = [
  { value: "", label: "Auto" }
];

export const codexReasoningOptions = [
  { value: "", label: "Auto" },
  { value: "none", label: "Aucune" },
  { value: "minimal", label: "Minimale" },
  { value: "low", label: "Rapide" },
  { value: "medium", label: "Normal" },
  { value: "high", label: "Approfondi" },
  { value: "xhigh", label: "Tres approfondi" }
];

export const codexCwdOptions = [
  { value: "contact", label: "Projet/conversation" },
  { value: "local", label: "Local par defaut" }
];

export const codexSandboxOptions = [
  { value: "readOnly", label: "Lecture seule" },
  { value: "workspaceWrite", label: "Ecriture workspace" },
  { value: "dangerFullAccess", label: "Acces complet" },
  { value: "externalSandbox", label: "Sandbox externe" }
];

export const codexApprovalOptions = [
  { value: "never", label: "Jamais demander" },
  { value: "on-request", label: "Sur demande" },
  { value: "on-failure", label: "Si echec" },
  { value: "untrusted", label: "Non fiable" }
];

export const defaultCodexOptions = {
  model: "",
  reasoningEffort: "",
  cwdMode: "contact",
  sandbox: "workspaceWrite",
  approvalPolicy: "never"
};

function normalizeChoice(value, options, fallback) {
  const clean = String(value ?? "");
  return options.some((option) => option.value === clean) ? clean : fallback;
}

function normalizeModelChoice(value) {
  return String(value ?? "").trim();
}

function normalizeSandboxChoice(value) {
  const clean = String(value ?? "");
  const aliases = {
    readOnly: "readOnly",
    read_only: "readOnly",
    "read-only": "readOnly",
    workspaceWrite: "workspaceWrite",
    workspace_write: "workspaceWrite",
    "workspace-write": "workspaceWrite",
    dangerFullAccess: "dangerFullAccess",
    danger_full_access: "dangerFullAccess",
    "danger-full-access": "dangerFullAccess",
    externalSandbox: "externalSandbox",
    external_sandbox: "externalSandbox",
    "external-sandbox": "externalSandbox"
  };
  return normalizeChoice(aliases[clean] ?? clean, codexSandboxOptions, defaultCodexOptions.sandbox);
}

export function normalizeCodexOptions(options = {}) {
  return {
    model: normalizeModelChoice(options.model),
    reasoningEffort: normalizeChoice(options.reasoningEffort, codexReasoningOptions, defaultCodexOptions.reasoningEffort),
    cwdMode: normalizeChoice(options.cwdMode, codexCwdOptions, defaultCodexOptions.cwdMode),
    sandbox: normalizeSandboxChoice(options.sandbox),
    approvalPolicy: normalizeChoice(options.approvalPolicy, codexApprovalOptions, defaultCodexOptions.approvalPolicy)
  };
}

export function optionLabel(options, value) {
  return options.find((option) => option.value === value)?.label ?? String(value || "Auto");
}

export function sandboxPolicyForMode(mode) {
  const sandbox = normalizeSandboxChoice(mode);
  if (sandbox === "readOnly") {
    return {
      type: "readOnly",
      access: { type: "fullAccess" },
      networkAccess: false
    };
  }
  if (sandbox === "dangerFullAccess") return { type: "dangerFullAccess" };
  if (sandbox === "externalSandbox") return { type: "externalSandbox", networkAccess: "enabled" };
  return {
    type: "workspaceWrite",
    writableRoots: [],
    readOnlyAccess: { type: "fullAccess" },
    networkAccess: true,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false
  };
}
