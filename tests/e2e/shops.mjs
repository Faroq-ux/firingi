/**
 * Browser test of Phase 27 (shops, budgets, shop reports, optional accounting), as the customer Kebab
 * House (owner = head office, Bruno = purchaser; Portuguese UI), its supplier Lisboa Central and FIRINGI
 * staff (English):
 *  two shops with their own address and category → Bruno assigned to one shop only orders to it; the
 *  shop and PO reference go on the order → a "block" budget refuses Bruno's next order, the cart shows
 *  it → shop reports + invoices CSV → accounting is off until FIRINGI switches it on → daily close,
 *  an expense with a receipt photo, a fixed monthly rent → profit & loss and dashboard → a supplier's
 *  accounting → FIRINGI's customer shops → phone width → no page errors.
 *   node tests/e2e/shops.mjs [baseUrl] [screenshotDir]
 */
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
const { chromium, devices } = createRequire(import.meta.url)("playwright");
// this test is about shops, not FIRINGI's address approval (tests/e2e/registration.mjs covers that): approval off meanwhile
const DB = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/firingi";
const sql = (q) => execFileSync("psql", ["-At", DB, "-c", q], { encoding: "utf8" }).trim();
const savedApproval = sql(`select value::text from "Setting" where key='address.approval'`);
sql(`insert into "Setting" (id, scope, "scopeId", key, value, "updatedAt") values ('e2e-shops-addr', 'GLOBAL', '', 'address.approval', '{"enabled": false}'::jsonb, now()) on conflict (scope, "scopeId", key) do update set value='{"enabled": false}'::jsonb`);
const restoreApproval = () => { sql(`delete from "Setting" where key='address.approval'`); if (savedApproval) sql(`insert into "Setting" (id, scope, "scopeId", key, value, "updatedAt") values ('e2e-shops-addr', 'GLOBAL', '', 'address.approval', '${savedApproval.replace(/'/g, "''")}'::jsonb, now())`); };
process.on("exit", restoreApproval);

const BASE = process.argv[2] ?? "http://localhost:3000";
const SHOTS = process.argv[3] ?? null;
const PASSWORD = process.env.SEED_PASSWORD ?? "Firingi!2026";
let failures = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "✔" : "✘"} ${name}${extra ? ` — ${extra}` : ""}`); if (!ok) failures++; };
const shot = async (page, name) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png` });
const browser = await chromium.launch();
const settle = async (p) => { await p.waitForLoadState("networkidle").catch(() => {}); await p.waitForFunction(() => !document.querySelector("[aria-busy=true]"), null, { timeout: 15000 }).catch(() => {}); await p.waitForTimeout(400); };
const go = async (p, url) => { await p.goto(`${BASE}${url}`); await settle(p); };
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn().catch(() => false)) return true; await new Promise((r) => setTimeout(r, 400)); } return false; };
const errors = [];
async function login(email, opts = { viewport: { width: 1440, height: 950 } }) {
  const page = await (await browser.newContext({ ...opts, reducedMotion: "reduce" })).newPage();
  page.on("pageerror", (e) => errors.push(`${email} @ ${page.url().replace(BASE, "")}: ${e.message.slice(0, 140)}`));
  page.on("dialog", (d) => d.accept());
  await go(page, "/login");
  await page.fill("#email", email); await page.fill("#password", PASSWORD); await page.click("button[type=submit]");
  await page.waitForURL((u) => u.pathname !== "/login", { timeout: 15000 }).catch(() => {});
  await settle(page);
  return page;
}
const stamp = Date.now().toString(36).slice(-5).toUpperCase();
const main = (p) => p.textContent("main");
async function clearCart(p) {
  await go(p, "/buy/orders/cart");
  const clear = p.getByRole("button", { name: /Esvaziar carrinho|Clear cart/ });
  if (await clear.count()) { await clear.click(); await settle(p); }
}
async function addToCart(p, offerId, qty) {
  await go(p, `/buy/catalogue/offers/${offerId}`);
  await p.locator('input[type="number"]').first().fill(String(qty));
  await p.getByRole("button", { name: /Adicionar ao carrinho|Add to cart/ }).click();
  await settle(p);
}
async function newShop(p, name, category, cc, street) {
  await go(p, "/buy/branches");
  await p.fill("#sf-new-n", name);
  await p.selectOption("#sf-new-cat", category);
  await p.fill("#sf-new-cc", cc);
  await p.fill("#sf-new-l1", street);
  await p.fill("#sf-new-pc", "1100-001");
  const city = p.locator("#sf-new-ci");
  if (await city.count()) await city.selectOption({ index: 1 });
  else await p.fill("#sf-new-cn", "Lisboa");
  await p.getByTestId("shop-form").getByRole("button", { name: /Adicionar loja/ }).click();
  await p.waitForURL("**/buy/branches/c*", { timeout: 15000 }).catch(() => {});
  await settle(p);
  return new URL(p.url()).pathname.split("/").pop();
}
async function switchAccounting(sa, company, on) {
  await go(sa, "/admin/settings/business-features");
  const row = sa.locator("tr", { hasText: company }).first();
  const sw = row.getByTestId("feature-switch");
  if ((await sw.getAttribute("aria-checked")) !== String(on)) await sw.click();
  return until(async () => (await sa.locator("tr", { hasText: company }).first().getByTestId("feature-switch").getAttribute("aria-checked")) === String(on));
}

