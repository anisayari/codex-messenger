import { displayVersion } from "./versionUtils.js";

export function releaseVersionLabel(release = {}) {
  return displayVersion(release.tag_name || release.name || "");
}

export function assetDigestSha256(asset = {}) {
  const digest = String(asset.digest || "").trim();
  return digest.toLowerCase().startsWith("sha256:") ? digest.slice("sha256:".length).toLowerCase() : "";
}

export function safeAssetFileName(name = "CodexMessenger-update") {
  return String(name || "CodexMessenger-update").replace(/[\\/:\n\r\t]/g, "-").slice(0, 180);
}

export function selectFrontReleaseAsset(release = {}, { platform = process.platform, arch = process.arch } = {}) {
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const named = assets.filter((asset) => asset?.name && asset?.browser_download_url);
  if (platform === "win32") {
    const exeAssets = named.filter((asset) => /\.exe$/i.test(asset.name) && !/\.blockmap$/i.test(asset.name));
    return exeAssets.find((asset) => /setup|installer/i.test(asset.name)) ?? exeAssets[0] ?? null;
  }
  if (platform === "darwin") {
    const dmgAssets = named.filter((asset) => /\.dmg$/i.test(asset.name) && !/\.blockmap$/i.test(asset.name));
    const wantedArch = arch === "x64" ? "x64" : "arm64";
    return dmgAssets.find((asset) => asset.name.toLowerCase().includes(wantedArch))
      ?? dmgAssets.find((asset) => asset.name.toLowerCase().includes("arm64"))
      ?? dmgAssets[0]
      ?? null;
  }
  return null;
}
