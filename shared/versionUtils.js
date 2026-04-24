export function parseVersion(value) {
  const match = String(value ?? "").match(/v?(\d+)\.(\d+)\.(\d+)(?:\.(\d+)|-(\d+))?(?:[-+][0-9A-Za-z.-]+)?/);
  if (!match) return null;
  const revision = Number(match[4] ?? match[5] ?? 0);
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    revision,
    raw: revision > 0 ? `${match[1]}.${match[2]}.${match[3]}.${revision}` : `${match[1]}.${match[2]}.${match[3]}`
  };
}

export function displayVersion(value) {
  return parseVersion(value)?.raw || String(value ?? "").trim();
}

export function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return 0;
  for (const key of ["major", "minor", "patch", "revision"]) {
    if (a[key] > b[key]) return 1;
    if (a[key] < b[key]) return -1;
  }
  return 0;
}

export function updateAvailable(latestVersion, currentVersion) {
  return compareVersions(latestVersion, currentVersion) > 0;
}

export function versionLabelForResult(value) {
  return displayVersion(value) || "unknown";
}
