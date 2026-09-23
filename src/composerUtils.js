export const maximumDraftAttachments = 8;

export function isCompositionEvent(event) {
  return Boolean(event?.isComposing || event?.nativeEvent?.isComposing || event?.keyCode === 229 || event?.nativeEvent?.keyCode === 229);
}

export function shouldSubmitOnEnter(event) {
  return event?.key === "Enter" && !event.shiftKey && !isCompositionEvent(event);
}

export function messageInputForDraft(draft, attachments = []) {
  const text = String(draft ?? "").trim();
  const usable = attachments.filter((attachment) => attachment?.path).slice(0, maximumDraftAttachments);
  const fileReferences = usable.filter((attachment) => attachment.type !== "image")
    .map((attachment) => `Fichier local joint (${attachment.name || "fichier"}):\n${attachment.path}`);
  const prompt = [text, ...fileReferences].filter(Boolean).join("\n\n");
  const items = prompt ? [{ type: "text", text: prompt }] : [];
  items.push(...usable.filter((attachment) => attachment.type === "image").map((attachment) => ({ type: "localImage", path: attachment.path })));
  return {
    items,
    displayText: text || usable.map((attachment) => attachment.name || "Pièce jointe").join(", "),
    attachments: usable,
    images: usable.filter((attachment) => attachment.type === "image")
  };
}

export function literalSlashCommand(draft, commands) {
  const text = String(draft ?? "").trim().toLowerCase();
  return commands.find((command) => command.label === text) ?? null;
}
