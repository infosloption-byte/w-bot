import React from "react";
import { Icon } from "./Icon.js";

/* Illustrations for the public marketing site.
   Everything here is decorative or clearly labelled "illustrative": no invented customers,
   statistics or guaranteed results. Drawn with markup + CSS (no external images). */

export function Illustrative({ children = "Illustrative example" }: { children?: React.ReactNode }) {
  return <span className="gx-caption">{children}</span>;
}

/** Hero: a phone showing a translated group chat, with the Smart Alerts match floating beside it. */
export function HeroScene() {
  return <div className="gx-scene" role="img"
    aria-label="Illustration: a multilingual group chat with a W-Bot translation reply, a language selector and a Smart Alerts match">
    <div className="gx-glow" aria-hidden="true"/>
    <div className="gx-phone" aria-hidden="true">
      <div className="gx-phone-notch"/>
      <div className="gx-phone-screen">
        <div className="gx-chat-head">
          <span className="gx-avatar"><Icon name="groups" size={16}/></span>
          <span><strong>Colombo Traders</strong><small>48 participants</small></span>
        </div>
        <div className="gx-chat-body">
          <div className="gx-bubble is-in"><b>Kasun</b>Can someone confirm tomorrow's pickup time?<small>11:42</small></div>
          <div className="gx-bubble is-bot">
            <b><Icon name="translate" size={12}/> W-Bot · සිංහල</b>
            හෙට රැගෙන යන වේලාව තහවුරු කළ හැකිද?
            <small>Reply to original</small>
          </div>
          <div className="gx-bubble is-bot">
            <b><Icon name="translate" size={12}/> W-Bot · Русский</b>
            Кто-нибудь может подтвердить время завтрашней встречи?
          </div>
          <div className="gx-bubble is-in"><b>Nimali</b>Need a small van for a morning delivery in Colombo.<small>11:44</small></div>
        </div>
      </div>
    </div>
    <div className="gx-float is-status" aria-hidden="true"><span className="gx-pulse"/> WhatsApp connected</div>
    <div className="gx-float is-langs" aria-hidden="true">
      <small>Target languages</small>
      <div><span>EN</span><span>SI</span><span>RU</span><span className="is-more">+3</span></div>
    </div>
    <div className="gx-float is-alert" aria-hidden="true">
      <div className="gx-float-head"><span className="gx-icon-chip is-teal"><Icon name="bell" size={15}/></span>
        <span><strong>Smart Alert match</strong><small>Search · Delivery jobs in Colombo</small></span></div>
      <p>“Need a small van for a morning delivery in Colombo.”</p>
      <span className="gx-tag"><Icon name="check-circle" size={13}/> Saved to private inbox</span>
    </div>
  </div>;
}

/** One source message fanning out into translated replies. */
export function LanguageFan() {
  const out = [
    { code: "SI", lang: "සිංහල", text: "හෙට රැගෙන යන වේලාව තහවුරු කළ හැකිද?" },
    { code: "RU", lang: "Русский", text: "Кто-нибудь может подтвердить время завтрашней встречи?" },
    { code: "FR", lang: "Français", text: "Quelqu'un peut-il confirmer l'heure de ramassage demain ?" }
  ];
  return <div className="gx-fan" role="img" aria-label="Illustration: one English group message is translated into Sinhala, Russian and French replies">
    <div className="gx-fan-source"><span className="gx-lang">EN</span>
      <div><small>Group message</small>Can someone confirm tomorrow's pickup time?</div></div>
    <div className="gx-fan-wires" aria-hidden="true">
      <svg viewBox="0 0 300 54" preserveAspectRatio="none">
        <path d="M150 0 V20 M150 20 H25 V54 M150 20 V54 M150 20 H275 V54"/>
      </svg>
      <span className="gx-fan-hub"><Icon name="translate" size={16}/> W-Bot</span>
    </div>
    <div className="gx-fan-out">{out.map(item => <div className="gx-fan-card" key={item.code}>
      <span className="gx-lang is-out">{item.code}</span><strong>{item.lang}</strong><p>{item.text}</p>
    </div>)}</div>
    <Illustrative/>
  </div>;
}

