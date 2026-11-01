import React, { useEffect, useState } from "react";
import { portalRequest } from "./PortalAccount.js";
import { Icon } from "./Icon.js";

type Feature = { active: boolean; enabled: boolean; planCode: string | null; status: string };
type Features = { translation: Feature; alerts: Feature };
type Connection = { id: string; label: string; active: boolean; status: string };
type Summary = {
  features: Features; sessions: Connection[]; monitored: number; searches: number;
  unread: number; alertsUsed: number; alertsLimit: number | null
};
type Destination = "translation" | "alerts" | "connections" | "plans";

export function CustomerDashboard(props: {
  customerName: string;
  workspaceName: string;
  translationGroups: number;
  translations: number;
  onNavigate: (view: Destination, tab?: string) => void;
}) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState("");
  const [setupChoice, setSetupChoice] = useState<"translation" | "alerts" | "both">("both");
  useEffect(() => {
    let live = true;
    Promise.all([
      portalRequest<Features>("/features", undefined, "GET"),
      portalRequest<{connections: Connection[]}>("/connections", undefined, "GET"),
      portalRequest<{groups: Array<{id: string}>}>("/alerts/groups", undefined, "GET"),
      portalRequest<{rules: Array<{id: string}>}>("/alerts/rules", undefined, "GET"),
      portalRequest<{matches: Array<{isRead: boolean}>}>("/alerts/inbox", undefined, "GET"),
      portalRequest<{used: number; limits: {matchesPerMonth: number} | null}>("/alerts/usage", undefined, "GET")
    ]).then(([features, sessions, groups, rules, inbox, usage]) => {
      if (!live) return;
      setSummary({
        features, sessions: sessions.connections.filter(c => c.active && c.status === "CONNECTED"),
        monitored: groups.groups.length, searches: rules.rules.length,
        unread: inbox.matches.filter(m => !m.isRead).length,
        alertsUsed: usage.used, alertsLimit: usage.limits?.matchesPerMonth ?? null
      });
    }).catch(cause => {
      if (live) setError(cause instanceof Error ? cause.message : "Workspace details unavailable");
    });
    return () => { live = false; };
  }, []);
  const activeConnections = summary?.sessions.length ?? 0;
  const readyTranslation = Boolean(summary?.features.translation.active && summary.features.translation.enabled);
  const readyAlerts = Boolean(summary?.features.alerts.active && summary.features.alerts.enabled);
  const firstName = props.customerName.split(" ")[0] || "there";

  return <div className="home-layout">
    <section className="home-hero">
      <div className="home-hero-content">
        <div className="eyebrow">YOUR WORKSPACE · {props.workspaceName}</div>
        <h1>Welcome back, {firstName}.</h1>
        <p>Manage your connected WhatsApp accounts, translations and intelligent alerts from one place.</p>
        <div className="home-hero-actions">
          <button className="button primary" onClick={() => props.onNavigate("connections", "accounts")}>
            Manage WhatsApp connections <Icon name="arrow" size={16}/>
          </button>
          <button className="button ghost" onClick={() => props.onNavigate("plans", "translation")}>
            View my services
          </button>
        </div>
      </div>
      <div className="home-hero-orbit" aria-hidden="true"><span>W</span><i/><b/></div>
    </section>

    {error && <div className="alert error" role="alert">{error}</div>}

    <div className="home-stat-grid">
      <div className="home-stat"><span className="home-stat-icon"><Icon name="phone" size={18}/></span><span>Connected accounts</span><strong>{summary ? activeConnections : "—"}</strong><small>Authorized WhatsApp sessions</small></div>
      <div className="home-stat"><span className="home-stat-icon"><Icon name="translate" size={18}/></span><span>Translation groups</span><strong>{props.translationGroups}</strong><small>{props.translations.toLocaleString()} messages this month</small></div>
      <div className="home-stat"><span className="home-stat-icon"><Icon name="groups" size={18}/></span><span>Alert groups</span><strong>{summary?.monitored ?? "—"}</strong><small>Selected for private monitoring</small></div>
      <div className="home-stat"><span className="home-stat-icon"><Icon name="inbox" size={18}/></span><span>Unread matches</span><strong>{summary?.unread ?? "—"}</strong><small>From intelligent searches</small></div>
    </div>

    <div className="home-section-title"><div><div className="eyebrow">YOUR SERVICES</div><h2>What would you like to do?</h2></div></div>
    <div className="home-service-grid">
      <article className="home-service-card">
        <div className="home-service-top"><span className="home-service-icon translation-icon" aria-hidden="true"><Icon name="translate" size={24}/></span>
          <span className={"home-service-status" + (readyTranslation ? " is-ready" : "")}>
            {readyTranslation ? "Enabled" : summary?.features.translation.active ? "Paused" : "Subscription required"}
          </span></div>
        <h3>Group Translation</h3>
        <p>Automatically translate multilingual group conversations into the selected languages.</p>
        <div className="home-service-metadata"><span>{props.translationGroups} managed groups</span>
          <span>{summary?.features.translation.planCode ?? "No plan"}</span></div>
        <button className="button secondary" onClick={() => props.onNavigate(
          readyTranslation ? "translation" : "plans",
          readyTranslation ? "groups" : "translation")}>
          {readyTranslation ? "Manage translation" : "View translation setup"} <Icon name="arrow" size={16}/>
        </button>
      </article>
      <article className="home-service-card">
        <div className="home-service-top"><span className="home-service-icon alerts-icon" aria-hidden="true"><Icon name="alerts" size={24}/></span>
          <span className={"home-service-status" + (readyAlerts ? " is-ready" : "")}>
            {readyAlerts ? "Enabled" : summary?.features.alerts.active ? "Paused" : "Subscription required"}
          </span></div>
        <h3>Smart Alerts</h3>
        <p>Find relevant opportunities in authorized groups using your own natural-language search criteria.</p>
        <div className="home-service-metadata"><span>{summary?.searches ?? "—"} intelligent searches</span>
          <span>{summary?.features.alerts.planCode ?? "No plan"}</span></div>
        <button className="button secondary" onClick={() => props.onNavigate(
          readyAlerts ? "alerts" : "plans",
          readyAlerts ? (summary?.unread ? "inbox" : "searches") : "alerts")}>
          {readyAlerts ? "Open Smart Alerts" : "View Smart Alerts setup"} <Icon name="arrow" size={16}/>
        </button>
      </article>
    </div>

    <section className="home-checklist panel" aria-label="Workspace setup checklist">
      <div className="panel-heading"><div><div className="eyebrow">GET STARTED</div><h3>Your setup checklist</h3></div>
        <span className="home-progress-count">{[
          activeConnections > 0, readyTranslation || readyAlerts,
          props.translationGroups > 0 || (summary?.monitored ?? 0) > 0
        ].filter(Boolean).length} of 3</span></div>
      <div className="setup-choice">
        <div className="setup-choice-copy"><strong>What do you want W-Bot to do?</strong>
          <small>Choose a service to see the next step. You can use both services independently.</small></div>
        <div className="setup-choice-options" role="group" aria-label="Setup preference">
          {(["translation","alerts","both"] as const).map(choice => <button type="button" key={choice}
            aria-pressed={setupChoice === choice}
            className={setupChoice === choice ? "is-selected" : ""}
            onClick={() => setSetupChoice(choice)}>
            {choice === "translation" ? "Translation" : choice === "alerts" ? "Smart Alerts" : "Both services"}
          </button>)}
        </div>
        <div className="setup-choice-action">
          <span>{setupChoice === "both"
            ? "One linked account. Two independent subscriptions and group configurations."
            : setupChoice === "alerts"
              ? "Privately monitor chosen groups and build intelligent searches."
              : "Translate approved groups into your chosen languages."}</span>
          <button type="button" className="button primary" onClick={() => {
            const chosenReady = setupChoice === "translation" ? readyTranslation :
              setupChoice === "alerts" ? readyAlerts : readyTranslation && readyAlerts;
            if (!chosenReady) {
              const missing = setupChoice === "alerts" || (setupChoice === "both" && readyTranslation)
                ? "alerts" : "translation";
              props.onNavigate("plans", missing);
              return;
            }
            if (!activeConnections) { props.onNavigate("connections", "accounts"); return; }
            props.onNavigate(setupChoice === "translation" ? "translation" : "alerts", "groups");
          }}>Continue setup <Icon name="arrow" size={16}/></button>
        </div>
      </div>
      <div className="home-checklist-items">
        <button className="home-check-item" onClick={() => props.onNavigate("connections", "accounts")}>
          <span className={"home-check-dot" + (activeConnections ? " is-done" : "")}>{activeConnections ? "✓" : "1"}</span>
          <span><strong>Connect your WhatsApp</strong><small>Link a number once for both services</small></span>
          <span aria-hidden="true"><Icon name="arrow" size={18}/></span>
        </button>
        <button className="home-check-item" onClick={() => props.onNavigate("plans", "translation")}>
          <span className={"home-check-dot" + (readyTranslation || readyAlerts ? " is-done" : "")}>
            {readyTranslation || readyAlerts ? "✓" : "2"}</span>
          <span><strong>Enable the features you use</strong><small>Translation and Smart Alerts are licensed separately</small></span>
          <span aria-hidden="true"><Icon name="arrow" size={18}/></span>
        </button>
        <button className="home-check-item" onClick={() => props.onNavigate(
          readyAlerts ? "alerts" : readyTranslation ? "translation" : "plans",
          readyAlerts || readyTranslation ? "groups" : "translation")}>
          <span className={"home-check-dot" + (props.translationGroups || summary?.monitored ? " is-done" : "")}>
            {props.translationGroups || summary?.monitored ? "✓" : "3"}</span>
          <span><strong>Choose authorized groups</strong><small>Configure translation or monitored groups independently</small></span>
          <span aria-hidden="true"><Icon name="arrow" size={18}/></span>
        </button>
      </div>
    </section>
  </div>;
}

