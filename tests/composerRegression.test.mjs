import test from "node:test";
import assert from "node:assert/strict";
import { isCompositionEvent, literalSlashCommand, maximumDraftAttachments, messageInputForDraft, shouldSubmitOnEnter } from "../src/composerUtils.js";

test("Enter confirms IME input without sending; Shift+Enter remains a newline", () => {
  assert.equal(shouldSubmitOnEnter({ key: "Enter", shiftKey: false }), true);
  assert.equal(shouldSubmitOnEnter({ key: "Enter", shiftKey: true }), false);
  assert.equal(shouldSubmitOnEnter({ key: "Enter", isComposing: true }), false);
  assert.equal(shouldSubmitOnEnter({ key: "Enter", nativeEvent: { isComposing: true } }), false);
  assert.equal(shouldSubmitOnEnter({ key: "Enter", nativeEvent: { keyCode: 229 } }), false);
  assert.equal(isCompositionEvent({ keyCode: 229 }), true);
});

test("mixed image and local-file attachments preserve every path and use real input types", () => {
  const attachments = [
    { type: "image", path: "/tmp/image-one.png", src: "file:///tmp/image-one.png", name: "one.png" },
    { type: "image", path: "/tmp/image-two.png", src: "file:///tmp/image-two.png", name: "two.png" },
    { type: "file", path: "/tmp/rapport avec espaces.txt", name: "rapport.txt" }
  ];
  const input = messageInputForDraft(" Analyse ces pièces jointes. ", attachments);
  assert.equal(input.images.length, 2);
  assert.equal(input.attachments.length, 3);
  assert.deepEqual(input.items.slice(1), [
    { type: "localImage", path: "/tmp/image-one.png" },
    { type: "localImage", path: "/tmp/image-two.png" }
  ]);
  assert.match(input.items[0].text, /rapport avec espaces\.txt/);
  assert.equal(input.displayText, "Analyse ces pièces jointes.");
});

test("image-only drafts can send without inserting fictional text labels", () => {
  const input = messageInputForDraft("", [{ type: "image", path: "/tmp/a.png", name: "a.png" }]);
  assert.deepEqual(input.items, [{ type: "localImage", path: "/tmp/a.png" }]);
  assert.equal(input.displayText, "a.png");
  assert.deepEqual(messageInputForDraft("   ").items, []);
});

test("invalid attachment paths are excluded and attachment count is bounded", () => {
  const attachments = [{ type: "image", name: "missing.png" }, ...Array.from({ length: 12 }, (_, index) => ({ type: "image", path: `/tmp/${index}.png`, name: `${index}.png` }))];
  const input = messageInputForDraft("", attachments);
  assert.equal(input.attachments.length, maximumDraftAttachments);
  assert.equal(input.items.length, maximumDraftAttachments);
});

test("slash commands do not swallow trailing instructions", () => {
  const commands = [{ id: "review", label: "/review" }, { id: "status", label: "/status" }];
  assert.equal(literalSlashCommand(" /REVIEW ", commands)?.id, "review");
  assert.equal(literalSlashCommand("/review inspecte seulement le diff", commands), null);
  assert.equal(literalSlashCommand("/reviews", commands), null);
});
