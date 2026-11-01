import React, { useCallback, useEffect, useState } from "react";
import { portalRequest } from "./PortalAccount.js";
import "./alerts.css";

type Feature = {
  subscribed: boolean; enabled: boolean; active: boolean; status: string; planCode: string | null;
  limits?: { groups: number; rules: number; matchesPerMonth: number; analysesPerMonth?: number } | null;
};
type Features = { translation: Feature; alerts: Feature; billingEnabled: boolean; alertsAiReady: boolean };
type Source = { id: string; name: string; enabled: boolean; connectionId: string; whatsappGroupId: string };
type SearchParameter = { label: string; value: string };
type Rule = { id: string; name: string; keywords: string; enabled: boolean;
  parameters: SearchParameter[] | null };
type Match = {
  id: string; summary: string; quotedPrice: number | null; contactNumber: string | null;
  isRead: boolean; createdAt: string; rule: { name: string };
  event: { externalMessageId: string; group: { name: string } }
};
type Conn = { id: string; label: string; kind?: string; phoneLast4?: string | null;
  active: boolean; status: string };
type Discovered = { groupId: string; name: string };
type Usage = { used: number; analyses: number; groups: number; rules: number;
  limits: { matchesPerMonth: number; analysesPerMonth: number; groups: number; rules: number } | null };
const blankParameter = (): SearchParameter => ({ label: "", value: "" });

