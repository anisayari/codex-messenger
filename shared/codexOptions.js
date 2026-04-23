export const codexModelOptions = [
  { value: "", label: "Auto" },
  { value: "crest-alpha", label: "crest-alpha" },
  { value: "gpt-5.4", label: "GPT-5.4" },
  { value: "gpt-5.4-mini", label: "GPT-5.4 Mini" },
  { value: "gpt-5.3-codex", label: "GPT-5.3 Codex" },
  { value: "gpt-5.2-codex", label: "GPT-5.2 Codex" }
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
  { value: "read-only", label: "Lecture seule" },
  { value: "workspace-write", label: "Ecriture workspace" },
  { value: "danger-full-access", label: "Acces complet" }
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
  sandbox: "workspace-write",
  approvalPolicy: "never"
};

function normalizeChoice(value, options, fallback) {
  const clean = String(value ?? "");
  return options.some((option) => option.value === clean) ? clean : fallback;
}

function normalizeSandboxChoice(value) {
  const clean = String(value ?? "");
  const aliases = {
    readOnly: "read-only",
    read_only: "read-only",
    "read-only": "read-only",
    workspaceWrite: "workspace-write",
    workspace_write: "workspace-write",
    "workspace-write": "workspace-write",
    dangerFullAccess: "danger-full-access",
    danger_full_access: "danger-full-access",
    "danger-full-access": "danger-full-access"
  };
  return normalizeChoice(aliases[clean] ?? clean, codexSandboxOptions, defaultCodexOptions.sandbox);
}

export function normalizeCodexOptions(options = {}) {
  return {
    model: normalizeChoice(options.model, codexModelOptions, defaultCodexOptions.model),
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
  if (sandbox === "read-only") return { type: "read-only" };
  if (sandbox === "danger-full-access") return { type: "danger-full-access" };
  return {
    type: "workspace-write",
    writableRoots: [],
    networkAccess: true,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false
  };
}
