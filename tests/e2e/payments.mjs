/**
 * Browser test of Phase 20 (customer payments) against a server started with PAYMENTS_SIMULATE=1
 * (simulated payment provider — no real money):
 * finance turns on card / MB WAY / Multibanco / direct debit → the customer pays an invoice by
 * card (hosted checkout, approve), another by MB WAY (approved on the phone), gets a Multibanco
 * reference that finance marks paid → sets up a SEPA direct debit → FIRINGI sends a payment link
 * that is paid without signing in → a pay-before-shipping order waits for payment, is paid and
 * reaches the supplier → pages fit a phone.
 *   PAYMENTS_SIMULATE=1 next start …  then  node tests/e2e/payments.mjs [baseUrl] [screenshotDir]
 */
import { createRequire } from "node:module";
const { chromium, devices } = createRequire(import.meta.url)("playwright");

const BASE = process.argv[2] ?? "http://localhost:3000";
const SHOTS = process.argv[3] ?? null;
const PASSWORD = process.env.SEED_PASSWORD ?? "Firingi!2026";
let failures = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "✔" : "✘"} ${name}${extra ? ` — ${extra}` : ""}`); if (!ok) failures++; };
const shot = async (page, name) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
const browser = await chromium.launch();
const settle = async (p) => { await p.waitForLoadState("networkidle"); await p.waitForTimeout(400); };
const go = async (p, url) => { await p.goto(`${BASE}${url}`); await settle(p); };
const errors = [];
async function login(email, opts = { viewport: { width: 1440, height: 950 } }) {
  const page = await (await browser.newContext({ ...opts, reducedMotion: "reduce" })).newPage();
  page.on("pageerror", (e) => errors.push(`${email} @ ${page.url().replace(BASE, "")}: ${e.message.slice(0, 120)}`));
  await go(page, "/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL((u) => u.pathname !== "/login", { timeout: 15000 }).catch(() => {});
  await settle(page);
  return page;
}
const state = (p) => p.getByTestId("pay-state").getAttribute("data-state");
async function waitState(p, want, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if ((await state(p).catch(() => null)) === want) return true; await p.waitForTimeout(800); }
  return false;
}
/** Invoices page → tick exactly one payable invoice (the n-th) → pay page. */
async function payOneInvoice(p, n) {
  await go(p, "/buy/finance/invoices");
  const boxes = p.getByTestId("pay-invoices").locator('input[type=checkbox]:not([disabled])');
  const count = await boxes.count();
  for (let i = 0; i < count; i++) if (await boxes.nth(i).isChecked()) await boxes.nth(i).uncheck();
  const number = await boxes.nth(n).getAttribute("data-invoice");
  await boxes.nth(n).check();
  await p.getByTestId("pay-selected").click();
  await p.waitForURL("**/buy/finance/pay/**", { timeout: 15000 });
  await settle(p);
  return number;
}

/** Make sure Kebab House has `n` open invoices: order → supplier confirms → FIRINGI delivers (→ invoiced). */
async function ensureOpenInvoices(buyer, ops, vendor, n) {
  await go(buyer, "/buy/finance/invoices");
  let have = await buyer.getByTestId("pay-invoices").locator("input[type=checkbox]:not([disabled])").count().catch(() => 0);
  const offers = await (await buyer.request.get(`${BASE}/api/catalogue/offers?q=mozzarella`)).json();
  const mozz = offers.items.find((i) => i.vendor.name === "Lisboa Central" && i.packaging.unitsPerPack === 1)?.offerId;
  while (have < n) {
    await go(buyer, "/buy/orders/cart");
    const clear = buyer.getByRole("button", { name: /Esvaziar carrinho|Clear cart/ });
    if (await clear.count()) { await clear.click(); await settle(buyer); }
    await go(buyer, `/buy/catalogue/offers/${mozz}`);
    await buyer.locator('input[type="number"]').first().fill("20");
    await buyer.getByRole("button", { name: /Adicionar ao carrinho|Add to cart/ }).click();
    await settle(buyer);
    await go(buyer, "/buy/orders/cart");
    await buyer.getByRole("button", { name: /Fazer encomenda|Place order/ }).click();
    await buyer.waitForURL("**/buy/orders/**", { timeout: 15000 }); await settle(buyer);
    const number = (await buyer.textContent("main")).match(/FO-\d{4}-\d{6}/)?.[0];
    await go(vendor, `/vendor/orders/incoming`);
    await vendor.getByRole("link", { name: number }).click(); await settle(vendor);
    await vendor.getByRole("button", { name: /Confirmar encomenda|Confirm order/ }).click(); await settle(vendor);
    await go(ops, `/admin/orders/all?q=${number}`);
    await ops.getByRole("link", { name: number }).first().click(); await settle(ops);
    for (const step of [/Pronta para recolha|Ready for pickup/, /Expedida|Dispatched/, /Em distribuição|Out for delivery/, /Entregue|Delivered/]) {
      const b = ops.getByRole("button", { name: step });
      if (await b.count()) { await b.first().click(); await settle(ops); }
    }
    have++;
  }
}

// ── 1. Finance turns the online methods on ──
const sa = await login("superadmin@firingi.test");
await go(sa, "/admin/settings/payment");
for (const m of ["CARD", "MB_WAY", "MULTIBANCO", "DIRECT_DEBIT"]) { const cb = sa.locator(`input[name="method-${m}"]`); if (!(await cb.isChecked())) await cb.check(); }
check("online payments settings shown", await sa.getByTestId("online-policy").isVisible());
await sa.getByRole("button", { name: "Save" }).click();
await sa.getByText("Saved").waitFor({ timeout: 10000 });
check("methods saved", true);
await go(sa, "/admin/finance/online-payments");
check("Online Payments shows the simulated provider", /Simulated provider/.test(await sa.getByTestId("provider-card").textContent()));
await sa.getByTestId("test-provider").click();
await sa.getByRole("status").first().waitFor({ timeout: 10000 });
check("provider connection test", /Connected/.test(await sa.getByTestId("provider-card").textContent()));

// ── 2. Card ──
const buyer = await login("owner@kebabhouse.test");
await ensureOpenInvoices(buyer, await login("ops@firingi.test"), await login("owner@lisboacentral.test"), 4);
await go(buyer, "/buy/finance/invoices");
check("invoices page offers to pay online", await buyer.getByTestId("buyer-pay-card").isVisible());
await shot(buyer, "p20-01-invoices-pay-online");
const inv1 = await payOneInvoice(buyer, 0);
check("pay page shows the invoice and the amount", (await buyer.getByTestId("pay-summary").textContent()).includes(inv1), inv1);
check("four methods offered", (await buyer.locator("[data-method]").count()) === 4);
await shot(buyer, "p20-02-choose-method");
await buyer.locator('[data-method="CARD"]').click();
await buyer.getByTestId("pay-button").click();
await buyer.waitForURL("**/pay/sim/**", { timeout: 15000 });
await settle(buyer);
await shot(buyer, "p20-03-sim-card-checkout");
await buyer.getByTestId("sim-approve").click();
await buyer.waitForURL("**/buy/finance/pay/**", { timeout: 15000 });
check("card payment confirmed", await waitState(buyer, "PAID"));
await shot(buyer, "p20-04-paid");

// ── 3. MB WAY ──
await payOneInvoice(buyer, 0);
await buyer.locator('[data-method="MB_WAY"]').click();
await buyer.getByTestId("mbway-phone").fill("12");
await buyer.getByTestId("pay-button").click();
check("bad MB WAY number refused", await buyer.getByTestId("pay-error").isVisible());
await buyer.getByTestId("mbway-phone").fill("912 345 678");
await buyer.getByTestId("pay-button").click();
await buyer.getByTestId("mbway-waiting").waitFor({ timeout: 15000 });
check("MB WAY: waiting for approval on the phone", /••• 678/.test(await buyer.getByTestId("mbway-waiting").textContent()));
await shot(buyer, "p20-05-mbway-waiting");
check("MB WAY approved → paid", await waitState(buyer, "PAID", 30000));

// ── 4. Multibanco ──
const inv3 = await payOneInvoice(buyer, 0);
await buyer.locator('[data-method="MULTIBANCO"]').click();
await buyer.getByTestId("pay-button").click();
await buyer.getByTestId("multibanco-ref").waitFor({ timeout: 15000 });
const entity = await buyer.getByTestId("mb-entity").textContent();
const ref = await buyer.getByTestId("mb-reference").textContent();
check("Multibanco entity + reference shown", entity === "11249" && /^\d{3} \d{3} \d{3}$/.test(ref), `${entity} ${ref}`);
await shot(buyer, "p20-06-multibanco-reference");
const payUrl = buyer.url();
await go(buyer, "/buy/finance/payments");
check("reference listed under payments in progress", (await buyer.getByTestId("payments-in-progress").textContent()).includes(ref));
await go(sa, "/admin/finance/online-payments?status=PROCESSING");
await sa.getByTestId("requests").locator("tr", { hasText: inv3 }).getByTestId("sim-mb-paid").click();
await sa.waitForTimeout(1500); // the paid request leaves this filtered list
await buyer.goto(payUrl); await settle(buyer);
check("Multibanco paid → confirmed", await waitState(buyer, "PAID"));

// ── 5. SEPA direct debit ──
await go(buyer, "/buy/finance/direct-debit");
await buyer.getByTestId("dd-setup").click();
await buyer.waitForURL("**/pay/sim/mandate/**", { timeout: 15000 });
await settle(buyer);
await buyer.getByTestId("sim-sign").click();
await buyer.waitForURL("**/buy/finance/direct-debit**", { timeout: 15000 });
await settle(buyer);
check("direct debit active, account ending 0154", /0154/.test(await buyer.getByTestId("dd-active").textContent().catch(() => "")));
await shot(buyer, "p20-07-direct-debit");
await go(sa, "/admin/finance/direct-debit");
check("mandate listed for FIRINGI finance", /Kebab/.test(await sa.getByTestId("mandates").textContent()));
// turn automatic collection off again so other tests don't see debits
await go(buyer, "/buy/finance/direct-debit");
buyer.once("dialog", (d) => d.accept());
await buyer.getByTestId("dd-revoke").click();
await settle(buyer);

// ── 6. Payment link (no sign-in) ──
await go(sa, "/admin/finance/online-payments");
const form = sa.getByTestId("payment-link-form").first();
const kebabOption = await form.locator("option", { hasText: /Kebab House/ }).first().getAttribute("value");
await form.locator("select").selectOption(kebabOption);
await form.getByTestId("create-link").click();
await form.getByTestId("link-url").waitFor({ timeout: 15000 });
const link = await form.getByTestId("link-url").inputValue();
check("payment link created", /\/pay\/[A-Za-z0-9_-]{20,}$/.test(link), link);
const anon = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
anon.on("pageerror", (e) => errors.push(`anon: ${e.message.slice(0, 120)}`));
await anon.goto(link.replace(/^https?:\/\/[^/]+/, BASE)); await settle(anon);
check("link page shows the customer and amount, no sign-in", /Kebab House/.test(await anon.getByTestId("pay-company").textContent()) && (await anon.getByTestId("pay-amount").count()) === 1);
check("direct debit not offered on a public link", (await anon.locator('[data-method="DIRECT_DEBIT"]').count()) === 0);
await shot(anon, "p20-08-payment-link");
await anon.locator('[data-method="CARD"]').click();
await anon.getByTestId("pay-button").click();
await anon.waitForURL("**/pay/sim/**", { timeout: 15000 }); await settle(anon);
await anon.getByTestId("sim-approve").click();
await anon.waitForURL((u) => /\/pay\/[A-Za-z0-9_-]{20,}/.test(u.pathname), { timeout: 15000 });
check("link paid by card", await waitState(anon, "PAID"));
await go(buyer, "/buy/finance/invoices");
check("all invoices paid → nothing left to pay", (await buyer.getByTestId("pay-invoices").count()) === 0);

// ── 7. Pay before shipping ──
await go(sa, "/admin/customers/credit");
const kebabRow = sa.locator("tr", { hasText: "Kebab House" }).first();
const toggle = kebabRow.locator('input[data-testid^="pay-first-"]');
if (!(await toggle.isChecked())) await toggle.check();
await settle(sa);
const offers = await (await buyer.request.get(`${BASE}/api/catalogue/offers?q=mozzarella`)).json();
const mozz = offers.items.find((i) => i.vendor.name === "Lisboa Central" && i.packaging.unitsPerPack === 1)?.offerId;
await go(buyer, "/buy/orders/cart");
const clear = buyer.getByRole("button", { name: /Esvaziar carrinho|Clear cart/ });
if (await clear.count()) { await clear.click(); await settle(buyer); }
await go(buyer, `/buy/catalogue/offers/${mozz}`);
await buyer.locator('input[type="number"]').first().fill("20");
await buyer.getByRole("button", { name: /Adicionar ao carrinho|Add to cart/ }).click();
await settle(buyer);
await go(buyer, "/buy/orders/cart");
await buyer.getByRole("button", { name: /Fazer encomenda|Place order/ }).click();
await buyer.waitForURL("**/buy/orders/**", { timeout: 15000 }); await settle(buyer);
check("order waits for payment", await buyer.getByTestId("awaiting-payment").isVisible());
await shot(buyer, "p20-09-order-awaiting-payment");
const orderUrl = buyer.url();
const orderNo = (await buyer.textContent("main")).match(/FO-\d{4}-\d{6}/)?.[0];
const vendor = await login("owner@lisboacentral.test");
await go(vendor, "/vendor/orders/incoming");
check("supplier doesn't see the unpaid order", !(await vendor.textContent("main")).includes(orderNo), orderNo);
await buyer.getByTestId("pay-order").click();
await buyer.waitForURL("**/buy/finance/pay/**", { timeout: 15000 }); await settle(buyer);
await buyer.locator('[data-method="CARD"]').click();
await buyer.getByTestId("pay-button").click();
await buyer.waitForURL("**/pay/sim/**", { timeout: 15000 }); await settle(buyer);
await buyer.getByTestId("sim-approve").click();
await buyer.waitForURL("**/buy/finance/pay/**", { timeout: 15000 });
check("order paid", await waitState(buyer, "PAID"));
await buyer.goto(orderUrl); await settle(buyer);
check("paid order no longer waits", (await buyer.getByTestId("awaiting-payment").count()) === 0);
await go(vendor, "/vendor/orders/incoming");
check("supplier now has the order", (await vendor.textContent("main")).includes(orderNo));
await go(sa, "/admin/customers/credit");
const t2 = sa.locator("tr", { hasText: "Kebab House" }).first().locator('input[data-testid^="pay-first-"]');
if (await t2.isChecked()) await t2.uncheck();
await settle(sa);

// ── 8. Phone ──
const phone = await login("owner@kebabhouse.test", { ...devices["iPhone 13"] });
for (const url of ["/buy/finance/invoices", "/buy/finance/direct-debit", "/buy/finance/payments"]) {
  await go(phone, url);
  const sw = await phone.evaluate(() => document.documentElement.scrollWidth);
  check(`phone: ${url} fits`, sw <= 391, String(sw));
}
await phone.goto(link.replace(/^https?:\/\/[^/]+/, BASE)); await settle(phone);
check("phone: pay link fits", (await phone.evaluate(() => document.documentElement.scrollWidth)) <= 391);
await shot(phone, "p20-10-phone-pay-link");

// restore: online methods off again (other suites expect bank transfer only)
await go(sa, "/admin/settings/payment");
for (const m of ["CARD", "MULTIBANCO", "DIRECT_DEBIT", "MB_WAY"]) { const cb = sa.locator(`input[name="method-${m}"]`); if (await cb.isChecked()) await cb.uncheck(); }
await sa.getByRole("button", { name: "Save" }).click();
await sa.getByText("Saved").waitFor({ timeout: 10000 }).catch(() => {});

check("no browser errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nAll Phase 20 checks passed");
process.exit(failures ? 1 : 0);
