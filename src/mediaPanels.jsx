import React from "react";

const toolbarIcons = {
  invite: "./icons/toolbar/invite.png",
  files: "./icons/toolbar/files.png",
  video: "./icons/toolbar/video.png",
  voice: "./icons/toolbar/voice.png",
  activities: "./icons/toolbar/activities.png",
  games: "./icons/toolbar/games.png",
  wizz: "./icons/toolbar/wizz.png"
};

const formatIcons = {
  font: "./icons/format/font.png",
  smile: "./icons/format/smile.png",
  voice: "./icons/format/voice.png",
  wink: "./icons/format/wink.png",
  image: "./icons/format/image.png",
  gift: "./icons/format/gift.png",
  wizz: "./icons/toolbar/wizz.png"
};

export function Tool({ icon, label, onClick, active = false }) {
  return (
    <button className={active ? `tool ${icon} active` : `tool ${icon}`} type="button" onClick={(event) => onClick?.(event)}>
      <span className={`tool-icon ${icon}`}><img src={toolbarIcons[icon]} alt="" draggable="false" /></span>
      <span>{label}</span>
    </button>
  );
}

export function FormatButton({ icon, title, onClick, label, active = false }) {
  return (
    <button className={`${label ? "format-button wide" : "format-button"}${active ? " active" : ""}`} type="button" title={title} onClick={(event) => onClick?.(event)}>
      <img src={formatIcons[icon]} alt="" draggable="false" />
      {label ? <span>{label}</span> : null}
    </button>
  );
}

