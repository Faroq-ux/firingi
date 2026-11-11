/**
 * Browser test of Phase 8 against a running server with the demo seed:
 * admin analytics (KPIs, chart hover, table view, CSV/Excel export, custom report builder,
 * regional scope), vendor sales report and buyer spending report (Portuguese, own data only,
 * exports refused outside the caller's scope).
 *   node tests/e2e/analytics.mjs [baseUrl] [screenshotDir]
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
async function login(email, opts = {}) {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 950 }, ...opts })).newPage();
  page.on("pageerror", (e) => errors.push(`${email} @ ${page.url().replace(BASE, "")}: ${e.message.slice(0, 100)}`));
  await go(page, "/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await settle(page);
  return page;
}
const main = (p) => p.textContent("main");
const get = (p, url) => p.request.get(`${BASE}${url}`);

// ── 1. Back office: sales analytics ──
const sa = await login("superadmin@firingi.test");
await go(sa, "/admin/analytics/sales?period=12m");
const net = await sa.getByTestId("kpi-net").textContent();
check("sales KPIs show net sales", /\d+,\d{2}\s?€/.test(net), net.replace(/\s+/g, " ").slice(0, 60));
const svg = sa.locator("svg[role=img]").first();
check("sales chart rendered", (await svg.count()) === 1 && (await svg.locator("path").count()) >= 2);
const box = await svg.boundingBox();
await sa.mouse.move(box.x + box.width * 0.7, box.y + box.height / 2);
await sa.waitForTimeout(300);
check("hovering the chart shows a tooltip", await sa.getByTestId("chart-tooltip").first().isVisible().catch(() => false));
await shot(sa, "p8-01-sales");
await sa.getByRole("tab", { name: "Table" }).first().click();
check("table view replaces the chart", (await sa.locator("section table").first().textContent()).includes("Previous period"));
check("top vendors listed", (await sa.getByTestId("bars-vendor").textContent()).includes("Lisboa Central"));

// filters: delivered basis + seller type
await sa.selectOption('select[name="basis"]', "delivered");
await sa.waitForURL("**basis=delivered**");
await settle(sa);
check("filter bar updates the URL and page", (await sa.locator('select[name="basis"]').inputValue()) === "delivered");
await sa.selectOption('select[name="type"]', "DISTRIBUTOR");
await sa.waitForURL("**type=DISTRIBUTOR**");
await settle(sa);
check("distributor filter leaves no wholesaler sales", !(await sa.getByTestId("bars-vendor").textContent()).includes("Lisboa Central"));

// exports
const csv = await get(sa, "/api/analytics/export?audience=ADMIN&period=12m&dims=vendor&metrics=orders,net&format=csv");
const csvText = await csv.text();
check("CSV export", csv.status() === 200 && /^﻿?Vendor,Orders,Net sales\r\n/.test(csvText) && csvText.includes("Lisboa Central"), csvText.split("\r\n")[0]);
const xlsx = await get(sa, "/api/analytics/export?audience=ADMIN&period=12m&dims=month&metrics=revenue&format=xlsx");
const buf = await xlsx.body();
check("Excel export", xlsx.status() === 200 && buf[0] === 0x50 && buf[1] === 0x4b && /attachment; filename="firingi-month-/.test(xlsx.headers()["content-disposition"]));

// revenue: delivered basis by default, monthly table
await go(sa, "/admin/analytics/revenue?period=12m");
check("revenue counts delivered orders by default", (await sa.locator('select[name="basis"]').inputValue()) === "delivered");
check("revenue by month table", (await sa.getByTestId("table-revenue-month").locator("tbody tr").count()) >= 12);

// custom report builder
await go(sa, "/admin/analytics/custom?period=12m");
await sa.selectOption('select[name="d1"]', "product");
for (const m of ["units", "net"]) await sa.check(`input[name="m"][value="${m}"]`);
await sa.getByRole("button", { name: "Run report" }).click();
await settle(sa);
const rep = await sa.getByTestId("report-table").textContent();
check("custom report by product", rep.includes("Mozzarella") && rep.includes("Units"));
await shot(sa, "p8-02-custom");
await sa.check('input[name="m"][value="fees"]');
await sa.getByRole("button", { name: "Run report" }).click();
await settle(sa);
check("impossible combination explained", /Delivery fees can't be split by product or category/.test(await sa.locator("main [role=alert]").textContent()));

// other pages render
for (const r of ["gross-margin", "orders", "customers", "vendors", "distributors", "wholesalers", "products", "delivery", "country"]) {
  const res = await sa.goto(`${BASE}/admin/analytics/${r}?period=12m`);
  await settle(sa);
  check(`/admin/analytics/${r} renders`, res.status() === 200 && !/Application error|Something went wrong/.test(await main(sa)));
}
await go(sa, "/admin/analytics/net-profit");
check("net profit page is live (Phase 14)", (await sa.getByTestId("net-table").count()) === 1);

// regional manager sees only their regions
const rm = await login("rm.lisboa@firingi.test");
await go(rm, "/admin/analytics/sales?period=12m");
check("regional manager is told the scope", (await main(rm)).includes("Showing your regions only"));

// ── 2. Vendor sales report (Portuguese, dark mode) ──
const vendor = await login("owner@lisboacentral.test", { colorScheme: "dark" });
await go(vendor, "/vendor/reports/sales?period=12m");
const vt = await main(vendor);
check("vendor report in Portuguese", vt.includes("Relatório de Vendas") && vt.includes("O seu pagamento"));
check("vendor sees own customers", (await vendor.getByTestId("bars-buyer").textContent()).includes("Kebab House"));
await shot(vendor, "p8-03-vendor-dark");
const vcsv = await (await get(vendor, "/api/analytics/export?audience=VENDOR&period=12m&dims=month&metrics=orders,goodsNet&format=csv")).text();
check("vendor CSV headers in Portuguese", vcsv.replace(/^﻿/, "").startsWith("Mês,Encomendas,Mercadoria (sem IVA)"), vcsv.split("\r\n")[0]);
check("vendor can't export FIRINGI's margin", (await get(vendor, "/api/analytics/export?audience=VENDOR&period=12m&dims=month&metrics=margin&format=csv")).status() === 403);
check("vendor can't export back-office reports", (await get(vendor, "/api/analytics/export?audience=ADMIN&period=12m&dims=vendor&metrics=net&format=csv")).status() === 403);
const warehouse = await login("warehouse@lisboacentral.test");
await go(warehouse, "/vendor/reports/sales");
check("warehouse role has no sales report", warehouse.url().includes("/forbidden"), warehouse.url());

// ── 3. Buyer spending report ──
const buyer = await login("owner@kebabhouse.test");
await go(buyer, "/buy/reports/spending?period=12m");
const bt = await main(buyer);
check("buyer spending report in Portuguese", bt.includes("Relatório de Compras") && bt.includes("Total gasto"));
check("buyer sees suppliers", (await buyer.getByTestId("bars-vendor").textContent()).includes("Lisboa Central"));
await shot(buyer, "p8-04-buyer");
check("buyer nav lists the report", (await buyer.locator("nav").first().textContent()).includes("Relatório de Compras"));

check("no browser errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll analytics e2e checks passed");
process.exit(failures ? 1 : 0);
