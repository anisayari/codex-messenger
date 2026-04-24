import React, { useEffect, useMemo, useRef, useState } from "react";
import { appCopyFor } from "../shared/languages.js";
import { contactStatusFor, statusOptionsFor } from "./i18n.js";
import {
  combinedProjectThreads,
  mergeConversationPages,
  normalizeProjectSort,
  projectSortOption,
  projectSortOptions,
  projectThreadCount,
  sortProjects
} from "./rosterUtils.js";
import { useUnreadState } from "./useUnreadState.js";
import { Logo } from "./windowChrome.jsx";

export default function RosterView({
  api,
  bootstrap,
  profile,
  userAgent,
  refreshTick,
  profileEditorOpen,
  agentEditorOpen,
  onProfileEditorOpenChange,
  onAgentEditorOpenChange,
  onProfileChange,
  onAgentsChange,
  AvatarComponent,
  ProfileEditorComponent,
  AgentCreatorComponent,
  playNewMessage = () => {},
  copy = appCopyFor("fr")
}) {
  const Avatar = AvatarComponent;
  const ProfileEditor = ProfileEditorComponent;
  const AgentCreator = AgentCreatorComponent;
  const [finished, setFinished] = useState(null);
  const [conversations, setConversations] = useState(bootstrap.conversations);
  const unread = useUnreadState(api, bootstrap.unread ?? {});
  const [collapsed, setCollapsed] = useState({});
  const [query, setQuery] = useState("");
  const [agentError, setAgentError] = useState("");
  const [projectSort, setProjectSort] = useState(() => normalizeProjectSort(bootstrap.settings?.projectSort));
  const [projectSortMenu, setProjectSortMenu] = useState(null);
  const [contactMenu, setContactMenu] = useState(null);
  const [expandedContacts, setExpandedContacts] = useState({});
  const [renameDraft, setRenameDraft] = useState(null);
  const [addContactPressed, setAddContactPressed] = useState(false);
  const [loadingMoreThreads, setLoadingMoreThreads] = useState(false);
  const rosterRef = useRef(null);
  const addContactPressTimerRef = useRef(null);

  useEffect(() => {
    api.listConversations().then(setConversations).catch(() => {});
  }, [api, refreshTick]);

  useEffect(() => () => {
    if (addContactPressTimerRef.current) window.clearTimeout(addContactPressTimerRef.current);
  }, []);

  useEffect(() => {
    const closeMenu = () => {
      setProjectSortMenu(null);
      setContactMenu(null);
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") closeMenu();
    };
    window.addEventListener("click", closeMenu);
    window.addEventListener("blur", closeMenu);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("blur", closeMenu);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  useEffect(() => api.on("conversation:finished", ({ contactId }) => {
    const contact = bootstrap.contacts.find((item) => item.id === contactId);
    if (!contact) return;
    setFinished(`${contact.name} a termine.`);
    window.setTimeout(() => setFinished(null), 4200);
  }), [api, bootstrap.contacts]);

  useEffect(() => api.on("conversation:notify", () => {
    playNewMessage();
  }), [api, playNewMessage]);

  const groups = useMemo(() => {
    const search = query.trim().toLowerCase();
    const match = (item) => `${item.name} ${item.statusText ?? ""} ${item.mood ?? ""}`.toLowerCase().includes(search);
    const byGroup = [];

    byGroup.push({
      id: "agents",
      title: copy.roster.codexAgents,
      items: bootstrap.contacts.map((contact) => ({
        id: contact.id,
        name: contact.name,
        mood: contact.mood,
        status: contact.status,
        statusText: copy.status[contact.status] ?? contact.status,
        contact,
        onOpen: () => api.openConversation(contact.id)
      }))
    });

    const projectItems = sortProjects(conversations?.projects ?? [], projectSort).map((project) => {
      const contact = {
        id: project.id,
        name: project.name,
        mail: `${project.name.toLowerCase().replace(/[^a-z0-9]+/g, ".")}@project.local`,
        group: copy.roster.projects,
        mood: project.cwd,
        status: contactStatusFor(bootstrap.settings, project.id, projectThreadCount(project) ? "online" : "offline"),
        color: "#1f8fcf",
        avatar: "terminal",
        kind: "project",
        cwd: project.cwd,
        createdAt: project.createdAt,
        modifiedAt: project.modifiedAt,
        threadCount: projectThreadCount(project),
        threads: project.threads ?? [],
        hiddenThreads: project.hiddenThreads ?? []
      };
      return {
        ...contact,
        statusText: projectThreadCount(project) ? `${projectThreadCount(project)} ${copy.chat.conversation}${projectThreadCount(project) > 1 ? "s" : ""}` : copy.roster.newThread,
        contact,
        onOpen: () => api.openProject(project.cwd)
      };
    });
    if (projectItems.length) byGroup.push({ id: "projects", title: copy.roster.projects, items: projectItems });

    const threadItems = (conversations?.projects ?? [])
      .flatMap((project) => project.threads.map((thread) => ({ ...thread, projectName: project.name, cwd: project.cwd })))
      .sort((a, b) => String(b.timestamp ?? "").localeCompare(String(a.timestamp ?? "")))
      .slice(0, 28)
      .map((thread) => {
        const contact = {
          id: thread.contactId,
          name: thread.preview || thread.projectName,
          mail: `${thread.projectName.toLowerCase().replace(/[^a-z0-9]+/g, ".")}@thread.local`,
          group: thread.projectName,
          mood: thread.cwd,
          status: contactStatusFor(bootstrap.settings, thread.contactId, "online"),
          color: "#2874d9",
          avatar: "terminal",
          kind: "thread",
          cwd: thread.cwd,
          threadId: thread.id
        };
        return {
          ...contact,
          statusText: thread.projectName,
          contact,
          onOpen: () => openThreadFromRoster(thread.id)
        };
      });
    if (threadItems.length) byGroup.push({ id: "threads", title: copy.roster.recentConversations, items: threadItems });

    return byGroup.map((group) => ({
      ...group,
      items: search ? group.items.filter(match) : group.items
    })).filter((group) => group.items.length);
  }, [api, bootstrap.contacts, bootstrap.settings, conversations, copy, projectSort, query]);

  function toggleGroup(groupId) {
    setCollapsed((current) => ({ ...current, [groupId]: !current[groupId] }));
  }

  function toggleExpandedContact(item) {
    if (!item?.id) return;
    setExpandedContacts((current) => ({ ...current, [item.id]: !current[item.id] }));
  }

  function expandedThreadsFor(item) {
    if (!item || !expandedContacts[item.id]) return [];
    return combinedProjectThreads(item);
  }

  async function openThreadFromRoster(threadId) {
    const result = await api.openThread(threadId);
    if (result?.conversations) setConversations(result.conversations);
  }

  async function loadMoreThreads() {
    const cursor = conversations?.nextCursor;
    if (!cursor || loadingMoreThreads) return;
    setLoadingMoreThreads(true);
    try {
      const next = await api.listConversations({ cursor, limit: 20 });
      setConversations((current) => mergeConversationPages(current, next));
    } finally {
      setLoadingMoreThreads(false);
    }
  }

  function openProjectSortMenu(event) {
    event.preventDefault();
    event.stopPropagation();
    setContactMenu(null);
    const bounds = rosterRef.current?.getBoundingClientRect();
    const width = bounds?.width ?? window.innerWidth;
    const height = bounds?.height ?? window.innerHeight;
    const left = bounds ? event.clientX - bounds.left : event.clientX;
    const top = bounds ? event.clientY - bounds.top : event.clientY;
    setProjectSortMenu({
      x: Math.max(4, Math.min(left, width - 214)),
      y: Math.max(4, Math.min(top, height - 272))
    });
  }

  function openContactMenu(event, item) {
    event.preventDefault();
    event.stopPropagation();
    setProjectSortMenu(null);
    const bounds = rosterRef.current?.getBoundingClientRect();
    const width = bounds?.width ?? window.innerWidth;
    const height = bounds?.height ?? window.innerHeight;
    const left = bounds ? event.clientX - bounds.left : event.clientX;
    const top = bounds ? event.clientY - bounds.top : event.clientY;
    setContactMenu({
      x: Math.max(4, Math.min(left, width - 218)),
      y: Math.max(4, Math.min(top, height - 154)),
      item
    });
  }

  async function changeProjectSort(sort) {
    const nextSort = normalizeProjectSort(sort);
    setProjectSort(nextSort);
    setProjectSortMenu(null);
    try {
      await api.setSettings({ projectSort: nextSort });
    } catch {
      // Sorting still works for the current session if persistence fails.
    }
  }

  function handleAddContactClick() {
    if (bootstrap.settings?.demoMode) return;
    if (addContactPressTimerRef.current) window.clearTimeout(addContactPressTimerRef.current);
    setAddContactPressed(true);
    addContactPressTimerRef.current = window.setTimeout(() => {
      setAddContactPressed(false);
      addContactPressTimerRef.current = null;
    }, 180);
    onAgentEditorOpenChange(true);
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

  async function chooseProfilePicture(options = {}) {
    const result = await api.chooseProfilePicture(options);
    if (result?.canceled) return result;
    if (options?.save === false) return result;
    onProfileChange(result.profile, userAgent, result.settings);
    return result;
  }

  async function createAgent(draft) {
    setAgentError("");
    try {
      const result = await api.createAgent(draft);
      if (!result?.ok) throw new Error(result?.error || "Creation impossible.");
      onAgentsChange(result.contacts, result.settings);
      onAgentEditorOpenChange(false);
      await api.openConversation(result.contact.id);
    } catch (error) {
      setAgentError(error.message);
      throw error;
    }
  }

  async function saveContactRename(event) {
    event.preventDefault();
    if (!renameDraft?.item?.id) return;
    const cleanName = String(renameDraft.name || "").trim();
    if (!cleanName) return;
    const result = await api.renameContact({ contactId: renameDraft.item.id, name: cleanName });
    if (!result?.ok) {
      window.alert(result?.error || "Renommage impossible.");
      return;
    }
    if (result.contacts && result.settings) onAgentsChange(result.contacts, result.settings);
    if (result.conversations) setConversations(result.conversations);
    setRenameDraft(null);
  }

  async function resetContactName(item) {
    if (!item?.id) return;
    const result = await api.renameContact({ contactId: item.id, name: "" });
    if (result?.contacts && result?.settings) onAgentsChange(result.contacts, result.settings);
    if (result?.conversations) setConversations(result.conversations);
    setContactMenu(null);
  }

  return (
    <section className="roster" ref={rosterRef}>
      <div className="me">
        <button className="display-picture-button" type="button" onClick={() => onProfileEditorOpenChange(!profileEditorOpen)}>
          <Avatar contact={{ ...profile, avatar: "butterfly", color: "#11a77a" }} />
        </button>
        <div>
          <div className="me-line">
            <strong>{profile.displayName || profile.email}</strong>
            <select value={profile.status} onChange={(event) => changeStatus(event.target.value)}>
              {statusOptionsFor(copy).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
            </select>
          </div>
          <small className="me-email">{profile.email}</small>
          <p>{profile.personalMessage || userAgent || copy.roster.localConnected}</p>
        </div>
      </div>
      {profileEditorOpen && ProfileEditor ? (
        <ProfileEditor
          profile={profile}
          onChange={saveProfile}
          onChoosePicture={chooseProfilePicture}
          onClose={() => onProfileEditorOpenChange(false)}
          copy={copy}
        />
      ) : null}
      {agentEditorOpen && AgentCreator ? (
        <AgentCreator
          error={agentError}
          onCreate={createAgent}
          onChooseRunFolder={() => api.chooseDirectory({ title: copy.menu.openProject })}
          onClose={() => {
            setAgentError("");
            onAgentEditorOpenChange(false);
          }}
        />
      ) : null}
      <div className="msn-tabs">
        <button type="button" onClick={() => api.openConversation(bootstrap.contacts[0]?.id ?? "codex")}><Logo small /> {copy.menu.codexToday}</button>
      </div>
      <div className="search"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy.roster.search} /></div>
      <div className="groups">
        {groups.map((group) => {
          const online = group.items.filter((item) => item.status !== "offline").length;
          return (
          <section className="roster-group" key={group.id}>
            <button
              className="group-heading"
              type="button"
              title={group.id === "projects" ? copy.roster.sortProjects : undefined}
              onClick={() => toggleGroup(group.id)}
              onContextMenu={group.id === "projects" ? openProjectSortMenu : undefined}
            >
              <span className={collapsed[group.id] ? "group-box collapsed" : "group-box"} />
              <strong>{group.title} ({online}/{group.items.length})</strong>
              {group.id === "projects" ? <span className="group-sort-label">tri: {projectSortOption(projectSort).short}</span> : null}
            </button>
            {!collapsed[group.id] ? group.items.map((item) => {
              const pending = unread[item.id] ?? 0;
              const expandedThreads = expandedThreadsFor(item);
              const expanded = expandedThreads.length > 0;
              return (
                <React.Fragment key={item.id}>
                  <button
                    className={[
                      "contact-line",
                      pending ? "has-unread" : "",
                      expandedContacts[item.id] ? "expanded" : ""
                    ].filter(Boolean).join(" ")}
                    type="button"
                    onClick={item.onOpen}
                    onContextMenu={(event) => openContactMenu(event, item)}
                  >
                    <span className={`msn-presence ${item.status}`} />
                    <span className="contact-mini-avatar"><Avatar contact={item.contact ?? item} /></span>
                    <span className="contact-line-copy">
                      <span className="contact-name">{item.name}</span>
                      <span className="contact-state">({item.statusText})</span>
                      <span className="contact-mood">{item.mood}</span>
                    </span>
                    {pending ? <span className="contact-unread-bubble" title={`${pending} message${pending > 1 ? "s" : ""} en attente`}>{pending > 9 ? "9+" : pending}</span> : <span className="contact-unread-spacer" />}
                  </button>
                  {expanded ? (
                    <div className="contact-thread-list" role="group" aria-label={`Fils de ${item.name}`}>
                      {expandedThreads.map((thread) => (
                        <button
                          className={item.hiddenThreads?.some((hidden) => hidden.id === thread.id) ? "contact-thread-line hidden" : "contact-thread-line"}
                          type="button"
                          key={thread.id}
                          onClick={() => openThreadFromRoster(thread.id)}
                          title={thread.preview}
                        >
                          <span className="contact-thread-bullet" aria-hidden="true" />
                          <span>{thread.preview || copy.roster.newThread}</span>
                          {item.hiddenThreads?.some((hidden) => hidden.id === thread.id) ? <small>masque</small> : null}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </React.Fragment>
              );
            }) : null}
          </section>
        );})}
      </div>
      {conversations?.hasMore ? (
        <button className="load-more-threads" type="button" onClick={loadMoreThreads} disabled={loadingMoreThreads}>
          {loadingMoreThreads ? copy.roster.loading : copy.roster.loadMore}
        </button>
      ) : null}
      {projectSortMenu ? (
        <div
          className="group-context-menu"
          style={{ left: projectSortMenu.x, top: projectSortMenu.y }}
          role="menu"
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <div className="group-context-title">{copy.roster.sortProjects}</div>
          {projectSortOptions.map((option) => (
            <button
              className={normalizeProjectSort(projectSort) === option.id ? "active" : ""}
              key={option.id}
              type="button"
              role="menuitemradio"
              aria-checked={normalizeProjectSort(projectSort) === option.id}
              onClick={() => changeProjectSort(option.id)}
            >
              <span>{option.label}</span>
              <small>{option.detail}</small>
            </button>
          ))}
        </div>
      ) : null}
      {contactMenu ? (
        <div
          className="group-context-menu contact-context-menu"
          style={{ left: contactMenu.x, top: contactMenu.y }}
          role="menu"
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <div className="group-context-title">{contactMenu.item.name}</div>
          {combinedProjectThreads(contactMenu.item).length ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                toggleExpandedContact(contactMenu.item);
                setContactMenu(null);
              }}
            >
              <span>{expandedContacts[contactMenu.item.id] ? copy.roster.reduce : copy.roster.expand}</span>
            </button>
          ) : null}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setRenameDraft({ item: contactMenu.item, name: contactMenu.item.name ?? "" });
              setContactMenu(null);
            }}
          >
            <span>{copy.roster.renameAction}</span>
          </button>
          {contactMenu.item.cwd ? (
            <button type="button" role="menuitem" onClick={() => api.app.openPath(contactMenu.item.cwd)}>
              <span>{copy.roster.openFolder}</span>
            </button>
          ) : null}
          <button type="button" role="menuitem" onClick={() => resetContactName(contactMenu.item)}>
            <span>{copy.roster.originalName}</span>
          </button>
        </div>
      ) : null}
      {renameDraft ? (
        <div className="settings-dialog-backdrop rename-contact-backdrop">
          <form className="settings-dialog rename-contact-dialog" onSubmit={saveContactRename} role="dialog" aria-modal="true" aria-label={copy.roster.rename}>
            <header>
              <strong>{copy.roster.rename}</strong>
              <button type="button" onClick={() => setRenameDraft(null)}>x</button>
            </header>
            <section>
              <label className="settings-row">
                <span>{copy.roster.newName}</span>
                <input autoFocus value={renameDraft.name} onChange={(event) => setRenameDraft((current) => ({ ...current, name: event.target.value }))} />
              </label>
            </section>
            <footer>
              <button type="submit" disabled={!renameDraft.name.trim()}>OK</button>
              <button type="button" onClick={() => setRenameDraft(null)}>{copy.common.cancel}</button>
            </footer>
          </form>
        </div>
      ) : null}
      <button
        className={addContactPressed ? "add-contact pressed" : "add-contact"}
        type="button"
        disabled={bootstrap.settings?.demoMode}
        onClick={handleAddContactClick}
        title={bootstrap.settings?.demoMode ? copy.menu.openDemo : undefined}
      >
        <span className="mini plus" /> {copy.menu.addContact}
      </button>
      <div className="wordmark"><span>Codex</span><Logo small /><strong>Messenger</strong></div>
      {finished ? <div className="toast"><Logo small /><span>{finished}</span></div> : null}
    </section>
  );
}
