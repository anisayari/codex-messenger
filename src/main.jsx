import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const api = window.codexMsn;
const statusLabels = {
  online: "En ligne",
  busy: "Occupe",
  brb: "De retour bientot",
  away: "Absent",
  phone: "Au telephone",
  lunch: "Parti manger",
  offline: "Hors ligne"
};
const statusOptions = [
  ["online", "En ligne"],
  ["busy", "Occupe"],
  ["brb", "De retour bientot"],
  ["away", "Absent"],
  ["phone", "Au telephone"],
  ["lunch", "Parti manger"],
  ["offline", "Apparaitre hors ligne"]
];
const audioFiles = {
  wizz: "./audio/msn_wizz.mp3",
  message: "./audio/msn_nouveau_message.mp3"
};
const brandPeopleLogo = new URL("./icons/codex-messenger-people.png", window.location.href).href;
const toolbarIcons = {
  invite: "./icons/toolbar/invite.png",
  files: "./icons/toolbar/files.png",
  video: "./icons/toolbar/video.png",
  voice: "./icons/toolbar/voice.png",
  activities: "./icons/toolbar/activities.png",
  games: "./icons/toolbar/games.png",
  wizz: "./icons/toolbar/wizz.png"
};
const activityPrompts = [
  ["Plan", "Fais un plan de travail court pour ce projet, puis propose la premiere action concrete."],
  ["Review", "Fais une revue pragmatique du projet courant: bugs probables, risques, tests manquants, priorites."],
  ["Tests", "Inspecte le projet et propose les commandes de test/build pertinentes. Si c'est raisonnable, lance-les."],
  ["Design", "Analyse l'interface actuelle et propose les modifications visuelles prioritaires pour coller a MSN 7."]
];
const gamePrompts = [
  ["Bug Hunt", "Lance un mini-jeu Bug Hunt: donne-moi un fichier ou une zone a inspecter, puis guide-moi pour trouver le bug avant de proposer la correction."],
  ["20 Questions", "Lance un jeu de 20 questions pour clarifier une feature du projet avant implementation."],
  ["Code Golf", "Choisis une petite amelioration du projet et transforme-la en defi code golf lisible, puis propose la solution propre."],
  ["XP Polish", "Lance un defi XP Polish: trouve trois details visuels qui trahissent une UI moderne et corrige-les un par un."]
];
const gameCatalog = [
  { id: "morpion", label: "Morpion" },
  { id: "memory", label: "Memory" },
  { id: "wizz", label: "Wizz" }
];
const ticLines = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6]
];
const loginCopy = {
  fr: {
    subtitle: "Connexion au serveur local Codex",
    email: "Adresse de messagerie",
    status: "Statut",
    language: "Langue",
    codexPath: "Chemin vers Codex CLI",
    autoPath: "Detection automatique via PATH",
    browse: "Parcourir",
    test: "Tester",
    online: "En ligne",
    away: "Absent",
    busy: "Occupe",
    offline: "Apparaitre hors ligne",
    remember: "Memoriser mon adresse",
    connect: "Connexion",
    connecting: "Connexion Codex...",
    hint: "Utilise `codex app-server` via le main process Electron. Aucune cle API n'est exposee au renderer.",
    found: "Codex detecte",
    missing: "Codex non detecte. Installez Codex, ajoutez-le au PATH, ou indiquez codex.exe/codex.cmd.",
    testOk: "Test OK",
    testFail: "Test impossible"
  },
  en: {
    subtitle: "Connect to the local Codex server",
    email: "Messaging address",
    status: "Status",
    language: "Language",
    codexPath: "Codex CLI path",
    autoPath: "Auto-detect from PATH",
    browse: "Browse",
    test: "Test",
    online: "Online",
    away: "Away",
    busy: "Busy",
    offline: "Appear offline",
    remember: "Remember my address",
    connect: "Sign in",
    connecting: "Connecting Codex...",
    hint: "Uses `codex app-server` through the Electron main process. No API key is exposed to the renderer.",
    found: "Codex detected",
    missing: "Codex was not detected. Install Codex, add it to PATH, or select codex.exe/codex.cmd.",
    testOk: "Test OK",
    testFail: "Test failed"
  }
};

function copyFor(language) {
  return loginCopy[language === "en" ? "en" : "fr"];
}

function now() {
  return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(new Date());
}

function makeMessage(from, author, text, options = {}) {
  return { id: crypto.randomUUID(), from, author, text, time: now(), ...options };
}

function playAudio(src, fallback) {
  const audio = new Audio(src);
  audio.currentTime = 0;
  audio.play().catch(() => fallback?.());
}

function playNewMessage() {
  playAudio(audioFiles.message);
}

function playSyntheticWizz() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  const ctx = new AudioContext();
  const master = ctx.createGain();
  master.gain.setValueAtTime(0.0001, ctx.currentTime);
  master.gain.exponentialRampToValueAtTime(0.22, ctx.currentTime + 0.01);
  master.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.72);
  master.connect(ctx.destination);

  [[0, 620], [0.1, 880], [0.2, 540], [0.3, 980], [0.46, 720]].forEach(([offset, hz]) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(hz, ctx.currentTime + offset);
    osc.frequency.exponentialRampToValueAtTime(hz * 1.28, ctx.currentTime + offset + 0.12);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime + offset);
    gain.gain.exponentialRampToValueAtTime(0.13, ctx.currentTime + offset + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + offset + 0.14);
    osc.connect(gain);
    gain.connect(master);
    osc.start(ctx.currentTime + offset);
    osc.stop(ctx.currentTime + offset + 0.16);
  });

  window.setTimeout(() => ctx.close(), 900);
}

