/**
 * Browser test of Phase 10 against a running server with the demo seed:
 *  1. Portugal switched to "customers order from FIRINGI": FIRINGI prices, no supplier choice,
 *     checkout picks Lisboa Central; it sees a Delivery Order from FIRINGI (its own prices) and
 *     declines → FIRINGI moves the order automatically.
 *  2. A small order goes to FIRINGI's in-house warehouse and shows up in the Control Tower's
 *     small-orders grouping.
 *  3. Back to "customers choose": the chosen wholesaler declines → the customer decides.
 *   node tests/e2e/firingi-ordering.mjs [baseUrl] [screenshotDir]
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
const settle = async (p) => { await p.waitForLoadState("networkidle"); await p.waitForTimeout(500); };
const go = async (p, url) => { await p.goto(`${BASE}${url}`); await settle(p); };
const errors = [];
async function login(email) {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 950 } })).newPage();
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
const customer = await login("owner@kebabhouse.test");
const lx = await login("owner@lisboacentral.test");
const inHouse = await login("armazem@firingi.test");
const cca = await login("owner@ccalmada.test");

/** Other suites leave orders holding stock: top up single mozzarella blocks first. */
async function topUpMozz(page) {
  await go(page, "/vendor/products/stock");
  for (const row of await page.locator("tbody tr", { hasText: "Mozzarella" }).all()) {
    const text = await row.textContent();
    if (/Caixa|Case/.test(text)) continue;
    const input = row.locator("input[type=number]").first();
    await input.fill("500");
    const save = row.getByRole("button");
    if (await save.count()) { await save.first().click(); await settle(page); } // no button = already 500
  }
}
for (const p of [lx, cca, inHouse]) await topUpMozz(p);

async function setPortugal(mode) {
  await go(sa, "/admin/allocation/distributor-vs-wholesaler");
  const sel = sa.locator("tr", { hasText: "Portugal" }).locator("select");
  if ((await sel.inputValue()) !== mode) {
    await sel.selectOption(mode);
    await settle(sa);
  }
  await go(sa, "/admin/allocation/distributor-vs-wholesaler");
  return (await sa.locator("tr", { hasText: "Portugal" }).locator("select").inputValue()) === mode;
}
async function setFloor(v) {
  await go(sa, "/admin/allocation/margin-rules");
  const before = await sa.inputValue('input[name="minMarginPercent"]');
  await sa.fill('input[name="minMarginPercent"]', String(v));
  const btn = sa.getByTestId("rules-form").getByRole("button", { name: "Save" });
  if (await btn.isEnabled()) { await btn.click(); await settle(sa); }
  return before;
}
async function clearCart() {
  await go(customer, "/buy/orders/cart");
  const clear = customer.getByRole("button", { name: /Esvaziar carrinho|Clear cart/ });
  if (await clear.count()) { await clear.click(); await settle(customer); }
}
async function addAndCheckout(offerId, qty) {
  await go(customer, `/buy/catalogue/offers/${offerId}`);
  await customer.locator('main input[type="number"]').first().fill(String(qty));
  await customer.getByRole("button", { name: /Adicionar ao carrinho|Add to cart/ }).click();
  await settle(customer);
  await go(customer, "/buy/orders/cart");
  const cartText = await main(customer);
  await customer.getByRole("button", { name: /Fazer encomenda|Place order/ }).click();
  await customer.waitForURL("**placed=1", { timeout: 20000 });
  await settle(customer);
  return { id: customer.url().split("/").pop().split("?")[0], number: (await main(customer)).match(/FO-\d{4}-\d{6}/)[0], cartText };
}
const floorBefore = await setFloor(-10); // C&C Almada / in-house are a little dearer for Kebab House

// ── 1. Order from FIRINGI ──
check("Portugal set to 'customers order from FIRINGI'", await setPortugal("FIRINGI"));
await go(customer, "/buy/catalogue/browse");
const shop = await main(customer);
check("shop explains FIRINGI ordering (Portuguese)", shop.includes("Encomenda à FIRINGI") && (await customer.getByTestId("firingi-products").count()) === 1);
check("no supplier list", !shop.includes("Fornecedores mais próximos") && !shop.includes("Lisboa Central"));
await shot(customer, "p10-01-shop-firingi");
const api = await (await customer.request.get(`${BASE}/api/catalogue/offers?q=mozzarella`)).json();
const mozz = api.items.find((i) => i.packaging.unitsPerPack === 1);
check("catalogue API shows one FIRINGI offer per pack", api.items.every((i) => i.vendor.name === "FIRINGI") && api.items.filter((i) => i.packaging.unitsPerPack === 1).length === 1);
await clearCart();
await go(customer, `/buy/catalogue/offers/${mozz.offerId}`);
check("product sold by FIRINGI", (await customer.getByTestId("sold-by-firingi").textContent()).includes("Vendido pela FIRINGI"));
const big = await addAndCheckout(mozz.offerId, 20);
check("cart says FIRINGI picks the wholesaler", big.cartText.includes("FIRINGI escolhe o grossista"));
check("order placed and sent to Lisboa Central (nearest, free delivery)", (await main(customer)).includes("Lisboa Central"));