export function TranslationActivity() {
  const [data, setData] = useState<{
    recent: Array<{ id: string; status: string; sourceLanguage: string | null;
      createdAt: string; group: { name: string } }>; messages: number
  } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    void portalRequest<{
      recent: Array<{ id: string; status: string; sourceLanguage: string | null;
        createdAt: string; group: { name: string } }>; messages: number
    }>("/usage", undefined, "GET").then(setData)
      .catch(cause => setError(cause instanceof Error ? cause.message : "Activity unavailable"));
  }, []);
  return <section className="panel">
    <div className="panel-heading"><h3>Translation activity</h3><span className="muted">{data?.messages ?? "—"} messages this month</span></div>
    {error && <div className="alert error" role="alert">{error}</div>}
    {data?.recent.map(item => <div className="activity-line" key={item.id}>
      <div className="activity-dot"/><div className="grow"><strong>{item.group.name}</strong>
        <small>{item.sourceLanguage?.toUpperCase() ?? "Language detection"} · {new Date(item.createdAt).toLocaleString()}</small></div>
      <span className={"status " + (item.status === "COMPLETED" ? "on" : "")}>{item.status.toLowerCase()}</span>
    </div>)}
    {data && !data.recent.length && <div className="empty">No recent translations yet.</div>}
  </section>;
}
