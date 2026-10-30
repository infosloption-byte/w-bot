import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
import "./platform.css";

type Admin = { id: string; name: string; email: string; role: "SUPER_ADMIN" | "VIEWER"; lastLoginAt: string | null };
type Overview = { tenants: number; users: number; groups: number; enabledGroups: number;
  messagesThisMonth: number; queued: number; failures: number; uncertain: number;
  gateway: { status: string; checkedAt: string | null; changedAt: string | null } };
type Plan = { planCode: string; status: "TRIAL" | "ACTIVE" | "PAST_DUE" | "CANCELED";
  groupLimit: number; monthlyMessages: number; periodEnd: string | null };
type Tenant = { id: string; name: string; createdAt: string; groupCount: number; monthUsage: number;
  memberCount: number; owner: { email: string; displayName: string } | null; subscription: Plan | null };
type Group = { id: string; name: string; enabled: boolean; gateway: string;
  updatedAt: string; claimedAt: string | null; tenant: { id: string; name: string } | null;
  targetLanguages: unknown; _count: { messages: number } };
type Delivery = { id: string; status: string; attempts: number; createdAt: string;
  group: { name: string; tenant: { name: string } | null } };
type Audit = { id: string; action: string; createdAt: string; tenant?: { name: string } };
type View = "overview" | "tenants" | "users" | "groups" | "languages" | "deliveries" | "activity" | "security";
type CatalogLanguage = { code: string; name: string; enabled: boolean; createdAt: string; updatedAt: string };
const suggestedLanguages = [
  ["fr","French"], ["es","Spanish"], ["de","German"], ["ar","Arabic"],
  ["hi","Hindi"], ["ta","Tamil"], ["ja","Japanese"], ["zh","Chinese"],
  ["pt","Portuguese"], ["ko","Korean"], ["it","Italian"], ["tr","Turkish"],
  ["nl","Dutch"], ["uk","Ukrainian"], ["pl","Polish"], ["bn","Bengali"],
  ["ml","Malayalam"], ["te","Telugu"], ["id","Indonesian"], ["th","Thai"],
  ["vi","Vietnamese"], ["fil","Filipino"], ["ne","Nepali"]
] as const;
type CustomerUser = { id: string; displayName: string; email: string; emailVerifiedAt: string | null; createdAt: string;
  memberships: Array<{ role: string; tenant: { id: string; name: string } }> };

