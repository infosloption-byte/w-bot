import React, { useCallback, useEffect, useState } from "react";
import { portalRequest } from "./PortalAccount.js";
import "./alerts-inbox.css";

type ListMatch = {
  id: string; summary: string; contactNumber: string | null; quotedPrice: number | null;
  isRead: boolean; createdAt: string;
  rule: { id: string; name: string };
  event: { externalMessageId: string; watchGroupId: string; createdAt: string;
    group: { name: string } };
  delivery: { status: string; sentAt: string | null } | null;
};
type Detail = ListMatch & {
  criteriaSnapshot: Array<{label:string;value:string}> | Record<string,string> | null;
  rule: { id: string; name: string; parameters: unknown };
  delivery: {status:string;sentAt:string|null;attempts:number}|null;
  event: { externalMessageId:string; createdAt:string; processedAt:string|null;
    group:{name:string} };
};
type Group = {id:string;name:string};
type Rule = {id:string;name:string};

export function SmartAlertsInbox() {
  const [items,setItems] = useState<ListMatch[]>([]);
  const [groups,setGroups] = useState<Group[]>([]);
  const [rules,setRules] = useState<Rule[]>([]);
  const [text,setText] = useState("");
  const [search,setSearch] = useState("");
  const [read,setRead] = useState("all");
  const [group,setGroup] = useState("");
  const [rule,setRule] = useState("");
  const [page,setPage] = useState(0);
  const [hasMore,setHasMore] = useState(false);
  const [selected,setSelected] = useState<string|null>(null);
  const [detail,setDetail] = useState<Detail|null>(null);
  const [loading,setLoading] = useState(true);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({read,page:String(page)});
      if (group) qs.set("group",group);
      if (rule) qs.set("rule",rule);
      if (search) qs.set("q",search);
      const [data, groupData, ruleData] = await Promise.all([
        portalRequest<{matches:ListMatch[];hasMore:boolean}>("/alerts/inbox?"+qs.toString(),undefined,"GET"),
        portalRequest<{groups:Group[]}>("/alerts/groups",undefined,"GET"),
        portalRequest<{rules:Rule[]}>("/alerts/rules",undefined,"GET")
      ]);
      setItems(data.matches);setHasMore(data.hasMore);
      setGroups(groupData.groups);setRules(ruleData.rules);setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load matching alerts");
    } finally {setLoading(false);}
  },[read,page,group,rule,search]);
  useEffect(()=>{void refresh();},[refresh]);
  useEffect(()=>{
    if(!selected){setDetail(null);return;}
    let active=true;
    setDetail(null);
    void portalRequest<{match:Detail}>("/alerts/inbox/"+encodeURIComponent(selected),undefined,"GET")
      .then(d=>{if(active)setDetail(d.match);})
      .catch(e=>{if(active)setError(e instanceof Error ? e.message : "Unable to open alert");});
    return ()=>{active=false;};
  },[selected]);
  useEffect(()=>{
    if(!selected)return;
    const close=(e:KeyboardEvent)=>{if(e.key==="Escape")setSelected(null);};
    window.addEventListener("keydown",close);
    return ()=>window.removeEventListener("keydown",close);
  },[selected]);
  async function markRead(id:string, value:boolean){
    setBusy(true);setError("");
    try{
      await portalRequest("/alerts/inbox/"+encodeURIComponent(id),{isRead:value},"PATCH");
      if(detail?.id===id)setDetail({...detail,isRead:value});
      await refresh();
    }catch(e){setError(e instanceof Error?e.message:"Unable to update alert");}
    finally{setBusy(false);}
  }
  function applySearch(e:React.FormEvent){e.preventDefault();setPage(0);setSearch(text.trim());}
  const requirements = detail?.criteriaSnapshot && !Array.isArray(detail.criteriaSnapshot)
    ? Object.entries(detail.criteriaSnapshot).map(([label,value])=>({label,value}))
    : Array.isArray(detail?.criteriaSnapshot) ? detail.criteriaSnapshot : [];

  return <section className="panel alerts-inbox-panel">
    <div className="panel-heading">
      <div><div className="eyebrow">SMART ALERTS / INBOX</div><h3>Matching opportunities</h3>
        <p className="muted text-small">Search, filter and inspect alerts without opening every WhatsApp group.</p></div>
      <button className="button secondary" onClick={()=>void refresh()} disabled={loading}>Refresh</button>
    </div>
    <form className="alert-inbox-search" onSubmit={applySearch}>
      <label className="alert-field">Search matches
        <input type="search" placeholder="Message text, search name, group…" maxLength={100}
          value={text} onChange={e=>setText(e.target.value)}/></label>
      <button className="button secondary" type="submit">Search</button>
    </form>
    <div className="alert-filter-row">
      <label className="alert-field">Read status
        <select value={read} onChange={e=>{setPage(0);setRead(e.target.value)}}>
          <option value="all">All alerts</option><option value="unread">Unread</option>
          <option value="read">Read</option>
        </select></label>
      <label className="alert-field">Monitored group
        <select value={group} onChange={e=>{setPage(0);setGroup(e.target.value)}}>
          <option value="">All groups</option>
          {groups.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}
        </select></label>
      <label className="alert-field">Intelligent search
        <select value={rule} onChange={e=>{setPage(0);setRule(e.target.value)}}>
          <option value="">All searches</option>
          {rules.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}
        </select></label>
    </div>
    {(search||read!=="all"||group||rule) && <button type="button" className="text-button"
      onClick={()=>{setText("");setSearch("");setRead("all");setGroup("");setRule("");setPage(0);}}>
      Clear filters</button>}
    {error && <div className="alert error" role="alert">{error}</div>}
    {loading ? <p className="muted">Loading alerts…</p> :
      items.length ? <div className="alert-inbox-results">{items.map(item=><article
        key={item.id} className={"alert-inbox-item"+(item.isRead?" is-read":"")}>
        <div className="alert-inbox-item-main">
          <div className="alert-inbox-item-heading">
            {!item.isRead && <span className="unread-dot" aria-label="Unread"/>}
            <strong>{item.rule.name}</strong>
            <span className="muted text-small">{new Date(item.createdAt).toLocaleString()}</span>
          </div>
          <p>{item.summary}</p>
          <div className="alert-inbox-item-meta">
            <span>{item.event.group.name}</span>
            {item.contactNumber && <span>Contact available</span>}
            {item.delivery && <span>WhatsApp: {item.delivery.status.toLowerCase()}</span>}
          </div>
        </div>
        <div className="alert-inbox-item-actions">
          <button className="button secondary" onClick={()=>setSelected(item.id)}>View details</button>
          <button className="text-button" disabled={busy}
            onClick={()=>void markRead(item.id,!item.isRead)}>
            {item.isRead?"Mark unread":"Mark read"}</button>
        </div>
      </article>)}</div>
      : <div className="alert-inbox-empty"><strong>No alerts found</strong><p className="muted">
        Try changing your filters or check your monitored groups and saved searches.</p></div>}
    <div className="alert-inbox-pagination">
      <span className="muted text-small">Page {page+1}</span>
      <button className="button secondary" disabled={loading||page===0} onClick={()=>setPage(v=>Math.max(0,v-1))}>Previous</button>
      <button className="button secondary" disabled={loading||!hasMore} onClick={()=>setPage(v=>v+1)}>Next</button>
    </div>
    {selected && <div className="alert-detail-backdrop" role="presentation"
      onMouseDown={e=>{if(e.target===e.currentTarget)setSelected(null)}}>
      <section role="dialog" aria-modal="true" aria-label="Smart Alert details"
        className="alert-detail-drawer">
        <div className="alert-detail-header"><div><div className="eyebrow">MATCH DETAILS</div>
          <h3>{detail?.rule.name??"Loading match…"}</h3></div>
          <button className="button secondary" aria-label="Close alert details"
            onClick={()=>setSelected(null)}>Close</button>
        </div>
        {detail && <>
          <div className="alert-detail-grid">
            <div><small>Source group</small><strong>{detail.event.group.name}</strong></div>
            <div><small>Received</small><strong>{new Date(detail.event.createdAt).toLocaleString()}</strong></div>
            <div><small>Matched</small><strong>{new Date(detail.createdAt).toLocaleString()}</strong></div>
            <div><small>Read status</small><strong>{detail.isRead?"Read":"Unread"}</strong></div>
            <div><small>WhatsApp notification</small><strong>{detail.delivery?.status??"Not configured"}</strong></div>
            <div><small>Delivery attempts</small><strong>{detail.delivery?.attempts??0}</strong></div>
          </div>
          <h4>Original message excerpt</h4>
          <blockquote className="alert-detail-text">{detail.summary}</blockquote>
          <p className="muted text-small">Stored excerpt (up to 500 characters). Full source messages are not retained after processing.</p>
          <h4>Search conditions at match time</h4>
          {requirements.length ? <dl className="alert-criteria-list">{requirements.map((x,i)=>
            <div key={i}><dt>{x.label}</dt><dd>{String(x.value)}</dd></div>)}</dl>:
            <p className="muted">Older alert: historical search conditions are unavailable.</p>}
          {detail.contactNumber && <div className="alert-contact">
            <span><small>Contact from source message</small><strong>{detail.contactNumber}</strong></span>
            <button className="button secondary" onClick={()=>{
              void navigator.clipboard.writeText(detail.contactNumber||"")
                .catch(()=>setError("Copy contact failed"));
            }}>Copy</button>
          </div>}
          {detail.quotedPrice != null && <p>Extracted amount: {detail.quotedPrice.toLocaleString()}</p>}
          <div className="alert-detail-actions">
            <button className="button primary" disabled={busy}
              onClick={()=>void markRead(detail.id,!detail.isRead)}>
              Mark as {detail.isRead?"unread":"read"}</button>
            <button className="button secondary" onClick={()=>setSelected(null)}>Done</button>
          </div>
        </>}
      </section>
    </div>}
  </section>;
}
