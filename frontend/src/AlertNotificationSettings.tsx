import React, { useEffect, useState } from "react";
import { portalRequest } from "./PortalAccount.js";
import "./alerts-inbox.css";

type Connection = {id:string;label:string;active:boolean;status:string};
type Group = {groupId:string;name:string};
type Channel = {connectionId:string;groupId:string;groupName:string;enabled:boolean};
export function AlertNotificationSettings() {
  const [connections,setConnections] = useState<Connection[]>([]);
  const [connectionId,setConnectionId] = useState("");
  const [groups,setGroups] = useState<Group[]>([]);
  const [groupId,setGroupId] = useState("");
  const [channel,setChannel] = useState<Channel|null>(null);
  const [consent,setConsent] = useState(false);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const [message,setMessage] = useState("");
  const [loadingGroups,setLoadingGroups] = useState(false);

  async function refresh() {
    const [conn,ch] = await Promise.all([
      portalRequest<{connections:Connection[]}>("/connections",undefined,"GET"),
      portalRequest<{channel:Channel|null}>("/alerts/notification-channel",undefined,"GET")
    ]);
    const active=conn.connections.filter(c=>c.active&&c.status==="CONNECTED");
    setConnections(active);setChannel(ch.channel);
    setConnectionId(current=>active.some(c=>c.id===current)?current:
      (active.some(c=>c.id===ch.channel?.connectionId)?ch.channel!.connectionId:active[0]?.id??""));
  }
  useEffect(()=>{void refresh().catch(e=>setError(e instanceof Error?e.message:"Could not load notifications"));},[]);
  useEffect(()=>{
    if(!connectionId){setGroups([]);setGroupId("");return;}
    let active=true;setLoadingGroups(true);
    void portalRequest<{groups:Group[]}>("/connections/"+encodeURIComponent(connectionId)+"/groups",
      undefined,"GET").then(r=>{
        if(!active)return;
        setGroups(r.groups);
        setGroupId(current=>r.groups.some(g=>g.groupId===current)?current:
          (connectionId===channel?.connectionId?channel.groupId:""));
      }).catch(e=>{if(active)setError(e instanceof Error?e.message:"Cannot list groups");})
        .finally(()=>{if(active)setLoadingGroups(false);});
    return ()=>{active=false;};
  },[connectionId,channel?.connectionId,channel?.groupId]);
  async function save(e:React.FormEvent){
    e.preventDefault();if(!consent||!connectionId||!groupId)return;
    setBusy(true);setError("");setMessage("");
    try{
      await portalRequest("/alerts/notification-channel",{
        connectionId,groupId,consentConfirmed:true
      },"PUT");
      await refresh();setConsent(false);
      setMessage("WhatsApp notifications enabled for new matches. Existing inbox alerts were not reposted.");
    }catch(cause){setError(cause instanceof Error?cause.message:"Unable to enable notifications");}
    finally{setBusy(false);}
  }
  async function disable(){
    setBusy(true);setError("");setMessage("");
    try{
      await portalRequest("/alerts/notification-channel",undefined,"DELETE");
      await refresh();setMessage("WhatsApp alert notifications disabled. The private inbox remains available.");
    }catch(cause){setError(cause instanceof Error?cause.message:"Unable to disable notifications");}
    finally{setBusy(false);}
  }

  return <section className="panel alert-notification-settings">
    <div className="panel-heading">
      <div><div className="eyebrow">OPTIONAL DELIVERY</div><h3>WhatsApp alert group</h3></div>
      <span className={"status"+(channel?.enabled?" on":"")}>
        {channel?.enabled?"Enabled":"Off by default"}</span>
    </div>
    <p className="muted">Get new matches in a dedicated WhatsApp group, in addition to your private W-Bot inbox.
      Notifications are separate from group translations.</p>
    {channel?.enabled && <div className="alert-delivery-current">
      <span><strong>Current destination: {channel.groupName}</strong>
        <small>Only new matches are sent. Group members can see the notification and its contact details.</small></span>
      <button type="button" className="button secondary" disabled={busy}
        onClick={()=>void disable()}>Turn off</button>
    </div>}
    <div className="alert-notification-instructions">
      <strong>Set up your private notification group</strong>
      <p>Create a separate WhatsApp group using your linked account, invite only people who should see the alerts,
        and select that group below. Do not use a group being translated or monitored.</p>
    </div>
    {error && <div className="alert error" role="alert">{error}</div>}
    {message && <div className="alert success" role="status">{message}</div>}
    <form className="alert-notification-form" onSubmit={e=>void save(e)}>
      <label className="alert-field">Connected WhatsApp account
        <select value={connectionId} onChange={e=>{setConnectionId(e.target.value);setGroupId("");setConsent(false);}}>
          <option value="">Select an account</option>
          {connections.map(c=><option value={c.id} key={c.id}>{c.label}</option>)}
        </select></label>
      <label className="alert-field">Dedicated alerts group
        <select disabled={!connectionId||loadingGroups} value={groupId}
          onChange={e=>{setGroupId(e.target.value);setConsent(false);}}>
          <option value="">{loadingGroups?"Loading groups…":"Select your notifications group"}</option>
          {groups.map(g=><option key={g.groupId} value={g.groupId}>{g.name}</option>)}
        </select></label>
      <label className="consent-row">
        <input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>
        <span>I administer this group and confirm all participants agree to receive automated alerts,
          including potentially sensitive message excerpts and contact numbers.</span>
      </label>
      <button className="button primary" type="submit"
        disabled={!connectionId||!groupId||!consent||busy}>
        {channel?.enabled?"Change notification group":"Enable WhatsApp notifications"}
      </button>
    </form>
    <p className="muted text-small">WhatsApp linked-device sending uses an unofficial connection and may be interrupted.
      Ambiguous sends are never retried automatically to prevent duplicate notifications.</p>
  </section>;
}
