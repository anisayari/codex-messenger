import test from "node:test";
import assert from "node:assert/strict";
import { MSN_SWF_SOURCES, MSN_FLASH_CONFIG, resolveMsnSwf } from "../src/msnFlashPolicy.js";

test("MSN Flash accepts only the original local WINK and dynamic background sources", () => {
  assert.equal(MSN_SWF_SOURCES.length, 19);
  for (const baseURI of ["http://127.0.0.1:5174/", "file:///Applications/Codex%20Messenger.app/Contents/Resources/app.asar/dist/index.html"]) {
    for (const src of MSN_SWF_SOURCES) assert.equal(resolveMsnSwf(src, baseURI), new URL(src, baseURI).href);
    for (const src of ["https://example.com/arbitrary.swf", "javascript:alert(1)", "data:application/x-shockwave-flash;base64,AA==", "./unknown.swf", `${MSN_SWF_SOURCES[0]}?remote=1`, `${MSN_SWF_SOURCES[0]}#script`]) assert.equal(resolveMsnSwf(src, baseURI), null);
  }
});

test("MSN Flash cannot contact networks, navigate URLs or call host JavaScript", () => {
  assert.equal(MSN_FLASH_CONFIG.allowNetworking, "none");
  assert.equal(MSN_FLASH_CONFIG.openUrlMode, "deny");
  assert.equal(MSN_FLASH_CONFIG.allowScriptAccess, false);
});