function playWizz() {
  playAudio(audioFiles.wizz, playSyntheticWizz);
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function localFileUrl(filePath) {
  return `file:///${String(filePath).replace(/\\/g, "/")}`;
}

function presenceClass(status) {
  if (status === "busy") return "busy";
  if (status === "offline") return "offline";
  if (["away", "brb", "phone", "lunch"].includes(status)) return "away";
  return "online";
}

function Logo({ small = false }) {
  return (
    <span className={small ? "logo small" : "logo"} aria-hidden="true">
      <img src={brandPeopleLogo} alt="" draggable="false" />
    </span>
  );
}

function Avatar({ contact, large = false }) {
  const picturePath = contact.displayPicturePath || contact.picturePath;
  return (
    <div className={`${large ? "avatar large" : "avatar"} ${presenceClass(contact.status)}`} style={{ "--avatar": contact.color ?? "#11a77a" }}>
      {picturePath ? (
        <img className="avatar-picture" src={localFileUrl(picturePath)} alt="" draggable="false" />
      ) : contact.avatar === "butterfly" ? (
        <Logo small={!large} />
      ) : (
        <span className={`glyph ${contact.avatar}`} />
      )}
    </div>
  );
}

function Titlebar({ title }) {
  return (
    <header className="titlebar">
      <div className="title-left">
        <Logo small />
        <span>{title}</span>
      </div>
      <div className="window-buttons">
        <button type="button" aria-label="Minimiser" onClick={() => api.window.minimize()}><span /></button>
        <button type="button" aria-label="Maximiser" onClick={() => api.window.maximize()}><span /></button>
        <button type="button" aria-label="Fermer" onClick={() => api.window.close()}><span /></button>
      </div>
    </header>
  );
}

function Menu({ items }) {
  const [open, setOpen] = useState(null);
  const ref = useRef(null);
  const normalized = items.map((item) => typeof item === "string" ? { label: item, entries: [] } : item);

  useEffect(() => {
    const close = (event) => {
      if (!ref.current?.contains(event.target)) setOpen(null);
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setOpen(null);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  async function runEntry(entry) {
    if (entry.disabled) return;
    setOpen(null);
    try {
      await entry.action?.();
    } catch (error) {
      window.alert(error.message ?? "Action impossible");
    }
  }

  return (
    <nav className="menu" ref={ref}>
      {normalized.map((menu, index) => (
        <div className="menu-item" key={menu.label} onMouseEnter={() => open !== null && setOpen(index)}>
          <button
            className={open === index ? "menu-button active" : "menu-button"}
            type="button"
            onClick={() => setOpen(open === index ? null : index)}
          >
            {menu.label}
          </button>
          {open === index ? (
            <div className="menu-dropdown">
              {(menu.entries?.length ? menu.entries : [{ label: "Aucune action", disabled: true }]).map((entry, entryIndex) => (
                entry.separator ? (
                  <div className="menu-separator" key={`separator-${entryIndex}`} />
                ) : (
                  <button
                    className="menu-entry"
                    type="button"
                    disabled={entry.disabled}
                    key={entry.label}
                    onClick={() => runEntry(entry)}
                  >
                    <span>{entry.label}</span>
                    {entry.shortcut ? <small>{entry.shortcut}</small> : null}
                  </button>
                )
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </nav>
  );
}

function LoginView({ initialProfile, initialSettings, initialCodexStatus, onSignedIn }) {
  const [email, setEmail] = useState(initialProfile.email);
  const [displayName, setDisplayName] = useState(initialProfile.displayName ?? initialProfile.email.split("@")[0]);
  const [personalMessage, setPersonalMessage] = useState(initialProfile.personalMessage ?? "");
  const [status, setStatus] = useState(initialProfile.status);
  const [language, setLanguage] = useState(initialProfile.language ?? initialSettings?.language ?? "fr");
  const [codexPath, setCodexPath] = useState(initialSettings?.codexPath ?? "");
  const [codexStatus, setCodexStatus] = useState(initialCodexStatus);
  const [state, setState] = useState("idle");
  const [error, setError] = useState("");
  const text = copyFor(language);

  async function submit(event) {
    event.preventDefault();
    setError("");
    setState("connecting");
    try {
      const result = await api.signIn({ email, displayName, personalMessage, status, language, codexPath, displayPicturePath: initialProfile.displayPicturePath ?? "" });
      onSignedIn(result.profile, result.userAgent, result.settings, result.codexStatus);
    } catch (err) {
      setError(err.message);
      setState("idle");
    }
  }

  async function chooseCodex() {
    setError("");
    const result = await api.chooseCodex();
    if (result?.canceled) return;
    setCodexPath(result.settings.codexPath ?? "");
    setCodexStatus(result.codexStatus);
  }

  async function testCodex() {
    setError("");
    try {
      const result = await api.testCodex(codexPath || null);
      setCodexStatus(result);
    } catch (err) {
      setCodexStatus({ ok: false, error: err.message });
      setError(`${text.testFail}: ${err.message}`);
    }
  }

  return (
    <form className="login-panel" onSubmit={submit}>
      <div className="identity">
        <Logo />
        <div>
          <h1>Codex Messenger</h1>
          <p>{text.subtitle}</p>
        </div>
      </div>
      <label className="field">
        <span>{text.email}</span>
        <input value={email} onChange={(event) => setEmail(event.target.value)} />
      </label>
      <label className="field">
        <span>Nom affiche</span>
        <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
      </label>
      <label className="field">
        <span>Message personnel</span>
        <input value={personalMessage} onChange={(event) => setPersonalMessage(event.target.value)} maxLength={140} />
      </label>
      <label className="field">
        <span>{text.status}</span>
        <select value={status} onChange={(event) => setStatus(event.target.value)}>
          {statusOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
        </select>
      </label>
      <label className="field">
        <span>{text.language}</span>
        <select value={language} onChange={(event) => setLanguage(event.target.value)}>
          <option value="fr">Francais</option>
          <option value="en">English</option>
        </select>
      </label>
      <label className="field">
        <span>{text.codexPath}</span>
        <input value={codexPath} onChange={(event) => setCodexPath(event.target.value)} placeholder={text.autoPath} />
      </label>
      <div className="codex-path-actions">
        <button type="button" onClick={chooseCodex}>{text.browse}</button>
        <button type="button" onClick={testCodex}>{text.test}</button>
      </div>
      <p className={codexStatus?.ok ? "codex-status ok" : "codex-status"}>
        {codexStatus?.ok ? `${text.found}: ${codexStatus.command}` : (codexStatus?.error ?? text.missing)}
      </p>
      <label className="remember"><input type="checkbox" defaultChecked /> {text.remember}</label>
      <button className="primary" disabled={state !== "idle"}>{state === "idle" ? text.connect : text.connecting}</button>
      <div className={state === "idle" ? "progress" : "progress active"}><span /></div>
      {error ? <p className="error-box">{error}</p> : null}
      <p className="server-hint">{text.hint}</p>
    </form>
  );
}

function ProfileEditor({ profile, onChange, onChoosePicture, onClearPicture, onClose }) {
  const [draft, setDraft] = useState(profile);

  useEffect(() => {
    setDraft(profile);
  }, [profile]);

  function update(field, value) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function submit(event) {
    event.preventDefault();
    onChange(draft);
  }

  return (
    <form className="profile-editor" onSubmit={submit}>
      <div className="profile-editor-picture">
        <Avatar contact={{ ...draft, avatar: "butterfly", color: "#11a77a" }} />
        <div className="profile-picture-tools">
          <button type="button" onClick={onChoosePicture}>Changer</button>
          <button type="button" onClick={onClearPicture}>Defaut</button>
        </div>
      </div>
      <label>
        <span>Nom affiche</span>
        <input value={draft.displayName ?? ""} onChange={(event) => update("displayName", event.target.value)} />
      </label>
      <label>
        <span>Message personnel</span>
        <input value={draft.personalMessage ?? ""} onChange={(event) => update("personalMessage", event.target.value)} maxLength={140} />
      </label>
      <label>
        <span>Statut</span>
        <select value={draft.status ?? "online"} onChange={(event) => update("status", event.target.value)}>
          {statusOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
        </select>
      </label>
      <div className="profile-editor-actions">
        <button type="submit">Appliquer</button>
        <button type="button" onClick={onClose}>Fermer</button>
      </div>
    </form>
  );
}

function RosterView({ bootstrap, profile, userAgent, refreshTick, profileEditorOpen, onProfileEditorOpenChange, onProfileChange }) {
  const [finished, setFinished] = useState(null);
  const [conversations, setConversations] = useState(bootstrap.conversations);
  const [collapsed, setCollapsed] = useState({});
  const [query, setQuery] = useState("");

  useEffect(() => {
    api.listConversations().then(setConversations).catch(() => {});
  }, [refreshTick]);

  useEffect(() => api.on("conversation:finished", ({ contactId }) => {
    const contact = bootstrap.contacts.find((item) => item.id === contactId);
    if (!contact) return;
    setFinished(`${contact.name} a termine.`);
    window.setTimeout(() => setFinished(null), 4200);
  }), [bootstrap.contacts]);

  const groups = useMemo(() => {
    const search = query.trim().toLowerCase();
    const match = (item) => `${item.name} ${item.statusText ?? ""} ${item.mood ?? ""}`.toLowerCase().includes(search);
    const byGroup = [];

    byGroup.push({
      id: "agents",
      title: "Codex Agents",
      items: bootstrap.contacts.map((contact) => ({
        id: contact.id,
        name: contact.name,
        mood: contact.mood,
        status: contact.status,
        statusText: statusLabels[contact.status] ?? contact.status,
        onOpen: () => api.openConversation(contact.id)
      }))
    });

    const projectItems = (conversations?.projects ?? []).map((project) => ({
      id: project.id,
      name: project.name,
      mood: project.cwd,
      status: project.threads.length ? "online" : "offline",
      statusText: project.threads.length ? `${project.threads.length} fil${project.threads.length > 1 ? "s" : ""}` : "nouveau",
      onOpen: () => api.openProject(project.cwd)
    }));
    if (projectItems.length) byGroup.push({ id: "projects", title: "Projects", items: projectItems });

    const threadItems = (conversations?.projects ?? [])
      .flatMap((project) => project.threads.map((thread) => ({ ...thread, projectName: project.name })))
      .sort((a, b) => String(b.timestamp ?? "").localeCompare(String(a.timestamp ?? "")))
      .slice(0, 28)
      .map((thread) => ({
        id: thread.contactId,
        name: thread.preview,
        mood: thread.projectName,
        status: "away",
        statusText: "fil",
        onOpen: () => api.openThread(thread.id)
      }));
    if (threadItems.length) byGroup.push({ id: "threads", title: "Recent Codex Threads", items: threadItems });

    return byGroup.map((group) => ({
      ...group,
      items: search ? group.items.filter(match) : group.items
    })).filter((group) => group.items.length);
  }, [bootstrap.contacts, conversations, query]);

  function toggleGroup(groupId) {
    setCollapsed((current) => ({ ...current, [groupId]: !current[groupId] }));
  }

  async function saveProfile(nextProfile) {
    const result = await api.setSettings({
      language: nextProfile.language ?? profile.language,
      profile: nextProfile
    });
    onProfileChange(result.settings.profile, userAgent, result.settings);
  }

  function changeStatus(status) {
    saveProfile({ ...profile, status });
  }

  async function chooseProfilePicture() {
    const result = await api.chooseProfilePicture();
    if (result?.canceled) return;
    onProfileChange(result.profile, userAgent, result.settings);
  }

  async function clearProfilePicture() {
    const result = await api.clearProfilePicture();
    onProfileChange(result.profile, userAgent, result.settings);
  }

  return (
    <section className="roster">
      <div className="me">
        <button className="display-picture-button" type="button" onClick={() => onProfileEditorOpenChange(!profileEditorOpen)}>
          <Avatar contact={{ ...profile, avatar: "butterfly", color: "#11a77a" }} />
        </button>
        <div>
          <div className="me-line">
            <strong>{profile.displayName || profile.email}</strong>
            <select value={profile.status} onChange={(event) => changeStatus(event.target.value)}>
              {statusOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
            </select>
          </div>
          <small className="me-email">{profile.email}</small>
          <p>{profile.personalMessage || userAgent || "Codex local connecte"}</p>
        </div>
      </div>
      {profileEditorOpen ? (
        <ProfileEditor
          profile={profile}
          onChange={saveProfile}
          onChoosePicture={chooseProfilePicture}
          onClearPicture={clearProfilePicture}
          onClose={() => onProfileEditorOpenChange(false)}
        />
      ) : null}
      <div className="msn-tabs">
        <button type="button" onClick={() => window.alert("Aucune boite e-mail locale n'est connectee pour le moment.")}><span className="mini mail" /> E-mail</button>
        <button type="button" onClick={() => api.openConversation("codex")}><Logo small /> Codex Today</button>
      </div>
      <div className="search"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search..." /></div>
      <div className="groups">
        {groups.map((group) => {
          const online = group.items.filter((item) => item.status !== "offline").length;
          return (
          <section className="roster-group" key={group.id}>
            <button className="group-heading" type="button" onClick={() => toggleGroup(group.id)}>
              <span className={collapsed[group.id] ? "group-box collapsed" : "group-box"} />
              <strong>{group.title} ({online}/{group.items.length})</strong>
            </button>
            {!collapsed[group.id] ? group.items.map((item) => (
              <button className="contact-line" type="button" key={item.id} onClick={item.onOpen}>
                <span className={`msn-presence ${item.status}`} />
                <span className="contact-line-copy">
                  <span className="contact-name">{item.name}</span>
                  <span className="contact-state">({item.statusText})</span>
                  <span className="contact-mood">{item.mood}</span>
                </span>
              </button>
            )) : null}
          </section>
        );})}
      </div>
      <button className="add-contact" type="button" onClick={() => api.openConversation("codex")}><span className="mini plus" /> Add a Contact</button>
      <div className="wordmark"><span>Codex</span><Logo small /><strong>Messenger</strong></div>
      {finished ? <div className="toast"><Logo small /><span>{finished}</span></div> : null}
    </section>
  );
}

function MainWindow() {
  const [bootstrap, setBootstrap] = useState(null);
  const [profile, setProfile] = useState(null);
  const [userAgent, setUserAgent] = useState("");
  const [settings, setSettings] = useState(null);
  const [codexStatus, setCodexStatus] = useState(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [profileEditorOpen, setProfileEditorOpen] = useState(false);

  useEffect(() => {
    api.bootstrap().then((data) => {
      setBootstrap(data);
      setProfile(data.profile);
      setUserAgent(data.userAgent ?? "");
      setSettings(data.settings);
      setCodexStatus(data.codexStatus);
    });
  }, []);

  if (!bootstrap || !profile) return <div className="loading">Connexion...</div>;

  async function saveProfilePatch(patch) {
    const nextProfile = { ...profile, ...patch };
    const result = await api.setSettings({
      language: nextProfile.language ?? profile.language,
      profile: nextProfile
    });
    setProfile(result.settings.profile);
    setSettings(result.settings);
  }

  const uploadsPath = `${bootstrap.cwd}\\uploads`;
  const mainMenus = [
    {
      label: "Fichier",
      entries: [
        { label: "Nouvelle conversation Codex", action: () => api.openConversation("codex") },
        { label: "Ouvrir un projet...", action: () => api.openProjectPicker() },
        { label: "Modifier mon profil...", action: () => setProfileEditorOpen(true) },
        { separator: true },
        { label: "Ouvrir le dossier de l'app", action: () => api.app.openPath(bootstrap.cwd) },
        { label: "Quitter", shortcut: "Alt+F4", action: () => api.app.quit() }
      ]
    },
    {
      label: "Contacts",
      entries: [
        ...bootstrap.contacts.map((contact) => ({
          label: `${contact.name} (${statusLabels[contact.status] ?? contact.status})`,
          action: () => api.openConversation(contact.id)
        })),
        { separator: true },
        { label: "Add a Contact", action: () => api.openConversation("codex") }
      ]
    },
    {
      label: "Actions",
      entries: [
        { label: "Codex Today", action: () => api.openConversation("codex") },
        { label: "Rafraichir la liste", shortcut: "F5", action: () => setRefreshTick((tick) => tick + 1) },
        { separator: true },
        ...statusOptions.map(([status, label]) => ({
          label: `Statut: ${label}`,
          action: () => saveProfilePatch({ status })
        })),
        { separator: true },
        {
          label: "Wizz Codex",
          action: async () => {
            await api.openConversation("codex");
            window.setTimeout(() => api.wizz("codex"), 250);
          }
        }
      ]
    },
    {
      label: "Outils",
      entries: [
        { label: "Dossier uploads", action: () => api.app.openPath(uploadsPath) },
        { label: "Relancer cette fenetre", shortcut: "Ctrl+R", action: () => api.app.reload() },
        { separator: true },
        { label: "Minimiser", action: () => api.window.minimize() },
        { label: "Maximiser / restaurer", action: () => api.window.maximize() }
      ]
    },
    {
      label: "Aide",
      entries: [
        {
          label: "A propos de Codex Messenger",
          action: () => window.alert("Codex Messenger\n\nClient Electron local inspire de MSN Messenger 7, connecte a codex app-server.")
        },
        { label: "Serveur Codex", action: () => window.alert(userAgent || "Serveur Codex non connecte.") }
      ]
    }
  ];

  return (
    <main className="msn-window">
      <Titlebar title="Codex Messenger" />
      <Menu items={mainMenus} />
      {userAgent ? (
        <RosterView
          bootstrap={bootstrap}
          profile={profile}
          userAgent={userAgent}
          refreshTick={refreshTick}
          profileEditorOpen={profileEditorOpen}
          onProfileEditorOpenChange={setProfileEditorOpen}
          onProfileChange={(nextProfile, nextUserAgent, nextSettings) => {
            setProfile(nextProfile);
            setUserAgent(nextUserAgent);
            if (nextSettings) setSettings(nextSettings);
          }}
        />
      ) : (
        <LoginView initialProfile={profile} initialSettings={settings} initialCodexStatus={codexStatus} onSignedIn={(nextProfile, nextUserAgent, nextSettings, nextCodexStatus) => {
          setProfile(nextProfile);
          setUserAgent(nextUserAgent);
          setSettings(nextSettings);
          setCodexStatus(nextCodexStatus);
        }} />
      )}
    </main>
  );
}

function Tool({ icon, label, onClick }) {
  return (
    <button className={`tool ${icon}`} type="button" onClick={onClick}>
      <span className={`tool-icon ${icon}`}><img src={toolbarIcons[icon]} alt="" draggable="false" /></span>
      <span>{label}</span>
    </button>
  );
}

function ConversationBrowser({ conversations, activeContactId, onOpenProject, onOpenThread }) {
  if (!conversations?.projects?.length) return <div className="side-empty">Aucun fil Codex trouve.</div>;
  return (
    <div className="conversation-browser">
      {conversations.projects.map((project) => (
        <section key={project.cwd} className="project-group">
          <button className={activeContactId === project.id ? "project-title active" : "project-title"} type="button" onClick={() => onOpenProject(project.cwd)}>
            <span className="presence online" />
            <span><strong>{project.name}</strong><small>{project.cwd}</small></span>
          </button>
          <div className="thread-tabs">
            {project.threads.length ? project.threads.slice(0, 8).map((thread) => (
              <button className={activeContactId === thread.contactId ? "thread-tab active" : "thread-tab"} type="button" key={thread.id} onClick={() => onOpenThread(thread.id)}>
                <span>{thread.preview}</span>
              </button>
            )) : <span className="no-thread">Nouveau fil au premier message</span>}
          </div>
        </section>
      ))}
    </div>
  );
}

function ActionPanel({ title, options, onRun }) {
  return (
    <div className="side-action-panel">
      <h3>{title}</h3>
      {options.map(([label, prompt]) => (
        <button type="button" key={label} onClick={() => onRun(prompt)}>{label}</button>
      ))}
    </div>
  );
}

function gameWinner(board) {
  for (const [a, b, c] of ticLines) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
  }
  if (board.every(Boolean)) return "draw";
  return null;
}

function chooseCodexMove(board) {
  const empty = board.map((cell, index) => cell ? null : index).filter((index) => index !== null);
  const testMove = (mark) => empty.find((index) => {
    const next = [...board];
    next[index] = mark;
    return gameWinner(next) === mark;
  });
  return testMove("O") ?? testMove("X") ?? (board[4] ? null : 4) ?? [0, 2, 6, 8].find((index) => !board[index]) ?? empty[0] ?? null;
}

function createMemoryDeck() {
  return ["C", ">", "_", "7", "W", "X"]
    .flatMap((value) => [value, value])
    .sort(() => Math.random() - 0.5)
    .map((value, index) => ({ id: `${value}-${index}-${Math.random()}`, value, matched: false }));
}

function nextReflexTarget(current = -1) {
  let next = Math.floor(Math.random() * 9);
  if (next === current) next = (next + 1) % 9;
  return next;
}

function GamesPanel({ activeGame, onSelectGame, onRun, waiting }) {
  return (
    <div className="games-panel">
      <div className={waiting ? "game-presence thinking" : "game-presence"}>
        <Logo small />
        <span>{waiting ? "Codex reflechit..." : "Codex joue aussi"}</span>
      </div>
      <div className="game-tabs">
        {gameCatalog.map((game) => (
          <button className={activeGame === game.id ? "active" : ""} type="button" key={game.id} onClick={() => onSelectGame(game.id)}>
            {game.label}
          </button>
        ))}
      </div>
      {activeGame === "morpion" ? <TicTacToeGame /> : null}
      {activeGame === "memory" ? <MemoryGame /> : null}
      {activeGame === "wizz" ? <WizzReflexGame /> : null}
      <div className="chat-game-prompts">
        <button type="button" onClick={() => onRun(gamePrompts[Math.floor(Math.random() * gamePrompts.length)][1])}>Defi chat Codex</button>
      </div>
    </div>
  );
}

function TicTacToeGame() {
  const [board, setBoard] = useState(Array(9).fill(""));
  const [status, setStatus] = useState("A toi de jouer.");
  const [codexThinking, setCodexThinking] = useState(false);
  const winner = gameWinner(board);

  function reset() {
    setBoard(Array(9).fill(""));
    setStatus("A toi de jouer.");
    setCodexThinking(false);
  }

  function play(index) {
    if (board[index] || winner || codexThinking) return;
    const playerBoard = [...board];
    playerBoard[index] = "X";
    const playerWinner = gameWinner(playerBoard);
    setBoard(playerBoard);
    if (playerWinner === "X") {
      setStatus("Tu gagnes contre Codex.");
      return;
    }
    if (playerWinner === "draw") {
      setStatus("Match nul.");
      return;
    }
    setCodexThinking(true);
    setStatus("Codex joue...");
    window.setTimeout(() => {
      const move = chooseCodexMove(playerBoard);
      const codexBoard = [...playerBoard];
      if (move !== null) codexBoard[move] = "O";
      const result = gameWinner(codexBoard);
      setBoard(codexBoard);
      setCodexThinking(false);
      if (result === "O") setStatus("Codex gagne cette manche.");
      else if (result === "draw") setStatus("Match nul.");
      else setStatus("A toi de jouer.");
    }, 380);
  }

  return (
    <section className="game-card">
      <div className="game-head"><strong>Morpion</strong><button type="button" onClick={reset}>New</button></div>
      <div className="tic-grid">
        {board.map((cell, index) => (
          <button className={cell ? `tic-cell ${cell.toLowerCase()}` : "tic-cell"} type="button" key={index} onClick={() => play(index)} disabled={Boolean(cell) || Boolean(winner) || codexThinking}>
            {cell}
          </button>
        ))}
      </div>
      <p className="game-status">{status}</p>
    </section>
  );
}

function MemoryGame() {
  const [deck, setDeck] = useState(createMemoryDeck);
  const [open, setOpen] = useState([]);
  const [moves, setMoves] = useState(0);
  const [status, setStatus] = useState("Trouve les paires Codex.");

  function reset() {
    setDeck(createMemoryDeck());
    setOpen([]);
    setMoves(0);
    setStatus("Trouve les paires Codex.");
  }

  function flip(index) {
    if (open.length === 2 || open.includes(index) || deck[index].matched) return;
    const nextOpen = [...open, index];
    setOpen(nextOpen);
    if (nextOpen.length !== 2) return;
    setMoves((current) => current + 1);
    const [first, second] = nextOpen;
    if (deck[first].value === deck[second].value) {
      const nextDeck = deck.map((card, cardIndex) => cardIndex === first || cardIndex === second ? { ...card, matched: true } : card);
      setDeck(nextDeck);
      setOpen([]);
      setStatus(nextDeck.every((card) => card.matched) ? "Toutes les paires sont trouvees." : "Paire trouvee.");
      return;
    }
    setStatus("Codex a vu la paire. Reessaie.");
    window.setTimeout(() => setOpen([]), 650);
  }

  return (
    <section className="game-card">
      <div className="game-head"><strong>Memory</strong><button type="button" onClick={reset}>New</button></div>
      <div className="memory-grid">
        {deck.map((card, index) => {
          const visible = card.matched || open.includes(index);
          return (
            <button className={visible ? "memory-card visible" : "memory-card"} type="button" key={card.id} onClick={() => flip(index)}>
              {visible ? card.value : "?"}
            </button>
          );
        })}
      </div>
      <p className="game-status">{status} Coups: {moves}</p>
    </section>
  );
}

function WizzReflexGame() {
  const [target, setTarget] = useState(() => nextReflexTarget());
  const [score, setScore] = useState({ me: 0, codex: 0 });
  const [running, setRunning] = useState(true);
  const [status, setStatus] = useState("Clique le Wizz avant Codex.");

  useEffect(() => {
    if (!running) return undefined;
    const timeout = window.setTimeout(() => {
      setScore((current) => {
        const codex = current.codex + 1;
        if (codex >= 10) {
          setRunning(false);
          setStatus("Codex gagne au reflexe.");
        } else {
          setStatus("Codex marque.");
          setTarget((currentTarget) => nextReflexTarget(currentTarget));
        }
        return { ...current, codex };
      });
    }, 1900);
    return () => window.clearTimeout(timeout);
  }, [target, running]);

  function reset() {
    setScore({ me: 0, codex: 0 });
    setTarget(nextReflexTarget());
    setRunning(true);
    setStatus("Clique le Wizz avant Codex.");
  }

  function hit(index) {
    if (!running || index !== target) return;
    setScore((current) => {
      const me = current.me + 1;
      if (me >= 10) {
        setRunning(false);
        setStatus("Tu gagnes le Wizz Reflex.");
      } else {
        setStatus("Point pour toi.");
        setTarget((currentTarget) => nextReflexTarget(currentTarget));
      }
      return { ...current, me };
    });
  }

  return (
    <section className="game-card">
      <div className="game-head"><strong>Wizz Reflex</strong><button type="button" onClick={reset}>New</button></div>
      <div className="game-score"><span>Toi {score.me}</span><span>Codex {score.codex}</span></div>
      <div className="reflex-grid">
        {Array.from({ length: 9 }).map((_, index) => (
          <button className={index === target && running ? "reflex-cell target" : "reflex-cell"} type="button" key={index} onClick={() => hit(index)}>
            {index === target && running ? "W" : ""}
          </button>
        ))}
      </div>
      <p className="game-status">{status}</p>
    </section>
  );
}

function ChatWindow({ bootstrap }) {
  const contact = bootstrap.contact ?? bootstrap.contacts.find((item) => item.id === bootstrap.contactId) ?? bootstrap.contacts[0];
  const selfContact = {
    id: "self",
    name: bootstrap.profile.displayName,
    status: bootstrap.profile.status,
    displayPicturePath: bootstrap.profile.displayPicturePath,
    personalMessage: bootstrap.profile.personalMessage,
    color: "#6e8799",
    avatar: "butterfly"
  };
  const [messages, setMessages] = useState(bootstrap.historyMessages ?? []);
  const [draft, setDraft] = useState("");
  const [typing, setTyping] = useState(false);
  const [wizzing, setWizzing] = useState(false);
  const [conversations, setConversations] = useState(bootstrap.conversations);
  const [sideMode, setSideMode] = useState("conversations");
  const [activeGame, setActiveGame] = useState("morpion");
  const [cameraStream, setCameraStream] = useState(null);
  const [recording, setRecording] = useState(false);
  const [mediaError, setMediaError] = useState("");
  const scrollRef = useRef(null);
  const videoRef = useRef(null);
  const textareaRef = useRef(null);
  const recorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  async function refreshConversations() {
    try {
      setConversations(await api.listConversations());
    } catch {
      setConversations((current) => current);
    }
  }

  useEffect(() => {
    const markRead = () => {
      if (document.visibilityState !== "hidden" && document.hasFocus()) api.markRead(contact.id);
    };
    window.addEventListener("focus", markRead);
    document.addEventListener("visibilitychange", markRead);
    if (document.hasFocus()) markRead();
    return () => {
      window.removeEventListener("focus", markRead);
      document.removeEventListener("visibilitychange", markRead);
    };
  }, [contact.id]);

  useEffect(() => {
    refreshConversations();
  }, []);

  useEffect(() => {
    if (videoRef.current && cameraStream) videoRef.current.srcObject = cameraStream;
  }, [cameraStream, sideMode]);

  useEffect(() => () => {
    cameraStream?.getTracks().forEach((track) => track.stop());
    recorderRef.current?.stream?.getTracks?.().forEach((track) => track.stop());
  }, [cameraStream]);

  useEffect(() => {
    const offDelta = api.on("codex:delta", ({ contactId, delta }) => {
      if (contactId !== contact.id) return;
      setTyping(false);
      setMessages((current) => {
        if (!current[current.length - 1]?.streaming) playNewMessage();
        return appendAgentDelta(current, contact.name, delta);
      });
    });
    const offCompleted = api.on("codex:completed-item", ({ contactId, text }) => {
      if (contactId !== contact.id || !text) return;
      setTyping(false);
      setMessages((current) => {
        if (!current[current.length - 1]?.streaming) playNewMessage();
        return finishAgentMessage(current, contact.name, text);
      });
    });
    const offTyping = api.on("codex:typing", ({ contactId }) => {
      if (contactId === contact.id) setTyping(true);
    });
    const offDone = api.on("codex:done", ({ contactId }) => {
      if (contactId === contact.id) setTyping(false);
    });
    const offError = api.on("codex:error", ({ contactId, text }) => {
      if (contactId !== contact.id) return;
      setTyping(false);
      setMessages((current) => [...current, makeMessage("system", "system", text)]);
    });
    const offWizz = api.on("window:wizz", () => {
      playWizz();
      setWizzing(true);
      window.setTimeout(() => setWizzing(false), 700);
    });
    return () => {
      offDelta(); offCompleted(); offTyping(); offDone(); offError(); offWizz();
    };
  }, [contact.id, contact.name]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, typing]);

  function sendItems(items, displayText, options = {}) {
    const cleanText = String(displayText ?? "").trim();
    if (!items.length || !cleanText) return;
    setMessages((current) => [...current, makeMessage("me", bootstrap.profile.displayName, cleanText, options)]);
    setTyping(true);
    api.markRead(contact.id);
    api.sendItems(contact.id, items).then(refreshConversations);
  }

  function submit(event) {
    event.preventDefault();
    const clean = draft.trim();
    if (!clean) return;
    sendItems([{ type: "text", text: clean }], clean);
    setDraft("");
  }

  function replaceDraft(start, end, replacement, cursorStart = start + replacement.length, cursorEnd = cursorStart) {
    const next = `${draft.slice(0, start)}${replacement}${draft.slice(end)}`;
    setDraft(next);
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(cursorStart, cursorEnd);
    });
  }

  function insertDraft(text) {
    const element = textareaRef.current;
    const start = element?.selectionStart ?? draft.length;
    const end = element?.selectionEnd ?? draft.length;
    replaceDraft(start, end, text);
  }

  function wrapDraft(prefix, suffix = prefix) {
    const element = textareaRef.current;
    const start = element?.selectionStart ?? draft.length;
    const end = element?.selectionEnd ?? draft.length;
    const selected = draft.slice(start, end);
    const replacement = `${prefix}${selected}${suffix}`;
    const cursorStart = selected ? start : start + prefix.length;
    const cursorEnd = selected ? start + replacement.length : cursorStart;
    replaceDraft(start, end, replacement, cursorStart, cursorEnd);
  }

  async function copyDraft(cut = false) {
    const element = textareaRef.current;
    const start = element?.selectionStart ?? 0;
    const end = element?.selectionEnd ?? 0;
    const selected = start === end ? draft : draft.slice(start, end);
    if (!selected) return;
    await navigator.clipboard.writeText(selected);
    if (cut && start !== end) replaceDraft(start, end, "", start);
  }

  async function pasteDraft() {
    const text = await navigator.clipboard.readText();
    if (text) insertDraft(text);
  }

  function selectAllDraft() {
    textareaRef.current?.focus();
    textareaRef.current?.select();
  }

  function handleSearch() {
    const query = window.prompt("Search transcript", "");
    const clean = String(query ?? "").trim();
    if (!clean) return;
    const match = [...messages].reverse().find((message) => message.text?.toLowerCase().includes(clean.toLowerCase()));
    const result = match
      ? `Recherche "${clean}": trouve dans un message de ${match.author}.`
      : `Recherche "${clean}": aucun resultat.`;
    setMessages((current) => [...current, makeMessage("system", "system", result)]);
  }

  async function handleSendFile() {
    const file = await api.pickFile({ title: "Send Files" });
    if (file?.canceled) return;
    const text = file.isImage
      ? `Image envoyee a Codex:\n${file.path}`
      : `Fichier envoye a Codex:\n${file.path}`;
    const items = [{ type: "text", text }];
    if (file.isImage) items.push({ type: "localImage", path: file.path });
    sendItems(items, text, file.isImage ? { attachment: { type: "image", src: localFileUrl(file.path), name: file.name } } : { attachment: { type: "file", name: file.name } });
  }

  async function startCamera() {
    setSideMode("camera");
    setMediaError("");
    if (cameraStream) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      setCameraStream(stream);
    } catch (error) {
      setMediaError(error.message);
    }
  }

  function stopCamera() {
    cameraStream?.getTracks().forEach((track) => track.stop());
    setCameraStream(null);
  }

  async function sendCameraSnapshot() {
    if (!videoRef.current) return;
    const canvas = document.createElement("canvas");
    canvas.width = videoRef.current.videoWidth || 640;
    canvas.height = videoRef.current.videoHeight || 480;
    canvas.getContext("2d").drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/png");
    const saved = await api.saveDataUrl({ dataUrl, name: "camera-capture.png" });
    if (!saved.ok) {
      setMediaError(saved.error ?? "Capture impossible");
      return;
    }
    const text = `Capture webcam envoyee a Codex:\n${saved.path}`;
    sendItems([{ type: "text", text }, { type: "localImage", path: saved.path }], text, { attachment: { type: "image", src: localFileUrl(saved.path), name: saved.name } });
  }

  async function toggleVoiceClip() {
    setSideMode("voice");
    setMediaError("");
    if (recording && recorderRef.current) {
      recorderRef.current.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) audioChunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        setRecording(false);
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || "audio/webm" });
        const dataUrl = await blobToDataUrl(blob);
        const saved = await api.saveDataUrl({ dataUrl, name: "voice-clip.webm" });
        if (!saved.ok) {
          setMediaError(saved.error ?? "Enregistrement impossible");
          return;
        }
        const text = `Message vocal enregistre pour Codex:\n${saved.path}\n\nTranscris ou analyse ce message vocal si le runtime le permet, sinon utilise ce chemin comme piece jointe.`;
        sendItems([{ type: "text", text }], text, { attachment: { type: "audio", src: localFileUrl(saved.path), name: saved.name } });
      };
      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch (error) {
      setMediaError(error.message);
    }
  }

  function sendQuickPrompt(prompt) {
    sendItems([{ type: "text", text: prompt }], prompt);
  }

  async function saveTranscript() {
    const safeName = contact.name.replace(/[^a-zA-Z0-9._-]+/g, "-").toLowerCase() || "conversation";
    const text = messages
      .map((message) => `[${message.time}] ${message.author}: ${message.text}`)
      .join("\r\n\r\n");
    const result = await api.saveText({
      title: "Save Conversation",
      defaultPath: `${safeName}-codex-messenger.txt`,
      text
    });
    if (!result?.canceled) {
      setMessages((current) => [...current, makeMessage("system", "system", `Conversation sauvegardee: ${result.path}`)]);
    }
  }

  const chatMenus = [
    {
      label: "File",
      entries: [
        { label: "Send Files...", action: handleSendFile },
        { label: "Open Project...", action: () => api.openProjectPicker() },
        { label: "Save Conversation...", action: saveTranscript },
        { separator: true },
        { label: "Close", shortcut: "Alt+F4", action: () => api.window.close() }
      ]
    },
    {
      label: "Edit",
      entries: [
        { label: "Undo", shortcut: "Ctrl+Z", action: () => document.execCommand("undo") },
        { separator: true },
        { label: "Cut", shortcut: "Ctrl+X", action: () => copyDraft(true) },
        { label: "Copy", shortcut: "Ctrl+C", action: () => copyDraft(false) },
        { label: "Paste", shortcut: "Ctrl+V", action: pasteDraft },
        { label: "Select All", shortcut: "Ctrl+A", action: selectAllDraft },
        { separator: true },
        { label: "Clear Text", action: () => setDraft("") }
      ]
    },
    {
      label: "Actions",
      entries: [
        { label: "Invite", action: () => setSideMode("conversations") },
        { label: "Wizz", action: () => api.wizz(contact.id) },
        { label: "Search Transcript...", action: handleSearch },
        { separator: true },
        { label: "Activities", action: () => setSideMode("activities") },
        { label: "Games", action: () => setSideMode("games") },
        { label: "Play Morpion", action: () => { setActiveGame("morpion"); setSideMode("games"); } },
        { label: "Play Memory", action: () => { setActiveGame("memory"); setSideMode("games"); } },
        { label: "Play Wizz Reflex", action: () => { setActiveGame("wizz"); setSideMode("games"); } }
      ]
    },
    {
      label: "Tools",
      entries: [
        { label: "Start Camera", action: startCamera },
        { label: recording ? "Stop Voice Clip" : "Voice Clip", action: toggleVoiceClip },
        { label: "Send Image/File...", action: handleSendFile },
        { separator: true },
        { label: "Open App Folder", action: () => api.app.openPath(bootstrap.cwd) },
        { label: "Open Uploads Folder", action: () => api.app.openPath(`${bootstrap.cwd}\\uploads`) },
        { label: "Reload Window", shortcut: "Ctrl+R", action: () => api.app.reload() }
      ]
    },
    {
      label: "Help",
      entries: [
        {
          label: "About Codex Messenger",
          action: () => window.alert("Codex Messenger\n\nFenetre de conversation MSN 7 reliee a codex app-server.")
        },
        {
          label: "Keyboard Shortcuts",
          action: () => window.alert("Enter: envoyer\nShift+Enter: nouvelle ligne\nCtrl+A/C/X/V: edition du message\nWizz: secoue la fenetre et joue le son.")
        }
      ]
    }
  ];

  return (
    <main className={wizzing ? "msn-window chat wizzing" : "msn-window chat"}>
      <Titlebar title={`${contact.name} - Conversation`} />
      <Menu items={chatMenus} />
      <div className="toolbar">
        <Tool icon="invite" label="Invite" onClick={() => setSideMode("conversations")} />
        <Tool icon="files" label="Send Files" onClick={handleSendFile} />
        <Tool icon="video" label="Video" onClick={startCamera} />
        <Tool icon="voice" label="Voice" onClick={toggleVoiceClip} />
        <Tool icon="activities" label="Activities" onClick={() => setSideMode("activities")} />
        <Tool icon="games" label="Games" onClick={() => setSideMode("games")} />
        <Tool icon="wizz" label="Wizz" onClick={() => api.wizz(contact.id)} />
        <div className="toolbar-brand"><span>Codex</span><Logo small /></div>
      </div>
      <section className="chat-body">
        <div className="chat-main">
          <div className="to-line">A: {contact.name}</div>
          <div className="transcript" ref={scrollRef}>
            {messages.map((message) => <Message key={message.id} message={message} />)}
            {typing ? <div className="typing"><i /><i /><i />{contact.name} ecrit...</div> : null}
          </div>
          <div className="format-strip">
            <button type="button" title="Gras" onClick={() => wrapDraft("**", "**")}>A</button>
            <button type="button" title="Sourire" onClick={() => insertDraft(":)")}>:)</button>
            <button type="button" onClick={toggleVoiceClip}>Voice Clip</button>
            <button type="button" title="Clin d'oeil" onClick={() => insertDraft(" ;)")}>:)</button>
            <button type="button" onClick={handleSendFile}>Img</button>
            <button type="button" onClick={() => setSideMode("activities")}>*</button>
            <button type="button" title="Rire" onClick={() => insertDraft(" :D")}>:)</button>
          </div>
          <form className="composer" onSubmit={submit}>
            <textarea ref={textareaRef} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) submit(event);
            }} />
            <div><button type="submit">Send</button><button type="button" onClick={handleSearch}>Search</button></div>
          </form>
        </div>
        <aside className="chat-side">
          <div className="display-frame top"><Avatar contact={contact} large /></div>
          <div className="side-switcher">
            <button className={sideMode === "conversations" ? "active" : ""} type="button" onClick={() => setSideMode("conversations")}>Fils</button>
            <button className={sideMode === "camera" ? "active" : ""} type="button" onClick={startCamera}>Cam</button>
            <button className={sideMode === "voice" ? "active" : ""} type="button" onClick={() => setSideMode("voice")}>Voix</button>
            <button className={sideMode === "activities" ? "active" : ""} type="button" onClick={() => setSideMode("activities")}>Act</button>
            <button className={sideMode === "games" ? "active" : ""} type="button" onClick={() => setSideMode("games")}>Jeux</button>
          </div>
          <div className="side-fill">
            {sideMode === "conversations" ? (
              <ConversationBrowser
                conversations={conversations}
                activeContactId={contact.id}
                onOpenProject={(cwd) => api.openProject(cwd)}
                onOpenThread={(threadId) => api.openThread(threadId)}
              />
            ) : null}
            {sideMode === "camera" ? (
              <div className="media-panel">
                <video ref={videoRef} autoPlay muted playsInline />
                <div className="media-actions">
                  <button type="button" onClick={sendCameraSnapshot} disabled={!cameraStream}>Snapshot</button>
                  <button type="button" onClick={stopCamera} disabled={!cameraStream}>Stop</button>
                </div>
                {mediaError ? <p>{mediaError}</p> : null}
              </div>
            ) : null}
            {sideMode === "voice" ? (
              <div className="media-panel voice-panel">
                <button type="button" className={recording ? "recording" : ""} onClick={toggleVoiceClip}>{recording ? "Stop Voice Clip" : "Voice Clip"}</button>
                <p>{recording ? "Enregistrement en cours..." : "Le clip sera sauvegarde puis envoye a Codex comme fichier local."}</p>
                {mediaError ? <p>{mediaError}</p> : null}
              </div>
            ) : null}
            {sideMode === "activities" ? <ActionPanel title="Activities" options={activityPrompts} onRun={sendQuickPrompt} /> : null}
            {sideMode === "games" ? (
              <GamesPanel
                activeGame={activeGame}
                onSelectGame={setActiveGame}
                onRun={sendQuickPrompt}
                waiting={typing}
              />
            ) : null}
          </div>
          <div className="display-frame bottom"><Avatar contact={selfContact} large /></div>
        </aside>
      </section>
      <footer className="chat-ad" aria-hidden="true">Codex App Server active</footer>
    </main>
  );
}

function appendAgentDelta(messages, author, delta) {
  const cleanDelta = String(delta ?? "");
  if (!cleanDelta) return messages;
  const last = messages[messages.length - 1];
  if (last?.streaming) {
    return [...messages.slice(0, -1), { ...last, text: mergeStreamText(last.text, cleanDelta) }];
  }
  return [...messages, makeMessage("them", author, cleanDelta, { streaming: true })];
}

function finishAgentMessage(messages, author, text) {
  const cleanText = String(text ?? "").trim();
  if (!cleanText) return messages;
  const last = messages[messages.length - 1];
  if (last?.streaming) {
    return [...messages.slice(0, -1), { ...last, text: cleanText, streaming: false }];
  }
  if (last?.from === "them" && normalizeMessageText(last.text) === normalizeMessageText(cleanText)) {
    return messages;
  }
  const previous = messages[messages.length - 2];
  if (last?.from === "them" && previous?.from === "them" && normalizeMessageText(previous.text) === normalizeMessageText(cleanText)) {
    return messages.slice(0, -1);
  }
  return [...messages, makeMessage("them", author, cleanText)];
}

function mergeStreamText(current, incoming) {
  const left = String(current ?? "");
  const right = String(incoming ?? "");
  if (!left || right.startsWith(left)) return right;
  if (!right || left.endsWith(right)) return left;

  const maxOverlap = Math.min(left.length, right.length);
  for (let size = maxOverlap; size > 0; size -= 1) {
    if (left.slice(-size) === right.slice(0, size)) {
      return left + right.slice(size);
    }
  }
  return left + right;
}

function normalizeMessageText(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

function Message({ message }) {
  if (message.from === "system") return <p className="system"><span>{message.time}</span> {message.text}</p>;
  return (
    <article className={message.from === "me" ? "message me-message" : "message"}>
      <header><strong>{message.author}</strong><time>{message.time}</time></header>
      <p>{message.text}</p>
      {message.attachment?.type === "image" ? <img className="message-attachment" src={message.attachment.src} alt={message.attachment.name ?? ""} /> : null}
      {message.attachment?.type === "audio" ? <audio className="message-audio" controls src={message.attachment.src} /> : null}
      {message.attachment?.type === "file" ? <small className="message-file">{message.attachment.name}</small> : null}
    </article>
  );
}

function App() {
  const [bootstrap, setBootstrap] = useState(null);

  useEffect(() => {
    api.bootstrap().then(setBootstrap);
  }, []);

  if (!bootstrap) return <div className="loading">Chargement...</div>;
  return bootstrap.view === "chat" ? <ChatWindow bootstrap={bootstrap} /> : <MainWindow />;
}

createRoot(document.getElementById("root")).render(<App />);
