/**
 * Browser test of Phase 47 (the till / POS). FIRINGI in English, Kebab House (restaurant, Portugal) in Portuguese,
 * Distribuidora Atlântico (supplier's counter) and Hurtownia Kraków (Polish wholesaler):
 * FIRINGI's till pages (overview, settings per company type and country, per-company switch) → the restaurant's
 * till: open a shift, tap and weigh items, an alcohol age check, cash with change, the receipt (non-fiscal note,
 * QR page) → a sale while offline, sent when back online → X report, close the shift (Z, counted cash), the day in
 * accounting (cash / card) → sales list, a refund → menu & recipe, guests, ingredient stock, settings → a country on
 * a certified provider (blocked until connected, then the legal number on the receipt) → the supplier's counter
 * fills its till from its products and sells from stock → the Polish till in złoty → phone width, dark mode.
 *   node tests/e2e/pos.mjs [baseUrl] [screenshotDir]
 */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
const { chromium } = createRequire(import.meta.url)("playwright");

const BASE = process.argv[2] ?? "http://localhost:3000";
const SHOTS = process.argv[3] ?? null;
const PASSWORD = process.env.SEED_PASSWORD ?? "Firingi!2026";
const DB = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/firingi";
let failures = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "✔" : "✘"} ${name}${extra ? ` — ${extra}` : ""}`); if (!ok) failures++; };
const shot = async (page, name, full = false) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: full });
const browser = await chromium.launch();
const settle = async (p) => { await p.waitForLoadState("networkidle").catch(() => {}); await p.waitForTimeout(400); };
const go = async (p, url) => { await p.goto(`${BASE}${url}`); await settle(p); };
const sql = (q) => execFileSync("psql", ["-At", DB, "-c", q], { encoding: "utf8" }).trim();
const errors = [];
const PHONE = { width: 390, height: 844 };
async function login(email, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, locale: "en-GB", reducedMotion: "reduce", deviceScaleFactor: SHOTS ? 2 : 1, serviceWorkers: "block", ...opts });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${email} @ ${page.url()}: ${e.message.slice(0, 140)}`));
  page.on("dialog", (d) => d.accept(d.message().includes("name") || d.type() === "prompt" ? "Mesa 4" : undefined));
  await go(page, "/login");
  await page.fill("#email", email); await page.fill("#password", PASSWORD); await page.click("button[type=submit]");
  await page.waitForURL((u) => u.pathname !== "/login", { timeout: 15000 }).catch(() => {});
  await settle(page);
  return page;
}
const noSideways = async (p, label) => {
  const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(`phone width: no sideways scrolling (${label})`, over <= 1, `${over}px`);
};
const text = async (loc) => ((await loc.first().innerText().catch(() => "")) ?? "").replace(/\s+/g, " ");
const companyOf = (name) => sql(`select id from "Company" where "legalName"='${name}'`);
const KH = companyOf("Kebab House Lisboa, Lda"), ATL = companyOf("Distribuidora Atlântico, Lda"), HK = companyOf("Hurtownia Kraków Sp. z o.o.");
const savedSettings = sql(`select value::text from "Setting" where key='pos.settings'`);
const cleanup = () => {
  sql(`delete from "Setting" where key='pos.settings'`);
  if (savedSettings) sql(`insert into "Setting" (id, scope, "scopeId", key, value, "updatedAt") values ('pos-e2e-restore', 'GLOBAL', '', 'pos.settings', '${savedSettings.replace(/'/g, "''")}'::jsonb, now())`);
  sql(`update "PosCompany" set "adminState"='DEFAULT', "fiscalProvider"=null, "fiscalAccount"=null, "fiscalSecretEnc"=null, "fiscalSecretHint"=null, "fiscalTestOk"=null where "companyId" in ('${KH}','${ATL}','${HK}')`);
};
const tapItem = async (p, name) => { await p.getByTestId("till-item").filter({ hasText: name }).first().click(); await p.waitForTimeout(150); };
const pin = async (p, digits) => { for (const d of digits) await p.getByTestId("till-pin-pad").getByRole("button", { name: d, exact: true }).click(); };