/** Stream of group messages filtered by a saved search. */
export function AlertsFilter() {
  const rows: Array<[string, boolean]> = [
    ["Anyone going to Kandy tomorrow?", false],
    ["Happy birthday Nuwan 🎉", false],
    ["Need a small van for a morning delivery in Colombo.", true],
    ["Price list is on the shared drive.", false],
    ["Meeting moved to 4 pm", false]
  ];
  return <div className="gx-filter" role="img" aria-label="Illustration: five group messages are checked against a saved search and one matches">
    <div className="gx-filter-search"><span className="gx-icon-chip"><Icon name="target" size={16}/></span>
      <span><small>Your saved search</small><strong>Delivery jobs in Colombo</strong></span>
      <span className="gx-live">ACTIVE</span></div>
    <ul>{rows.map(([text, hit]) => <li key={text} className={hit ? "is-hit" : ""}>
      <span className="gx-row-icon"><Icon name={hit ? "check-circle" : "chat"} size={15}/></span>
      <span>{text}</span><em>{hit ? "Match" : "No match"}</em></li>)}</ul>
    <div className="gx-filter-foot"><Icon name="inbox" size={15}/> 1 match saved to your private inbox</div>
    <Illustrative/>
  </div>;
}

/** Mock of the private matches inbox. */
export function InboxMock() {
  return <div className="gx-inbox" role="img" aria-label="Illustration: the private Smart Alerts inbox showing two matches">
    <div className="gx-inbox-head"><span className="gx-icon-chip is-teal"><Icon name="inbox" size={16}/></span>
      <strong>Private matches inbox</strong><span className="gx-count">2 new</span></div>
    {[["Delivery jobs in Colombo", "Need a small van for a morning delivery in Colombo.", "Colombo Traders"],
      ["New website enquiries", "Looking for someone to build our company website in Galle.", "Galle Business Circle"]
    ].map(([rule, text, group]) => <div className="gx-inbox-item" key={rule}>
      <div><span className="gx-tag is-brand">{rule}</span><small>{group}</small></div>
      <p>{text}</p>
      <div className="gx-inbox-meta"><span><Icon name="phone" size={12}/> Sender number: shown when WhatsApp provides it</span></div>
    </div>)}
    <Illustrative/>
  </div>;
}

export type FlowNode = { icon: string; title: string; text: string; tone?: "brand" | "teal" | "ink" };
/** Left-to-right (top-to-bottom on phones) process diagram with connectors. */
export function Flow({ nodes, label }: { nodes: FlowNode[]; label: string }) {
  return <ol className="gx-flow" aria-label={label}>{nodes.map((node, index) =>
    <li key={node.title} className={"gx-flow-node is-" + (node.tone ?? "brand")}>
      <span className="gx-flow-icon"><Icon name={node.icon} size={24}/></span>
      <span className="gx-flow-index">0{index + 1}</span>
      <strong>{node.title}</strong><span>{node.text}</span>
    </li>)}</ol>;
}

/** System overview: WhatsApp account → W-Bot → two independent outputs. */
export function Overview() {
  return <div className="gx-overview" role="img"
    aria-label="Diagram: authorized WhatsApp groups connect to W-Bot, which provides Translation replies and Smart Alerts matches independently">
    <div className="gx-ov-col">
      <div className="gx-ov-box"><span className="gx-icon-chip"><Icon name="phone" size={18}/></span>
        <strong>Your WhatsApp account</strong><small>Customer-owned linked device</small></div>
      <div className="gx-ov-box"><span className="gx-icon-chip"><Icon name="groups" size={18}/></span>
        <strong>Groups you authorize</strong><small>Only the groups you select</small></div>
    </div>
    <div className="gx-ov-arrow" aria-hidden="true"><Icon name="arrow" size={22}/></div>
    <div className="gx-ov-hub"><span className="gx-ov-mark">W</span><strong>W-Bot workspace</strong>
      <small>One login · two independent services</small></div>
    <div className="gx-ov-arrow" aria-hidden="true"><Icon name="arrow" size={22}/></div>
    <div className="gx-ov-col">
      <div className="gx-ov-box is-brand"><span className="gx-icon-chip"><Icon name="translate" size={18}/></span>
        <strong>Group Translation</strong><small>Translated replies in the group</small></div>
      <div className="gx-ov-box is-teal"><span className="gx-icon-chip is-teal"><Icon name="sparkles" size={18}/></span>
        <strong>Smart Alerts</strong><small>Private inbox · optional alert group</small></div>
    </div>
  </div>;
}

