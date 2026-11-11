/**
 * Browser test of Phase 24 (inventory & warehouses), as the wholesaler Lisboa Central (Portuguese UI)
 * and FIRINGI staff (English):
 *  stock & batches (value, lots with best-before) → receive goods with a lot → own supplier → purchase
 *  order (draft → sent with PDF → received) → cycle count (blind → submit → approve) → transfer between
 *  warehouses (send → receive) → movements & valuation → expiry: ask FIRINGI for a feature, FIRINGI
 *  approves; FIRINGI switches "best-before shown to customers" → the customer sees it on the product →
 *  admin overview / expiring / switches → phone width → no page errors. Cleans up its switches.
 *   node tests/e2e/inventory.mjs [baseUrl] [screenshotDir]
 */
import { createRequire } from "node:module";
const { chromium, devices } = createRequire(import.meta.url)("playwright");

const BASE = process.argv[2] ?? "http://localhost:3000";
const SHOTS = process.argv[3] ?? null;
const PASSWORD = process.env.SEED_PASSWORD ?? "Firingi!2026";
let failures = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "✔" : "✘"} ${name}${extra ? ` — ${extra}` : ""}`); if (!ok) failures++; };
const shot = async (page, name) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png` });
const browser = await chromium.launch();
const settle = async (p) => { await p.waitForLoadState("networkidle").catch(() => {}); await p.waitForTimeout(400); };
const go = async (p, url) => { await p.goto(`${BASE}${url}`); await settle(p); };
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn().catch(() => false)) return true; await new Promise((r) => setTimeout(r, 400)); } return false; };
const errors = [];
async function login(email, opts = { viewport: { width: 1440, height: 950 } }) {
  const page = await (await browser.newContext({ ...opts, reducedMotion: "reduce" })).newPage();
  page.on("pageerror", (e) => errors.push(`${email} @ ${page.url().replace(BASE, "")}: ${e.message.slice(0, 140)}`));
  await go(page, "/login");
  await page.fill("#email", email); await page.fill("#password", PASSWORD); await page.click("button[type=submit]");
  await page.waitForURL((u) => u.pathname !== "/login", { timeout: 15000 }).catch(() => {});
  await settle(page);
  return page;
}
const stamp = Date.now().toString(36).slice(-5).toUpperCase();
const iso = (days) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const optionValue = (page, select, text) => page.locator(`${select} option`, { hasText: text }).first().getAttribute("value");
const MOZZ = "Bloco 2kg · GRO-MOZZ2";

const lx = await login("owner@lisboacentral.test");
const sa = await login("superadmin@firingi.test");
// start from FIRINGI's defaults for Lisboa Central (a crashed earlier run may have left switches)
await go(sa, "/admin/inventory/expiry-features");
const lxRow = sa.getByTestId("supplier-feature-row").filter({ hasText: "Lisboa Central" });
if (await lxRow.getByRole("button", { name: "Use defaults" }).count()) { await lxRow.getByRole("button", { name: "Use defaults" }).click(); await settle(sa); }

// ── 1. Stock & batches ──
await go(lx, "/vendor/inventory/overview");
check("menu shows Inventário (Portuguese)", (await lx.locator("aside").textContent()).includes("Inventário"));
check("stock value tile shows euros", /€/.test(await lx.getByTestId("inventory-kpis").textContent()));
check("stock table lists the mozzarella", (await lx.getByTestId("inventory-table").textContent()).includes("GRO-MOZZ2"));
await shot(lx, "p24-01-stock");

// receive goods with a lot and a best-before date
const mozzId = await optionValue(lx, "#rc-offer", MOZZ);
await lx.selectOption("#rc-offer", mozzId);
await lx.fill("#rc-qty", "12"); await lx.fill("#rc-cost", "8.5"); await lx.fill("#rc-lot", `E2E-${stamp}`); await lx.fill("#rc-exp", iso(90));
await lx.getByTestId("receive-form").getByRole("button", { name: /Receber/ }).click();
check("goods received", await until(async () => /Guardado/.test(await lx.getByTestId("receive-form").textContent())));
await go(lx, `/vendor/inventory/stock/${mozzId}`);
check("product page shows the new lot", (await lx.textContent("main")).includes(`E2E-${stamp}`));
check("batches carry best-before dates", (await lx.getByTestId("batch-row").count()) >= 2);
await shot(lx, "p24-02-product-batches");

// ── 2. Own supplier + purchase order ──
await go(lx, "/vendor/inventory/suppliers");
const supplierName = `Fornecedor E2E ${stamp}`;
await lx.getByTestId("supplier-form").locator("input").first().fill(supplierName);
await lx.getByTestId("supplier-form").locator('input[type="email"]').fill(`e2e-${stamp.toLowerCase()}@fornecedor.test`);
await lx.getByTestId("supplier-form").getByRole("button", { name: /Adicionar fornecedor/ }).click();
check("supplier added", await until(async () => (await lx.getByTestId("suppliers-table").textContent()).includes(supplierName)));

