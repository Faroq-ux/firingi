/**
 * Browser test of Phase 45 (multi-currency). FIRINGI in English, the Polish customer and supplier in Polish:
 * FIRINGI's currency settings (Poland on, FX margin), exchange rates (set by hand, back to the feed, fetch — the
 * feed may be unreachable here: then it must say so and raise an alert), rate alerts → the customer sees PLN prices
 * (a fixed local price exactly, an EUR price converted, "≈ €" alongside), the cart in złoty with the rate note,
 * places an order → the order in złoty with the locked rate; the supplier sees it in its own currency without the
 * customer's rate; FIRINGI sees what the customer pays → the supplier's price lists (currency column, convert) →
 * FIRINGI reports with the currency switch, P&L, gains & losses → phone width, dark mode → no page errors.
 *   node tests/e2e/currency.mjs [baseUrl] [screenshotDir]
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
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn().catch(() => false)) return true; await new Promise((r) => setTimeout(r, 400)); } return false; };
const sql = (q) => execFileSync("psql", ["-At", DB, "-c", q], { encoding: "utf8" }).trim();
const errors = [];
const PHONE = { width: 390, height: 844 };
async function login(email, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, locale: "en-GB", reducedMotion: "reduce", deviceScaleFactor: SHOTS ? 2 : 1, serviceWorkers: "block", ...opts });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${email} @ ${page.url()}: ${e.message.slice(0, 140)}`));
  page.on("dialog", (d) => d.accept());
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

const companyOf = (email) => sql(`select c.id from "Company" c join "Membership" m on m."companyId"=c.id join "User" u on u.id=m."userId" where u.email='${email}' limit 1`);
const KK = companyOf("owner@kebabkrakow.test"), HK = companyOf("owner@hurtownia.test");
const offerOf = (sku) => sql(`select o.id from "VendorOffer" o join "PackagingUnit" pu on pu.id=o."packagingUnitId" join "ProductVariant" v on v.id=pu."variantId" where o."vendorCompanyId"='${HK}' and v.sku='${sku}' and o.status='ACTIVE' limit 1`);
const COLA = offerOf("FIR-COLA33"), OIL = offerOf("FIR-AZEITE75");
const savedSettings = sql(`select value::text from "Setting" where key='currency.settings'`);
const placed = [];
const cleanup = () => {
  for (const id of placed) sql(`update "Order" set status='CANCELLED' where id='${id}' and status in ('NEW','PENDING_CONFIRMATION','ON_HOLD')`);
  sql(`delete from "CartItem" where "cartId" in (select id from "Cart" where "buyerCompanyId"='${KK}')`);
  sql(`delete from "ExchangeRate" where source='MANUAL' and note='e2e'`);
  if (savedSettings) sql(`update "Setting" set value='${savedSettings.replace(/'/g, "''")}'::jsonb where key='currency.settings'`);
};
check("demo data: Polish customer, supplier, offers", !!KK && !!HK && !!COLA && !!OIL);

try {
  // ── FIRINGI: settings, rates, alerts ─────────────────────────────────────
  const admin = await login("superadmin@firingi.test");
  await go(admin, "/admin/international/currency");
  const form = admin.getByTestId("currency-settings");
  check("settings: Poland billed in PLN", await form.getByTestId("cs-country-PL").isChecked());
  await form.getByTestId("cs-margin-PLN").fill("1.5");
  await form.getByTestId("cs-save").click();
  check("settings saved", await until(async () => (await text(form)).includes("Saved")));
  check("PLN marked as billing currency", (await admin.getByTestId("ccy-on-PLN").count()) === 1);
  await shot(admin, "fx-01-admin-settings", true);

  await go(admin, "/admin/international/exchange-rates");
  check("rates: PLN today with customer rate", /4[.,]\d{4}/.test(await text(admin.getByTestId("rate-PLN"))));
  const ro = admin.getByTestId("rate-override");
  await ro.locator("#ro-code").selectOption("SEK");
  await ro.getByTestId("ro-rate").fill("11.2345");
  await ro.locator("#ro-note").fill("e2e");
  await ro.getByTestId("ro-save").click();
  check("rate set by hand shows as such", await until(async () => (await text(admin.getByTestId("rate-SEK"))).includes("by hand")));
  await shot(admin, "fx-02-admin-rates", true);
  const back = admin.getByTestId("clear-override").first();
  if (await back.count()) { await back.click(); await settle(admin); }
  check("back to the feed", await until(async () => !(await text(admin.getByTestId("rate-SEK"))).includes("by hand")));
  await admin.getByTestId("fetch-rates").click();
  // no internet here: the feed fails → the page says so and an alert is raised (with internet: "Rates fetched")
  check("fetch now: fetched, or the failure is reported", await until(async () => /Rates fetched|could not be read/.test(await text(admin.locator("main")))));
  await go(admin, "/admin/international/currency/alerts");
  const alerts = await text(admin.getByTestId("fx-alerts"));
  check("rate alerts page lists the events", /Feed failed|Set by hand|Big move|Stale/.test(alerts), alerts.slice(0, 80));
  await shot(admin, "fx-03-admin-alerts");

  // ── the Polish customer ──────────────────────────────────────────────────
  sql(`delete from "CartItem" where "cartId" in (select id from "Cart" where "buyerCompanyId"='${KK}')`);
  const buyer = await login("owner@kebabkrakow.test", { locale: "pl-PL" });
  await go(buyer, `/buy/catalogue/offers/${COLA}`);
  const gross = await text(buyer.getByTestId("price-gross"));
  check("product page: price in złoty (fixed local price list)", /zł/.test(gross), gross);
  check("…with the EUR price alongside", /€/.test(await text(buyer.getByTestId("price-eur"))));
  await shot(buyer, "fx-04-customer-product");
  await buyer.locator('main input[type="number"]').first().fill("5");
  await buyer.getByRole("button", { name: /Dodaj do koszyka/ }).click();
  await settle(buyer);
  await go(buyer, `/buy/catalogue/offers/${OIL}`);
  check("an EUR-priced product converted to złoty", /zł/.test(await text(buyer.getByTestId("price-gross"))));
  await buyer.locator('main input[type="number"]').first().fill("1");
  await buyer.getByRole("button", { name: /Dodaj do koszyka/ }).click();
  await settle(buyer);
  await go(buyer, "/buy/orders/cart");
  const total = buyer.getByTestId("cart-total");
  check("cart total in złoty", (await total.getAttribute("data-currency")) === "PLN" && /zł/.test(await text(total)));
  check("cart: today's rate, fixed when ordering", /1 € = /.test(await text(buyer.getByTestId("fx-note"))));
  await shot(buyer, "fx-05-customer-cart", true);
  await buyer.getByRole("button", { name: /Złóż zamówienie/ }).click();
  await buyer.waitForURL("**placed=1", { timeout: 25000 }).catch(() => {});
  await settle(buyer);
  const orderId = buyer.url().includes("placed=1") ? buyer.url().split("/").pop().split("?")[0] : null;
  if (orderId) placed.push(orderId);
  check("order placed", !!orderId);
  if (orderId) {
    check("order stored in PLN with the locked rate", sql(`select "currencyCode" || ' ' || ("grandTotalLocal" is not null)::text from "Order" where id='${orderId}'`) === "PLN true");
    const ot = buyer.getByTestId("order-total");
    check("order page: total in złoty", (await ot.getAttribute("data-currency")) === "PLN" && /zł/.test(await text(ot)));
    check("order page: the locked rate", /1 € = /.test(await text(buyer.getByTestId("order-rate"))));
    await shot(buyer, "fx-06-customer-order", true);
    await go(buyer, "/buy/orders/history");
    check("orders list: in złoty", /zł/.test(await text(buyer.locator("main"))));
    // delivered → the invoice in złoty, its PDF with the EUR equivalent, paying it in złoty
    const inv = execFileSync("npx", ["tsx", "--require", "./tests/e2e/setup/no-server-only.cjs", "tests/e2e/setup/deliver.ts", orderId], { encoding: "utf8" }).trim().split("\n").pop();
    check("delivered → invoice issued in PLN", !!inv && sql(`select "currencyCode" from "Invoice" where id='${inv}'`) === "PLN");
    if (inv) {
      await go(buyer, "/buy/finance/invoices");
      check("invoices: total and balance in złoty", /zł/.test(await text(buyer.getByTestId("invoices-table"))) && /zł/.test(await text(buyer.locator("main header, main h1 + p, main"))));
      await shot(buyer, "fx-12-customer-invoices", true);
      const pdf = await buyer.request.get(`${BASE}/api/invoices/${inv}/pdf`);
      check("invoice PDF", pdf.ok() && (await pdf.body()).subarray(0, 4).toString() === "%PDF");
      const pay = buyer.getByTestId("pay-invoices");
      if (await pay.count()) check("pay invoices: amounts in złoty", /zł/.test(await text(pay)));
    }
  }

  // ── the Polish supplier ──────────────────────────────────────────────────
  const vendor = await login("owner@hurtownia.test", { locale: "pl-PL" });
  if (orderId) {
    await go(vendor, `/vendor/orders/${orderId}`);
    const vt = vendor.getByTestId("order-total");
    check("supplier: the order in its own currency", (await vt.getAttribute("data-currency")) === "PLN");
    check("supplier: no customer rate shown", (await vendor.getByTestId("order-rate").count()) === 0);
  }
  await go(vendor, "/vendor/products/price-lists");
  check("price lists: currency column (PLN, EUR)", /PLN/.test(await text(vendor.locator("main"))) && /EUR/.test(await text(vendor.locator("main"))));
  await vendor.locator("main a", { hasText: "Import prices" }).first().click();
  await settle(vendor);
  check("price list: its currency and a convert button", (await text(vendor.getByTestId("list-currency"))) === "EUR" && (await vendor.getByTestId("convert-currency").getByRole("button").count()) >= 1);
  await shot(vendor, "fx-07-supplier-price-list");

  // ── FIRINGI: the order, reports ──────────────────────────────────────────
  if (orderId) {
    await go(admin, `/admin/orders/${orderId}`);
    check("FIRINGI: what the customer pays and the rates", /Customer pays .*(zł|PLN).*reference.*FX margin 1\.5/.test(await text(admin.getByTestId("order-rate"))));
  }
  await go(admin, "/admin/analytics/sales?ccy=PLN");
  check("analytics: currency switch on PLN", /PLN/.test(await text(admin.getByTestId("currency-switch"))) && (await admin.getByTestId("currency-switch").locator('[aria-current="true"]').innerText()) === "PLN");
  check("analytics: amounts in złoty", /zł|PLN/.test(await text(admin.getByTestId("kpi-net"))));
  await shot(admin, "fx-08-admin-analytics-pln");
  await go(admin, "/admin/finance/profit-loss?ccy=SEK");
  check("P&L: currency switch", (await admin.getByTestId("currency-switch").count()) === 1);
  await go(admin, "/admin/finance/fx");
  check("gains & losses page", (await admin.getByTestId("fx-total").count()) === 1);
  await shot(admin, "fx-09-admin-gains-losses", true);

  // ── phone width, dark mode ──────────────────────────────────────────────
  const phone = await login("owner@kebabkrakow.test", { locale: "pl-PL", viewport: PHONE, colorScheme: "dark" });
  for (const url of [`/buy/catalogue/offers/${COLA}`, "/buy/orders/cart", ...(orderId ? [`/buy/orders/${orderId}`] : [])]) { await go(phone, url); await noSideways(phone, url.replace(COLA, ":id").replace(orderId ?? "§", ":id")); }
  await shot(phone, "fx-10-customer-order-phone-dark");
  const aphone = await login("superadmin@firingi.test", { viewport: PHONE, colorScheme: "dark" });
  for (const url of ["/admin/international/currency", "/admin/international/exchange-rates", "/admin/international/currency/alerts", "/admin/finance/fx"]) { await go(aphone, url); await noSideways(aphone, url); }
  await go(aphone, "/admin/international/exchange-rates");
  await shot(aphone, "fx-11-admin-rates-phone-dark");
} catch (e) {
  check("the run went through", false, String(e?.stack ?? e).slice(0, 400));
} finally {
  cleanup();
  check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  await browser.close();
  console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
  process.exit(failures ? 1 : 0);
}
