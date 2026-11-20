/**
 * Browser test of Phase 38 — clearance deals.
 * FIRINGI (English) switches whole-lot deals off and lets deals up to 30 % off / 14 days start by themselves.
 * The supplier (Portuguese) creates a flash price, volume prices and a best-offer deal (they start by themselves)
 * and a deep flash price (waits for FIRINGI); whole lot is not offered. FIRINGI approves the deep one with its own
 * commission. The customer (Portuguese) sees the deals page, badges on product cards and the product page, adds
 * the flash product at the deal price, sees why the volume price doesn't apply yet, makes an offer; the supplier
 * counters, the customer takes it and orders — order lines carry the deal and its commission. Watchlist and daily
 * digest are saved; the supplier ends a deal and it leaves the deals page; the hourly job runs. Phone + dark.
 *   node tests/e2e/deals.mjs [baseUrl] [screenshotDir]
 */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
const { chromium } = createRequire(import.meta.url)("playwright");

const BASE = process.argv[2] ?? "http://localhost:3000";
const SHOTS = process.argv[3] ?? null;
const PASSWORD = process.env.SEED_PASSWORD ?? "Firingi!2026";
const DB = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/firingi";
const CRON = process.env.CRON_SECRET ?? "test-cron-secret-0123456789abcdef";
let failures = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "✔" : "✘"} ${name}${extra ? ` — ${extra}` : ""}`); if (!ok) failures++; };
const shot = async (page, name, full = false) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: full });
const browser = await chromium.launch();
const settle = async (p) => { await p.waitForLoadState("networkidle").catch(() => {}); await p.waitForTimeout(400); };
const go = async (p, url) => { await p.goto(`${BASE}${url}`); await settle(p); };
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn().catch(() => false)) return true; await new Promise((r) => setTimeout(r, 300)); } return false; };
const sql = (q) => execFileSync("psql", ["-At", DB, "-c", q], { encoding: "utf8" }).trim();
const errors = [];
// the deals this run creates end when it ends — so other suites buying the same products aren't capped by them
const startedAt = sql(`select to_char(now() at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS.MS')`);
process.on("exit", () => { try { sql(`update "ClearanceDeal" set status='ENDED' where "createdAt" >= '${startedAt}' and status in ('APPROVED','PENDING','DRAFT')`); } catch { /* best effort */ } });
async function login(email, { viewport = { width: 1280, height: 900 }, colorScheme = "light", locale = null } = {}) {
  const ctx = await browser.newContext({ viewport, colorScheme, reducedMotion: "reduce", deviceScaleFactor: SHOTS ? 2 : 1 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${email} @ ${page.url().replace(BASE, "")}: ${e.message.slice(0, 140)}`));
  await go(page, "/login");
  await page.fill("#email", email); await page.fill("#password", PASSWORD); await page.click("button[type=submit]");
  await page.waitForURL((u) => u.pathname !== "/login", { timeout: 15000 }).catch(() => {});
  if (locale) await ctx.addCookies([{ name: "NEXT_LOCALE", value: locale, url: BASE }]);
  await settle(page);
  return page;
}

// ── test data: four of Lisboa Central's products with list prices and stock; Kebab House starts with an empty cart ──
const lisboa = sql(`select id from "Company" where "legalName" like '%Lisboa Central%' limit 1`);
const kebab = sql(`select id from "Company" where "legalName" like 'Kebab House%' limit 1`);
const offerFor = (sku) => sql(`select o.id from "VendorOffer" o where o."vendorCompanyId"='${lisboa}' and o."vendorSku"='${sku}' and o.status='ACTIVE'
  and exists (select 1 from "PriceListItem" i join "PriceList" l on l.id=i."priceListId" where i."offerId"=o.id and l.scope='BASE' and l."isActive") limit 1`);
const MOZZ = offerFor("GRO-MOZZ2"), ARROZ = offerFor("GRO-ARROZ1"), AZEITE = offerFor("GRO-AZEITE75"), LUSO = offerFor("GRO-LUSO15");
check("test products found", [MOZZ, ARROZ, AZEITE, LUSO].every(Boolean), [MOZZ, ARROZ, AZEITE, LUSO].join(","));
const list = (o) => Number(sql(`select i."unitPriceNet" from "PriceListItem" i join "PriceList" l on l.id=i."priceListId" where i."offerId"='${o}' and l.scope='BASE' and l."isActive" and i."minQty"<=1 order by i."minQty" desc limit 1`));
const [mozzList, arrozList, azeiteList, lusoList] = [list(MOZZ), list(ARROZ), list(AZEITE), list(LUSO)];
for (const o of [MOZZ, ARROZ, AZEITE, LUSO]) sql(`update "StockLevel" set "onHand" = greatest("onHand", reserved + 300) where "offerId"='${o}'`);
sql(`delete from "CartItem" where "cartId" in (select id from "Cart" where "buyerCompanyId"='${kebab}')`);
sql(`update "Cart" set "couponCode" = null, "loyaltyPoints" = 0 where "buyerCompanyId"='${kebab}'`);
const r2 = (n) => Math.round(n * 100) / 100;
const MOZZ_DEAL = r2(mozzList * 0.82), LUSO_DEAL = r2(lusoList * 0.55), FLOOR = r2(azeiteList * 0.92), BID = r2(azeiteList * 0.8), COUNTER = r2(azeiteList * 0.88);
const pt = (n) => n.toFixed(2).replace(".", ",");
const dealOf = (o, col = "status") => sql(`select "${col}" from "ClearanceDeal" where "offerId"='${o}' order by "createdAt" desc limit 1`);

// ── 1. FIRINGI: deal settings (English) ──
const admin = await login("superadmin@firingi.test", { locale: "en" });
await go(admin, "/admin/pricing/deals/settings");
check("settings: all five kinds offered", (await admin.locator("[data-testid^=kind-]").count()) === 5);
await admin.getByTestId("kind-LOT").uncheck();
await admin.selectOption("#ds-mode", "AUTO");
await admin.fill("#ds-maxpct", "30");
await admin.fill("#ds-maxdays", "14");
await admin.getByTestId("ds-save").click();
check("settings saved", await until(async () => (await admin.locator("[data-testid=deal-settings] [role=status]").count()) > 0));
const saved = JSON.parse(sql(`select value from "Setting" where key='deals.settings'`) || "{}");
check("settings: whole lot off, auto up to 30 %", saved.kinds?.LOT === false && saved.approval?.maxDiscountPct === 30 && saved.approval?.mode === "AUTO");
await shot(admin, "deals-01-settings", true);

// ── 2. Supplier creates deals (Portuguese) ──
const lx = await login("owner@lisboacentral.test", { locale: "pt-PT" });
await go(lx, "/vendor/products/deals");
check("supplier page in Portuguese", /Oportunidades de escoamento/.test(await lx.textContent("main")));
const kinds = await lx.locator("[data-testid=nd-kind] option").evaluateAll((os) => os.map((o) => o.value));
check("whole lot isn't offered to the supplier", !kinds.includes("LOT") && kinds.includes("FLASH") && kinds.includes("BEST_OFFER"), kinds.join(","));
let infoText = "";
async function newDeal(offerId, kind, fill) {
  await go(lx, "/vendor/products/deals");
  await lx.selectOption("[data-testid=nd-offer]", offerId);
  await lx.getByTestId("nd-info").waitFor({ timeout: 15000 });
  await lx.selectOption("[data-testid=nd-kind]", kind);
  await fill();
  infoText = await lx.getByTestId("nd-info").textContent();
  await lx.getByTestId("nd-submit").click();
  return until(async () => (await lx.locator("[data-testid=new-deal] [role=status]").count()) > 0 || (await lx.locator("[data-testid=new-deal] [role=alert]").count()) > 0);
}
await newDeal(MOZZ, "FLASH", async () => { await lx.fill("#nd-dealPrice", String(MOZZ_DEAL)); await lx.fill("#nd-maxQty", "40"); await lx.fill("#nd-perBuyerMax", "20"); await lx.fill("#nd-title", `Mozzarella ${Date.now() % 1000}`); });
check("supplier sees the discount and FIRINGI's commission before creating", /% de desconto/.test(infoText) && /Comissão da FIRINGI/.test(infoText), infoText);
check("flash price (−18 %) started by itself", await until(async () => dealOf(MOZZ) === "APPROVED"), dealOf(MOZZ));
await newDeal(ARROZ, "VOLUME", async () => { await lx.getByTestId("tier-price-0").fill(String(r2(arrozList * 0.9))); await lx.getByTestId("tier-price-1").fill(String(r2(arrozList * 0.8))); });
check("volume prices started by themselves", await until(async () => dealOf(ARROZ) === "APPROVED"), dealOf(ARROZ));
await newDeal(AZEITE, "BEST_OFFER", async () => { await lx.fill("#nd-floorPrice", String(FLOOR)); await lx.fill("#nd-minBidQty", "2"); });
check("best offer started by itself", await until(async () => dealOf(AZEITE) === "APPROVED"), dealOf(AZEITE));
await newDeal(LUSO, "FLASH", async () => { await lx.fill("#nd-dealPrice", String(LUSO_DEAL)); });
check("deep flash price (−45 %) waits for FIRINGI", await until(async () => dealOf(LUSO) === "PENDING"), dealOf(LUSO));
await lx.getByTestId("nd-info").waitFor({ timeout: 2000 }).catch(() => {});
await go(lx, "/vendor/products/deals");
check("supplier list shows the four deals", (await lx.getByTestId("vendor-deal").count()) >= 4);
await shot(lx, "deals-02-supplier", true);
// too-small discount refused
await newDeal(MOZZ, "FLASH", async () => { await lx.fill("#nd-dealPrice", String(r2(mozzList * 0.99))); });
check("a 1 % discount is refused", (await lx.locator("[data-testid=new-deal] [role=alert]").count()) > 0);

// ── 3. FIRINGI approves the deep deal with its own commission ──
await go(admin, "/admin/pricing/deals");
check("admin: KPIs", (await admin.getByTestId("deal-kpis").count()) === 1);
const pending = admin.getByTestId("admin-deal").filter({ hasText: /Luso/ });
check("admin: the deep deal waits for a decision", (await pending.count()) === 1);
await shot(admin, "deals-03-admin-review", true);
await pending.getByTestId("review-pct").fill("5");
await pending.getByTestId("review-approve").click();
check("admin approved it at 5 % commission", await until(async () => dealOf(LUSO) === "APPROVED" && Number(dealOf(LUSO, "commissionPct")) === 5), `${dealOf(LUSO)} ${dealOf(LUSO, "commissionPct")}`);
await go(admin, "/admin/pricing/deals?status=LIVE");
check("admin: four live deals", (await admin.getByTestId("admin-deal").count()) >= 4);

// ── 4. Customer: deals page, badges, cart at the deal price (Portuguese) ──
const kb = await login("owner@kebabhouse.test", { locale: "pt-PT" });
await go(kb, "/buy/catalogue/clearance");
const cards = kb.getByTestId("deal-card");
check("customer sees the four deals", (await cards.count()) >= 4, String(await cards.count()));
const mozzCard = cards.filter({ hasText: /Mozzarella/ });
check("flash card shows −18 % and the deal price", /−\d+ %/.test(await mozzCard.getByTestId("deal-pct").textContent()) && (await mozzCard.getByTestId("deal-price").textContent()).includes(pt(MOZZ_DEAL)));
check("commission is never shown to the customer", !/comiss/i.test(await kb.textContent("main")));
await shot(kb, "deals-04-customer", true);
await go(kb, "/buy/catalogue/clearance?kind=FLASH");
check("filter: flash deals only", (await cards.count()) === 2);
await go(kb, "/buy/catalogue/clearance");
await mozzCard.getByTestId("deal-qty").fill("2");
await mozzCard.getByTestId("deal-add").click();
check("flash product added", await until(async () => (await mozzCard.locator("[role=status]").count()) > 0));
const arrozCard = cards.filter({ hasText: /Arroz/ });
await arrozCard.getByTestId("deal-qty").fill("1");
await arrozCard.getByTestId("deal-add").click();
await until(async () => (await arrozCard.locator("[role=status]").count()) > 0);
// best offer below the floor waits for the supplier
const azCard = cards.filter({ hasText: /Azeite/ });
await azCard.getByTestId("bid-qty").fill("5");
await azCard.getByTestId("bid-price").fill(String(BID));
await azCard.getByTestId("bid-send").click();
check("offer sent, waits for the supplier", await until(async () => sql(`select status from "ClearanceBid" where "buyerCompanyId"='${kebab}' order by "createdAt" desc limit 1`) === "PENDING"));
// watchlist + digest
await mozzCard.getByTestId("watch-supplier").click();
check("supplier watched", await until(async () => sql(`select count(*) from "ClearanceWatch" w join "User" u on u.id=w."userId" where u.email='owner@kebabhouse.test' and w.kind='SUPPLIER'`) === "1"));
await go(kb, "/buy/catalogue/clearance");
await kb.getByTestId("digest-switch").check();
check("daily digest on", await until(async () => sql(`select count(*) from "ClearanceDigestOptIn" d join "User" u on u.id=d."userId" where u.email='owner@kebabhouse.test'`) === "1"));
await go(kb, "/buy/catalogue/clearance");
check("watchlist lists the supplier", (await kb.getByTestId("watchlist").textContent()).includes("Lisboa"));
check("my offers lists the offer", (await kb.getByTestId("my-bids").count()) === 1);
// badges
await go(kb, `/buy/catalogue/suppliers/${lisboa}`);
check("product cards show deal badges", (await kb.getByTestId("deal-badge").count()) >= 1);
await go(kb, `/buy/catalogue/offers/${MOZZ}`);
check("product page shows the deal", (await kb.getByTestId("deal-banner").count()) === 1);
await shot(kb, "deals-05-product", false);
// cart
await go(kb, "/buy/orders/cart");
const cartText = await kb.textContent("main");
check("cart: flash line at the deal price", (await kb.getByTestId("cart-deal").count()) >= 1 && cartText.includes(pt(MOZZ_DEAL)));
check("cart: says why the volume price doesn't apply yet", (await kb.getByTestId("cart-deal-note").count()) === 1);
await kb.locator("tr", { hasText: /Arroz/ }).getByRole("button", { name: /Remover|Remove/ }).click().catch(() => {});
await settle(kb);

// ── 5. Supplier counters, customer takes it and orders ──
await go(lx, "/vendor/products/deals");
const bidRow = lx.getByTestId("deal-bids").first();
await bidRow.getByTestId("bid-counter-price").fill(String(COUNTER));
await bidRow.getByTestId("bid-counter").click();
check("supplier countered", await until(async () => sql(`select status from "ClearanceBid" where "buyerCompanyId"='${kebab}' order by "createdAt" desc limit 1`) === "COUNTERED"));
await go(kb, "/buy/catalogue/clearance");
check("customer sees the counter-offer", (await kb.locator("[data-testid=my-bid][data-status=COUNTERED]").count()) === 1);
await kb.getByTestId("bid-take").click();
check("counter-offer accepted", await until(async () => sql(`select status from "ClearanceBid" where "buyerCompanyId"='${kebab}' order by "createdAt" desc limit 1`) === "ACCEPTED"));
await go(kb, "/buy/catalogue/clearance");
await kb.getByTestId("bid-cart").click();
await until(async () => (await kb.locator("[data-testid=my-bid] [role=status]").count()) > 0);
await go(kb, "/buy/orders/cart");
check("cart: accepted offer at its price", (await kb.textContent("main")).includes(pt(COUNTER)) && (await kb.getByTestId("cart-deal").count()) >= 2);
await shot(kb, "deals-06-cart", true);
// Prices drift with other suites' data: if the cart ends up just under the delivery minimum, add one more mozzarella
// (the unit prices checked below don't change).
if (await kb.getByRole("button", { name: /Fazer encomenda|Place order/ }).isDisabled()) {
  sql(`update "CartItem" set qty = qty + 1 where "offerId"='${MOZZ}' and "cartId" in (select id from "Cart" where "buyerCompanyId"='${kebab}')`);
  await go(kb, "/buy/orders/cart");
}
await kb.getByRole("button", { name: /Fazer encomenda|Place order/ }).click();
await kb.waitForURL("**/buy/orders/**placed=1", { timeout: 20000 }).catch(() => {});
const lines = sql(`select l."offerId" || ':' || l."unitSalePriceNet" || ':' || l."commissionRate" from "OrderLine" l join "Order" o on o.id=l."orderId" where o."buyerCompanyId"='${kebab}' and l."dealId" is not null and o."placedAt" > now() - interval '5 minutes'`).split("\n").filter(Boolean);
const mozzLine = lines.find((x) => x.startsWith(MOZZ)), azLine = lines.find((x) => x.startsWith(AZEITE));
check("order lines carry the deal (flash at the deal price)", !!mozzLine && Math.abs(Number(mozzLine.split(":")[1]) - MOZZ_DEAL) < 0.005, mozzLine ?? lines.join(" "));
check("order lines carry the deal (offer at the countered price)", !!azLine && Math.abs(Number(azLine.split(":")[1]) - COUNTER) < 0.005, azLine ?? "");
check("offer marked ordered", await until(async () => sql(`select status from "ClearanceBid" where "buyerCompanyId"='${kebab}' order by "createdAt" desc limit 1`) === "ORDERED"));

// ── 6. Supplier ends a deal; the hourly job runs ──
await go(lx, "/vendor/products/deals");
await lx.getByTestId("vendor-deal").filter({ hasText: /Arroz/ }).getByTestId("deal-cancel").click();
check("supplier ended the live volume deal (ends now)", await until(async () => dealOf(ARROZ) === "ENDED"));
await go(kb, "/buy/catalogue/clearance");
check("ended deal left the deals page", (await kb.getByTestId("deal-card").filter({ hasText: /Arroz/ }).count()) === 0);
const job = await kb.request.post(`${BASE}/api/cron/deals`, { headers: { authorization: `Bearer ${CRON}` } });
check("hourly deals job runs", job.ok(), String(job.status()));

// ── 7. Phone + dark ──
const kp = await login("owner@kebabhouse.test", { viewport: { width: 390, height: 844 }, colorScheme: "dark", locale: "pt-PT" });
for (const u of ["/buy/catalogue/clearance", `/buy/catalogue/offers/${MOZZ}`]) {
  await go(kp, u);
  const over = await kp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(`phone width: no sideways scrolling (${u.split("/").slice(0, 4).join("/")})`, over <= 1, `${over}px`);
}
await go(kp, "/buy/catalogue/clearance");
await shot(kp, "deals-07-phone-dark", true);
const lp = await login("owner@lisboacentral.test", { viewport: { width: 390, height: 844 }, colorScheme: "dark", locale: "pt-PT" });
await go(lp, "/vendor/products/deals");
const overV = await lp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check("phone width: supplier deals page", overV <= 1, `${overV}px`);
const ap = await login("superadmin@firingi.test", { viewport: { width: 390, height: 844 }, colorScheme: "dark", locale: "en" });
for (const u of ["/admin/pricing/deals?status=ALL", "/admin/pricing/deals/settings"]) {
  await go(ap, u);
  const over = await ap.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(`phone width: no sideways scrolling (${u.split("?")[0]})`, over <= 1, `${over}px`);
}

// ── tidy ──
sql(`delete from "Setting" where key='deals.settings'`);
check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nall deals checks passed");
process.exit(failures ? 1 : 0);
