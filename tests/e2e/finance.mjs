/**
 * Browser test of Phase 5 against a running server with the demo seed:
 * vendor promotion → order → delivery → FIRINGI invoice (PDF) + vendor statement (PDF)
 * → vendor uploads its invoice → finance approves and pays → customer payment → credit
 * note → admin 50/50 promotion accepted by the vendor.
 *   node tests/e2e/finance.mjs [baseUrl] [screenshotDir]
 */
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
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
async function login(email) {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 950 } })).newPage();
  await go(page, "/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await settle(page);
  return page;
}
const dir = mkdtempSync(path.join(tmpdir(), "firingi-fin-"));
const pdf = path.join(dir, "fatura.pdf");
writeFileSync(pdf, "%PDF-1.4\n% vendor invoice\n%%EOF");
const stamp = Date.now().toString().slice(-6);

// ── 1. Vendor promotion ──
const vendor = await login("owner@lisboacentral.test");
await go(vendor, "/vendor/products/promotions");
await vendor.getByRole("button", { name: /Nova promoção|New promotion/ }).click();
await vendor.fill('input[name="name"]', `Semana do queijo ${stamp}`);
await vendor.fill('input[name="value"]', "10");
await vendor.locator('select[name="offers"]').selectOption({ label: /Mozzarella bloco 2kg — Bloco 2kg/ }).catch(async () => {
  const opt = await vendor.locator('select[name="offers"] option', { hasText: "Mozzarella bloco 2kg — Bloco 2kg" }).getAttribute("value");
  await vendor.locator('select[name="offers"]').selectOption(opt);
});
await vendor.getByRole("button", { name: /^Guardar$|^Save$/ }).click();
await settle(vendor);
check("vendor promotion created", (await vendor.textContent("main")).includes(`Semana do queijo ${stamp}`));
await shot(vendor, "p5-01-vendor-promotions");

// ── 2. Customer sees it and orders ──
const customer = await login("owner@kebabhouse.test");
const api = await (await customer.request.get(`${BASE}/api/catalogue/offers?q=mozzarella`)).json();
const mozz = api.items.find((i) => i.vendor.name === "Lisboa Central" && i.packaging.unitsPerPack === 1);
check("customer sees the promotion price", mozz.price.promotions.some((p) => p.name.startsWith("Semana do queijo")) && Number(mozz.price.unitPriceNet) < Number(mozz.price.listUnitNet), `${mozz.price.listUnitNet} → ${mozz.price.unitPriceNet}`);
await go(customer, "/buy/orders/cart");
const clear = customer.getByRole("button", { name: /Esvaziar carrinho|Clear cart/ });
if (await clear.count()) { await clear.click(); await settle(customer); }
await go(customer, `/buy/catalogue/offers/${mozz.offerId}`);
await shot(customer, "p5-02-promotion-price", false);
await customer.locator('main input[type="number"]').first().fill("6");
await customer.getByRole("button", { name: /Adicionar ao carrinho|Add to cart/ }).click();
await settle(customer);
await go(customer, "/buy/orders/cart");
await customer.getByRole("button", { name: /Fazer encomenda|Place order/ }).click();
await customer.waitForURL("**placed=1", { timeout: 15000 });
await settle(customer);
const number = (await customer.textContent("main")).match(/FO-\d{4}-\d{6}/)[0];
check("order placed", !!number, number);

// ── 3. Vendor confirms, FIRINGI delivers → invoices issued ──
await go(vendor, "/vendor/orders/incoming");
await vendor.getByRole("link", { name: number }).click();
await settle(vendor);
await vendor.getByRole("button", { name: /Confirmar encomenda|Confirm order/ }).click();
await settle(vendor);
await vendor.getByRole("button", { name: /Pronta para recolha|Ready for pickup/ }).click();
await settle(vendor);
const ops = await login("superadmin@firingi.test");
await go(ops, "/admin/orders/ready-for-pickup");
await ops.getByRole("link", { name: number }).click();
await settle(ops);
for (const step of [/Expedida|Dispatched/, /Em distribuição|Out for delivery/, /Entregue|Delivered/]) { await ops.getByRole("button", { name: step }).click(); await settle(ops); }

// ── 4. Customer invoice + PDF ──
await go(customer, "/buy/finance/invoices");
const invRow = customer.locator("tr").filter({ hasText: number });
check("customer sees FIRINGI's invoice for the order", (await invRow.count()) === 1);
const invPdfHref = await invRow.locator('a[href$="/pdf"]').getAttribute("href");
const invPdf = await customer.request.get(`${BASE}${invPdfHref}`);
check("invoice PDF downloads", invPdf.status() === 200 && (await invPdf.body()).subarray(0, 5).toString() === "%PDF-");
await shot(customer, "p5-03-customer-invoices");
check("vendor cannot open FIRINGI's sales invoice", (await vendor.request.get(`${BASE}${invPdfHref}`)).status() === 404);

