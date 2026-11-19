/**
 * Browser test of Phase 4 (orders) against a running server with the demo seed:
 * cart lock, minimums (admin + vendor), checkout, vendor confirmation, FIRINGI delivery,
 * history, and admin changing the FIRINGI minimum.
 *   node tests/e2e/orders.mjs [baseUrl] [screenshotDir]
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
const settle = async (p) => { await p.waitForLoadState("networkidle"); await p.waitForFunction(() => !document.querySelector("[aria-busy=true]"), null, { timeout: 15000 }).catch(() => {}); await p.waitForTimeout(500); };
async function login(email) {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 950 } })).newPage();
  await page.goto(`${BASE}/login`); await page.waitForLoadState("networkidle"); await page.waitForTimeout(400);
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await settle(page);
  return page;
}
const api = async (page, path) => (await page.request.get(`${BASE}${path}`)).json();
async function offerIdFor(page, q, vendorName, units) {
  const r = await api(page, `/api/catalogue/offers?q=${encodeURIComponent(q)}`);
  return r.items.find((i) => i.vendor.name === vendorName && (!units || i.packaging.unitsPerPack === units))?.offerId;
}

const customer = await login("owner@kebabhouse.test");
// Start from an empty cart.
await customer.goto(`${BASE}/buy/orders/cart`); await customer.waitForLoadState("networkidle"); await customer.waitForFunction(() => !document.querySelector("[aria-busy=true]"), null, { timeout: 15000 }).catch(() => {}); await customer.waitForTimeout(400);
await settle(customer);
const clear = customer.getByRole("button", { name: /Esvaziar carrinho|Clear cart/ });
if (await clear.count()) { await clear.click(); await settle(customer); }

// 1. Add mozzarella (contract price) from Lisboa Central
const mozz = await offerIdFor(customer, "mozzarella", "Lisboa Central", 1);
await customer.goto(`${BASE}/buy/catalogue/offers/${mozz}`); await customer.waitForLoadState("networkidle"); await customer.waitForFunction(() => !document.querySelector("[aria-busy=true]"), null, { timeout: 15000 }).catch(() => {}); await customer.waitForTimeout(400);
await settle(customer);
await customer.locator('input[type="number"]').first().fill("2");
await customer.getByRole("button", { name: /Adicionar ao carrinho|Add to cart/ }).click();
await settle(customer);
check("added to cart", /Adicionado|Added/.test(await customer.textContent("main")));
check("cart badge shows 1 item", (await customer.locator('header a[href="/buy/orders/cart"]').textContent()).includes("1"));

// 2. A product from another wholesaler joins the same cart (one order per supplier at checkout)
const almadaFlour = await offerIdFor(customer, "farinha", "C&C Almada");
await customer.goto(`${BASE}/buy/catalogue/offers/${almadaFlour}`); await customer.waitForLoadState("networkidle"); await customer.waitForFunction(() => !document.querySelector("[aria-busy=true]"), null, { timeout: 15000 }).catch(() => {}); await customer.waitForTimeout(400);
await settle(customer);
await customer.getByRole("button", { name: /Adicionar ao carrinho|Add to cart/ }).click();
await settle(customer);
check("second wholesaler's product added to the same cart", /Adicionado|Added/.test(await customer.textContent("main")));
await customer.goto(`${BASE}/buy/orders/cart`); await settle(customer);
check("cart groups products by supplier", (await customer.getByTestId("cart-group").count()) === 2 && /2 fornecedores|2 suppliers/.test(await customer.getByTestId("split-note").textContent()));
await shot(customer, "p4-01-two-suppliers", false);
await customer.getByTestId("cart-group").filter({ hasText: "C&C Almada" }).getByRole("button", { name: /Remover|Remove/ }).click();
await settle(customer);

// 3. Cart below FIRINGI minimum (2 × 12.20 = 24.40 € < 50 €)
await customer.goto(`${BASE}/buy/orders/cart`); await customer.waitForLoadState("networkidle"); await customer.waitForFunction(() => !document.querySelector("[aria-busy=true]"), null, { timeout: 15000 }).catch(() => {}); await customer.waitForTimeout(400);
await settle(customer);
const cartText = await customer.textContent("main");
check("cart shows FIRINGI minimum warning", /Encomenda mínima para entrega: 50,00|Minimum order for delivery is/.test(cartText));
check("place order disabled below minimum", await customer.getByRole("button", { name: /Fazer encomenda|Place order/ }).isDisabled());
await shot(customer, "p4-02-cart-below-minimum");

// 4. Raise quantity → FIRINGI delivers with fee
await customer.locator('td input[type="number"]').first().fill("5");
await customer.locator('td input[type="number"]').first().blur();
await settle(customer);
const cart2 = await customer.textContent("main");
check("between minimums → delivered by FIRINGI with fee", /Entregue pela FIRINGI|Delivered by FIRINGI/.test(cart2) && /9,90/.test(cart2));
await shot(customer, "p4-03-cart-firingi-delivery");
await customer.getByRole("button", { name: /Fazer encomenda|Place order/ }).click();
await customer.waitForURL("**/buy/orders/**placed=1", { timeout: 15000 }).catch(() => {});
await settle(customer);
const orderUrl = customer.url();
const orderText = await customer.textContent("main");
const number = orderText.match(/FO-\d{4}-\d{6}/)?.[0];
check("order placed, waiting for supplier", !!number && /A aguardar confirmação|Pending confirmation/.test(orderText), number);
check("cart is empty after ordering", !(await customer.locator('header a[href="/buy/orders/cart"] span').count()));
await shot(customer, "p4-04-order-placed");

// 5. Vendor confirms with fewer units, prepares
const vendor = await login("owner@lisboacentral.test");
await vendor.goto(`${BASE}/vendor/orders/incoming`); await vendor.waitForLoadState("networkidle"); await vendor.waitForTimeout(400);
await settle(vendor);
check("vendor sees the order in Incoming orders", (await vendor.textContent("main")).includes(number));
await vendor.getByRole("link", { name: number }).click();
await settle(vendor);
await vendor.locator('[aria-label*="Mozzarella"]').fill("4");
await vendor.getByRole("button", { name: /Confirmar encomenda|Confirm order/ }).click();
await settle(vendor);
const vText = await vendor.textContent("main");
check("vendor confirmed 4 of 5; payout shown", /Em preparação|Supplier processing/.test(vText) && /O seu valor a receber|Your payout/.test(vText));
await vendor.getByRole("button", { name: /Pronta para recolha|Ready for pickup/ }).click();
await settle(vendor);
check("vendor can't dispatch a FIRINGI-delivered order", !(await vendor.getByRole("button", { name: /Expedida|Dispatched/ }).count()));
await shot(vendor, "p4-05-vendor-order");

// 6. FIRINGI dispatches and delivers
const ops = await login("ops@firingi.test");
await ops.goto(`${BASE}/admin/orders/ready-for-pickup`); await ops.waitForLoadState("networkidle"); await ops.waitForTimeout(400);
await settle(ops);
await ops.getByRole("link", { name: number }).click();
await settle(ops);
for (const step of [/Expedida|Dispatched/, /Em distribuição|Out for delivery/, /Entregue|Delivered/]) {
  await ops.getByRole("button", { name: step }).click();
  await settle(ops);
}
check("FIRINGI delivered the order", /Entregue|Delivered/.test(await ops.locator("h1 + p, main").first().textContent()));
await shot(ops, "p4-06-admin-order");

// 7. Customer sees full history
await customer.goto(orderUrl.replace("?placed=1", "")); await customer.waitForLoadState("networkidle"); await customer.waitForFunction(() => !document.querySelector("[aria-busy=true]"), null, { timeout: 15000 }).catch(() => {}); await customer.waitForTimeout(400);
await settle(customer);
const hist = await customer.textContent("main");
check("customer sees the full status history", ["Nova|New", "Em preparação|Supplier processing", "Expedida|Dispatched", "Entregue|Delivered"].every((s) => new RegExp(s).test(hist)));

// 8. Admin changes FIRINGI minimum → customer cart reflects it
await ops.goto(`${BASE}/admin/delivery/minimum-order`); await ops.waitForLoadState("networkidle"); await ops.waitForTimeout(400);
await settle(ops);
await shot(ops, "p4-07-admin-minimums");
const ptRule = ops.getByTestId("country-rule-PT"); // one card per country (PT, PL …)
await ptRule.locator('input[type="number"]').first().fill("60");
await ptRule.getByRole("button", { name: "Save" }).click();
await settle(ops);
await customer.goto(`${BASE}/buy/catalogue/offers/${mozz}`); await customer.waitForLoadState("networkidle"); await customer.waitForFunction(() => !document.querySelector("[aria-busy=true]"), null, { timeout: 15000 }).catch(() => {}); await customer.waitForTimeout(400);
await settle(customer);
await customer.getByRole("button", { name: /Adicionar ao carrinho|Add to cart/ }).click();
await settle(customer);
await customer.goto(`${BASE}/buy/orders/cart`); await customer.waitForLoadState("networkidle"); await customer.waitForFunction(() => !document.querySelector("[aria-busy=true]"), null, { timeout: 15000 }).catch(() => {}); await customer.waitForTimeout(400);
await settle(customer);
check("customer cart uses the new FIRINGI minimum (60 €)", /60,00/.test(await customer.textContent("main")));
await ops.goto(`${BASE}/admin/delivery/minimum-order`); await ops.waitForLoadState("networkidle"); await ops.waitForTimeout(400);
await settle(ops);
await ops.getByTestId("country-rule-PT").locator('input[type="number"]').first().fill("50");
await ops.getByTestId("country-rule-PT").getByRole("button", { name: "Save" }).click();
await settle(ops);
await customer.getByRole("button", { name: /Esvaziar carrinho|Clear cart/ }).click();

// 9. Vendor sets its own delivery minimum
await vendor.goto(`${BASE}/vendor/fleet/delivery-rules`); await vendor.waitForLoadState("networkidle"); await vendor.waitForTimeout(400);
await settle(vendor);
await vendor.fill("#min", "140");
await vendor.getByRole("button", { name: /Guardar|Save/ }).click();
await settle(vendor);
check("vendor delivery minimum saved", /140,00/.test(await vendor.textContent("main")));
await vendor.fill("#min", "150");
await vendor.getByRole("button", { name: /Guardar|Save/ }).click();
await settle(vendor);

await browser.close();
console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll order e2e checks passed");
process.exit(failures ? 1 : 0);
