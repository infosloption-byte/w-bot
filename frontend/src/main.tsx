import React, { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
import "./responsive.css";
import { useSidebar } from "./useSidebar.js";
import { PublicRecovery, AccountSettings, WorkspaceActivity, portalRequest } from "./PortalAccount.js";
import { ByonConnections } from "./ByonConnections.js";
import "./connections.css";

type View = "overview" | "groups" | "activate" | "connections" | "settings" | "activity";
type Group = {
  id: string; name: string; whatsappGroupId: string;
  enabled: boolean; gateway: "WEB" | "OFFICIAL";
  targetLanguages: string[]; claimedAt: string | null;
  connectionId?: string | null;
  connection?: { label: string; kind: "PERSONAL" | "BUSINESS"; phoneLast4: string | null } | null;
};
type Me = {
  user: { name: string; email: string; emailVerified?: boolean };
  workspace: { name: string; id: string; role: string };
  botPhoneNumber: string | null;
  limits: { groups: number; whatsappConnections: number; unlimitedTextTranslations: boolean };
  note: string;
};
type Usage = {
  groups: number; messages: number;
  limits: { groups: number; whatsappConnections: number; unlimitedTextTranslations: boolean };
  recent: Array<{ id: string; status: string; sourceLanguage: string | null; createdAt: string; group: { name: string } }>;
};
type Language = { code: string; name: string };

async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch("/portal/api" + url, {
    credentials: "same-origin",
    cache: "no-store",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json", "X-WBot-Request": "1" } : {}),
      ...(options.headers ?? {})
    }
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(
    typeof json.error === "string" ? json.error : "Unable to complete request"
  );
  return json as T;
}

function App() {
  const [me, setMe] = useState<Me | null>(null);
  const sidebar = useSidebar("wbot-customer-sidebar-collapsed");
  const [usage, setUsage] = useState<Usage | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [refreshingGroups, setRefreshingGroups] = useState(false);
  const [languages, setLanguages] = useState<Language[]>([]);
  const [maxLanguages, setMaxLanguages] = useState(10);
  const [view, setView] = useState<View>("overview");
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [activation, setActivation] = useState<{ code: string; expiresAt: string } | null>(null);
  const [loginMode, setLoginMode] = useState<"login" | "signup" | "forgot">("login");
  const [openTokenView, setOpenTokenView] = useState(Boolean(new URLSearchParams(window.location.search).get("token")));
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pendingDisconnect, setPendingDisconnect] = useState<Group | null>(null);
  const [pendingHistoryDelete, setPendingHistoryDelete] = useState<Group | null>(null);

  const refresh = useCallback(async () => {
    const account = await api<Me>("/me");
    setMe(account);
    const [activity, managed, catalog] = await Promise.all([
      api<Usage>("/usage"),
      api<{ groups: Group[] }>("/groups"),
      api<{ languages: Language[]; maxPerGroup: number }>("/languages")
    ]);
    setUsage(activity);
    setGroups(managed.groups);
    setLanguages(catalog.languages);
    setMaxLanguages(catalog.maxPerGroup);
  }, []);

  const refreshGroups = useCallback(async () => {
    const managed = await api<{ groups: Group[] }>("/groups");
    setGroups(managed.groups);
  }, []);
  useEffect(() => {
    if (!me || (view !== "groups" && view !== "overview")) return;
    void refreshGroups().catch(() => { /* initial dashboard can still render */ });
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void refreshGroups().catch(() => { /* next poll retries */ });
      }
    }, 15000);
    return () => window.clearInterval(interval);
  }, [me?.workspace.id, view, refreshGroups]);
  async function manualGroupRefresh() {
    setRefreshingGroups(true);
    try { await refreshGroups(); report("Your group list is up to date."); }
    catch (err) { reportError(err); }
    finally { setRefreshingGroups(false); }
  }

  useEffect(() => {
    void (async () => {
      try { await refresh(); }
      catch { setMe(null); }
      finally { setLoading(false); }
    })();
  }, [refresh]);

  function report(message: string) { setNotice(message); setError(""); }
  function reportError(cause: unknown) {
    setError(cause instanceof Error ? cause.message : "Something went wrong");
    setNotice("");
  }

  async function submitAuth(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      if (loginMode === "forgot") {
        await portalRequest("/auth/forgot-password", { email: data.email });
        report("If that email exists and mail delivery is configured, a reset link has been sent.");
      } else {
        await api("/auth/" + (loginMode === "login" ? "login" : "register"), {
          method: "POST", body: JSON.stringify(data)
        });
        await refresh();
        report("Welcome to your W-Bot workspace");
      }
    } catch (err) { reportError(err); }
    finally { setBusy(false); }
  }

  async function logout() {
    try { await api("/auth/logout", { method: "POST", body: "{}" }); }
    catch { /* clear local app state regardless */ }
    setMe(null); setGroups([]); setUsage(null); setActivation(null); setLanguages([]);
  }

  async function createActivation() {
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await api<{ code: string; expiresAt: string }>("/activations", {
        method: "POST", body: JSON.stringify({ consentConfirmed: consent })
      });
      setActivation(result);
      report("Activation code created. Ask a group administrator to post it in the group.");
    } catch (err) { reportError(err); }
    finally { setBusy(false); }
  }

  async function updateGroup(group: Group, changes: { enabled?: boolean; targetLanguages?: string[] }) {
    setBusy(true); setError("");
    try {
      await api("/groups/" + encodeURIComponent(group.id), {
        method: "PATCH", body: JSON.stringify(changes)
      });
      await refresh();
      report("Group settings saved");
    } catch (err) { reportError(err); }
    finally { setBusy(false); }
  }

  async function disconnectGroup(group: Group) {
    setBusy(true); setError("");
    try {
      await api("/groups/" + encodeURIComponent(group.id), { method: "DELETE", headers: { "X-WBot-Request": "1" } });
      await refresh();
      setPendingDisconnect(null);
      report("Group disconnected. No further messages will be processed for this workspace.");
    } catch (err) { reportError(err); }
    finally { setBusy(false); }
  }

  async function deleteGroupHistory(group: Group) {
    setBusy(true); setError("");
    try {
      const result = await portalRequest<{ deleted: number }>(
        "/groups/" + encodeURIComponent(group.id) + "/messages", undefined, "DELETE"
      );
      await refresh();
      setPendingHistoryDelete(null);
      report(result.deleted + " stored message records deleted for this group.");
    } catch (err) { reportError(err); }
    finally { setBusy(false); }
  }

  async function copyText(value: string) {
    try { await navigator.clipboard.writeText(value); report("Copied to clipboard"); }
    catch { reportError(new Error("Unable to copy. Select and copy the command manually.")); }
  }

  if (loading) return (
    <div className="loading-shell"><div className="brand-mark">W</div><p>Loading your workspace…</p></div>
  );

  if (openTokenView) return <PublicRecovery onReturn={() => {
    window.history.replaceState({}, "", "/portal/");
    setOpenTokenView(false);
    setMe(null);
  }} />;

  if (!me) return (
    <main className="auth-layout">
      <section className="auth-hero">
        <div className="brand"><span className="brand-mark">W</span><span>W-Bot <small>by SL Options</small></span></div>
        <div className="auth-hero-body">
          <div className="eyebrow"><span className="live-dot" /> PRIVATE TECHNICAL PILOT</div>
          <h1>One bot.<br/><em>Every language.</em><br/>Your groups.</h1>
          <p>Bring multilingual WhatsApp group conversations together with intelligent translation. One shared W-Bot number. Your own private workspace.</p>
          <div className="hero-features"><span>◉ Languages managed by platform</span><span>◉ Replies in context</span><span>◉ Group controls</span></div>
        </div>
        <div className="auth-disclaimer">Invitation-only pilot · Unofficial WhatsApp Web connector · Group administrator consent required</div>
      </section>
      <section className="auth-panel">
        <div className="auth-box">
          <div className="eyebrow">CUSTOMER PORTAL</div>
          <h2>{loginMode === "login" ? "Welcome back" : loginMode === "forgot" ? "Reset your password" : "Create your workspace"}</h2>
          <p className="muted">{loginMode === "login" ? "Sign in to manage your WhatsApp translation groups." : loginMode === "forgot" ? "Enter your email to request a secure reset link." : "Start your invite-only W-Bot pilot."}</p>
          {error && <div className="alert error" role="alert">{error}</div>}
          <form onSubmit={e => void submitAuth(e)} className="form">
            {loginMode === "signup" && <>
              <label>Your name<input name="name" type="text" required minLength={2} maxLength={100} autoComplete="name" placeholder="Full name"/></label>
              <label>Workspace name<input name="workspace" type="text" required minLength={2} maxLength={191} placeholder="My company or team"/></label>
            </>}
            <label>Email address<input name="email" type="email" required autoComplete="email" placeholder="you@company.com"/></label>
            {loginMode !== "forgot" && <label>Password<input name="password" type="password" required minLength={loginMode === "signup" ? 12 : 1} autoComplete={loginMode === "signup" ? "new-password" : "current-password"} placeholder={loginMode === "signup" ? "At least 12 characters" : "Your password"}/></label>}
            {loginMode === "signup" && <label>Invitation code<input name="inviteCode" type="password" required placeholder="Provided by W-Bot"/></label>}
            <button type="submit" disabled={busy} className="button primary">{busy ? "Working…" : loginMode === "login" ? "Sign in" : loginMode === "forgot" ? "Send reset link" : "Create workspace"}<span>→</span></button>
          </form>
          <div className="auth-switch">{loginMode === "login" ? "Invited to the pilot?" : "Already registered?"}{" "}
            <button type="button" className="text-button" onClick={() => { setLoginMode(loginMode === "login" ? "signup" : "login"); setError(""); }}>{loginMode === "login" ? "Create an account" : "Sign in"}</button>
            {loginMode === "login" && <div style={{ marginTop: 16 }}>
              <button type="button" className="text-button" onClick={() => { setLoginMode("forgot"); setError(""); }}>Forgot password?</button>
            </div>}
          </div>
        </div>
      </section>
    </main>
  );

  const nav: Array<{ id: View; label: string; icon: string }> = [
    { id: "overview", label: "Overview", icon: "▦" },
    { id: "groups", label: "My Groups", icon: "☰" },
    { id: "activate", label: "Add Group", icon: "+" },
    { id: "connections", label: "WhatsApp Numbers", icon: "♧" },
    { id: "settings", label: "Workspace", icon: "⚙" },
    { id: "activity", label: "Activity & Plan", icon: "◷" }
  ];
  return (
    <div className={"dashboard" + (sidebar.collapsed ? " nav-collapsed" : "")}>
      <button type="button" className={"sidebar-scrim" + (sidebar.mobileOpen ? " is-visible" : "")}
        aria-label="Close workspace navigation" tabIndex={sidebar.mobileOpen ? 0 : -1}
        onClick={sidebar.closeMobile}/>
      <aside className={"sidebar" + (sidebar.mobileOpen ? " is-mobile-open" : "")}
        id="customer-navigation" aria-label="Workspace sidebar"
        ref={sidebar.drawerRef} role={sidebar.mobileOpen ? "dialog" : undefined}
        aria-modal={sidebar.mobileOpen ? true : undefined}>
        <div className="sidebar-header">
          <div className="brand"><span className="brand-mark">W</span><span className="sidebar-brand-text">W-Bot<small>WORKSPACE</small></span></div>
          <button type="button" className="sidebar-toggle" onClick={sidebar.toggleCollapsed}
            aria-controls="customer-navigation"
            aria-label={sidebar.collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={sidebar.collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!sidebar.collapsed}>{sidebar.collapsed ? "»" : "«"}</button>
          <button type="button" className="sidebar-close" onClick={sidebar.closeMobile}
            aria-label="Close menu" title="Close menu">×</button>
        </div>
        <p className="sidebar-label">MENU</p>
        <nav aria-label="Workspace navigation">{nav.map(item =>
          <button key={item.id} type="button" aria-label={item.label}
            title={sidebar.collapsed ? item.label : undefined}
            aria-current={view === item.id ? "page" : undefined}
            className={"nav-item " + (view === item.id ? "active" : "")}
            onClick={() => { setView(item.id); setNotice(""); setError(""); sidebar.closeMobile(); }}>
            <span className="nav-icon" aria-hidden="true">{item.icon}</span><span className="nav-label">{item.label}</span>
          </button>
        )}</nav>
        <div className="sidebar-foot">
          <div className="connection"><span className="live-dot"/> SHARED BOT · PILOT</div>
          <div className="profile"><div className="avatar">{me.user.name[0]?.toUpperCase()}</div><div className="profile-meta"><strong>{me.user.name}</strong><small>{me.workspace.name}</small></div></div>
          <button type="button" aria-label="Sign out" title={sidebar.collapsed ? "Sign out" : undefined}
            onClick={() => { sidebar.closeMobile(); void logout(); }} className="nav-item signout">
            <span className="nav-icon" aria-hidden="true">↪</span><span className="nav-label">Sign out</span>
          </button>
        </div>
      </aside>
      <div className="main-area">
        <header className="topbar">
          <div className="topbar-start">
            <button type="button" className="sidebar-mobile-toggle" aria-label="Open workspace menu"
              ref={sidebar.toggleRef} aria-controls="customer-navigation" aria-expanded={sidebar.mobileOpen}
              onClick={sidebar.toggleMobile}>☰</button>
            <div className="topbar-title"><span className="breadcrumb">WORKSPACE / </span><span>{nav.find(item => item.id === view)?.label}</span></div>
          </div>
          <div className="pill pilot">◉ INVITE-ONLY PILOT</div>
        </header>
        <main className="workspace">
          {notice && <div className="alert success" role="status">{notice}<button onClick={() => setNotice("")} aria-label="Dismiss">×</button></div>}
          {error && <div className="alert error" role="alert">{error}<button onClick={() => setError("")} aria-label="Dismiss">×</button></div>}

          {view === "overview" && <>
            <div className="page-heading"><div><div className="eyebrow">WORKSPACE OVERVIEW</div><h1>Good to see you, {me.user.name.split(" ")[0]}.</h1><p className="muted">Your multilingual WhatsApp translation service at a glance.</p></div><button className="button primary" onClick={() => setView("activate")}>+ Add WhatsApp group</button></div>
            <div className="metrics">
              <div className="metric"><div className="metric-label">REGISTERED GROUPS <span>▦</span></div><div className="metric-value">{groups.length}<small> / {me.limits.groups}</small></div><div className="metric-foot">Your connected groups</div></div>
              <div className="metric"><div className="metric-label">MESSAGES THIS MONTH <span>◉</span></div><div className="metric-value">{usage?.messages ?? 0}</div><div className="metric-foot">Unlimited text translations · usage monitored</div></div>
              <div className="metric"><div className="metric-label">AVAILABLE LANGUAGES <span>文</span></div><div className="metric-value">{languages.length.toString().padStart(2, "0")}</div><div className="metric-foot">Enabled globally by Platform Admin</div></div>
            </div>
            <div className="two-column">
              <section className="panel"><div className="panel-heading"><h3>Your groups</h3><button className="text-button" onClick={() => setView("groups")}>Manage all →</button></div>
                {groups.length ? groups.slice(0, 5).map(group =>
                  <div className="group-line" key={group.id}><div className="group-icon">♧</div><div className="grow"><strong>{group.name}</strong><small>{group.targetLanguages.filter(code => languages.some(lang => lang.code === code)).length} enabled languages · {group.connection ? (group.connection.kind === "PERSONAL" ? "Personal · " : "Business · ") + group.connection.label : "Shared W-Bot"}</small></div><span className={"status " + (group.enabled ? "on" : "")}>{group.enabled ? "Active" : "Paused"}</span></div>
                ) : <div className="empty">No groups yet. Use <button className="text-button" onClick={() => setView("activate")}>Add Group</button> to start.</div>}
              </section>
              <section className="panel"><div className="panel-heading"><h3>Recent activity</h3><span className="muted text-small">This month</span></div>
                {usage?.recent.length ? usage.recent.map(item =>
                  <div className="activity-line" key={item.id}><div className="activity-dot"/><div className="grow"><strong>{item.group.name}</strong><small>{item.sourceLanguage?.toUpperCase() ?? "Detecting"} · {new Date(item.createdAt).toLocaleString()}</small></div><span className={"status " + (item.status === "COMPLETED" ? "on" : "")}>{item.status.toLowerCase()}</span></div>
                ) : <div className="empty">No recent translations yet.</div>}
              </section>
            </div>
          </>}

          {view === "groups" && <>
            <div className="page-heading"><div><div className="eyebrow">GROUP MANAGEMENT</div><h1>My WhatsApp groups</h1><p className="muted">All activated groups appear here, whether they use the shared bot or your own number. New activations refresh automatically.</p></div><div className="group-page-actions"><button type="button" className="button secondary" disabled={refreshingGroups} onClick={() => void manualGroupRefresh()}>{refreshingGroups ? "Refreshing…" : "↻ Refresh groups"}</button><button className="button primary" onClick={() => setView("connections")}>WhatsApp numbers</button></div></div>
            {!groups.length && <div className="panel empty large">No groups connected yet. Activate one with the shared bot or your own WhatsApp number.<p><button className="button primary" onClick={() => setView("connections")}>Manage WhatsApp numbers</button></p></div>}
            <div className="group-cards">{groups.map(group =>
              <section key={group.id} className="panel group-card">
                <div className="group-title"><div className="group-icon">♧</div><div className="grow"><h3>{group.name}</h3><small>{group.connection
                    ? (group.connection.kind === "PERSONAL" ? "Personal" : "Business") +
                      " number · " + group.connection.label +
                      (group.connection.phoneLast4 ? " · ••••" + group.connection.phoneLast4 : "")
                    : "Shared W-Bot number"} · {group.whatsappGroupId}</small></div><span className={"status " + (group.enabled ? "on" : "")}>{group.enabled ? "Active" : "Paused"}</span></div>
                <div className="section-label">TRANSLATION LANGUAGES · UP TO {maxLanguages}</div>
                <p className="muted text-small">Select which platform-enabled languages this group should receive. More languages create longer WhatsApp replies.</p>
                <div className="language-chips">{languages.map(lang => {
                  const activeCodes = new Set(languages.map(item => item.code));
                  const enabledSelection = group.targetLanguages.filter(code => activeCodes.has(code));
                  const selected = enabledSelection.includes(lang.code);
                  return <button key={lang.code} type="button"
                    disabled={busy || (!selected && enabledSelection.length >= maxLanguages)}
                    aria-pressed={selected} className={"chip " + (selected ? "selected" : "")}
                    onClick={() => {
                      const updated = selected
                        ? enabledSelection.filter(code => code !== lang.code)
                        : [...enabledSelection, lang.code];
                      if (!updated.length) { reportError(new Error("Choose at least one enabled language")); return; }
                      void updateGroup(group, { targetLanguages: updated });
                    }}>{selected ? "✓ " : "+ "}{lang.name}</button>;
                })}</div>
                {group.targetLanguages.some(code => !languages.some(item => item.code === code)) &&
                  <p className="muted text-small" role="status">Some previously selected languages are disabled by Platform Admin and will not be translated. Saving a new selection removes them.</p>}
                {!group.targetLanguages.some(code => languages.some(item => item.code === code)) &&
                  <p className="alert error" role="alert">No enabled languages selected. Choose at least one language to resume translation.</p>}
                <div className="group-footer"><div className="muted text-small"><button className="text-button danger-action" type="button" disabled={busy} onClick={() => setPendingDisconnect(group)}>Disconnect group</button>
                    <button className="text-button danger-action" type="button" disabled={busy}
                      style={{ marginLeft: 18 }} onClick={() => setPendingHistoryDelete(group)}>Delete message history</button></div>
                  <button type="button" className={"toggle " + (group.enabled ? "is-on" : "")} aria-label={group.enabled ? "Pause group" : "Enable group"} aria-pressed={group.enabled} disabled={busy} onClick={() => void updateGroup(group, { enabled: !group.enabled })}><span/></button></div>
              </section>
            )}</div>
          </>}

          {view === "activate" && <>
            <div className="page-heading"><div><div className="eyebrow">GROUP ONBOARDING</div><h1>Connect a WhatsApp group</h1><p className="muted">Invite our shared W-Bot number to a group you administer. No customer device pairing is required.</p></div></div>
            <div className="activation-layout">
              <div className="panel steps">
                <div className="step"><span className="step-number">01</span><div><h3>Add the W-Bot number</h3><p>In WhatsApp, open the group and add the W-Bot WhatsApp Business account as a participant.</p>{me.botPhoneNumber ? <button className="copy-box" onClick={() => void copyText(me.botPhoneNumber!)}>{me.botPhoneNumber} <span>Copy</span></button> : <p className="hint">The W-Bot phone number will be provided by your administrator.</p>}</div></div>
                <div className="step"><span className="step-number">02</span><div><h3>Generate an activation code</h3><p>Create a one-time code valid for 15 minutes. The code belongs to your workspace.</p>
                  <label className="consent-row"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />
                    <span>I am authorized to manage this group, and its participants have been informed that messages are processed by W-Bot and an external AI translation service.</span>
                  </label>
                  <button className="button secondary" disabled={busy || !consent || groups.length >= me.limits.groups} onClick={() => void createActivation()}>{busy ? "Generating…" : "Generate activation code"}</button>
                  {activation && <div className="activation-result">
                    <div className="section-label">TEMPORARY GROUP ADMIN COMMAND</div>
                    <div className="activation-code"><code>/wbot connect {activation.code}</code><button onClick={() => void copyText("/wbot connect " + activation.code)}>Copy</button></div>
                    <small>Expires {new Date(activation.expiresAt).toLocaleTimeString()}. A group admin may send this full command or just the 16-character code in the WhatsApp group. Do not share the code outside the group.</small>
                  </div>}
                </div></div>
                <div className="step"><span className="step-number">03</span><div><h3>Verify ownership inside WhatsApp</h3><p>A verified group admin posts the activation command in the WhatsApp group. W-Bot verifies their role and connects the group to your workspace.</p><p className="hint">Activation codes only work in groups where the shared W-Bot account is a participant.</p></div></div>
                <div className="step"><span className="step-number">04</span><div><h3>Manage translation</h3><p>Once connected, control languages and pause or resume translation from My Groups.</p><button className="text-button" onClick={() => { void refresh().catch(reportError); setView("groups"); }}>Refresh my groups →</button></div></div>
              </div>
              <aside className="panel help-card"><div className="help-icon">◎</div><h3>Designed for privacy</h3><p>Group members must be informed that W-Bot sends messages to an external translation service and retains records for the pilot.</p><div className="help-separator"/><h4>One group, one workspace</h4><p>A group cannot be activated by two different customer workspaces. A verified admin must approve each connection.</p><div className="help-separator"/><p className="muted text-small">This is an invitation-only pilot running on an unofficial WhatsApp Web connector. Connection and account restrictions remain possible.</p></aside>
            </div>
          </>}

          {view === "settings" && <>
            <div className="page-heading"><div><div className="eyebrow">MY ACCOUNT</div><h1>Workspace settings</h1><p className="muted">Your account and shared bot configuration.</p></div></div>
            <AccountSettings me={me} onRefresh={refresh} onLogout={logout}/>
          </>}
          {view === "connections" && <>
            <div className="page-heading"><div>
              <div className="eyebrow">WHATSAPP CONNECTIONS</div>
              <h1>Your WhatsApp numbers</h1>
              <p className="muted">Use the shared W-Bot or link an account you own. Each connection is isolated.</p>
            </div></div>
            <ByonConnections onManageGroups={() => {
              setView("groups"); void refreshGroups().catch(reportError);
            }}/>
          </>}
          {view === "activity" && <>
            <div className="page-heading"><div><div className="eyebrow">ACTIVITY & LIMITS</div><h1>Activity & subscription</h1><p className="muted">Group activation history, security changes and shared bot connectivity.</p></div></div>
            <WorkspaceActivity/>
          </>}
        </main>
        {pendingHistoryDelete && <div className="modal-backdrop" role="presentation">
          <div className="modal-panel" role="alertdialog" aria-modal="true" aria-labelledby="history-title" aria-describedby="history-description">
            <div className="eyebrow">DATA PRIVACY</div>
            <h2 id="history-title">Permanently erase message history?</h2>
            <p id="history-description" className="muted">Delete stored W-Bot translation messages for <strong>{pendingHistoryDelete.name}</strong> since this workspace activated it. Pause the group first. This cannot be undone and does not delete messages already sent in WhatsApp.</p>
            <div className="modal-actions">
              <button className="button secondary" disabled={busy} onClick={() => setPendingHistoryDelete(null)}>Cancel</button>
              <button className="button danger-button" disabled={busy} onClick={() => void deleteGroupHistory(pendingHistoryDelete)}>{busy ? "Deleting…" : "Erase stored history"}</button>
            </div>
          </div>
        </div>}
        {pendingDisconnect && <div className="modal-backdrop" role="presentation">
          <div className="modal-panel" role="alertdialog" aria-modal="true" aria-labelledby="disconnect-title" aria-describedby="disconnect-description">
            <div className="eyebrow">DISCONNECT GROUP</div>
            <h2 id="disconnect-title">Stop translating this group?</h2>
            <p id="disconnect-description" className="muted">W-Bot will stop replying in <strong>{pendingDisconnect.name}</strong>. Existing history remains protected, and a group administrator can activate the group again later.</p>
            <div className="modal-actions">
              <button className="button secondary" disabled={busy} onClick={() => setPendingDisconnect(null)}>Keep connected</button>
              <button className="button danger-button" disabled={busy} onClick={() => void disconnectGroup(pendingDisconnect)}>{busy ? "Disconnecting…" : "Disconnect group"}</button>
            </div>
          </div>
        </div>}
        <footer className="footer">W-Bot by SL Options · Private technical pilot · WhatsApp Web integration is unofficial</footer>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
