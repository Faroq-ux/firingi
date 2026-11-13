/**
 * Browser test of Phase 22 (futuristic redesign): command palette (Ctrl+K → find an order → open
 * it); smart tables (filter, hide a column, save a default view that comes back after reload, CSV
 * export, bulk confirm for suppliers); customisable dashboards (hide a card and widen another —
 * remembered after reload — then reset); live activity feed (a new order appears on the supplier's
 * dashboard while it is open); CRM pipeline drag & drop; order progress tracker; the collapsible
 * sidebar; pages fit a phone in dark mode; no page errors.
 *   node tests/e2e/workspace.mjs [baseUrl] [screenshotDir]
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
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn().catch(() => false)) return true; await new Promise((r) => setTimeout(r, 500)); } return false; };
const errors = [];
async function login(email, opts = { viewport: { width: 1440, height: 950 } }) {
  const page = await (await browser.newContext({ ...opts, reducedMotion: "reduce", acceptDownloads: true })).newPage();
  page.on("pageerror", (e) => errors.push(`${email} @ ${page.url().replace(BASE, "")}: ${e.message.slice(0, 120)}`));
  page.on("dialog", (d) => d.accept(d.type() === "prompt" ? "E2E view" : undefined));
  await go(page, "/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL((u) => u.pathname !== "/login", { timeout: 15000 }).catch(() => {});
  await settle(page);
  return page;
}

// ── command palette ──
const sa = await login("superadmin@firingi.test");
await go(sa, "/admin/orders/all");
const firstNumber = (await sa.getByTestId("dt-row").first().locator("a").first().textContent()).trim();
await sa.keyboard.press("Control+k");
check("Ctrl+K opens the palette", await sa.getByTestId("palette").isVisible());
await sa.getByTestId("palette-input").fill(firstNumber);
check("palette finds the order", await until(async () => (await sa.getByTestId("palette-results").textContent()).includes(firstNumber)));
await sa.keyboard.press("Enter");
await sa.waitForURL((u) => /\/admin\/orders\/(?!all)[^/]+$/.test(u.pathname), { timeout: 10000 }).catch(() => {});
check("Enter opens it", /\/admin\/orders\/(?!all)[^/]+$/.test(new URL(sa.url()).pathname), sa.url());
await sa.keyboard.press("Control+k");
await sa.getByTestId("palette-input").fill("todas");
check("palette lists pages", await until(async () => (await sa.getByTestId("palette-results").locator("button").count()) > 0));
await sa.keyboard.press("Escape");
check("Esc closes it", !(await sa.getByTestId("palette").isVisible().catch(() => false)));

// ── smart table ──
await go(sa, "/admin/orders/all");
const total = await sa.getByTestId("dt-row").count();
await sa.getByTestId("dt-search").fill(firstNumber);
check("quick filter narrows rows", (await sa.getByTestId("dt-row").count()) === 1, `${total} → ${await sa.getByTestId("dt-row").count()}`);
await sa.getByTestId("dt-search").fill("");
await sa.getByTestId("dt-columns").click();
await sa.getByTestId("dt-col-delivery").uncheck();
await sa.keyboard.press("Escape"); await sa.mouse.click(5, 300);
const headers = await sa.locator("[data-testid^=dt-sort-]").allTextContents();
check("column hidden", headers.length > 0 && !headers.some((h) => /entrega|delivery/i.test(h)), headers.join("|"));
await sa.getByTestId("dt-sort-total").click(); await sa.getByTestId("dt-sort-total").click();
await sa.getByTestId("dt-views").click();
await sa.getByRole("button", { name: /open by default|abrir por defeito|por defecto/i }).click();
check("view saved", await until(async () => (await sa.getByTestId("dt-views").textContent()).includes("E2E view")));
await sa.reload(); await settle(sa);
const after = await sa.locator("[data-testid^=dt-sort-]").allTextContents();
check("default view comes back after reload", (await sa.getByTestId("dt-views").textContent()).includes("E2E view") && !after.some((h) => /entrega|delivery/i.test(h)));
const [csv] = await Promise.all([sa.waitForEvent("download"), sa.getByTestId("dt-export").click()]);
check("CSV export", /\.csv$/.test(csv.suggestedFilename()), csv.suggestedFilename());
await shot(sa, "p22-smart-table");
// clean the view
await sa.getByTestId("dt-views").click();
await sa.getByRole("button", { name: /Delete view|Eliminar vista/i }).first().click();
await sa.waitForTimeout(600);

// ── dashboards: customise + live feed ──
await go(sa, "/admin/dashboard/overview");
check("live feed on the admin dashboard", await until(async () => (await sa.getByTestId("live-feed").locator("li").count()) > 0));
await sa.getByTestId("dash-edit").click();
await sa.getByTestId("dash-hide-network").click();
await sa.getByTestId("dash-size-live").click();
await shot(sa, "p22-dashboard-edit");
await sa.getByTestId("dash-edit").click();
await sa.waitForTimeout(800);
await sa.reload(); await settle(sa);
check("hidden card stays hidden after reload", (await sa.locator('[data-card="network"]').count()) === 0);
check("wider card remembered", /col-span-2/.test(await sa.locator('[data-card="live"]').getAttribute("class")));
await sa.getByTestId("dash-edit").click();
await sa.getByRole("button", { name: /Reset layout|Repor disposição/i }).click();
await sa.getByTestId("dash-edit").click();
await sa.waitForTimeout(800); await sa.reload(); await settle(sa);
check("reset brings it back", (await sa.locator('[data-card="network"]').count()) === 1);

// Supplier dashboard open; a customer orders → it appears live.
const vendor = await login("owner@lisboacentral.test");
await go(vendor, "/vendor/dashboard/overview");
await until(async () => (await vendor.getByTestId("live-feed").textContent()).length > 10);
// The supplier tops up stock with a one-line file (Import & Sync) so this test can always order.
{
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const f = join(mkdtempSync(join(tmpdir(), "firingi-ws-")), "stock.csv");
  writeFileSync(f, "Referência;EAN;Stock\nGRO-MOZZ2;5601000000608;900\n");
  await go(vendor, "/vendor/products/import");
  await vendor.getByTestId("import-file").setInputFiles(f);
  await vendor.getByTestId("rows-found").waitFor({ timeout: 15000 });
  await vendor.getByTestId("import-preview").click();
  await vendor.waitForURL("**/vendor/products/import/**", { timeout: 15000 });
  await settle(vendor);
  if (await vendor.getByTestId("import-apply").isEnabled()) { await vendor.getByTestId("import-apply").click(); await vendor.getByTestId("import-result").waitFor({ timeout: 15000 }); }
  else await vendor.getByTestId("import-discard").click();
  await go(vendor, "/vendor/dashboard/overview");
  await until(async () => (await vendor.getByTestId("live-feed").textContent()).length > 10);
}
const buyer = await login("owner@kebabhouse.test");
const offers = await (await buyer.request.get(`${BASE}/api/catalogue/offers?q=mozzarella`)).json();
const mozz = offers.items.find((i) => i.vendor.name === "Lisboa Central" && i.packaging.unitsPerPack === 1)?.offerId;
await go(buyer, "/buy/orders/cart");
await buyer.getByRole("button", { name: /^(Clear|Esvaziar|Limpar)/i }).first().click().catch(() => null);
await go(buyer, `/buy/catalogue/offers/${mozz}`);
const qty = buyer.locator('input[type="number"]').first();
await qty.fill("25");
await buyer.getByRole("button", { name: /Add to cart|Adicionar ao carrinho/i }).first().click();
await buyer.waitForTimeout(800);
await go(buyer, "/buy/orders/cart");
await buyer.getByRole("button", { name: /Place order|Fazer encomenda|Encomendar/i }).first().click();
await buyer.waitForURL("**/buy/orders/**", { timeout: 20000 }).catch(() => {});
await settle(buyer);
const placedNumber = (await buyer.locator("h1").first().textContent()).match(/FO-\d{4}-\d+/)?.[0];
check("customer placed an order", !!placedNumber, placedNumber);
check("order progress tracker on the order", await buyer.getByTestId("order-progress").isVisible());
await shot(buyer, "p22-order-progress");
check("it appears live on the supplier's dashboard", await until(async () => (await vendor.getByTestId("live-feed").textContent()).includes(placedNumber), 25000));
await shot(vendor, "p22-vendor-live");

// ── supplier: bulk confirm in the smart table ──
await go(vendor, "/vendor/orders/incoming");
const row = vendor.getByTestId("dt-row").filter({ hasText: placedNumber });
const statusBefore = (await row.locator("td").last().textContent()).trim();
await row.getByTestId("dt-select").check();
check("bulk bar appears", await vendor.getByTestId("dt-bulkbar").isVisible());
await vendor.getByTestId("dt-bulk-confirm").click();
check("bulk confirm changes the status", await until(async () => { const r = vendor.getByTestId("dt-row").filter({ hasText: placedNumber }); return (await r.count()) === 0 || (await r.locator("td").last().textContent()).trim() !== statusBefore; }, 15000), statusBefore);

// ── CRM pipeline drag & drop ──
await go(sa, "/admin/crm/pipeline");
const count = async (stage) => sa.getByTestId(`stage-${stage}`).getByTestId("deal-card").count();
const [p0, n0] = [await count("PROPOSAL"), await count("NEGOTIATION")];
if (p0 > 0) {
  await sa.getByTestId("stage-PROPOSAL").getByTestId("deal-card").first().dragTo(sa.getByTestId("stage-NEGOTIATION"));
  check("drag a deal to Negotiation", await until(async () => (await count("NEGOTIATION")) === n0 + 1, 10000), `${p0}/${n0}`);
  await shot(sa, "p22-pipeline");
  const card = sa.getByTestId("stage-NEGOTIATION").getByTestId("deal-card").first();
  await card.getByTestId("deal-stage").locator("select").selectOption("PROPOSAL");
  await card.getByTestId("deal-stage").getByRole("button").click();
  check("and back with the stage picker", await until(async () => (await count("PROPOSAL")) === p0, 10000));
} else check("pipeline board renders", await sa.getByTestId("pipeline").isVisible());

// ── sidebar rail ──
await sa.getByTestId("sidebar-collapse").click();
check("sidebar folds to an icon rail", await sa.getByTestId("sidebar-rail").isVisible());
await sa.reload(); await settle(sa);
check("rail remembered", await sa.getByTestId("sidebar-rail").isVisible());
await sa.getByTestId("sidebar-expand").click();

// ── phones, dark ──
const phone = await login("owner@kebabhouse.test", { ...devices["iPhone 13"], colorScheme: "dark" });
await phone.context().addCookies([{ name: "theme", value: "dark", url: BASE }]);
for (const url of ["/buy/dashboard/overview", "/buy/orders/history", "/buy/catalogue/browse"]) {
  await go(phone, url);
  const over = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(`phone fits ${url}`, over <= 1, `overflow ${over}px`);
}
await shot(phone, "p22-phone-catalogue-dark");

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nAll workspace checks passed");
process.exit(failures ? 1 : 0);
