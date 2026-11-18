/**
 * Browser test of Phase 41 (sold by weight). Supplier and customer in Portuguese, FIRINGI in English:
 * the supplier sets the 2 kg mozzarella block as sold by the piece, priced per kg (own 5 % limit, scale item code)
 * → the customer sees the price per kg on the product page and card, "≈ 10 kg" in the cart → order → the supplier
 * scans a scale label, then types the five pieces (10,55 kg, above the 10,5 kg limit) → the customer is told and
 * accepts the extra → the driver weighs again at the stop (10,40 kg) → the invoice shows the weight and €/kg →
 * supplier weighing report → FIRINGI overview and settings → phone width, dark mode → no page errors.
 * Cleans up after itself.
 *   node tests/e2e/catch-weight.mjs [baseUrl] [screenshotDir]
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
const main = (p) => p.textContent("main");
const ean = (twelve) => twelve + ((10 - (twelve.split("").map(Number).reverse().reduce((a, d, i) => a + d * (i % 2 === 0 ? 3 : 1), 0) % 10)) % 10);
async function login(email, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, locale: "pt-PT", reducedMotion: "reduce", deviceScaleFactor: SHOTS ? 2 : 1, serviceWorkers: "block", ...opts });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${email}: ${e.message.slice(0, 160)}`));
  page.on("dialog", (d) => d.accept());
  await go(page, "/login");
  await page.fill("#email", email); await page.fill("#password", PASSWORD); await page.click("button[type=submit]");
  await page.waitForURL((u) => u.pathname !== "/login", { timeout: 15000 }).catch(() => {});
  await settle(page);
  return page;
}

const LX = sql(`select c.id from "Company" c join "Membership" m on m."companyId"=c.id join "User" u on u.id=m."userId" where u.email='owner@lisboacentral.test' limit 1`);
const MOZZ = sql(`select id from "VendorOffer" where "vendorCompanyId"='${LX}' and "vendorSku"='GRO-MOZZ2' and status='ACTIVE' order by "createdAt" limit 1`);
const cleanup = () => {
  sql(`update "VendorOffer" set "cwMode"=null, "cwNominalKg"=null, "cwMinKg"=null, "cwMaxKg"=null, "cwMaxOverPct"=null, "cwPlu"=null where id='${MOZZ}'`);
  sql(`delete from "Setting" where key='catchweight.settings'`);
};
cleanup();

const vendor = await login("owner@lisboacentral.test");
const buyer = await login("owner@kebabhouse.test");

// ── 1. Supplier: the mozzarella block is sold by the piece, priced per kg ──
await go(vendor, "/vendor/products/weights");
check("supplier sees FIRINGI's limit", /10 %/.test((await vendor.getByTestId("cw-limit").textContent()) ?? ""));
await vendor.locator(`[data-testid=cw-offer-row][data-offer="${MOZZ}"]`).click();
const form = vendor.locator(`[data-testid=cw-offer][data-offer="${MOZZ}"]`);
await form.getByTestId("cw-mode").selectOption("PIECE");
await form.getByTestId("cw-nominal").fill("2");
await form.getByTestId("cw-pct").fill("5");
await form.getByTestId("cw-plu").fill("41234");
check("price per kg shown while editing", /6,75/.test((await form.getByTestId("cw-perkg").textContent()) ?? ""));
await form.getByTestId("cw-save").click();
check("saved: sold by the piece, 2 kg, 5 %, scale code", await until(async () => sql(`select "cwMode"||'|'||"cwNominalKg"||'|'||"cwMaxOverPct"||'|'||"cwPlu" from "VendorOffer" where id='${MOZZ}'`) === "PIECE|2.000|5.00|41234"));
await go(vendor, "/vendor/products/weights");
await vendor.locator(`[data-testid=cw-offer-row][data-offer="${MOZZ}"]`).click();
await shot(vendor, "cw-01-supplier-products");

// ── 2. Customer: product page, card, cart ──
await go(buyer, `/buy/catalogue/offers/${MOZZ}`);
const panel = (await buyer.getByTestId("product-cw").textContent()) ?? "";
check("product page: price per kg and piece weight", /\d+,\d{2}\s?€\/kg/.test(panel.replace(/\s+/g, " ")) && /2 kg/.test(panel), panel.slice(0, 120));
await shot(buyer, "cw-02-product-page");
await go(buyer, "/buy/catalogue/search?q=mozzarella");
check("catalogue card: sold by weight badge", (await buyer.getByTestId("cw-badge").count()) > 0);
await go(buyer, "/buy/orders/cart");
const clear = buyer.getByRole("button", { name: /Esvaziar carrinho/ });
if (await clear.count()) { await clear.click(); await settle(buyer); }
await go(buyer, `/buy/catalogue/offers/${MOZZ}`);
await buyer.locator('main input[type="number"]').first().fill("5");
await buyer.getByRole("button", { name: /Adicionar ao carrinho/ }).click();
await settle(buyer);
await go(buyer, "/buy/orders/cart");
check("cart line: about 10 kg, final price by weight", /10 kg/.test((await buyer.getByTestId("cw-cart-note").first().textContent()) ?? ""));
check("cart total: an estimate note", (await buyer.getByTestId("cart-cw-note").count()) === 1);
await shot(buyer, "cw-03-cart");
await buyer.getByRole("button", { name: /Fazer encomenda/ }).click();
await buyer.waitForURL("**placed=1", { timeout: 20000 });
await settle(buyer);
const order = { id: buyer.url().split("/").pop().split("?")[0], number: (await main(buyer)).match(/FO-\d{4}-\d{6}/)[0] };
check("order page: sold-by-weight card, not weighed yet", (await buyer.getByTestId("order-weights").count()) === 1 && /Ainda não pesado/.test(await buyer.getByTestId("weight-state").first().textContent()));
check("line keeps the supplier's 5 % limit", sql(`select "cwMaxOverPct" from "OrderLine" where "orderId"='${order.id}'`) === "5.00");

// ── 3. Supplier weighs: a scale label, then the five pieces typed ──
await go(vendor, `/vendor/orders/${order.id}`);
await vendor.getByRole("button", { name: /Confirmar encomenda/ }).click(); await settle(vendor);
await go(vendor, `/vendor/orders/${order.id}`);
await vendor.getByTestId("weigh-scan").fill(ean("284123402150"));
await vendor.getByTestId("weigh-scan").press("Enter");
check("scale label scanned: + 2,150 kg", await until(async () => /2,150/.test((await vendor.getByTestId("scan-result").textContent()) ?? "")));
await vendor.getByTestId("weigh-scan").fill(ean("289999902000"));
await vendor.getByTestId("weigh-scan").press("Enter");
check("another product's label is refused", await until(async () => /outro produto/.test((await vendor.getByTestId("scan-result").textContent()) ?? "")), JSON.stringify(await vendor.getByTestId("scan-result").allTextContents()) + JSON.stringify(await vendor.locator("[role=alert]").allTextContents()));
await go(vendor, `/vendor/orders/${order.id}`);
const wf = vendor.getByTestId("weigh-form").first();
while ((await wf.getByTestId("piece-kg").count()) < 5) await wf.getByRole("button", { name: /Adicionar peça/ }).click();
const kgs = ["2,05", "1,98", "2,10", "2,02", "2,40"];
for (let i = 0; i < 5; i++) await wf.getByTestId("piece-kg").nth(i).fill(kgs[i]);
check("running total 10,550 kg", /10,550/.test((await wf.getByTestId("weigh-total").textContent()) ?? ""));
await wf.getByTestId("weigh-save").click();
check("weighed 10,55 kg: above the 10,5 kg limit, billed 10,5", await until(async () => sql(`select "cwActualKg"||'|'||"cwBilledKg" from "OrderLine" where "orderId"='${order.id}'`) === "10.550|10.500"));
await go(vendor, `/vendor/orders/${order.id}#weights`);
check("supplier sees: above the limit", (await vendor.locator("[data-testid=weight-line][data-capped='1']").count()) === 1);
await shot(vendor, "cw-04-supplier-weighing", true);

// ── 4. Customer: told, accepts the extra ──
check("customer notified (heavier than ordered)", await until(async () => Number(sql(`select count(*) from "NotificationMessage" where "eventKey"='catchweight.over_limit' and "refId"='${order.id}'`)) > 0));
await go(buyer, `/buy/orders/${order.id}`);
check("customer sees the limit note", /no máximo/.test((await buyer.getByTestId("over-note").textContent()) ?? ""));
await shot(buyer, "cw-05-customer-over-limit", true);
await buyer.getByTestId("accept-over").click();
check("extra accepted: billed 10,55 kg", await until(async () => sql(`select "cwOverAccepted"||'|'||"cwBilledKg" from "OrderLine" where "orderId"='${order.id}'`) === "true|10.550"));
check("supplier told", await until(async () => Number(sql(`select count(*) from "NotificationMessage" where "eventKey"='catchweight.over_accepted' and "refId"='${order.id}'`)) > 0));

// ── 5. Driver weighs again at the stop ──
await go(vendor, `/vendor/orders/${order.id}`);
await vendor.getByRole("button", { name: /Pronta para recolha/ }).click(); await settle(vendor);
const drvId = sql(`select d.id from "Driver" d join "User" u on u.id=d."userId" where u.email='driver@firingi.test'`);
const adminCo = sql(`select id from "Company" where type='ADMIN' limit 1`);
sql(`update "Delivery" set "driverId"=null, status='UNASSIGNED', "routeId"=null where "driverId"='${drvId}' and status in ('ASSIGNED','PICKED_UP','OUT_FOR_DELIVERY')`);
sql(`update "Delivery" set "driverId"='${drvId}', status='ASSIGNED', mode='FIRINGI_FLEET', "executingCompanyId"='${adminCo}' where "orderId"='${order.id}'`);
sql(`update "Driver" set availability='AVAILABLE' where id='${drvId}'`);
const deliveryId = sql(`select id from "Delivery" where "orderId"='${order.id}'`);
const driver = await login("driver@firingi.test", { viewport: PHONE });
await go(driver, `/driver/deliveries/${deliveryId}`);
for (const step of [/^Recolhida$/, /^Iniciar entrega$/]) { await driver.getByRole("button", { name: step }).click(); await settle(driver); }
await go(driver, `/driver/deliveries/${deliveryId}`);
check("driver sees the sold-by-weight line", (await driver.getByTestId("stop-weights").count()) === 1 && /10,550/.test(await driver.getByTestId("stop-weights").textContent()));
await driver.getByTestId("stop-weight").first().fill("10,40");
await driver.fill("#recipientName", "Karim Kebab");
await driver.locator("canvas").first().scrollIntoViewIfNeeded(); // the pad can sit below the fold (e.g. temperatures above it)
const pad = await driver.locator("canvas").first().boundingBox();
await driver.mouse.move(pad.x + 20, pad.y + 30); await driver.mouse.down();
for (let i = 1; i < 10; i++) await driver.mouse.move(pad.x + 20 + i * 18, pad.y + 30 + (i % 2 ? 25 : -5));
await driver.mouse.up();
await driver.getByTestId("stop-weights").scrollIntoViewIfNeeded();
await driver.evaluate(() => window.scrollBy(0, 120));
await shot(driver, "cw-06-driver-stop");
await driver.getByRole("button", { name: /Confirmar entrega/ }).click();
check("delivered, re-weighed by the driver: 10,4 kg", await until(async () => sql(`select status from "Order" where id='${order.id}'`) === "DELIVERED" && sql(`select "cwBilledKg" from "OrderLine" where "orderId"='${order.id}'`) === "10.400"));
const desc = sql(`select l.description from "InvoiceLine" l join "Invoice" i on i.id=l."invoiceId" where i."orderId"='${order.id}' and i."docType"='INVOICE' and l."orderLineId" is not null`);
const perKg = (Number(sql(`select "unitSalePriceNet" from "OrderLine" where "orderId"='${order.id}'`)) / 2).toFixed(4).replace(".", ",");
check("invoice line: 10,400 kg × the customer's price per kg", desc.includes(`10,400 kg × ${perKg} €/kg`), desc);
check("weighing history: label, order page, driver", sql(`select string_agg(source::text, ',' order by at) from "CatchWeighing" w join "OrderLine" l on l.id=w."orderLineId" where l."orderId"='${order.id}'`) === "SCAN,SUPPLIER,DRIVER");

// ── 6. Reports ──
await go(vendor, "/vendor/orders/weighing");
check("supplier weighing report lists the mozzarella", (await vendor.getByTestId("cw-report").count()) === 1 && /Mozzarella/.test(await vendor.getByTestId("cw-report").textContent()));
await shot(vendor, "cw-07-supplier-report", true);
const admin = await login("superadmin@firingi.test", { locale: "en-GB" });
await go(admin, "/admin/orders/catch-weight");
check("FIRINGI overview: per supplier", /Lisboa Central/.test((await admin.getByTestId("cw-suppliers").textContent()) ?? ""));
await shot(admin, "cw-08-admin-overview", true);
await go(admin, "/admin/settings/catch-weight");
await admin.getByTestId("cw-default").fill("12");
await admin.getByTestId("cw-buffer").fill("15");
await admin.getByTestId("cw-settings-save").click();
check("FIRINGI settings saved (limit 12 %, buffer 15 %)", await until(async () => { const v = JSON.parse(sql(`select value from "Setting" where key='catchweight.settings'`) || "{}"); return v.maxOverPct?.default === 12 && v.prepayBufferPct === 15; }));
await shot(admin, "cw-09-admin-settings", true);

// ── 7. Phone width, dark mode ──
const phone = await login("owner@kebabhouse.test", { viewport: PHONE, colorScheme: "dark" });
for (const url of [`/buy/orders/${order.id}`, `/buy/catalogue/offers/${MOZZ}`]) {
  await go(phone, url);
  const over = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(`phone width: no sideways scrolling (${url.replace(order.id, ":id").replace(MOZZ, ":offer")})`, over <= 1, `${over}px`);
}
await go(phone, `/buy/orders/${order.id}#weights`);
await phone.locator("#weights").scrollIntoViewIfNeeded().catch(() => {});
await shot(phone, "cw-10-phone-dark");
const vphone = await login("owner@lisboacentral.test", { viewport: PHONE });
for (const url of ["/vendor/products/weights", "/vendor/orders/weighing", `/vendor/orders/${order.id}`]) {
  await go(vphone, url);
  const over = await vphone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(`phone width: no sideways scrolling (${url.replace(order.id, ":id")})`, over <= 1, `${over}px`);
}

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
cleanup();
await browser.close();
if (failures) { console.log(`\n${failures} check(s) failed`); process.exit(1); }
console.log("\nall checks passed");