function PopupPanel({ title, children }) {
  return (
    <div className="popup-panel">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

export function InvitePanel({ contact, onRun, onOpenProject, AvatarComponent, statusCopy = {} }) {
  const statusText = statusCopy[contact.status] ?? contact.status ?? "En ligne";
  return (
    <PopupPanel title="Invite">
      <div className="popup-contact-row">
        {AvatarComponent ? <AvatarComponent contact={contact} /> : null}
        <div><strong>{contact.name}</strong><span>{statusText}</span></div>
      </div>
      <div className="popup-command-list">
        <button type="button" onClick={() => onRun(`Invite ${contact.name} dans cette conversation Codex et resume son role.`)}>Inviter dans la conversation</button>
        <button type="button" onClick={() => onRun(`Resume le role de ${contact.name}, puis propose la prochaine action concrete.`)}>Resume le contact</button>
        <button type="button" onClick={onOpenProject} disabled={!contact.cwd}>Ouvrir le projet</button>
      </div>
    </PopupPanel>
  );
}

export function FilesPanel({ onSendFile, onCamera, onOpenProject, canOpenProject }) {
  return (
    <PopupPanel title="Send Files">
      <div className="popup-command-list">
        <button type="button" onClick={onSendFile}>Envoyer un fichier ou une image...</button>
        <button type="button" onClick={onCamera}>Capture webcam...</button>
        <button type="button" onClick={onOpenProject} disabled={!canOpenProject}>Ouvrir le dossier projet</button>
      </div>
    </PopupPanel>
  );
}

export function VoicePanel({ recording, mediaError, onToggle }) {
  return (
    <PopupPanel title="Voice Clip">
      <div className="popup-command-list">
        <button className={recording ? "recording" : ""} type="button" onClick={onToggle}>
          {recording ? "Arreter et envoyer" : "Demarrer l'enregistrement"}
        </button>
      </div>
      {mediaError ? <p className="popup-error">{mediaError}</p> : null}
    </PopupPanel>
  );
}

export function TextStylePanel({
  textStyle,
  onChange,
  onReset,
  normalizeTextStyle,
  textFontOptions,
  textColorOptions,
  bubbleColorOptions
}) {
  const style = normalizeTextStyle(textStyle);
  return (
    <PopupPanel title="Rendu du texte">
      <label className="text-style-field">
        <span>Police</span>
        <select value={style.fontFamily} onChange={(event) => onChange({ fontFamily: event.target.value })}>
          {textFontOptions.map((font) => <option value={font} key={font}>{font}</option>)}
        </select>
      </label>
      <label className="text-style-field">
        <span>Taille</span>
        <input type="number" min="9" max="18" value={style.fontSize} onChange={(event) => onChange({ fontSize: event.target.value })} />
      </label>
      <div className="text-style-field">
        <span>Texte</span>
        <div className="text-style-swatches">
          {textColorOptions.map((color) => (
            <button
              className={style.color === color ? "active" : ""}
              type="button"
              key={color}
              title={color}
              style={{ backgroundColor: color }}
              onClick={() => onChange({ color })}
            />
          ))}
        </div>
      </div>
      <div className="text-style-field">
        <span>Bulle Codex</span>
        <div className="text-style-swatches">
          {bubbleColorOptions.map((color) => (
            <button
              className={style.bubble === color ? "active" : ""}
              type="button"
              key={color}
              title={color}
              style={{ backgroundColor: color }}
              onClick={() => onChange({ bubble: color })}
            />
          ))}
        </div>
      </div>
      <div className="text-style-field">
        <span>Ma bulle</span>
        <div className="text-style-swatches">
          {bubbleColorOptions.map((color) => (
            <button
              className={style.meBubble === color ? "active" : ""}
              type="button"
              key={color}
              title={color}
              style={{ backgroundColor: color }}
              onClick={() => onChange({ meBubble: color })}
            />
          ))}
        </div>
      </div>
      <div
        className="text-style-preview"
        style={{
          color: style.color,
          fontFamily: style.fontFamily,
          fontSize: `${style.fontSize}px`,
          background: `linear-gradient(#ffffff, ${style.bubble})`
        }}
      >
        Salut, je garde ce rendu pour cette conversation :)
      </div>
      <div className="popup-command-list">
        <button type="button" onClick={onReset}>Revenir au rendu par defaut</button>
      </div>
    </PopupPanel>
  );
}

export function CameraPanel({ videoRef, cameraStream, mediaError, onSnapshot, onStop }) {
  return (
    <div className="media-panel camera-panel">
      <video ref={videoRef} autoPlay muted playsInline />
      <div className="media-actions">
        <button type="button" onClick={onSnapshot} disabled={!cameraStream}>Snapshot</button>
        <button type="button" onClick={onStop} disabled={!cameraStream}>Stop</button>
      </div>
      {mediaError ? <p>{mediaError}</p> : null}
    </div>
  );
}

export function ActivitiesPanel({ winks, sounds, prompts, onRun, onSendWink, onAskWink, onPreviewSound }) {
  return (
    <div className="activities-panel">
      <section className="activity-section">
        <h3>Clins d'oeil</h3>
        <div className="wink-grid">
          {winks.map((wink) => (
            <button type="button" key={wink.id} onClick={() => onSendWink(wink)}>
              <img src={wink.src} alt="" draggable="false" />
              <span>{wink.label}</span>
            </button>
          ))}
        </div>
        <button className="activity-command" type="button" onClick={() => onAskWink(winks[Math.floor(Math.random() * winks.length)])}>
          Demander a Codex
        </button>
      </section>
      <section className="activity-section">
        <h3>Sons MSN</h3>
        <div className="sound-grid">
          {sounds.map(([id, label]) => (
            <button type="button" key={id} onClick={() => onPreviewSound(id)}>{label}</button>
          ))}
        </div>
      </section>
      <section className="activity-section">
        <h3>Actions</h3>
        {prompts.map(([label, prompt]) => (
          <button className="activity-command" type="button" key={label} onClick={() => onRun(prompt)}>{label}</button>
        ))}
      </section>
    </div>
  );
}

export function EmoticonsPanel({ emoticons, animatedEmoticons, onInsert }) {
  return (
    <div className="emoticons-panel">
      <section className="activity-section">
        <h3>Emoticones MSN 7.5</h3>
        <div className="emoticon-grid">
          {emoticons.map((emoticon) => (
            <button type="button" key={emoticon.id} title={`${emoticon.label} ${emoticon.code}`} onClick={() => onInsert(emoticon)}>
              <img src={emoticon.src} alt="" draggable="false" />
              <span>{emoticon.code}</span>
            </button>
          ))}
        </div>
      </section>
      <section className="activity-section">
        <h3>Emoticones animees</h3>
        <div className="emoticon-grid animated">
          {animatedEmoticons.map((emoticon) => (
            <button type="button" key={emoticon.id} title={`${emoticon.label} ${emoticon.code}`} onClick={() => onInsert(emoticon)}>
              <img src={emoticon.src} alt="" draggable="false" />
              <span>{emoticon.code}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
