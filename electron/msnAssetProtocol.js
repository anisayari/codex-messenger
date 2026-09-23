import fs from "node:fs/promises";
import path from "node:path";

export const msnAssetScheme = "msn-asset";
export const msnAssetPaths = Object.freeze([
  "msn-assets/msn75/packages/winks/msgslang_WINK_1121_9/water_balloon.swf",
  "msn-assets/msn75/packages/winks/msgslang_WINK_1122_9/bouncy_ball.swf",
  "msn-assets/msn75/packages/winks/msgslang_WINK_1123_9/lightbulb.swf",
  "msn-assets/msn75/packages/winks/msgslang_WINK_1124_9/crying.swf",
  "msn-assets/msn75/packages/winks/msgslang_WINK_1125_9/ufo.swf",
  "msn-assets/msn75/packages/winks/msgslang_WINK_1126_9/frog.swf",
  "msn-assets/msn75/packages/winks/msgslang_WINK_1127_9/dancer.swf",
  "msn-assets/msn75/packages/winks/msgslang_WINK_1128_9/bow.swf",
  "msn-assets/msn75/packages/winks/msgslang_WINK_1129_9/heart.swf",
  "msn-assets/msn75/packages/winks/msgslang_WINK_1130_9/silly_face.swf",
  "msn-assets/msn75/packages/winks/msgslang_WINK_1131_9/dancing_pig.swf",
  "msn-assets/msn75/packages/winks/msgslang_WINK_1132_9/kiss.swf",
  "msn-assets/msn75/packages/winks/msgslang_WINK_1133_9/guitar_smash.swf",
  "msn-assets/msn75/packages/winks/msgslang_WINK_1134_9/knock.swf",
  "msn-assets/msn75/packages/winks/msgslang_WINK_1135_9/laughing_girl.swf",
  "msn-assets/msn75/packages/dynamic-backgrounds/msgslang_DYNAMICBACKGROUND_1600_9/extracted/KoiPond.swf",
  "msn-assets/msn75/packages/dynamic-backgrounds/msgslang_DYNAMICBACKGROUND_1601_9/extracted/Clocks.swf",
  "msn-assets/msn75/packages/dynamic-backgrounds/msgslang_DYNAMICBACKGROUND_1602_9/extracted/mad_scientist.swf",
  "msn-assets/msn75/packages/dynamic-backgrounds/msgslang_DYNAMICBACKGROUND_1603_9/extracted/Pixies.swf",
  "msn-assets/ruffle/0.6.0/ruffle.js",
  "msn-assets/ruffle/0.6.0/core.ruffle.c80159b526e567babaf5.js",
  "msn-assets/ruffle/0.6.0/core.ruffle.f000070ea72f8ae4fe3a.js",
  "msn-assets/ruffle/0.6.0/72a20ef1c0b8ceb37720.wasm",
  "msn-assets/ruffle/0.6.0/826bb0938097485a2c9d.wasm"
]);

const allowedPaths = new Set(msnAssetPaths.map(asset => "/" + asset));
const headers = {
  "Access-Control-Allow-Origin": "null",
  "Cross-Origin-Resource-Policy": "cross-origin",
  "X-Content-Type-Options": "nosniff"
};

export function registerMsnAssetScheme(protocol) {
  protocol.registerSchemesAsPrivileged([{
    scheme: msnAssetScheme,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
  }]);
}

export function resolveMsnAssetPath(rawUrl) {
  if (typeof rawUrl !== "string" || /[%\\]/.test(rawUrl)) return null;
  const rawPath = /^[a-z][a-z\d+.-]*:\/\/[^/]*([^?#]*)/i.exec(rawUrl)?.[1];
  if (!rawPath || /(?:^|\/)\.{1,2}(?:\/|$)/.test(rawPath)) return null;
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== msnAssetScheme + ":" || url.hostname.toLowerCase() !== "local" ||
        url.username || url.password || url.port || url.search || url.hash || !allowedPaths.has(url.pathname)) return null;
    return url.pathname.slice(1);
  } catch { return null; }
}

export function createMsnAssetHandler({ assetRoot, fileSystem = fs, maxAssetBytes = 64 * 1024 * 1024 }) {
  const absoluteRoot = path.resolve(assetRoot);
  return async function handleMsnAsset(request) {
    if (request.method !== "GET") return new Response("Method unavailable", { status: 405, headers });
    const asset = resolveMsnAssetPath(request.url);
    if (!asset) return new Response("Asset unavailable", { status: 404, headers });
    try {
      const root = await fileSystem.realpath(absoluteRoot);
      const file = await fileSystem.realpath(path.join(absoluteRoot, asset));
      const relative = path.relative(root, file);
      if (!relative || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) throw new Error("Asset escaped root");
      const stat = await fileSystem.stat(file);
      if (!stat.isFile() || stat.size > maxAssetBytes) throw new Error("Asset size invalid");
      const bytes = await fileSystem.readFile(file);
      if (bytes.length > maxAssetBytes) throw new Error("Asset size invalid");
      const mime = asset.endsWith(".wasm") ? "application/wasm" : asset.endsWith(".js") ? "application/javascript" : "application/x-shockwave-flash";
      return new Response(bytes, { status: 200, headers: { ...headers, "Content-Type": mime, "Cache-Control": "public, max-age=31536000, immutable" } });
    } catch { return new Response("Asset unavailable", { status: 404, headers }); }
  };
}

export function installMsnAssetProtocol(protocol, options) {
  protocol.handle(msnAssetScheme, createMsnAssetHandler(options));
}
