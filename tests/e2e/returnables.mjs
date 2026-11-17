/**
 * Browser test of Phase 40 (returnables & deposits). Supplier and customer in Portuguese, FIRINGI in English:
 * the supplier adds its own item and links products (crates = deposit, gas cylinders = refill) → the customer
 * sees the deposit on the product page and card, the cart shows deposits and the empties to swap → delivery:
 * the driver counts the empties on the proof-of-delivery form → deposits on FIRINGI's invoice and the supplier's
 * statement → second order: empties swapped, crates handed back → the supplier checks them (one damaged) →
 * refund by credit note → the customer contests → FIRINGI decides → pickup requested and planned → statement
 * CSV → FIRINGI settings (VAT per country) → phone width, dark mode → no page errors. Cleans up after itself.
 *   node tests/e2e/returnables.mjs [baseUrl] [screenshotDir]
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

const LX = sql(`select c.id from "Company" c join "Membership" m on m."companyId"=c.id join "User" u on u.id=m."userId" where u.email='owner@lisboacentral.test' limit 1`);
const KB = sql(`select c.id from "Company" c join "Membership" m on m."companyId"=c.id join "User" u on u.id=m."userId" where u.email='owner@kebabhouse.test' limit 1`);
const offer = (sku) => sql(`select id from "VendorOffer" where "vendorCompanyId"='${LX}' and "vendorSku"='${sku}' and status='ACTIVE' order by "createdAt" limit 1`);
const ARROZ = offer("GRO-ARROZ1"), MOZZ = offer("GRO-MOZZ2");
const cleanup = () => {
  sql(`delete from "OfferReturnable" where "offerId" in ('${ARROZ}','${MOZZ}')`);
  sql(`delete from "ReturnableMovement" where "customerCompanyId"='${KB}'`);
  sql(`delete from "EmptiesReturnLine" where "returnId" in (select id from "EmptiesReturn" where "customerCompanyId"='${KB}')`);
  sql(`delete from "EmptiesReturn" where "customerCompanyId"='${KB}'`);
  sql(`delete from "EmptiesPickup" where "customerCompanyId"='${KB}'`);
  sql(`delete from "OrderReturnable" where "typeId" in (select id from "ReturnableType" where "ownerCompanyId"='${LX}')`);
  sql(`delete from "ReturnableType" where "ownerCompanyId"='${LX}'`);
  sql(`delete from "Setting" where key like 'returnables.%'`);
};
cleanup();
sql(`update "Cart" set "emptySwaps"=null where "buyerCompanyId"='${KB}'`);

async function placeOrder(buyer, lines) {
  await go(buyer, "/buy/orders/cart");
  const clear = buyer.getByRole("button", { name: /Esvaziar carrinho/ });
  if (await clear.count()) { await clear.click(); await settle(buyer); }
  for (const [offerId, qty] of lines) {
    await go(buyer, `/buy/catalogue/offers/${offerId}`);
    await buyer.locator('main input[type="number"]').first().fill(String(qty));
    await buyer.getByRole("button", { name: /Adicionar ao carrinho/ }).click();
    await settle(buyer);
  }
  await go(buyer, "/buy/orders/cart");
}
async function checkout(buyer) {
  await buyer.getByRole("button", { name: /Fazer encomenda/ }).click();
  await buyer.waitForURL("**placed=1", { timeout: 20000 });
  await settle(buyer);
  return { id: buyer.url().split("/").pop().split("?")[0], number: (await main(buyer)).match(/FO-\d{4}-\d{6}/)[0] };
}
/** Supplier confirms and readies; FIRINGI's driver takes it (assigned in the database, as dispatch would). */
async function readyForDriver(vendor, o) {
  await go(vendor, `/vendor/orders/${o.id}`);
  await vendor.getByRole("button", { name: /Confirmar encomenda/ }).click(); await settle(vendor);
  await vendor.getByRole("button", { name: /Pronta para recolha/ }).click(); await settle(vendor);
  const drv = sql(`select d.id from "Driver" d join "User" u on u.id=d."userId" where u.email='driver@firingi.test'`);
  const admin = sql(`select id from "Company" where type='ADMIN' limit 1`);
  sql(`update "Delivery" set "driverId"=null, status='UNASSIGNED', "routeId"=null where "driverId"='${drv}' and status in ('ASSIGNED','PICKED_UP','OUT_FOR_DELIVERY')`);
  sql(`update "Delivery" set "driverId"='${drv}', status='ASSIGNED', mode='FIRINGI_FLEET', "executingCompanyId"='${admin}' where "orderId"='${o.id}'`);
  sql(`update "Driver" set availability='AVAILABLE' where id='${drv}'`);
  return sql(`select id from "Delivery" where "orderId"='${o.id}'`);
}
async function driverDelivers(driver, deliveryId, counts) {
  await go(driver, `/driver/deliveries/${deliveryId}`);
  for (const step of [/^Recolhida$/, /^Iniciar entrega$/]) { await driver.getByRole("button", { name: step }).click(); await settle(driver); }
  await go(driver, `/driver/deliveries/${deliveryId}`);
  await driver.fill("#recipientName", "Karim Kebab");
  const pad = await driver.locator("canvas").first().boundingBox();
  await driver.mouse.move(pad.x + 20, pad.y + 30); await driver.mouse.down();
  for (let i = 1; i < 10; i++) await driver.mouse.move(pad.x + 20 + i * 18, pad.y + 30 + (i % 2 ? 25 : -5));
  await driver.mouse.up();
  for (const [code, n] of Object.entries(counts)) await driver.getByTestId(`empty-${code}`).fill(String(n));
  return driver;
}