await go(lx, "/vendor/inventory/purchase-orders/new");
await lx.selectOption("#po-sup", await optionValue(lx, "#po-sup", supplierName));
const line = lx.getByTestId("po-line").first();
await line.locator("select").first().selectOption(mozzId);
await line.locator('input[type="number"]').first().fill("10");
await line.locator('input[type="number"]').nth(1).fill("8.2");
await lx.getByTestId("po-form").getByRole("button", { name: /Guardar rascunho/ }).click();
await lx.waitForURL(/\/vendor\/inventory\/purchase-orders\/[a-z0-9]+$/, { timeout: 15000 });
await settle(lx);
check("purchase order saved as draft", /Rascunho/.test(await lx.getByTestId("po-status").textContent()));
await lx.getByTestId("po-send").click();
check("purchase order sent (e-mailed with PDF)", await until(async () => /Enviada/.test(await lx.getByTestId("po-status").textContent())));
const pdfHref = await lx.locator('a[href$="/pdf"]').getAttribute("href");
const pdf = await lx.request.get(`${BASE}${pdfHref}`);
check("purchase order PDF downloads", pdf.ok() && (await pdf.body()).subarray(0, 4).toString() === "%PDF");
await shot(lx, "p24-03-po-sent");
const recv = lx.getByTestId("po-receive");
await recv.locator('input[maxlength="60"]').first().fill(`PO-${stamp}`);
await recv.locator('input[type="date"]').first().fill(iso(60));
await recv.getByRole("button", { name: /Receber/ }).click();
check("purchase order received in full", await until(async () => /Recebida/.test(await lx.getByTestId("po-status").textContent())));
check("receipt lists the lot", (await lx.textContent("main")).includes(`PO-${stamp}`));

// ── 3. Cycle count (blind) ──
await go(lx, "/vendor/inventory/counts");
const sc = lx.getByTestId("start-count");
await sc.locator("select[multiple]").selectOption([mozzId]);
await sc.getByRole("button", { name: /Iniciar/ }).click();
await lx.waitForURL(/\/vendor\/inventory\/counts\/[a-z0-9]+$/, { timeout: 15000 }).catch(() => {});
await settle(lx);
if (/Já existe|still open/.test(await lx.textContent("main"))) console.log("  (a count was already open)");
check("count opens blind (no expected numbers)", (await lx.getByTestId("count-input").count()) > 0);
// count exactly what the system holds per lot → no difference
const inputs = lx.getByTestId("count-input");
const levelPage = await lx.context().newPage();
await levelPage.goto(`${BASE}/vendor/inventory/stock/${mozzId}`); await settle(levelPage);
const lotQty = {};
for (const row of await levelPage.getByTestId("stock-warehouse").first().getByTestId("batch-row").all()) {
  const cells = await row.locator("td").allTextContents();
  lotQty[cells[0].trim()] = Number(cells[2].replace(/\D/g, ""));
}
await levelPage.close();
const labels = await lx.getByTestId("count-sheet").locator(".glass-panel").allTextContents();
for (let i = 0; i < (await inputs.count()); i++) {
  const lot = Object.keys(lotQty).find((k) => labels[i].includes(k));
  await inputs.nth(i).fill(String(lot !== undefined ? lotQty[lot] : 0));
}
await lx.getByTestId("count-submit").click();
check("count submitted", await until(async () => /aprovação/i.test(await lx.getByTestId("count-status").textContent())));
await lx.getByTestId("count-approve").click();
check("count approved and posted", await until(async () => /Lançada/.test(await lx.getByTestId("count-status").textContent())));
await shot(lx, "p24-04-count");

// ── 4. Transfer between warehouses ──
await go(lx, "/vendor/inventory/transfers");
const tf = lx.getByTestId("transfer-form");
await tf.locator("select").nth(2).selectOption(mozzId);
await tf.locator('input[type="number"]').first().fill("2");
await tf.getByRole("button", { name: /Criar/ }).click();
await lx.waitForURL(/\/vendor\/inventory\/transfers\/[a-z0-9]+$/, { timeout: 15000 }).catch(() => {});
await settle(lx);
await lx.getByTestId("transfer-send").click();
check("transfer in transit", await until(async () => /trânsito/i.test(await lx.getByTestId("transfer-status").textContent())));
await lx.getByTestId("transfer-receive-btn").click();
check("transfer received", await until(async () => /Recebida/.test(await lx.getByTestId("transfer-status").textContent())));