await go(lx, `/vendor/orders/${big.id}`);
check("supplier sees 'Delivery Order from FIRINGI'", (await lx.getByTestId("routed-badge").textContent()).includes("Ordem de entrega da FIRINGI"));
await lx.getByTestId("delivery-order-link").click();
await settle(lx);
const doc = await lx.getByTestId("delivery-order").textContent();
check("Delivery Order: deliver to the customer, invoice FIRINGI at supplier prices", doc.includes("Entregar a") && doc.includes("Kebab House") && doc.includes("Faturar a") && /\d+,\d{2}\s€/.test(await lx.getByTestId("do-total").textContent()));
await shot(lx, "p10-02-delivery-order");
await go(lx, `/vendor/orders/${big.id}`);
await lx.fill("#reason", "Sem stock");
await lx.getByRole("button", { name: /Cancelar encomenda|Cancel order/ }).click();
await settle(lx);
await go(customer, `/buy/orders/${big.id}`);
check("declined FIRINGI order moved automatically (no question to the customer)", (await customer.getByTestId("moved-to").count()) === 1 && (await customer.getByTestId("decision-panel").count()) === 0);

// ── 2. Small order → in-house warehouse → small-orders grouping ──
await clearCart();
const small = await addAndCheckout(mozz.offerId, 5);
check("small order goes to FIRINGI's in-house warehouse", (await main(customer)).includes("FIRINGI Armazém"));
await go(inHouse, `/vendor/orders/${small.id}`);
await inHouse.getByRole("button", { name: /Confirmar encomenda|Confirm order/ }).first().click();
await settle(inHouse);
await go(sa, "/admin/allocation/control-tower");
const group = sa.getByTestId("pickup-group").filter({ hasText: "FIRINGI Armazém" });
check("control tower groups the small order for pickup", (await group.count()) === 1 && (await group.textContent()).includes(small.number));
await shot(sa, "p10-03-control-tower-small-orders");

// ── 3. Customer chose the wholesaler → the customer decides ──
check("Portugal back to 'customers choose'", await setPortugal("CHOOSE_SUPPLIER"));
await clearCart();
const lxApi = await (await customer.request.get(`${BASE}/api/catalogue/offers?q=mozzarella`)).json();
const lxMozz = lxApi.items.find((i) => i.vendor.name === "Lisboa Central" && i.packaging.unitsPerPack === 1);
const chosen = await addAndCheckout(lxMozz.offerId, 20);
await go(lx, `/vendor/orders/${chosen.id}`);
await lx.fill("#reason", "Sem stock");
await lx.getByRole("button", { name: /Cancelar encomenda|Cancel order/ }).click();
await settle(lx);
await go(customer, `/buy/orders/${chosen.id}`);
const panel = customer.getByTestId("decision-panel");
check("customer is asked: let FIRINGI find another, or cancel", (await panel.count()) === 1 && (await panel.textContent()).includes("Lisboa Central não pode entregar"));
await shot(customer, "p10-04-customer-decides");
await panel.getByRole("button", { name: "Deixar a FIRINGI encontrar outro grossista" }).click();
await settle(customer);
check("FIRINGI found another wholesaler", /Feito — a FIRINGI passou-a a outro grossista:\s*FO-\d{4}-\d{6}/.test(await customer.getByTestId("decision-done").textContent()));

// cleanup: floor back; the customer cancels the orders that are still open
await setFloor(floorBefore || "0");
for (const o of [big, small, chosen]) {
  await go(customer, `/buy/orders/${o.id}`);
  const hrefs = (await customer.getByTestId("moved-to").count()) ? await customer.getByTestId("moved-to").locator("a").evaluateAll((as) => as.map((a) => a.getAttribute("href"))) : [];
  for (const href of [`/buy/orders/${o.id}`, ...hrefs]) {
    await go(customer, href);
    const btn = customer.getByRole("button", { name: /Cancelar encomenda|Cancel order/ });
    if (await btn.count()) { await customer.fill("#reason", "e2e cleanup"); await btn.click(); await settle(customer); }
  }
}

check("no browser errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll FIRINGI ordering e2e checks passed");
process.exit(failures ? 1 : 0);