const vendor = await login("owner@lisboacentral.test");
const buyer = await login("owner@kebabhouse.test");

// ── 1. Supplier: own item + product links ──
await go(vendor, "/vendor/products/returnables");
check("supplier sees FIRINGI's shared list", (await vendor.locator("[data-testid=type-row][data-code=GAS-BUTANE-13]").count()) === 1 && /Garrafa de gás butano/.test(await main(vendor)));
await vendor.fill("#rt-name", "Barril 20 L Lisboa");
await vendor.fill("#rt-code", "lx-keg-20");
await vendor.selectOption("#rt-cat", "KEG");
await vendor.selectOption("#rt-kind", "EXCHANGE");
await vendor.fill("#rt-dep", "20");
await vendor.getByTestId("type-save").click();
check("supplier adds its own keg", await until(async () => (await vendor.locator("[data-testid=type-row][data-code=LX-KEG-20]").count()) === 1));
const linkTo = async (offerId, code) => {
  await vendor.selectOption("#ln-offer", offerId);
  const typeId = sql(`select id from "ReturnableType" where code='${code}' and ("ownerCompanyId" is null or "ownerCompanyId"='${LX}') limit 1`);
  await vendor.selectOption("#ln-type", typeId);
  await vendor.fill("#ln-qty", "1");
  await vendor.getByTestId("link-save").click();
  await settle(vendor);
};
await linkTo(ARROZ, "CRATE-24");
await linkTo(MOZZ, "GAS-BUTANE-13");
check("products linked: rice in crates (deposit), mozzarella with a gas cylinder (refill)", await until(async () => (await vendor.locator("[data-testid=link-chip]").count()) === 2));
await shot(vendor, "rt-01-supplier-items", true);

// ── 2. Customer: product page, card, cart ──
await go(buyer, `/buy/catalogue/offers/${ARROZ}`);
check("product page shows the deposit", /Grade de cerveja.*depósito 3,00/.test((await buyer.getByTestId("product-returnables").textContent()) ?? ""));
await go(buyer, `/buy/catalogue/offers/${MOZZ}`);
check("refill product says: hand back an empty", /devolva uma vazia|vazia/i.test((await buyer.getByTestId("product-returnables").textContent()) ?? "") && (await buyer.locator("[data-testid=product-returnable][data-kind=EXCHANGE]").count()) === 1);
await shot(buyer, "rt-02-product-page");
await go(buyer, "/buy/catalogue/search?q=mozzarella");
check("catalogue card has the refill badge", (await buyer.getByTestId("returnable-badge").count()) > 0);
await placeOrder(buyer, [[ARROZ, 4], [MOZZ, 3]]);
const rtCard = buyer.getByTestId("cart-returnables");
check("cart lists the deposits", (await rtCard.count()) === 1 && (await buyer.locator("[data-testid=cart-returnable]").count()) === 2);
check("cart: 4 crates × 3,00 € and 3 cylinders × 25,00 € (none held yet)", /87,00/.test(await buyer.getByTestId("cart-deposit-total").textContent()));
check("cart total notes the refundable deposits", (await buyer.getByTestId("cart-deposit-note").count()) === 1);
await shot(buyer, "rt-03-cart", true);
const o1 = await checkout(buyer);
check("order 1 placed", !!o1.number, o1.number);
check("order page shows the estimated deposits", (await buyer.getByTestId("order-deposits").count()) === 1);

