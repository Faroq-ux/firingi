/**
 * Browser test of Phase 48 (rebates & bonuses), as the supplier Lisboa Central, FIRINGI staff (English) and
 * the customer Kebab House:
 *  the supplier creates a volume rebate (steps, "try it") and sends it → FIRINGI sees it waiting and approves
 *  it; settings & per-supplier switches → the customer sees the running bonus with its progress bar
 *  (desktop, phone, dark) → free goods earned (set up in the database) are added to the cart and shown free
 *  there → the supplier's deal page → FIRINGI switches the supplier off and the "new deal" button goes →
 *  no page errors.
 *   node tests/e2e/rebates.mjs [baseUrl] [screenshotDir]
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
const NAME = `E2E Rappel ${stamp}`;
const lxId = sql(`select id from "Company" where "legalName"='Grossista Lisboa Central, Lda'`);
const kebabId = sql(`select c.id from "Company" c join "Membership" m on m."companyId"=c.id join "User" u on u.id=m."userId" where u.email='owner@kebabhouse.test' limit 1`);
const lxUser = sql(`select id from "User" where email='owner@lisboacentral.test'`);
const savedSettings = sql(`select value::text from "Setting" where key='rebates.settings' and scope='GLOBAL'`);
sql(`delete from "Setting" where key='rebates.settings'`);
sql(`delete from "CompanyFeature" where key='REBATES' and "companyId"='${lxId}'`);
// a product of the supplier with a price and stock: the free goods
const freeOffer = sql(`select vo.id from "VendorOffer" vo join "PriceListItem" pli on pli."offerId"=vo.id join "PriceList" pl on pl.id=pli."priceListId" and pl.scope='BASE' and pl."isActive"
  join "StockLevel" sl on sl."offerId"=vo.id where vo."vendorCompanyId"='${lxId}' and vo.status='ACTIVE' and sl."onHand"-sl.reserved > 100 and pli."minQty" <= 1 limit 1`);
const hadInCart = sql(`select count(*) from "CartItem" ci join "Cart" c on c.id=ci."cartId" where c."buyerCompanyId"='${kebabId}' and ci."offerId"='${freeOffer}'`) !== "0";
function cleanup() {
  sql(`delete from "TradeBonus" where name like 'E2E %'`);
  if (!hadInCart) sql(`delete from "CartItem" ci using "Cart" c where c.id=ci."cartId" and c."buyerCompanyId"='${kebabId}' and ci."offerId"='${freeOffer}'`);
  sql(`delete from "CompanyFeature" where key='REBATES' and "companyId"='${lxId}'`);
  sql(`delete from "Setting" where key='rebates.settings'`);
  if (savedSettings) sql(`insert into "Setting" (id, scope, "scopeId", key, value, "updatedAt") values ('e2e-rebates', 'GLOBAL', '', 'rebates.settings', '${savedSettings.replace(/'/g, "''")}'::jsonb, now())`);
}
process.on("exit", cleanup);

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

// ── 1. The supplier creates a volume rebate ──
const lx = await login("owner@lisboacentral.test");
await go(lx, "/vendor/products/rebates");
check("supplier's Rebates & Bonuses page opens with the new-deal button", (await lx.getByTestId("rb-new").count()) === 1);
await lx.getByTestId("rb-new").click();
await settle(lx);
await lx.fill("#rb-name", NAME);
await lx.selectOption("#rb-period", "QUARTER");
const tiersA = lx.getByTestId("rb-tiers-a"), tiersB = lx.getByTestId("rb-tiers-b");
await tiersA.nth(0).fill("500"); await tiersB.nth(0).fill("2");
await tiersA.nth(1).fill("2000"); await tiersB.nth(1).fill("4");
await lx.locator('[data-testid="rb-try"] input').first().fill("2500");
await lx.waitForTimeout(300);
const tryText = (await lx.getByTestId("rb-try-result").textContent()) ?? "";
check("\"try it\" shows what a customer would get (4 % of 2 500 = 100)", /100/.test(tryText), tryText);
await shot(lx, "p48-01-supplier-new-deal");
await lx.getByTestId("rb-send").click();
check("sent to FIRINGI → the deal's page, waiting", await until(async () => /\/vendor\/products\/rebates\/[a-z0-9]+$/.test(lx.url()) && (await lx.getByTestId("rb-status").getAttribute("data-status")) === "PENDING"));
await settle(lx);
const bonusId = lx.url().split("/").pop();
check("saved with the steps the supplier gave", sql(`select rules->'tiers'->1->>'pct' from "TradeBonus" where id='${bonusId}'`) === "4");
await shot(lx, "p48-02-supplier-deal-pending");

// ── 2. FIRINGI approves; settings and supplier switches ──
const sa = await login("superadmin@firingi.test");
await go(sa, "/admin/pricing/rebates");
const row = sa.getByTestId("rb-pending-row").filter({ hasText: NAME });
check("FIRINGI sees the deal waiting", (await row.count()) === 1);
await shot(sa, "p48-03-admin-rebates");
await row.getByTestId("rb-approve").click();
check("FIRINGI approves it", await until(async () => sql(`select status from "TradeBonus" where id='${bonusId}'`) === "APPROVED"));
await go(sa, "/admin/pricing/rebates/settings");
check("settings page with the per-supplier switches", (await sa.getByTestId("rs-form").count()) === 1 && (await sa.getByTestId("rb-supplier").count()) > 0);
await shot(sa, "p48-04-admin-settings");

// ── 3. The customer's bonuses ──
const kb = await login("owner@kebabhouse.test");
await go(kb, "/buy/rewards/bonuses");
const card = kb.getByTestId("rb-bonus").filter({ hasText: NAME });
check("the customer sees the running bonus", (await card.count()) === 1);
check("…with its progress bar", (await card.getByTestId("rb-progress").count()) >= 1);
// free goods earned (set up directly: settling needs a period to end)
sql(`insert into "TradeBonus" (id, "sellerCompanyId", "fundedBy", name, kind, period, rules, "validFrom", audience, "companyIds", countries, "offerIds", "categoryIds", "brandIds", "rewardOfferId", status, "createdById", "updatedAt")
  values ('e2e-rb-free-${stamp}', '${lxId}', 'SUPPLIER', 'E2E Free goods ${stamp}', 'FREE_GOODS', 'MONTH', '{"kind":"FREE_GOODS","buyUnits":10,"freeUnits":2,"maxFreePerPeriod":null}', now() - interval '40 days', 'ALL', '{}', '{}', '{}', '{}', '{}', '${freeOffer}', 'APPROVED', '${lxUser}', now())`);
sql(`insert into "TradeBonusFreeGoods" (id, "bonusId", "companyId", "offerId", qty, "periodKey", "expiresAt") values ('e2e-rbfg-${stamp}', 'e2e-rb-free-${stamp}', '${kebabId}', '${freeOffer}', 2, '2026-M10', now() + interval '30 days')`);
await go(kb, "/buy/rewards/bonuses");
check("free goods to take are listed", (await kb.getByTestId("rb-free-goods").count()) === 1);
await shot(kb, "p48-05-buyer-bonuses");
await kb.getByTestId("rb-free-add").first().click();
await settle(kb);
await go(kb, "/buy/orders/cart");
check("the cart shows the units as free (bonus)", await until(async () => (await kb.getByTestId("cart-free-goods").count()) >= 1));
await shot(kb, "p48-06-cart-free-goods");

// phone width, dark
const phone = await login("owner@kebabhouse.test", { viewport: { width: 390, height: 844 }, colorScheme: "dark", isMobile: true, hasTouch: true });
await go(phone, "/buy/rewards/bonuses");
const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check("phone: no sideways scrolling", overflow <= 1, `${overflow}px`);
await shot(phone, "p48-07-buyer-bonuses-phone-dark");
const vphone = await login("owner@lisboacentral.test", { viewport: { width: 390, height: 844 }, colorScheme: "dark", isMobile: true, hasTouch: true });
await go(vphone, `/vendor/products/rebates/${bonusId}`);
check("phone: the supplier's deal page fits", (await vphone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 1);
await shot(vphone, "p48-08-supplier-deal-phone-dark");

// ── 4. FIRINGI switches the supplier off ──
await go(sa, "/admin/pricing/rebates/settings");
const sw = sa.getByTestId("rb-supplier").filter({ hasText: "Lisboa Central" }).getByTestId("rb-switch");
await sw.selectOption("OFF");
check("supplier switched off", await until(async () => sql(`select enabled from "CompanyFeature" where key='REBATES' and "companyId"='${lxId}'`) === "f"));
await go(lx, "/vendor/products/rebates");
check("…the supplier can't start new deals and is told why", (await lx.getByTestId("rb-new").count()) === 0 && (await lx.getByTestId("rb-closed").count()) === 1);
await go(lx, `/vendor/products/rebates/${bonusId}`);
await shot(lx, "p48-09-supplier-deal-running");

check("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll rebates e2e checks passed");
process.exit(failures ? 1 : 0);
