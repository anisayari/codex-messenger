import { useEffect, useRef, useState } from "react";

export function useUpdates({ api, appVersion = "", userAgent = "", initialCheck = false } = {}) {
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false);
  const [updateState, setUpdateState] = useState(null);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [installingUpdateTarget, setInstallingUpdateTarget] = useState("");
  const [updateActionMessage, setUpdateActionMessage] = useState("");
  const [updateProgress, setUpdateProgress] = useState(null);
  const initialCheckDoneRef = useRef(false);

  useEffect(() => api.on("updates:progress", (progress) => {
    setUpdateProgress(progress);
  }), [api]);

  async function checkForUpdates({ force = true, showDialog = true } = {}) {
    setCheckingUpdates(true);
    setUpdateActionMessage("");
    setUpdateProgress(null);
    try {
      const result = await api.checkUpdates({ force });
      setUpdateState(result);
      if (showDialog) setUpdateDialogOpen(true);
      return result;
    } catch (error) {
      const failed = {
        checkedAt: new Date().toISOString(),
        front: { currentVersion: appVersion, latestVersion: "", updateAvailable: false, error: error.message },
        codex: { currentVersion: userAgent, latestVersion: "", updateAvailable: false, error: error.message }
      };
      setUpdateState(failed);
      if (showDialog) setUpdateDialogOpen(true);
      return failed;
    } finally {
      setCheckingUpdates(false);
    }
  }

  useEffect(() => {
    if (!initialCheck || initialCheckDoneRef.current) return;
    initialCheckDoneRef.current = true;
    checkForUpdates({ force: false, showDialog: false });
  }, [initialCheck]);

  async function installUpdateTarget(target) {
    setInstallingUpdateTarget(target);
    setUpdateProgress({
      target,
      phase: "starting",
      indeterminate: true,
      message: target === "codex" ? "Preparation de la mise a jour Codex app-server..." : "Preparation du telechargement..."
    });
    setUpdateActionMessage(target === "codex" ? "Mise a jour Codex app-server en cours..." : "Telechargement de la mise a jour Codex Messenger...");
    try {
      const result = await api.installUpdateTarget(target);
      setUpdateActionMessage(result?.message || "Mise a jour terminee.");
      setUpdateProgress((current) => ({
        ...(current ?? {}),
        target,
        phase: result?.quitStarted ? "restarting" : "ready",
        percent: 100,
        needsRestart: Boolean(result?.needsRestart),
        quitStarted: Boolean(result?.quitStarted),
        message: result?.message || "Mise a jour terminee."
      }));
      if (!result?.quitStarted) {
        const refreshed = await api.checkUpdates({ force: true });
        setUpdateState(refreshed);
      }
      return result;
    } catch (error) {
      setUpdateActionMessage(error.message || "Mise a jour impossible.");
      setUpdateProgress({
        target,
        phase: "error",
        message: error.message || "Mise a jour impossible."
      });
      return { ok: false, error: error.message };
    } finally {
      setInstallingUpdateTarget("");
    }
  }

  return {
    updateDialogOpen,
    setUpdateDialogOpen,
    updateState,
    checkingUpdates,
    installingUpdateTarget,
    updateActionMessage,
    updateProgress,
    checkForUpdates,
    openUpdateTarget: (target) => api.openUpdateTarget(target),
    installUpdateTarget,
    restartForUpdate: () => api.restartForUpdate()
  };
}
