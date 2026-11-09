/**
 * Browser test of Phase 6 against a running server with the demo seed:
 * vendor fleet (driver, vehicle, service area) → order → vendor assigns its driver →
 * driver app: pick up, start, deliver with signature → buyer return → FIRINGI approves →
 * supplier receives (credit note); FIRINGI-fleet order fails → returned to supplier;
 * admin control tower, zones, Super Admin multi-order setting.
 *   node tests/e2e/delivery.mjs [baseUrl] [screenshotDir]
 */
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");

const BASE = process.argv[2] ?? "http://localhost:3000";
const SHOTS = process.argv[3] ?? null;
const PASSWORD = process.env.SEED_PASSWORD ?? "Firingi!2026";
let failures = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "✔" : "✘"} ${name}${extra ? ` — ${extra}` : ""}`); if (!ok) failures++; };
const shot = async (page, name, full = true) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: full });
const browser = await chromium.launch();
const settle = async (p) => { await p.waitForLoadState("networkidle"); await p.waitForTimeout(600); };
const go = async (p, url) => { await p.goto(`${BASE}${url}`); await settle(p); };
async function login(email, password = PASSWORD, viewport = { width: 1440, height: 950 }) {
  const page = await (await browser.newContext({ viewport })).newPage();
  await go(page, "/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
  await settle(page);
  return page;
}
const main = (p) => p.textContent("main");
const stamp = Date.now().toString().slice(-6);
const driverEmail = `driver.${stamp}@lisboacentral.test`;
const driverName = `Rui Estafeta ${stamp}`;
const driverPass = "Estafeta!2026";

async function pickOption(page, selector, text) {
  const value = await page.locator(`${selector} option`, { hasText: text }).first().getAttribute("value");
  await page.locator(selector).selectOption(value);
}
async function orderVia(customer, query, pick, qty) {
  const api = await (await customer.request.get(`${BASE}/api/catalogue/offers?q=${query}`)).json();
  const offer = api.items.find(pick);
  await go(customer, "/buy/orders/cart");
  const clear = customer.getByRole("button", { name: /Esvaziar carrinho|Clear cart/ });
  if (await clear.count()) { await clear.click(); await settle(customer); }
  await go(customer, `/buy/catalogue/offers/${offer.offerId}`);
  await customer.locator('main input[type="number"]').first().fill(String(qty));
  await customer.getByRole("button", { name: /Adicionar ao carrinho|Add to cart/ }).click();
  await settle(customer);
  await go(customer, "/buy/orders/cart");
  await customer.getByRole("button", { name: /Fazer encomenda|Place order/ }).click();
  await customer.waitForURL("**placed=1", { timeout: 15000 });
  await settle(customer);
  return { number: (await main(customer)).match(/FO-\d{4}-\d{6}/)[0], id: customer.url().split("/").pop().split("?")[0] };
}

// ── 1. Vendor fleet: driver, vehicle, service area ──
const vendor = await login("owner@lisboacentral.test");
await go(vendor, "/vendor/fleet/drivers");
await vendor.getByRole("button", { name: /Adicionar motorista|Add driver/ }).click();
await vendor.fill('input[name="driverName"]', driverName);
await vendor.fill('input[name="driverEmail"]', driverEmail);
await vendor.fill('input[name="driverPassword"]', driverPass);
await vendor.fill('input[name="licenceNumber"]', `LX-${stamp}`);
await vendor.getByRole("button", { name: /^Guardar$|^Save$/ }).first().click();
await settle(vendor);
check("vendor adds its own driver (active at once)", (await main(vendor)).includes(driverName));
await shot(vendor, "p6-01-vendor-drivers");
await go(vendor, "/vendor/fleet/vehicles");
await vendor.getByRole("button", { name: /Adicionar veículo|Add vehicle/ }).click();
await vendor.fill('input[name="plate"]', `LX${stamp}`);
await vendor.locator('select[name="vehicleType"]').selectOption("REFRIGERATED_VAN");
await vendor.getByRole("button", { name: /^Guardar$|^Save$/ }).first().click();
await settle(vendor);
check("vendor adds a vehicle", (await main(vendor)).includes(`LX${stamp}`));
await go(vendor, "/vendor/fleet/service-areas");
await vendor.locator('select[name="areaType"]').selectOption("RADIUS_KM");
await vendor.locator('select[name="areaPick"]').selectOption({ index: 1 });
await vendor.fill('input[name="radiusKm"]', "30");
await vendor.getByRole("button", { name: /Adicionar área|Add area/ }).click();
await settle(vendor);
check("vendor sells within 30 km of its warehouse", /30 km/.test(await main(vendor)));
await shot(vendor, "p6-02-service-areas");

// ── 2. Customer orders (vendor's free delivery: 8 pizza boxes = 156 €) ──
const customer = await login("owner@kebabhouse.test");
const o1 = await orderVia(customer, "pizza", (i) => i.vendor.name === "Lisboa Central", 8);
check("customer inside the area can order", !!o1.number, o1.number);

// ── 3. Vendor confirms, assigns its driver and vehicle, marks ready ──
await go(vendor, `/vendor/orders/${o1.id}`);
await vendor.getByRole("button", { name: /Confirmar encomenda|Confirm order/ }).click();
await settle(vendor);
const panel = '[data-testid="delivery-panel"]';
await pickOption(vendor, `${panel} select[name="driverId"]`, driverName);
await pickOption(vendor, `${panel} select[name="vehicleId"]`, `LX${stamp}`);
await vendor.locator(panel).getByRole("button", { name: /^Atribuir$|^Assign$/ }).click();
await settle(vendor);
check("delivery assigned to the vendor's driver", (await vendor.locator(panel).textContent()).includes(driverName));
await vendor.getByRole("button", { name: /Pronta para recolha|Ready for pickup/ }).click();
await settle(vendor);

// ── 4. Driver app (phone): pick up, start, deliver with signature ──
const driver = await login(driverEmail, driverPass, { width: 390, height: 844 });
check("driver lands in the driver app", driver.url().includes("/driver/deliveries/today"), driver.url());
const card = driver.locator('[data-testid="driver-delivery"]', { hasText: o1.number });
check("driver sees today's delivery", (await card.count()) === 1);
await shot(driver, "p6-03-driver-today");
await card.getByRole("button", { name: /^Recolhida$|^Picked up$/ }).click();
await settle(driver);
await driver.locator('[data-testid="driver-delivery"]', { hasText: o1.number }).getByRole("button", { name: /Iniciar entrega|Start delivery/ }).click();
await settle(driver);
await driver.locator('[data-testid="driver-delivery"]', { hasText: o1.number }).getByRole("link", { name: /^Entregue$|^Delivered$/ }).click();
await settle(driver);
await driver.fill("#recipientName", "Ahmed (Kebab House)");
const box = await driver.locator('[data-testid="signature"]').boundingBox();
await driver.mouse.move(box.x + 30, box.y + 100);
await driver.mouse.down();
for (let i = 0; i <= 20; i++) await driver.mouse.move(box.x + 30 + i * 14, box.y + 100 + Math.sin(i / 2) * 40);
await driver.mouse.up();
await shot(driver, "p6-04-driver-proof");
await driver.getByRole("button", { name: /Confirmar entrega|Confirm delivery/ }).click();
await settle(driver);
await go(vendor, `/vendor/orders/${o1.id}`);
check("order delivered with proof of delivery", /Entregue|Delivered/.test(await main(vendor)) && (await vendor.locator('[data-testid="pod"]').count()) === 1);
const sig = await vendor.request.get(`${BASE}/api/deliveries/${await vendor.locator(`${panel} img`).first().getAttribute("src").then((s) => s.split("/")[3])}/files/signature`);
check("signature image is served to the supplier", sig.status() === 200 && (sig.headers()["content-type"] ?? "").startsWith("image/"));
check("strangers can't open the proof", (await (await login("owner@ibericas.test")).request.get(sig.url())).status() === 404);
await shot(vendor, "p6-05-order-delivered");

// ── 5. Return: buyer asks, FIRINGI approves, supplier receives → credit note ──
await go(customer, `/buy/orders/${o1.id}`);
await customer.getByRole("button", { name: /Devolver mercadoria|Return goods/ }).click();
await customer.locator('[data-testid="returns-panel"] input[type="number"]').first().fill("2");
await customer.fill('input[name="returnReason"]', "Two boxes arrived crushed");
await customer.getByRole("button", { name: /Enviar pedido de devolução|Send return request/ }).click();
await settle(customer);
check("buyer requests a return", /Pedido de devolução enviado|Return request sent|A aguardar a FIRINGI|Waiting for FIRINGI/.test(await main(customer)));
const ops = await login("ops@firingi.test");
await go(ops, "/admin/delivery/returns");
await ops.locator("tr", { hasText: o1.number }).getByRole("button", { name: /^Aprovar$|^Approve$/ }).click();
await settle(ops);
await go(vendor, "/vendor/orders/returns");
await vendor.locator("tr", { hasText: o1.number }).getByRole("button", { name: /Mercadoria recebida|Goods received/ }).click();
await settle(vendor);
check("supplier receives the return → credited", /Creditada|Credited/.test(await vendor.locator("tr", { hasText: o1.number }).textContent()));
await go(customer, "/buy/finance/invoices");
check("buyer gets a credit note", /Nota de Crédito|Credit note|NC FIR/.test(await main(customer)));

// ── 6. FIRINGI-fleet order (61 €) fails and goes back to the supplier ──
const o2 = await orderVia(customer, "mozzarella", (i) => i.vendor.name === "Lisboa Central" && i.packaging.unitsPerPack === 1, 5);
await go(vendor, `/vendor/orders/${o2.id}`);
await vendor.getByRole("button", { name: /Confirmar encomenda|Confirm order/ }).click();
await settle(vendor);
check("vendor can't dispatch FIRINGI's delivery", (await vendor.locator(`${panel} select[name="driverId"]`).count()) === 0);
await vendor.getByRole("button", { name: /Pronta para recolha|Ready for pickup/ }).click();
await settle(vendor);
await go(ops, `/admin/orders/${o2.id}`);
await pickOption(ops, `${panel} select[name="driverId"]`, "Daniel");
await ops.locator(panel).getByRole("button", { name: /^Atribuir$|^Assign$/ }).click();
await settle(ops);
const fdrv = await login("driver@firingi.test", PASSWORD, { width: 390, height: 844 });
await fdrv.locator('[data-testid="driver-delivery"]', { hasText: o2.number }).getByRole("button", { name: /^Recolhida$|^Picked up$/ }).click();
await settle(fdrv);
await fdrv.locator('[data-testid="driver-delivery"]', { hasText: o2.number }).getByRole("button", { name: /Iniciar entrega|Start delivery/ }).click();
await settle(fdrv);
await fdrv.locator('[data-testid="driver-delivery"]', { hasText: o2.number }).getByRole("link", { name: /^Entregue$|^Delivered$/ }).click();
await settle(fdrv);
await fdrv.getByRole("button", { name: /Não foi possível entregar|Could not deliver/ }).click();
await fdrv.locator('select[name="reasonCode"]').selectOption("CUSTOMER_ABSENT");
await fdrv.getByRole("button", { name: /Registar entrega falhada|Report failed delivery/ }).click();
await settle(fdrv);
await go(ops, "/admin/delivery/failed");
check("failed delivery shows in the back office", (await main(ops)).includes(o2.number));
await shot(ops, "p6-06-admin-failed");
await go(ops, `/admin/orders/${o2.id}`);
await ops.getByRole("button", { name: /Devolver a mercadoria ao fornecedor|Return goods to the supplier/ }).click();
await ops.locator(panel).locator("input").last().fill("Shop closed twice");
await ops.locator(panel).getByRole("button", { name: /Devolver a mercadoria ao fornecedor|Return goods to the supplier/ }).click();
await settle(ops);
check("goods returned to supplier → order cancelled", /Cancelada|Cancelled/.test(await main(ops)));

// ── 7. Back office: control tower, zones, multi-order setting ──
await go(ops, "/admin/delivery/control-tower");
check("control tower renders", /Delivery Control Tower/.test(await main(ops)));
await shot(ops, "p6-07-control-tower");
await go(ops, "/admin/delivery/zones");
await ops.getByRole("button", { name: "New zone" }).click();
await ops.fill('input[name="zoneName"]', `Lisboa centro ${stamp}`);
await ops.fill('input[name="zonePatterns"]', "1100-*, 1200-*");
await ops.getByRole("button", { name: "Save" }).click();
await settle(ops);
check("FIRINGI creates a postal-code zone", (await main(ops)).includes(`Lisboa centro ${stamp}`));
await go(ops, "/admin/settings/delivery");
check("operations can't change the multi-order policy", /Only Super Admin/.test(await main(ops)));
const sa = await login("superadmin@firingi.test");
await go(sa, "/admin/settings/delivery");
await sa.locator('input[name="firingiFleet"]').check();
await sa.getByRole("button", { name: "Save" }).click();
await settle(sa);
await go(sa, "/admin/settings/delivery");
check("Super Admin switches multi-order delivery on for FIRINGI's fleet", await sa.locator('input[name="firingiFleet"]').isChecked());
await shot(sa, "p6-08-multi-order");
await sa.locator('input[name="firingiFleet"]').uncheck();
await sa.getByRole("button", { name: "Save" }).click();
await settle(sa);

// cleanup: the service area (other suites expect Lisboa Central to sell everywhere in PT)
await go(vendor, "/vendor/fleet/service-areas");
await vendor.getByRole("button", { name: /^Remover$|^Remove$/ }).first().click();
await settle(vendor);
check("service area removed", /Sem áreas|No areas/.test(await main(vendor)));

await browser.close();
console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll delivery e2e checks passed");
process.exit(failures ? 1 : 0);
