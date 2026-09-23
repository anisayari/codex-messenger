export const initialRealtimeTranscript = Object.freeze({ mode: null, entries: [], nextId: 1 });

function bounded(entries) {
  return entries.slice(-200).map((entry) => ({ ...entry, text: entry.text.slice(-16000) }));
}

/** Canonical item events supersede compatibility deltas so the same speech appears once. */
export function reduceRealtimeTranscript(state, message) {
  const params = message.params ?? {};
  if (["thread/realtime/item/started", "thread/realtime/item/completed"].includes(message.method)
      && params.item?.type === "transcriptSegment") {
    const item = params.item;
    const entries = state.mode === "canonical" ? [...state.entries] : [];
    const index = entries.findIndex((entry) => entry.id === item.id);
    const entry = { id: item.id, role: item.role, text: String(item.text ?? ""), complete: message.method.endsWith("/completed") };
    if (index < 0) entries.push(entry);
    else entries[index] = entry;
    return { ...state, mode: "canonical", entries: bounded(entries) };
  }
  if (message.method === "thread/realtime/item/transcript/delta") {
    if (state.mode !== "canonical") return state;
    const entries = state.entries.map((entry) => entry.id === params.itemId
      ? { ...entry, text: entry.text + String(params.delta ?? "") } : entry);
    return { ...state, entries: bounded(entries) };
  }
  if (!["thread/realtime/transcript/delta", "thread/realtime/transcript/done"].includes(message.method)
      || state.mode === "canonical" || !["user", "assistant"].includes(params.role)) return state;
  const entries = [...state.entries];
  const index = entries.findLastIndex((entry) => entry.role === params.role && !entry.complete);
  const complete = message.method.endsWith("/done");
  const previous = index < 0 ? null : entries[index];
  const entry = {
    id: previous?.id ?? `flat-${state.nextId}`,
    role: params.role,
    text: complete ? String(params.text ?? "") : (previous?.text ?? "") + String(params.delta ?? ""),
    complete
  };
  if (index < 0) entries.push(entry);
  else entries[index] = entry;
  return { mode: "flat", entries: bounded(entries), nextId: state.nextId + (previous ? 0 : 1) };
}
