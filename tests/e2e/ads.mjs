/**
 * Browser test of Phase 34 — sponsored products:
 * FIRINGI — rules per placement; supplier (Portuguese) creates a per-click search ad and a booked
 * shop-home ad (cost shown), FIRINGI approves them; the customer sees "Patrocinado" products in search
 * results, on the shop home and as cart suggestions, and a click opens the product and is counted;
 * FIRINGI sets the supplier to prepaid, records a transfer (invoice-receipt, balance), invoices the
 * month's clicks; the supplier's billing page shows balance and invoices (PDF opens); per-supplier switch
 * off → no ads and no Advertising pages; phone width + dark.
 *   node tests/e2e/ads.mjs [baseUrl] [screenshotDir]
 */
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");

const BASE = process.argv[2] ?? "http://localhost:3000";
const SHOTS = process.argv[3] ?? null;
const PASSWORD = process.env.SEED_PASSWORD ?? "Firingi!2026";
let failures = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "✔" : "✘"} ${name}${extra ? ` — ${extra}` : ""}`); if (!ok) failures++; };
const shot = async (page, name, full = false) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: full });
const browser = await chromium.launch();
const settle = async (p) => { await p.waitForLoadState("networkidle").catch(() => {}); await p.waitForTimeout(400); };
const go = async (p, url) => { await p.goto(`${BASE}${url}`); await settle(p); };
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn().catch(() => false)) return true; await new Promise((r) => setTimeout(r, 250)); } return false; };
const errors = [];
async function login(email, { viewport = { width: 1280, height: 900 }, colorScheme = "light" } = {}) {
  const ctx = await browser.newContext({ viewport, colorScheme, reducedMotion: "reduce", deviceScaleFactor: SHOTS ? 2 : 1 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${email} @ ${page.url().replace(BASE, "")}: ${e.message.slice(0, 140)}`));
  await go(page, "/login");
  await page.fill("#email", email); await page.fill("#password", PASSWORD); await page.click("button[type=submit]");
  await page.waitForURL((u) => u.pathname !== "/login", { timeout: 15000 }).catch(() => {});
  await settle(page);
  return page;
}
const text = (p, id) => p.getByTestId(id).textContent();
const stamp = Date.now() % 100000;

const sa = await login("superadmin@firingi.test");
const lx = await login("owner@lisboacentral.test");
const k = await login("owner@kebabhouse.test");

// ── 1. FIRINGI: rules ──
await go(sa, "/admin/marketing/ads");
check("Sponsored Products: KPIs and placements (English)", (await sa.getByTestId("ads-kpis").count()) === 1 && (await sa.getByTestId("placement-SEARCH").count()) === 1 && /Ad revenue this month/.test(await sa.textContent("main")));
await sa.locator("#pl-SEARCH-cpc").fill("0.30");
await sa.getByTestId("ads-save").click();
check("rules saved", await until(async () => /Saved/.test(await text(sa, "ads-settings"))));
await shot(sa, "ads-01-admin-rules");

// ── 2. Supplier: a per-click search ad ──
await go(lx, "/vendor/ads");
check("supplier menu: Publicidade › Os Meus Anúncios", /Os meus anúncios/.test(await lx.textContent("main")));
await lx.getByTestId("new-ad").click();
await settle(lx);
const nameS = `Mozzarella no topo ${stamp}`;
await lx.locator("#ad-name").fill(nameS);
await lx.getByTestId("ad-placement-SEARCH").check();
await lx.getByTestId("ad-pricing-CPC").check();
await lx.locator("#ad-filter").fill("mozz");
await lx.getByTestId("ad-products").locator("label", { hasText: "Bloco 2kg (" }).locator('input[type="checkbox"]').first().check(); // the single block (in stock), not the case
await lx.locator("#ad-keywords").fill("queijo");
await lx.locator("#ad-bid").fill("0.50");
await lx.locator("#ad-daily").fill("5");
await shot(lx, "ads-02-supplier-new");
await lx.getByTestId("ad-submit").click();
check("ad sent, waiting for FIRINGI (Portuguese)", await until(async () => /\/vendor\/ads\/[a-z0-9]+$/.test(lx.url()) && /À espera da FIRINGI/.test(await text(lx, "ad-status"))));
const searchAdUrl = lx.url().replace(BASE, "");

// a booked shop-home ad: the cost is shown before sending
await go(lx, "/vendor/ads/new");
const nameH = `Destaque semana ${stamp}`;
await lx.locator("#ad-name").fill(nameH);
await lx.getByTestId("ad-placement-HOME").check();
await lx.getByTestId("ad-pricing-DAILY").check();
await lx.locator("#ad-filter").fill("mozz");
await lx.getByTestId("ad-products").locator("label", { hasText: "Bloco 2kg (" }).locator('input[type="checkbox"]').first().check();
check("booked days: cost shown (days × price)", /7 dias × 8,00\s€ = 56,00\s€/.test(await text(lx, "ad-daily-cost")), await text(lx, "ad-daily-cost"));
await lx.getByTestId("ad-submit").click();
await until(async () => /\/vendor\/ads\/[a-z0-9]+$/.test(lx.url()));

// ── 3. FIRINGI approves ──
await go(sa, "/admin/marketing/ads/review");
for (const n of [nameS, nameH]) {
  const row = sa.getByTestId("review-table").locator("tr", { hasText: n }).first();
  await row.getByTestId("approve").click();
  await until(async () => (await sa.getByTestId("review-table").locator("tr", { hasText: n }).count()) === 0);
}
check("both approved — review queue empty of them", (await sa.getByTestId("review-table").locator("tr", { hasText: String(stamp) }).count()) === 0);
await go(sa, "/admin/marketing/ads/campaigns");
await shot(sa, "ads-03-admin-campaigns");

