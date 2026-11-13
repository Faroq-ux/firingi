/**
 * Browser test of Phase 31 (quality claims & credits), customer + supplier in Portuguese, FIRINGI in English:
 *  the customer orders, the supplier delivers with its own fleet → the customer reports damaged goods with a
 *  photo from the order page → the supplier disputes with its side → FIRINGI sees the delivery facts (supplier's
 *  own fleet: no driver charge-back), approves part of it as the supplier's fault → credit note to the customer,
 *  charge-back on the supplier's statement → the customer sees the credit (not the supplier's cost), the supplier
 *  sees the charge-back (not the sale price) and disputes it → FIRINGI upholds it → quality & alerts, settings,
 *  payouts net-off, driver earnings (fee-paid deliveries only) → phone width → no page errors.
 *   node tests/e2e/claims.mjs [baseUrl] [screenshotDir]
 */
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");

const BASE = process.argv[2] ?? "http://localhost:3000";
const SHOTS = process.argv[3] ?? null;
const PASSWORD = process.env.SEED_PASSWORD ?? "Firingi!2026";
let failures = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "✔" : "✘"} ${name}${extra ? ` — ${extra}` : ""}`); if (!ok) failures++; };
const shot = async (page, name) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
const browser = await chromium.launch();
const settle = async (p) => { await p.waitForLoadState("networkidle").catch(() => {}); await p.waitForFunction(() => !document.querySelector("[aria-busy=true]"), null, { timeout: 15000 }).catch(() => {}); await p.waitForTimeout(400); };
const go = async (p, url) => { await p.goto(`${BASE}${url}`); await settle(p); };
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn().catch(() => false)) return true; await new Promise((r) => setTimeout(r, 400)); } return false; };
const errors = [];
async function login(email, opts = { viewport: { width: 1440, height: 950 } }) {
  const page = await (await browser.newContext({ ...opts, reducedMotion: "reduce", deviceScaleFactor: SHOTS ? 2 : 1 })).newPage();
  page.on("pageerror", (e) => errors.push(`${email} @ ${page.url().replace(BASE, "")}: ${e.message.slice(0, 140)}`));
  page.on("dialog", (d) => d.accept());
  await go(page, "/login");
  await page.fill("#email", email); await page.fill("#password", PASSWORD); await page.click("button[type=submit]");
  await page.waitForURL((u) => u.pathname !== "/login", { timeout: 15000 }).catch(() => {});
  await settle(page);
  return page;
}
const main = (p) => p.textContent("main");
// a real 1×1 PNG
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

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

const customer = await login("owner@kebabhouse.test");
const vendor = await login("owner@lisboacentral.test");
const sa = await login("superadmin@firingi.test");

// ── 1. Order, delivered by the supplier's own fleet ──
const o = await orderVia(customer, "pizza", (i) => i.vendor.name === "Lisboa Central", 8);
check("customer placed an order", !!o.number, o.number);
await go(vendor, `/vendor/orders/${o.id}`);
await vendor.getByRole("button", { name: /Confirmar encomenda|Confirm order/ }).click();
await settle(vendor);
for (const s of [/Pronta para recolha|Ready for pickup/, /Expedida|Dispatched/, /Em distribuição|Out for delivery/, /Entregue|Delivered/]) {
  await vendor.getByRole("button", { name: s }).first().click();
  await settle(vendor);
}
check("supplier delivered the order", await until(async () => /Entregue|Delivered/.test(await vendor.locator("main").textContent())));

// ── 2. Customer reports a problem from the order page ──
await go(customer, `/buy/orders/${o.id}`);
check("order page offers to report a problem", (await customer.getByTestId("report-problem").count()) === 1);
await customer.getByTestId("report-problem").click();
await customer.waitForURL("**/claim");
await settle(customer);
const form = customer.getByTestId("claim-form");
check("claim form lists the delivered products", (await form.locator('[data-testid^="claim-qty-"]').count()) >= 1);
check("damage needs a photo (send disabled)", await customer.getByTestId("claim-submit").isDisabled());
await form.locator('[data-testid^="claim-qty-"]').first().fill("3");
await customer.getByTestId("claim-description").fill("3 caixas esmagadas na entrega, cantos partidos.");
await customer.getByTestId("claim-photos").setInputFiles({ name: "caixas.png", mimeType: "image/png", buffer: PNG });
await shot(customer, "p31-01-customer-new-claim");
await customer.getByTestId("claim-submit").click();
await customer.waitForURL(/\/buy\/orders\/claims\/[a-z0-9]+$/, { timeout: 20000 });
await settle(customer);
const claimUrl = customer.url().replace(BASE, "");
const claimId = claimUrl.split("/").pop();
const number = (await main(customer)).match(/CL-\d{4}-\d{6}/)?.[0];
check("claim created and opened", !!number && /Aberta|Open/.test(await customer.getByTestId("claim-status").textContent()), number);
check("customer sees its photo", (await customer.locator('[data-testid="photos-c"] img').count()) === 1);
const photo = await customer.request.get(`${BASE}/api/claims/${claimId}/photos/c/0`);
check("photo served to the customer", photo.status() === 200 && (photo.headers()["content-type"] ?? "").startsWith("image/"));
check("strangers can't open the photo", (await (await login("owner@ibericas.test")).request.get(`${BASE}/api/claims/${claimId}/photos/c/0`)).status() === 404);
check("customer sees what it paid, never the supplier's price", /pago/.test(await customer.getByTestId("claim-lines").textContent()) && !/o seu preço/.test(await main(customer)));
await shot(customer, "p31-02-customer-claim");

// ── 3. Supplier gives its side ──
await go(vendor, "/vendor/orders/claims");
check("supplier sees the claim waiting for its answer", (await vendor.getByTestId("claims-table").textContent()).includes(number));
await shot(vendor, "p31-03-vendor-claims");
await go(vendor, `/vendor/orders/claims/${claimId}`);
check("supplier sees its own price, not the sale price", /o seu preço/.test(await vendor.getByTestId("claim-lines").textContent()) && !/pago/.test(await vendor.getByTestId("claim-lines").textContent()));
await vendor.getByText(/Contestamos|We dispute/).click();
check("disputing needs a reason", await vendor.getByTestId("supplier-respond").isDisabled());
await vendor.getByTestId("supplier-comment").fill("As caixas saíram intactas — ver foto da paletização.");
await vendor.getByTestId("supplier-respond").click();
await settle(vendor);
check("supplier's side recorded", await until(async () => (await vendor.getByTestId("supplier-side").count()) === 1));
await vendor.getByTestId("claim-message").fill("Podemos enviar caixas novas amanhã.");
await vendor.getByTestId("claim-message-send").click();
await settle(vendor);
check("message posted", await until(async () => /caixas novas amanhã/.test(await vendor.getByTestId("claim-messages").textContent())));
await shot(vendor, "p31-04-vendor-claim");

// ── 4. FIRINGI decides ──
await go(sa, "/admin/orders/claims");
check("FIRINGI queue lists the claim with its SLA", (await sa.getByTestId("admin-claims").textContent()).includes(number));
await shot(sa, "p31-05-admin-queue");
await go(sa, `/admin/orders/claims/${claimId}`);
check("delivery facts: supplier's own fleet, no driver charge-back", /Supplier's own fleet/.test(await sa.getByTestId("delivery-facts").textContent()) && /supplier's staff/.test(await sa.getByTestId("delivery-facts").textContent()));
check("driver fault not offered for the supplier's own fleet", await sa.locator('[data-testid="decide-fault"] option[value="DRIVER"]').isDisabled());
await sa.getByTestId("claim-message").fill("Checking the loading photo.");
await sa.getByTestId("claim-internal").check();
await sa.getByTestId("claim-message-send").click();
await settle(sa);
await sa.getByTestId("decide-qty").first().fill("2");
check("credit preview shown", await until(async () => /Credit note to the customer/.test(await sa.getByTestId("decide-preview").textContent())));
await sa.getByTestId("decide-note").fill("Two boxes crushed in the photos — supplier packing.");
await shot(sa, "p31-06-admin-decide");
await sa.getByTestId("decide-submit").click();
await settle(sa);
check("claim approved with a credit note", await until(async () => /credit note issued/i.test(await sa.getByTestId("decision-card").textContent())));
check("charge-back on the supplier", await until(async () => (await sa.getByTestId("admin-claim-chargebacks").count()) === 1));
await shot(sa, "p31-07-admin-decided");

// ── 5. Customer & supplier see the outcome ──
await go(customer, claimUrl);
check("customer sees the credit", /Nota de crédito:/.test(await customer.getByTestId("credit-amount").textContent()));
check("customer doesn't see FIRINGI's internal note", !/Checking the loading photo/.test(await main(customer)));
check("customer sees the supplier's message", /caixas novas amanhã/.test(await main(customer)));
await shot(customer, "p31-08-customer-credited");
await go(vendor, `/vendor/orders/claims/${claimId}`);
check("supplier sees its charge-back", (await vendor.getByTestId("vendor-chargebacks").count()) === 1);
check("supplier doesn't see the customer's credit amount", (await vendor.getByTestId("credit-amount").count()) === 0);
await vendor.locator('[data-testid^="dispute-"]').first().click();
await vendor.getByTestId("dispute-note").fill("O motorista da FIRINGI não esteve envolvido — mas a palete saiu intacta.");
await vendor.getByTestId("dispute-send").click();
await settle(vendor);
check("supplier disputed the charge-back", await until(async () => /Contestado|Disputed/.test(await vendor.getByTestId("vendor-chargebacks").textContent())));
await go(vendor, "/vendor/orders/claims/quality");
check("supplier quality score page", (await vendor.getByTestId("quality-rate").count()) === 1 && (await vendor.getByTestId("vendor-chargeback-list").textContent()).includes(number));
await shot(vendor, "p31-09-vendor-quality");

// ── 6. FIRINGI: charge-backs, quality, settings, payouts, driver earnings ──
await go(sa, "/admin/orders/claims/chargebacks?status=DISPUTED");
const row = sa.getByTestId("admin-chargebacks").locator("tr", { hasText: number });
check("disputed charge-back listed", (await row.count()) === 1);
await row.locator('[data-testid^="uphold-"]').click();
await settle(sa);
check("FIRINGI upheld the charge-back", await until(async () => { await go(sa, "/admin/orders/claims/chargebacks?status=OPEN"); return (await sa.getByTestId("admin-chargebacks").textContent()).includes(number); }));
await shot(sa, "p31-10-admin-chargebacks");
await go(sa, "/admin/orders/claims/quality");
check("quality page: suppliers and reasons", (await sa.getByTestId("quality-suppliers").textContent()).includes("Lisboa Central") && /Damaged/.test(await sa.getByTestId("claims-by-reason").textContent()));
await shot(sa, "p31-11-admin-quality");
await go(sa, "/admin/orders/claims/settings");
await sa.getByTestId("cs-windowHours").fill("72");
await sa.getByTestId("cs-save").click();
check("claim settings saved", await until(async () => /Saved/.test(await sa.getByTestId("claim-settings").textContent())));
await sa.getByTestId("cs-windowHours").fill("48");
await sa.getByTestId("cs-save").click();
await settle(sa);
await go(sa, "/admin/finance/payouts-due");
check("payouts show claim charge-backs to net off", /Claim charge-backs to net off/.test(await sa.getByTestId("payout-kpis").textContent()));
await go(sa, "/admin/fleet/earnings");
check("driver earnings: per-delivery pay only on fee-paid deliveries", /Fee-paid/.test(await sa.getByTestId("driver-earnings").textContent()) && /free deliveries earn no per-delivery pay/.test(await main(sa)));
await go(customer, "/buy/orders/claims");
check("customer claims list", (await customer.getByTestId("claims-table").textContent()).includes(number));

// ── 7. Phone width ──
const phone = await login("owner@kebabhouse.test", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const vphone = await login("owner@lisboacentral.test", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
for (const [p, url, name] of [[phone, claimUrl, "p31-12-phone-claim"], [phone, "/buy/orders/claims", null], [vphone, `/vendor/orders/claims/${claimId}`, "p31-13-phone-vendor"], [vphone, "/vendor/orders/claims/quality", null]]) {
  await go(p, url);
  const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(`phone: ${url} fits the screen`, over <= 1, `overflow ${over}px`);
  if (name) { await p.waitForTimeout(1200); await shot(p, name); }
}

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nall claims checks passed");
process.exit(failures ? 1 : 0);
