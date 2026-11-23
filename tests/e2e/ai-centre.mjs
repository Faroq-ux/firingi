/**
 * Browser test of Phase 66 (AI Centre, FIRINGI back office in English): the AI Dashboard (KPIs, areas, top actions,
 * settings) → Recommendations by area with the detail tables; a route in a zig-zag order → "shorter route" with km, fuel,
 * € and CO₂ → accepted: the stops are put in the shorter order → Forecasting (6 tabs) → AI Reports (7 tabs, PDF, CSV)
 * → old addresses redirect → switching an area off → phone width, dark mode → no page errors. Cleans up after itself.
 *   node tests/e2e/ai-centre.mjs [baseUrl] [screenshotDir]
 */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
const { chromium } = createRequire(import.meta.url)("playwright");

const BASE = process.argv[2] ?? "http://localhost:3000";
const SHOTS = process.argv[3] ?? null;
const PASSWORD = process.env.SEED_PASSWORD ?? "Firingi!2026";
const DB = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/firingi";
let failures = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "✔" : "✘"} ${name}${extra ? ` — ${extra}` : ""}`); if (!ok) failures++; };
const shot = async (page, name, full = false) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: full });
const browser = await chromium.launch();
const settle = async (p) => { await p.waitForLoadState("networkidle").catch(() => {}); await p.waitForTimeout(400); };
const go = async (p, url) => { const r = await p.goto(`${BASE}${url}`); await settle(p); return r; };
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn().catch(() => false)) return true; await new Promise((r) => setTimeout(r, 400)); } return false; };
const sql = (q) => execFileSync("psql", ["-At", DB, "-c", q], { encoding: "utf8" }).trim();
const setup = (arg) => execFileSync("npx", ["tsx", "--require", "./tests/e2e/setup/no-server-only.cjs", "tests/e2e/setup/aic-setup.ts", arg], { encoding: "utf8" }).trim().split("\n").pop();
const errors = [];
async function login(email, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "en-GB", reducedMotion: "reduce", deviceScaleFactor: SHOTS ? 2 : 1, serviceWorkers: "block", ...opts });
  await ctx.addCookies([{ name: "NEXT_LOCALE", value: "en", url: BASE }]);
  const page = await ctx.newPage();
  if (process.env.E2E_SLOW) page.setDefaultTimeout(240000);
  page.on("pageerror", (e) => errors.push(`${email}: ${e.message.slice(0, 160)}`));
  page.on("dialog", (d) => d.accept());
  await go(page, "/login");
  await page.fill("#email", email); await page.fill("#password", PASSWORD); await page.click("button[type=submit]");
  await page.waitForURL((u) => u.pathname !== "/login", { timeout: 15000 }).catch(() => {});
  await settle(page);
  return page;
}
const noOverflow = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const main = async (p) => (await p.textContent("main")) ?? "";

const adminLocale = sql(`select locale from "User" where email='superadmin@firingi.test'`);
sql(`update "User" set locale='en' where email='superadmin@firingi.test'`);
let routeId = "";
try {
  routeId = setup("add");
  const sa = await login("superadmin@firingi.test");

  // 1. AI Dashboard
  await go(sa, "/admin/ai");
  check("AI Dashboard opens", /AI Dashboard/.test(await main(sa)) && (await sa.getByTestId("aid-kpis").count()) === 1);
  check("six areas shown", (await sa.getByTestId("aid-area").count()) === 6);
  check("route savings found on the dashboard", await until(async () => { const t = await sa.getByTestId("aid-route").textContent(); return /[1-9]/.test(t ?? ""); }, 5000), (await sa.getByTestId("aid-route").textContent())?.slice(0, 80));
  check("top actions listed", (await sa.getByTestId("aid-top-row").count()) > 0);
  check("settings form for admins", (await sa.getByTestId("aic-settings").count()) === 1 && (await sa.getByTestId("aic-fuels").locator("tbody tr").count()) === 5);
  check("menu: the new AI Centre", (await sa.locator('aside a[href="/admin/ai/forecasting"]').count()) >= 1 && (await sa.locator('aside a[href="/admin/ai/reports"]').count()) >= 1);
  await shot(sa, "01-ai-dashboard", true);

  // 2. Recommendations: the route in a zig-zag order
  await go(sa, "/admin/ai/recommendations?area=ROUTES");
  check("area tabs", (await sa.getByTestId("rec-areas").locator("a").count()) === 7);
  const ins = sa.getByTestId("ins-routes").locator("tr", { hasText: "RT-AIC-E2E" });
  check("shorter route with km, fuel, € and CO₂", (await ins.count()) === 1 && /km/.test(await ins.textContent()) && /kg/.test(await ins.textContent()), (await ins.textContent().catch(() => ""))?.slice(0, 120));
  const rec = sa.getByTestId("rec-row").filter({ hasText: "RT-AIC-E2E" }).first();
  check("suggestion to use the shorter order", (await rec.count()) === 1 && (await rec.getByRole("button", { name: "Use the shorter order" }).count()) === 1);
  await shot(sa, "02-recommendations-routes", true);
  const kmBefore = Number(sql(`select "plannedKm" from "Route" where id='${routeId}'`));
  const order0 = sql(`select string_agg(label, ',' order by sequence) from "RouteStop" where "routeId"='${routeId}'`);
  await rec.getByRole("button", { name: "Use the shorter order" }).click();
  check("stops put in the shorter order", await until(async () => sql(`select string_agg(label, ',' order by sequence) from "RouteStop" where "routeId"='${routeId}'`) !== order0), sql(`select string_agg(label, ',' order by sequence) from "RouteStop" where "routeId"='${routeId}'`));
  check("route shorter now", Number(sql(`select "plannedKm" from "Route" where id='${routeId}'`)) < (kmBefore || 9999));
  for (const [area, id] of [["SALES", "ins-sales"], ["PRICING", "ins-pricing"], ["SUPPLIERS", "ins-suppliers"], ["STOCK", "ins-stock"], ["CUSTOMERS", "ins-reorders"]]) {
    await go(sa, `/admin/ai/recommendations?area=${area}`);
    check(`${area.toLowerCase()} area with its detail table`, (await sa.getByTestId(id).count()) === 1 && (await sa.getByTestId("rec-area-hint").count()) === 1);
  }
  await go(sa, "/admin/ai/recommendations?area=CUSTOMERS");
  await shot(sa, "03-recommendations-customers", true);

  // 3. Forecasting: six tabs
  for (const [tab, id] of [["DEMAND", "fc-demand"], ["SALES", "fc-sales"], ["ORDERS", "fc-orders"], ["INVENTORY", "fc-inventory"], ["CASH", "fc-cash"], ["DELIVERY", "fc-kpis"]]) {
    await go(sa, `/admin/ai/forecasting?tab=${tab}`);
    check(`forecast: ${tab.toLowerCase()}`, (await sa.getByTestId(id).count()) === 1 && (await sa.getByTestId("fc-tabs").locator("a").count()) === 6);
    if (tab === "SALES") await shot(sa, "04-forecast-sales", true);
    if (tab === "CASH") await shot(sa, "05-forecast-cash", true);
  }

  // 4. AI Reports: seven tabs, PDF, CSV, history
  for (const tab of ["EXECUTIVE", "SALES", "SUPPLIER", "STOCK", "FINANCE", "DELIVERY_RISK", "FRAUD"]) {
    await go(sa, `/admin/ai/reports?tab=${tab}`);
    check(`report: ${tab.toLowerCase()}`, (await sa.getByTestId("rep-summary").count()) === 1 && (await sa.getByTestId("rep-kpis").locator("> div").count()) > 0);
    if (tab === "EXECUTIVE") await shot(sa, "06-report-executive", true);
  }
  await go(sa, "/admin/ai/reports?tab=EXECUTIVE");
  const pdf = await sa.request.get(`${BASE}${await sa.getByTestId("rep-pdf").getAttribute("href")}`);
  check("report as PDF", pdf.status() === 200 && (pdf.headers()["content-type"] ?? "").includes("application/pdf") && (await pdf.body()).length > 2000);
  const csv = await sa.request.get(`${BASE}${await sa.getByTestId("rep-csv").getAttribute("href")}`);
  check("report as CSV", csv.status() === 200 && /Executive report/.test(await csv.text()));
  await sa.getByTestId("air-generate").click();
  check("made again: two in the history", await until(async () => { await go(sa, "/admin/ai/reports?tab=EXECUTIVE"); return (await sa.getByTestId("rep-history").locator("li").count()) >= 2; }));
  await go(sa, "/admin/ai/reports?tab=SALES&days=30");
  check("30-day period", /30 days/.test(await main(sa)) && /report for/.test(await sa.getByTestId("rep-summary").textContent()));

  // 5. Old addresses lead to the new pages
  for (const [old, now] of [["/admin/ai/demand-forecasting", "/admin/ai/forecasting"], ["/admin/ai/fraud-alerts", "/admin/ai/reports"], ["/admin/ai/route-optimization", "/admin/ai/recommendations"], ["/admin/ai/reorder-predictions", "/admin/ai/recommendations"]]) {
    await go(sa, old);
    check(`${old} → ${now}`, new URL(sa.url()).pathname === now, sa.url());
  }

  // 6. FIRINGI switches an area off
  await go(sa, "/admin/ai");
  await sa.getByTestId("aic-area-PRICING").uncheck();
  await sa.getByTestId("aic-save").click();
  check("area switched off", await until(async () => sql(`select value->'areas'->>'PRICING' from "Setting" where key='ai.centre'`) === "false"));
  await go(sa, "/admin/ai/recommendations");
  check("switched-off area gone from the tabs", (await sa.getByTestId("rec-areas").locator('a[data-tab="PRICING"]').count()) === 0);

  // 7. Who sees it: staff without the AI right are blocked
  const support = await login("support@firingi.test");
  await go(support, "/admin/ai/reports");
  check("support (no AI right) is blocked", support.url().endsWith("/forbidden"), support.url());

  // 8. phone, dark
  const ph = await login("superadmin@firingi.test", { viewport: { width: 390, height: 844 }, colorScheme: "dark", isMobile: true, hasTouch: true });
  for (const [u, n] of [["/admin/ai", "dashboard"], ["/admin/ai/recommendations?area=ROUTES", "recommendations"], ["/admin/ai/reports?tab=EXECUTIVE", "reports"]]) {
    await go(ph, u);
    check(`${n} fits the phone (dark)`, await noOverflow(ph));
  }
  await go(ph, "/admin/ai");
  await shot(ph, "07-dashboard-phone-dark", true);
  check("no page errors", errors.length === 0, errors.join(" | "));
} catch (e) {
  console.log("✘ crashed —", e.message.split("\n")[0]); failures++;
} finally {
  try { setup("remove"); } catch { /* ignore */ }
  sql(`update "User" set locale=${adminLocale ? `'${adminLocale}'` : "NULL"} where email='superadmin@firingi.test'`);
  await browser.close();
}
console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll AI Centre checks passed");
process.exit(failures ? 1 : 0);