// ── 4. Customer: sponsored in search, on the shop home, in the cart ──
await go(k, "/buy/catalogue/search?q=mozzarella");
const sp = k.getByTestId("sponsored-SEARCH");
check("search: a sponsored product, marked 'Patrocinado'", (await sp.count()) === 1 && /Patrocinado/.test(await sp.textContent()));
await shot(k, "ads-04-buyer-search");
await sp.getByTestId("sponsored-card").first().click();
check("click opens the product page", await until(async () => /\/buy\/catalogue\/offers\//.test(k.url())));
await go(k, "/buy/catalogue/browse");
check("shop home: 'Em destaque' with the booked ad", (await k.getByTestId("sponsored-HOME").count()) === 1 && /Em destaque/.test(await text(k, "sponsored-HOME")));
await shot(k, "ads-05-buyer-home");

await go(lx, searchAdUrl);
check("supplier sees the click and its cost", await until(async () => { await go(lx, searchAdUrl); return /Cliques\s*1/.test(await text(lx, "ad-kpis")) && /0,50\s€/.test(await text(lx, "ad-kpis")); }));
await shot(lx, "ads-06-supplier-ad");

// ── 5. Billing: prepaid top-up, month invoice ──
await go(sa, "/admin/marketing/ads/advertisers");
const row = () => sa.getByTestId("advertisers-table").locator("tr", { hasText: "Lisboa Central" }).first();
await row().getByTestId("billing-select").selectOption("PREPAID");
await settle(sa);
await go(sa, "/admin/marketing/ads/advertisers");
check("FIRINGI sets how it collects (prepaid)", (await row().getByTestId("billing-select").inputValue()) === "PREPAID");
await row().getByTestId("topup-amount").fill("12.30");
await row().getByTestId("topup-save").click();
check("transfer recorded → invoice-receipt", await until(async () => /invoice-receipt issued/.test(await row().textContent())));
await go(sa, "/admin/marketing/ads/advertisers");
check("balance 10,00 € (net of VAT)", /10\.00/.test((await row().textContent()).replace(/€\s?/g, "")) || /€10\.00/.test(await row().textContent()), (await row().textContent()).slice(0, 160));
await shot(sa, "ads-07-admin-advertisers");
await go(sa, "/admin/marketing/ads/invoices");
await sa.getByTestId("invoice-now").click();
check("month's clicks invoiced", await until(async () => { await go(sa, "/admin/marketing/ads/invoices"); return (await sa.getByTestId("ad-invoices-table").locator("tr", { hasText: "Month's ads" }).count()) >= 1; }, 30000));

await go(lx, "/vendor/ads/billing");
check("supplier billing: prepaid, balance and how to top up (Portuguese)", /Saldo pré-pago/.test(await text(lx, "billing-method")) && /10,00\s€/.test(await text(lx, "ad-balance")) && (await lx.getByTestId("topup-info").count()) === 1);
const invRows = lx.getByTestId("ad-invoices").locator("tbody tr");
check("supplier billing: the top-up and the month's invoice", (await invRows.count()) >= 2 && /Carregamento/.test(await lx.getByTestId("ad-invoices").textContent()));
const pdf = await lx.getByTestId("ad-invoices").locator("a[href*='/api/invoices/']").first().getAttribute("href");
check("supplier can open the invoice PDF", (await lx.request.get(`${BASE}${pdf}`)).status() === 200);
await shot(lx, "ads-08-supplier-billing");

// ── 6. Phone + dark ──
const kp = await login("owner@kebabhouse.test", { viewport: { width: 390, height: 844 }, colorScheme: "dark" });
await go(kp, "/buy/catalogue/search?q=mozzarella");
const over = await kp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check("phone width: no sideways scrolling (search with ads)", over <= 1, `${over}px`);
await shot(kp, "ads-09-phone-dark");
const lp = await login("owner@lisboacentral.test", { viewport: { width: 390, height: 844 }, colorScheme: "dark" });
await go(lp, "/vendor/ads/new");
const over2 = await lp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check("phone width: no sideways scrolling (new ad)", over2 <= 1, `${over2}px`);

// ── 7. Switched off for the supplier ──
await go(sa, "/admin/settings/business-features");
const bf = sa.getByTestId("business-features").locator("tr", { hasText: "Lisboa Central" }).first();
check("Business Features: Advertising on by default", (await bf.getByTestId("ads-switch").getAttribute("aria-checked")) === "true");
await bf.getByTestId("ads-switch").click();
await until(async () => (await bf.getByTestId("ads-switch").getAttribute("aria-checked")) === "false");
await go(k, "/buy/catalogue/search?q=mozzarella");
check("switched off: no sponsored products", (await k.getByTestId("sponsored-SEARCH").count()) === 0);
check("switched off: supplier's Advertising pages gone", (await lx.request.get(`${BASE}/vendor/ads`)).status() === 404);
await bf.getByTestId("ads-switch").click();
await until(async () => (await bf.getByTestId("ads-switch").getAttribute("aria-checked")) === "true");

// tidy: end both, back to monthly invoice
for (const n of [nameS, nameH]) {
  await go(sa, "/admin/marketing/ads/campaigns");
  await sa.getByTestId("campaigns-table").locator("a", { hasText: n }).first().click();
  await settle(sa);
  const end = sa.getByTestId("staff-end");
  if (await end.count()) { await end.click(); await settle(sa); }
}
check("campaigns ended by FIRINGI", /Ended/.test(await text(sa, "campaign-status")));

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nall ads checks passed");
process.exit(failures ? 1 : 0);
