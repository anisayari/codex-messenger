export const defaultTextStyle = {
  fontFamily: "Tahoma",
  fontSize: 11,
  color: "#182337",
  bubble: "#f0f6ff",
  meBubble: "#eefaf1"
};

export const transcriptInitialRenderLimit = 160;
export const transcriptRenderStep = 80;
export const textFontOptions = ["Tahoma", "Verdana", "Arial", "Segoe UI", "Times New Roman", "Courier New", "Comic Sans MS"];
export const textColorOptions = ["#182337", "#123f82", "#0b7747", "#7a1c1c", "#4b347a", "#111111"];
export const bubbleColorOptions = ["#f0f6ff", "#fffbd0", "#eefaf1", "#fff0f0", "#f2edff", "#ffffff"];

export function normalizeTextStyle(style = {}) {
  const fontFamily = textFontOptions.includes(style.fontFamily) ? style.fontFamily : defaultTextStyle.fontFamily;
  const fontSize = Math.max(9, Math.min(18, Math.round(Number(style.fontSize) || defaultTextStyle.fontSize)));
  const color = textColorOptions.includes(style.color) ? style.color : defaultTextStyle.color;
  const bubble = bubbleColorOptions.includes(style.bubble) ? style.bubble : defaultTextStyle.bubble;
  const meBubble = bubbleColorOptions.includes(style.meBubble) ? style.meBubble : defaultTextStyle.meBubble;
  return { fontFamily, fontSize, color, bubble, meBubble };
}

export function textStyleForContact(settings, contactId) {
  return normalizeTextStyle(settings?.textStyles?.[contactId]);
}

export function normalizeConversationZoom(value) {
  return Math.max(0.7, Math.min(1.6, Math.round((Number(value) || 1) * 10) / 10));
}
