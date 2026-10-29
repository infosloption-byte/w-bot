import React, { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

type View = "overview" | "groups" | "activate" | "settings";
type Group = {
  id: string; name: string; whatsappGroupId: string;
  enabled: boolean; gateway: "WEB" | "OFFICIAL";
  targetLanguages: string[]; claimedAt: string | null;
};
type Me = {
  user: { name: string; email: string };
  workspace: { name: string; id: string; role: string };
  botPhoneNumber: string | null;
  limits: { groups: number; messagesPerMonth: number };
  note: string;
};
type Usage = {
  groups: number; messages: number;
  limits: { groups: number; messagesPerMonth: number };
  recent: Array<{ id: string; status: string; sourceLanguage: string | null; createdAt: string; group: { name: string } }>;
};
const languages = [
  { code: "he", name: "Hebrew" }, { code: "en", name: "English" },
  { code: "si", name: "Sinhala" }, { code: "uz", name: "Uzbek" },
  { code: "ru", name: "Russian" }
];

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
  const [usage, setUsage] = useState<Usage | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [view, setView] = useState<View>("overview");
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [activation, setActivation] = useState<{ code: string; expiresAt: string } | null>(null);
  const [loginMode, setLoginMode] = useState<"login" | "signup">("login");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const account = await api<Me>("/me");
    setMe(account);
    const [activity, managed] = await Promise.all([
      api<Usage>("/usage"),
      api<{ groups: Group[] }>("/groups")
    ]);
    setUsage(activity);
    setGroups(managed.groups);
  }, []);

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
      await api("/auth/" + (loginMode === "login" ? "login" : "register"), {
        method: "POST", body: JSON.stringify(data)
      });
      await refresh();
      report("Welcome to your W-Bot workspace");
    } catch (err) { reportError(err); }
    finally { setBusy(false); }
  }

  async function logout() {
    try { await api("/auth/logout", { method: "POST", body: "{}" }); }
    catch { /* clear local app state regardless */ }
    setMe(null); setGroups([]); setUsage(null); setActivation(null);
  }

  async function createActivation() {
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await api<{ code: string; expiresAt: string }>("/activations", {
        method: "POST", body: "{}"
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
    if (!window.confirm("Disconnect " + group.name + "? Translation will stop for this group. A group admin can activate it again later.")) return;
    setBusy(true); setError("");
    try {
      await api("/groups/" + encodeURIComponent(group.id), { method: "DELETE", headers: { "X-WBot-Request": "1" } });
      await refresh();
      report("Group disconnected. No further messages will be processed for this workspace.");
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

  if (!me) return (
    <main className="auth-layout">
      <section className="auth-hero">
        <div className="brand"><span className="brand-mark">W</span><span>W-Bot <small>by SL Options</small></span></div>
        <div className="auth-hero-body">
          <div className="eyebrow"><span className="live-dot" /> PRIVATE TECHNICAL PILOT</div>
          <h1>One bot.<br/><em>Every language.</em><br/>Your groups.</h1>
          <p>Bring multilingual WhatsApp group conversations together with intelligent translation. One shared W-Bot number. Your own private workspace.</p>
          <div className="hero-features"><span>◉ Five languages</span><span>◉ Replies in context</span><span>◉ Group controls</span></div>
        </div>
        <div className="auth-disclaimer">Invitation-only pilot · Unofficial WhatsApp Web connector · Group administrator consent required</div>
      </section>
      <section className="auth-panel">
        <div className="auth-box">
          <div className="eyebrow">CUSTOMER PORTAL</div>
          <h2>{loginMode === "login" ? "Welcome back" : "Create your workspace"}</h2>
          <p className="muted">{loginMode === "login" ? "Sign in to manage your WhatsApp translation groups." : "Start your invite-only W-Bot pilot."}</p>
          {error && <div className="alert error" role="alert">{error}</div>}
          <form onSubmit={e => void submitAuth(e)} className="form">
            {loginMode === "signup" && <>
              <label>Your name<input name="name" type="text" required minLength={2} maxLength={100} autoComplete="name" placeholder="Full name"/></label>
              <label>Workspace name<input name="workspace" type="text" required minLength={2} maxLength={191} placeholder="My company or team"/></label>
            </>}
            <label>Email address<input name="email" type="email" required autoComplete="email" placeholder="you@company.com"/></label>
            <label>Password<input name="password" type="password" required minLength={loginMode === "signup" ? 12 : 1} autoComplete={loginMode === "signup" ? "new-password" : "current-password"} placeholder={loginMode === "signup" ? "At least 12 characters" : "Your password"}/></label>
            {loginMode === "signup" && <label>Invitation code<input name="inviteCode" type="password" required placeholder="Provided by W-Bot"/></label>}
            <button type="submit" disabled={busy} className="button primary">{busy ? "Working…" : loginMode === "login" ? "Sign in" : "Create workspace"}<span>→</span></button>
          </form>
          <div className="auth-switch">{loginMode === "login" ? "Invited to the pilot?" : "Already registered?"}{" "}
            <button type="button" className="text-button" onClick={() => { setLoginMode(loginMode === "login" ? "signup" : "login"); setError(""); }}>{loginMode === "login" ? "Create an account" : "Sign in"}</button>
          </div>
        </div>
      </section>
    </main>
  );

  const nav: Array<{ id: View; label: string; icon: string }> = [
    { id: "overview", label: "Overview", icon: "▦" },
    { id: "groups", label: "My Groups", icon: "☰" },
    { id: "activate", label: "Add Group", icon: "+" },
    { id: "settings", label: "Workspace", icon: "⚙" }
  ];
  return (
    <div className="dashboard">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">W</span><span>W-Bot<small>WORKSPACE</small></span></div>
        <p className="sidebar-label">MENU</p>
        <nav aria-label="Workspace navigation">{nav.map(item =>
          <button key={item.id} type="button" className={"nav-item " + (view === item.id ? "active" : "")} onClick={() => { setView(item.id); setNotice(""); setError(""); }}>
            <span className="nav-icon">{item.icon}</span>{item.label}
          </button>
        )}</nav>
        <div className="sidebar-foot">
          <div className="connection"><span className="live-dot"/> SHARED BOT · PILOT</div>
          <div className="profile"><div className="avatar">{me.user.name[0]?.toUpperCase()}</div><div><strong>{me.user.name}</strong><small>{me.workspace.name}</small></div></div>
          <button type="button" onClick={() => void logout()} className="nav-item signout">↪ &nbsp;Sign out</button>
        </div>
      </aside>

      <div className="main-area">
        <header className="topbar"><div><span className="breadcrumb">WORKSPACE / </span><span>{nav.find(item => item.id === view)?.label}</span></div><div className="pill pilot">◉ INVITE-ONLY PILOT</div></header>
        <main className="workspace">
          {notice && <div className="alert success" role="status">{notice}<button onClick={() => setNotice("")} aria-label="Dismiss">×</button></div>}
          {error && <div className="alert error" role="alert">{error}<button onClick={() => setError("")} aria-label="Dismiss">×</button></div>}

          {view === "overview" && <>
            <div className="page-heading"><div><div className="eyebrow">WORKSPACE OVERVIEW</div><h1>Good to see you, {me.user.name.split(" ")[0]}.</h1><p className="muted">Your multilingual WhatsApp translation service at a glance.</p></div><button className="button primary" onClick={() => setView("activate")}>+ Add WhatsApp group</button></div>
            <div className="metrics">
              <div className="metric"><div className="metric-label">ACTIVE GROUPS <span>▦</span></div><div className="metric-value">{groups.filter(g => g.enabled).length}<small> / {me.limits.groups}</small></div><div className="metric-foot">Your connected groups</div></div>
              <div className="metric"><div className="metric-label">MESSAGES THIS MONTH <span>◉</span></div><div className="metric-value">{usage?.messages ?? 0}<small> / {me.limits.messagesPerMonth}</small></div><div className="meter"><span style={{ width: Math.min(100, (usage?.messages ?? 0) / me.limits.messagesPerMonth * 100) + "%" }}/></div></div>
              <div className="metric"><div className="metric-label">SUPPORTED LANGUAGES <span>文</span></div><div className="metric-value">05</div><div className="metric-foot">Hebrew · English · Sinhala · Uzbek · Russian</div></div>
            </div>
            <div className="two-column">
              <section className="panel"><div className="panel-heading"><h3>Your groups</h3><button className="text-button" onClick={() => setView("groups")}>Manage all →</button></div>
                {groups.length ? groups.slice(0, 5).map(group =>
                  <div className="group-line" key={group.id}><div className="group-icon">♧</div><div className="grow"><strong>{group.name}</strong><small>{group.targetLanguages.length} languages · Web gateway</small></div><span className={"status " + (group.enabled ? "on" : "")}>{group.enabled ? "Active" : "Paused"}</span></div>
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
            <div className="page-heading"><div><div className="eyebrow">GROUP MANAGEMENT</div><h1>My WhatsApp groups</h1><p className="muted">Configure languages and translation availability independently for each group.</p></div><button className="button primary" onClick={() => setView("activate")}>+ Add group</button></div>
            {!groups.length && <div className="panel empty large">No groups connected. Start by activating a group using your administrator account.<p><button className="button primary" onClick={() => setView("activate")}>Add your first group</button></p></div>}
            <div className="group-cards">{groups.map(group =>
              <section key={group.id} className="panel group-card">
                <div className="group-title"><div className="group-icon">♧</div><div className="grow"><h3>{group.name}</h3><small>WhatsApp Web · {group.whatsappGroupId}</small></div><span className={"status " + (group.enabled ? "on" : "")}>{group.enabled ? "Active" : "Paused"}</span></div>
                <div className="section-label">TRANSLATION LANGUAGES</div>
                <div className="language-chips">{languages.map(lang => {
                  const selected = group.targetLanguages.includes(lang.code);
                  return <button key={lang.code} type="button" disabled={busy} aria-pressed={selected}
                    className={"chip " + (selected ? "selected" : "")}
                    onClick={() => void updateGroup(group, {
                      targetLanguages: selected
                        ? group.targetLanguages.length > 1 ? group.targetLanguages.filter(code => code !== lang.code) : group.targetLanguages
                        : [...group.targetLanguages, lang.code]
                    })}>{selected ? "✓ " : "+ "}{lang.name}</button>;
                })}</div>
                <div className="group-footer"><div className="muted text-small"><button className="text-button danger-action" type="button" disabled={busy} onClick={() => void disconnectGroup(group)}>Disconnect group</button></div>
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
                  <button className="button secondary" disabled={busy || groups.length >= me.limits.groups} onClick={() => void createActivation()}>{busy ? "Generating…" : "Generate activation code"}</button>
                  {activation && <div className="activation-result">
                    <div className="section-label">TEMPORARY GROUP ADMIN COMMAND</div>
                    <div className="activation-code"><code>/wbot connect {activation.code}</code><button onClick={() => void copyText("/wbot connect " + activation.code)}>Copy</button></div>
                    <small>Expires {new Date(activation.expiresAt).toLocaleTimeString()}. Keep it private until the group admin posts it.</small>
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
            <section className="panel details"><div className="detail"><span>Workspace</span><strong>{me.workspace.name}</strong></div><div className="detail"><span>Role</span><strong>{me.workspace.role}</strong></div><div className="detail"><span>Email</span><strong>{me.user.email}</strong></div><div className="detail"><span>Registered groups</span><strong>{groups.length} / {me.limits.groups}</strong></div><div className="detail"><span>Monthly message allowance</span><strong>{me.limits.messagesPerMonth}</strong></div><div className="detail"><span>Bot connection model</span><strong>Shared W-Bot number</strong></div></section>
          </>}
        </main>
        <footer className="footer">W-Bot by SL Options · Private technical pilot · WhatsApp Web integration is unofficial</footer>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
