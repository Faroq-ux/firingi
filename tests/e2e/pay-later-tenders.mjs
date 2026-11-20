/**
 * Browser test of Phase 50 (pay later + open tenders), as the customer Kebab House, the supplier Lisboa Central and
 * FIRINGI staff (English):
 *  pay later — the cart offers pay-later terms with their fee; Kebab places an order "in 60 days" → the plan is
 *  financed by the (simulated) gateway partner; the Pay Later page lists it; FIRINGI's Pay Later page and settings;
 *  a business switched off loses the choice at checkout;
 *  tenders — Kebab posts a tender (a catalogue product line + a described line); Lisboa Central sees it and bids
 *  (sealed, "you receive" shown); Kebab sees the bid and awards → an order at the bid price; the supplier's bid is
 *  WON; FIRINGI's tender pages; phone & dark; no page errors.
 *   node tests/e2e/pay-later-tenders.mjs [baseUrl] [screenshotDir]
 */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
const { chromium } = createRequire(import.meta.url)("playwright");

const DB = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/firingi";
const sql = (q) => execFileSync("psql", ["-At", DB, "-c", q], { encoding: "utf8" }).trim();
const BASE = process.argv[2] ?? "http://localhost:3000";
const SHOTS = process.argv[3] ?? null;
const PASSWORD = process.env.SEED_PASSWORD ?? "Firingi!2026";
let failures = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "✔" : "✘"} ${name}${extra ? ` — ${extra}` : ""}`); if (!ok) failures++; };
const shot = async (page, name, full = true) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: full });
const settle = async (p) => { await p.waitForLoadState("networkidle").catch(() => {}); await p.waitForFunction(() => !document.querySelector("[aria-busy=true]"), null, { timeout: 15000 }).catch(() => {}); await p.waitForTimeout(500); };
const go = async (p, url) => { await p.goto(`${BASE}${url}`); await settle(p); };
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn().catch(() => false)) return true; await new Promise((r) => setTimeout(r, 400)); } return false; };

const stamp = Date.now().toString(36).slice(-5).toUpperCase();
const TITLE = `E2E Concurso ${stamp}`;
const kebabId = sql(`select c.id from "Company" c join "Membership" m on m."companyId"=c.id join "User" u on u.id=m."userId" where u.email='owner@kebabhouse.test' limit 1`);
const lxId = sql(`select id from "Company" where "legalName"='Grossista Lisboa Central, Lda'`);
const saved = { pl: sql(`select value::text from "Setting" where key='paylater.settings' and scope='GLOBAL'`), td: sql(`select value::text from "Setting" where key='tenders.settings' and scope='GLOBAL'`) };
function restore() {
  sql(`delete from "Tender" where title like 'E2E %'`);
  sql(`delete from "CompanyFeature" where key in ('PAY_LATER','TENDERS') and "companyId" in ('${kebabId}','${lxId}')`);
  sql(`delete from "Setting" where key in ('paylater.settings','tenders.settings')`);
  for (const [k, v] of [["paylater.settings", saved.pl], ["tenders.settings", saved.td]]) if (v) sql(`insert into "Setting" (id, scope, "scopeId", key, value, "updatedAt") values ('e2e-${k}', 'GLOBAL', '', '${k}', '${v.replace(/'/g, "''")}'::jsonb, now())`);
}
restore();
sql(`update "PayLaterPlan" set status='PAID' where "companyId"='${kebabId}' and status='OVERDUE'`); // left over by other runs
process.on("exit", restore);

const browser = await chromium.launch();
const errors = [];
async function login(email, opts = { viewport: { width: 1440, height: 950 } }) {
  const page = await (await browser.newContext({ ...opts, reducedMotion: "reduce" })).newPage();
  page.on("pageerror", (e) => errors.push(`${email} @ ${page.url().replace(BASE, "")}: ${e.message.slice(0, 140)}`));
  page.on("dialog", (d) => d.accept());
  await go(page, "/login");
  await page.fill("#email", email); await page.fill("#password", PASSWORD); await page.click("button[type=submit]");
  await page.waitForURL((u) => u.pathname !== "/login", { timeout: 15000 }).catch(() => {});
  await settle(page);
  return page;
}
const api = async (page, path) => (await page.request.get(`${BASE}${path}`)).json();