export function FeatureHub(props: { onOpenAlerts: () => void }) {
  const [data, setData] = useState<Features | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(() => portalRequest<Features>("/features", undefined, "GET")
    .then(setData).catch(e => setError(e instanceof Error ? e.message : "Unable to load features")),[]);
  useEffect(() => { void refresh(); }, [refresh]);
  async function toggle(type: "translation" | "alerts", enabled: boolean) {
    setBusy(true); setError("");
    try {
      await portalRequest("/features/" + type, { enabled }, "PATCH");
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save feature"); }
    finally { setBusy(false); }
  }
  return <div className="feature-grid">
    {error && <div className="alert error" role="alert">{error}</div>}
    {(["translation","alerts"] as const).map(type => {
      const feature = data?.[type];
      return <section className="panel feature-panel" key={type}>
        <div className="eyebrow">{type === "translation" ? "GROUP TRANSLATION" : "SMART GROUP ALERTS"}</div>
        <h3>{type === "translation" ? "Translate messages" : "Find matching opportunities"}</h3>
        <p className="muted">{type === "translation"
          ? "Reply in connected translation groups with the languages you choose."
          : "Monitor authorized groups privately and see matches in your inbox. No group replies."}</p>
        <div className="detail"><span>Subscription</span><strong>{feature?.planCode ?? "Not subscribed"}</strong></div>
        <div className="detail"><span>Billing status</span><strong>{feature?.status ?? "Loading"}</strong></div>
        <div className="feature-actions">
          <button type="button" className={"button " + (feature?.enabled ? "secondary" : "primary")}
            disabled={busy || !feature?.active}
            onClick={() => void toggle(type,!feature?.enabled)}>
            {feature?.enabled ? "Pause feature" : "Enable feature"}
          </button>
          {type === "alerts" && <button type="button" className="button secondary"
            onClick={props.onOpenAlerts}>Open Smart Alerts</button>}
        </div>
        {!feature?.active && <p className="muted text-small">
          This feature requires its own active subscription. Payment checkout is not available during the pilot.
        </p>}
      </section>;
    })}
  </div>;
}

export function SmartAlerts({
  section = "overview", onNavigate
}: {
  section?: "overview" | "groups" | "searches" | "inbox";
  onNavigate?: (section: "overview" | "groups" | "searches" | "inbox") => void;
}) {
  const [features, setFeatures] = useState<Features | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [connections, setConnections] = useState<Conn[]>([]);
  const [discovered, setDiscovered] = useState<Discovered[]>([]);
  const [connectionId, setConnectionId] = useState("");
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [groupSearch, setGroupSearch] = useState("");
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [consent, setConsent] = useState(false);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [ruleName, setRuleName] = useState("");
  const [parameters, setParameters] = useState<SearchParameter[]>([blankParameter()]);
  const [editingRule, setEditingRule] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const refresh = useCallback(async () => {
    const [f, groups, r, inbox, metric, conn] = await Promise.all([
      portalRequest<Features>("/features",undefined,"GET"),
      portalRequest<{groups: Source[]}>("/alerts/groups",undefined,"GET"),
      portalRequest<{rules: Rule[]}>("/alerts/rules",undefined,"GET"),
      portalRequest<{matches: Match[]}>("/alerts/inbox",undefined,"GET"),
      portalRequest<Usage>("/alerts/usage",undefined,"GET"),
      portalRequest<{connections: Conn[]}>("/connections",undefined,"GET")
    ]);
    setFeatures(f); setSources(groups.groups); setRules(r.rules); setMatches(inbox.matches);
    setUsage(metric);
    const active = conn.connections.filter(c => c.active && c.status === "CONNECTED");
    setConnections(active);
    setConnectionId(current => active.some(c => c.id === current) ? current : (active[0]?.id ?? ""));
  }, []);
  useEffect(() => { void refresh().catch(e=>setError(e instanceof Error?e.message:"Unable to load alerts")); }, [refresh]);
  useEffect(() => {
    if (!connectionId) { setDiscovered([]); setSelectedGroups([]); return; }
    let alive = true;
    setGroupsLoading(true); setDiscovered([]); setSelectedGroups([]);
    void portalRequest<{ groups: Discovered[] }>("/connections/" + encodeURIComponent(connectionId) + "/groups",
      undefined, "GET")
      .then(result => { if (alive) setDiscovered(result.groups); })
      .catch(e => { if (alive) setError(e instanceof Error ? e.message : "Unable to discover groups"); })
      .finally(() => { if (alive) setGroupsLoading(false); });
    return () => { alive = false; };
  }, [connectionId]);

  async function action(fn: () => Promise<unknown>, message: string): Promise<boolean> {
    setBusy(true); setError(""); setSuccess("");
    try { await fn(); await refresh(); setSuccess(message); return true; }
    catch (e) { setError(e instanceof Error ? e.message : "Action failed"); return false; }
    finally { setBusy(false); }
  }
  async function addGroups() {
    if (!connectionId || !selectedGroups.length || !consent) return;
    const ok = await action(() => portalRequest("/alerts/groups/bulk", {
      connectionId, groupIds: selectedGroups, consentConfirmed: true
    }), "Monitoring activated for selected groups. Translation settings are unchanged.");
    if (ok) { setSelectedGroups([]); setConsent(false); }
  }
  function editSearch(rule: Rule) {
    setEditingRule(rule.id); setRuleName(rule.name);
    setParameters(Array.isArray(rule.parameters) && rule.parameters.length
      ? rule.parameters.map(row => ({ label: row.label, value: row.value }))
      : [{ label: "What to find", value: rule.keywords }]);
    setError("");
  }
  function resetSearch() {
    setEditingRule(null); setRuleName(""); setParameters([blankParameter()]);
  }
  function updateParameter(index: number, field: keyof SearchParameter, value: string) {
    setParameters(current => current.map((row,i) => i===index ? { ...row, [field]: value } : row));
  }
  async function createRule(event: React.FormEvent) {
    event.preventDefault();
    const cleaned = parameters.map(row => ({ label: row.label.trim(), value: row.value.trim() }));
    if (!ruleName.trim() || cleaned.some(row => !row.label || !row.value)) {
      setError("Enter a search name and complete every label and value."); return;
    }
    if (new Set(cleaned.map(row => row.label.toLowerCase())).size !== cleaned.length) {
      setError("Each label must have a different name."); return;
    }
    const endpoint = editingRule ? "/alerts/rules/" + encodeURIComponent(editingRule) : "/alerts/rules";
    const ok = await action(() => portalRequest(endpoint,
      { name: ruleName.trim(), parameters: cleaned }, editingRule ? "PATCH" : "POST"),
      "Intelligent search saved.");
    if (ok) resetSearch();
  }
  const licensed = features?.alerts.active && features.alerts.enabled;
  return <div className="smart-alerts">
    {error && <div className="alert error" role="alert">{error}<button aria-label="Dismiss" onClick={()=>setError("")}>×</button></div>}
    {success && <div className="alert success" role="status">{success}<button aria-label="Dismiss" onClick={()=>setSuccess("")}>×</button></div>}
    {section === "overview" && <section className="panel">
      <div className="panel-heading"><h3>Subscription & usage</h3>
        <button className="text-button" onClick={()=>void refresh().catch(()=>setError("Refresh failed"))}>Refresh</button></div>
      <p className="muted">Smart Alerts is a separate paid feature. Your WhatsApp connection and account remain shared.</p>
      <div className="alert-usage">
        <div><strong>{usage?.groups ?? 0} / {usage?.limits?.groups ?? "—"}</strong><small>Monitored groups</small></div>
        <div><strong>{usage?.rules ?? 0} / {usage?.limits?.rules ?? "—"}</strong><small>Matching rules</small></div>
        <div><strong>{usage?.analyses ?? 0} / {usage?.limits?.analysesPerMonth ?? "—"}</strong><small>AI analyses this month</small></div>
        <div><strong>{usage?.used ?? 0} / {usage?.limits?.matchesPerMonth ?? "—"}</strong><small>Monthly matches</small></div>
      </div>
      <div className="feature-actions">
        <span className={"status " + (licensed ? "on" : "")}>{licensed ? "Alerts enabled" : features?.alerts.status ?? "Not subscribed"}</span>
        <button type="button" className="button secondary" disabled={busy || !features?.alerts.active}
          onClick={()=>void action(()=>portalRequest("/features/alerts",{enabled:!features?.alerts.enabled},"PATCH"),
            features?.alerts.enabled?"Alerts paused.":"Alerts enabled.")}>
          {features?.alerts.enabled?"Pause Smart Alerts":"Enable Smart Alerts"}
        </button>
      </div>
      {features && !features.alertsAiReady && <p className="alert-ai-notice" role="status">
        AI analysis is disabled on this server. The administrator must enable it before intelligent matching starts.
      </p>}
      {!features?.alerts.active && <p className="muted text-small">
        A separate Smart Alerts subscription is required. No charges or checkout are available in this pilot.
      </p>}
    </section>}
    {(section === "groups" || section === "searches") && <div className="alert-columns alert-page-grid">
      {section === "groups" && <section className="panel">
        <div className="panel-heading"><h3>Choose groups to monitor</h3><span className="muted text-small">Read-only</span></div>
        <p className="muted text-small">Choose only groups that you are authorized to monitor. No private chats or historical messages.</p>
        <div className="alert-session-list">
          {connections.map(c => <button key={c.id} type="button"
            aria-pressed={connectionId === c.id} disabled={!licensed}
            className={"alert-session" + (connectionId === c.id ? " is-selected" : "")}
            onClick={() => setConnectionId(c.id)}>{c.label}</button>)}
        </div>
        {!connections.length && <p className="muted">No connected sessions available.</p>}
        {connectionId && <>
          <label className="alert-field">Find joined groups
            <input type="search" placeholder="Find a group" value={groupSearch}
              onChange={e => setGroupSearch(e.target.value)}/>
          </label>
          <div className="alert-group-toolbar">
            <span className="muted">{groupsLoading ? "Loading…" : selectedGroups.length + " selected"}</span>
            <button type="button" className="text-button" disabled={!licensed}
              onClick={() => setSelectedGroups(discovered
                .filter(g => g.name.toLowerCase().includes(groupSearch.toLowerCase())
                  && !sources.some(source => source.connectionId === connectionId &&
                    source.whatsappGroupId === g.groupId && source.enabled))
                .slice(0,50).map(g => g.groupId))}>Select shown</button>
            <button type="button" className="text-button"
              onClick={() => setSelectedGroups([])}>Clear</button>
          </div>
          <div className="alert-group-list">
            {discovered.filter(g => g.name.toLowerCase().includes(groupSearch.toLowerCase())).map(g => {
              const monitored = sources.some(x => x.connectionId === connectionId
                && x.whatsappGroupId === g.groupId && x.enabled);
              return <label key={g.groupId} className="alert-group-option">
                <input type="checkbox" disabled={!licensed || monitored}
                  checked={monitored || selectedGroups.includes(g.groupId)}
                  onChange={e => setSelectedGroups(current => e.target.checked
                    ? [...current.filter(id => id !== g.groupId), g.groupId]
                    : current.filter(id => id !== g.groupId))}/>
                <span>{g.name}</span><small>{monitored ? "Active" : ""}</small>
              </label>;
            })}
          </div>
          <label className="consent-row"><input type="checkbox" checked={consent} disabled={!licensed}
            onChange={e => setConsent(e.target.checked)}/>
            <span>I have authority to monitor these groups and participants have been informed that selected messages are analyzed by an external AI provider.</span>
          </label>
          <button type="button" className="button primary"
            disabled={!licensed || !selectedGroups.length || !consent || busy}
            onClick={() => void addGroups()}>Activate monitoring for {selectedGroups.length} selected group(s)</button>
        </>}
        <div className="alert-items">{sources.map(source=><div className="alert-item" key={source.id}>
          <div><strong>{source.name}</strong><small>{source.enabled?"Monitoring":"Paused"}</small></div>
          <div className="alert-actions">
            <button disabled={busy} className="text-button" onClick={()=>void action(
              ()=>portalRequest("/alerts/groups/"+encodeURIComponent(source.id),{enabled:!source.enabled},"PATCH"),
              "Group monitoring updated.")}>{source.enabled?"Pause":"Resume"}</button>
            <button disabled={busy} className="text-button danger-action" onClick={()=>{
              if (window.confirm("Stop monitoring and erase the group's alerts and events?"))
                void action(()=>portalRequest("/alerts/groups/"+encodeURIComponent(source.id),undefined,"DELETE"),"Group removed.");
            }}>Remove</button>
          </div>
        </div>)}</div>
      </section>}
      {section === "searches" && <section className="panel">
        <div className="panel-heading"><h3>Intelligent searches</h3><span className="muted text-small">Private searches</span></div>
        <p className="muted text-small">Create a search with your own labels and values. AI interprets formatted or natural-language messages and checks every requirement.</p>
        <form className="alert-form" onSubmit={e => void createRule(e)}>
          <label className="alert-field">Search name
            <input required minLength={2} maxLength={100} value={ruleName}
              placeholder="My opportunities" onChange={e => setRuleName(e.target.value)}/>
          </label>
          <div className="alert-parameters">
            {parameters.map((row,i) => <div className="alert-parameter-row" key={i}>
              <label className="alert-field">Label
                <input required minLength={2} maxLength={60} value={row.label}
                  placeholder="Service" onChange={e => updateParameter(i,"label",e.target.value)}/>
              </label>
              <label className="alert-field">Value or condition
                <input required maxLength={250} value={row.value}
                  placeholder="Web design or website development"
                  onChange={e => updateParameter(i,"value",e.target.value)}/>
              </label>
              <button type="button" className="text-button danger-action" disabled={parameters.length === 1}
                onClick={() => setParameters(old => old.filter((_,j) => j !== i))}>Remove</button>
            </div>)}
          </div>
          <button type="button" className="text-button" disabled={parameters.length >= 12}
            onClick={() => setParameters(old => [...old,blankParameter()])}>+ Add parameter</button>
          <p className="muted text-small">Example: Service → Graphic design, Location → Colombo or Galle, Budget → At least 20,000 LKR. Use any labels relevant to your business.</p>
          <div className="feature-actions">
            <button className="button primary" type="submit" disabled={!licensed || busy}>
              {editingRule ? "Update search" : "Create intelligent search"}
            </button>
            {editingRule && <button type="button" className="button secondary"
              onClick={resetSearch}>Cancel edit</button>}
          </div>
        </form>
        <div className="alert-items">{rules.map(rule=><div className="alert-item" key={rule.id}>
          <div><strong>{rule.name}</strong><small>{Array.isArray(rule.parameters)
            ? rule.parameters.map(p => p.label + ": " + p.value).join(" · ")
            : "Legacy terms: " + rule.keywords} · {rule.enabled ? "Active" : "Paused"}</small></div>
          <div className="alert-actions">
            <button className="text-button" disabled={busy} onClick={() => editSearch(rule)}>Edit</button>
            <button className="text-button" disabled={busy} onClick={()=>void action(
              ()=>portalRequest("/alerts/rules/"+encodeURIComponent(rule.id),{enabled:!rule.enabled},"PATCH"),
              "Rule updated.")}>{rule.enabled?"Pause":"Resume"}</button>
            <button className="text-button danger-action" disabled={busy} onClick={()=>{
              if (window.confirm("Delete this rule and its previous alerts?"))
                void action(()=>portalRequest("/alerts/rules/"+encodeURIComponent(rule.id),undefined,"DELETE"),"Rule removed.");
            }}>Delete</button>
          </div>
        </div>)}</div>
      </section>}
    </div>}
    {section === "inbox" && <section className="panel">
      <div className="panel-heading"><h3>Private alerts inbox</h3><span className="muted text-small">Recent matches · in-app only</span></div>
      <p className="muted text-small">Matches are visible only to signed-in workspace members. Monitoring never posts or replies inside the WhatsApp group.</p>
      {matches.length ? <div className="alert-inbox">{matches.map(item=><article className={"alert-match "+(item.isRead?"is-read":"")} key={item.id}>
        <div className="alert-match-header"><strong>{item.rule.name}</strong>
          <span className="muted text-small">{new Date(item.createdAt).toLocaleString()}</span></div>
        <p>{item.summary}</p>
        <div className="alert-match-meta">
          <span>Group: {item.event.group.name}</span>
          {item.quotedPrice!=null && <span>Amount: {item.quotedPrice.toLocaleString()}</span>}
          {item.contactNumber && <span>Contact: {item.contactNumber}</span>}
        </div>
        {!item.isRead && <button className="text-button" disabled={busy} onClick={()=>void action(
          ()=>portalRequest("/alerts/inbox/"+encodeURIComponent(item.id),{isRead:true},"PATCH"),
          "Alert marked as read.")}>Mark read</button>}
      </article>)}</div> : <p className="muted">No matching messages yet. Add a monitored group and rule to begin.</p>}
    </section>}
    {section === "overview" && <section className="home-service-grid">
      <article className="home-service-card"><div className="eyebrow">STEP 1</div>
        <h3>Monitored WhatsApp groups</h3>
        <p>Choose which authorized groups Smart Alerts should analyze. Each group can be paused independently.</p>
        <button className="button secondary" onClick={() => onNavigate?.("groups")}>
          Manage {usage?.groups ?? 0} groups <span aria-hidden="true">→</span>
        </button>
      </article>
      <article className="home-service-card"><div className="eyebrow">STEP 2</div>
        <h3>Intelligent searches</h3>
        <p>Describe what matters to you using flexible labels and values, for any industry.</p>
        <button className="button secondary" onClick={() => onNavigate?.("searches")}>
          Manage {usage?.rules ?? 0} searches <span aria-hidden="true">→</span>
        </button>
      </article>
      <article className="home-service-card"><div className="eyebrow">STEP 3</div>
        <h3>Review your matches</h3>
        <p>Read matching opportunities privately. Smart Alerts never replies in monitored groups.</p>
        <button className="button secondary" onClick={() => onNavigate?.("inbox")}>
          Open inbox <span aria-hidden="true">→</span>
        </button>
      </article>
    </section>}
    <p className="muted text-small">The Gemini-based semantic matcher is independently enabled by the administrator; AI results should always be checked against the original group message. External notification delivery is not yet available. WhatsApp linked-device monitoring is unofficial and may be restricted.</p>
  </div>;
}
