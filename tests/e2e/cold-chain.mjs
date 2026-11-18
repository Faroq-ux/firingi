/**
 * Browser test of Phase 42 (cold chain & HACCP). Supplier and customer in Portuguese, FIRINGI in English:
 * FIRINGI's classes and category defaults → the supplier sees mozzarella inherit "Chilled" → the customer sees
 * the badge and orders mozzarella + rice → the supplier records 3,2 °C at dispatch → a FIRINGI driver loads at
 * 3,5 °C, a vehicle logger posts its readings over the API → at the handover the mozzarella is 7,5 °C (out of
 * range): the customer refuses it, the rice is delivered → a temperature claim is credited at once (driver's
 * fault: it left cold) → the customer sees every reading, the claim and the certificate PDF, records its own
 * receipt and an outside supplier's goods in the receiving log → the supplier's Cold Chain page (incident,
 * equipment with its checks, monthly report) → FIRINGI's overview, trip on the order, quality score, settings
 * (block switch) → phone width, dark mode → no page errors. Cleans up after itself.
 *   node tests/e2e/cold-chain.mjs [baseUrl] [screenshotDir]
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
const MOZZ = sql(`select id from "VendorOffer" where "vendorCompanyId"='${LX}' and "vendorSku"='GRO-MOZZ2' and status='ACTIVE' order by "createdAt" limit 1`);
const RICE = sql(`select id from "VendorOffer" where "vendorCompanyId"='${LX}' and "vendorSku"='GRO-ARROZ1' and status='ACTIVE' order by "createdAt" limit 1`);
const ADMIN_CO = sql(`select id from "Company" where type='ADMIN' limit 1`);
const VEH = "e2e_cc_vehicle";
const cleanup = () => {
  sql(`delete from "Setting" where key='coldchain.settings'`);
  sql(`delete from "TempLogger" where name like 'E2E %'`);
  sql(`delete from "ColdEquipment" where name like 'E2E %'`);
  sql(`update "Delivery" set "vehicleId"=null where "vehicleId"='${VEH}'`);
  sql(`delete from "Vehicle" where id='${VEH}'`);
  sql(`update "VendorOffer" set "tempClassId"=null where id in ('${MOZZ}','${RICE}')`);
};
cleanup();
sql(`insert into "Vehicle" (id, "ownerCompanyId", plate, type, "isRefrigerated", status, "updatedAt") values ('${VEH}', '${ADMIN_CO}', 'CC-42-EE', 'VAN', true, 'ACTIVE', now())`);

const admin = await login("superadmin@firingi.test", { locale: "en-GB" });
const vendor = await login("owner@lisboacentral.test");
const buyer = await login("owner@kebabhouse.test");

// ── 1. FIRINGI: classes and category defaults ──
await go(admin, "/admin/catalogue/temperature-classes");
check("FIRINGI: five temperature classes", (await admin.getByTestId("tc-row").count()) >= 5);
check("FIRINGI: cheese & dairy defaults to Chilled", /Chilled/.test((await admin.getByTestId("tc-categories").textContent()) ?? ""));
await shot(admin, "cc-01-admin-classes", true);

// ── 2. Supplier: mozzarella inherits Chilled ──
await go(vendor, "/vendor/products/temperature");
const mrow = vendor.locator(`[data-testid=cc-offer][data-offer="${MOZZ}"]`);
check("supplier: mozzarella inherits Refrigerado from its category", /Refrigerado/.test((await mrow.locator("select option").first().textContent()) ?? ""));
await shot(vendor, "cc-02-supplier-products");

// ── 3. Customer: badge, order mozzarella + rice ──
await go(buyer, `/buy/catalogue/offers/${MOZZ}`);
check("product page: Refrigerado badge", (await buyer.locator("[data-testid=cold-badge][data-class=CHILLED]").count()) > 0);
await go(buyer, "/buy/orders/cart");
const clear = buyer.getByRole("button", { name: /Esvaziar carrinho/ });
if (await clear.count()) { await clear.click(); await settle(buyer); }
for (const [offer, qty] of [[MOZZ, "4"], [RICE, "4"]]) {
  await go(buyer, `/buy/catalogue/offers/${offer}`);
  await buyer.locator('main input[type="number"]').first().fill(qty);
  await buyer.getByRole("button", { name: /Adicionar ao carrinho/ }).click();
  await settle(buyer);
}
await go(buyer, "/buy/orders/cart");
await buyer.getByRole("button", { name: /Fazer encomenda/ }).click();
await buyer.waitForURL("**placed=1", { timeout: 20000 });
await settle(buyer);
const order = { id: buyer.url().split("/").pop().split("?")[0], number: (await main(buyer)).match(/FO-\d{4}-\d{6}/)[0] };
check("order lines carry their class (mozzarella chilled, rice none)", sql(`select string_agg(coalesce("tempClassId",'-'), ',' order by "tempClassId" nulls last) from "OrderLine" where "orderId"='${order.id}'`) === "tc_chilled,-");
check("order page: cold-chain card", (await buyer.getByTestId("order-cold").count()) === 1);

// ── 4. Supplier: dispatch temperature ──
await go(vendor, `/vendor/orders/${order.id}`);
await vendor.getByRole("button", { name: /Confirmar encomenda/ }).click(); await settle(vendor);
await go(vendor, `/vendor/orders/${order.id}#cold-chain`);
const disp = vendor.getByTestId("record-dispatch");
await disp.getByTestId("temp-input").first().fill("3,2");
check("live status: in range", (await disp.locator("[data-testid=temp-status][data-status=OK]").count()) === 1);
await disp.getByTestId("save-dispatch").click();
check("dispatch reading saved (3,2 °C, OK)", await until(async () => sql(`select "valueC"||'|'||status from "TempReading" where "orderId"='${order.id}' and stage='DISPATCH'`) === "3.2|OK"));
await go(vendor, `/vendor/orders/${order.id}#cold-chain`);
await vendor.locator("#cold-chain").scrollIntoViewIfNeeded();
await shot(vendor, "cc-03-supplier-dispatch");
await vendor.getByRole("button", { name: /Pronta para recolha/ }).click(); await settle(vendor);

// ── 5. FIRINGI driver + vehicle, logger on the vehicle ──
const drvId = sql(`select d.id from "Driver" d join "User" u on u.id=d."userId" where u.email='driver@firingi.test'`);
sql(`update "Delivery" set "driverId"=null, status='UNASSIGNED', "routeId"=null where "driverId"='${drvId}' and status in ('ASSIGNED','PICKED_UP','OUT_FOR_DELIVERY')`);
sql(`update "Delivery" set "driverId"='${drvId}', status='ASSIGNED', mode='FIRINGI_FLEET', "executingCompanyId"='${ADMIN_CO}', "vehicleId"='${VEH}' where "orderId"='${order.id}'`);
sql(`update "Driver" set availability='AVAILABLE' where id='${drvId}'`);
const deliveryId = sql(`select id from "Delivery" where "orderId"='${order.id}'`);
await go(admin, "/admin/delivery/cold-chain");
const lf = admin.getByTestId("logger-form");
await lf.locator("#lg-name").fill("E2E Van logger");
await lf.locator("#lg-veh").selectOption(VEH);
await lf.locator("#lg-cls").selectOption("tc_chilled");
await lf.getByTestId("logger-save").click();
const tokenBox = admin.getByTestId("logger-token");
check("logger key shown once", await until(async () => /fcl_/.test((await tokenBox.textContent()) ?? "")));
const token = ((await tokenBox.locator("code").textContent()) ?? "").trim();
await shot(admin, "cc-04-admin-logger-key");

const driver = await login("driver@firingi.test", { viewport: PHONE });
await go(driver, `/driver/deliveries/${deliveryId}`);
const load = driver.getByTestId("record-loading");
await load.getByTestId("temp-input").first().fill("3,5");
await load.getByTestId("save-loading").click();
check("loading reading saved (3,5 °C)", await until(async () => sql(`select "valueC" from "TempReading" where "orderId"='${order.id}' and stage='LOADING'`) === "3.5"));
for (const step of [/^Recolhida$/, /^Iniciar entrega$/]) { await driver.getByRole("button", { name: step }).click(); await settle(driver); }
// a 10-minute trip: picked up 10 minutes ago, a reading every 2 minutes, warming up at the end
sql(`update "Delivery" set "pickedUpAt" = now() - interval '10 minutes' where id='${deliveryId}'`);
const pts = [3.4, 3.9, 4.6, 6.2, 7.4].map((v, i) => ({ at: new Date(Date.now() - (9 - i * 2) * 60_000).toISOString(), value: v }));
const res = await fetch(`${BASE}/api/coldchain/readings`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ readings: pts }) });
check("logger API accepts the readings", res.status === 200, `${res.status} ${(await res.text()).slice(0, 120)}`);
const bad = await fetch(`${BASE}/api/coldchain/readings`, { method: "POST", headers: { authorization: "Bearer fcl_wrong", "content-type": "application/json" }, body: JSON.stringify({ value: 3 }) });
check("logger API refuses a wrong key", bad.status === 401 || bad.status === 403 || bad.status === 404, String(bad.status));

// ── 6. Handover: mozzarella out of range, refused ──
await go(driver, `/driver/deliveries/${deliveryId}`);
const ho = driver.getByTestId("handover-temps");
check("driver sees the loading temperature at the handover", /3,5/.test((await ho.textContent()) ?? ""));
await ho.getByTestId("temp-input").first().fill("7,5");
check("live status: out of range", (await ho.locator("[data-testid=temp-status][data-status=OUT]").count()) === 1);
await ho.getByTestId("refuse-class").check();
await driver.fill("#recipientName", "Karim Kebab");
await driver.locator("canvas").first().scrollIntoViewIfNeeded(); // the pad can sit below the fold (e.g. temperatures above it)
const pad = await driver.locator("canvas").first().boundingBox();
await driver.mouse.move(pad.x + 20, pad.y + 30); await driver.mouse.down();
for (let i = 1; i < 10; i++) await driver.mouse.move(pad.x + 20 + i * 18, pad.y + 30 + (i % 2 ? 25 : -5));
await driver.mouse.up();
await ho.scrollIntoViewIfNeeded();
await shot(driver, "cc-05-driver-handover");
await driver.getByRole("button", { name: /Confirmar entrega/ }).click();
check("delivered (rice), mozzarella refused", await until(async () => sql(`select status from "Order" where id='${order.id}'`) === "DELIVERED" && sql(`select decision from "ColdIncident" where "orderId"='${order.id}'`) === "REFUSED"));
check("fault: the driver (left cold, arrived warm)", sql(`select fault from "ColdIncident" where "orderId"='${order.id}'`) === "DRIVER");
check("temperature claim approved and credited", await until(async () => sql(`select q.reason||'|'||q.status||'|'||(q."creditNoteId" is not null) from "QualityClaim" q where q."orderId"='${order.id}'`) === "TEMPERATURE|APPROVED|true"));
check("supplier / FIRINGI alerted", await until(async () => Number(sql(`select count(*) from "NotificationMessage" where "eventKey"='coldchain.breach'`)) > 0));

// ── 7. Customer: card, claim, certificate, receipt, receiving log ──
await go(buyer, `/buy/orders/${order.id}#cold-chain`);
const card = buyer.getByTestId("order-cold");
const stages = await card.locator("[data-testid=cold-reading]").evaluateAll((els) => els.map((e) => e.getAttribute("data-stage")));
check("customer sees dispatch, loading and handover", ["DISPATCH", "LOADING", "HANDOVER"].every((s) => stages.includes(s)), stages.join(","));
check("customer does not see the logger trip", (await card.getByTestId("cold-trip").count()) === 0);
check("incident with the claim link", (await card.locator("[data-testid=cold-incident][data-decision=REFUSED]").count()) === 1 && /Reclamação|CL-/.test((await card.getByTestId("cold-incident").textContent()) ?? ""));
const cert = await buyer.request.get(`${BASE}/api/coldchain/certificate/${order.id}`);
check("temperature certificate PDF", cert.status() === 200 && /pdf/.test(cert.headers()["content-type"] ?? ""), String(cert.status()));
const rec = card.getByTestId("record-receipt");
await rec.getByTestId("temp-input").first().fill("4,8");
await rec.getByTestId("save-receipt").click();
check("customer's own receipt reading (4,8 °C = tolerance)", await until(async () => sql(`select status from "TempReading" where "orderId"='${order.id}' and stage='RECEIPT'`) === "WARN"));
await go(buyer, `/buy/orders/${order.id}#cold-chain`);
await buyer.locator("#cold-chain").scrollIntoViewIfNeeded();
await shot(buyer, "cc-06-customer-order");
await go(buyer, "/buy/orders/receiving");
const before = await buyer.getByTestId("receiving-row").count();
const rf = buyer.getByTestId("receiving-form");
await rf.locator("#rc-sup").fill("Peixaria do Mar");
await rf.locator("#rc-prod").fill("Dourada fresca 2 kg");
await rf.locator("#rc-cls").selectOption("tc_fresh_fish");
await rf.locator("#rc-temp").fill("1,5");
await rf.getByTestId("receiving-save").click();
await settle(buyer);
check("receiving log: outside supplier's goods added", await until(async () => { await go(buyer, "/buy/orders/receiving"); return (await buyer.getByTestId("receiving-row").count()) === before + 1; }, 15000));
check("receiving log lists the FIRINGI handover too", ((await buyer.getByTestId("receiving-log").textContent()) ?? "").includes(order.number));
await shot(buyer, "cc-07-customer-receiving", true);

// ── 8. Supplier: Cold Chain page ──
await go(vendor, "/vendor/fleet/cold-chain");
check("supplier sees the incident", (await vendor.locator(`[data-testid=cc-incident][data-decision=REFUSED]`).count()) >= 1);
const ef = vendor.getByTestId("equipment-form");
await ef.locator("#eq-kind").selectOption("COLD_ROOM");
await ef.getByTestId("eq-name").fill("E2E Câmara 1");
await ef.locator("#eq-cls").selectOption("tc_chilled");
await ef.getByTestId("eq-save").click();
check("equipment added with its checks due", await until(async () => { await go(vendor, "/vendor/fleet/cold-chain"); return (await vendor.locator("[data-testid=cc-equipment-row]", { hasText: "E2E Câmara 1" }).count()) === 1; }, 15000));
const erow = vendor.locator("[data-testid=cc-equipment-row]", { hasText: "E2E Câmara 1" });
check("new equipment: daily check and weekly cleaning due", (await erow.getByTestId("cc-due").count()) === 2);
await erow.getByTestId("eq-log-form").locator("input[inputmode=decimal]").fill("2,8");
await erow.getByTestId("eq-log-save").click();
check("temperature check logged", await until(async () => sql(`select count(*) from "EquipmentLog" l join "ColdEquipment" e on e.id=l."equipmentId" where e.name='E2E Câmara 1' and l.kind='CHECK'`) === "1"));
await go(vendor, "/vendor/fleet/cold-chain");
await shot(vendor, "cc-08-supplier-cold-chain", true);
const ym = new Date().toISOString().slice(0, 7);
const csv = await vendor.request.get(`${BASE}/api/coldchain/report?month=${ym}&format=csv`);
const csvText = await csv.text();
check("monthly HACCP report (CSV) has the order", csv.status() === 200 && csvText.includes(order.number), String(csv.status()));
const pdf = await vendor.request.get(`${BASE}/api/coldchain/report?month=${ym}`);
check("monthly HACCP report (PDF)", pdf.status() === 200 && /pdf/.test(pdf.headers()["content-type"] ?? ""));
await go(vendor, "/vendor/orders/claims/quality");
check("supplier quality page: cold-chain breaches", /\b[1-9]\d*\b/.test((await vendor.getByTestId("cold-breaches").textContent()) ?? ""));

// ── 9. FIRINGI: overview, trip, quality, settings ──
await go(admin, "/admin/delivery/cold-chain");
check("FIRINGI overview: incident and per-driver score", (await admin.locator("[data-testid=cc-incident][data-decision=REFUSED]").count()) >= 1 && (await admin.getByTestId("cc-scores").count()) === 1);
await shot(admin, "cc-09-admin-cold-chain", true);
await go(admin, `/admin/orders/${order.id}#cold-chain`);
const trip = admin.getByTestId("cold-trip");
check("FIRINGI sees the logger trip (5 readings, max 7,4 °C)", (await trip.count()) === 1 && /7,4/.test((await trip.textContent()) ?? ""));
await admin.locator("#cold-chain").scrollIntoViewIfNeeded();
await shot(admin, "cc-10-admin-order-trip");
await go(admin, "/admin/orders/claims/quality");
check("FIRINGI quality: Lisboa's breaches counted", (await admin.getByTestId("cold-breaches").count()) > 0);
await go(admin, "/admin/settings/cold-chain");
await admin.getByTestId("cc-block").check();
await admin.getByTestId("cc-require").check();
await admin.getByTestId("cc-settings-save").click();
check("FIRINGI settings saved (block + required)", await until(async () => { const v = JSON.parse(sql(`select value from "Setting" where key='coldchain.settings'`) || "{}"); return v.actions?.block === true && v.requireHandover === true; }));
await shot(admin, "cc-11-admin-settings", true);

// ── 10. Phone width, dark mode ──
const phone = await login("owner@kebabhouse.test", { viewport: PHONE, colorScheme: "dark" });
for (const url of [`/buy/orders/${order.id}`, "/buy/orders/receiving"]) { await go(phone, url); await noSideways(phone, url.replace(order.id, ":id")); }
await go(phone, `/buy/orders/${order.id}#cold-chain`);
await phone.locator("#cold-chain").scrollIntoViewIfNeeded().catch(() => {});
await shot(phone, "cc-12-phone-dark");
const vphone = await login("owner@lisboacentral.test", { viewport: PHONE });
for (const url of ["/vendor/products/temperature", "/vendor/fleet/cold-chain", `/vendor/orders/${order.id}`]) { await go(vphone, url); await noSideways(vphone, url.replace(order.id, ":id")); }

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
cleanup();
await browser.close();
if (failures) { console.log(`\n${failures} check(s) failed`); process.exit(1); }
console.log("\nall checks passed");