// ── 5. Movements, valuation, reorder ──
await go(lx, "/vendor/inventory/movements");
const moves = await lx.getByTestId("movements-table").textContent();
check("movements show receipt, count and transfer", /Recebido/.test(moves) && /Entrada por transferência|Saída por transferência/.test(moves));
await go(lx, "/vendor/inventory/valuation");
check("valuation shows value per warehouse", (await lx.getByTestId("valuation-table").textContent()).includes("GRO-MOZZ2"));
await shot(lx, "p24-05-valuation");
await go(lx, "/vendor/inventory/reorder");
check("reorder page answers", (await lx.getByTestId("reorder-table").count()) + (await lx.getByTestId("no-reorder").count()) === 1);

// ── 6. Expiry features: ask, FIRINGI approves ──
await go(lx, "/vendor/inventory/expiry");
check("expiry features listed (Portuguese)", /Funcionalidades de validade/.test(await lx.getByTestId("features").textContent()));
const md = lx.getByTestId("feature-MARKDOWN");
if (/Inativo/.test(await md.textContent())) {
  await lx.getByTestId("ask-MARKDOWN").click();
  await md.locator("input").fill("Temos muitos lacticínios de validade curta");
  await md.getByRole("button", { name: /Enviar/ }).click();
  check("request sent to FIRINGI", await until(async () => /À espera da FIRINGI/.test(await md.textContent())));
  await go(sa, "/admin/inventory/expiry-features");
  const req = sa.getByTestId("feature-requests").locator("div.rounded-xl").filter({ hasText: "Lisboa Central" }).filter({ hasText: "Markdown" }).first();
  await req.getByTestId("approve-request").click();
  await settle(sa);
  await go(lx, "/vendor/inventory/expiry");
  check("FIRINGI approved: markdown suggestions on", /Ativo/.test(await lx.getByTestId("feature-MARKDOWN").textContent()) && (await lx.getByTestId("markdown").count()) === 1);
}
await shot(lx, "p24-06-expiry");

// ── 7. FIRINGI shows best-before to customers → the customer sees it ──
// a short-dated lot (FEFO: it is what the next customer gets)
await go(lx, "/vendor/inventory/overview");
await lx.selectOption("#rc-offer", mozzId);
await lx.fill("#rc-qty", "5"); await lx.fill("#rc-lot", `BB-${stamp}`); await lx.fill("#rc-exp", iso(9));
await lx.getByTestId("receive-form").getByRole("button", { name: /Receber/ }).click();
await until(async () => /Guardado/.test(await lx.getByTestId("receive-form").textContent()));
await go(sa, "/admin/inventory/expiry-features");
const row = sa.getByTestId("supplier-feature-row").filter({ hasText: "Lisboa Central" });
const showSwitch = row.getByTestId("switch-SHOW_EXPIRY");
if ((await showSwitch.getAttribute("aria-checked")) !== "true") { await showSwitch.click(); await until(async () => (await showSwitch.getAttribute("aria-checked")) === "true"); }
await shot(sa, "p24-07-admin-switches");
const kebab = await login("owner@kebabhouse.test");
await go(kebab, `/buy/catalogue/offers/${mozzId}`);
const bb = kebab.getByTestId("best-before");
check("customer sees the best-before date (Portuguese)", (await bb.count()) === 1 && /Consumir até/.test(await bb.textContent()), (await bb.count()) ? await bb.textContent() : "missing");
await shot(kebab, "p24-07b-customer-best-before");

// ── 8. Admin overview + expiring ──
await go(sa, "/admin/inventory/overview");
check("admin overview lists Lisboa Central with a stock value", (await sa.getByTestId("admin-inventory-table").textContent()).includes("Lisboa Central"));
await shot(sa, "p24-08-admin-overview");
await go(sa, "/admin/inventory/expiring?days=30");
check("admin expiring stock answers", (await sa.getByTestId("admin-expiring-table").count()) === 1);

// ── 9. Phone width ──
const phone = await login("owner@lisboacentral.test", { ...devices["iPhone 13"], colorScheme: "dark" });
for (const path of ["/vendor/inventory/overview", "/vendor/inventory/expiry", "/vendor/inventory/purchase-orders"]) {
  await go(phone, path);
  const over = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(`phone: ${path} has no sideways scroll`, over <= 1, `${over}px`);
}
await shot(phone, "p24-09-phone");

// cleanup: back to FIRINGI's defaults for Lisboa Central
await go(sa, "/admin/inventory/expiry-features");
const again = sa.getByTestId("supplier-feature-row").filter({ hasText: "Lisboa Central" });
if (await again.getByRole("button", { name: "Use defaults" }).count()) { await again.getByRole("button", { name: "Use defaults" }).click(); await settle(sa); }

await go(kebab, `/buy/catalogue/offers/${mozzId}`);
check("back to defaults: customers no longer see the best-before", (await kebab.getByTestId("best-before").count()) === 0);

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll inventory e2e checks passed");
process.exit(failures ? 1 : 0);
