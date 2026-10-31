import React, { useCallback, useEffect, useState } from "react";

type Kind = "PERSONAL" | "BUSINESS";
type Connection = {
  id: string; label: string; kind: Kind; status: string;
  phoneLast4: string | null; createdAt: string; _count?: { groups: number }
};
type Policy = {
  enabled: boolean; personalEnabled: boolean; businessEnabled: boolean; maxConnections: number
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
    headers: method === "GET" ? {} : { "Content-Type": "application/json", "X-WBot-Request": "1" },
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

export function ByonConnections({ onManageGroups }: { onManageGroups?: () => void }) {
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
  const [groups, setGroups] = useState<Array<{ groupId: string; name: string }>>([]);
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
      current : result.connections[0]?.id ?? null);
  }, []);
  useEffect(() => { void refresh().catch(e => setError(String(e))); }, [refresh]);
  useEffect(() => {
    if (!selected) { setDetails(null); return; }
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
  }, [selected, refresh]);

  const active = connections.find(c => c.id === selected);
  const connected = (details?.connection.status ?? active?.status) === "CONNECTED";
  const canCreate = Boolean(policy?.enabled &&
    connections.length < (policy?.maxConnections ?? 0));
  const canPair = Boolean(policy?.enabled && active &&
    (active.kind === "PERSONAL" ? policy.personalEnabled : policy.businessEnabled));
  const expiresIn = details?.pairExpiresAt ?
    Math.max(0, Math.ceil((details.pairExpiresAt - timeNow) / 1000)) : null;

  function switchConnection(id: string) {
    setSelected(id); setDetails(null); setGroups([]); setGroupListLoaded(false);
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
      const data = await request<{ groups: Array<{ groupId: string; name: string }> }>(
        "/connections/" + encodeURIComponent(selected) + "/groups"
      );
      setGroups(data.groups); setGroupListLoaded(true);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load joined groups"); }
    finally { setGroupLoading(false); }
  }
  async function activate() {
    if (!selected || !groupConsent) return;
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
    setBusy(true); setError("");
    try {
      await request("/connections/" + encodeURIComponent(confirmRevoke), "DELETE");
      setConfirmRevoke(null); setSelected(null); setDetails(null);
      setGroups([]); setActivation(null); setGroupListLoaded(false);
      await refresh();
      setNotice("Account disconnected. Groups using this number have been paused.");
    } catch (e) { setError(e instanceof Error ? e.message : "Disconnect failed"); }
    finally { setBusy(false); }
  }

  return <div className="byon-shell">
    {notice && <div className="alert success" role="status">{notice}</div>}
    {error && <div className="alert error" role="alert">{error}</div>}
    {!policy?.enabled && <div className="byon-notice" role="status">
      <span aria-hidden="true">◈</span> Customer-owned numbers are currently disabled by Platform Admin.
      Existing shared W-Bot groups are unaffected.
    </div>}
    <div className="byon-progress" aria-label="Connection setup steps">
      {["Choose a number","Link WhatsApp","Activate a group"].map((name, index) => {
        const done = index === 0 ? Boolean(selected) : index === 1 ? connected : Boolean(activation);
        return <div className={"byon-progress-step" + (done ? " is-complete" : "")} key={name}>
          <span className="byon-progress-number">{done ? "✓" : index + 1}</span>
          <span>{name}</span>
        </div>;
      })}
    </div>
    <div className="byon-layout">
      <section className="panel byon-numbers-panel" aria-label="Your WhatsApp connections">
        <div className="byon-panel-heading">
          <div><div className="eyebrow">01 / YOUR NUMBERS</div><h3>Connected accounts</h3></div>
          <span className="byon-count">{connections.length} / {policy?.maxConnections ?? 1}</span>
        </div>
        <p className="muted text-small">Choose an existing account or link a number you control. A dedicated WhatsApp number is recommended.</p>
        <div className="byon-number-list">
          {connections.map(c => <button key={c.id} type="button"
            className={"byon-number-item" + (selected === c.id ? " is-active" : "")}
            aria-pressed={selected === c.id} onClick={() => switchConnection(c.id)}>
            <span className="byon-number-icon" aria-hidden="true">☎</span>
            <span className="byon-number-info"><strong>{c.label}</strong>
              <small>{c.kind === "PERSONAL" ? "Personal" : "WhatsApp Business App"}{c.phoneLast4 ? " · ••••" + c.phoneLast4 : ""}</small>
            </span>
            <span className={"byon-state" + (c.status === "CONNECTED" ? " is-online" : "")}>
              {statusLabel(c.status)}
            </span>
          </button>)}
          {!connections.length && <div className="byon-empty">
            <div className="byon-empty-icon" aria-hidden="true">♧</div>
            <strong>No WhatsApp account added</strong>
            <p>Start by creating a connection. Your phone will authorize access in the next step.</p>
          </div>}
        </div>
        {canCreate && <button type="button" className="button secondary byon-add-button"
          aria-expanded={showCreate} onClick={() => setShowCreate(value => !value)}>
          {showCreate ? "Cancel adding number" : "+ Add WhatsApp number"}
        </button>}
        {canCreate && (showCreate || connections.length === 0) &&
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

      <section className="panel byon-setup-panel" aria-label="Pair WhatsApp account">
        <div className="byon-panel-heading">
          <div><div className="eyebrow">02 / LINK A DEVICE</div><h3>Connect to WhatsApp</h3></div>
          {selected && <span className={"byon-state" + (connected ? " is-online" : "")} role="status">
            {statusLabel(details?.connection.status ?? active?.status ?? "CREATED")}
          </span>}
        </div>
        {!selected ? <div className="byon-empty byon-setup-empty">
          <div className="byon-empty-icon" aria-hidden="true">⌁</div>
          <strong>Select a WhatsApp number</strong>
          <p>Select an account on the left or create a new connection to start.</p>
        </div> : <>
          <div className="byon-current">
            <span className="byon-current-icon" aria-hidden="true">◉</span>
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
                    <span aria-hidden="true">⌗</span>
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
                <p>W-Bot can now translate messages in groups you explicitly activate.</p></div>
            </div>
            <div className="byon-next">
              <div className="eyebrow">03 / ACTIVATE A GROUP</div>
              <h3>Choose your translation groups</h3>
              <p className="muted text-small">Discover the WhatsApp groups this account has joined. Each group needs an activation command from a group administrator.</p>
              <button type="button" className="button secondary" disabled={groupLoading}
                onClick={() => void discover()}>{groupLoading ? "Loading groups…" : "View joined groups"}</button>
              {groupListLoaded && <div className="byon-group-list">
                {groups.length ? groups.map(g => <div key={g.groupId} className="byon-group-item">
                  <span aria-hidden="true">♧</span><span>{g.name}</span>
                </div>) : <p className="muted text-small">No groups found. Add this account to a WhatsApp group first.</p>}
              </div>}
              <label className="byon-check"><input type="checkbox" checked={groupConsent}
                onChange={e => setGroupConsent(e.target.checked)}/>
                <span>I manage the group and its participants know messages will be translated with external AI services.</span>
              </label>
              <button type="button" className="button primary byon-main-button"
                disabled={!groupConsent || busy} onClick={() => void activate()}>
                {busy ? "Preparing…" : "Generate group activation code"}
              </button>
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
              {!activation && <button type="button" className="text-button byon-manage-link"
                onClick={onManageGroups}>View my activated groups →</button>}
            </div>
          </>}
          <div className="byon-footer-actions">
            <button type="button" className="text-button danger-action" disabled={busy}
              onClick={() => setConfirmRevoke(selected)}>Disconnect this WhatsApp account</button>
          </div>
        </>}
      </section>
    </div>
    {confirmRevoke && <div className="modal-backdrop">
      <section className="modal-panel" role="alertdialog" aria-modal="true" aria-labelledby="byon-revoke-title">
        <h2 id="byon-revoke-title">Disconnect WhatsApp account?</h2>
        <p className="muted">W-Bot will unlink this account and pause its active translation groups. This cannot be undone without pairing again.</p>
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={() => setConfirmRevoke(null)} disabled={busy}>Keep connected</button>
          <button type="button" className="button primary" onClick={() => void revoke()} disabled={busy}>Disconnect account</button>
        </div>
      </section>
    </div>}
  </div>;
}
