/**
 * Browser test of Phase 14 against a running server with the demo seed:
 * finance records a monthly cost → P&L net profit drops by it; cash flow; net profit by
 * supplier; route profitability; superadmin margin rule (and its watch list); contract
 * pricing; scorecards; KPI target. Kebab House (Portuguese) rates a delivered order →
 * Lisboa Central sees it and answers → the customer sees the answer → FIRINGI's ratings page.
 *   node tests/e2e/profit.mjs [baseUrl] [screenshotDir]
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
  await settle(page);
  return page;
}
const main = (p) => p.textContent("main");
const stamp = Date.now().toString().slice(-6);
/** "€ 1.234,56" / "1,234.56 €" / "-€120.00" → number (the last 2 digits are cents). */
const euros = (s) => { const m = s.replace(/\s/g, "").match(/[-−]?[^\d-−]*[\d.,]+/); if (!m) return NaN; const neg = /^[-−]/.test(m[0]); const d = m[0].replace(/[^\d]/g, ""); return (neg ? -1 : 1) * Number(d) / 100; };
const kpi = async (p, testid, label) => euros(await p.getByTestId(testid).locator("div.tile", { hasText: label }).first().locator(".kpi-value").textContent());

// ── 1. P&L: a cost lowers net profit by exactly its amount ──
const fin = await login("finance@firingi.test");
await go(fin, "/admin/finance/profit-loss");
check("P&L page renders", (await main(fin)).includes("Profit & Loss") && (await fin.getByTestId("pnl-table").count()) === 1);
const netBefore = await kpi(fin, "pnl-kpis", "Net profit");
const cf = fin.getByTestId("cost-form");
await cf.locator('select[name="costCategory"]').selectOption("MARKETING");
await cf.locator('input[name="costDescription"]').fill(`Flyers ${stamp}`);
await cf.locator('input[name="costAmount"]').fill("123.45");
await cf.locator('input[name="costVat"]').fill("28.39");
await cf.getByRole("button", { name: "Record cost" }).click();
await settle(fin);
check("cost listed with its category", (await fin.getByTestId("costs-table").locator("tr", { hasText: `Flyers ${stamp}` }).textContent()).includes("Marketing"));
check("cost category in the statement", (await fin.getByTestId("pnl-table").textContent()).includes("− Marketing"));
const netAfter = await kpi(fin, "pnl-kpis", "Net profit");
check("net profit lowered by the cost", Math.abs(netBefore - netAfter - 123.45) < 0.02, `${netBefore} → ${netAfter}`);
await shot(fin, "p14-01-profit-loss");

await go(fin, "/admin/finance/cash-flow");
check("cash flow with 8-week forecast", (await fin.getByTestId("cash-forecast").locator("tbody tr").count()) >= 8);
await shot(fin, "p14-02-cash-flow");

await go(fin, "/admin/analytics/net-profit");
check("net profit by supplier lists Lisboa Central", (await fin.getByTestId("net-table").textContent()).includes("Lisboa Central"));
await go(fin, "/admin/analytics/route-profitability");
check("route profitability renders", (await fin.getByTestId("route-profit").count()) === 1);

// remove the test cost again
await go(fin, "/admin/finance/profit-loss");
fin.once("dialog", (d) => d.accept());
await fin.getByTestId("costs-table").locator("tr", { hasText: `Flyers ${stamp}` }).getByRole("button", { name: "Delete" }).click();
await settle(fin);
check("cost deleted", !(await fin.getByTestId("costs-table").textContent()).includes(`Flyers ${stamp}`));

// ── 2. Margin rule (superadmin), contracts, scorecards, KPI ──
const sa = await login("superadmin@firingi.test");
await go(sa, "/admin/pricing/margin");
const mf = sa.getByTestId("margin-form");
await mf.locator('select[name="marginScope"]').selectOption("VENDOR");
const vendorValue = await mf.locator('select[name="marginTarget"] option', { hasText: "Almada" }).first().getAttribute("value");
await mf.locator('select[name="marginTarget"]').selectOption(vendorValue);
await mf.locator('input[name="minMargin"]').fill("40");
await mf.locator('input[name="marginNote"]').fill(`e2e ${stamp}`);
await mf.getByRole("button", { name: "Save rule" }).click();
await settle(sa);
check("margin rule saved", (await sa.getByTestId("margin-rules").textContent()).includes(`e2e ${stamp}`));
check("offers below the minimum are flagged", (await sa.getByTestId("margin-watch").textContent()).includes("Almada"));
await shot(sa, "p14-03-margin");
await sa.getByTestId("margin-rules").locator("tr", { hasText: `e2e ${stamp}` }).getByRole("button", { name: "Remove" }).click();
await settle(sa);
check("margin rule removed", !(await sa.getByTestId("margin-rules").textContent()).includes(`e2e ${stamp}`));

