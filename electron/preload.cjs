const { contextBridge, ipcRenderer } = require("electron");

const listeners = new Set([
  "codex:delta",
  "codex:completed-item",
  "codex:done",
  "codex:error",
  "codex:approval-request",
  "codex:approval-resolved",
  "codex:typing",
  "codex:status",
  "conversation:finished",
  "conversation:notify",
  "conversation:unread",
  "window:wizz"
]);

function on(channel, callback) {
  if (!listeners.has(channel)) {
    throw new Error(`IPC channel not allowed: ${channel}`);
  }
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld("codexMsn", {
  bootstrap: () => {
    const search = new URLSearchParams(window.location.search);
    return ipcRenderer.invoke("app:bootstrap", {
      view: search.get("view") ?? "main",
      contactId: search.get("contactId")
    });
  },
  checkUpdates: (options) => ipcRenderer.invoke("updates:check", options),
  openUpdateTarget: (target) => ipcRenderer.invoke("updates:open", target),
  installUpdateTarget: (target) => ipcRenderer.invoke("updates:install", target),
  signIn: (profile) => ipcRenderer.invoke("auth:sign-in", profile),
  openConversation: (contactId) => ipcRenderer.invoke("conversation:open", contactId),
  openThread: (threadId) => ipcRenderer.invoke("conversation:open-thread", threadId),
  openProject: (cwd) => ipcRenderer.invoke("conversation:open-project", cwd),
  switchThread: (threadId) => ipcRenderer.invoke("conversation:switch-thread", threadId),
  loadThread: (payload) => ipcRenderer.invoke("conversation:load-thread", payload),
  switchProject: (cwd) => ipcRenderer.invoke("conversation:switch-project", cwd),
  openProjectPicker: () => ipcRenderer.invoke("conversation:open-project-picker"),
  listConversations: () => ipcRenderer.invoke("conversation:list"),
  reorderThreads: (payload) => ipcRenderer.invoke("conversation:reorder-threads", payload),
  deleteThread: (threadId) => ipcRenderer.invoke("conversation:delete-thread", threadId),
  sendMessage: (contactId, text) => ipcRenderer.invoke("conversation:send", { contactId, text }),
  sendItems: (contactId, items) => ipcRenderer.invoke("conversation:send-items", { contactId, items }),
  respondApproval: (payload) => ipcRenderer.invoke("approval:respond", payload),
  markRead: (contactId) => ipcRenderer.invoke("conversation:read", contactId),
  wizz: (contactId) => ipcRenderer.invoke("conversation:wizz", contactId),
  pickFile: (options) => ipcRenderer.invoke("media:pick-file", options),
  saveDataUrl: (payload) => ipcRenderer.invoke("media:save-data-url", payload),
  saveText: (payload) => ipcRenderer.invoke("app:save-text", payload),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  setSettings: (settings) => ipcRenderer.invoke("settings:set", settings),
  listCodexModels: () => ipcRenderer.invoke("models:list"),
  createAgent: (agent) => ipcRenderer.invoke("contacts:create-agent", agent),
  renameContact: (payload) => ipcRenderer.invoke("contacts:rename", payload),
  chooseDirectory: (options) => ipcRenderer.invoke("app:choose-directory", options),
  chooseCodex: () => ipcRenderer.invoke("settings:choose-codex"),
  testCodex: (candidatePath) => ipcRenderer.invoke("settings:test-codex", candidatePath),
  chooseProfilePicture: (options) => ipcRenderer.invoke("profile:choose-picture", options),
  clearProfilePicture: () => ipcRenderer.invoke("profile:clear-picture"),
  app: {
    openPath: (targetPath) => ipcRenderer.invoke("app:open-path", targetPath),
    showItem: (targetPath) => ipcRenderer.invoke("app:show-item", targetPath),
    reload: () => ipcRenderer.invoke("app:reload"),
    quit: () => ipcRenderer.invoke("app:quit")
  },
  window: {
    minimize: () => ipcRenderer.invoke("window:minimize"),
    maximize: () => ipcRenderer.invoke("window:maximize"),
    setZoomFactor: (factor) => ipcRenderer.invoke("window:set-zoom-factor", factor),
    close: () => ipcRenderer.invoke("window:close")
  },
  on
});
