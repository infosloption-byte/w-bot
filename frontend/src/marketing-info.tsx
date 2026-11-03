import React, { useState } from "react";
import { Icon } from "./Icon.js";
import { Action, Cta, Eyebrow, PageHero, SectionHeading } from "./marketing-shared.js";
import { PrivacyPanel, Steps } from "./marketing-demos.js";

const plans = [
  {name:"Starter",price:69,annual:690,accounts:1,groups:10,label:"For smaller groups",highlight:false},
  {name:"Team",price:179,annual:1790,accounts:2,groups:30,label:"For growing teams",highlight:true},
  {name:"Business",price:329,annual:3290,accounts:5,groups:50,label:"For larger workspaces",highlight:false}
];
export function Pricing() {
  const [billing, setBilling] = useState<"month" | "year">("month");
  return <>
    <PageHero tag="PLANS & PRICING" title={<>The right plan for <em>your groups.</em></>}
      description="Choose the Group Translation capacity that fits your workspace. Smart Alerts is subscribed to separately, with its own monitoring and AI usage limits."/>
    <section className="site-section site-container site-pricing-section">
      <div className="site-pricing-heading"><div><Eyebrow>GROUP TRANSLATION</Eyebrow><h2>Simple, transparent group limits.</h2>
        <p>Published Translation catalog. Plan activation is handled during the pilot; online checkout is not available yet.</p></div>
        <div className="site-billing-switch" role="group" aria-label="Billing period">
          <button type="button" aria-pressed={billing==="month"} className={billing==="month"?"is-active":""}
            onClick={()=>setBilling("month")}>Monthly</button>
          <button type="button" aria-pressed={billing==="year"} className={billing==="year"?"is-active":""}
            onClick={()=>setBilling("year")}>Yearly <span>2 months equivalent saved</span></button>
        </div>
      </div>
      <div className="site-pricing-grid">{plans.map(plan=><article key={plan.name}
        className={"site-plan-card"+(plan.highlight?" is-highlighted":"")}>
        {plan.highlight && <div className="site-plan-featured">POPULAR CAPACITY</div>}
        <div className="site-plan-top"><span>{plan.label}</span><h3>{plan.name}</h3></div>
        <div className="site-price"><span>$</span><strong>{billing==="month"?plan.price:Math.round(plan.annual/12)}</strong><small>/ month</small></div>
        <p className="site-billing-note">{billing==="year" ? "$"+plan.annual.toLocaleString("en-US")+" billed annually" : "Billed monthly, USD"}</p>
        <div className="site-plan-divider"/>
        <ul>
          <li><Icon name="check" size={17}/>{plan.accounts} linked WhatsApp account{plan.accounts===1?"":"s"}</li>
          <li><Icon name="check" size={17}/>{plan.groups} Translation group slots</li>
          <li><Icon name="check" size={17}/>No fixed text-translation message cap*</li>
          <li><Icon name="check" size={17}/>Language selection per group</li>
          <li><Icon name="check" size={17}/>Customer workspace access</li>
        </ul>
        <Action href="/contact/">Enquire about {plan.name}</Action>
      </article>)}</div>
      <p className="site-pricing-disclaimer">*Subject to fair-use, WhatsApp gateway availability, configured languages and translation-provider capacity. Commercial plan activation is operator-managed during the invite-only pilot; the prices above do not initiate a payment.</p>
      <div className="site-separate-plan"><div>
        <span className="site-separate-plan-icon"><Icon name="sparkles" size={23}/></span>
        <div><h3>Smart Alerts is a separate subscription.</h3>
          <p>Monitoring groups, intelligent searches, monthly AI analyses and match limits are licensed independently. Pilot pricing is provided on enquiry; it is not included in the Translation plans above.</p></div>
        </div><Action href="/contact/" secondary>Ask about Smart Alerts</Action>
      </div>
    </section>
    <Cta title="Find the right setup for your workspace."
      description="Tell SL Options which features and group capacity you need. We'll discuss pilot availability and plan activation."/>
  </>;
}
export function HowItWorks() {
  return <>
    <PageHero tag="HOW IT WORKS" title={<>One connected workspace. <em>Two clear workflows.</em></>}
      description="Connect an authorized WhatsApp account, activate only the services you need, then decide which groups each feature can use."/>
    <section className="site-section site-container">
      <SectionHeading tag="GETTING STARTED" title="From invitation to useful results."
        description="W-Bot's setup keeps account access, group authorization and feature controls explicit."/>
      <Steps/>
    </section>
    <section className="site-section site-section-muted"><div className="site-container">
      <SectionHeading tag="PICK A SERVICE" title="Different outcomes. Separate processing."/>
      <div className="site-flow-grid">
        <article className="site-flow-card"><span className="site-flow-icon"><Icon name="translate" size={22}/></span><h3>Translation pipeline</h3>
          <ol><li><strong>Approve a group</strong><span>Verify group-admin authorization where required.</span></li>
            <li><strong>Select languages</strong><span>Choose enabled target languages for that group.</span></li>
            <li><strong>Translate incoming messages</strong><span>W-Bot processes supported messages and replies in context.</span></li>
            <li><strong>Review activity</strong><span>Manage registered groups and usage in the workspace.</span></li></ol>
        </article>
        <article className="site-flow-card"><span className="site-flow-icon is-alert"><Icon name="sparkles" size={22}/></span><h3>Smart Alerts pipeline</h3>
          <ol><li><strong>Select monitored groups</strong><span>Choose authorized groups and confirm participant notice.</span></li>
            <li><strong>Describe what to find</strong><span>Add searches with custom label/value criteria.</span></li>
            <li><strong>Review AI matches</strong><span>Inspect evidence, sender details when available and private inbox results.</span></li>
            <li><strong>Optional alert delivery</strong><span>Choose a separate consented WhatsApp notification group.</span></li></ol>
        </article>
      </div>
    </div></section>
    <section className="site-section site-container"><PrivacyPanel/></section>
    <Cta/>
  </>;
}
const questions: Array<[string,string]> = [
  ["What is W-Bot?", "W-Bot by SL Options is a workspace for multilingual WhatsApp group Translation and separately subscribed AI-powered Smart Alerts."],
  ["Are Translation and Smart Alerts one subscription?", "No. Both use one account and eligible customer-owned WhatsApp connections, but subscriptions, groups, usage limits and processing are independent."],
  ["Can Smart Alerts be used outside travel bookings?", "Yes. Searches are flexible label/value conditions and can match relevant messages for recruitment, property, logistics, service enquiries and other use cases."],
  ["Do I need to create a new WhatsApp group for alerts?", "Not to monitor existing authorized groups. A separate private group is optional when you want alerts delivered inside WhatsApp. You create and select that notification group yourself."],
  ["Does W-Bot automatically join groups or send marketing broadcasts?", "No. Customers must already belong to groups they select and have appropriate authority and participant notice. W-Bot is not a bulk messaging or automatic group-joining tool."],
  ["Can it show the original sender's number?", "When WhatsApp provides a verifiable sender phone number, W-Bot can show it separately from any contact typed in the message. Privacy-preserving identity IDs are not treated as phone numbers, and some sender numbers will be unavailable."],
  ["Are AI matches always correct?", "No. Smart Alerts uses probabilistic classification with evidence checks, but false positives and missed messages remain possible. Review the original message before acting."],
  ["Is W-Bot an official Meta WhatsApp partner?", "No. Customer-owned linked-device connections currently use an unofficial WhatsApp Web integration. Service availability may be affected by disconnections or WhatsApp account restrictions. Official Meta group functionality has separate eligibility constraints."],
  ["How are subscriptions activated?", "W-Bot is currently invite-only. The published Translation tiers are informational; Platform Admin manages entitlements during the pilot. Self-service online payment checkout is not available yet."],
  ["What should I know about privacy?", "Only authorize groups whose participants have been appropriately informed. Group messages may be processed by configured translation or AI providers. Avoid processing confidential or sensitive material without an appropriate legal basis and permission."],
  ["Where can I manage my account?", "Sign in to the customer portal to manage WhatsApp connections, service access, groups, searches, match inbox and workspace settings."]
];
export function FAQ() {
  return <>
    <PageHero tag="QUESTIONS & ANSWERS" title={<>Everything you need <em>to know.</em></>}
      description="Straightforward answers about group access, subscriptions, privacy, AI matching and the current W-Bot pilot."/>
    <section className="site-section site-container"><div className="site-faq-layout">
      <div><Eyebrow>FREQUENTLY ASKED</Eyebrow><h2>Answers before you connect.</h2>
        <p>If you have a use case that isn't covered, contact SL Options about the W-Bot pilot.</p>
        <Action href="/contact/" secondary>Contact the team</Action></div>
      <div className="site-faq-list">{questions.map(([question, answer])=><details key={question}>
        <summary>{question}<span aria-hidden="true">+</span></summary>
        <p>{answer}</p></details>)}</div>
    </div></section>
    <Cta/>
  </>;
}
export function Contact() {
  return <>
    <PageHero tag="GET IN TOUCH" title={<>Let's make your groups <em>work smarter.</em></>}
      description="W-Bot is currently offered as an invite-only technical pilot. Tell SL Options about your groups and the services you want to explore."/>
    <section className="site-section site-container">
      <div className="site-contact-layout">
        <div className="site-contact-main">
          <Eyebrow>REQUEST AN INVITATION</Eyebrow><h2>Start a conversation with SL Options.</h2>
          <p>We'll discuss your use case, the groups you're authorized to use, your expected capacity and which W-Bot feature fits your needs.</p>
          <a className="site-contact-external" href="https://sloptions.xyz/contact" target="_blank" rel="noopener noreferrer">
            <span className="site-contact-external-icon"><Icon name="chat" size={23}/></span>
            <span><strong>Open SL Options contact page</strong><small>Our company website is the contact point for pilot enquiries.</small></span>
            <Icon name="arrow" size={19}/>
          </a>
          <div className="site-contact-notice"><Icon name="info" size={20}/><span>
            The W-Bot marketing site does not collect enquiries directly yet. Use the SL Options contact page rather than an unconnected demonstration form.
          </span></div>
        </div>
        <aside className="site-contact-aside">
          <div className="site-contact-card"><Icon name="phone" size={23}/><h3>Already invited?</h3>
            <p>Log in with your existing W-Bot workspace account or use the invitation code provided to you.</p>
            <Action href="/portal/" secondary>Customer portal</Action>
          </div>
          <div className="site-contact-card"><Icon name="shield" size={23}/><h3>Before onboarding</h3>
            <p>Prepare the number of connected accounts, approximate group count, service preference and group authorization details.</p>
          </div>
        </aside>
      </div>
    </section>
  </>;
}
