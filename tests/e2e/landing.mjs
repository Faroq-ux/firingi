/**
 * Browser test of Phase 56 (landing page), as a visitor and as FIRINGI (English):
 *  the main page (top, numbers, 14 categories, buy/till/manage/save, steps, FAQ, footer with 8 contact/social icons),
 *  the language switch (Portuguese), a question → CRM lead, the seller page (/sell) → vendor application lead,
 *  newsletter double opt-in (confirm + leave), the GDPR privacy page, phone layout (menu, no sideways scroll),
 *  FIRINGI's colours on a dark-mode device, signed-in users sent to their portal; FIRINGI switches a section off,
 *  writes its own Portuguese headline, sets WhatsApp (floating button), sees the subscriber; no page errors.
 *   node tests/e2e/landing.mjs [baseUrl] [screenshotDir]
 */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
const { chromium, devices } = createRequire(import.meta.url)("playwright");

const DB = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/firingi";
const sql = (q) => execFileSync("psql", ["-At", DB, "-c", q], { encoding: "utf8" }).trim();
const BASE = process.argv[2] ?? "http://localhost:3000";
const SHOTS = process.argv[3] ?? null;
const PASSWORD = process.env.SEED_PASSWORD ?? "Firingi!2026";
let failures = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "✔" : "✘"} ${name}${extra ? ` — ${extra}` : ""}`); if (!ok) failures++; };
const shot = async (page, name, full = false) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: full });
const settle = async (p) => { await p.waitForLoadState("networkidle").catch(() => {}); await p.waitForTimeout(600); };
const go = async (p, url) => { await p.goto(`${BASE}${url}`, { timeout: 120000 }); await settle(p); };
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn().catch(() => false)) return true; await new Promise((r) => setTimeout(r, 400)); } return false; };

const stamp = Date.now();
const mail = (n) => `e2e-p56-${n}-${stamp}@example.test`;
const saved = sql(`select value::text from "Setting" where scope='GLOBAL' and "scopeId"='' and key='landing.settings'`);
function restore() {
  const ids = sql(`select coalesce(string_agg('''' || id || '''', ','), '') from "Lead" where email like 'e2e-p56-%'`);
  if (ids) { sql(`delete from "CrmActivity" where "leadId" in (${ids})`); sql(`delete from "CrmContact" where "leadId" in (${ids})`); sql(`delete from "Lead" where id in (${ids})`); }
  sql(`delete from "NewsletterSubscriber" where email like 'e2e-p56-%'`);
  if (saved) sql(`update "Setting" set value='${saved.replace(/'/g, "''")}'::jsonb where scope='GLOBAL' and "scopeId"='' and key='landing.settings'`);
  else sql(`delete from "Setting" where scope='GLOBAL' and "scopeId"='' and key='landing.settings'`);
}
restore();
process.on("exit", restore);
sql(`delete from "Setting" where scope='GLOBAL' and "scopeId"='' and key='landing.settings'`);

const browser = await chromium.launch();
const errors = [];
async function visitor(opts = {}, locale = "en") {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...opts });
  await ctx.addCookies([{ name: "NEXT_LOCALE", value: locale, url: BASE }]);
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(`visitor @ ${p.url().replace(BASE, "")}: ${e.message.slice(0, 140)}`));
  return p;
}
async function login(email) {
  const p = await (await browser.newContext({ viewport: { width: 1440, height: 950 }, reducedMotion: "reduce" })).newPage();
  p.on("pageerror", (e) => errors.push(`${email} @ ${p.url().replace(BASE, "")}: ${e.message.slice(0, 140)}`));
  p.on("dialog", (d) => d.accept());
  await go(p, "/login");
  await p.fill("#email", email); await p.fill("#password", PASSWORD); await p.click("button[type=submit]");
  await p.waitForURL((u) => u.pathname !== "/login", { timeout: 30000 }).catch(() => {});
  await settle(p);
  return p;
}
const scrollAll = async (p) => { const h = await p.evaluate(() => document.body.scrollHeight); for (let y = 0; y < h; y += 500) { await p.evaluate((v) => window.scrollTo(0, v), y); await p.waitForTimeout(60); } };

// ── 1. the main page ─────────────────────────────────────────────────────────
const v = await visitor();
await go(v, "/");
check("visitors see the landing page at the main address", (await v.getByTestId("landing-h1").innerText()).includes("restock"));
check("the numbers strip, 14 categories and the four sections show", (await v.locator(".fa-stats > div").count()) === 4 && (await v.locator(".fa-marq .fa-cat:not([aria-hidden=true])").count()) === 14
  && (await v.locator("#buy, #till, #manage, #save").count()) === 4);
