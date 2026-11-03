import React, { useState } from "react";
import { Icon } from "./Icon.js";

export type Page = "home" | "translation" | "alerts" | "pricing" | "how" | "faq" | "contact" | "trust";
export const routes: Record<Page, string> = {
  home: "/", translation: "/translation/", alerts: "/smart-alerts/",
  pricing: "/pricing/", how: "/how-it-works/", faq: "/faq/", contact: "/contact/", trust: "/trust/"
};
export const currentPage: Page = (Object.entries(routes).find(([, url]) =>
  url.replace(/\/+$/, "") === (window.location.pathname.replace(/\/+$/, "") || "/")
)?.[0] as Page | undefined) ?? "home";

export function Action({ href, children, secondary = false, external = false }: {
  href: string; children: React.ReactNode; secondary?: boolean; external?: boolean;
}) {
  return <a className={"site-action" + (secondary ? " is-secondary" : "")} href={href}
    {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
    {children}<Icon name="arrow" size={17}/>
  </a>;
}
export function Eyebrow({ children }: { children: React.ReactNode }) {
  return <span className="site-eyebrow"><span className="site-eyebrow-dot" />{children}</span>;
}
export function Brand() {
  return <a className="site-brand" href="/" aria-label="W-Bot home">
    <span className="site-brand-symbol">W</span>
    <span><strong>W-Bot</strong><small>BY SL OPTIONS</small></span>
  </a>;
}
export function Header({ page }: { page: Page }) {
  const [open, setOpen] = useState(false);
  const items: Array<[Page, string]> = [
    ["translation", "Translation"], ["alerts", "Smart Alerts"], ["how", "How it works"],
    ["pricing", "Pricing"], ["faq", "FAQ"]
  ];
  return <header className="site-header">
    <div className="site-container site-header-inner">
      <Brand/>
      <nav className={"site-nav" + (open ? " is-open" : "")} id="site-primary-nav" aria-label="Main navigation">
        {items.map(([key, label]) => <a key={key} href={routes[key]}
          aria-current={page === key ? "page" : undefined} onClick={() => setOpen(false)}>{label}</a>)}
        <a href="/contact/" className="site-nav-contact"
          aria-current={page === "contact" ? "page" : undefined}>Contact</a>
        <div className="site-nav-mobile-actions">
          <Action href="/portal/" secondary>Customer login</Action>
          <Action href="/contact/">Request access</Action>
        </div>
      </nav>
      <div className="site-header-actions">
        <a className="site-signin" href="/portal/">Customer login</a>
        <a className="site-header-cta" href="/contact/">Talk to our team <Icon name="arrow" size={15}/></a>
      </div>
      <button type="button" className="site-menu-toggle" aria-label={open ? "Close navigation" : "Open navigation"}
        aria-expanded={open} aria-controls="site-primary-nav" onClick={() => setOpen(value => !value)}>
        <Icon name={open ? "close" : "menu"} size={22}/>
      </button>
    </div>
  </header>;
}
export function Footer() {
  return <footer className="site-footer"><div className="site-container">
    <div className="site-footer-top">
      <div className="site-footer-brand"><Brand/>
        <p>Practical group translation and relevant message alerts, with clear control over the groups you authorize.</p>
        <span className="site-footer-status"><Icon name="info" size={14}/> Invite-only technical pilot</span>
      </div>
      <div className="site-footer-links">
        <div><strong>Platform</strong><a href="/translation/">Group Translation</a><a href="/smart-alerts/">Smart Alerts</a>
          <a href="/how-it-works/">How it works</a></div>
        <div><strong>Explore</strong><a href="/pricing/">Pricing</a><a href="/faq/">FAQ</a><a href="/trust/">Trust & transparency</a>
          <a href="/contact/">Contact</a></div>
        <div><strong>Account</strong><a href="/portal/">Customer portal</a>
          <a href="https://sloptions.xyz/" target="_blank" rel="noopener noreferrer">SL Options</a></div>
      </div>
    </div>
    <div className="site-footer-bottom">
      <span>© {new Date().getFullYear()} SL Options. W-Bot is a product of SL Options.</span>
      <span>Transparency note: linked-device access uses an unofficial WhatsApp Web gateway. W-Bot is not affiliated with or endorsed by Meta or WhatsApp.</span>
    </div>
  </div></footer>;
}
export function SectionHeading({ tag, title, description, center = false }: {
  tag: string; title: string; description?: string; center?: boolean;
}) {
  return <div className={"site-section-heading" + (center ? " is-centered" : "")}>
    <Eyebrow>{tag}</Eyebrow><h2>{title}</h2>{description && <p>{description}</p>}
  </div>;
}
export function Cta({ title = "A clearer way to work with your groups.", description = "Discuss your use case with our team. Access is invitation-based and each service is configured separately." }: {
  title?: string; description?: string;
}) {
  return <section className="site-container site-cta-wrap"><div className="site-cta">
    <div><Eyebrow>GET STARTED</Eyebrow><h2>{title}</h2><p>{description}</p></div>
    <div className="site-cta-actions"><Action href="/contact/">Request pilot access</Action>
      <Action href="/portal/" secondary>Open workspace</Action></div>
  </div></section>;
}
export function PageHero({ tag, title, description, children }: {
  tag: string; title: React.ReactNode; description: string; children?: React.ReactNode;
}) {
  return <section className="site-page-hero"><div className="site-container site-page-hero-inner">
    <div className="site-page-hero-copy"><Eyebrow>{tag}</Eyebrow><h1>{title}</h1>
      <p>{description}</p><div className="site-hero-actions"><Action href="/contact/">Request pilot access</Action>
        <Action href="/how-it-works/" secondary>How it works</Action></div></div>
    {children && <div className="site-page-hero-visual">{children}</div>}
  </div></section>;
}
export function FeatureGrid({ features }: { features: Array<{icon:string;title:string;body:string}> }) {
  return <div className="site-feature-grid">{features.map(item=><article className="site-feature-card" key={item.title}>
    <span className="site-feature-icon"><Icon name={item.icon} size={22}/></span>
    <h3>{item.title}</h3><p>{item.body}</p>
  </article>)}</div>;
}
