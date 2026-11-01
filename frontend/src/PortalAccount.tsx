import React, { useEffect, useState } from "react";

export async function portalRequest<T>(path: string, data?: unknown, method = "POST"): Promise<T> {
  const response = await fetch("/portal/api" + path, {
    method, credentials: "same-origin", cache: "no-store",
    headers: { "Content-Type": "application/json", "X-WBot-Request": "1" },
    body: data === undefined ? undefined : JSON.stringify(data)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(
    typeof result.error === "string" ? result.error : "Request failed"
  );
  return result as T;
}

export function PublicRecovery(props: { onReturn: () => void }) {
  const params = new URLSearchParams(window.location.search);
  const action = params.get("action") === "verify" ? "verify" : "reset";
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      if (action === "verify") {
        await portalRequest("/auth/verify-email", { token });
        setMessage("Email verified successfully. You can sign in now.");
      } else {
        await portalRequest("/auth/reset-password", { token, password });
        setMessage("Your password has been changed. Sign in with the new password.");
      }
      window.history.replaceState({}, "", "/portal/");
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to complete request"); }
    finally { setBusy(false); }
  }
  return <main className="account-screen">
    <section className="panel account-card">
      <div className="brand"><span className="brand-mark">W</span><span>W-Bot</span></div>
      <div className="eyebrow">ACCOUNT SECURITY</div>
      <h1>{action === "verify" ? "Verify your email" : "Reset your password"}</h1>
      {error && <div className="alert error" role="alert">{error}</div>}
      {message ? <div className="alert success" role="status">{message}</div> :
      <form className="form" onSubmit={e => void submit(e)}>
        {action === "reset" && <label>New password
          <input type="password" minLength={12} maxLength={128} autoComplete="new-password"
            required value={password} onChange={e => setPassword(e.target.value)} />
        </label>}
        <button className="button primary" type="submit" disabled={busy || !/^[a-f0-9]{64}$/.test(token)}>
          {busy ? "Processing…" : action === "verify" ? "Verify email" : "Save new password"}
        </button>
      </form>}
      <button className="text-button" onClick={props.onReturn}>Back to sign in</button>
    </section>
  </main>;
}

export function AccountSettings(props: {
  me: {
    user: { name: string; email: string; emailVerified?: boolean };
    workspace: { name: string; role: string };
  };
  onRefresh: () => Promise<void>;
  onLogout: () => Promise<void>;
}) {
  const [name, setName] = useState(props.me.user.name);
  const [workspace, setWorkspace] = useState(props.me.workspace.name);
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function action(path: string, body: unknown, success: string) {
    setBusy(true); setError(""); setMessage("");
    try {
      await portalRequest(path, body, path === "/profile" ? "PATCH" : "POST");
      await props.onRefresh();
      setMessage(success);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to save"); }
    finally { setBusy(false); }
  }
  return <div className="account-grid">
    {error && <div className="alert error" role="alert">{error}</div>}
    {message && <div className="alert success" role="status">{message}</div>}
    <section className="panel">
      <div className="eyebrow">PERSONAL DETAILS</div>
      <h3>Your profile</h3>
      <form className="form" onSubmit={e => {
          e.preventDefault();
          void action("/profile", props.me.workspace.role === "VIEWER" ? { name } : { name, workspace }, "Profile updated");
        }}>
        <label>Display name<input value={name} minLength={2} maxLength={100} onChange={e => setName(e.target.value)} required /></label>
        <label>Workspace name<input value={workspace} minLength={2} maxLength={191}
          onChange={e => setWorkspace(e.target.value)} disabled={props.me.workspace.role === "VIEWER"} required /></label>
        <label>Email address<input readOnly value={props.me.user.email} /></label>
        <p className="muted text-small">Email: {props.me.user.emailVerified ? "Verified" : "Not verified"}</p>
        {!props.me.user.emailVerified && <button type="button" className="button secondary" disabled={busy}
          onClick={() => void action("/auth/resend-verification", {}, "Verification email requested")}>Resend verification email</button>}
        <button className="button primary" type="submit" disabled={busy}>Save profile</button>
      </form>
    </section>
    <section className="panel">
      <div className="eyebrow">LOGIN SECURITY</div>
      <h3>Change password</h3>
      <form className="form" onSubmit={e => {
        e.preventDefault();
        void (async () => {
          setBusy(true); setError("");
          try {
            await portalRequest("/auth/change-password", { currentPassword: oldPassword, newPassword });
            await props.onLogout();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Password change failed");
          } finally { setBusy(false); }
        })();
      }}>
        <label>Current password<input type="password" autoComplete="current-password" required
          value={oldPassword} onChange={e => setOldPassword(e.target.value)}/></label>
        <label>New password (12+ characters)<input type="password" autoComplete="new-password"
          required minLength={12} maxLength={128} value={newPassword}
          onChange={e => setNewPassword(e.target.value)}/></label>
        <button className="button secondary" type="submit" disabled={busy}>Change password & sign out</button>
      </form>
      <p className="muted text-small">Changing your password revokes all active sessions.</p>
    </section>
  </div>;
}

type Audit = { id: string; action: string; groupId: string | null; createdAt: string };
type Activation = { id: string; expiresAt: string; consumedAt: string | null;
  activatedGroupId: string | null; createdAt: string };
type Plan = { plan: string; status: string; groups: number; whatsappConnections: number;
  billingInterval: "MONTHLY" | "YEARLY"; unlimitedTextTranslations: boolean; periodEnd: string | null };
type Price = { code: string; name: string; monthlyCents: number; yearlyCents: number;
  whatsappConnections: number; groups: number };

export function WorkspaceActivity() {
  const [audits, setAudits] = useState<Audit[]>([]);
  const [activations, setActivations] = useState<Activation[]>([]);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [pricing, setPricing] = useState<Price[]>([]);
  const [gateway, setGateway] = useState("CHECKING");
  const [error, setError] = useState("");
  useEffect(() => {
    let mounted = true;
    void Promise.all([
      portalRequest<{ events: Audit[] }>("/audit", undefined, "GET"),
      portalRequest<{ activations: Activation[] }>("/activations", undefined, "GET"),
      portalRequest<{ subscription: Plan }>("/subscription", undefined, "GET"),
      portalRequest<{ status: string }>("/connection", undefined, "GET"),
      portalRequest<{ plans: Price[] }>("/plans", undefined, "GET")
    ]).then(([auditsData, activationsData, subscriptionData, connectionData, catalogData]) => {
      if (!mounted) return;
      setAudits(auditsData.events);
      setActivations(activationsData.activations);
      setPlan(subscriptionData.subscription);
      setPricing(catalogData.plans);
      setGateway(connectionData.status);
    }).catch(err => { if (mounted) setError(err instanceof Error ? err.message : "Unable to load activity"); });
    return () => { mounted = false; };
  }, []);
  return <div className="account-grid">
    {error && <div className="alert error">{error}</div>}
    <section className="panel"><div className="eyebrow">CONNECTION & SUBSCRIPTION</div>
      <h3>Service status</h3>
      <div className="detail"><span>Shared WhatsApp gateway</span><strong>{gateway}</strong></div>
      <div className="detail"><span>Subscription</span><strong>{plan?.plan ?? "Loading"}</strong></div>
      <div className="detail"><span>Status</span><strong>{plan?.status ?? "Loading"}</strong></div>
      <div className="detail"><span>Registered groups</span><strong>{plan?.groups ?? "—"}</strong></div>
       <div className="detail"><span>WhatsApp numbers</span><strong>{plan ? (plan.whatsappConnections === 0 ? "Unlimited pilot" : plan.whatsappConnections) : "—"}</strong></div>
       <div className="detail"><span>Billing interval</span><strong>{plan?.billingInterval === "YEARLY" ? "Yearly" : "Monthly"}</strong></div>
      <div className="detail"><span>Text translations</span><strong>Unlimited</strong></div>
      <p className="muted text-small">Published prices are for reference. No payment checkout is enabled; subscriptions are assigned by platform administrators.</p>
       <div className="wbot-price-catalog">{pricing.map(tier =>
         <div key={tier.code} className={"wbot-price-row" + (plan?.plan === tier.code ? " is-selected" : "")}>
           <div><strong>{tier.name}</strong><small>{tier.whatsappConnections} numbers · {tier.groups} groups · Unlimited text</small></div>
           <div><strong>${(tier.monthlyCents / 100).toFixed(0)}/mo</strong>
             <small>${(tier.yearlyCents / 100).toLocaleString("en-US")}/yr</small></div>
         </div>)}</div>
    </section>
    <section className="panel"><div className="eyebrow">SECURITY HISTORY</div>
      <h3>Recent workspace activity</h3>
      {audits.length ? audits.map(e => <div className="activity-line" key={e.id}>
        <div className="activity-dot"/><div><strong>{e.action.replaceAll("_", " ")}</strong>
        <small>{new Date(e.createdAt).toLocaleString()}</small></div>
      </div>) : <p className="muted">No recorded changes yet.</p>}
    </section>
    <section className="panel"><div className="eyebrow">GROUP ONBOARDING</div>
      <h3>Activation history</h3>
      {activations.length ? activations.map(e => <div className="activity-line" key={e.id}>
        <div className="activity-dot"/><div><strong>{e.consumedAt ? "Activated" : new Date(e.expiresAt) <= new Date() ? "Expired" : "Waiting for group admin"}</strong>
        <small>{new Date(e.createdAt).toLocaleString()}</small></div>
      </div>) : <p className="muted">No activation requests yet.</p>}
    </section>
  </div>;
}