check("the dashboard pictures are drawn (sidebar, overview numbers, till ticket)", (await v.locator(".fg-dside").count()) >= 5 && (await v.locator(".fg-hero2 .k").count()) === 4 && (await v.locator(".fa-pos .tk").count()) === 1);
check("the footer has 'Become a supplier' and 'Supplier plans'", (await v.locator("footer").innerText()).includes("Become a supplier") && (await v.locator("footer").innerText()).includes("Supplier plans"));
check("the footer shows email, phone, WhatsApp and 5 social icons", (await v.getByTestId("landing-social").locator("a, span.off").count()) === 8);
check("no 'before IVA' and one €150 minimum for the whole cart (after the numbers count up)", !(await v.content()).includes("before IVA") && await until(async () => (await v.locator(".fa-stats").innerText()).includes("€150"), 6000));
await scrollAll(v); await shot(v, "p56-01-main", true);

// ── 2. language ─────────────────────────────────────────────────────────────
await v.getByTestId("landing-lang").first().selectOption("pt-PT");
check("the language switch shows the page in Portuguese", await until(async () => (await v.getByTestId("landing-h1").innerText()).includes("Compre")));
await v.getByTestId("landing-lang").first().selectOption("de");
check("…and in German", await until(async () => !(await v.getByTestId("landing-h1").innerText()).includes("restock") && !(await v.getByTestId("landing-h1").innerText()).includes("Compre")));
await v.getByTestId("landing-lang").first().selectOption("en");
await until(async () => (await v.getByTestId("landing-h1").innerText()).includes("restock"));

// ── 3. question → CRM ───────────────────────────────────────────────────────
await go(v, "/#contact");
await v.waitForTimeout(3000); // people need a few seconds; the form refuses robots that are faster
const f = v.getByTestId("contact-form");
await f.locator("input[name=name]").fill("Ana E2E"); await f.locator("input[name=company]").fill("Café E2E");
await f.locator("input[name=email]").fill(mail("q")); await f.locator("textarea[name=message]").fill("Do you deliver to Porto?");
await f.getByTestId("contact-send").click();
check("a question without consent is refused", await until(async () => (await v.getByTestId("contact-msg").innerText()).length > 0) && sql(`select count(*) from "Lead" where email='${mail("q")}'`) === "0");
await f.locator("input[name=consent]").check(); await f.getByTestId("contact-send").click();
check("a question becomes a website lead in CRM", await until(async () => sql(`select source || ':' || kind from "Lead" where email='${mail("q")}'`) === "WEBSITE:CUSTOMER"));

// ── 4. the seller page → vendor application ─────────────────────────────────
await go(v, "/sell");
check("the seller page shows the two supplier types (wholesaler, distributor) and the application form", (await v.getByTestId("sell-type-wholesaler").count()) === 1 && (await v.getByTestId("sell-type-distributor").count()) === 1 && (await v.getByTestId("vendor-form").count()) === 1);
check("…each type opens its own registration", (await v.getByTestId("sell-type-wholesaler").locator("a").getAttribute("href")) === "/register/wholesaler" && (await v.getByTestId("sell-type-distributor").locator("a").getAttribute("href")) === "/register/distributor");
await v.waitForTimeout(3000);
const vf = v.getByTestId("vendor-form");
await vf.getByTestId("vendor-type").selectOption("DISTRIBUTOR");
await vf.locator("input[name=name]").fill("Rui E2E"); await vf.locator("input[name=company]").fill("Mar E2E Lda");
await vf.locator("input[name=email]").fill(mail("v")); await vf.locator("input[name=nif]").fill("509123456");
await vf.locator("input[name=consent]").check(); await vf.getByTestId("contact-send").click();
check("a vendor application becomes a distributor lead with the NIF", await until(async () => sql(`select kind from "Lead" where email='${mail("v")}'`) === "DISTRIBUTOR")
  && sql(`select count(*) from "CrmActivity" a join "Lead" l on l.id=a."leadId" where l.email='${mail("v")}' and a.body like '%NIF 509123456%'`) === "1");
await scrollAll(v); await shot(v, "p56-02-sell", true);

