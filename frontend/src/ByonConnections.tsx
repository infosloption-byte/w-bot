import React, { useCallback, useEffect, useState } from "react";
import { Icon } from "./Icon.js";

type Kind = "PERSONAL" | "BUSINESS";
type Connection = {
  id: string; label: string; kind: Kind; status: string;
  phoneLast4: string | null; createdAt: string; active: boolean; _count?: { groups: number }
};
type Policy = {
  enabled: boolean; personalEnabled: boolean; businessEnabled: boolean; maxConnections: number;
  planConnections: number; groupLimit: number; groupCount: number
};
type Details = {
  connection: Connection;
  pairingCode: string | null;
  qrDataUrl: string | null;
  pairExpiresAt?: number | null;
};
async function request<T>(url: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch("/portal/api" + url, {
    method, credentials: "same-origin", cache: "no-store",
    // An empty DELETE must not advertise JSON: Fastify would try to parse an
    // absent payload. Still send the CSRF/mutation header for state changes.
    headers: method === "GET" ? {} : {
      "X-WBot-Request": "1",
      ...(body === undefined ? {} : { "Content-Type": "application/json" })
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(
    typeof result.error === "string" ? result.error : "Unable to complete connection request"
  );
  return result as T;
}
const statusLabel = (status: string) => ({
  CONNECTED: "Connected", PAIRING: "Waiting for pairing",
  DISCONNECTED: "Disconnected", CREATED: "Not linked",
  REQUIRES_REPAIR: "Needs reconnection", REVOKED: "Revoked"
} as Record<string, string>)[status] ?? status.toLowerCase().replaceAll("_", " ");

export function ByonConnections({
  onManageGroups, onManageAlerts, mode = "accounts", onNavigate
}: {
  onManageGroups?: () => void;
  onManageAlerts?: () => void;
  mode?: "accounts" | "add" | "pairing";
  onNavigate?: (tab: "accounts" | "add" | "pairing") => void;
}) {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [details, setDetails] = useState<Details | null>(null);
  const [kind, setKind] = useState<Kind>("BUSINESS");
  const [label, setLabel] = useState("");
  const [consent, setConsent] = useState(false);
  const [phone, setPhone] = useState("");
  const [method, setMethod] = useState<"qr" | "code">("qr");
  const [timeNow, setTimeNow] = useState(Date.now());
  const [groupConsent, setGroupConsent] = useState(false);
  const [groups, setGroups] = useState<Array<{
    groupId: string; name: string; activated: boolean; enabled: boolean; managedGroupId: string | null
  }>>([]);
  const [groupUsage, setGroupUsage] = useState<{ used: number; limit: number } | null>(null);
  const [groupListLoaded, setGroupListLoaded] = useState(false);
  const [activation, setActivation] = useState<{ code: string; expiresAt: string } | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [groupLoading, setGroupLoading] = useState(false);
  const refresh = useCallback(async () => {
    const result = await request<{ policy: Policy; connections: Connection[] }>("/connections");
    setPolicy(result.policy);
    setConnections(result.connections);
    setSelected(current => current && result.connections.some(c => c.id === current) ?
      current : result.connections.find(c => c.active)?.id ?? result.connections[0]?.id ?? null);
  }, []);
  useEffect(() => { void refresh().catch(e => setError(String(e))); }, [refresh]);
  useEffect(() => {
    if (!selected || connections.find(c => c.id === selected)?.active === false) { setDetails(null); return; }
    let cancelled = false;
    const poll = async () => {
      try {
        const result = await request<Details>("/connections/" + encodeURIComponent(selected) + "/status");
        if (!cancelled) {
          setDetails(result);
          setTimeNow(Date.now());
          if (result.connection.status === "CONNECTED") void refresh().catch(() => {});
        }
      } catch {
        if (!cancelled) setDetails(null);
      }
    };
    void poll();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void poll(); }, 5000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [selected, refresh, connections.find(c => c.id === selected)?.active]);

  const active = connections.find(c => c.id === selected);
  const connected = active?.active !== false &&
    (details?.connection.status ?? active?.status) === "CONNECTED";
  const activeConnectionsCount = connections.filter(c => c.active).length;
  const maxConnections = policy?.maxConnections ?? 0; // 0 means unlimited
  const canCreate = Boolean(policy?.enabled &&
    (maxConnections === 0 || activeConnectionsCount < maxConnections));
  const groupSlotsUsed = groupUsage?.used ?? policy?.groupCount ?? 0;
  const groupSlotsLimit = groupUsage?.limit ?? policy?.groupLimit ?? 0;
  const groupsFull = groupSlotsUsed >= groupSlotsLimit;
  const canPair = Boolean(policy?.enabled && active?.active &&
    (active.kind === "PERSONAL" ? policy.personalEnabled : policy.businessEnabled));
  const expiresIn = details?.pairExpiresAt ?
    Math.max(0, Math.ceil((details.pairExpiresAt - timeNow) / 1000)) : null;

  function switchConnection(id: string) {
    setSelected(id); setDetails(null); setGroups([]); setGroupListLoaded(false); setGroupUsage(null);
    setActivation(null); setPhone(""); setGroupConsent(false);
    setError(""); setNotice(""); setShowCreate(false);
  }
  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const result = await request<{ connection: Connection }>("/connections", "POST", {
        kind, label: label.trim(), consentConfirmed: consent
      });
      await refresh();
      switchConnection(result.connection.id);
      setShowCreate(false); setLabel(""); setConsent(false);
      onNavigate?.("pairing");
      setNotice("Connection created. Choose how to link your WhatsApp account.");
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to create connection"); }
    finally { setBusy(false); }
  }
  async function startPair() {
    if (!selected) return;
    setBusy(true); setError(""); setNotice(""); setDetails(null);
    try {
      const normalized = phone.trim().replace(/[\s()+-]/g, "");
      if (method === "code" && !/^[1-9][0-9]{7,14}$/.test(normalized))
        throw Error("Enter a valid international number, including country code.");
      await request("/connections/" + encodeURIComponent(selected) + "/pair", "POST",
        method === "code" ? { phoneNumber: normalized } : {});
      setNotice("Linking started. Approve the new device in WhatsApp on your phone.");
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to start pairing"); }
    finally { setBusy(false); }
  }
  async function discover() {
    if (!selected) return;
    setGroupLoading(true); setError("");
    try {
      const data = await request<{ groups: Array<{
        groupId: string; name: string; activated: boolean; enabled: boolean; managedGroupId: string | null
      }>; groupUsage: { used: number; limit: number } }>(
        "/connections/" + encodeURIComponent(selected) + "/groups"
      );
      setGroups(data.groups); setGroupUsage(data.groupUsage); setGroupListLoaded(true);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load joined groups"); }
    finally { setGroupLoading(false); }
  }
  async function activate() {
    if (!selected || !groupConsent || groupsFull) return;
    setBusy(true); setError("");
    try {
      const result = await request<{ code: string; expiresAt: string }>(
        "/connections/activations", "POST",
        { connectionId: selected, consentConfirmed: true }
      );
      setActivation(result);
      setNotice("A WhatsApp group administrator must post the activation command in that group.");
    } catch (e) { setError(e instanceof Error ? e.message : "Activation unavailable"); }
    finally { setBusy(false); }
  }
  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); setNotice("Copied to clipboard"); }
    catch { setError("Copy failed. Select the code to copy it manually."); }
  }
  async function revoke() {
    if (!confirmRevoke) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await request<{ removed: boolean; pending?: boolean; message?: string }>(
        "/connections/" + encodeURIComponent(confirmRevoke), "DELETE"
      );
      setConfirmRevoke(null); setDetails(null);
      setGroups([]); setActivation(null); setGroupListLoaded(false);
      if (result.removed) setSelected(null);
      await refresh();
      setNotice(result.removed ?
        "WhatsApp connection, its groups and their stored translations were permanently removed." :
        result.message ?? "Connection paused; cleanup pending. Use Remove again to retry.");
      if (result.removed) onManageGroups?.();
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to remove account"); }
    finally { setBusy(false); }
  }

  return <div className="byon-shell">
    {notice && <div className="alert success" role="status">{notice}</div>}
    {error && <div className="alert error" role="alert">{error}</div>}
    {!policy?.enabled && <div className="byon-notice" role="status">
      <Icon name="info" size={16}/> Customer-owned numbers are currently disabled by Platform Admin.
      Existing shared W-Bot groups are unaffected.
    </div>}
    <div className={"byon-progress" + (mode === "pairing" ? "" : " is-hidden")} aria-label="Connection setup steps">
      {["Choose an account","Link WhatsApp","Optional: translation setup"].map((name, index) => {
        const done = index === 0 ? Boolean(selected) : index === 1 ? connected : Boolean(activation);
        return <div className={"byon-progress-step" + (done ? " is-complete" : "")} key={name}>
          <span className="byon-progress-number">{done ? "✓" : index + 1}</span>
          <span>{name}</span>
        </div>;
      })}
    </div>
    {mode === "add" && !canCreate && <div className="byon-notice" role="status">
      Your WhatsApp connection allowance is unavailable or full. Review Plans & Usage
      or contact your workspace administrator before adding another account.
    </div>}
    <div className="byon-layout">
      <section className={"panel byon-numbers-panel" + (mode === "pairing" ? " is-hidden" : "")} aria-label="Your WhatsApp connections">
        <div className="byon-panel-heading">
          <div><div className="eyebrow">01 / YOUR NUMBERS</div><h3>{mode === "add" ? "Add a WhatsApp account" : "Connected accounts"}</h3></div>
          <span className="byon-count">{activeConnectionsCount} / {maxConnections === 0 ? "Unlimited" : maxConnections}</span>
        </div>
        <p className="muted text-small">Choose an existing account or link a number you control. A dedicated WhatsApp number is recommended.</p>
        <div className="byon-number-list">
          {connections.map(c => <div key={c.id} className="byon-number-row"><button type="button"
            className={"byon-number-item" + (selected === c.id ? " is-active" : "")}
            aria-pressed={selected === c.id} onClick={() => {
              switchConnection(c.id); onNavigate?.("pairing");
            }}>
            <span className="byon-number-icon" aria-hidden="true"><Icon name="phone" size={20}/></span>
            <span className="byon-number-info"><strong>{c.label}</strong>
              <small>{c.kind === "PERSONAL" ? "Personal" : "WhatsApp Business App"}{c.phoneLast4 ? " · ••••" + c.phoneLast4 : ""}</small>
            </span>
            <span className={"byon-state" + (c.status === "CONNECTED" ? " is-online" : "")}>
              {statusLabel(c.status)}
            </span>
          </button>
          <button type="button" className="byon-remove-action"
            aria-label={"Remove " + c.label + " WhatsApp connection"}
            disabled={busy} onClick={() => setConfirmRevoke(c.id)}>Remove</button>
          </div>)}
          {!connections.length && <div className="byon-empty">
            <div className="byon-empty-icon" aria-hidden="true"><Icon name="phone" size={26}/></div>
            <strong>No WhatsApp account added</strong>
            <p>Start by creating a connection. Your phone will authorize access in the next step.</p>
          </div>}
        </div>
        {canCreate && mode === "accounts" && <button type="button" className="button secondary byon-add-button"
          aria-expanded={showCreate} onClick={() => {
             if (onNavigate) onNavigate("add"); else setShowCreate(value => !value);
           }}>
          {showCreate ? "Cancel adding number" : "+ Add WhatsApp number"}
        </button>}
        {canCreate && (mode === "add" || (!onNavigate && (showCreate || connections.length === 0))) &&
          <form className="byon-create-form" onSubmit={e => void create(e)}>
            <h3>New WhatsApp connection</h3>
            <div className="byon-kind-picker" aria-label="WhatsApp account type">
              <button type="button" disabled={!policy?.businessEnabled}
                aria-pressed={kind === "BUSINESS"}
                className={"byon-kind" + (kind === "BUSINESS" ? " is-selected" : "")}
                onClick={() => setKind("BUSINESS")}>
                <strong>Business number</strong><small>Recommended for your groups</small>
              </button>
              <button type="button" disabled={!policy?.personalEnabled}
                aria-pressed={kind === "PERSONAL"}
                className={"byon-kind" + (kind === "PERSONAL" ? " is-selected" : "")}
                onClick={() => setKind("PERSONAL")}>
                <strong>Personal number</strong><small>Uses your personal account</small>
              </button>
            </div>
            <label className="byon-field">Display name
              <input type="text" value={label} minLength={2} maxLength={100} required
                placeholder="e.g. My WhatsApp" onChange={e => setLabel(e.target.value)}/>
            </label>
            <label className="byon-check"><input type="checkbox" checked={consent} required
              onChange={e => setConsent(e.target.checked)}/>
              <span>I own or administer this account, and understand that a WhatsApp linked device has access beyond the selected translation groups. Participants have been informed.</span>
            </label>
            <button type="submit" className="button primary" disabled={busy || !consent ||
              (kind === "PERSONAL" ? !policy?.personalEnabled : !policy?.businessEnabled)}>
              {busy ? "Creating…" : "Create connection"}
            </button>
          </form>}
      </section>

      <section className={"panel byon-setup-panel" + (mode === "pairing" ? "" : " is-hidden")} aria-label="Pair WhatsApp account">
        <div className="quick-setup">
          <div><strong>Choose an account to manage</strong><small>Pair or reconnect any of your authorized WhatsApp numbers.</small></div>
          <div className="pair-account-list" role="group" aria-label="Select WhatsApp account">
            {connections.filter(c => c.active).map(c =>
              <button type="button" key={c.id} aria-pressed={selected === c.id}
                className={"pair-account-option" + (selected === c.id ? " is-selected" : "")}
                onClick={() => switchConnection(c.id)}>
                <strong>{c.label}</strong><small>{statusLabel(c.status)}</small>
              </button>)}
            {!connections.some(c => c.active) && <p className="muted">
              No linked accounts available. Add one under Connected Accounts.
            </p>}
          </div>
        </div>
        <div className="byon-panel-heading">
          <div><div className="eyebrow">02 / LINK A DEVICE</div><h3>Connect to WhatsApp</h3></div>
          {selected && <span className={"byon-state" + (connected ? " is-online" : "")} role="status">
            {statusLabel(details?.connection.status ?? active?.status ?? "CREATED")}
          </span>}
        </div>
        {!selected ? <div className="byon-empty byon-setup-empty">
          <div className="byon-empty-icon" aria-hidden="true"><Icon name="link" size={26}/></div>
          <strong>Select a WhatsApp number</strong>
          <p>Select an account on the left or create a new connection to start.</p>
        </div> : <>
          <div className="byon-current">
            <span className="byon-current-icon" aria-hidden="true"><Icon name="phone" size={18}/></span>
            <div><strong>{active?.label ?? "Your WhatsApp account"}</strong>
              <small>{active?.kind === "PERSONAL" ? "Personal WhatsApp" : "WhatsApp Business App"}
                {active?.phoneLast4 ? " · ending " + active.phoneLast4 : ""}</small></div>
          </div>
          {!connected ? <>
            <p className="muted text-small">Choose the easiest linking method for your device. Pairing requires approval inside WhatsApp.</p>
            <div className="byon-method-switch" role="group" aria-label="How to link WhatsApp">
              <button type="button" aria-pressed={method === "qr"}
                className={method === "qr" ? "is-selected" : ""}
                onClick={() => setMethod("qr")}>QR code</button>
              <button type="button" aria-pressed={method === "code"}
                className={method === "code" ? "is-selected" : ""}
                onClick={() => setMethod("code")}>Phone pairing code</button>
            </div>
            {method === "code" && <label className="byon-field">Your WhatsApp number
              <input type="tel" inputMode="tel" autoComplete="tel"
                placeholder="e.g. 94771234567" value={phone}
                onChange={e => setPhone(e.target.value)}/>
              <small>Include the country code; no leading zero is needed.</small>
            </label>}
            <div className="byon-qr-stage">
              {method === "qr" && details?.qrDataUrl && (expiresIn === null || expiresIn > 0)
                ? <div className="byon-qr-frame"><img src={details.qrDataUrl} width={250} height={250}
                  alt="Scan this WhatsApp linked-device QR code with your phone"/></div>
                : method === "code" && details?.pairingCode && (expiresIn === null || expiresIn > 0)
                ? <div className="byon-code-stage"><div className="eyebrow">ONE-TIME PAIRING CODE</div>
                    <strong>{details.pairingCode}</strong>
                    <button type="button" className="text-button"
                      onClick={() => void copy(details.pairingCode!)}>Copy code</button>
                  </div>
                : <div className="byon-placeholder" aria-live="polite">
                    <span aria-hidden="true"><Icon name="qr" size={32}/></span>
                    <strong>{expiresIn === 0 ? "Pairing code expired" :
                      details?.connection.status === "PAIRING" ? "Preparing secure pairing…" :
                      "Ready to pair your WhatsApp"}</strong>
                    <small>{method === "qr" ? "Your QR code will appear here." :
                      "Your pairing code will appear here."}</small>
                  </div>}
              {expiresIn !== null && expiresIn > 0 && <p className="byon-expiry" role="timer">
                Refresh or pair within about {expiresIn} seconds
              </p>}
            </div>
            <button type="button" className="button primary byon-main-button"
              disabled={busy || !canPair} onClick={() => void startPair()}>
              {busy ? "Connecting…" : details?.qrDataUrl || details?.pairingCode ?
                "Generate a new code" : method === "qr" ? "Generate QR code" : "Request pairing code"}
            </button>
            <div className="byon-instructions">
              <h4>Finish linking on your phone</h4>
              <ol>
                <li>Open <strong>WhatsApp → Settings → Linked devices</strong>.</li>
                <li>Tap <strong>Link a device</strong>.</li>
                <li>{method === "qr" ? "Scan the QR code above using your phone." :
                  "Choose Link with phone number instead, then enter the code above."}</li>
              </ol>
            </div>
          </> : <>
            <div className="byon-connected" role="status"><span aria-hidden="true">✓</span>
              <div><strong>WhatsApp is connected</strong>
                <p>Your account is linked. Choose Translation groups or monitored groups for Smart Alerts separately.</p></div>
            </div>
            <div className="byon-next">
              <div className="eyebrow">03 / CHOOSE A SERVICE</div>
              <h3>Your WhatsApp account is ready</h3>
              <p className="muted text-small">Choose groups inside Translation or Smart Alerts. No code is needed when this number is a verified group administrator.</p>
              <div className="byon-service-links">
                <button className="button primary" type="button" onClick={onManageGroups}>Choose translation groups</button>
                <button className="button secondary" type="button" onClick={onManageAlerts}>Choose monitored groups</button>
              </div>
              <details className="byon-advanced">
                <summary>Advanced: Group-admin approval code</summary>
                <p className="muted text-small">If your connected number is not an administrator of a group, ask a verified group admin to approve outbound translation using a one-time command.</p>
              <div className={"byon-group-quota" + (groupsFull ? " is-full" : "")} role="status">
                <span>Plan group slots</span>
                <strong>{groupSlotsUsed} / {groupSlotsLimit}</strong>
                {groupsFull && <p>All group slots are in use. Your existing group remains connected. Open My Groups to manage it. Platform Admin can increase your plan group allowance for new groups.</p>}
              </div>
              <button type="button" className="button secondary" disabled={groupLoading}
                onClick={() => void discover()}>{groupLoading ? "Loading groups…" : "View joined groups"}</button>
              {groupListLoaded && <div className="byon-group-list">
                {groups.length ? groups.map(g => <div key={g.groupId} className="byon-group-item">
                  <span aria-hidden="true"><Icon name="groups" size={16}/></span><span>{g.name}</span>
                  {g.activated && <span className="byon-group-activated">✓ {g.enabled ? "Activated" : "Paused"}</span>}
                </div>) : <p className="muted text-small">No groups found. Add this account to a WhatsApp group first.</p>}
              </div>}
              {!groupsFull && <label className="byon-check"><input type="checkbox" checked={groupConsent}
                onChange={e => setGroupConsent(e.target.checked)}/>
                <span>I manage the group and its participants know messages will be translated with external AI services.</span>
              </label>}
              {!groupsFull && <button type="button" className="button primary byon-main-button"
                disabled={!groupConsent || busy} onClick={() => void activate()}>
                {busy ? "Preparing…" : "Generate group activation code"}
              </button>}
              {activation && <div className="byon-activation">
                <div className="eyebrow">SEND IN YOUR WHATSAPP GROUP</div>
                <div className="byon-activation-command"><code>/wbot connect {activation.code}</code>
                  <button type="button" className="button secondary"
                    onClick={() => void copy("/wbot connect " + activation.code)}>Copy</button></div>
                <p>Ask a group admin to send this command. It expires at {new Date(activation.expiresAt).toLocaleTimeString()}.</p>
                <button className="button secondary" type="button" onClick={onManageGroups}>
                  View activated groups
                </button>
              </div>}
              <button type="button" className="text-button byon-manage-link"
                onClick={onManageGroups}>Manage translation groups</button>
              </details>
            </div>
          </>}
          <div className="byon-footer-actions">
            <button type="button" className="text-button danger-action" disabled={busy}
              onClick={() => setConfirmRevoke(selected)}>Permanently remove this WhatsApp account</button>
          </div>
        </>}
      </section>
    </div>
    {confirmRevoke && <div className="modal-backdrop">
      <section className="modal-panel" role="alertdialog" aria-modal="true" aria-labelledby="byon-revoke-title">
        <h2 id="byon-revoke-title">Permanently remove WhatsApp connection?</h2>
        <p className="muted">This unlinks the device and permanently deletes this connection, its activated group configurations and their stored translation history. Other numbers and shared-bot groups are unaffected. This cannot be undone.</p>
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={() => setConfirmRevoke(null)} disabled={busy}>Keep connected</button>
          <button type="button" className="button primary" onClick={() => void revoke()} disabled={busy}>{busy ? "Removing…" : "Remove permanently"}</button>
        </div>
      </section>
    </div>}
  </div>;
}
