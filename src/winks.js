export const winkCatalog = [
  {
    id: "water-balloon",
    label: "Water Balloon",
    src: "./msn-assets/msn75/packages/winks/msgslang_WINK_1121_9/water_balloon.png",
    swf: "./msn-assets/msn75/packages/winks/msgslang_WINK_1121_9/water_balloon.swf",
    sound: "wizz"
  },
  {
    id: "bouncy-ball",
    label: "Bouncy Ball",
    src: "./msn-assets/msn75/packages/winks/msgslang_WINK_1122_9/bouncy_ball.png",
    swf: "./msn-assets/msn75/packages/winks/msgslang_WINK_1122_9/bouncy_ball.swf",
    sound: "online"
  },
  {
    id: "lightbulb",
    label: "Lightbulb",
    src: "./msn-assets/msn75/packages/winks/msgslang_WINK_1123_9/lightbulb.jpg",
    swf: "./msn-assets/msn75/packages/winks/msgslang_WINK_1123_9/lightbulb.swf",
    sound: "type"
  },
  {
    id: "crying",
    label: "Crying",
    src: "./msn-assets/msn75/packages/winks/msgslang_WINK_1124_9/crying.png",
    swf: "./msn-assets/msn75/packages/winks/msgslang_WINK_1124_9/crying.swf",
    sound: "ring"
  },
  {
    id: "ufo",
    label: "UFO",
    src: "./msn-assets/msn75/packages/winks/msgslang_WINK_1125_9/ufo.png",
    swf: "./msn-assets/msn75/packages/winks/msgslang_WINK_1125_9/ufo.swf",
    sound: "wizz"
  },
  {
    id: "frog",
    label: "Frog",
    src: "./msn-assets/msn75/packages/winks/msgslang_WINK_1126_9/frog.png",
    swf: "./msn-assets/msn75/packages/winks/msgslang_WINK_1126_9/frog.swf",
    sound: "online"
  },
  {
    id: "dancer",
    label: "Dancer",
    src: "./msn-assets/msn75/packages/winks/msgslang_WINK_1127_9/dancer.png",
    swf: "./msn-assets/msn75/packages/winks/msgslang_WINK_1127_9/dancer.swf",
    sound: "done"
  },
  {
    id: "bow",
    label: "Bow",
    src: "./msn-assets/msn75/packages/winks/msgslang_WINK_1128_9/bow.jpg",
    swf: "./msn-assets/msn75/packages/winks/msgslang_WINK_1128_9/bow.swf",
    sound: "done"
  },
  {
    id: "heart",
    label: "Heart",
    src: "./msn-assets/msn75/packages/winks/msgslang_WINK_1129_9/heart.png",
    swf: "./msn-assets/msn75/packages/winks/msgslang_WINK_1129_9/heart.swf",
    sound: "ring"
  },
  {
    id: "silly-face",
    label: "Silly Face",
    src: "./msn-assets/msn75/packages/winks/msgslang_WINK_1130_9/silly_face.png",
    swf: "./msn-assets/msn75/packages/winks/msgslang_WINK_1130_9/silly_face.swf",
    sound: "type"
  },
  {
    id: "dancing-pig",
    label: "Dancing Pig",
    src: "./msn-assets/msn75/packages/winks/msgslang_WINK_1131_9/dancing_pig.png",
    swf: "./msn-assets/msn75/packages/winks/msgslang_WINK_1131_9/dancing_pig.swf",
    sound: "done"
  },
  {
    id: "kiss",
    label: "Kiss",
    src: "./msn-assets/msn75/packages/winks/msgslang_WINK_1132_9/kiss.png",
    swf: "./msn-assets/msn75/packages/winks/msgslang_WINK_1132_9/kiss.swf",
    sound: "ring"
  },
  {
    id: "guitar-smash",
    label: "Guitar Smash",
    src: "./msn-assets/msn75/packages/winks/msgslang_WINK_1133_9/guitar_smash.png",
    swf: "./msn-assets/msn75/packages/winks/msgslang_WINK_1133_9/guitar_smash.swf",
    sound: "wizz"
  },
  {
    id: "knock",
    label: "Knock",
    src: "./msn-assets/msn75/packages/winks/msgslang_WINK_1134_9/knock.png",
    swf: "./msn-assets/msn75/packages/winks/msgslang_WINK_1134_9/knock.swf",
    sound: "wizz"
  },
  {
    id: "laughing-girl",
    label: "Laughing Girl",
    src: "./msn-assets/msn75/packages/winks/msgslang_WINK_1135_9/laughing_girl.png",
    swf: "./msn-assets/msn75/packages/winks/msgslang_WINK_1135_9/laughing_girl.swf",
    sound: "done"
  },
  { id: "butterfly", label: "Papillon", src: "./msn-assets/winks/butterfly.gif", sound: "wizz" },
  { id: "butterfly-small", label: "Mini papillon", src: "./msn-assets/winks/butterfly-small.gif", sound: "online" },
  { id: "surprise", label: "Surprise", src: "./msn-assets/winks/surprise.gif", sound: "ring" },
  { id: "nudge", label: "Secousse", src: "./msn-assets/winks/nudge-burst.gif", sound: "wizz" },
  { id: "flash", label: "Flash", src: "./msn-assets/winks/flash.gif", sound: "type" },
  { id: "msn-flow", label: "MSN", src: "./msn-assets/winks/msn-flow.gif", sound: "done" }
];

const winkById = Object.fromEntries(winkCatalog.map((wink) => [wink.id, wink]));

export function extractWinkFromText(text) {
  const source = String(text ?? "");
  const match = source.match(/\[(?:wink|clin|clin-doeil|nudge):([a-z0-9-]+)\]/i);
  if (!match) return { text: source, wink: null };
  const wink = winkById[match[1]] ?? null;
  if (!wink) return { text: source, wink: null };
  const cleanText = source.replace(match[0], "").replace(/\n{3,}/g, "\n\n").trim();
  return { text: cleanText || `Clin d'oeil: ${wink.label}`, wink };
}
