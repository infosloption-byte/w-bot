import React, { useCallback, useEffect, useState } from "react";
import { portalRequest } from "./PortalAccount.js";
import "./alerts.css";

type Feature = {
  subscribed: boolean; enabled: boolean; active: boolean; status: string; planCode: string | null;
  limits?: { groups: number; rules: number; matchesPerMonth: number } | null;
};
type Features = { translation: Feature; alerts: Feature; billingEnabled: boolean };
type Source = { id: string; name: string; enabled: boolean; connectionId: string; whatsappGroupId: string };
type Rule = {
  id: string; name: string; category: string; keywords: string; enabled: boolean;
  origin: string | null; destination: string | null; minPrice: number | null; maxPrice: number | null;
  requireContact: boolean
};
type Match = {
  id: string; summary: string; quotedPrice: number | null; contactNumber: string | null;
  isRead: boolean; createdAt: string; rule: { name: string };
  event: { externalMessageId: string; group: { name: string } }
};
type Conn = { id: string; label: string; active: boolean; status: string };
type Discovered = { groupId: string; name: string };
type Usage = { used: number; groups: number; rules: number;
  limits: { matchesPerMonth: number; groups: number; rules: number } | null };
const emptyRule = { name: "", category: "GENERIC", keywords: "",
  origin: "", destination: "", minPrice: "", maxPrice: "", requireContact: false };
type RuleForm = typeof emptyRule;

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

