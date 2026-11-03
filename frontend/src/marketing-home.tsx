import React from "react";
import { Icon } from "./Icon.js";
import { Action, Cta, Eyebrow, FeatureGrid, PageHero, SectionHeading } from "./marketing-shared.js";
import { AlertsVisual, Preview, ProductCards, Steps, TranslationVisual, UseCaseExample } from "./marketing-demos.js";

export function Home() {
  return <>
    <section className="site-hero">
      <div className="site-hero-orb is-one" aria-hidden="true"/><div className="site-hero-orb is-two" aria-hidden="true"/>
      <div className="site-container site-hero-layout">
        <div className="site-hero-copy">
          <Eyebrow>THE WHATSAPP GROUP INTELLIGENCE WORKSPACE</Eyebrow>
          <h1>Every message understood. <em>Every opportunity noticed.</em></h1>
          <p>Translate multilingual group conversations and discover relevant opportunities with AI-powered alerts, all from one connected workspace.</p>
          <div className="site-hero-actions"><Action href="/contact/">Request pilot access</Action>
            <Action href="/how-it-works/" secondary>See how W-Bot works</Action></div>
          <div className="site-hero-points"><span><Icon name="check" size={16}/> One account</span>
            <span><Icon name="check" size={16}/> Two independent services</span>
            <span><Icon name="check" size={16}/> You choose the groups</span></div>
        </div>
        <Preview/>
      </div>
    </section>
    <div className="site-value-strip"><div className="site-container site-value-inner">
      <div><Icon name="shield" size={19}/><span>Explicit group authorization</span></div>
      <div><Icon name="phone" size={19}/><span>Shared customer-owned connections</span></div>
      <div><Icon name="activity" size={19}/><span>Independent subscriptions and usage</span></div>
    </div></div>
    <section className="site-section site-container">
      <SectionHeading tag="TWO TOOLS. ONE WORKSPACE." title="Do more with the conversations you're already part of."
        description="Each feature solves a different problem. Use the one you need, or combine both."/>
      <ProductCards/>
    </section>
    <section className="site-section site-section-muted"><div className="site-container">
      <SectionHeading tag="SIMPLE TO GET STARTED" title="From connected to configured in four clear steps."
        description="No automatic group joining, no bulk outreach, and no need to change how people already chat."/>
      <Steps/><div className="site-section-foot"><a className="site-link-arrow" href="/how-it-works/">
        View the full process <Icon name="arrow" size={18}/></a></div>
    </div></section>
    <section className="site-section site-container"><div className="site-split-layout">
      <div><SectionHeading tag="DESIGNED FOR REAL-WORLD WORK" title="Whatever your industry, tell W-Bot what matters."
          description="Smart Alerts aren't limited to travel bookings. Create your own conditions for the messages you're looking for."/>
        <div className="site-use-case-tags"><span>Travel & transport</span><span>Recruitment</span>
          <span>Property leads</span><span>Logistics</span><span>Service enquiries</span><span>Local communities</span></div>
        <a className="site-link-arrow" href="/smart-alerts/">Explore intelligent searches <Icon name="arrow" size={17}/></a>
      </div>
      <UseCaseExample/>
    </div></section>
    <Cta/>
  </>;
}
export function Translation() {
  return <>
    <PageHero tag="GROUP TRANSLATION" title={<>One conversation. <em>More understanding.</em></>}
      description="Help multilingual groups follow the same discussion. W-Bot translates selected group messages and replies in context, without forcing members to switch apps.">
      <TranslationVisual/>
    </PageHero>
    <section className="site-section site-container">
      <SectionHeading tag="CAPABILITIES" title="Translation that stays with the conversation."
        description="Designed for groups where different languages should not become a barrier."/>
      <FeatureGrid features={[
        {icon:"globe",title:"Choose target languages",body:"Group administrators choose from languages enabled in the W-Bot catalog, subject to plan and group settings."},
        {icon:"chat",title:"Reply to the original message",body:"Translations are sent as replies where the connected gateway supports quoted group messages."},
        {icon:"shield",title:"Only approved groups",body:"Translation groups require authorization and platform controls. Connecting a number does not automatically enable all groups."},
        {icon:"phone",title:"Your WhatsApp account",body:"Link a customer-owned session for regular groups, or use an eligible configured group connection."},
        {icon:"history",title:"Usage and group visibility",body:"Review registered groups, selected languages and translation activity in the customer workspace."},
        {icon:"settings",title:"Independent service controls",body:"Translation has its own subscription, group limits and controls, separate from Smart Alerts."}
      ]}/>
    </section>
    <section className="site-section site-section-muted"><div className="site-container site-detail-band">
      <div><Eyebrow>FAMILIAR BY DESIGN</Eyebrow><h2>No new app for group members to learn.</h2>
        <p>Messages remain in WhatsApp. W-Bot adds translations in the approved conversation, while group admins retain control over activation and languages.</p>
        <Action href="/pricing/" secondary>See Translation pricing</Action></div>
      <div className="site-detail-list">
        <div><Icon name="check-circle" size={20}/><span>Keep conversations in their existing groups</span></div>
        <div><Icon name="check-circle" size={20}/><span>Set different languages per approved group</span></div>
        <div><Icon name="check-circle" size={20}/><span>Manage usage in one workspace</span></div>
      </div>
    </div></section>
    <Cta title="Help everyone stay in the conversation." description="Explore group Translation with an invite-only W-Bot workspace."/>
  </>;
}
export function Alerts() {
  return <>
    <PageHero tag="SMART ALERTS" title={<>The right opportunity. <em>Without the endless scroll.</em></>}
      description="Use intelligent searches to monitor authorized groups for the requests, leads and updates that matter to your work. Review matches privately or receive optional WhatsApp notifications.">
      <AlertsVisual/>
    </PageHero>
    <section className="site-section site-container">
      <SectionHeading tag="CAPABILITIES" title="Search meaning, not just keywords."
        description="Write conditions in your own words. W-Bot checks new messages against all the requirements in your saved search."/>
      <FeatureGrid features={[
        {icon:"target",title:"Flexible search conditions",body:"Build searches with your own labels and values. No fixed travel, price or location fields are required."},
        {icon:"groups",title:"Choose multiple groups",body:"Monitor only explicitly selected groups you are authorized to access; pause them independently."},
        {icon:"sparkles",title:"AI-assisted interpretation",body:"Check formatted and informal messages, including natural language and multilingual content. Matches require supporting evidence."},
        {icon:"inbox",title:"Detailed private inbox",body:"Filter matches by source group, search and read status; inspect saved excerpts, criteria and available sender details."},
        {icon:"bell",title:"Optional WhatsApp notifications",body:"Send new matches to a separate group you create and approve. The source group does not receive alert replies."},
        {icon:"shield",title:"Separate permissions",body:"Smart Alerts has independent subscription limits and consent controls, without changing Group Translation."}
      ]}/>
    </section>
    <section className="site-section site-section-muted"><div className="site-container site-split-layout">
      <div><SectionHeading tag="ONE TOOL, MANY INDUSTRIES" title="Your search. Your terminology."
        description="Travel opportunities are one example—not the definition of Smart Alerts. Build searches for any business process where relevant group updates can be missed."/>
        <div className="site-use-case-tags"><span>Transport requests</span><span>Property listings</span>
          <span>Job vacancies</span><span>Freight availability</span><span>Customer enquiries</span></div>
      </div>
      <div className="site-example-card">
        <div className="site-example-head"><Icon name="bell" size={20}/> Example notification</div>
        <div className="site-example-search"><span>Search</span><strong>Delivery jobs in Colombo</strong></div>
        <div className="site-example-hit"><Icon name="check-circle" size={18}/>
          <span>“Need a small van for a morning delivery in Colombo.”</span></div>
        <div className="site-example-condition"><span>Sender number</span><strong>Shown when WhatsApp provides it</strong></div>
        <div className="site-example-condition"><span>Delivery</span><strong>Private inbox · Optional alert group</strong></div>
        <small>Illustrative message. Matching may be imperfect and private sender numbers may be unavailable.</small>
      </div>
    </div></section>
    <Cta title="Don't miss the messages that matter." description="Smart Alerts is a separately licensed feature, available through W-Bot's invite-only pilot."/>
  </>;
}
