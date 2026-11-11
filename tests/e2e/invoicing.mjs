/**
 * Browser test of Phase 18 against a server started with MOLONI_SIMULATE=1 (simulated Moloni —
 * no network, documents marked as simulated):
 * superadmin connects Moloni on Certified Invoicing (company, series, defaults, VAT mapping) →
 * Kebab House orders, the supplier prepares it, FIRINGI delivers → the invoice is booked and
 * issued at Moloni (Moloni number on the invoice, PDF opens, customer sees the Moloni number) →
 * Supplier Payouts Due page + CSV → provider switched back to internal.
 *   MOLONI_SIMULATE=1 next start …  then  node tests/e2e/invoicing.mjs [baseUrl] [screenshotDir]
 */
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");

const BASE = process.argv[2] ?? "http://localhost:3000";
const SHOTS = process.argv[3] ?? null;
const PASSWORD = process.env.SEED_PASSWORD ?? "Firingi!2026";
let failures = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "✔" : "✘"} ${name}${extra ? ` — ${extra}` : ""}`); if (!ok) failures++; };
const shot = async (page, name) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
const browser = await chromium.launch();
const settle = async (p) => { await p.waitForLoadState("networkidle"); await p.waitForTimeout(500); };
const go = async (p, url) => { await p.goto(`${BASE}${url}`); await settle(p); };
const errors = [];
async function login(email) {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 950 }, reducedMotion: "reduce" })).newPage();
  page.on("pageerror", (e) => errors.push(`${email}: ${e.message}`));
  await go(page, "/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL((u) => u.pathname !== "/login", { timeout: 15000 }).catch(() => {});
  await settle(page);
  return page;
}
const main = (p) => p.textContent("main");

// ── 1. Connect Moloni (simulated) ──
const sa = await login("superadmin@firingi.test");
await go(sa, "/admin/finance/invoicing");
check("certified invoicing page: simulated Moloni connected", /Simulated Moloni/.test(await sa.getByTestId("moloni-mode").textContent()));
const form = sa.getByTestId("fiscal-settings");
for (const [id, label] of [["companyId", /FIRINGI/], ["invoiceSetId", /SIM/], ["creditNoteSetId", /SIM/], ["maturityDateId", /Pronto/], ["paymentMethodId", /Transfer/], ["categoryId", /Mercadorias/], ["unitId", /Unidade/]]) {
  const sel = sa.locator(`#m-${id}`);
  const value = await sel.locator("option").filter({ hasText: label }).first().getAttribute("value");
  await sel.selectOption(value);
}
check("VAT rates mapped to Moloni taxes (suggested)", (await form.getByTestId("tax-map").locator("select").first().inputValue()) !== "");
await form.locator('input[name="provider"]').nth(1).check();
await form.getByRole("button", { name: "Save invoicing settings" }).click();
await settle(sa);
check("Moloni switched on", /Saved/.test(await form.textContent()) && /Provider in use: Moloni/.test(await main(sa)));
await shot(sa, "p18-01-certified-invoicing");

// ── 2. An order is delivered → invoiced → issued at Moloni ──
const customer = await login("owner@kebabhouse.test");
const api = await (await customer.request.get(`${BASE}/api/catalogue/offers?q=mozzarella`)).json();
const offer = api.items.find((i) => i.vendor.name === "Lisboa Central" && i.packaging.unitsPerPack === 1);
await go(customer, "/buy/orders/cart");
const clear = customer.getByRole("button", { name: /Esvaziar carrinho|Clear cart/ });
if (await clear.count()) { await clear.click(); await settle(customer); }
await go(customer, `/buy/catalogue/offers/${offer.offerId}`);
await customer.locator('main input[type="number"]').first().fill("10");
await customer.getByRole("button", { name: /Adicionar ao carrinho|Add to cart/ }).click();
await settle(customer);
await go(customer, "/buy/orders/cart");
await customer.getByRole("button", { name: /Fazer encomenda|Place order/ }).click();
await customer.waitForURL("**placed=1", { timeout: 15000 });
await settle(customer);
const orderId = customer.url().split("?")[0].split("/").pop();
const number = (await main(customer)).match(/FO-\d{4}-\d{6}/)[0];

const vendor = await login("owner@lisboacentral.test");
await go(vendor, `/vendor/orders/${orderId}`);
await vendor.getByRole("button", { name: /Confirmar encomenda|Confirm order/ }).click();
await settle(vendor);
await vendor.getByRole("button", { name: /Pronta para recolha|Ready for pickup/ }).click();
await settle(vendor);
const ops = await login("ops@firingi.test");
await go(ops, `/admin/orders/${orderId}`);
for (const step of [/Expedida|Dispatched/, /Em distribuição|Out for delivery/, /Entregue|Delivered/]) {
  await ops.getByRole("button", { name: step }).click();
  await settle(ops);
}
check("order delivered", /Entregue|Delivered/.test(await ops.locator("main").textContent()), number);

await go(sa, "/admin/finance/invoicing");
await sa.getByTestId("run-queue").click(); // usually already issued by the after-delivery kick
await settle(sa);
await go(sa, "/admin/invoices/customer");
const row = sa.locator("tr", { hasText: number }).first();
const molNumber = (await row.locator("td").first().locator("a").textContent())?.trim().match(/^SIM FT SIM\/\d+$/)?.[0];
check("invoice issued at Moloni: Moloni number in the list", !!molNumber, molNumber ?? (await row.textContent()));
await row.getByRole("link").first().click();
await settle(sa);
check("invoice page: issued at Moloni, FIRINGI reference kept", /issued at Moloni/.test(await sa.getByTestId("fiscal-state").textContent()) && /FT-REF FIR\d{4}\/\d+/.test(await sa.getByTestId("fiscal-state").textContent()));
await shot(sa, "p18-02-invoice-at-moloni");
const invoiceId = sa.url().split("/").pop();
const pdf = await sa.request.get(`${BASE}/api/invoices/${invoiceId}/pdf`);
check("PDF opens", pdf.status() === 200 && (pdf.headers()["content-type"] ?? "").includes("pdf"));
await go(customer, "/buy/finance/invoices");
check("customer sees the Moloni number", (await main(customer)).includes(molNumber ?? "—"));
await go(sa, "/admin/finance/invoicing");
check("last issued at Moloni lists it", (await sa.getByTestId("fiscal-recent").textContent()).includes(molNumber ?? "—"));

// ── 3. Supplier payouts due ──
const fin = await login("finance@firingi.test");
await go(fin, "/admin/finance/payouts-due");
check("payouts due page", (await fin.getByTestId("payout-kpis").count()) === 1 && (await fin.getByTestId("payouts-due").count()) === 1);
const csv = await fin.request.get(`${BASE}/api/admin/payouts-due?within=30`);
check("payouts CSV", csv.status() === 200 && (await csv.text()).includes("Supplier;NIF / VAT;Invoice"));
await shot(fin, "p18-03-payouts-due");

// ── 4. Back to the internal provider (demo database) ──
await go(sa, "/admin/finance/invoicing");
await sa.getByTestId("fiscal-settings").locator('input[name="provider"]').first().check();
await sa.getByTestId("fiscal-settings").getByRole("button", { name: "Save invoicing settings" }).click();
await settle(sa);
check("switched back to internal", /FIRINGI internal/.test(await main(sa)));

check("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nAll invoicing e2e checks passed");
process.exit(failures ? 1 : 0);