const owner = await login("owner@kebabhouse.test");
const bruno = await login("buyer@kebabhouse.test");
const sa = await login("superadmin@firingi.test");
const lx = await login("owner@lisboacentral.test");
const offers = await (await owner.request.get(`${BASE}/api/catalogue/offers?q=mozzarella`)).json();
const mozz = offers.items.find((i) => i.vendor.name === "Lisboa Central" && i.packaging.unitsPerPack === 1)?.offerId;
check("found Lisboa Central's mozzarella", !!mozz);
await clearCart(bruno);
// start with accounting off for Kebab House
await switchAccounting(sa, "Kebab House", false);

// ── 1. Shops of one company, each with its own address and category ──
const SHOP_A = `Baixa ${stamp}`, SHOP_B = `Almada ${stamp}`;
const shopA = await newShop(owner, SHOP_A, "restaurant", `CC-${stamp}`, `Rua E2E ${stamp} 1`);
check("shop created with its address", /\/buy\/branches\/c/.test(owner.url()) && (await owner.getByTestId("shop-addresses").textContent()).includes(`Rua E2E ${stamp} 1`));
check("shop category shown", /Restaurante/.test(await owner.getByTestId("shop-category").textContent()));
const staffSelect = owner.getByTestId("staff-select");
const brunoOpt = await staffSelect.locator("option", { hasText: "buyer@kebabhouse.test" }).getAttribute("value");
await staffSelect.selectOption(brunoOpt);
await owner.getByTestId("add-staff").click();
check("Bruno works at the Baixa shop", await until(async () => (await owner.getByTestId("shop-staff").locator("li", { hasText: "Bruno" }).count()) === 1));
await settle(owner);
await shot(owner, "p27-01-shop");
const shopB = await newShop(owner, SHOP_B, "kebab_pizza", `CC-B-${stamp}`, `Rua E2E ${stamp} 2`);
check("second shop created", !!shopB && shopB !== shopA);
await go(owner, "/buy/branches");
check("head office sees both shops", (await owner.getByTestId("shops-table").textContent()).includes(SHOP_A) && (await owner.getByTestId("shops-table").textContent()).includes(SHOP_B));
await shot(owner, "p27-02-shops");

// ── 2. Bruno only orders to his shop; the shop and PO go on the order ──
await go(bruno, "/buy/branches");
check("Bruno sees only his shop", (await bruno.getByTestId("shops-table").textContent()).includes(SHOP_A) && !(await bruno.getByTestId("shops-table").textContent()).includes(SHOP_B));
await addToCart(bruno, mozz, 6);
await go(bruno, "/buy/orders/cart");
const opts = await bruno.locator("#address option").allTextContents();
check("Bruno's checkout offers only his shop's address", opts.length === 1 && opts[0].includes(SHOP_A), opts.join(" | "));
await bruno.fill("#po", `PO-${stamp}`);
await bruno.getByRole("button", { name: /Fazer encomenda|Place order/ }).click();
await bruno.waitForURL("**/buy/orders/**placed=1", { timeout: 20000 }).catch(() => {}); await settle(bruno);
const shopInfo = bruno.getByTestId("order-shop");
check("the order carries the shop, cost centre and PO", (await shopInfo.count()) === 1 && (await shopInfo.textContent()).includes(SHOP_A) && (await shopInfo.textContent()).includes(`PO-${stamp}`) && (await shopInfo.textContent()).includes(`CC-${stamp}`));

