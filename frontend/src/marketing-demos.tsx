import React from "react";
import { Icon } from "./Icon.js";
import { Eyebrow } from "./marketing-shared.js";

export function Preview() {
  return <div className="site-preview" aria-label="Illustrative W-Bot customer workspace preview">
    <div className="site-preview-top">
      <div className="site-preview-app"><span className="site-preview-appmark">W</span>
        <div><strong>W-Bot Workspace</strong><small>Customer dashboard preview</small></div>
      </div>
      <div className="site-preview-connected"><span/> Example workspace</div>
    </div>
    <div className="site-preview-content">
      <aside className="site-preview-sidebar" aria-label="Illustrative dashboard navigation">
        <div className="site-preview-sidebar-title">WORKSPACE</div>
        <div className="site-preview-sidebar-link is-current"><Icon name="dashboard" size={16}/> Overview</div>
        <div className="site-preview-sidebar-link"><Icon name="translate" size={16}/> Translation</div>
        <div className="site-preview-sidebar-link"><Icon name="bell" size={16}/> Smart Alerts</div>
        <div className="site-preview-sidebar-link"><Icon name="groups" size={16}/> Groups</div>
        <div className="site-preview-sidebar-foot"><Icon name="shield" size={15}/> Group access managed</div>
      </aside>
      <div className="site-preview-panel">
        <div className="site-preview-panel-head">
          <div><small>YOUR WORKSPACE</small><h3>Overview</h3></div>
          <span className="site-preview-period">Example data</span>
        </div>
        <div className="site-preview-summary">
          <div><span><Icon name="groups" size={16}/> Authorized groups</span><strong>02</strong><small>Selected by workspace</small></div>
          <div><span><Icon name="inbox" size={16}/> Smart Alert matches</span><strong>01</strong><small>Private inbox</small></div>
        </div>
        <div className="site-preview-activity">
          <div className="site-preview-activity-head"><strong>Recent activity</strong><span>Illustrative</span></div>
          <div className="site-preview-activity-row"><span className="site-preview-activity-icon is-translation"><Icon name="translate" size={17}/></span>
            <div><strong>Group message translated</strong><small>Community discussion · 2 languages</small></div>
            <span className="site-preview-event is-done">Complete</span>
          </div>
          <div className="site-preview-activity-row"><span className="site-preview-activity-icon is-alert"><Icon name="bell" size={17}/></span>
            <div><strong>Relevant request identified</strong><small>Saved search · Private inbox</small></div>
            <span className="site-preview-event">New match</span>
          </div>
        </div>
        <div className="site-preview-privacy"><Icon name="lock" size={14}/>
          Only selected groups are enabled for each service.</div>
      </div>
    </div>
    <div className="site-preview-foot"><span>Conceptual product preview — no live customer data</span></div>
  </div>;
}
export function ProductCards() {
  return <div className="site-products">
    <article className="site-product-card is-translation">
      <div className="site-product-card-top"><span className="site-product-icon"><Icon name="translate" size={25}/></span>
        <span className="site-product-kicker">SERVICE 01</span></div>
      <h3>Group Translation</h3><p>Keep multilingual groups in sync. W-Bot detects the source language, translates to selected languages and replies in the conversation.</p>
      <div className="site-product-tags"><span>Language selection</span><span>Group replies</span><span>Admin-controlled</span></div>
      <a href="/translation/" className="site-link-arrow">Explore Translation <Icon name="arrow" size={18}/></a>
    </article>
    <article className="site-product-card is-alerts">
      <div className="site-product-card-top"><span className="site-product-icon"><Icon name="sparkles" size={25}/></span>
        <span className="site-product-kicker">SERVICE 02</span></div>
      <h3>Smart Alerts</h3><p>Identify relevant messages in groups you authorize. Configure intelligent searches, review matches privately, and choose optional notifications.</p>
      <div className="site-product-tags"><span>Intelligent rules</span><span>Private inbox</span><span>WhatsApp alerts</span></div>
      <a href="/smart-alerts/" className="site-link-arrow">Explore Smart Alerts <Icon name="arrow" size={18}/></a>
    </article>
  </div>;
}
export function Steps() {
  const steps = [
    {id:"01",icon:"user",title:"Create your workspace",detail:"Sign in through the customer portal after receiving a pilot invitation."},
    {id:"02",icon:"phone",title:"Connect WhatsApp",detail:"Link an account you control. Select only groups you are authorized to use."},
    {id:"03",icon:"settings",title:"Choose your services",detail:"Configure Translation, Smart Alerts, or both with independent access and limits."},
    {id:"04",icon:"zap",title:"Put messages to work",detail:"See group translations or review intelligent matches and optional notifications."}
  ];
  return <div className="site-steps">{steps.map(item => <article className="site-step" key={item.id}>
    <div className="site-step-index">{item.id}</div><span className="site-step-icon"><Icon name={item.icon} size={22}/></span>
    <h3>{item.title}</h3><p>{item.detail}</p>
  </article>)}</div>;
}
export function UseCaseExample() {
  return <div className="site-example-card">
    <div className="site-example-head"><Icon name="target" size={20}/> Example intelligent search</div>
    <div className="site-example-search"><span>Search name</span><strong>New website enquiries</strong></div>
    <div className="site-example-condition"><span>Service</span><strong>Website development</strong></div>
    <div className="site-example-condition"><span>Area</span><strong>Colombo or Galle</strong></div>
    <div className="site-example-hit"><Icon name="check-circle" size={18}/><span>“Looking for someone to build our company website in Galle.”</span></div>
    <small>Illustrative example. AI matches are probabilistic and should be reviewed.</small>
  </div>;
}
export function TranslationVisual() {
  return <div className="site-translation-preview">
    <div className="site-mini-label"><Icon name="chat" size={15}/> Group message</div>
    <div className="site-preview-bubble">Can someone confirm tomorrow's pickup time?</div>
    <div className="site-mini-connector"><Icon name="arrow" size={17}/></div>
    <div className="site-translation-output">
      <div className="site-mini-label"><Icon name="translate" size={15}/> W-Bot translated reply</div>
      <div><strong>සිංහල</strong><p>හෙට රැගෙන යන වේලාව තහවුරු කළ හැකිද?</p></div>
      <div><strong>Русский</strong><p>Кто-нибудь может подтвердить время завтрашней встречи?</p></div>
    </div><span className="site-illustrative">Illustrative example</span>
  </div>;
}
export function AlertsVisual() {
  return <div className="site-alerts-preview">
    <div className="site-alerts-preview-title"><Icon name="sparkles" size={19}/> Intelligent search <span>ACTIVE</span></div>
    <div className="site-alerts-field"><span>Search name</span><strong>Available delivery jobs</strong></div>
    <div className="site-alerts-field"><span>Area</span><strong>Colombo</strong></div>
    <div className="site-alerts-field"><span>Vehicle</span><strong>Small van</strong></div>
    <div className="site-alerts-match"><Icon name="check-circle" size={19}/><div>
      <strong>Relevant message found</strong><span>Private inbox · New match</span></div></div>
    <span className="site-illustrative">Illustrative example</span>
  </div>;
}
export function PrivacyPanel() {
  return <div className="site-privacy-panel">
    <span className="site-feature-icon"><Icon name="shield" size={24}/></span>
    <div><Eyebrow>GROUP CONTROL MATTERS</Eyebrow><h2>Opt-in by design.</h2>
      <p>W-Bot does not automatically join groups or read private direct chats for Smart Alerts. Users connect an account they control, select authorized groups and confirm appropriate participant notice. Third-party AI processing and WhatsApp linked-device limitations should be reviewed before onboarding sensitive groups.</p>
      <a className="site-link-arrow" href="/faq/">Read frequently asked questions <Icon name="arrow" size={18}/></a></div>
  </div>;
}
