import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const read = file => readFileSync(fileURLToPath(new URL("../" + file, import.meta.url)), "utf8");

const pages = [
  ["index", "/"], ["translation", "/translation/"], ["smart-alerts", "/smart-alerts/"],
  ["pricing", "/pricing/"], ["how-it-works", "/how-it-works/"],
  ["faq", "/faq/"], ["contact", "/contact/"], ["trust", "/trust/"]
];
const nginx = read("nginx.conf");
const vite = read("vite.config.ts");
const docker = read("Dockerfile");
const site = read("src/marketing-main.tsx");
const shared = read("src/marketing-shared.tsx");
const home = read("src/marketing-home.tsx");
const info = read("src/marketing-info.tsx");
const css = read("src/marketing.css");

test("eight public marketing routes have unique SEO meta, canonical URL and a real JS entry", () => {
  const titles = new Set();
  for (const [filename, url] of pages) {
    const html = read("marketing/" + filename + ".html");
    const title = html.match(/<title>([^<]+)<\/title>/)?.[1];
    assert.ok(title && !titles.has(title), filename + " title");
    titles.add(title);
    assert.ok(html.includes('<link rel="canonical" href="https://wbot.sloptions.xyz' + url + '"'), filename + " canonical");
    assert.ok(html.includes('name="description" content="'), filename + " description");
    assert.ok(html.includes('property="og:title"'), filename + " OG");
    assert.ok(html.includes('src="/src/marketing-main.tsx"'), filename + " entry");
  }
});
test("Vite and Docker build all marketing documents alongside existing portal entries", () => {
  assert.match(vite, /customer: "index\.html"/);
  assert.match(vite, /platform: "platform\.html"/);
  for (const [filename] of pages) assert.ok(vite.includes("marketing/" + filename + ".html"));
  assert.ok(docker.includes("COPY marketing ./marketing"));
  assert.ok(docker.includes("COPY public ./public"));
  assert.ok(docker.includes("COPY nginx.conf Dockerfile ./"), "build must copy test-inspected Nginx and Dockerfile configs");
  assert.ok(docker.includes("COPY --from=build /app/dist /usr/share/nginx/html/portal"));
});
test("public marketing routes never replace platform admin and authenticated API protections", () => {
  assert.ok(nginx.includes("location = / { try_files /portal/marketing/index.html =404; }"));
  for (const [filename, url] of pages.slice(1)) {
    assert.ok(nginx.includes("location = " + url + " { try_files /portal/marketing/" + filename + ".html =404; }"));
  }
  assert.ok(nginx.includes("location /portal/api/"));
  assert.ok(nginx.includes("location /portal/ {"));
  assert.ok(nginx.includes("location /portal/platform/"));
  assert.ok(nginx.includes("location ^~ /portal/marketing/ { return 404; }"));
  assert.ok(nginx.includes('Content-Security-Policy'));
});
test("SEO assets are public while customer portal is excluded from indexing", () => {
  const sitemap = read("public/sitemap.xml");
  for (const [, url] of pages) assert.ok(sitemap.includes("https://wbot.sloptions.xyz" + url));
  const robots = read("public/robots.txt");
  assert.ok(robots.includes("Disallow: /portal/"));
  assert.ok(robots.includes("Allow: /portal/assets/"));
  assert.ok(nginx.includes("location = /sitemap.xml"));
  assert.ok(nginx.includes("location = /robots.txt"));
  assert.ok(read("public/favicon.svg").includes("<svg"));
});
test("public site has functional navigation, real customer login and honest pilot CTAs", () => {
  assert.ok(site.includes("<Header page={currentPage}/>"));
  for (const label of ["Translation","Smart Alerts","How it works","Pricing","FAQ"]) assert.ok(shared.includes(label), label);
  assert.ok(shared.includes('href="/portal/"'));
  assert.ok(shared.includes('href="/contact/"'));
  assert.ok(home.includes("More clarity from every"));
  assert.ok(info.includes('href="https://sloptions.xyz/contact"'));
  assert.ok(info.includes("online checkout is not available yet"));
  assert.ok(info.includes("Smart Alerts is a separate subscription."));
  assert.ok(info.includes('fetch("/portal/api/plans"'));
  assert.ok(info.includes("Unofficial") || info.includes("unofficial"));
  assert.ok(shared.includes("Trust & transparency"));
  assert.ok(site.includes('currentPage === "trust"'));
});
test("marketing responsive behavior includes mobile nav and reduced-motion fallback", () => {
  assert.ok(shared.includes('aria-expanded={open}'));
  assert.ok(shared.includes('aria-controls="site-primary-nav"'));
  assert.ok(css.includes("@media(max-width:900px)"));
  assert.ok(css.includes("@media(max-width:480px)"));
  assert.ok(css.includes("prefers-reduced-motion"));
  assert.ok(css.includes(".site-skip-link"));
});

test("professional design exposes grounded trust controls instead of unsupported certifications",()=>{
  const trust = read("src/marketing-trust.tsx");
  for(const phrase of ["Customer-owned WhatsApp connections", "Explicit group selection",
    "Independent service permissions", "External AI services", "Important service limitations"])
    assert.ok(trust.includes(phrase), phrase);
  for(const phrase of ["site-trust-section", "site-trust-grid", "site-trust-disclosure"])
    assert.ok(home.includes(phrase), phrase);
  assert.ok(css.includes("--m-brand:#4f46e5") && css.includes("--m-teal:#0d9488"));
  assert.ok(css.includes("background:#fff"));
  assert.ok(!css.includes("filter:blur(60px)"));
  assert.ok(!css.includes("transform:rotate(-1deg)"));
});

test("homepage moves directly from the hero into the service overview, without the old control strip",()=>{
  assert.ok(!home.includes('className="site-value-strip"'));
  assert.ok(!home.includes("Group authorization controls"));
  assert.ok(!home.includes("Customer-owned connections</span>"));
  assert.ok(!home.includes("Separate service permissions</span>"));
  assert.ok(!css.includes(".site-value-strip"));
  assert.ok(!css.includes(".site-value-inner"));
  assert.ok(home.includes("site-trust-section"), "full trust and transparency section remains available");
});

test("marketing theme does not change authenticated customer and platform layouts",()=>{
  const customer=read("src/main.tsx");
  const platform=read("src/platform-main.tsx");
  assert.ok(!customer.includes('import "./marketing.css"'));
  assert.ok(!platform.includes('import "./marketing.css"'));
  assert.ok(nginx.includes("location /portal/api/"));
  assert.ok(nginx.includes("location /portal/platform/"));
});

test("PR17 illustrations and current trust/strip requirements coexist",()=>{
  const graphics=read("src/marketing-graphics.tsx");
  const demos=read("src/marketing-demos.tsx");
  for(const component of ["HeroScene","Overview","UseCaseGrid","LanguageFan","AlertsFilter","InboxMock","Flow","MiniTranslation","MiniAlert"])
    assert.ok(graphics.includes("export function "+component), component);
  assert.ok(home.includes("<HeroScene/>") && home.includes("<Overview/>"));
  assert.ok(home.includes("site-trust-section"));
  assert.ok(!home.includes("site-value-strip"));
  assert.ok(!css.includes(".site-value-inner"));
  assert.ok(demos.includes("<MiniTranslation/>") && demos.includes("<MiniAlert/>"));
  assert.ok(css.includes(".gx-scene") && css.includes(".site-trust-detail"));
});