// ── 1. Pay later at checkout ──
const kb = await login("owner@kebabhouse.test");
await go(kb, "/buy/orders/cart");
const clear = kb.getByRole("button", { name: /Esvaziar carrinho|Clear cart/ });
if (await clear.count()) { await clear.click(); await settle(kb); }
const offers = await api(kb, `/api/catalogue/offers?q=${encodeURIComponent("cola")}`);
// a case of 24 (the order must reach FIRINGI's smallest pay-later order, 50 € by default)
const offer = offers.items.find((i) => i.vendor.name.includes("Lisboa Central") && i.packaging?.unitsPerPack === 24) ?? offers.items.find((i) => i.vendor.name.includes("Lisboa Central"));
check("found a Lisboa Central product to buy", !!offer);
await go(kb, `/buy/catalogue/offers/${offer.offerId}`);
await kb.locator('input[type="number"]').first().fill("10");
await kb.getByRole("button", { name: /Adicionar ao carrinho|Add to cart/ }).click();
await settle(kb);
await go(kb, "/buy/orders/cart");
check("the cart offers pay later", (await kb.getByTestId("paylater-choice").count()) === 1);
const opts = kb.getByTestId("paylater-option");
check("…the switched-on terms (30, 60, 90 days, 3 instalments)", (await opts.count()) === 4, String(await opts.count()));
await shot(kb, "p50-01-cart-pay-later");
await opts.nth(1).locator("input").check();
await kb.getByRole("button", { name: /Fazer encomenda|Place order/ }).click();
check("order placed", await until(async () => /\/buy\/orders\/[a-z0-9]+/.test(kb.url()) && !kb.url().includes("/cart")));
const orderId = kb.url().split("/").pop().split("?")[0];
const plan = sql(`select model || ':' || (term->>'days') || ':' || status from "PayLaterPlan" where "orderId"='${orderId}'`);
check("…paid later in 60 days through the gateway partner", plan === "PARTNER:60:ACTIVE", plan);
await go(kb, "/buy/finance/pay-later");
check("the Pay Later page lists the order", (await kb.getByTestId("pl-plan").count()) >= 1);
await shot(kb, "p50-02-buyer-pay-later");

// ── 2. FIRINGI's Pay Later pages ──
const sa = await login("superadmin@firingi.test");
await go(sa, "/admin/finance/pay-later");
check("FIRINGI sees the plan", (await sa.getByTestId("pl-admin-row").count()) >= 1);
await shot(sa, "p50-03-admin-pay-later");
await go(sa, "/admin/finance/pay-later/settings");
check("settings: every term with its switch", (await sa.getByTestId("pls-term").count()) >= 7);
await shot(sa, "p50-04-admin-pay-later-settings");
await sa.getByTestId("paylater-find").fill("Kebab House");
await until(async () => (await sa.getByTestId("paylater-find-hits").count()) === 1);
await sa.getByTestId("paylater-find-hits").getByTestId("pls-switch").first().selectOption("OFF");
check("Kebab House switched off on its own", await until(async () => sql(`select enabled from "CompanyFeature" where key='PAY_LATER' and "companyId"='${kebabId}'`) === "f"));
await go(kb, `/buy/catalogue/offers/${offer.offerId}`);
await kb.getByRole("button", { name: /Adicionar ao carrinho|Add to cart/ }).click();
await settle(kb);
await go(kb, "/buy/orders/cart");
check("…no pay-later choice at checkout any more", (await kb.getByTestId("paylater-choice").count()) === 0);
sql(`delete from "CompanyFeature" where key='PAY_LATER' and "companyId"='${kebabId}'`);
await kb.getByRole("button", { name: /Esvaziar carrinho|Clear cart/ }).click().catch(() => {});

// ── 3. A tender ──
await go(kb, "/buy/orders/tenders");
await kb.getByTestId("td-new").click();
await settle(kb);
await kb.fill("#td-title", TITLE);
await kb.getByTestId("td-product-search").fill("cola");
await until(async () => (await kb.getByTestId("td-product-hit").count()) > 0);
await kb.getByTestId("td-product-hit").first().click();
await kb.getByTestId("td-line-qty").first().fill("6");
await kb.getByTestId("td-add-line").click();
await kb.getByTestId("td-line-desc").nth(1).fill("Água mineral 1,5 L, sem gás");
await kb.getByTestId("td-line-qty").nth(1).fill("120");
await shot(kb, "p50-05-new-tender");
await kb.getByTestId("td-submit").click();
check("tender published → its page, open for bids", await until(async () => /\/buy\/orders\/tenders\/[a-z0-9]+$/.test(kb.url()) && (await kb.getByTestId("td-status").count()) === 1));
await settle(kb);
const tenderId = kb.url().split("/").pop();
check("…saved OPEN with 2 lines", sql(`select t.status || ':' || count(l.id) from "Tender" t join "TenderLine" l on l."tenderId"=t.id where t.id='${tenderId}' group by t.status`) === "OPEN:2");

