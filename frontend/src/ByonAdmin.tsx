import React, { useEffect, useState } from "react";

type Policy = {
  customerNumbersEnabled: boolean; personalEnabled: boolean; businessEnabled: boolean;
  maxConnectionsPerTenant: number
};
type Connected = {
  id: string; label: string; kind: "PERSONAL" | "BUSINESS";
  status: string; active: boolean; phoneLast4: string | null;
  lastSeenAt: string | null; tenant: { name: string };
  _count: { groups: number }
};
async function api<T>(route: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch("/portal/api/platform" + route, {
    method, credentials: "same-origin", cache: "no-store",
    headers: method === "GET" ? {} : {
      "content-type": "application/json", "X-WBot-Request": "1"
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(data.error || "Platform connection request failed");
  return data as T;
}
export function ByonAdmin({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const [settings, setSettings] = useState<Policy>({
    customerNumbersEnabled: false, personalEnabled: true,
    businessEnabled: true, maxConnectionsPerTenant: 0
  });
  const [configured, setConfigured] = useState(false);
  const [connections, setConnections] = useState<Connected[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  async function refresh() {
    const [policy, items] = await Promise.all([
      api<{ policy: Policy; gatewayConfigured: boolean }>("/whatsapp-policy"),
      api<{ connections: Connected[] }>("/whatsapp-connections")
    ]);
    setSettings({
      customerNumbersEnabled: policy.policy.customerNumbersEnabled,
      personalEnabled: policy.policy.personalEnabled,
      businessEnabled: policy.policy.businessEnabled,
      maxConnectionsPerTenant: policy.policy.maxConnectionsPerTenant
    });
    setConfigured(policy.gatewayConfigured); setConnections(items.connections);
  }
  useEffect(() => { void refresh().catch(e => setError(String(e))); }, []);
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      await api("/whatsapp-policy", "PATCH", settings);
      await refresh();
      setNotice("Customer WhatsApp number policy saved and audited.");
    } catch (e) { setError(e instanceof Error ? e.message : "Save failed"); }
    finally { setBusy(false); }
  }
  return <div className="two-column byon-admin-layout">
    {error && <div className="alert error" role="alert">{error}</div>}
    {notice && <div className="alert success" role="status">{notice}</div>}
    <section className="panel">
      <div className="eyebrow">PLATFORM POLICY</div>
      <h3>Customer WhatsApp numbers</h3>
      <p className="muted">Control personal and dedicated business numbers independently. Disabling a type blocks new pairing, incoming processing and outbound translations without deleting customer credentials.</p>
      <div className="detail"><span>Isolated Baileys gateway</span>
        <strong>{configured ? "Configured" : "Not configured"}</strong></div>
      <form className="form" onSubmit={e => void save(e)}>
        <label className="consent-row"><input type="checkbox" checked={settings.customerNumbersEnabled}
          disabled={!isSuperAdmin || !configured}
          onChange={e => setSettings({ ...settings, customerNumbersEnabled: e.target.checked })}/>
          <span>Enable customer-owned WhatsApp connections</span></label>
        <label className="consent-row"><input type="checkbox" checked={settings.personalEnabled}
          disabled={!isSuperAdmin}
          onChange={e => setSettings({ ...settings, personalEnabled: e.target.checked })}/>
          <span>Allow personal WhatsApp accounts</span></label>
        <label className="consent-row"><input type="checkbox" checked={settings.businessEnabled}
          disabled={!isSuperAdmin}
          onChange={e => setSettings({ ...settings, businessEnabled: e.target.checked })}/>
          <span>Allow dedicated business WhatsApp accounts</span></label>
        <label>Global maximum connections per workspace (0 = unlimited)
          <input type="number" min={0} max={1000} value={settings.maxConnectionsPerTenant}
            disabled={!isSuperAdmin}
            onChange={e => setSettings({ ...settings, maxConnectionsPerTenant: Number(e.target.value) })}/></label>
        <p className="muted text-small">0 means unlimited for this pilot, subject to the BYON gateway's configured session capacity. Workspace-specific number limits can be set under Customers → Manage plan.</p>
        {isSuperAdmin && <button className="button primary" type="submit" disabled={busy}>
          Save platform policy</button>}
      </form>
      <p className="muted text-small">These are unofficial WhatsApp Web linked devices, not official Meta group integrations. Do not enable for public commercial use without reviewing the risks and consent requirements.</p>
    </section>
    <section className="panel">
      <div className="eyebrow">CONNECTION MONITOR</div>
      <h3>Customer-linked accounts ({connections.length})</h3>
      <div className="platform-table-scroll"><table className="platform-table">
        <thead><tr><th>Workspace</th><th>Connection</th><th>Type</th><th>Status</th><th>Groups</th></tr></thead>
        <tbody>{connections.map(c => <tr key={c.id}>
          <td data-label="Workspace">{c.tenant.name}</td>
          <td data-label="Connection">{c.label}<small>{c.phoneLast4 ? "••••"+c.phoneLast4 : "Unpaired"}</small></td>
          <td data-label="Type">{c.kind}</td>
          <td data-label="Status">{c.active ? c.status : "REVOKED"}</td>
          <td data-label="Groups">{c._count.groups}</td>
        </tr>)}</tbody>
      </table></div>
      {!connections.length && <p className="muted">No customers have linked a number yet.</p>}
      <button className="button secondary" type="button" onClick={() =>
        void refresh().catch(e => setError(String(e)))}>Refresh connections</button>
    </section>
  </div>;
}