// ── 5. Vendor statement + upload ──
await go(vendor, "/vendor/finance/statements");
const stRow = vendor.locator("tbody tr").filter({ hasText: number });
check("vendor gets a billing statement for the order", (await stRow.count()) === 1);
const stPdf = await vendor.request.get(`${BASE}${await stRow.locator('a[href$="/pdf"]').getAttribute("href")}`);
check("statement PDF downloads", stPdf.status() === 200);
await vendor.locator("label").filter({ hasText: number }).locator('input[type="checkbox"]').check();
await vendor.fill('input[name="externalNumber"]', `FT LC/${stamp}`);
await vendor.setInputFiles('input[name="file"]', pdf);
await vendor.getByRole("button", { name: /^Carregar|^Upload/ }).click();
await settle(vendor);
await shot(vendor, "p5-04-vendor-statements");
await go(vendor, "/vendor/finance/invoices");
check("vendor invoice matched the statement", (await vendor.locator("tr").filter({ hasText: `FT LC/${stamp}` }).textContent()).match(/Confere|Matched/) !== null);

// ── 6. Finance approves + pays vendor; records customer payment ──
const fin = await login("finance@firingi.test");
await go(fin, "/admin/invoices/vendor");
await fin.locator("tr").filter({ hasText: `FT LC/${stamp}` }).getByRole("button", { name: "Approve" }).click();
await settle(fin);
await go(fin, "/admin/finance/vendor-payments");
await fin.locator("main select").first().selectOption({ label: "Grossista Lisboa Central, Lda" });
await fin.locator("div.flex.items-center.gap-2", { hasText: `FT LC/${stamp}` }).getByRole("button", { name: "full" }).click();
await fin.getByRole("button", { name: /Record payment/ }).click();
await settle(fin);
await go(fin, "/admin/invoices/vendor");
check("vendor invoice paid", /Pa(id|ga)/.test(await fin.locator("tr").filter({ hasText: `FT LC/${stamp}` }).textContent()));
await go(fin, "/admin/finance/customer-payments");
await fin.locator("main select").first().selectOption({ label: "Kebab House Lisboa, Lda" });
await fin.locator("div.flex.items-center.gap-2", { hasText: number }).getByRole("button", { name: "full" }).click();
await fin.getByRole("button", { name: /Record payment/ }).click();
await settle(fin);
await go(customer, "/buy/finance/invoices");
check("customer invoice shows as paid", /Pag[ao]|Paid/.test(await customer.locator("tr").filter({ hasText: number }).textContent()));

// ── 7. Credit note ──
await go(fin, "/admin/invoices/customer");
await fin.locator("tr").filter({ hasText: number }).locator("a").first().click();
await settle(fin);
await fin.locator('main input[type="number"]').first().fill("1");
await fin.fill('input[placeholder^="Reason"]', "1 block damaged");
await fin.getByRole("button", { name: "Credit selected quantities" }).click();
await settle(fin);
check("credit note issued", /partially credited/.test(await fin.textContent("main")));
await shot(fin, "p5-05-admin-invoice");

// ── 8. Admin promotion 50/50, vendor accepts ──
await go(ops, "/admin/pricing/promotions");
await ops.getByRole("button", { name: /Nova promoção|New promotion/ }).click();
await ops.fill('input[name="name"]', `FIRINGI split ${stamp}`);
await ops.fill('input[name="value"]', "5");
const vopt = await ops.locator('select[name="vendors"] option', { hasText: "Grossista Lisboa Central" }).getAttribute("value");
await ops.locator('select[name="vendors"]').selectOption(vopt);
await ops.locator('input[type="range"]').evaluate((el) => {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  set.call(el, "50"); el.dispatchEvent(new Event("input", { bubbles: true }));
});
await ops.getByRole("button", { name: /^Guardar$|^Save$/ }).click();
await settle(ops);
await go(vendor, "/vendor/products/promotions");
await vendor.locator("div.rounded-lg", { hasText: `FIRINGI split ${stamp}` }).getByRole("button", { name: /Aceitar|Accept/ }).click();
await settle(vendor);
await go(ops, "/admin/pricing/promotions");
check("vendor acceptance recorded", /accepted/.test(await ops.locator("tr").filter({ hasText: `FIRINGI split ${stamp}` }).textContent()));
check("discount funding report shows who paid", /Who paid the discounts/.test(await ops.textContent("main")));
await shot(ops, "p5-06-admin-promotions");

for (const name of [`Semana do queijo ${stamp}`]) {
  await go(vendor, "/vendor/products/promotions");
  await vendor.locator("tr").filter({ hasText: name }).getByRole("button", { name: /Terminar|End/ }).click();
  await settle(vendor);
}
await go(ops, "/admin/pricing/promotions");
await ops.locator("tr").filter({ hasText: `FIRINGI split ${stamp}` }).getByRole("button", { name: /Terminar|End/ }).click();
await settle(ops);
await go(fin, "/admin/finance/overview");
await shot(fin, "p5-07-finance-overview", false);
check("finance overview renders", /Commission earned/.test(await fin.textContent("main")));
await go(fin, "/admin/invoices/vat");
check("VAT report renders", /VAT payable/.test(await fin.textContent("main")));

await browser.close();
console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll finance e2e checks passed");
process.exit(failures ? 1 : 0);