async function platformApi<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch("/portal/api/platform" + path, {
    credentials: "same-origin", cache: "no-store", ...options,
    headers: {
      ...(options.method && options.method !== "GET" ? {
        "X-WBot-Request": "1",
        "Content-Type": "application/json"
      } : {}),
      ...(options.headers ?? {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(
    typeof data.error === "string" ? data.error : "Platform service unavailable"
  );
  return data as T;
}
const formatted = (value: string | null) => value ? new Date(value).toLocaleString() : "—";

function Console() {
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [view, setView] = useState<View>("overview");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [users, setUsers] = useState<CustomerUser[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [catalog, setCatalog] = useState<CatalogLanguage[]>([]);
  const [newLanguageCode, setNewLanguageCode] = useState("");
  const [newLanguageName, setNewLanguageName] = useState("");
  const [newLanguageEnabled, setNewLanguageEnabled] = useState(true);
  const [languageSearch, setLanguageSearch] = useState("");
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [activity, setActivity] = useState<Audit[]>([]);
  const [platformActivity, setPlatformActivity] = useState<Audit[]>([]);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Tenant | null>(null);
  const [planCode, setPlanCode] = useState("PILOT");
  const [planStatus, setPlanStatus] = useState<Plan["status"]>("TRIAL");
  const [groupLimit, setGroupLimit] = useState(3);
  const [monthlyMessages, setMonthlyMessages] = useState(1000);
  const [pendingGroup, setPendingGroup] = useState<Group | null>(null);
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const refresh = useCallback(async () => {
    const [summary, tenantData, userData, groupData, languageData, failures, actions] = await Promise.all([
      platformApi<Overview>("/overview"),
      platformApi<{ tenants: Tenant[] }>("/tenants"),
      platformApi<{ users: CustomerUser[] }>("/users"),
      platformApi<{ groups: Group[] }>("/groups"),
      platformApi<{ languages: CatalogLanguage[] }>("/languages"),
      platformApi<{ messages: Delivery[] }>("/deliveries"),
      platformApi<{ events: Audit[]; platformEvents: Audit[] }>("/activity")
    ]);
    setOverview(summary); setTenants(tenantData.tenants); setUsers(userData.users); setGroups(groupData.groups);
    setCatalog(languageData.languages);
    setDeliveries(failures.messages);
    setActivity(actions.events); setPlatformActivity(actions.platformEvents);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const identity = await platformApi<Admin>("/me");
        setAdmin(identity);
        await refresh();
      } catch { setAdmin(null); }
      finally { setLoading(false); }
    })();
  }, [refresh]);

  async function login(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const form = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      await platformApi("/auth/login", { method: "POST", body: JSON.stringify(form) });
      const identity = await platformApi<Admin>("/me");
      setAdmin(identity); await refresh();
      setNotice("Platform session started");
    } catch (e) { setError(e instanceof Error ? e.message : "Login failed"); }
    finally { setBusy(false); }
  }

  async function logout() {
    try { await platformApi("/auth/logout", { method: "POST", body: "{}" }); }
    catch { /* Clear local state regardless of a network error. */ }
    setAdmin(null); setOverview(null); setTenants([]);
    setGroups([]); setCatalog([]); setDeliveries([]); setActivity([]);
  }

  function editPlan(t: Tenant) {
    setEditing(t);
    setPlanCode(t.subscription?.planCode ?? "PILOT");
    setPlanStatus(t.subscription?.status ?? "TRIAL");
    setGroupLimit(t.subscription?.groupLimit ?? 3);
    setMonthlyMessages(t.subscription?.monthlyMessages ?? 1000);
    setNotice(""); setError("");
  }

  async function savePlan(event: React.FormEvent) {
    event.preventDefault();
    if (!editing) return;
    setBusy(true); setError("");
    try {
      await platformApi("/tenants/" + encodeURIComponent(editing.id) + "/subscription", {
        method: "PATCH",
        body: JSON.stringify({
          planCode, status: planStatus, groupLimit, monthlyMessages,
          periodEnd: editing.subscription?.periodEnd ?? null
        })
      });
      setEditing(null); await refresh();
      setNotice("Workspace subscription updated. Change recorded in platform audit.");
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to save plan"); }
    finally { setBusy(false); }
  }

  async function addLanguage(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      await platformApi("/languages", {
        method: "POST",
        body: JSON.stringify({
          code: newLanguageCode.trim().toLowerCase(),
          name: newLanguageName.trim(), enabled: newLanguageEnabled
        })
      });
      setNewLanguageCode(""); setNewLanguageName("");
      await refresh();
      setNotice("Language added to the global catalog. Enabled languages are now available to customer groups.");
    } catch (err) { setError(err instanceof Error ? err.message : "Could not add language"); }
    finally { setBusy(false); }
  }

  async function changeLanguage(language: CatalogLanguage, enabled: boolean) {
    setBusy(true); setError(""); setNotice("");
    try {
      await platformApi("/languages/" + encodeURIComponent(language.code), {
        method: "PATCH", body: JSON.stringify({ enabled })
      });
      await refresh();
      setNotice(enabled ? language.name + " is available to customers." :
        language.name + " disabled. Existing group choices are preserved but translation into it stops.");
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to change language"); }
    finally { setBusy(false); }
  }

  async function changeGroupState() {
    if (!pendingGroup) return;
    setBusy(true); setError("");
    try {
      await platformApi("/groups/" + encodeURIComponent(pendingGroup.id), {
        method: "PATCH", body: JSON.stringify({ enabled: !pendingGroup.enabled })
      });
      setPendingGroup(null); await refresh();
      setNotice("Group status updated. Change recorded in platform audit.");
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to update group"); }
    finally { setBusy(false); }
  }

  async function changePassword(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await platformApi("/auth/change-password", {
        method: "POST", body: JSON.stringify({ currentPassword: oldPassword, newPassword })
      });
      await logout();
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to change password"); }
    finally { setBusy(false); }
  }

  const filteredTenants = useMemo(() => tenants.filter(t =>
    (t.name + " " + t.owner?.email).toLowerCase().includes(search.toLowerCase())
  ), [tenants, search]);

  if (loading) return <div className="loading-shell"><div className="brand-mark">W</div>Loading platform console…</div>;
  if (!admin) return <main className="platform-login">
    <div className="platform-login-intro">
      <div className="brand"><span className="brand-mark">W</span><span>W-Bot<small>PLATFORM OPERATIONS</small></span></div>
      <div className="eyebrow">RESTRICTED ADMINISTRATIVE ACCESS</div>
      <h1>Monitor your platform.<br/><em>Protect every workspace.</em></h1>
      <p>Centralized monitoring of customers, WhatsApp groups, subscriptions, usage and delivery incidents. Separate from customer accounts.</p>
      <div className="platform-login-note">Platform accounts are provisioned privately by an operator. Customer registration never grants platform access.</div>
    </div>
    <section className="platform-login-form">
      <div className="panel">
        <div className="eyebrow">SECURE SIGN-IN</div>
        <h2>Platform Admin</h2>
        <p className="muted">Use your dedicated administrator credentials.</p>
        {error && <div className="alert error" role="alert">{error}</div>}
        <form className="form" onSubmit={e => void login(e)}>
          <label>Email<input name="email" type="email" required autoComplete="username" placeholder="admin@company.com" /></label>
          <label>Password<input name="password" type="password" required autoComplete="current-password" /></label>
          <button className="button primary" type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in to console"}</button>
        </form>
        <a className="platform-back" href="/portal/">Customer workspace</a>
      </div>
    </section>
  </main>;

  const nav: Array<{ key: View; label: string; icon: string }> = [
    { key: "overview", label: "Overview", icon: "▦" },
    { key: "tenants", label: "Customers", icon: "♧" },
    { key: "users", label: "Users", icon: "♙" },
    { key: "groups", label: "WhatsApp Groups", icon: "☷" },
    { key: "languages", label: "Languages", icon: "文" },
    { key: "deliveries", label: "Delivery Issues", icon: "⚠" },
    { key: "activity", label: "Audit & Activity", icon: "◷" },
    { key: "security", label: "Admin Security", icon: "⚙" }
  ];
  return <div className="dashboard platform-dashboard">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">W</span><span>W-Bot<small>PLATFORM ADMIN</small></span></div>
      <p className="sidebar-label">OPERATIONS</p>
      <nav aria-label="Platform navigation">{nav.map(item =>
        <button key={item.key} className={"nav-item " + (view === item.key ? "active" : "")}
          onClick={() => { setView(item.key); setNotice(""); setError(""); }}>
          <span className="nav-icon">{item.icon}</span>{item.label}
        </button>
      )}</nav>
      <div className="sidebar-foot">
        <div className="connection"><span className="live-dot"/> PLATFORM MONITORING</div>
        <div className="profile"><div className="avatar">{admin.name[0]?.toUpperCase()}</div>
          <div><strong>{admin.name}</strong><small>{admin.role.replace("_", " ")}</small></div></div>
        <button className="nav-item signout" onClick={() => void logout()}>↪ &nbsp;Sign out</button>
      </div>
    </aside>
    <div className="main-area">
      <header className="topbar">
        <div><span className="breadcrumb">PLATFORM / </span>{nav.find(n => n.key === view)?.label}</div>
        <div className="pill pilot">◉ ADMINISTRATION</div>
      </header>
      <main className="workspace">
        {error && <div className="alert error" role="alert">{error}<button aria-label="Dismiss error" onClick={() => setError("")}>×</button></div>}
        {notice && <div className="alert success" role="status">{notice}<button aria-label="Dismiss notice" onClick={() => setNotice("")}>×</button></div>}
        <div className="page-heading"><div>
          <div className="eyebrow">W-BOT PLATFORM</div>
          <h1>{nav.find(n => n.key === view)?.label}</h1>
          <p className="muted">Monitor and manage your multi-customer WhatsApp translation service.</p>
        </div>
          <button className="button secondary" disabled={busy} onClick={() => void refresh().catch(e => setError(String(e)))}>↻ Refresh</button>
        </div>
        {view === "overview" && <><div className="platform-metrics">
          {[
            ["Customer workspaces", overview?.tenants ?? "—", "Organizations registered"],
            ["Registered users", overview?.users ?? "—", "Customer users"],
            ["Active groups", overview?.enabledGroups ?? "—", (overview?.groups ?? 0) + " total groups"],
            ["Translations this month", overview?.messagesThisMonth ?? "—", "UTC monthly usage"],
            ["Queued jobs", overview?.queued ?? "—", "Awaiting / processing"],
            ["Delivery failures", (overview?.failures ?? 0) + (overview?.uncertain ?? 0), "Failed + uncertain"]
          ].map(([label,number,note]) => <div className="metric" key={String(label)}>
            <div className="metric-label">{label}</div><div className="metric-value">{number}</div>
            <div className="metric-foot">{note}</div>
          </div>)}
        </div><div className="two-column">
          <section className="panel"><div className="panel-heading"><h3>Shared WhatsApp gateway</h3></div>
            <div className="platform-state"><span className="live-dot"/>{overview?.gateway.status ?? "CHECKING"}</div>
            <div className="detail"><span>Last health check</span><strong>{formatted(overview?.gateway.checkedAt ?? null)}</strong></div>
            <div className="detail"><span>Connection state changed</span><strong>{formatted(overview?.gateway.changedAt ?? null)}</strong></div>
            <p className="muted text-small">All customers share one gateway. A disconnection can affect every group.</p>
          </section>
          <section className="panel"><div className="panel-heading"><h3>Attention needed</h3></div>
            <div className="detail"><span>Failed messages</span><strong>{overview?.failures ?? 0}</strong></div>
            <div className="detail"><span>Delivery uncertain</span><strong>{overview?.uncertain ?? 0}</strong></div>
            <button className="text-button" onClick={() => setView("deliveries")}>Review delivery issues →</button>
            <p className="muted text-small">Delivery uncertainty must be reconciled separately. W-Bot will not blindly resend.</p>
          </section>
        </div></>}
        {view === "tenants" && <section className="panel platform-panel">
          <div className="platform-toolbar"><h3>Customer workspaces ({tenants.length})</h3>
            <input aria-label="Search customer workspaces" className="platform-search" placeholder="Search customers…" value={search} onChange={e => setSearch(e.target.value)}/></div>
          <div className="platform-table-scroll"><table className="platform-table"><thead><tr>
            <th>Workspace</th><th>Owner</th><th>Groups</th><th>Subscription</th><th>Monthly usage</th><th>Action</th>
          </tr></thead><tbody>{filteredTenants.map(t => <tr key={t.id}>
            <td><strong>{t.name}</strong><small>{formatted(t.createdAt)}</small></td>
            <td>{t.owner?.displayName ?? "—"}<small>{t.owner?.email ?? "—"}</small></td>
            <td>{t.groupCount}</td>
            <td><span className="status on">{t.subscription?.status ?? "TRIAL"}</span><small>{t.subscription?.planCode ?? "PILOT"}</small></td>
            <td>{t.monthUsage.toLocaleString()} / {t.subscription?.monthlyMessages ?? "—"}</td>
            <td>{admin.role === "SUPER_ADMIN" &&
              <button className="text-button" onClick={() => editPlan(t)}>Manage plan</button>}</td>
          </tr>)}</tbody></table></div>
          {!filteredTenants.length && <p className="muted">No matching customers.</p>}
        </section>}
        {view === "users" && <section className="panel platform-panel">
          <div className="panel-heading"><h3>Registered customer users ({users.length})</h3></div>
          <div className="platform-table-scroll"><table className="platform-table"><thead><tr>
            <th>User</th><th>Email</th><th>Workspace roles</th><th>Email verified</th><th>Registered</th>
          </tr></thead><tbody>{users.map(u => <tr key={u.id}>
            <td><strong>{u.displayName}</strong></td><td>{u.email}</td>
            <td>{u.memberships.map(m => m.tenant.name + " (" + m.role + ")").join(", ") || "—"}</td>
            <td>{u.emailVerifiedAt ? "Verified" : "Unverified"}</td><td>{formatted(u.createdAt)}</td>
          </tr>)}</tbody></table></div>
        </section>}
        {view === "groups" && <section className="panel platform-panel">
          <div className="panel-heading"><h3>Registered WhatsApp groups ({groups.length})</h3></div>
          <div className="platform-table-scroll"><table className="platform-table"><thead><tr>
            <th>Group</th><th>Workspace</th><th>Gateway</th><th>Status</th><th>Messages stored</th><th>Action</th>
          </tr></thead><tbody>{groups.map(g => <tr key={g.id}>
            <td><strong>{g.name}</strong><small>{formatted(g.updatedAt)}</small></td><td>{g.tenant?.name ?? "Unclaimed"}</td>
            <td>{g.gateway}</td><td><span className={"status " + (g.enabled ? "on" : "")}>{g.enabled ? "Active" : "Paused"}</span></td>
            <td>{g._count.messages}</td>
            <td>{admin.role === "SUPER_ADMIN" && <button className="text-button" onClick={() => setPendingGroup(g)}>
              {g.enabled ? "Pause" : "Enable"}</button>}</td>
          </tr>)}</tbody></table></div>
        </section>}
        {view === "languages" && <div className="language-admin-layout">
          <section className="panel platform-panel">
            <div className="platform-toolbar"><div>
              <h3>Translation language catalog</h3>
              <p className="muted text-small">{catalog.filter(lang => lang.enabled).length} enabled · {catalog.length} registered. Customers select from enabled languages in My Groups (up to 10 per group).</p>
            </div>
              <input className="platform-search" aria-label="Search languages"
                placeholder="Search by name or code…" value={languageSearch}
                onChange={e => setLanguageSearch(e.target.value)} />
            </div>
            <div className="platform-table-scroll"><table className="platform-table">
              <thead><tr><th>Language</th><th>ISO code</th><th>Availability</th><th>Action</th></tr></thead>
              <tbody>{catalog.filter(lang =>
                (lang.name + " " + lang.code).toLowerCase().includes(languageSearch.toLowerCase())
              ).map(lang => <tr key={lang.code}>
                <td><strong>{lang.name}</strong></td>
                <td><code>{lang.code}</code></td>
                <td><span className={"status " + (lang.enabled ? "on" : "")}>
                  {lang.enabled ? "Enabled" : "Disabled"}</span></td>
                <td>{admin.role === "SUPER_ADMIN" && <>
                  <button type="button" className="text-button" disabled={busy}
                    onClick={() => void changeLanguage(lang, !lang.enabled)}>
                    {lang.enabled ? "Disable" : "Enable"}</button>
                </>}</td>
              </tr>)}</tbody>
            </table></div>
            <p className="muted text-small">Disabling a language stops it from being translated for newly processed messages, including groups that selected it earlier. It does not erase saved group preferences.</p>
          </section>
          {admin.role === "SUPER_ADMIN" && <section className="panel platform-language-create">
            <div className="eyebrow">CATALOG MANAGEMENT</div>
            <h3>Add a language</h3>
            <p className="muted text-small">Add a supported translation target using its ISO 639 two- or three-letter code.</p>
            <form className="form" onSubmit={e => void addLanguage(e)}>
              <label>Language name<input type="text" required minLength={2} maxLength={80}
                placeholder="e.g. French" value={newLanguageName}
                onChange={e => setNewLanguageName(e.target.value)}/></label>
              <label>Language code<input type="text" required minLength={2} maxLength={3}
                pattern="[A-Za-z]{2,3}" placeholder="e.g. fr" value={newLanguageCode}
                onChange={e => setNewLanguageCode(e.target.value.toLowerCase())}/></label>
              <label className="consent-row"><input type="checkbox" checked={newLanguageEnabled}
                onChange={e => setNewLanguageEnabled(e.target.checked)}/>
                Enable this language for customer groups immediately</label>
              <button type="submit" className="button primary" disabled={busy}>
                {busy ? "Saving…" : "Add language"}</button>
            </form>
            <div className="platform-language-suggestions">
              <div className="section-label">QUICK ADD</div>
              {suggestedLanguages.some(([code]) => !catalog.some(lang => lang.code === code))
                ? <div className="language-chips">{suggestedLanguages.filter(([code]) =>
                    !catalog.some(lang => lang.code === code)
                  ).map(([code,name]) => <button key={code} type="button" className="chip"
                    onClick={() => { setNewLanguageCode(code); setNewLanguageName(name); }}>
                    + {name}</button>)}</div>
                : <p className="muted text-small">All suggested languages are already in the catalog. Enable them in the list, or register another code above.</p>}
            </div>
          </section>}
        </div>}
        {view === "deliveries" && <section className="panel platform-panel">
          <div className="panel-heading"><h3>Failed and uncertain deliveries ({deliveries.length})</h3></div>
          <p className="muted text-small">Message text, sender identities and private WhatsApp IDs are deliberately hidden.</p>
          <div className="platform-table-scroll"><table className="platform-table"><thead><tr>
            <th>Group</th><th>Workspace</th><th>Status</th><th>Attempts</th><th>Received</th>
          </tr></thead><tbody>{deliveries.map(d => <tr key={d.id}>
            <td>{d.group.name}</td><td>{d.group.tenant?.name ?? "Unclaimed"}</td>
            <td><span className="status">{d.status}</span></td><td>{d.attempts}</td><td>{formatted(d.createdAt)}</td>
          </tr>)}</tbody></table></div>{!deliveries.length && <p className="muted">No recorded delivery problems.</p>}
        </section>}
        {view === "activity" && <div className="two-column">
          <section className="panel"><h3>Customer workspace changes</h3>
            {activity.map(a => <div className="activity-line" key={a.id}><div className="activity-dot"/>
              <div><strong>{a.action.replaceAll("_"," ")}</strong><small>{a.tenant?.name ?? ""} · {formatted(a.createdAt)}</small></div></div>)}
            {!activity.length && <p className="muted">No recorded activity.</p>}
          </section><section className="panel"><h3>Platform admin actions</h3>
            {platformActivity.map(a => <div className="activity-line" key={a.id}><div className="activity-dot"/>
              <div><strong>{a.action.replaceAll("_"," ")}</strong><small>{formatted(a.createdAt)}</small></div></div>)}
            {!platformActivity.length && <p className="muted">No platform changes recorded.</p>}
          </section>
        </div>}
        {view === "security" && <section className="panel platform-settings">
          <h3>Platform administrator security</h3>
          <div className="detail"><span>Account</span><strong>{admin.email}</strong></div>
          <div className="detail"><span>Role</span><strong>{admin.role.replace("_"," ")}</strong></div>
          <div className="detail"><span>Last sign-in</span><strong>{formatted(admin.lastLoginAt)}</strong></div>
          <p className="muted text-small">Password changes revoke every administrator session for this account.</p>
          <form className="form" onSubmit={e => void changePassword(e)}>
            <label>Current password<input type="password" autoComplete="current-password" required value={oldPassword} onChange={e => setOldPassword(e.target.value)} /></label>
            <label>New password (16+ characters)<input type="password" autoComplete="new-password" minLength={16} maxLength={128} required value={newPassword} onChange={e => setNewPassword(e.target.value)}/></label>
            <button className="button secondary" disabled={busy}>Change password and sign out</button>
          </form>
        </section>}
      </main>
      {editing && <div className="modal-backdrop" role="presentation"><section className="modal-panel platform-modal"
        role="dialog" aria-modal="true" aria-labelledby="plan-title">
        <div className="eyebrow">WORKSPACE SUBSCRIPTION</div>
        <h2 id="plan-title">Manage {editing.name}</h2>
        <p className="muted">This pilot does not process payments. Changes affect plan enforcement immediately.</p>
        <form className="form" onSubmit={e => void savePlan(e)}>
          <label>Plan code<input value={planCode} pattern="[A-Z0-9_-]{2,30}" onChange={e => setPlanCode(e.target.value.toUpperCase())}/></label>
          <div className="platform-label">Subscription status</div>
          <div className="language-chips">{(["TRIAL","ACTIVE","PAST_DUE","CANCELED"] as const).map(status =>
            <button type="button" key={status} className={"chip " + (planStatus === status ? "selected" : "")}
              aria-pressed={planStatus === status} onClick={() => setPlanStatus(status)}>{status.replace("_"," ")}</button>)}</div>
          <label>Maximum groups<input type="number" min={0} max={1000} value={groupLimit} onChange={e => setGroupLimit(Number(e.target.value))}/></label>
          <label>Monthly messages<input type="number" min={0} max={1000000} value={monthlyMessages} onChange={e => setMonthlyMessages(Number(e.target.value))}/></label>
          <div className="modal-actions"><button className="button secondary" type="button" disabled={busy} onClick={() => setEditing(null)}>Cancel</button>
            <button className="button primary" disabled={busy} type="submit">Save subscription</button></div>
        </form>
      </section></div>}
      {pendingGroup && <div className="modal-backdrop" role="presentation"><section className="modal-panel"
        role="alertdialog" aria-modal="true" aria-labelledby="group-title">
        <div className="eyebrow">OPERATOR GROUP CONTROL</div>
        <h2 id="group-title">{pendingGroup.enabled ? "Pause" : "Enable"} {pendingGroup.name}?</h2>
        <p className="muted">This directly changes whether translations are accepted for this group. The action is audited.</p>
        <div className="modal-actions"><button className="button secondary" disabled={busy} onClick={() => setPendingGroup(null)}>Cancel</button>
          <button className="button primary" disabled={busy} onClick={() => void changeGroupState()}>Confirm action</button></div>
      </section></div>}
      <footer className="footer">W-Bot by SL Options · Restricted platform administration · WhatsApp Web remains unofficial</footer>
    </div>
  </div>;
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><Console/></React.StrictMode>);