// ── 3. Delivery: driver counts empties (none yet); invoice carries the deposits ──
const d1 = await readyForDriver(vendor, o1);
const driver = await login("driver@firingi.test", { viewport: PHONE });
await driverDelivers(driver, d1, { "CRATE-24": 0, "GAS-BUTANE-13": 0 });
await shot(driver, "rt-04-driver-pod", true);
await driver.getByRole("button", { name: /Confirmar entrega/ }).click();
check("driver: delivered", await until(async () => sql(`select status from "Order" where id='${o1.id}'`) === "DELIVERED"));
const dep = (orderId, code) => sql(`select coalesce(sum(l.qty),0)::int || ':' || coalesce(sum(l."lineNet"),0) from "InvoiceLine" l join "Invoice" i on i.id=l."invoiceId" where i."orderId"='${orderId}' and i."docType"='INVOICE' and l.description like '%[${code}]'`);
check("invoice: 4 crate deposits = 12 €", dep(o1.id, "CRATE-24") === "4:12.00", dep(o1.id, "CRATE-24"));
check("invoice: 3 cylinder deposits = 75 €", dep(o1.id, "GAS-BUTANE-13") === "3:75.00", dep(o1.id, "GAS-BUTANE-13"));
check("supplier's statement carries the same deposits (no commission)", /DEPOSIT:GAS-BUTANE-13/.test(sql(`select lines::text from "VendorBillingStatement" where "orderId"='${o1.id}' and "isCreditStatement"=false`)));

// ── 4. Second order: empties swapped, crates handed back ──
await placeOrder(buyer, [[MOZZ, 5]]);
check("cart: the 3 cylinders held are swapped by default", (await buyer.getByTestId("swap-GAS-BUTANE-13").inputValue()) === "3" && /50,00/.test(await buyer.getByTestId("cart-deposit-total").textContent()));
const o2 = await checkout(buyer);
const d2 = await readyForDriver(vendor, o2);
await driverDelivers(driver, d2, { "CRATE-24": 4 });
check("driver: swap prefilled with the 3 empties", (await driver.getByTestId("empty-GAS-BUTANE-13").inputValue()) === "3");
await driver.getByRole("button", { name: /Confirmar entrega/ }).click();
check("order 2 delivered", await until(async () => sql(`select status from "Order" where id='${o2.id}'`) === "DELIVERED"));
check("invoice 2: only the 2 cylinders without an empty carry a deposit", dep(o2.id, "GAS-BUTANE-13") === "2:50.00", dep(o2.id, "GAS-BUTANE-13"));
const er = sql(`select id from "EmptiesReturn" where "orderId"='${o2.id}'`);
check("the 4 crates wait for the supplier's check", !!er && sql(`select status from "EmptiesReturn" where id='${er}'`) === "COLLECTED");

// ── 5. Supplier checks: 3 good, 1 damaged → refund ──
await go(vendor, "/vendor/orders/empties");
check("supplier sees the empties to check", (await vendor.locator("[data-testid=return-row][data-status=COLLECTED]").count()) >= 1);
await shot(vendor, "rt-05-supplier-empties", true);
await go(vendor, `/vendor/orders/empties/${er}`);
await vendor.getByTestId("accept-CRATE-24").fill("2");
await vendor.getByTestId("damaged-CRATE-24").fill("1");
await shot(vendor, "rt-06-supplier-check");
await vendor.getByTestId("confirm-return-save").click();
check("checked: 2 crates refunded by credit note (6 €)", await until(async () => sql(`select status || ':' || "creditGross" from "EmptiesReturn" where id='${er}'`) === "CONFIRMED:6.00"));
check("credit note issued", Number(sql(`select count(*) from "Invoice" where id = any((select "creditNoteIds" from "EmptiesReturn" where id='${er}')::text[]) and "docType"='CREDIT_NOTE'`)) === 1);

