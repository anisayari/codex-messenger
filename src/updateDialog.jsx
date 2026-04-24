import React from "react";
import { Logo } from "./windowChrome.jsx";

export function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes <= 0) return "";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

export function updateProgressLabel(progress, copy) {
  if (!progress) return "";
  const updateCopy = copy?.updates ?? {};
  if (progress.phase === "download") {
    const percent = Number.isFinite(progress.percent) ? `${Math.round(progress.percent)}%` : "";
    const transferred = formatBytes(progress.transferred);
    const total = formatBytes(progress.total);
    const size = transferred && total ? `${transferred} / ${total}` : transferred;
    return [updateCopy.download || "Telechargement", percent, size].filter(Boolean).join(" - ");
  }
  if (progress.phase === "checking") return updateCopy.checking || "Verification...";
  if (progress.phase === "installing") return updateCopy.installing || "Installation...";
  if (progress.phase === "verifying") return updateCopy.verifyingInstall || "Verification de l'installation...";
  if (progress.phase === "restarting") return updateCopy.restarting || "Redemarrage en cours...";
  if (progress.phase === "ready") return updateCopy.ready || "Pret.";
  return progress.message || updateCopy.progressInProgress || "Mise a jour en cours...";
}

export function UpdateProgress({ progress, copy }) {
  if (!progress) return null;
  const percent = Number.isFinite(progress.percent) ? Math.max(0, Math.min(100, progress.percent)) : null;
  const indeterminate = progress.indeterminate || percent === null;
  return (
    <div className="update-progress" aria-live="polite">
      <div className={`update-progress-track${indeterminate ? " indeterminate" : ""}`}>
        <span className="update-progress-fill" style={indeterminate ? undefined : { width: `${percent}%` }} />
      </div>
      <small>{progress.message || updateProgressLabel(progress, copy)}</small>
      {progress.message ? <small>{updateProgressLabel(progress, copy)}</small> : null}
    </div>
  );
}

export default function UpdateDialog({
  updateState,
  checking,
  installingTarget,
  actionMessage,
  progress,
  appVersion,
  userAgent,
  copy,
  versionLabel,
  updateLineState,
  onCheck,
  onOpen,
  onInstall,
  onRestart,
  onClose
}) {
  const updateCopy = copy?.updates ?? {};
  const commonCopy = copy?.common ?? {};
  const front = updateState?.front ?? { currentVersion: appVersion };
  const codex = updateState?.codex ?? {};
  const checkedAt = updateState?.checkedAt ? new Date(updateState.checkedAt).toLocaleString() : updateCopy.never || "jamais";
  const frontInstalling = installingTarget === "front";
  const codexInstalling = installingTarget === "codex";
  const frontProgress = progress?.target === "front" ? progress : null;
  const codexProgress = progress?.target === "codex" ? progress : null;
  const needsRestart = Boolean(progress?.needsRestart) && !progress?.quitStarted;
  const frontReadyToInstall = Boolean(frontProgress?.needsRestart) && !frontProgress?.quitStarted;
  const restartLabel = progress?.target === "front"
    ? updateCopy.restartInstall || updateCopy.restart || "Redemarrer et installer"
    : updateCopy.restart || "Redemarrer";

  return (
    <div className="settings-dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="settings-dialog update-dialog" role="dialog" aria-modal="true" aria-label={updateCopy.aboutTitle || "A propos de Codex Messenger"}>
        <header>
          <strong>{updateCopy.aboutTitle || "A propos de Codex Messenger"}</strong>
          <button type="button" aria-label={commonCopy.close || "Fermer"} onClick={onClose}>x</button>
        </header>
        <section>
          <div className="about-product">
            <Logo />
            <div>
              <h2>Codex Messenger</h2>
              <p>{updateCopy.developedBy || "Developpe par Anis AYARI et Codex."}</p>
              <p>{updateCopy.productDescription || "Client Electron local inspire de MSN Messenger 7, connecte a codex app-server."}</p>
            </div>
          </div>
          <div className="update-grid">
            <article className={front.updateAvailable ? "update-card available" : "update-card"}>
              <strong>{updateCopy.productFront || "Codex Messenger front"}</strong>
              <span>{updateCopy.currentVersion || "Version actuelle"}: {versionLabel(front.currentVersion || appVersion)}</span>
              <span>{updateCopy.latestVersion || "Derniere version"}: {versionLabel(front.latestVersion)}</span>
              <small>{updateLineState(front)}</small>
              <button
                type="button"
                onClick={() => front.updateAvailable ? onInstall("front") : onOpen("front")}
                disabled={frontInstalling || frontReadyToInstall}
              >
                {frontInstalling
                  ? updateCopy.updating || "Update en cours..."
                  : frontReadyToInstall
                    ? updateCopy.readyToInstall || "Telecharge, pret a installer"
                    : front.updateAvailable
                      ? updateCopy.updateAutomatically || "Update automatiquement"
                      : updateCopy.openReleases || "Ouvrir les releases"}
              </button>
              <UpdateProgress progress={frontProgress} copy={copy} />
            </article>
            <article className={codex.updateAvailable ? "update-card available" : "update-card"}>
              <strong>{updateCopy.productServer || "Codex app-server"}</strong>
              <span>{updateCopy.localVersion || "Version locale"}: {versionLabel(codex.currentVersion || userAgent)}</span>
              <span>{updateCopy.latestVersion || "Derniere version"}: {versionLabel(codex.latestVersion)}</span>
              <small>{updateLineState(codex)}</small>
              <button type="button" onClick={() => onInstall("codex")} disabled={codexInstalling}>
                {codexInstalling ? updateCopy.updating || "Update en cours..." : updateCopy.updateAutomatically || "Update automatiquement"}
              </button>
              <UpdateProgress progress={codexProgress} copy={copy} />
            </article>
          </div>
          {actionMessage ? <p className="update-action-message">{actionMessage}</p> : null}
          <p className="update-note">
            {(updateCopy.checkedAt || "Derniere verification: {checkedAt}.").replace("{checkedAt}", checkedAt)} {updateCopy.privacyNote || "Codex Messenger ne stocke pas les conversations Codex: l'application est seulement un front client local."}
          </p>
        </section>
        <footer>
          <button type="button" onClick={() => onCheck()} disabled={checking}>
            {checking ? updateCopy.checking || "Verification..." : updateCopy.check || "Verifier mise a jour"}
          </button>
          {needsRestart ? (
            <button type="button" className="primary-footer-button" onClick={() => onRestart(progress?.target)}>{restartLabel}</button>
          ) : null}
          <button type="button" onClick={onClose}>{commonCopy.close || "Fermer"}</button>
        </footer>
      </section>
    </div>
  );
}
