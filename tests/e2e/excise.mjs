/**
 * Browser test of Phase 43 (licensed & excise goods). Supplier and customer in Portuguese, FIRINGI in English:
 * FIRINGI's excise catalogue and settings (driver check on) → the supplier sets its beer to "excise added by
 * FIRINGI" → the customer, without an alcohol licence, cannot see the beer; it uploads its licence → FIRINGI
 * approves it in the register → the beer is visible with the duty per case → the cart shows the excise (+ VAT)
 * → order → the supplier records the accompanying document (e-DA) → the FIRINGI driver must tick the licence /
 * ID check before confirming the delivery → the invoice carries a separate excise line → the customer's order
 * shows the excise and the check → the supplier's monthly excise report (table, CSV, PDF) → FIRINGI's excise
 * overview → phone width, dark mode → no page errors. Cleans up after itself.
 *   node tests/e2e/excise.mjs [baseUrl] [screenshotDir]
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
const noSideways = async (p, label) => {
  const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(`phone width: no sideways scrolling (${label})`, over <= 1, `${over}px`);
};

const LX = sql(`select c.id from "Company" c join "Membership" m on m."companyId"=c.id join "User" u on u.id=m."userId" where u.email='owner@lisboacentral.test' limit 1`);
const KB = sql(`select c.id from "Company" c join "Membership" m on m."companyId"=c.id join "User" u on u.id=m."userId" where u.email='owner@kebabhouse.test' limit 1`);
const BEER = sql(`select id from "VendorOffer" where "vendorCompanyId"='${LX}' and "vendorSku"='GRO-SBOCK33' and status='ACTIVE' order by "createdAt" limit 1`);
const ADMIN_CO = sql(`select id from "Company" where type='ADMIN' limit 1`);
const cleanup = () => {
  sql(`delete from "Setting" where key='excise.settings'`);
  sql(`delete from "CustomerLicence" where "companyId"='${KB}'`);
  sql(`update "VendorOffer" set "dutyMode"='PAID', "exciseCountries"='{}' where id='${BEER}'`);
};
cleanup();

const admin = await login("superadmin@firingi.test", { locale: "en-GB" });
const vendor = await login("owner@lisboacentral.test");
const buyer = await login("owner@kebabhouse.test");

// ── 1. FIRINGI: excise catalogue and settings ──
await go(admin, "/admin/catalogue/excise");
check("FIRINGI: excise categories (beer, wine, spirits, tobacco, e-liquid, sugar…)", (await admin.getByTestId("ex-cat").count()) >= 9);
check("FIRINGI: example rates for PT and ES", (await admin.locator("[data-testid=ex-rate][data-country=PT]").count()) > 0 && (await admin.locator("[data-testid=ex-rate][data-country=ES]").count()) > 0);
await shot(admin, "ex-01-admin-catalogue", true);
await go(admin, "/admin/settings/excise");
await admin.getByTestId("ex-driver").check();
await admin.getByTestId("ex-settings-save").click();
check("FIRINGI settings saved (driver checks the licence)", await until(async () => JSON.parse(sql(`select value from "Setting" where key='excise.settings'`) || "{}").restrictions?.driverCheck === true));
await shot(admin, "ex-02-admin-settings", true);

// ── 2. Supplier: beer → excise added by FIRINGI ──
await go(vendor, "/vendor/products/excise");
const form = vendor.locator(`[data-testid=ex-offer-form][data-offer="${BEER}"]`);
check("supplier: beer listed with its measures (5,2 % vol)", (await form.count()) === 1 && (await form.getByTestId("ex-abv").inputValue()).replace(",", ".") === "5.2");
await form.getByTestId("ex-mode").selectOption("ADDED");
await form.getByTestId("ex-save").click();
check("beer: duty now added by FIRINGI", await until(async () => sql(`select "dutyMode" from "VendorOffer" where id='${BEER}'`) === "ADDED"));
await go(vendor, "/vendor/products/excise");
await shot(vendor, "ex-03-supplier-products");

// ── 3. Customer without a licence: beer hidden; uploads the licence ──
await go(buyer, `/buy/catalogue/offers/${BEER}`);
check("no licence: beer cannot be bought", (await buyer.getByRole("button", { name: /Adicionar ao carrinho/ }).count()) === 0);
await go(buyer, "/buy/company/licences");
check("licences page: alcohol not covered", (await buyer.locator("[data-testid=licence-kind][data-ok='0']").count()) >= 1);
const lf = buyer.getByTestId("licence-form");
await lf.locator("#lic-type").selectOption("lt_alcohol");
if (await lf.locator("#lic-number").count()) await lf.locator("#lic-number").fill("PT-ALC-2026-0042");
if (await lf.locator("#lic-issuer").count()) await lf.locator("#lic-issuer").fill("Câmara Municipal de Lisboa");
if (await lf.locator("#lic-expires").count()) await lf.locator("#lic-expires").fill("2027-12-31");
await lf.locator("#lic-file").setInputFiles({ name: "licenca.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n") });
await lf.getByTestId("licence-send").click();
check("licence sent for review", await until(async () => sql(`select status from "CustomerLicence" where "companyId"='${KB}' order by "createdAt" desc limit 1`) === "PENDING"));
await go(buyer, "/buy/company/licences");
check("customer sees it waiting for FIRINGI", (await buyer.locator("[data-testid=licence-row][data-status=PENDING]").count()) === 1);
await shot(buyer, "ex-04-customer-licences", true);
check("FIRINGI told a licence is waiting", await until(async () => Number(sql(`select count(*) from "NotificationMessage" where "eventKey"='excise.licence_review'`)) > 0));

// ── 4. FIRINGI approves in the register ──
await go(admin, "/admin/customers/licences?status=PENDING");
const row = admin.locator(`[data-testid=register-row][data-company="${KB}"][data-status=PENDING]`);
check("register: Kebab House's licence pending", (await row.count()) === 1);
await shot(admin, "ex-05-admin-register", true);
await row.getByTestId("licence-approve").click();
check("licence approved", await until(async () => sql(`select status from "CustomerLicence" where "companyId"='${KB}' order by "createdAt" desc limit 1`) === "APPROVED"));
check("customer told of the decision", await until(async () => Number(sql(`select count(*) from "NotificationMessage" where "eventKey"='excise.licence_decided'`)) > 0));

// ── 5. Customer: beer visible with duty, cart shows excise, order ──
await go(buyer, `/buy/catalogue/offers/${BEER}`);
const badge = buyer.locator("[data-testid=excise-badge][data-mode=ADDED]").first();
check("product page: excise badge with the duty FIRINGI adds", (await badge.count()) === 1 && /\+/.test((await badge.getByTestId("excise-duty").textContent()) ?? ""));
await shot(buyer, "ex-06-customer-product");
await go(buyer, "/buy/orders/cart");
const clear = buyer.getByRole("button", { name: /Esvaziar carrinho/ });
if (await clear.count()) { await clear.click(); await settle(buyer); }
await go(buyer, `/buy/catalogue/offers/${BEER}`);
await buyer.locator('main input[type="number"]').first().fill("4");
await buyer.getByRole("button", { name: /Adicionar ao carrinho/ }).click();
await settle(buyer);
await go(buyer, "/buy/orders/cart");
const ce = buyer.getByTestId("cart-excise-added");
check("cart: excise added by FIRINGI (+ VAT)", (await ce.count()) === 1 && /7,4\d/.test((await ce.textContent()) ?? ""), (await ce.textContent().catch(() => "")) ?? "");
check("cart total: note of the excise to be added (9,11 € incl. VAT)", /9,11/.test((await buyer.getByTestId("cart-excise-note").textContent().catch(() => "")) ?? ""));
await buyer.getByTestId("cart-excise").scrollIntoViewIfNeeded();
await shot(buyer, "ex-07-customer-cart");
await buyer.getByRole("button", { name: /Fazer encomenda/ }).click();
await buyer.waitForURL("**placed=1", { timeout: 20000 });
await settle(buyer);
const order = { id: buyer.url().split("/").pop().split("?")[0], number: (await main(buyer)).match(/FO-\d{4}-\d{6}/)[0] };
const ex = sql(`select "exciseAddedNet"||'|'||"exciseAddedVat" from "Order" where id='${order.id}'`).split("|").map(Number);
check("order: excise added kept apart from the goods (≈ 7,41 € + VAT)", Math.abs(ex[0] - 7.41) < 0.05 && ex[1] > 0, ex.join(" / "));
check("order line carries the beer category", sql(`select "exciseCategoryId"||'|'||"exciseMode" from "OrderLine" where "orderId"='${order.id}'`) === "ec_beer|ADDED");

// ── 6. Supplier: confirm, accompanying document ──
await go(vendor, `/vendor/orders/${order.id}`);
await vendor.getByRole("button", { name: /Confirmar encomenda/ }).click(); await settle(vendor);
await go(vendor, `/vendor/orders/${order.id}#excise`);
const doc = vendor.getByTestId("order-excise-doc");
check("supplier: excise card with the document form", (await vendor.getByTestId("order-excise").count()) === 1 && (await doc.getByTestId("excise-doc-ref").count()) === 1);
await doc.getByTestId("excise-doc-ref").fill("26PTA0001234567890123");
await doc.getByTestId("excise-doc-save").click();
check("accompanying document recorded", await until(async () => sql(`select "exciseDocRef" from "Delivery" where "orderId"='${order.id}'`) === "26PTA0001234567890123"));
await go(vendor, `/vendor/orders/${order.id}#excise`);
await vendor.locator("#excise").scrollIntoViewIfNeeded();
await shot(vendor, "ex-08-supplier-order");
await vendor.getByRole("button", { name: /Pronta para recolha/ }).click(); await settle(vendor);

// ── 7. FIRINGI driver: licence / ID check before confirming ──
const drvId = sql(`select d.id from "Driver" d join "User" u on u.id=d."userId" where u.email='driver@firingi.test'`);
sql(`update "Delivery" set "driverId"=null, status='UNASSIGNED', "routeId"=null where "driverId"='${drvId}' and status in ('ASSIGNED','PICKED_UP','OUT_FOR_DELIVERY')`);
sql(`update "Delivery" set "driverId"='${drvId}', status='ASSIGNED', mode='FIRINGI_FLEET', "executingCompanyId"='${ADMIN_CO}' where "orderId"='${order.id}'`);
sql(`update "Driver" set availability='AVAILABLE' where id='${drvId}'`);
const deliveryId = sql(`select id from "Delivery" where "orderId"='${order.id}'`);
const driver = await login("driver@firingi.test", { viewport: PHONE });
await go(driver, `/driver/deliveries/${deliveryId}`);
for (const step of [/^Recolhida$/, /^Iniciar entrega$/]) { await driver.getByRole("button", { name: step }).click(); await settle(driver); }
await go(driver, `/driver/deliveries/${deliveryId}`);
const lc = driver.getByTestId("licence-check");
check("driver: licence / ID check shown", (await lc.count()) === 1);
await driver.fill("#recipientName", "Karim Kebab");
await driver.locator("canvas").first().scrollIntoViewIfNeeded();
const pad = await driver.locator("canvas").first().boundingBox();
await driver.mouse.move(pad.x + 20, pad.y + 30); await driver.mouse.down();
for (let i = 1; i < 10; i++) await driver.mouse.move(pad.x + 20 + i * 18, pad.y + 30 + (i % 2 ? 25 : -5));
await driver.mouse.up();
const confirm = driver.getByRole("button", { name: /Confirmar entrega/ });
check("confirm disabled until the check is ticked", await confirm.isDisabled());
await lc.locator("input[type=checkbox]").check();
await lc.scrollIntoViewIfNeeded();
await shot(driver, "ex-09-driver-check");
check("confirm enabled after ticking", await confirm.isEnabled());
await confirm.click();
check("delivered, check recorded", await until(async () => sql(`select status from "Order" where id='${order.id}'`) === "DELIVERED" && sql(`select ("exciseCheckedAt" is not null)::text from "Delivery" where id='${deliveryId}'`) === "true"));

// ── 8. Invoice: separate excise line ──
check("invoice: separate excise line (≈ 7,41 €)", await until(async () => {
  const v = sql(`select coalesce(sum(il."lineNet"),0) from "InvoiceLine" il join "Invoice" i on i.id=il."invoiceId" where i."orderId"='${order.id}' and il.description like 'Imposto especial de consumo%'`);
  return Math.abs(Number(v) - 7.41) < 0.05;
}));

// ── 9. Customer: order card ──
await go(buyer, `/buy/orders/${order.id}#excise`);
const oc = buyer.getByTestId("order-excise");
check("customer: excise line and added total", (await oc.locator("[data-testid=order-excise-line][data-mode=ADDED]").count()) === 1 && (await oc.getByTestId("order-excise-added").count()) === 1);
check("customer: the driver's check is shown", /Karim|condutor|motorista|verific/i.test((await oc.getByTestId("order-excise-check").textContent().catch(() => "")) ?? ""));
await oc.scrollIntoViewIfNeeded();
await shot(buyer, "ex-10-customer-order");

// ── 10. Supplier: monthly excise report ──
const ym = new Date().toISOString().slice(0, 7);
await go(vendor, `/vendor/orders/excise-report?month=${ym}`);
check("supplier report: a beer row this month", (await vendor.locator("[data-testid=excise-report-row]").count()) >= 1);
await shot(vendor, "ex-11-supplier-report", true);
const csv = await vendor.request.get(`${BASE}/api/excise/report?month=${ym}&format=csv`);
const csvText = await csv.text();
check("excise report CSV has the order", csv.status() === 200 && csvText.includes(order.number), String(csv.status()));
const pdf = await vendor.request.get(`${BASE}/api/excise/report?month=${ym}`);
check("excise report PDF", pdf.status() === 200 && /pdf/.test(pdf.headers()["content-type"] ?? ""));
const other = await buyer.request.get(`${BASE}/api/excise/report?month=${ym}&format=csv`);
check("a customer cannot download the supplier report", other.status() >= 400 || !(await other.text()).includes(order.number), String(other.status()));

// ── 11. FIRINGI overview ──
await go(admin, `/admin/finance/excise?month=${ym}`);
check("FIRINGI overview: tiles", (await admin.getByTestId("ex-tiles").count()) === 1);
await shot(admin, "ex-12-admin-overview", true);
await go(admin, `/admin/orders/${order.id}#excise`);
check("FIRINGI order page: excise card", (await admin.getByTestId("order-excise").count()) === 1);

// ── 12. Phone width, dark mode ──
const phone = await login("owner@kebabhouse.test", { viewport: PHONE, colorScheme: "dark" });
for (const url of ["/buy/company/licences", `/buy/orders/${order.id}`]) { await go(phone, url); await noSideways(phone, url.replace(order.id, ":id")); }
await go(phone, "/buy/company/licences");
await shot(phone, "ex-13-phone-dark", true);
const vphone = await login("owner@lisboacentral.test", { viewport: PHONE });
for (const url of ["/vendor/products/excise", "/vendor/orders/excise-report", `/vendor/orders/${order.id}`]) { await go(vphone, url); await noSideways(vphone, url.replace(order.id, ":id")); }

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
cleanup();
await browser.close();
if (failures) { console.log(`\n${failures} check(s) failed`); process.exit(1); }
console.log("\nall checks passed");
