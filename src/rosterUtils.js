export const projectSortOptions = [
  { id: "modified-desc", label: "Date de modification", detail: "recent d'abord", short: "modifie" },
  { id: "modified-asc", label: "Date de modification", detail: "ancien d'abord", short: "modifie" },
  { id: "created-desc", label: "Date de creation", detail: "recent d'abord", short: "cree" },
  { id: "created-asc", label: "Date de creation", detail: "ancien d'abord", short: "cree" },
  { id: "name-asc", label: "Alphabet montant", detail: "A a Z", short: "A-Z" },
  { id: "name-desc", label: "Alphabet descendant", detail: "Z a A", short: "Z-A" },
  { id: "threads-desc", label: "Nombre de fils", detail: "plus d'abord", short: "fils +" },
  { id: "threads-asc", label: "Nombre de fils", detail: "moins d'abord", short: "fils -" }
];

const projectSortIds = new Set(projectSortOptions.map((option) => option.id));

export function normalizeProjectSort(value) {
  return projectSortIds.has(value) ? value : "name-asc";
}

export function projectSortOption(sort) {
  return projectSortOptions.find((option) => option.id === normalizeProjectSort(sort)) ?? projectSortOptions[4];
}

function projectDateMs(project, key) {
  const value = Date.parse(project?.[key] ?? "");
  return Number.isFinite(value) ? value : 0;
}

export function projectThreadCount(project) {
  return Number(project?.threadCount ?? project?.threads?.length ?? 0) || 0;
}

export function combinedProjectThreads(project = {}) {
  const seen = new Set();
  return [...(project.threads ?? []), ...(project.hiddenThreads ?? [])].filter((thread) => {
    if (!thread?.id || seen.has(thread.id)) return false;
    seen.add(thread.id);
    return true;
  });
}

function mergeThreadArrays(left = [], right = []) {
  const byId = new Map();
  for (const thread of [...left, ...right]) {
    if (thread?.id) byId.set(thread.id, { ...(byId.get(thread.id) ?? {}), ...thread });
  }
  return Array.from(byId.values()).sort((a, b) => String(b.timestamp ?? "").localeCompare(String(a.timestamp ?? "")));
}

export function mergeConversationPages(current, next) {
  if (!current) return next;
  if (!next) return current;
  const projects = new Map();
  for (const project of current.projects ?? []) projects.set(project.cwd || project.id, { ...project });
  for (const project of next.projects ?? []) {
    const key = project.cwd || project.id;
    const existing = projects.get(key);
    projects.set(key, existing ? {
      ...existing,
      ...project,
      threads: mergeThreadArrays(existing.threads, project.threads),
      hiddenThreads: mergeThreadArrays(existing.hiddenThreads, project.hiddenThreads),
      threadCount: Math.max(projectThreadCount(existing), projectThreadCount(project))
    } : { ...project });
  }
  return {
    ...current,
    ...next,
    projects: Array.from(projects.values()).sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")))
  };
}

function compareProjectNames(left, right) {
  return String(left?.name ?? "").localeCompare(String(right?.name ?? ""), undefined, {
    numeric: true,
    sensitivity: "base"
  });
}

export function sortProjects(projects, sort) {
  const mode = normalizeProjectSort(sort);
  return [...projects].sort((left, right) => {
    let result = 0;
    if (mode === "name-asc") result = compareProjectNames(left, right);
    if (mode === "name-desc") result = compareProjectNames(right, left);
    if (mode === "created-desc") result = projectDateMs(right, "createdAt") - projectDateMs(left, "createdAt");
    if (mode === "created-asc") result = projectDateMs(left, "createdAt") - projectDateMs(right, "createdAt");
    if (mode === "modified-desc") result = projectDateMs(right, "modifiedAt") - projectDateMs(left, "modifiedAt");
    if (mode === "modified-asc") result = projectDateMs(left, "modifiedAt") - projectDateMs(right, "modifiedAt");
    if (mode === "threads-desc") result = projectThreadCount(right) - projectThreadCount(left);
    if (mode === "threads-asc") result = projectThreadCount(left) - projectThreadCount(right);
    return result || compareProjectNames(left, right) || String(left?.cwd ?? "").localeCompare(String(right?.cwd ?? ""));
  });
}
