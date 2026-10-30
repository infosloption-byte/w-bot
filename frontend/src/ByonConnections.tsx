import React, { useCallback, useEffect, useState } from "react";

type Kind = "PERSONAL" | "BUSINESS";
type Connection = {
  id: string; label: string; kind: Kind; status: string;
  phoneLast4: string | null; createdAt: string;
  _count?: { groups: number }
};
type Policy = {
  enabled: boolean; personalEnabled: boolean; businessEnabled: boolean;
  maxConnections: number
};
type Details = {
  connection: Connection; pairingCode: string | null; qrDataUrl: string | null
};
async function request<T>(url: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch("/portal/api" + url, {
    method, cache: "no-store", credentials: "same-origin",
    headers: method === "GET" ? {} : {
      "content-type": "application/json", "X-WBot-Request": "1"
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(
    typeof result.error === "string" ? result.error : "Connection request failed"
  );
  return result as T;
}

export function ByonConnections() {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [details, setDetails] = useState<Details | null>(null);
  const [kind, setKind] = useState<Kind>("BUSINESS");
  const [label, setLabel] = useState("");
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [groupConsent, setGroupConsent] = useState(false);
  const [groups, setGroups] = useState<Array<{ groupId: string; name: string }>>([]);
  const [activation, setActivation] = useState<{ code: string; expiresAt: string } | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const result = await request<{ policy: Policy; connections: Connection[] }>("/connections");
    setPolicy(result.policy); setConnections(result.connections);
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
          if (result.connection.status === "CONNECTED") void refresh();
        }
      } catch { if (!cancelled) setDetails(null); }
    };
    void poll();
    const timer = window.setInterval(() => { void poll(); }, 5000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [selected, refresh]);

  async function create(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const r = await request<{ connection: Connection }>("/connections", "POST", {
        kind, label: label.trim(), consentConfirmed: consent
      });
      setSelected(r.connection.id); setLabel("");
      await refresh(); setNotice("Connection created. Scan its QR code or request a pairing code.");
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to create connection"); }
    finally { setBusy(false); }
  }
  async function startPair() {
    if (!selected) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const cleaned = phone.trim().replace(/[\s()+-]/g, "");
      if (cleaned && !/^[1-9][0-9]{7,14}$/.test(cleaned))
        throw Error("Use an international phone number with country code, without leading zero.");
      await request("/connections/" + encodeURIComponent(selected) + "/pair", "POST",
        cleaned ? { phoneNumber: cleaned } : {});
      setNotice("Pairing started. Open WhatsApp → Linked devices and approve the connection.");
    } catch (e) { setError(e instanceof Error ? e.message : "Pairing failed"); }
    finally { setBusy(false); }
  }
  async function discover() {
    if (!selected) return;
    setBusy(true); setError("");
    try {
      const data = await request<{ groups: Array<{ groupId: string; name: string }> }>(
        "/connections/" + encodeURIComponent(selected) + "/groups"
      );
      setGroups(data.groups);
    } catch (e) { setError(e instanceof Error ? e.message : "Groups unavailable"); }
    finally { setBusy(false); }
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
      setNotice("A WhatsApp group admin must send the activation command in the group.");
    } catch (e) { setError(e instanceof Error ? e.message : "Activation unavailable"); }
    finally { setBusy(false); }
  }
  async function revoke() {
    if (!confirmRevoke) return;
    setBusy(true); setError("");
    try {
      await request("/connections/" + encodeURIComponent(confirmRevoke), "DELETE");
      setSelected(null); setDetails(null); setGroups([]); setActivation(null);
      setConfirmRevoke(null); await refresh();
      setNotice("WhatsApp account disconnected from W-Bot. Associated groups were paused.");
    } catch (e) { setError(e instanceof Error ? e.message : "Disconnect failed"); }
    finally { setBusy(false); }
  }

  return <div className="connection-workspace">
    {error && <div className="alert error" role="alert">{error}</div>}
    {notice && <div className="alert success" role="status">{notice}</div>}
    <div className="two-column">
      <section className="panel">
        <div className="eyebrow">CUSTOMER-OWNED NUMBER</div>
        <h3>WhatsApp connections</h3>
        <p className="muted">Connect a number you control. W-Bot operates as a linked device and can access messages through that WhatsApp session. A dedicated number is strongly recommended.</p>
        {!policy?.enabled && <p className="alert" role="status">Customer-owned connections are not enabled yet by Platform Admin. The shared W-Bot option remains available.</p>}
        {connections.map(c => <button key={c.id} type="button"
          className={"connection-choice" + (selected === c.id ? " active" : "")}
          onClick={() => { setSelected(c.id); setGroups([]); setActivation(null); }}>
          <strong>{c.label}</strong><span>{c.kind === "PERSONAL" ? "Personal" : "Dedicated business"} · {c.status}
            {c.phoneLast4 ? " · ••••" + c.phoneLast4 : ""}</span>
        </button>)}
        {policy?.enabled && connections.length < policy.maxConnections &&
        <form className="form" onSubmit={e => void create(e)}>
          <div className="eyebrow">ADD CONNECTION</div>
          <div className="language-chips">
            <button type="button" className={"chip" + (kind === "BUSINESS" ? " selected" : "")}
              disabled={!policy.businessEnabled} aria-pressed={kind === "BUSINESS"}
              onClick={() => setKind("BUSINESS")}>Dedicated business number</button>
            <button type="button" className={"chip" + (kind === "PERSONAL" ? " selected" : "")}
              disabled={!policy.personalEnabled} aria-pressed={kind === "PERSONAL"}
              onClick={() => setKind("PERSONAL")}>Personal number</button>
          </div>
          <label>Connection label<input required minLength={2} maxLength={100} value={label}
            placeholder="e.g. School WhatsApp" onChange={e => setLabel(e.target.value)}/></label>
          <label className="consent-row"><input type="checkbox" checked={consent}
            onChange={e => setConsent(e.target.checked)} required/>
            <span>I control this WhatsApp account and understand that linking grants W-Bot device-level access to messages, including those outside selected groups. I have informed relevant participants.</span>
          </label>
          <button className="button primary" disabled={busy || !consent ||
              (kind === "PERSONAL" ? !policy.personalEnabled : !policy.businessEnabled)}>
            Create connection</button>
        </form>}
      </section>
      <section className="panel">
        <div className="eyebrow">LINKED-DEVICE SETUP</div>
        <h3>Pair your WhatsApp</h3>
        {!selected ? <p className="muted">Select or create a connection to begin.</p> : <>
          <p className="muted text-small">Current status: <strong>{details?.connection.status || "CHECKING"}</strong></p>
          {details?.connection.status !== "CONNECTED" && <>
            <label>Phone number for pairing code (optional)
              <input type="tel" inputMode="tel" autoComplete="tel"
                placeholder="Country code + phone number" value={phone}
                onChange={e => setPhone(e.target.value)}/>
            </label>
            <button className="button primary" disabled={busy || !policy?.enabled}
              onClick={() => void startPair()}>
              {phone.trim() ? "Request pairing code" : "Generate QR code"}</button>
            {details?.qrDataUrl && <div className="connection-qr">
              <img src={details.qrDataUrl} width={250} height={250} alt="WhatsApp linked device pairing QR code"/>
            </div>}
            {details?.pairingCode && <div className="connection-pair-code">
              <span>One-time WhatsApp pairing code</span><strong>{details.pairingCode}</strong>
            </div>}
            <p className="muted text-small">On your phone: WhatsApp → Linked devices → Link a device. Scan the QR, or choose linking by phone number. Pairing codes are temporary and should never be shared.</p>
          </>}
          {details?.connection.status === "CONNECTED" && <>
            <p className="alert success">WhatsApp account connected. Group translations use this number's own identity.</p>
            <button className="button secondary" disabled={busy} onClick={() => void discover()}>
              Show joined groups</button>
            {groups.length > 0 && <div className="connection-group-list">
              {groups.map(g => <div key={g.groupId}>{g.name}</div>)}
            </div>}
            <label className="consent-row"><input type="checkbox" checked={groupConsent}
              onChange={e => setGroupConsent(e.target.checked)}/>
              <span>The group administrator and participants have been informed of third-party translation processing.</span>
            </label>
            <button className="button primary" disabled={!groupConsent || busy}
              onClick={() => void activate()}>Create group activation code</button>
            {activation && <div className="connection-activation">
              <p>Ask a group admin to send this message inside their group:</p>
              <code>/wbot connect {activation.code}</code>
              <p className="muted text-small">Expires {new Date(activation.expiresAt).toLocaleString()}.</p>
            </div>}
          </>}
          <button type="button" className="text-button danger-action"
            disabled={busy} onClick={() => setConfirmRevoke(selected)}>
            Disconnect this WhatsApp number</button>
        </>}
      </section>
    </div>
    {confirmRevoke && <div className="modal-backdrop" role="presentation">
      <section className="modal-panel" role="alertdialog" aria-modal="true" aria-labelledby="revoke-title">
        <h2 id="revoke-title">Disconnect WhatsApp number?</h2>
        <p className="muted">This revokes W-Bot's linked device and pauses all groups using this connection. Existing messages remain subject to your retention settings.</p>
        <div className="modal-actions">
          <button className="button secondary" disabled={busy} onClick={() => setConfirmRevoke(null)}>Cancel</button>
          <button className="button danger-button" disabled={busy} onClick={() => void revoke()}>Disconnect number</button>
        </div>
      </section>
    </div>}
  </div>;
}
