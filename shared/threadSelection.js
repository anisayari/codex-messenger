export function threadTimeMs(thread = {}) {
  const value = thread.timestamp ?? thread.lastActivityAt ?? thread.updatedAt ?? thread.createdAt ?? thread.time ?? "";
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function newestThreadForProject(project = {}) {
  const threads = [
    ...(Array.isArray(project.threads) ? project.threads : []),
    ...(Array.isArray(project.hiddenThreads) ? project.hiddenThreads : [])
  ];
  return threads
    .filter(Boolean)
    .sort((a, b) => threadTimeMs(b) - threadTimeMs(a))[0] ?? null;
}