try {
  check("demo data: restaurant, supplier, Polish wholesaler; the restaurant has a till and a menu", !!KH && !!ATL && !!HK && Number(sql(`select count(*) from "PosItem" where "companyId"='${KH}'`)) >= 10);
  sql(`update "PosShift" set status='CLOSED', "closedAt"=now() where status='OPEN' and "registerId" in (select id from "PosRegister" where "companyId" in ('${KH}','${ATL}','${HK}'))`);

  // ── 1. FIRINGI: overview, settings, per-company switch ──
  const sa = await login("superadmin@firingi.test");
  await go(sa, "/admin/pos");
  check("admin overview: till on, by company type", (await text(sa.getByTestId("apos-enabled"))) === "On" && /Wholesale customers/.test(await text(sa.getByTestId("apos-types"))));
  await shot(sa, "pos-01-admin-overview", true);
  await go(sa, "/admin/pos/settings");
  check("admin settings: every country non-fiscal by default, Portugal suggests Moloni", (await sa.getByTestId("ps-stage-PT").inputValue()) === "NONFISCAL" && (await sa.getByTestId("ps-provider-PT").inputValue()) === "moloni");
  await sa.getByTestId("ps-type-CUSTOMER").uncheck();
  await sa.getByTestId("ps-save").click(); await settle(sa);
  const kh = await login("owner@kebabhouse.test", { locale: "pt-PT" });
  await go(kh, "/buy/pos");
  check("customers switched off: the restaurant sees the till is off", (await kh.getByTestId("pos-off").count()) === 1);
  await go(sa, "/admin/pos/companies?type=CUSTOMER");
  await sa.getByTestId(`pcs-${KH}`).selectOption("ON"); await settle(sa);
  await go(kh, "/buy/pos");
  check("…FIRINGI switches it on for this one restaurant", (await kh.getByTestId("pos-off").count()) === 0 && (await kh.getByTestId("pos-registers").count()) === 1);
  await shot(sa, "pos-02-admin-companies", true);
  await go(sa, "/admin/pos/settings");
  await sa.getByTestId("ps-type-CUSTOMER").check();
  await sa.getByTestId("ps-save").click(); await settle(sa);
  await shot(sa, "pos-03-admin-settings", true);
  sql(`update "PosCompany" set "adminState"='DEFAULT' where "companyId"='${KH}'`);

  // ── 2. The restaurant's till ──
  await go(kh, "/buy/pos");
  check("restaurant overview in Portuguese, non-fiscal note", /Caixa/.test(await text(kh.locator("main h1"))) && (await kh.getByTestId("pos-stage").count()) === 1);
  await shot(kh, "pos-04-customer-overview", true);
  await go(kh, "/buy/pos/till");
  await kh.getByTestId("till-float").fill("50");
  await kh.getByTestId("till-open-btn").click(); await settle(kh);
  check("shift opened", (await kh.getByTestId("till-shift").count()) === 1);
  await tapItem(kh, "Kebab no pão"); await tapItem(kh, "Kebab no pão"); await tapItem(kh, "Imperial");
  await tapItem(kh, "Azeitonas");
  for (const d of ["0", ",", "3", "4", "8"]) await kh.getByTestId("till-weigh-pad").getByRole("button", { name: d, exact: true }).click();
  await kh.getByTestId("till-weigh-add").click();
  check("ticket: 3 lines (kebab ×2, beer, olives 0.348 kg), total 20.25 €", (await kh.getByTestId("till-line").count()) === 3 && /20,25/.test(await text(kh.getByTestId("till-total"))), await text(kh.getByTestId("till-total")));
  await shot(kh, "pos-05-till-ticket");
  await kh.getByTestId("till-pay").click();
  await kh.getByTestId("till-amount").fill("50");
  await kh.getByTestId("till-pay-CASH").click();
  check("change shown: 29.75 €", /29,75/.test(await text(kh.getByTestId("till-change"))));
  check("alcohol: the age check is asked before completing", await kh.getByTestId("till-complete").isDisabled());
  await kh.getByTestId("till-age").check();
  await shot(kh, "pos-06-till-pay");
  await kh.getByTestId("till-complete").click(); await settle(kh);
  check("receipt: total, change, 'not a fiscal document'", /20,25/.test(await text(kh.getByTestId("till-receipt-total"))) && /fiscal/i.test(await text(kh.getByTestId("till-receipt-legal"))));
  await shot(kh, "pos-07-till-receipt");
  const sale1 = sql(`select id || '|' || "receiptToken" || '|' || gross from "PosSale" where "companyId"='${KH}' order by "createdAt" desc limit 1`).split("|");
  check("sale stored once, 20.25 €, 1 receipt", sale1[2] === "20.25");
  await kh.getByTestId("till-new-sale").click();

  // offline sale
  await kh.context().setOffline(true);
  await kh.waitForTimeout(300);
  check("offline badge", /Offline|Sem ligação|offline/i.test(await text(kh.getByTestId("till-online"))));
  await tapItem(kh, "Dürüm");
  await kh.getByTestId("till-pay").click();
  await kh.getByTestId("till-pay-CARD").click();
  await kh.getByTestId("till-complete").click(); await kh.waitForTimeout(600);
  check("offline sale: receipt says it is kept on the device", (await kh.getByTestId("till-receipt-offline").count()) === 1);
  await kh.getByTestId("till-new-sale").click();
  check("…1 sale waiting to be sent", /1/.test(await text(kh.getByTestId("till-waiting"))));
  await kh.context().setOffline(false);
  let offlineStored = "";
  for (let i = 0; i < 20 && !offlineStored; i++) { await kh.waitForTimeout(500); offlineStored = sql(`select gross from "PosSale" where "companyId"='${KH}' and offline order by "createdAt" desc limit 1`); }
  check("back online: the offline sale is stored (once, marked offline)", offlineStored === "8.00", offlineStored);

  // X / Z
  await kh.getByTestId("till-x").click(); await settle(kh);
  check("X report: 2 sales, cash expected 70.25", /2/.test(await text(kh.getByTestId("rep-count"))) && /70,25/.test(await text(kh.getByTestId("rep-expected"))), await text(kh.getByTestId("rep-expected")));
  await shot(kh, "pos-08-till-x");
  await kh.getByRole("button", { name: "×" }).first().click();
  await kh.getByTestId("till-close").click();
  await kh.getByTestId("till-counted").fill("70");
  await kh.getByTestId("till-close-ok").click(); await settle(kh);
  check("Z report after closing", (await kh.getByTestId("till-report").count()) === 1);
  check("shift closed with a difference of −0.25", sql(`select difference from "PosShift" where "registerId" in (select id from "PosRegister" where "companyId"='${KH}') and status='CLOSED' order by "closedAt" desc limit 1`) === "-0.25");
  const acc = sql(`select string_agg(category || ':' || amount, ',' order by category) from "AccountingEntry" where "companyId"='${KH}' and description like 'Till sales%' and date = current_date`);
  check("the day's sales are in the restaurant's accounting as cash and card", /SALES_CARD/.test(acc) && /SALES_CASH/.test(acc), acc);

  // public receipt page
  const pub = await browser.newPage();
  await pub.goto(`${BASE}/r/${sale1[1]}`); await settle(pub);
  check("receipt page (QR) opens without login, total 20.25", /20,25|20\.25/.test(await text(pub.getByTestId("public-receipt-total"))));
  await pub.screenshot(SHOTS ? { path: `${SHOTS}/pos-09-public-receipt.png`, fullPage: true } : {}).catch(() => null);
  await pub.close();

  // sales, refund (a new shift)
  await go(kh, "/buy/pos/till");
  await kh.getByTestId("till-float").fill("20");
  await kh.getByTestId("till-open-btn").click(); await settle(kh);
  await go(kh, `/buy/pos/sales/${sale1[0]}`);
  await kh.getByTestId("prf-qty").first().fill("1");
  await kh.getByTestId("prf-reason").fill("Frio");
  await kh.getByTestId("prf-save").click(); await settle(kh);
  check("refund of one kebab recorded", sql(`select gross from "PosSale" where "refundOfId"='${sale1[0]}'`) === "7.50");
  await go(kh, "/buy/pos/sales");
  check("sales list: receipts and the refund", (await kh.getByTestId("pos-sale-link").count()) >= 3);
  await shot(kh, "pos-10-customer-sales", true);

  // menu, recipe, guests, stock, settings
  await go(kh, "/buy/pos/items");
  check("menu: 12 dishes and drinks", (await kh.getByTestId("pos-item-edit").count()) >= 12);
  await kh.getByTestId("pos-item-edit").first().click(); await settle(kh);
  check("dish editor with its recipe from what was bought on FIRINGI", (await kh.getByTestId("pos-recipe").count()) === 1);
  await shot(kh, "pos-11-customer-menu-recipe", true);
  await go(kh, "/buy/pos/guests");
  await kh.getByTestId("pg-name").fill("Bruno Costa"); await kh.getByTestId("pg-phone").fill("913 555 222"); await kh.getByTestId("pg-consent").check();
  await kh.getByTestId("pg-save").click(); await settle(kh);
  check("guest added with a loyalty card", /Bruno Costa/.test(await text(kh.getByTestId("pos-guests"))));
  await go(kh, "/buy/pos/stock");
  check("ingredient stock page", (await kh.getByTestId("pos-stock").count()) === 1);
  await go(kh, "/buy/pos/reports");
  check("reports: by payment and VAT", (await kh.getByTestId("pos-report-pay").count()) === 1);
  await shot(kh, "pos-12-customer-reports", true);

  // ── 3. Certified receipts in Portugal ──
  await go(sa, "/admin/pos/settings");
  await sa.getByTestId("ps-stage-PT").selectOption("PROVIDER");
  await sa.getByTestId("ps-save").click(); await settle(sa);
  await go(kh, "/buy/pos/till");
  check("Portugal on a certified provider: the till waits for the restaurant's account", (await kh.getByTestId("till-blocked").count()) === 1 && await kh.getByTestId("till-pay").isDisabled());
  await go(kh, "/buy/pos/settings");
  await kh.getByTestId("pf-provider").selectOption("moloni");
  await kh.getByTestId("pf-account").fill("kebabhouse");
  await kh.getByTestId("pf-secret").fill("moloni-test-key-123");
  await kh.getByTestId("pf-save").click(); await settle(kh);
  check("provider connected and tested", /✓|funciona|works/i.test(await text(kh.getByTestId("pf-status"))) || sql(`select "fiscalTestOk" from "PosCompany" where "companyId"='${KH}'`) === "t");
  await shot(kh, "pos-13-customer-settings", true);
  await go(kh, "/buy/pos/till");
  await tapItem(kh, "Falafel");
  await kh.getByTestId("till-pay").click();
  await kh.getByTestId("till-taxid").fill("123456789");
  await kh.getByTestId("till-pay-CARD").click();
  await kh.getByTestId("till-complete").click(); await settle(kh);
  check("certified receipt: the legal number from the provider on the receipt", sql(`select "fiscalNumber" from "PosSale" where "companyId"='${KH}' order by "createdAt" desc limit 1`).startsWith("FS POS"));
  await shot(kh, "pos-14-till-certified-receipt");
  await go(sa, "/admin/pos/settings");
  await sa.getByTestId("ps-stage-PT").selectOption("NONFISCAL");
  await sa.getByTestId("ps-save").click(); await settle(sa);

  // ── 4. The supplier's counter ──
  const atl = await login("owner@atlantico.test", { locale: "pt-PT" });
  await go(atl, "/vendor/pos/items");
  await atl.getByTestId("pos-import").click(); await settle(atl);
  const added = Number(sql(`select count(*) from "PosItem" where "companyId"='${ATL}' and "offerId" is not null`));
  check("supplier fills its till from its own products", added > 0, String(added));
  const linked = sql(`select i.name || '|' || i."offerId" || '|' || r."addressId" from "PosItem" i join "PosRegister" r on r."companyId"=i."companyId" join "StockLevel" s on s."offerId"=i."offerId" and s."addressId"=r."addressId" where i."companyId"='${ATL}' and s."onHand" - s.reserved > 5 order by s."onHand" desc limit 1`).split("|");
  const before = Number(sql(`select "onHand" from "StockLevel" where "offerId"='${linked[1]}' and "addressId"='${linked[2]}'`));
  await go(atl, "/vendor/pos/till");
  await atl.getByTestId("till-float").fill("100");
  await atl.getByTestId("till-open-btn").click(); await settle(atl);
  await atl.getByTestId("till-search").fill(linked[0].slice(0, 12));
  await tapItem(atl, linked[0].slice(0, 12));
  await atl.getByTestId("till-pay").click();
  await atl.getByTestId("till-pay-MBWAY").click();
  await atl.getByTestId("till-complete").click(); await settle(atl);
  check("counter sale (MB WAY) takes the product from the warehouse stock", Number(sql(`select "onHand" from "StockLevel" where "offerId"='${linked[1]}' and "addressId"='${linked[2]}'`)) === before - 1);
  await shot(atl, "pos-15-supplier-counter-receipt");
  await atl.getByTestId("till-new-sale").click();
  await shot(atl, "pos-16-supplier-till");

  // ── 5. Poland: złoty ──
  const hk = await login("owner@hurtownia.test", { locale: "pl" });
  await go(hk, "/vendor/pos/settings");
  await hk.getByTestId("preg-name").last().fill("Kasa 1"); await hk.getByTestId("preg-code").last().fill("K1");
  await hk.getByTestId("preg-save").last().click(); await settle(hk);
  await go(hk, "/vendor/pos/items");
  await hk.getByTestId("pi-name").fill("Woda 1,5 l"); await hk.getByTestId("pi-price").fill("2,99"); await hk.getByTestId("pi-vatRate").fill("8");
  await hk.getByTestId("pi-save").click(); await settle(hk);
  await go(hk, "/vendor/pos/till");
  await hk.getByTestId("till-float").fill("200"); await hk.getByTestId("till-open-btn").click(); await settle(hk);
  await tapItem(hk, "Woda");
  check("Polish till in złoty", /zł/.test(await text(hk.getByTestId("till-total"))), await text(hk.getByTestId("till-total")));
  await shot(hk, "pos-17-polish-till");

  // ── 5b. Another shop's till: FIRINGI approves it; people per till ──
  sql(`delete from "PosRegister" where "companyId"='${KH}' and code='E1'`);
  await go(kh, "/buy/pos/settings");
  await kh.getByTestId("preg-name").last().fill("Caixa esplanada"); await kh.getByTestId("preg-code").last().fill("E1");
  await kh.getByTestId("preg-save").last().click(); await settle(kh);
  await go(kh, "/buy/pos/settings");
  check("a second till waits for FIRINGI's approval", sql(`select approval from "PosRegister" where "companyId"='${KH}' and code='E1'`) === "PENDING" && (await kh.getByTestId("pos-till-status").count()) === 1);
  await shot(kh, "pos-19-customer-tills-people", true);
  const e1 = sql(`select id from "PosRegister" where "companyId"='${KH}' and code='E1'`);
  await go(sa, "/admin/pos/companies");
  check("admin: the till request is listed", (await sa.getByTestId(`till-approve-${e1}`).count()) === 1);
  await shot(sa, "pos-20-admin-till-requests", true);
  await sa.getByTestId(`till-approve-${e1}`).click(); await settle(sa);
  check("admin approves the extra till", sql(`select approval from "PosRegister" where id='${e1}'`) === "APPROVED");
  await go(kh, "/buy/pos/settings");
  check("…ready to use: no waiting badge", (await kh.getByTestId("pos-till-status").count()) === 0 && (await kh.getByTestId(`preg-people-${e1}`).count()) === 1);
  await go(kh, "/buy/pos/reports");
  check("reports by shop / till", (await kh.getByTestId("pos-report-tills").count()) === 1);
  sql(`delete from "PosRegister" where id='${e1}'`);

  // ── 6. Phone, dark ──
  const phone = await login("owner@kebabhouse.test", { viewport: PHONE, colorScheme: "dark", locale: "pt-PT" });
  for (const u of ["/buy/pos", "/buy/pos/till", "/buy/pos/items", "/buy/pos/sales", "/buy/pos/shifts", "/buy/pos/settings"]) { await go(phone, u); await noSideways(phone, u); }
  await go(phone, "/buy/pos/till");
  await tapItem(phone, "Kebab no pão");
  await shot(phone, "pos-18-till-phone-dark", true);
  const aphone = await login("superadmin@firingi.test", { viewport: PHONE });
  for (const u of ["/admin/pos", "/admin/pos/settings", "/admin/pos/companies", "/admin/pos/fiscal"]) { await go(aphone, u); await noSideways(aphone, u); }

  check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (e) {
  check("no exceptions", false, e instanceof Error ? e.message.split("\n")[0] : String(e));
} finally {
  cleanup();
  await browser.close();
}
console.log(failures ? `\n${failures} check(s) failed` : "\nAll Phase 47 checks passed");
process.exit(failures ? 1 : 0);