// ── 4. The supplier bids ──
const lx = await login("owner@lisboacentral.test");
await go(lx, "/vendor/orders/tenders");
const row = lx.getByTestId("td-v-row").filter({ hasText: TITLE });
check("the supplier sees the open tender", (await row.count()) === 1);
await row.locator("a").first().click();
await settle(lx);
const bl = lx.getByTestId("td-bid-line").first();
const chosen = await bl.getByTestId("td-bid-offer").inputValue();
check("its own offer of the product is chosen for the product line", !!chosen);
await bl.getByTestId("td-bid-price").fill("10"); // 6 × 10 € = 60 € — above the supplier's delivery minimum, within stock
check("…what it receives after commission is shown", /receive|recebe/i.test(await bl.textContent()));
await shot(lx, "p50-06-supplier-bid");
await lx.getByTestId("td-bid-send").click();
check("bid saved (sealed)", await until(async () => sql(`select count(*) from "TenderBid" where "tenderId"='${tenderId}' and "supplierCompanyId"='${lxId}' and status='SUBMITTED'`) === "1"));

// ── 5. The buyer awards ──
await go(kb, `/buy/orders/tenders/${tenderId}`);
check("the buyer sees the bid with the best-price tag", (await kb.getByTestId("td-award-line").first().getByTestId("td-pick").count()) === 1);
await shot(kb, "p50-07-tender-bids");
await kb.getByTestId("td-award-btn").click();
const awarded = await until(async () => sql(`select status from "Tender" where id='${tenderId}'`) === "AWARDED");
check("awarded → an order for the supplier at the bid price", awarded, awarded ? "" : (await kb.getByTestId("td-award").locator("[role=alert]").allTextContents()).join(" "));
const ord = sql(`select o."sellerCompanyId" || ':' || ol."unitSalePriceNet"::numeric(10,2) || ':' || ol."qtyOrdered" from "TenderLine" l join "Order" o on o.id=l."orderId" join "OrderLine" ol on ol."orderId"=o.id where l."tenderId"='${tenderId}' and l.n=1 limit 1`);
check("…Lisboa Central, 10.00 €, 6 units", ord === `${lxId}:10.00:6`, ord);
check("…the supplier's bid is WON", sql(`select status from "TenderBid" where "tenderId"='${tenderId}'`) === "WON");
await go(kb, `/buy/orders/tenders/${tenderId}`);
check("the tender page links the order", (await kb.getByTestId("td-order").count()) >= 1);

// ── 6. FIRINGI's tender pages; phone & dark ──
await go(sa, "/admin/orders/tenders");
check("FIRINGI lists the tender", (await sa.getByTestId("td-admin-row").filter({ hasText: TITLE }).count()) === 1);
await shot(sa, "p50-08-admin-tenders");
await go(sa, `/admin/orders/tenders/${tenderId}`);
check("FIRINGI's tender page shows the awarded bid", (await sa.getByTestId("td-admin-line").count()) === 2);
await go(sa, "/admin/orders/tenders/settings");
check("tender settings", (await sa.getByTestId("tds-form").count()) === 1);
await shot(sa, "p50-09-admin-tender-settings");
const phone = await login("owner@kebabhouse.test", { viewport: { width: 390, height: 844 }, colorScheme: "dark", isMobile: true, hasTouch: true });
for (const [url, name] of [[`/buy/orders/tenders/${tenderId}`, "p50-10-tender-phone-dark"], ["/buy/finance/pay-later", "p50-11-pay-later-phone-dark"], ["/buy/orders/tenders/new", null]]) {
  await go(phone, url);
  const o = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(`phone: ${url.replace(tenderId, ":id")} fits`, o <= 1, `${o}px`);
  if (name) await shot(phone, name);
}
const vphone = await login("owner@lisboacentral.test", { viewport: { width: 390, height: 844 }, colorScheme: "dark", isMobile: true, hasTouch: true });
await go(vphone, `/vendor/orders/tenders/${tenderId}`);
check("phone: the supplier's tender page fits", (await vphone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 1);

check("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll pay later & tenders e2e checks passed");
process.exit(failures ? 1 : 0);
