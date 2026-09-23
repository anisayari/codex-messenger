export function isRealtimeCallShortcut(event) {
  return event.key === "F8" && !event.repeat && !event.defaultPrevented
    && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
}
