import React from "react";
import { Icon } from "./Icon.js";
import { Cta, PageHero, SectionHeading } from "./marketing-shared.js";

const controls = [
  { icon: "phone", title: "Customer-owned WhatsApp connections",
    body: "Connect an account that you control. W-Bot does not automatically join new groups, and linking an account alone does not enable monitoring across every conversation." },
  { icon: "shield", title: "Explicit group selection",
    body: "Translation and Smart Alerts each use configured group access. Groups should only be used with the appropriate authority, notice and participant permission." },
  { icon: "settings", title: "Independent service permissions",
    body: "Translation and Smart Alerts have separate subscriptions, usage controls and processing paths. An alert search does not automatically enable group translation." },
  { icon: "inbox", title: "Deliberate alert delivery",
    body: "Matches appear in the customer workspace. WhatsApp notifications are optional and go to a separate group that the customer creates and selects with participant consent." }
];
export function Trust() {
  return <>
    <PageHero tag="TRUST & TRANSPARENCY" title={<>Clear controls. <em>Clear expectations.</em></>}
      description="We believe responsible group-message tools should be straightforward about access, handling of messages and service limitations. Here is what W-Bot currently does—and does not do."/>
    <section className="site-section site-container">
      <SectionHeading tag="ACCESS CONTROLS" title="You decide what W-Bot can work with."
        description="Service access is configured for selected groups, rather than assuming that every group on a connected account should be processed."/>
      <div className="site-trust-grid">
        {controls.map(item => <article key={item.title}>
          <span><Icon name={item.icon} size={23}/></span>
          <h3>{item.title}</h3><p>{item.body}</p>
        </article>)}
      </div>
    </section>
    <section className="site-section site-section-muted"><div className="site-container site-trust-detail">
      <div><SectionHeading tag="MESSAGE HANDLING" title="Know how messages are processed."
        description="W-Bot uses messages for the service you've enabled. Provider access and retention are important parts of deciding whether a group is suitable for onboarding."/></div>
      <div className="site-trust-detail-list">
        <div><Icon name="check-circle" size={21}/><div><h3>Only configured groups</h3>
          <p>The enabled group and active subscription are checked before Smart Alerts messages are admitted for processing.</p></div></div>
        <div><Icon name="history" size={21}/><div><h3>Bounded message retention</h3>
          <p>A scheduled maintenance task targets Smart Alerts event data older than 14 days. Translation message retention is separately configurable by the platform operator.</p></div></div>
        <div><Icon name="globe" size={21}/><div><h3>External AI services</h3>
          <p>Selected message content can be sent to configured translation and AI processing providers. Obtain appropriate group permission and avoid sensitive conversations without a suitable basis.</p></div></div>
        <div><Icon name="lock" size={21}/><div><h3>Sender identity has limits</h3>
          <p>W-Bot shows the sender phone number only when WhatsApp provides a verifiable number. Privacy-preserving identifiers are not treated as phone numbers.</p></div></div>
      </div>
    </div></section>
    <section className="site-section site-container">
      <div className="site-trust-important">
        <span><Icon name="info" size={24}/></span>
        <div><h2>Important service limitations</h2>
          <p>Customer-owned WhatsApp sessions currently use an unofficial linked-device integration. This is not a Meta-endorsed WhatsApp business integration, and connections may disconnect or face account restrictions. Smart Alerts uses AI interpretation, so matches can be wrong or missed. W-Bot is currently an invitation-only technical pilot; we do not claim an independently verified security certification.</p>
          <a className="site-link-arrow" href="/faq/">Review common questions <Icon name="arrow" size={17}/></a>
        </div>
      </div>
    </section>
    <Cta title="Questions about access or data handling?"
      description="Discuss your intended groups, participant consent and service requirements with our team before onboarding."/>
  </>;
}
