import React, { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
import "./responsive.css";
import { useSidebar } from "./useSidebar.js";
import { PublicRecovery, AccountSettings, WorkspaceActivity, portalRequest } from "./PortalAccount.js";
import { ByonConnections } from "./ByonConnections.js";
import { FeatureHub, SmartAlerts } from "./SmartAlerts.js";
import { CustomerDashboard, TranslationActivity } from "./CustomerDashboard.js";
import "./theme-refresh.css";
import "./workspace-pages.css";
import "./connections.css";

type View = "dashboard" | "translation" | "alerts" | "connections" | "plans" | "settings";
type TranslationTab = "overview" | "groups" | "activity";
type AlertTab = "overview" | "groups" | "searches" | "inbox";
type ConnectionTab = "accounts" | "add" | "pairing";
type PlanTab = "translation" | "alerts" | "limits";
type SettingsTab = "profile" | "workspace" | "security";
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
  const [view, setView] = useState<View>("dashboard");
  const [translationTab, setTranslationTab] = useState<TranslationTab>("overview");
  const [alertTab, setAlertTab] = useState<AlertTab>("overview");
  const [connectionTab, setConnectionTab] = useState<ConnectionTab>("accounts");
  const [planTab, setPlanTab] = useState<PlanTab>("translation");
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("profile");
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [loginMode, setLoginMode] = useState<"login" | "signup" | "forgot">("login");
  const [openTokenView, setOpenTokenView] = useState(Boolean(new URLSearchParams(window.location.search).get("token")));
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
    if (!me || (view !== "translation" || (translationTab !== "groups" && translationTab !== "overview"))) return;
    void refreshGroups().catch(() => { /* initial dashboard can still render */ });
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void refreshGroups().catch(() => { /* next poll retries */ });
      }
    }, 15000);
    return () => window.clearInterval(interval);
  }, [me?.workspace.id, view, translationTab, refreshGroups]);
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
    setMe(null); setGroups([]); setUsage(null); setLanguages([]);
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
          <h1>One workspace.<br/><em>Two smart services.</em><br/>Your groups.</h1>
          <p>Translate group conversations or monitor selected groups for relevant opportunities. Use the services you subscribe to with a shared account and WhatsApp connection.</p>
          <div className="hero-features"><span>◉ Languages managed by platform</span><span>◉ Replies in context</span><span>◉ Group controls</span></div>
        </div>
        <div className="auth-disclaimer">Invitation-only pilot · Unofficial WhatsApp Web connector · Group administrator consent required</div>
      </section>
      <section className="auth-panel">
        <div className="auth-box">
          <div className="eyebrow">CUSTOMER PORTAL</div>
          <h2>{loginMode === "login" ? "Welcome back" : loginMode === "forgot" ? "Reset your password" : "Create your workspace"}</h2>
          <p className="muted">{loginMode === "login" ? "Sign in to manage translations and private group alerts." : loginMode === "forgot" ? "Enter your email to request a secure reset link." : "Start your invite-only W-Bot pilot."}</p>
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
    { id: "dashboard", label: "Dashboard", icon: "▦" },
    { id: "translation", label: "Translation", icon: "文" },
    { id: "alerts", label: "Smart Alerts", icon: "✳" },
    { id: "connections", label: "WhatsApp Connections", icon: "♧" },
    { id: "plans", label: "Plans & Usage", icon: "◷" },
    { id: "settings", label: "Settings", icon: "⚙" }
  ];
  const subnav: Partial<Record<View, Array<{ id: string; label: string }>>> = {
    translation: [
      { id: "overview", label: "Overview" }, { id: "groups", label: "Groups & Languages" },
      { id: "activity", label: "Activity" }
    ],
    alerts: [
      { id: "overview", label: "Overview" }, { id: "groups", label: "Monitored Groups" },
      { id: "searches", label: "Intelligent Searches" }, { id: "inbox", label: "Inbox" }
    ],
    connections: [
      { id: "accounts", label: "Connected Accounts" }, { id: "add", label: "Add Account" },
      { id: "pairing", label: "Pairing & Reconnection" }
    ],
    plans: [
      { id: "translation", label: "Translation Subscription" },
      { id: "alerts", label: "Smart Alerts Subscription" },
      { id: "limits", label: "Limits & Usage" }
    ],
    settings: [
      { id: "profile", label: "Profile" }, { id: "workspace", label: "Workspace" },
      { id: "security", label: "Security" }
    ]
  };
  function activeSubtab(section: View): string {
    switch (section) {
      case "translation": return translationTab;
      case "alerts": return alertTab;
      case "connections": return connectionTab;
      case "plans": return planTab;
      case "settings": return settingsTab;
      default: return "";
    }
  }
  function chooseSubtab(section: View, id: string) {
    setView(section);
    switch (section) {
      case "translation": setTranslationTab(id as TranslationTab); break;
      case "alerts": setAlertTab(id as AlertTab); break;
      case "connections": setConnectionTab(id as ConnectionTab); break;
      case "plans": setPlanTab(id as PlanTab); break;
      case "settings": setSettingsTab(id as SettingsTab); break;
    }
    setNotice(""); setError(""); sidebar.closeMobile();
  }
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
          <React.Fragment key={item.id}><button type="button" aria-label={item.label}
            title={sidebar.collapsed ? item.label : undefined}
            aria-current={view === item.id ? "page" : undefined}
            className={"nav-item " + (view === item.id ? "active" : "")}
            onClick={() => { setView(item.id); setNotice(""); setError(""); sidebar.closeMobile(); }}>
            <span className="nav-icon" aria-hidden="true">{item.icon}</span><span className="nav-label">{item.label}</span>
          </button>
          {view === item.id && subnav[item.id] && <div className="sidebar-subnav" aria-label={item.label + " pages"}>
            {subnav[item.id]?.map(sub => <button type="button" key={sub.id}
              className={activeSubtab(item.id) === sub.id ? "is-active" : ""}
              aria-current={activeSubtab(item.id) === sub.id ? "page" : undefined}
              onClick={() => chooseSubtab(item.id, sub.id)}>{sub.label}</button>)}
          </div>}
          </React.Fragment>
        )}</nav>
        <div className="sidebar-foot">
          <div className="connection"><span className="live-dot"/> WHATSAPP WORKSPACE</div>
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
          {view !== "dashboard" && <nav className="workspace-tabs" aria-label="Section pages">
            {subnav[view]?.map(sub => <button key={sub.id} type="button"
              className={activeSubtab(view) === sub.id ? "is-active" : ""}
              aria-current={activeSubtab(view) === sub.id ? "page" : undefined}
              onClick={() => chooseSubtab(view, sub.id)}>{sub.label}</button>)}
          </nav>}
          {notice && <div className="alert success" role="status">{notice}<button onClick={() => setNotice("")} aria-label="Dismiss">×</button></div>}
          {error && <div className="alert error" role="alert">{error}<button onClick={() => setError("")} aria-label="Dismiss">×</button></div>}

          {view === "dashboard" && <CustomerDashboard
            customerName={me.user.name} workspaceName={me.workspace.name}
            translationGroups={groups.length} translations={usage?.messages ?? 0}
            onNavigate={(target, tab) => chooseSubtab(target, tab ||
              (target === "translation" || target === "alerts" ? "overview" :
                target === "connections" ? "accounts" : "translation"))}/>}
          {view === "translation" && translationTab === "overview" && <>
            <div className="page-heading"><div><div className="eyebrow">GROUP TRANSLATION</div><h1>Translation overview</h1><p className="muted">Manage translated conversations and languages for your approved groups.</p></div><button className="button primary" onClick={() => chooseSubtab("connections","accounts")}>Manage connections</button></div>
            <div className="metrics">
              <div className="metric"><div className="metric-label">REGISTERED GROUPS <span>▦</span></div><div className="metric-value">{groups.length}<small> / {me.limits.groups}</small></div><div className="metric-foot">Your connected groups</div></div>
              <div className="metric"><div className="metric-label">MESSAGES THIS MONTH <span>◉</span></div><div className="metric-value">{usage?.messages ?? 0}</div><div className="metric-foot">Unlimited text translations · usage monitored</div></div>
              <div className="metric"><div className="metric-label">AVAILABLE LANGUAGES <span>文</span></div><div className="metric-value">{languages.length.toString().padStart(2, "0")}</div><div className="metric-foot">Enabled globally by Platform Admin</div></div>
            </div>
            <div className="two-column">
              <section className="panel"><div className="panel-heading"><h3>Your groups</h3><button className="text-button" onClick={() => chooseSubtab("translation","groups")}>Manage all →</button></div>
                {groups.length ? groups.slice(0, 5).map(group =>
                  <div className="group-line" key={group.id}><div className="group-icon">♧</div><div className="grow"><strong>{group.name}</strong><small>{group.targetLanguages.filter(code => languages.some(lang => lang.code === code)).length} enabled languages · {group.connection ? (group.connection.kind === "PERSONAL" ? "Personal · " : "Business · ") + group.connection.label : "Shared W-Bot"}</small></div><span className={"status " + (group.enabled ? "on" : "")}>{group.enabled ? "Active" : "Paused"}</span></div>
                ) : <div className="empty">No translation groups yet. Open <button className="text-button" onClick={() => chooseSubtab("connections","accounts")}>WhatsApp Connections</button> to begin.</div>}
              </section>
              <section className="panel"><div className="panel-heading"><h3>Recent activity</h3><span className="muted text-small">This month</span></div>
                {usage?.recent.length ? usage.recent.map(item =>
                  <div className="activity-line" key={item.id}><div className="activity-dot"/><div className="grow"><strong>{item.group.name}</strong><small>{item.sourceLanguage?.toUpperCase() ?? "Detecting"} · {new Date(item.createdAt).toLocaleString()}</small></div><span className={"status " + (item.status === "COMPLETED" ? "on" : "")}>{item.status.toLowerCase()}</span></div>
                ) : <div className="empty">No recent translations yet.</div>}
              </section>
            </div>
          </>}

          {view === "translation" && translationTab === "groups" && <>
            <div className="page-heading"><div><div className="eyebrow">GROUP MANAGEMENT</div><h1>My WhatsApp groups</h1><p className="muted">Manage translation languages and approved groups connected to your WhatsApp sessions.</p></div><div className="group-page-actions"><button type="button" className="button secondary" disabled={refreshingGroups} onClick={() => void manualGroupRefresh()}>{refreshingGroups ? "Refreshing…" : "↻ Refresh groups"}</button><button className="button primary" onClick={() => chooseSubtab("connections","accounts")}>WhatsApp accounts</button></div></div>
            {!groups.length && <div className="panel empty large">No translation groups activated yet. Link your WhatsApp account and request group activation.<p><button className="button primary" onClick={() => chooseSubtab("connections","accounts")}>Manage WhatsApp accounts</button></p></div>}
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

           {view === "alerts" && <>
             <div className="page-heading"><div><div className="eyebrow">PRIVATE GROUP MONITORING</div><h1>Smart Alerts</h1>
               <p className="muted">Manage monitoring, AI-powered searches and your private matches inbox.</p></div></div>
             <SmartAlerts section={alertTab} onNavigate={tab => chooseSubtab("alerts",tab)}/>
           </>}
           {view === "settings" && <>
            <div className="page-heading"><div><div className="eyebrow">MY ACCOUNT</div><h1>Account settings</h1><p className="muted">Manage profile, workspace and security settings.</p></div></div>
            <AccountSettings section={settingsTab} me={me} onRefresh={refresh} onLogout={logout}/>
          </>}
          {view === "connections" && <>
            <div className="page-heading"><div>
              <div className="eyebrow">WHATSAPP CONNECTIONS</div>
              <h1>WhatsApp Connections</h1>
              <p className="muted">Link a WhatsApp account once and manage its connections for the services you subscribe to.</p>
            </div></div>
            <ByonConnections mode={connectionTab}
              onNavigate={tab => chooseSubtab("connections", tab)}
              onManageGroups={() => {
                chooseSubtab("translation","groups"); void refreshGroups().catch(reportError);
              }}/>
          </>}
          {view === "translation" && translationTab === "activity" && <>
            <div className="page-heading"><div><div className="eyebrow">TRANSLATION</div>
              <h1>Recent activity</h1><p className="muted">Track translation activity for connected groups.</p></div></div>
            <TranslationActivity/>
          </>}
          {view === "plans" && <>
            <div className="page-heading"><div><div className="eyebrow">SERVICE SUBSCRIPTIONS</div>
              <h1>Plans & Usage</h1><p className="muted">Manage independent feature access and subscription limits.</p></div></div>
            <FeatureHub onOpenAlerts={() => chooseSubtab("alerts","overview")}/>
            {(planTab === "translation" || planTab === "limits") && <WorkspaceActivity/>}
            {(planTab === "alerts" || planTab === "limits") && <SmartAlerts section="overview" onNavigate={tab => chooseSubtab("alerts",tab)}/>}
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
