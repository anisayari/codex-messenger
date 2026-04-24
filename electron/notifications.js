import { BrowserWindow, screen } from "electron";
import { readFileSync } from "node:fs";
import path from "node:path";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function toastPreview(text) {
  return String(text ?? "")
    .replace(/\[(?:wink|clin|clin-doeil|nudge):[a-z0-9-]+\]/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "sent you a message.";
}

function mimeTypeForFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".gif") return "image/gif";
  if (ext === ".webp") return "image/webp";
  if (ext === ".avif") return "image/avif";
  if (ext === ".ico") return "image/x-icon";
  if (ext === ".wav") return "audio/wav";
  if (ext === ".mp3") return "audio/mpeg";
  return "application/octet-stream";
}

function dataUrlForFile(filePath) {
  try {
    const data = readFileSync(filePath);
    return `data:${mimeTypeForFile(filePath)};base64,${data.toString("base64")}`;
  } catch {
    return "";
  }
}

export function createNotificationService({
  app,
  rootDir,
  appIconPath,
  toastIconPath,
  displayPictureAssetSet,
  displayPictureAssetByAvatar,
  contactFor,
  createChatWindow,
  isSuppressed = () => false
}) {
  const toastWindows = [];

  function publicAssetPath(assetPath) {
    const relativePath = String(assetPath || "").replace(/^\.\//, "");
    return path.join(rootDir, "public", relativePath);
  }

  function avatarPathForToast(contact) {
    if (contact?.displayPicturePath) return contact.displayPicturePath;
    if (contact?.displayPictureAsset && displayPictureAssetSet.has(contact.displayPictureAsset)) return publicAssetPath(contact.displayPictureAsset);
    const defaultPicture = displayPictureAssetByAvatar.get(contact?.avatar);
    if (defaultPicture) return publicAssetPath(defaultPicture);
    return toastIconPath;
  }

  function positionToastWindows() {
    if (!app.isReady()) return;
    const width = 340;
    const height = 118;
    const gap = 8;
    const margin = 18;
    const { workArea } = screen.getPrimaryDisplay();
    toastWindows.forEach((win, index) => {
      if (win.isDestroyed()) return;
      win.setBounds({
        width,
        height,
        x: workArea.x + workArea.width - width - margin,
        y: workArea.y + workArea.height - height - margin - index * (height + gap)
      }, false);
    });
  }

  function removeToastWindow(win) {
    const index = toastWindows.indexOf(win);
    if (index >= 0) toastWindows.splice(index, 1);
    positionToastWindows();
  }

  function messengerToastHtml({ contact, preview, playSound = false }) {
    const name = escapeHtml(contact.name || "Codex");
    const message = escapeHtml(preview);
    const avatar = escapeHtml(dataUrlForFile(avatarPathForToast(contact)) || dataUrlForFile(toastIconPath));
    const logo = escapeHtml(dataUrlForFile(toastIconPath));
    const sound = escapeHtml(dataUrlForFile(path.join(rootDir, "public", "msn-assets", "sounds", "type.wav")));
    return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
*{box-sizing:border-box}
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent;font-family:"Segoe UI",Tahoma,Arial,sans-serif;color:#3c3c3c}
.toast{position:absolute;inset:6px;display:grid;grid-template-rows:32px minmax(0,1fr);overflow:hidden;border:1px solid #61cce8;border-radius:14px;background:linear-gradient(135deg,#f7fcff 0%,#e6f7ff 53%,#ccecff 100%);box-shadow:0 7px 18px rgba(31,47,72,.34),inset 0 1px 0 rgba(255,255,255,.95)}
.head{position:relative;z-index:2;display:grid;grid-template-columns:24px minmax(0,1fr) 24px;align-items:center;gap:7px;padding:8px 13px 2px 15px;color:#515151;text-shadow:0 1px 0 white}
.head img{display:block;width:22px;height:22px;object-fit:contain}.head span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:18px}.close{display:grid;width:24px;height:24px;place-items:center;color:#717171;text-decoration:none;font-size:22px;line-height:1}.close:hover{color:#333}
.body{position:relative;z-index:2;display:grid;grid-template-columns:62px minmax(0,1fr);gap:11px;min-height:0;padding:5px 15px 12px 17px;pointer-events:none}
.avatar{width:58px;height:58px;padding:4px;border:1px solid #9eb8c7;border-radius:12px;background:linear-gradient(#fff,#d7ecf9);box-shadow:0 5px 9px rgba(42,65,83,.22),inset 0 0 0 3px rgba(239,248,255,.95)}
.avatar img{display:block;width:100%;height:100%;border-radius:7px;object-fit:cover;background:#b8dcf5}.copy{min-width:0;padding-top:2px;line-height:1.15}.copy strong{display:block;overflow:hidden;margin-bottom:2px;color:#3a3a3a;font-size:18px;font-weight:700;text-overflow:ellipsis;white-space:nowrap}.copy span{display:-webkit-box;overflow:hidden;color:#414141;font-size:15px;line-height:1.2;overflow-wrap:anywhere;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.open{position:absolute;inset:38px 0 0 0;z-index:1}
</style>
</head>
<body>
<div class="toast">
  <div class="head"><img src="${logo}" alt=""> <span>Codex Messenger</span><a class="close" href="codex-messenger://toast/close">x</a></div>
  <a class="open" href="codex-messenger://toast/open"></a>
  <div class="body"><div class="avatar"><img src="${avatar}" alt=""></div><div class="copy"><strong>${name}</strong><span>${message}</span></div></div>
</div>
${playSound ? `<audio src="${sound}" autoplay></audio>` : ""}
</body>
</html>`;
  }

  function showMessengerToast(contactId, text, options = {}) {
    if (isSuppressed()) return;
    const contact = contactFor(contactId);
    const preview = toastPreview(text);
    const width = 340;
    const height = 118;
    const toastWin = new BrowserWindow({
      width,
      height,
      frame: false,
      show: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      transparent: true,
      backgroundColor: "#00000000",
      title: "Codex Messenger",
      icon: appIconPath,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });
    toastWindows.unshift(toastWin);
    while (toastWindows.length > 3) toastWindows.pop()?.close();
    toastWin.on("closed", () => removeToastWindow(toastWin));
    toastWin.webContents.on("will-navigate", (event, url) => {
      if (!url.startsWith("codex-messenger://toast/")) return;
      event.preventDefault();
      if (url.endsWith("/open")) createChatWindow(contactId);
      toastWin.close();
    });
    toastWin.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith("codex-messenger://toast/open")) createChatWindow(contactId);
      toastWin.close();
      return { action: "deny" };
    });
    toastWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(messengerToastHtml({ contact, preview, playSound: Boolean(options.playSound) }))}`);
    toastWin.once("ready-to-show", () => {
      positionToastWindows();
      toastWin.showInactive();
    });
    setTimeout(() => {
      if (!toastWin.isDestroyed()) toastWin.close();
    }, 8500);
  }

  function closeAllToasts() {
    for (const win of [...toastWindows]) {
      if (!win.isDestroyed()) win.close();
    }
  }

  return {
    showMessengerToast,
    closeAllToasts,
    toastPreview
  };
}