/** Decorative hero art for pages without a product mock-up. */
export function IconCluster({ center, items, label }: { center: string; items: Array<[string, string]>; label: string }) {
  return <div className="gx-cluster" role="img" aria-label={label}>
    <div className="gx-ring is-one" aria-hidden="true"/><div className="gx-ring is-two" aria-hidden="true"/>
    <span className="gx-cluster-core"><Icon name={center} size={44}/></span>
    {items.map(([icon, text], index) => <span key={text} className={"gx-cluster-item i" + (index + 1)}>
      <Icon name={icon} size={18}/> {text}</span>)}
  </div>;
}

/** Relative capacity bar used in the pricing cards. */
export function Meter({ label, value, max, unit }: { label: string; value: number; max: number; unit: string }) {
  const pct = Math.max(6, Math.min(100, Math.round((value / max) * 100)));
  return <div className="gx-meter">
    <div><span>{label}</span><strong>{value} {unit}</strong></div>
    <div className="gx-meter-track" aria-hidden="true"><span ref={node => { if (node) node.style.width = pct + "%"; }}/></div>
  </div>;
}

export function UseCaseGrid() {
  const items: Array<[string, string, string]> = [
    ["globe", "Travel & transport", "Seat, tour and transfer requests"],
    ["users", "Recruitment", "Vacancies and candidate availability"],
    ["building", "Property leads", "Listings, rentals and buyer enquiries"],
    ["zap", "Logistics", "Freight space and delivery jobs"],
    ["chat", "Service enquiries", "Quotes and project requests"],
    ["groups", "Local communities", "Notices and offers that matter to you"]
  ];
  return <div className="gx-usecases">{items.map(([icon, title, text]) => <div className="gx-usecase" key={title}>
    <span className="gx-icon-chip"><Icon name={icon} size={20}/></span><strong>{title}</strong><small>{text}</small>
  </div>)}</div>;
}

export function TopicCards() {
  const topics: Array<[string, string, string]> = [
    ["groups", "Groups & access", "Which groups W-Bot can use and who authorizes them"],
    ["lock", "Privacy & consent", "Participant notice, data handling and AI providers"],
    ["sparkles", "AI & accuracy", "How matching works and where it can be wrong"],
    ["plans", "Plans & pilot", "Subscriptions, activation and what is invite-only"]
  ];
  return <div className="gx-topics">{topics.map(([icon, title, text]) => <div className="gx-topic" key={title}>
    <span className="gx-icon-chip"><Icon name={icon} size={20}/></span><strong>{title}</strong><small>{text}</small>
  </div>)}</div>;
}

/** Mini visuals shown inside the two product cards on the home page. */
export function MiniTranslation() {
  return <div className="gx-mini" aria-hidden="true">
    <div className="gx-mini-bubble">Pickup at 9?</div>
    <div className="gx-mini-bubble is-out"><span className="gx-lang is-out">SI</span> උදේ 9 ට රැගෙන යාම?</div>
  </div>;
}
export function MiniAlert() {
  return <div className="gx-mini" aria-hidden="true">
    <div className="gx-mini-bubble is-alert"><Icon name="check-circle" size={14}/> Match · Delivery jobs in Colombo</div>
    <div className="gx-mini-bubble is-muted"><Icon name="inbox" size={14}/> Saved to private inbox</div>
  </div>;
}
