/**
 * Browser test of Phase 12 against a running server with the demo seed:
 * Super Admin allows multi-order delivery for FIRINGI's fleet → two small orders (FIRINGI
 * delivers) → supplier confirms, ready → Ops plans one multi-stop route → driver starts it →
 * the customer sees the ETA window and is notified → pickups and deliveries tick the stops →
 * live board, ETA page, performance and earnings; vendor routes page in Portuguese.
 *   node tests/e2e/routes.mjs [baseUrl] [screenshotDir]
 */
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");

const BASE = process.argv[2] ?? "http://localhost:3000";
const SHOTS = process.argv[3] ?? null;
const PASSWORD = process.env.SEED_PASSWORD ?? "Firingi!2026";
const DRIVER_NAME = "Daniel Motorista";
let failures = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "✔" : "✘"} ${name}${extra ? ` — ${extra}` : ""}`); if (!ok) failures++; };
const shot = async (page, name, full = true) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: full });
const browser = await chromium.launch();
const settle = async (p) => { await p.waitForLoadState("networkidle"); await p.waitForTimeout(500); };
const go = async (p, url) => { await p.goto(`${BASE}${url}`); await settle(p); };
const errors = [];
async function login(email, viewport = { width: 1440, height: 950 }) {
  const page = await (await browser.newContext({ viewport })).newPage();
  page.on("pageerror", (e) => errors.push(`${email}: ${e.message}`));
  await go(page, "/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await settle(page);
  return page;
}
const main = (p) => p.textContent("main");

const sa = await login("superadmin@firingi.test");
const ops = await login("ops@firingi.test");
const customer = await login("owner@kebabhouse.test");
const lx = await login("owner@lisboacentral.test");

// ── 0. Super Admin: FIRINGI drivers may carry several orders ──
await go(sa, "/admin/settings/delivery");
const multi = sa.locator('input[name="firingiFleet"]');
const multiBefore = await multi.isChecked();
if (!multiBefore) {
  await multi.check();
  await sa.getByRole("button", { name: "Save" }).first().click();
  await settle(sa);
}
await go(sa, "/admin/settings/delivery");
check("multi-order delivery on for FIRINGI's fleet", await sa.locator('input[name="firingiFleet"]').isChecked());

// ── 1. Two small orders (below Lisboa Central's free-delivery minimum → FIRINGI delivers) ──
async function smallOrder() {
  const api = await (await customer.request.get(`${BASE}/api/catalogue/offers?q=mozzarella`)).json();
  const offer = api.items.find((i) => i.vendor.name === "Lisboa Central" && i.packaging.unitsPerPack === 1);
  await go(customer, "/buy/orders/cart");
  const clear = customer.getByRole("button", { name: /Esvaziar carrinho|Clear cart/ });
  if (await clear.count()) { await clear.click(); await settle(customer); }
  await go(customer, `/buy/catalogue/offers/${offer.offerId}`);
  await customer.locator('main input[type="number"]').first().fill("5");
  await customer.getByRole("button", { name: /Adicionar ao carrinho|Add to cart/ }).click();
  await settle(customer);
  await go(customer, "/buy/orders/cart");
  await customer.getByRole("button", { name: /Fazer encomenda|Place order/ }).click();
  await customer.waitForURL("**placed=1", { timeout: 15000 });
  await settle(customer);
  const o = { id: customer.url().split("/").pop().split("?")[0], number: (await main(customer)).match(/FO-\d{4}-\d{6}/)[0] };
  await go(lx, `/vendor/orders/${o.id}`);
  await lx.getByRole("button", { name: /Confirmar encomenda|Confirm order/ }).click();
  await settle(lx);
  await lx.getByRole("button", { name: /Pronta para recolha|Ready for pickup/ }).click();
  await settle(lx);
  return o;
}
const o1 = await smallOrder();
const o2 = await smallOrder();
check("two small orders placed and ready", !!o1.number && !!o2.number, `${o1.number}, ${o2.number}`);

// ── 2. Ops plans one multi-stop route ──
await go(ops, "/admin/delivery/multi-stop");
const plan = ops.getByTestId("plan-route");
check("both orders wait for a route", (await plan.textContent()).includes(o1.number) && (await plan.textContent()).includes(o2.number));
await plan.getByRole("checkbox", { name: o1.number }).check();
await plan.getByRole("checkbox", { name: o2.number }).check();
const driverOpt = await plan.locator('select[name="driverId"] option', { hasText: DRIVER_NAME }).first().getAttribute("value");
await plan.locator('select[name="driverId"]').selectOption(driverOpt);
await plan.getByRole("button", { name: /^Create route/ }).click();
await settle(ops);
const created = await plan.getByRole("status").textContent();
check("route created", /Route RT-\d{4}-\d+ created/.test(created), created);
await shot(ops, "p12-01-plan");
await plan.getByRole("status").getByRole("link").click();
await settle(ops);
const stops = ops.getByTestId("route-stop");
check("route has 4 stops (2 pickups, 2 deliveries)", (await stops.count()) === 4);
check("pickups come first", /Pickup/.test(await stops.nth(0).textContent()) && /Delivery/.test(await stops.nth(3).textContent()));
check("every stop has an expected time", (await stops.allTextContents()).every((t) => /\d{2}:\d{2}/.test(t)));
const routeUrl = ops.url().replace(BASE, "");
const routeNumber = (await ops.locator("h1").textContent()).match(/RT-\d{4}-\d+/)[0];
await shot(ops, "p12-02-route");

// ── 3. Driver starts the route; the customer gets the window ──
const driver = await login("driver@firingi.test", { width: 390, height: 844 });
await go(driver, "/driver/deliveries/today");
const card = driver.locator('[data-testid="driver-route"]', { hasText: routeNumber });
check("driver sees the route", (await card.count()) === 1);
check("route card offers Google Maps", (await card.getByRole("link", { name: /Google Maps/ }).count()) === 1);
await shot(driver, "p12-03-driver-route");
await card.getByRole("button", { name: /^(Iniciar rota|Start route)$/ }).click();
await settle(driver);
check("route on the road", /Em curso|On the road/.test(await driver.locator('[data-testid="driver-route"]', { hasText: routeNumber }).textContent()));

await go(customer, `/buy/orders/${o1.id}`);
const eta = customer.getByTestId("eta-window");
check("customer sees the delivery window (Portuguese)", (await eta.count()) === 1 && /Entrega prevista: \d{2}:\d{2}–\d{2}:\d{2}/.test(await eta.textContent()), await eta.textContent().catch(() => ""));
await customer.getByTestId("bell").click();
await customer.waitForTimeout(400);
check("customer notified the order is on its way", (await customer.getByTestId("bell-panel").textContent()).includes(`A entrega ${o1.number} está a caminho hoje`));
await shot(customer, "p12-04-customer-eta");

// ── 4. Driver picks both up and delivers the first ──
for (const o of [o1, o2]) {
  await go(driver, "/driver/deliveries/today");
  await driver.locator('[data-testid="driver-delivery"]', { hasText: o.number }).getByRole("button", { name: /^Recolhida$|^Picked up$/ }).click();
  await settle(driver);
}
await go(driver, "/driver/deliveries/today");
check("pickups ticked on the route", (await driver.locator('[data-testid="driver-route"]', { hasText: routeNumber }).locator('[data-testid="driver-stop"].line-through').count()) === 2);
async function deliver(o) {
  await go(driver, "/driver/deliveries/today");
  await driver.locator('[data-testid="driver-delivery"]', { hasText: o.number }).getByRole("button", { name: /Iniciar entrega|Start delivery/ }).click();
  await settle(driver);
  await driver.locator('[data-testid="driver-delivery"]', { hasText: o.number }).getByRole("link", { name: /^Entregue$|^Delivered$/ }).click();
  await settle(driver);
  await driver.fill("#recipientName", "Ahmed (Kebab House)");
  await driver.locator('[data-testid="signature"]').first().scrollIntoViewIfNeeded(); // the pad can sit below the fold (e.g. temperatures above it)
  const box = await driver.locator('[data-testid="signature"]').boundingBox();
  await driver.mouse.move(box.x + 30, box.y + 100);
  await driver.mouse.down();
  for (let i = 0; i <= 20; i++) await driver.mouse.move(box.x + 30 + i * 14, box.y + 100 + Math.sin(i / 2) * 40);
  await driver.mouse.up();
  await driver.getByRole("button", { name: /Confirmar entrega|Confirm delivery/ }).click();
  await settle(driver);
}
await deliver(o1);

// ── 5. Back office: live board, ETA page ──
await go(ops, "/admin/dashboard/live-operations");
const liveRow = ops.getByTestId("live-routes").locator("tr", { hasText: routeNumber });
check("live board shows the route at 3/4", (await liveRow.count()) === 1 && (await liveRow.textContent()).includes("3/4"), await liveRow.textContent().catch(() => ""));
check("live board tiles", (await ops.getByTestId("live-kpis").textContent()).includes("On the road"));
await shot(ops, "p12-05-live");
await go(ops, "/admin/delivery/eta");
check("ETA page lists the remaining delivery", (await ops.getByTestId("eta-table").textContent()).includes(o2.number) && !(await ops.getByTestId("eta-table").textContent()).includes(o1.number));

// ── 6. Last delivery → route completed; reports ──
await deliver(o2);
await go(ops, routeUrl);
check("route completed", /Completed/.test(await ops.getByTestId("route-detail").textContent()));
await go(ops, "/admin/delivery/routes?tab=history");
check("route in history", (await ops.getByTestId("routes-table").textContent()).includes(routeNumber));
await go(ops, "/admin/delivery/performance");
check("delivery performance shows KPIs", /Delivered/.test(await ops.getByTestId("delivery-kpis").textContent()));
await shot(ops, "p12-06-performance");
await go(ops, "/admin/fleet/performance");
check("driver performance lists the driver", (await ops.getByTestId("driver-performance").textContent()).includes(DRIVER_NAME));
await go(sa, "/admin/fleet/earnings");
const earn = sa.getByTestId("driver-earnings").locator("tr", { hasText: DRIVER_NAME });
check("driver earnings computed", (await earn.count()) === 1 && /€/.test(await earn.textContent()));
await shot(sa, "p12-07-earnings");
await go(sa, "/admin/delivery/route-optimization");
check("optimisation settings shown", (await sa.getByTestId("routing-settings").count()) === 1);

// ── 7. Vendor's own routes page (Portuguese) ──
await go(lx, "/vendor/fleet/routes");
check("vendor routes page in Portuguese", (await main(lx)).includes("Planear uma rota") && (await main(lx)).includes("À espera de rota"));
await shot(lx, "p12-08-vendor-routes");

// restore
if (!multiBefore) {
  await go(sa, "/admin/settings/delivery");
  await sa.locator('input[name="firingiFleet"]').uncheck();
  await sa.getByRole("button", { name: "Save" }).first().click();
  await settle(sa);
}

check("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
