import test from "node:test";
import assert from "node:assert/strict";
import { localFilePathForHref, normalizeMarkdownHref } from "../src/messageLinks.js";

test("Codex paths with spaces and source positions open the real local file", () => {
  assert.equal(normalizeMarkdownHref(" < /tmp/rapport avec espaces.txt:12:4 > "), "/tmp/rapport avec espaces.txt:12:4");
  assert.equal(localFilePathForHref("</tmp/rapport avec espaces.txt:12>"), "/tmp/rapport avec espaces.txt");
  assert.equal(localFilePathForHref("file:///tmp/rapport%20avec%20espaces.txt"), "/tmp/rapport avec espaces.txt");
  assert.equal(localFilePathForHref("file:///C:/Users/Anis/rapport.txt:12:4"), "C:/Users/Anis/rapport.txt");
});

test("remote hosts, dangerous schemes, malformed URLs and encoded control characters are not local files", () => {
  for (const href of ["https://example.invalid/file", "javascript:alert(1)", "file://remote.invalid/share/file", "//remote.invalid/file", "file:///tmp/%00report.txt", "file:///tmp/%0Areport.txt", "file:///tmp/%ZZ", "relative/report.txt"]) assert.equal(localFilePathForHref(href), "", href);
});