await go(sa, "/admin/vendors/wholesalers/contracts");
check("contract pricing lists Kebab House", (await sa.getByTestId("contracts-table").textContent()).includes("Kebab House"));
await go(sa, "/admin/vendors/wholesalers/performance");
check("wholesaler scorecards list Lisboa Central", (await sa.getByTestId("scorecards").textContent()).includes("Lisboa Central"));
await shot(sa, "p14-04-scorecards");

await go(sa, "/admin/dashboard/kpi");
const t = sa.getByTestId("target-revenue");
await t.locator("input").fill("1000");
await t.getByRole("button", { name: "Set" }).click();
await settle(sa);
check("KPI target shown with progress", /1[.,]?000/.test(await sa.getByTestId("kpi-revenue").textContent()) && /%/.test(await sa.getByTestId("kpi-revenue").textContent()));
await shot(sa, "p14-05-kpi");

// ── 3. Customer rates a delivered order (Portuguese) → supplier answers ──
const customer = await login("owner@kebabhouse.test");
await go(customer, "/buy/orders/history");
const hrefs = await customer.locator('main a[href^="/buy/orders/"]').evaluateAll((as) => as.map((a) => a.getAttribute("href")));
let orderPath = null;
for (const h of [...new Set(hrefs)].filter((h) => /^\/buy\/orders\/[a-z0-9]{20,}$/.test(h))) {
  await go(customer, h);
  if (await customer.getByTestId("rating-panel").count()) { orderPath = h; break; }
}
check("a delivered order offers a rating", !!orderPath);
const orderId = orderPath?.split("/").pop();
const panel = customer.getByTestId("rating-panel");
check("rating panel in Portuguese", /Avaliar esta encomenda|A sua avaliação/.test(await panel.textContent()));
await panel.getByRole("radiogroup", { name: "A encomenda" }).getByRole("radio", { name: "4/5" }).click();
await panel.getByRole("radiogroup", { name: "A entrega" }).getByRole("radio", { name: "5/5" }).click();
await panel.locator("textarea").fill(`Boa mozzarella, entrega rápida ${stamp}`);
await panel.getByRole("button", { name: /^(Enviar|Atualizar avaliação)$/ }).click();
await settle(customer);
check("customer thanked", (await panel.textContent()).includes("Obrigado pela sua avaliação!"));
await shot(customer, "p14-06-customer-rates");

const vendor = await login("owner@lisboacentral.test");
await go(vendor, `/vendor/orders/${orderId}`);
const vp = vendor.getByTestId("rating-panel");
check("supplier sees the rating", (await vp.count()) === 1 && (await vp.textContent()).includes(stamp) && (await vp.textContent()).includes("★★★★☆"));
await vp.locator("input").fill(`Obrigado, até breve! ${stamp}`);
await vp.getByRole("button", { name: "Enviar" }).click();
await settle(vendor);
await go(vendor, "/vendor/dashboard/overview");
check("supplier score on the dashboard", /A sua pontuação de fornecedor/.test(await main(vendor)));

await go(customer, orderPath);
check("customer sees the supplier's answer", (await customer.getByTestId("rating-panel").textContent()).includes(`Obrigado, até breve! ${stamp}`));

await go(sa, "/admin/vendors/management/ratings");
const rt = await sa.getByTestId("ratings-table").textContent();
check("FIRINGI sees rating and answer", rt.includes(stamp) && rt.includes("Kebab House"));
await shot(sa, "p14-07-ratings");

check("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nAll profit e2e checks passed");
process.exit(failures ? 1 : 0);
