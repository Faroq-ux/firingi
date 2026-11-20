/**
 * Browser test of Phase 51 (sustainability & CO₂), as the supplier Lisboa Central, FIRINGI staff (English) and the
 * customer Kebab House:
 *  the supplier gives a product its own CO₂ value + packaging (source required) → "being checked"; FIRINGI approves it
 *  → the shop shows the "Low CO₂" / eco packaging badges and the eco filter finds it; the product page shows the
 *  footprint per pack and per kg; the cart shows the cart's footprint; the order shows its footprint (estimate);
 *  once delivered the buyer's report counts it, the buyer sets a yearly goal, exports CSV (Scope 3) and PDF;
 *  the supplier's report; FIRINGI's overview, category values and settings; a vehicle's fuel; a business switched
 *  off loses the report; phone & dark; no page errors.
 *   node tests/e2e/co2.mjs [baseUrl] [screenshotDir]
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

const year = new Date().getUTCFullYear();
const kebabId = sql(`select c.id from "Company" c join "Membership" m on m."companyId"=c.id join "User" u on u.id=m."userId" where u.email='owner@kebabhouse.test' limit 1`);
const lxId = sql(`select id from "Company" where "legalName"='Grossista Lisboa Central, Lda'`);
const savedSettings = sql(`select value::text from "Setting" where key='co2.settings' and scope='GLOBAL'`);
const vehicle = sql(`select id || '|' || coalesce(fuel,'') from "Vehicle" where "ownerCompanyId"='${lxId}' order by plate limit 1`);
let offerId = null;
function restore() {
  sql(`delete from "OfferCo2" where source like 'E2E %'`);
  sql(`delete from "Co2Goal" where "companyId"='${kebabId}'`);
  sql(`delete from "CompanyFeature" where key='CO2' and "companyId" in ('${kebabId}','${lxId}')`);
  sql(`delete from "Setting" where key='co2.settings'`);
  if (savedSettings) sql(`insert into "Setting" (id, scope, "scopeId", key, value, "updatedAt") values ('e2e-co2', 'GLOBAL', '', 'co2.settings', '${savedSettings.replace(/'/g, "''")}'::jsonb, now())`);
  if (vehicle) { const [id, fuel] = vehicle.split("|"); sql(`update "Vehicle" set fuel=${fuel ? `'${fuel}'` : "null"} where id='${id}'`); }
}
restore();
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

// ── 0. The product: a Lisboa Central cola (soft drinks, 0.4 kg CO₂e/kg by default) ──
const kb = await login("owner@kebabhouse.test");
const offers = await api(kb, `/api/catalogue/offers?q=${encodeURIComponent("cola")}`);
const offer = offers.items.find((i) => i.vendor.name.includes("Lisboa Central") && i.packaging?.unitsPerPack === 24) ?? offers.items.find((i) => i.vendor.name.includes("Lisboa Central"));
check("found a Lisboa Central product", !!offer);
offerId = offer.offerId;
const sku = sql(`select v.sku from "VendorOffer" o join "PackagingUnit" p on p.id=o."packagingUnitId" join "ProductVariant" v on v.id=p."variantId" where o.id='${offerId}'`);

// ── 1. The supplier gives its own value ──
const lx = await login("owner@lisboacentral.test");
await go(lx, `/vendor/products/co2?q=${encodeURIComponent(sku)}`);
const row = lx.locator(`[data-testid="co2-offer"][data-offer="${offerId}"]`);
check("the supplier sees its product with today's footprint", (await row.count()) === 1 && (await row.innerText()).includes(sku));
await row.getByTestId("co2-kg-input").fill("0.1");
await row.getByTestId("co2-pack-input").selectOption("RETURNABLE");
await row.getByTestId("co2-save").click();
await settle(lx);
check("…a value without a source is refused", sql(`select count(*) from "OfferCo2" where "offerId"='${offerId}'`) === "0");
await row.getByTestId("co2-src-input").fill("E2E LCA study 2026");
await row.getByTestId("co2-save").click();
check("…with a source it waits for FIRINGI's check", await until(async () => sql(`select status from "OfferCo2" where "offerId"='${offerId}'`) === "PENDING"));
await go(lx, `/vendor/products/co2?q=${encodeURIComponent(sku)}`);
check("…the supplier sees \"being checked\"", (await lx.getByTestId("co2-status").count()) >= 1);
await shot(lx, "p51-01-supplier-values");

// ── 2. FIRINGI checks it ──
const sa = await login("superadmin@firingi.test");
await go(sa, "/admin/catalogue/co2");
const pendingRow = sa.getByTestId("co2-pending-row").filter({ hasText: sku });
check("FIRINGI sees the value to check", (await pendingRow.count()) === 1);
await shot(sa, "p51-02-admin-overview");
await pendingRow.getByTestId("co2-approve").click();
check("…approves it", await until(async () => sql(`select status from "OfferCo2" where "offerId"='${offerId}'`) === "APPROVED"));
await go(sa, "/admin/catalogue/co2/factors");
check("FIRINGI's category values", (await sa.getByTestId("co2-factor-row").count()) > 5);
await shot(sa, "p51-03-admin-factors", false);
await go(sa, "/admin/catalogue/co2/settings");
check("FIRINGI's CO₂ settings", (await sa.getByTestId("cs-form").count()) === 1);
await shot(sa, "p51-04-admin-settings");

// ── 3. The shop ──
// Kebab's country lets buyers choose the supplier: the eco filter is on the supplier's shop
await go(kb, `/buy/catalogue/suppliers/${lxId}?q=${encodeURIComponent(sku)}&eco=LOW_CO2`);
check("the eco filter is shown", (await kb.getByTestId("eco-filter").count()) === 1);
check("…\"Low CO₂\" finds the product with its badge", (await kb.getByTestId("co2-badge-LOW_CO2").count()) >= 1);
await shot(kb, "p51-05-shop-low-co2");
await go(kb, `/buy/catalogue/offers/${offerId}`);
const card = kb.getByTestId("product-co2");
check("the product page shows its footprint", (await card.count()) === 1 && (await kb.getByTestId("co2-per-pack").count()) === 1);
check("…with the eco packaging badge", (await card.getByTestId("co2-badge-ECO_PACKAGING").count()) === 1);
await card.scrollIntoViewIfNeeded();
await shot(kb, "p51-06-product-co2", false);

// ── 4. Cart and order ──
await go(kb, "/buy/orders/cart");
const clear = kb.getByRole("button", { name: /Esvaziar carrinho|Clear cart/ });
if (await clear.count()) { await clear.click(); await settle(kb); }
await go(kb, `/buy/catalogue/offers/${offerId}`);
await kb.locator('input[type="number"]').first().fill("6");
await kb.getByRole("button", { name: /Adicionar ao carrinho|Add to cart/ }).click();
await settle(kb);
await go(kb, "/buy/orders/cart");
check("the cart shows its footprint", (await kb.getByTestId("cart-co2").count()) >= 1);
await kb.getByRole("button", { name: /Fazer encomenda|Place order/ }).click();
check("order placed", await until(async () => /\/buy\/orders\/[a-z0-9]+/.test(kb.url()) && !kb.url().includes("/cart")));
const orderId = kb.url().split("/").pop().split("?")[0];
await settle(kb);
const stamped = sql(`select (coalesce("co2ProductsKg",0)+coalesce("co2PackagingKg",0))::text from "Order" where id='${orderId}'`);
check("…the order is stamped with its footprint at checkout", Number(stamped) > 0, stamped);
check("…and shows it to the buyer", (await kb.getByTestId("order-co2").count()) === 1);
await kb.getByTestId("order-co2").scrollIntoViewIfNeeded();
await shot(kb, "p51-07-order-co2", false);

// ── 5. Reports (the order delivered) ──
sql(`update "Order" set status='DELIVERED', "co2At"=now() where id='${orderId}'`);
await go(kb, "/buy/reports/co2");
check("the buyer's CO₂ report", (await kb.getByTestId("co2-report").count()) === 1 && (await kb.getByTestId("co2-months").count()) === 1);
await kb.getByTestId("co2-goal-input").fill("15");
await kb.getByTestId("co2-goal-save").click();
check("…sets a goal of 15 % less", await until(async () => sql(`select "reductionPct"::int from "Co2Goal" where "companyId"='${kebabId}' and year=${year}`) === "15"));
await go(kb, "/buy/reports/co2");
await shot(kb, "p51-08-buyer-report");
const csv = await kb.request.get(`${BASE}/api/co2/export?side=BUYER&year=${year}&format=csv`);
const csvText = await csv.text();
check("…CSV export (Scope 3 rows)", csv.ok() && /Scope 3/.test(csvText) && /TOTAL/.test(csvText));
const pdf = await kb.request.get(`${BASE}/api/co2/export?side=BUYER&year=${year}&format=pdf`);
check("…PDF export", pdf.ok() && (pdf.headers()["content-type"] ?? "").includes("pdf"));
await go(lx, "/vendor/reports/co2");
check("the supplier's CO₂ report", (await lx.getByTestId("co2-report").count()) === 1);
await shot(lx, "p51-09-supplier-report");
const other = await (await browser.newContext()).request.get(`${BASE}/api/co2/export?side=ADMIN&year=${year}&format=csv`);
check("the export needs a login", !other.ok() || !(await other.text()).includes("TOTAL"));

// ── 6. Vehicle fuel ──
if (vehicle) {
  await go(lx, "/vendor/fleet/vehicles");
  await lx.getByTestId("vehicle-fuel").first().selectOption("ELECTRIC");
  check("a vehicle's fuel is saved", await until(async () => sql(`select fuel from "Vehicle" where id='${vehicle.split("|")[0]}'`) === "ELECTRIC"));
}

// ── 7. Switches ──
sql(`insert into "CompanyFeature" ("companyId", key, enabled, "updatedAt") values ('${kebabId}', 'CO2', false, now()) on conflict do nothing`);
await go(kb, "/buy/reports/co2");
check("a business switched off loses the report", (await kb.getByTestId("co2-closed").count()) === 1);
sql(`delete from "CompanyFeature" where key='CO2' and "companyId"='${kebabId}'`);

// ── 8. Phone & dark ──
const phone = await login("owner@kebabhouse.test", { viewport: { width: 390, height: 844 }, colorScheme: "dark", isMobile: true, hasTouch: true });
await go(phone, "/buy/reports/co2");
const over = await phone.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
check("phone: the report fits the screen", !over);
await shot(phone, "p51-10-phone-report");
await go(phone, `/buy/catalogue/offers/${offerId}`);
await phone.getByTestId("product-co2").scrollIntoViewIfNeeded();
await shot(phone, "p51-11-phone-product", false);
const vphone = await login("owner@lisboacentral.test", { viewport: { width: 390, height: 844 }, colorScheme: "dark", isMobile: true, hasTouch: true });
await go(vphone, `/vendor/products/co2?q=${encodeURIComponent(sku)}`);
check("phone: the supplier's values fit", !(await vphone.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2)));
await shot(vphone, "p51-12-phone-supplier");

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nAll CO₂ checks passed");
process.exit(failures ? 1 : 0);