// ── 3. Budgets: a "block" budget refuses Bruno's next order; the cart shows it ──
await go(owner, "/buy/branches/budgets");
await owner.fill("#bf-new-n", `Teto ${stamp}`);
await owner.selectOption("#bf-new-s", { label: SHOP_A });
await owner.fill("#bf-new-a", "10");
await owner.selectOption("#bf-new-o", "BLOCK");
await owner.getByTestId("budget-form").last().getByRole("button", { name: /Adicionar orçamento/ }).click();
check("budget added, already over", await until(async () => (await owner.getByTestId("budgets").textContent()).includes(`Teto ${stamp}`)));
await shot(owner, "p27-03-budgets");
await addToCart(bruno, mozz, 6);
await go(bruno, "/buy/orders/cart");
check("the cart shows the shop's budget over the limit", await until(async () => (await bruno.getByTestId("checkout-budgets").count()) === 1 && /não pode ser feita/.test(await bruno.getByTestId("checkout-budgets").textContent())));
await shot(bruno, "p27-04-cart-budget");
await bruno.getByRole("button", { name: /Fazer encomenda|Place order/ }).click();
check("Bruno's order over the budget is refused", await until(async () => (await main(bruno)).includes(`budget "Teto ${stamp}"`)));
await clearCart(bruno);
await go(owner, "/buy/branches/budgets");
const card = owner.getByTestId("budget-card").filter({ hasText: `Teto ${stamp}` });
await card.locator("summary").click();
await card.getByRole("button", { name: /Eliminar/ }).click();
check("budget removed", await until(async () => !(await owner.getByTestId("budgets").textContent()).includes(`Teto ${stamp}`)));

// ── 4. Shop reports ──
await go(owner, "/buy/branches/reports");
check("shops compared side by side", (await owner.getByTestId("shop-comparison").textContent()).includes(SHOP_A));
const csv = await owner.request.get(`${BASE}${await owner.getByTestId("invoices-csv").getAttribute("href")}`);
check("FIRINGI's invoices per shop as CSV", csv.ok() && (csv.headers()["content-type"] ?? "").includes("text/csv") && (await csv.text()).includes("cost_centre"));
await shot(owner, "p27-05-shop-reports");

// ── 5. Accounting: off until FIRINGI switches it on ──
await go(owner, "/buy/accounting/overview");
check("accounting is off by default", (await owner.getByTestId("accounting-off").count()) === 1 && !/Contabilidade/.test(await owner.locator("aside").textContent()));
check("FIRINGI switches accounting on for Kebab House", await switchAccounting(sa, "Kebab House", true));
await shot(sa, "p27-06-admin-business-features");

await go(owner, "/buy/accounting/sales");
check("Accounting is in the menu now", /Contabilidade/.test(await owner.locator("aside").textContent()));
await owner.selectOption("#dc-shop", { label: SHOP_A });
await owner.selectOption("#dc-vat", "13");
await owner.fill("#dc-cash", "300"); await owner.fill("#dc-card", "450");
await owner.getByTestId("daily-close").getByRole("button", { name: /Guardar o dia/ }).click();
check("the day is closed", await until(async () => /Dia guardado/.test(await owner.getByTestId("daily-close").textContent())));
await go(owner, "/buy/accounting/sales");
check("the day's sales are listed", (await owner.getByTestId("sales-table").textContent()).includes(SHOP_A));
await shot(owner, "p27-07-daily-sales");

