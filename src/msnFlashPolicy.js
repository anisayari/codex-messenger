import { winkCatalog } from "./winks.js";
import { MSN_DYNAMIC_BACKGROUNDS } from "./msnBackgrounds.js";

export const MSN_SWF_SOURCES = Object.freeze([
  ...winkCatalog.map(({ swf }) => swf).filter(Boolean),
  ...MSN_DYNAMIC_BACKGROUNDS.map(({ animationSrc }) => animationSrc)
]);

export const MSN_FLASH_CONFIG = Object.freeze({
  allowScriptAccess: false,
  allowNetworking: "none",
  openUrlMode: "deny",
  autoplay: "on",
  unmuteOverlay: "visible",
  splashScreen: false,
  contextMenu: "off",
  showSwfDownload: false,
  wmode: "transparent",
  letterbox: "on",
  logLevel: "error"
});

export function resolveMsnSwf(src, baseURI) {
  try {
    const requested = new URL(src, baseURI).href;
    return MSN_SWF_SOURCES.some((known) => new URL(known, baseURI).href === requested) ? requested : null;
  } catch {
    return null;
  }
}