// ── 5. newsletter (double opt-in) ───────────────────────────────────────────
await go(v, "/#newsletter");
await v.waitForTimeout(3000);
const nf = v.getByTestId("news-form");
await nf.locator("input[name=email]").fill(mail("n")); await nf.locator("input[name=consent]").check(); await nf.getByTestId("news-send").click();
check("a newsletter sign-up waits for the e-mail confirmation", await until(async () => sql(`select status from "NewsletterSubscriber" where email='${mail("n")}'`) === "PENDING"));
const token = sql(`select token from "NewsletterSubscriber" where email='${mail("n")}'`);
await go(v, `/newsletter/confirm?t=${token}`);
check("the link in the e-mail confirms it", sql(`select status from "NewsletterSubscriber" where email='${mail("n")}'`) === "CONFIRMED");
await go(v, `/newsletter/unsubscribe?t=${token}`);
check("…and the link in every e-mail lets them leave", sql(`select status from "NewsletterSubscriber" where email='${mail("n")}'`) === "UNSUBSCRIBED");
sql(`update "NewsletterSubscriber" set status='CONFIRMED', "unsubscribedAt"=null where email='${mail("n")}'`);

// ── 6. legal pages ──────────────────────────────────────────────────────────
await go(v, "/legal/privacy");
check("the privacy policy (GDPR) is there", (await v.content()).includes("GDPR"));

// ── 7. phone, dark-mode device ──────────────────────────────────────────────
const ph = await visitor({ ...devices["iPhone 13"] });
await go(ph, "/");
check("on a phone nothing scrolls sideways", await ph.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
await ph.getByTestId("landing-burger").click();
check("…and the menu opens", await ph.locator(".fg-drawer.open").isVisible());
await shot(ph, "p56-03-phone");
const dk = await visitor({ colorScheme: "dark" });
await go(dk, "/");
check("on a dark-mode device the page keeps FIRINGI's colours (white, red)", (await dk.locator(".fa").evaluate((e) => getComputedStyle(e).backgroundColor)) === "rgb(255, 255, 255)"
  && (await dk.locator(".fa-hero h1 .hl").evaluate((e) => getComputedStyle(e).color)) === "rgb(217, 35, 26)");

// ── 8. signed-in users go to their portal ───────────────────────────────────
const ow = await login("owner@kebabhouse.test");
await go(ow, "/");
check("a signed-in customer opening the main address lands in their portal", new URL(ow.url()).pathname.startsWith("/buy"));

// ── 9. FIRINGI edits the page ───────────────────────────────────────────────
const sa = await login("superadmin@firingi.test");
await go(sa, "/admin/marketing/landing");
await sa.getByTestId("ls-sec-cats").uncheck();
await sa.getByTestId("ls-wa").fill("+351 912 345 678");
await sa.getByTestId("ls-wa-vendors").fill("+351 913 000 000");
await sa.getByTestId("ls-save").click();
check("FIRINGI saves sections and WhatsApp", await until(async () => sql(`select value->>'whatsapp' || ':' || (value->'sections'->>'cats') from "Setting" where key='landing.settings'`) === "351912345678:false"));
await go(v, "/");
check("…the categories leave the page and the WhatsApp button appears", (await v.locator(".fa-cats").count()) === 0 && (await v.getByTestId("landing-float").count()) === 1);
check("…customers get the customers' WhatsApp", (await v.getByTestId("landing-float").getAttribute("href")) === "https://wa.me/351912345678");
await go(v, "/sell");
check("…and suppliers get the suppliers' WhatsApp on the supplier page", (await v.getByTestId("landing-float").getAttribute("href")) === "https://wa.me/351913000000");
await shot(sa, "p56-04-admin");
await go(sa, "/admin/marketing/landing?lang=pt-PT#texts");
await sa.getByTestId("lt-search").fill("app.hero.h1b");
await sa.getByTestId("lt-app.hero.h1b").fill("a sua loja");
await sa.getByTestId("lt-save").click();
check("FIRINGI writes its own Portuguese headline", await until(async () => sql(`select value->'texts'->'pt-PT'->>'app.hero.h1b' from "Setting" where key='landing.settings'`) === "a sua loja"));
const vp = await visitor({}, "pt-PT");
await go(vp, "/");
check("…and Portuguese visitors see it", (await vp.getByTestId("landing-h1").innerText()).includes("a sua loja"));
await go(sa, "/admin/marketing/newsletter");
check("FIRINGI sees the newsletter subscriber", (await sa.getByTestId("news-table").innerText()).includes(mail("n")));
await shot(sa, "p56-05-newsletter");

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nAll landing checks passed");
process.exit(failures ? 1 : 0);