export function SmartAlerts() {
  const [features, setFeatures] = useState<Features | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [connections, setConnections] = useState<Conn[]>([]);
  const [discovered, setDiscovered] = useState<Discovered[]>([]);
  const [connectionId, setConnectionId] = useState("");
  const [selectedGroup, setSelectedGroup] = useState("");
  const [consent, setConsent] = useState(false);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [form, setForm] = useState<RuleForm>(emptyRule);
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
    setUsage(metric); setConnections(conn.connections.filter(c=>c.active&&c.status==="CONNECTED"));
  }, []);
  useEffect(() => { void refresh().catch(e=>setError(e instanceof Error?e.message:"Unable to load alerts")); }, [refresh]);
  useEffect(() => {
    if (!connectionId) { setDiscovered([]); return; }
    let alive = true;
    void portalRequest<{groups: Discovered[]}>("/connections/"+encodeURIComponent(connectionId)+"/groups",undefined,"GET")
      .then(result => { if (alive) setDiscovered(result.groups); })
      .catch(e => { if (alive) setError(e instanceof Error ? e.message : "Unable to discover groups"); });
    return () => { alive=false; };
  }, [connectionId]);

  async function action(fn: () => Promise<unknown>, message: string) {
    setBusy(true); setError(""); setSuccess("");
    try { await fn(); await refresh(); setSuccess(message); }
    catch (e) { setError(e instanceof Error ? e.message : "Action failed"); }
    finally { setBusy(false); }
  }
  async function addGroup() {
    await action(() => portalRequest("/alerts/groups",{
      connectionId, groupId: selectedGroup, consentConfirmed: true
    }), "Group added to Smart Alerts. Translation settings were not changed.");
    setSelectedGroup(""); setConsent(false);
  }
  async function createRule(event: React.FormEvent) {
    event.preventDefault();
    const params = { ...form, origin: form.origin.trim()||null, destination: form.destination.trim()||null,
      minPrice: form.minPrice ? Number(form.minPrice) : null,
      maxPrice: form.maxPrice ? Number(form.maxPrice) : null };
    await action(() => portalRequest("/alerts/rules", params), "Matching rule saved.");
    setForm(emptyRule);
  }
  const licensed = features?.alerts.active && features.alerts.enabled;
  return <div className="smart-alerts">
    {error && <div className="alert error" role="alert">{error}<button aria-label="Dismiss" onClick={()=>setError("")}>×</button></div>}
    {success && <div className="alert success" role="status">{success}<button aria-label="Dismiss" onClick={()=>setSuccess("")}>×</button></div>}
    <section className="panel">
      <div className="panel-heading"><h3>Subscription & usage</h3>
        <button className="text-button" onClick={()=>void refresh().catch(()=>setError("Refresh failed"))}>Refresh</button></div>
      <p className="muted">Smart Alerts is a separate paid feature. Your WhatsApp connection and account remain shared.</p>
      <div className="alert-usage">
        <div><strong>{usage?.groups ?? 0} / {usage?.limits?.groups ?? "—"}</strong><small>Monitored groups</small></div>
        <div><strong>{usage?.rules ?? 0} / {usage?.limits?.rules ?? "—"}</strong><small>Matching rules</small></div>
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
      {!features?.alerts.active && <p className="muted text-small">
        A separate Smart Alerts subscription is required. No charges or checkout are available in this pilot.
      </p>}
    </section>
    <div className="alert-columns">
      <section className="panel">
        <div className="panel-heading"><h3>Groups to monitor</h3><span className="muted text-small">Read-only</span></div>
        <p className="muted text-small">Choose only groups that you are authorized to monitor. No private chats or historical messages.</p>
        <label className="alert-field">Connected WhatsApp account
          <select value={connectionId} disabled={!licensed} onChange={e=>{setConnectionId(e.target.value);setSelectedGroup("");}}>
            <option value="">Choose account</option>
            {connections.map(c=><option value={c.id} key={c.id}>{c.label}</option>)}
          </select>
        </label>
        {connectionId && <label className="alert-field">Joined WhatsApp group
          <select value={selectedGroup} disabled={!licensed} onChange={e=>setSelectedGroup(e.target.value)}>
            <option value="">Choose group</option>
            {discovered.map(group=><option key={group.groupId} value={group.groupId}>{group.name}</option>)}
          </select>
        </label>}
        <label className="consent-row"><input type="checkbox" checked={consent} disabled={!licensed}
          onChange={e=>setConsent(e.target.checked)}/>
          <span>I have authority to process this group's messages, participants have been informed, and I agree to limited private matching and retention.</span>
        </label>
        <button className="button primary" disabled={!licensed||!selectedGroup||!consent||busy}
          onClick={()=>void addGroup()}>Monitor selected group</button>
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
      </section>
      <section className="panel">
        <div className="panel-heading"><h3>Matching rules</h3><span className="muted text-small">Private searches</span></div>
        <form className="alert-form" onSubmit={e=>void createRule(e)}>
          <label className="alert-field">Rule name<input required minLength={2} maxLength={100} value={form.name}
            placeholder="Tours from Kandy" onChange={e=>setForm({...form,name:e.target.value})}/></label>
          <label className="alert-field">Category<select value={form.category}
            onChange={e=>setForm({...form,category:e.target.value})}>
            <option value="GENERIC">Generic opportunities</option>
            <option value="TOUR">Vehicle / tour booking</option>
          </select></label>
          <label className="alert-field">Keywords (comma-separated alternatives)
            <input required maxLength={500} value={form.keywords} placeholder="van,vehicle,booking"
              onChange={e=>setForm({...form,keywords:e.target.value})}/>
          </label>
          <div className="alert-form-split">
            <label className="alert-field">Origin (optional)<input value={form.origin} maxLength={100}
              onChange={e=>setForm({...form,origin:e.target.value})}/></label>
            <label className="alert-field">Destination (optional)<input value={form.destination} maxLength={100}
              onChange={e=>setForm({...form,destination:e.target.value})}/></label>
            <label className="alert-field">Minimum price<input type="number" min={0} value={form.minPrice}
              onChange={e=>setForm({...form,minPrice:e.target.value})}/></label>
            <label className="alert-field">Maximum price<input type="number" min={0} value={form.maxPrice}
              onChange={e=>setForm({...form,maxPrice:e.target.value})}/></label>
          </div>
          <label className="consent-row"><input type="checkbox" checked={form.requireContact}
            onChange={e=>setForm({...form,requireContact:e.target.checked})}/>
            <span>Only alert if a contact number appears in the message</span>
          </label>
          <button className="button primary" type="submit" disabled={!licensed||busy}>Save matching rule</button>
        </form>
        <div className="alert-items">{rules.map(rule=><div className="alert-item" key={rule.id}>
          <div><strong>{rule.name}</strong><small>{rule.keywords} · {rule.enabled?"Active":"Paused"}</small></div>
          <div className="alert-actions">
            <button className="text-button" disabled={busy} onClick={()=>void action(
              ()=>portalRequest("/alerts/rules/"+encodeURIComponent(rule.id),{enabled:!rule.enabled},"PATCH"),
              "Rule updated.")}>{rule.enabled?"Pause":"Resume"}</button>
            <button className="text-button danger-action" disabled={busy} onClick={()=>{
              if (window.confirm("Delete this rule and its previous alerts?"))
                void action(()=>portalRequest("/alerts/rules/"+encodeURIComponent(rule.id),undefined,"DELETE"),"Rule removed.");
            }}>Delete</button>
          </div>
        </div>)}</div>
      </section>
    </div>
    <section className="panel">
      <div className="panel-heading"><h3>Private alerts inbox</h3><span className="muted text-small">Recent matches · in-app only</span></div>
      <p className="muted text-small">Matches are visible only to signed-in workspace members. Monitoring never posts or replies inside the WhatsApp group.</p>
      {matches.length ? <div className="alert-inbox">{matches.map(item=><article className={"alert-match "+(item.isRead?"is-read":"")} key={item.id}>
        <div className="alert-match-header"><strong>{item.rule.name}</strong>
          <span className="muted text-small">{new Date(item.createdAt).toLocaleString()}</span></div>
        <p>{item.summary}</p>
        <div className="alert-match-meta">
          <span>Group: {item.event.group.name}</span>
          {item.quotedPrice!=null && <span>Quoted fare: {item.quotedPrice.toLocaleString()}</span>}
          {item.contactNumber && <span>Contact: {item.contactNumber}</span>}
        </div>
        {!item.isRead && <button className="text-button" disabled={busy} onClick={()=>void action(
          ()=>portalRequest("/alerts/inbox/"+encodeURIComponent(item.id),{isRead:true},"PATCH"),
          "Alert marked as read.")}>Mark read</button>}
      </article>)}</div> : <p className="muted">No matching messages yet. Add a monitored group and rule to begin.</p>}
    </section>
    <p className="muted text-small">Pilot matcher uses explicit keywords, locations and prices; AI semantic extraction and external notification delivery are planned later. WhatsApp linked-device monitoring is unofficial and may be restricted.</p>
  </div>;
}