// ── 6. Customer contests; FIRINGI decides ──
await go(buyer, `/buy/orders/empties/${er}`);
check("customer sees the check and the refund", /6,00/.test(await buyer.getByTestId("return-refund").textContent()));
await buyer.getByTestId("dispute-open").click();
await buyer.fill("#dp-note", "Entregámos 4 grades, só uma estava partida");
await buyer.getByTestId("dispute-send").click();
check("contested", await until(async () => sql(`select status from "EmptiesReturn" where id='${er}'`) === "DISPUTED"));
const admin = await login("superadmin@firingi.test", { locale: "en" });
await go(admin, "/admin/orders/empties");
check("FIRINGI sees the contested count", (await admin.locator("[data-testid=return-row][data-status=DISPUTED]").count()) >= 1);
await shot(admin, "rt-07-admin-empties", true);
await go(admin, `/admin/orders/empties/${er}`);
await admin.fill("#rs-note", "Driver counted 4; one broken");
await admin.getByTestId("resolve-customer").click();
check("FIRINGI decides for the customer: one more crate refunded (9 € in all)", await until(async () => sql(`select status || ':' || "creditGross" from "EmptiesReturn" where id='${er}'`) === "RESOLVED:9.00"));

// ── 7. Customer: balances, pickup; supplier plans it ──
await go(buyer, "/buy/orders/empties");
check("customer holds 5 cylinders (3 + 5 − 3) and no crates", (await buyer.locator("[data-testid=balance-row][data-type=GAS-BUTANE-13] [data-testid=balance-held]").textContent()) === "5" && (await buyer.locator("[data-testid=balance-row][data-type=CRATE-24]").count()) === 0);
const gasId = sql(`select id from "ReturnableType" where code='GAS-BUTANE-13' and "ownerCompanyId" is null`);
await buyer.getByTestId(`pickup-qty-${gasId}`).fill("2");
await buyer.getByTestId("pickup-request").click();
check("pickup requested", await until(async () => sql(`select status from "EmptiesPickup" where "customerCompanyId"='${KB}'`) === "REQUESTED"));
await shot(buyer, "rt-08-customer-empties", true);
await go(vendor, "/vendor/orders/empties");
const hasDriver = (await vendor.getByTestId("plan-pickup-save").count()) > 0;
if (hasDriver) {
  await vendor.getByTestId("plan-pickup-save").first().click();
  check("supplier plans the pickup with a driver", await until(async () => sql(`select status from "EmptiesPickup" where "customerCompanyId"='${KB}'`) === "PLANNED"));
} else check("supplier without drivers is told to add one", /motorista/i.test(await main(vendor)));
const csv = await buyer.request.get(`${BASE}/api/returnables/statement?as=CUSTOMER`);
const body = await csv.text();
check("statement CSV: every movement with the running balance", csv.status() === 200 && body.includes("GAS-BUTANE-13") && body.split("\n").length >= 6);

// ── 8. FIRINGI settings ──
await go(admin, "/admin/settings/returnables");
await admin.locator("[data-testid=vat-row][data-country=PT] select").selectOption("FIXED");
await admin.locator("[data-testid=vat-row][data-country=PT] input").fill("23");
await admin.getByTestId("st-days").fill("60");
await admin.getByTestId("rt-settings-save").click();
check("deposit VAT per country and overdue rule saved", await until(async () => { const v = JSON.parse(sql(`select value from "Setting" where key='returnables.settings'`) || "{}"); return v.vat?.PT?.mode === "FIXED" && v.vat.PT.rate === 23 && v.overdue?.days === 60; }));
await shot(admin, "rt-09-admin-settings", true);
await go(admin, "/admin/catalogue/returnables");
check("FIRINGI sees shared and supplier items", (await admin.locator("[data-testid=admin-type][data-code=LX-KEG-20]").count()) === 1 && (await admin.locator("[data-testid=admin-type][data-code=EUR-PALLET]").count()) === 1);

// ── 9. Phone width, dark mode ──
const phone = await login("owner@kebabhouse.test", { viewport: PHONE, colorScheme: "dark" });
for (const url of ["/buy/orders/empties", `/buy/orders/empties/${er}`, `/buy/catalogue/offers/${MOZZ}`]) {
  await go(phone, url);
  const over = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(`phone width: no sideways scrolling (${url.replace(er, ":id").replace(MOZZ, ":offer")})`, over <= 1, `${over}px`);
}
await go(phone, "/buy/orders/empties");
await shot(phone, "rt-10-phone-dark", true);
const vphone = await login("owner@lisboacentral.test", { viewport: PHONE });
for (const url of ["/vendor/orders/empties", "/vendor/products/returnables"]) {
  await go(vphone, url);
  const over = await vphone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(`phone width: no sideways scrolling (${url})`, over <= 1, `${over}px`);
}

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
cleanup();
await browser.close();
if (failures) { console.log(`\n${failures} check(s) failed`); process.exit(1); }
console.log("\nall checks passed");