const dir = mkdtempSync(join(tmpdir(), "rec-"));
const png = join(dir, "recibo.png");
writeFileSync(png, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
await go(owner, "/buy/accounting/expenses");
await owner.selectOption("#ex-cat", "ELECTRICITY");
await owner.fill("#ex-amt", "123");
await owner.selectOption("#ex-vat", "23");
await owner.fill("#ex-payee", "EDP");
await owner.selectOption("#ex-shop", { label: SHOP_A });
await owner.setInputFiles("#ex-rec", png);
await owner.getByTestId("expense-form").getByRole("button", { name: /Adicionar uma despesa/ }).click();
check("expense with a receipt photo added", await until(async () => /Despesa adicionada/.test(await owner.getByTestId("expense-form").textContent())));
await go(owner, "/buy/accounting/expenses");
const recLink = owner.getByTestId("expenses-table").getByRole("link", { name: /Abrir/ }).first();
const rec = await owner.request.get(`${BASE}${await recLink.getAttribute("href")}`);
check("the receipt opens (private)", rec.ok() && (rec.headers()["content-type"] ?? "").includes("image/png"));
await owner.selectOption("#re-cat", "RENT");
await owner.fill("#re-amt", "1500");
await owner.fill("#re-payee", "Senhorio");
await owner.selectOption("#re-shop", { label: SHOP_A });
await owner.getByTestId("recurring-expense-form").getByRole("button", { name: /Adicionar despesa fixa/ }).click();
check("fixed monthly rent added (this month's is in)", await until(async () => /Renda/.test(await owner.getByTestId("recurring-list").textContent())));
await settle(owner);
await shot(owner, "p27-08-expenses");

await go(owner, `/buy/accounting/profit-loss?g=MONTH&shop=${shopA}`);
check("P&L: the month's sales", /750,00/.test(await owner.getByTestId("pnl-sales").textContent()));
check("P&L: expenses include electricity and rent", /1\s?623,00/.test(await owner.getByTestId("pnl-expenses").textContent()), await owner.getByTestId("pnl-expenses").textContent());
check("P&L: VAT estimate shown", (await owner.getByTestId("vat-box").count()) === 1);
await shot(owner, "p27-09-profit-loss");
await go(owner, `/buy/accounting/profit-loss?g=MONTH&shop=${shopA}&basis=NET`);
check("P&L without VAT: sales 663,72", /663,72/.test(await owner.getByTestId("pnl-sales").textContent()));
await go(owner, "/buy/accounting/overview");
check("accounting dashboard: profit today / week / month", (await owner.getByTestId("profit-hero").count()) === 1 && (await owner.getByTestId("profit-by-shop").textContent()).includes(SHOP_A));
await shot(owner, "p27-10-accounting-dashboard");

// ── 6. A supplier's accounting (sales through FIRINGI) ──
await go(lx, "/vendor/accounting/overview");
check("supplier: off until switched on", (await lx.getByTestId("accounting-off").count()) === 1);
await switchAccounting(sa, "Lisboa Central", true);
await go(lx, "/vendor/accounting/profit-loss?g=MONTH");
check("supplier: P&L page opens in the Sell portal", (await lx.getByTestId("pnl-statement").count()) === 1);
await switchAccounting(sa, "Lisboa Central", false);

// ── 7. FIRINGI: customer shops (English) ──
await go(sa, "/admin/customers/shops");
check("FIRINGI sees the customer's shops and categories", (await sa.getByTestId("admin-shops").textContent()).includes(SHOP_A) && /Restaurant/.test(await sa.getByTestId("admin-shops").textContent()));
await shot(sa, "p27-11-admin-shops");

// ── 8. Phone width ──
const phone = await login("owner@kebabhouse.test", { ...devices["iPhone 13"] });
for (const u of ["/buy/branches", `/buy/branches/${shopA}`, "/buy/branches/budgets", "/buy/branches/reports", "/buy/accounting/overview", "/buy/accounting/sales", "/buy/accounting/expenses", "/buy/accounting/profit-loss"]) {
  await go(phone, u);
  const over = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(`phone: ${u} fits the screen`, over <= 1, `overflow ${over}px`);
}
await go(phone, "/buy/accounting/overview");
await shot(phone, "p27-12-phone-accounting");

// ── 9. Leave things as they were: Bruno back to the whole company, accounting off ──
await go(owner, `/buy/branches/${shopA}`);
await owner.getByTestId("shop-staff").getByRole("button", { name: /Remover Bruno/ }).click();
check("Bruno is no longer limited to a shop", await until(async () => (await owner.getByTestId("shop-staff").locator("li", { hasText: "Bruno" }).count()) === 0));
await switchAccounting(sa, "Kebab House", false);

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
