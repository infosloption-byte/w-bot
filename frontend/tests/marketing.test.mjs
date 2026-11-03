import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const read = file => readFileSync(fileURLToPath(new URL("../" + file, import.meta.url)), "utf8");

const pages = [
  ["index", "/"], ["translation", "/translation/"], ["smart-alerts", "/smart-alerts/"],
  ["pricing", "/pricing/"], ["how-it-works", "/how-it-works/"],
  ["faq", "/faq/"], ["contact", "/contact/"]
];
const nginx = read("nginx.conf");
const vite = read("vite.config.ts");
const docker = read("Dockerfile");
const site = read("src/marketing-main.tsx");
const shared = read("src/marketing-shared.tsx");
const home = read("src/marketing-home.tsx");
const info = read("src/marketing-info.tsx");
const css = read("src/marketing.css");

test("seven public marketing routes have unique SEO meta, canonical URL and a real JS entry", () => {
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
  assert.ok(home.includes("Every message understood."));
  assert.ok(info.includes('href="https://sloptions.xyz/contact"'));
  assert.ok(info.includes("online checkout is not available yet"));
  assert.ok(info.includes("Smart Alerts is a separate subscription."));
  assert.ok(info.includes('fetch("/portal/api/plans"'));
  assert.ok(info.includes("Unofficial") || info.includes("unofficial"));
});
test("marketing responsive behavior includes mobile nav and reduced-motion fallback", () => {
  assert.ok(shared.includes('aria-expanded={open}'));
  assert.ok(shared.includes('aria-controls="site-primary-nav"'));
  assert.ok(css.includes("@media(max-width:900px)"));
  assert.ok(css.includes("@media(max-width:480px)"));
  assert.ok(css.includes("prefers-reduced-motion"));
  assert.ok(css.includes(".site-skip-link"));
});
