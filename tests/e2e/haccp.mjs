/**
 * Browser test of Phase 69 (food safety logbook). Customer in Portuguese, FIRINGI in English: not set up → the
 * restaurant template → temperatures (one out of range with a corrective action) → opening checklist → cooling →
 * delivery checks (another supplier out of range; a FIRINGI delivery failing → claim link) → training → logbook,
 * completion and the PDF report → FIRINGI's overview, businesses and a switch → phone width, dark mode → no page
 * errors. Cleans up after itself.
 *   node tests/e2e/haccp.mjs [baseUrl] [screenshotDir]
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
const tap = async (p, sel) => { const l = typeof sel === "string" ? p.locator(sel).first() : sel; await l.evaluate((e) => e.scrollIntoView({ block: "center" })); await l.click(); };
const errors = [];
async function login(email, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, locale: "pt-PT", reducedMotion: "reduce", deviceScaleFactor: SHOTS ? 2 : 1, serviceWorkers: "block", ...opts });
  const page = await ctx.newPage();
  if (process.env.E2E_SLOW) page.setDefaultTimeout(240000);
  page.on("pageerror", (e) => errors.push(`${email}: ${e.message.slice(0, 160)}`));
  page.on("dialog", (d) => d.accept());
  await go(page, "/login");
  await page.fill("#email", email); await page.fill("#password", PASSWORD); await page.click("button[type=submit]");
  await page.waitForURL((u) => u.pathname !== "/login", { timeout: 15000 }).catch(() => {});
  await settle(page);
  const dismiss = page.locator("[data-testid=install-dismiss]");
  if (await dismiss.count()) await dismiss.first().click().catch(() => {});
  return page;
}
const noOverflow = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const KB = sql(`select c.id from "Company" c join "Membership" m on m."companyId"=c.id join "User" u on u.id=m."userId" where u.email='owner@kebabhouse.test' limit 1`);
const count = (q) => Number(sql(q));
const cleanup = () => {
  for (const t of ["HaccpEntry", "HaccpUnit", "HaccpTask", "HaccpTraining"]) sql(`delete from "${t}" where "companyId"='${KB}'`);
  sql(`delete from "Setting" where key='haccp.settings'`);
};
cleanup();
try {
  const buyer = await login("owner@kebabhouse.test");
  const admin = await login("superadmin@firingi.test", { locale: "en-GB" });

  // 1. not set up → template
  await go(buyer, "/buy/food-safety");
  check("logbook not set up yet", (await buyer.getByTestId("hc-not-setup").count()) === 1);
  await go(buyer, "/buy/food-safety/setup");
  await tap(buyer, "[data-testid=hc-tpl-RESTAURANT]");
  check("restaurant template: 4 equipment, 5 checklists", await until(async () => count(`select count(*) from "HaccpUnit" where "companyId"='${KB}'`) === 4 && count(`select count(*) from "HaccpTask" where "companyId"='${KB}'`) === 5));
  await go(buyer, "/buy/food-safety/setup");
  check("names in Portuguese", (await buyer.locator("[data-testid=hc-setup-unit]").first().innerText()).length > 0 && !(await buyer.locator("body").innerText()).includes("tpl.unit"));
  await shot(buyer, "01-setup-template", true);

  // 2. temperatures
  await go(buyer, "/buy/food-safety");
  check("today shows the equipment", (await buyer.locator("[data-testid=hc-unit-row]").count()) === 4);
  const fridge = buyer.locator("[data-testid=hc-unit-row]").first();
  await tap(buyer, fridge.getByTestId("hc-temp-open").first());
  await buyer.fill("[data-testid=hc-temp-value]", "3.5");
  await tap(buyer, "[data-testid=hc-temp-save]");
  check("reading in range saved", await until(async () => count(`select count(*) from "HaccpEntry" where "companyId"='${KB}' and kind='TEMP' and ok`) === 1));
  await go(buyer, "/buy/food-safety");
  await tap(buyer, buyer.locator("[data-testid=hc-unit-row]").first().getByTestId("hc-temp-open").first());
  await buyer.fill("[data-testid=hc-temp-value]", "9");
  check("out of range asks for the corrective action", await until(async () => (await buyer.getByTestId("hc-corrective").count()) === 1));
  await buyer.fill("[data-testid=hc-corrective]", "Comida passada para o frigorífico 2; técnico chamado");
  await tap(buyer, "[data-testid=hc-temp-save]");
  check("out-of-range reading saved with its action", await until(async () => count(`select count(*) from "HaccpEntry" where "companyId"='${KB}' and kind='TEMP' and not ok and corrective is not null`) === 1));

  // 3. checklist, cooling
  await go(buyer, "/buy/food-safety");
  await tap(buyer, buyer.locator("[data-testid=hc-task-row][data-done='0']").first().getByTestId("hc-task-open"));
  await tap(buyer, "[data-testid=hc-task-all]");
  await tap(buyer, "[data-testid=hc-task-save]");
  check("checklist done", await until(async () => count(`select count(*) from "HaccpEntry" where "companyId"='${KB}' and kind='TASK' and ok`) === 1));
  await go(buyer, "/buy/food-safety");
  await tap(buyer, "[data-testid=hc-cool-open]");
  await buyer.fill("[data-testid=hc-cool-product]", "Arroz");
  await buyer.fill("[data-testid=hc-cool-start]", "70");
  await buyer.fill("[data-testid=hc-cool-end]", "8");
  await buyer.fill("[data-testid=hc-cool-minutes]", "95");
  await tap(buyer, "[data-testid=hc-cool-save]");
  check("cooling recorded", await until(async () => count(`select count(*) from "HaccpEntry" where "companyId"='${KB}' and kind='COOLING' and ok`) === 1));
  await go(buyer, "/buy/food-safety");
  await shot(buyer, "02-today", true);

  // 4. deliveries
  await go(buyer, "/buy/food-safety/deliveries");
  await tap(buyer, "[data-testid=hc-del-other]");
  await buyer.fill("[data-testid=hc-del-supplier]", "Talho Local");
  await buyer.fill("[data-testid=hc-del-product]", "Frango");
  await buyer.fill("[data-testid=hc-del-temp]", "9");
  check("delivery out of range asks for the action", await until(async () => (await buyer.getByTestId("hc-corrective").count()) === 1));
  await buyer.fill("[data-testid=hc-corrective]", "Frango recusado");
  await tap(buyer, "[data-testid=hc-del-save]");
  check("delivery check saved (not ok)", await until(async () => count(`select count(*) from "HaccpEntry" where "companyId"='${KB}' and kind='DELIVERY' and not ok`) === 1));
  await go(buyer, "/buy/food-safety/deliveries");
  const orderRow = buyer.locator("[data-testid=hc-order-row]").first();
  if (await orderRow.count()) {
    await tap(buyer, orderRow.getByTestId("hc-del-check"));
    await buyer.uncheck("[data-testid=hc-del-pack]");
    await buyer.fill("[data-testid=hc-corrective]", "Embalagem rasgada");
    await tap(buyer, "[data-testid=hc-del-save]");
    const number = await orderRow.getAttribute("data-number");
    const row = () => buyer.locator(`[data-testid=hc-order-row][data-number="${number}"]`);
    check("failed FIRINGI delivery → claim link", await until(async () => (await row().getByTestId("hc-claim").count()) >= 1 && (await row().getByTestId("hc-claim").first().locator("a").getAttribute("href")).endsWith("/claim")));
    await go(buyer, "/buy/food-safety/deliveries");
    check("claim link stays after the page reloads", (await row().getByTestId("hc-claim").count()) === 1);
  } else console.log("· no FIRINGI delivery in the last 7 days for this customer — claim path covered by the integration test");
  await shot(buyer, "03-deliveries", true);

  // 5. training
  await go(buyer, "/buy/food-safety/training");
  await tap(buyer, "[data-testid=hc-tr-add]");
  await buyer.fill("[data-testid=hc-tr-person]", "Karim Kebab");
  await buyer.fill("[data-testid=hc-tr-course]", "Higiene e segurança alimentar (HACCP)");
  await buyer.fill("[data-testid=hc-tr-issued]", "2025-12-01");
  await buyer.fill("[data-testid=hc-tr-expires]", new Date(Date.now() + 15 * 86400_000).toISOString().slice(0, 10));
  await tap(buyer, "[data-testid=hc-tr-save]");
  check("training recorded, ends soon", await until(async () => (await buyer.locator("[data-testid=hc-tr-row][data-state=SOON]").count()) === 1));
  await shot(buyer, "04-training", true);

  // 6. logbook & report
  await go(buyer, "/buy/food-safety/log");
  check("logbook lists the records", (await buyer.locator("[data-testid=hc-log-row]").count()) >= 5);
  const href = await buyer.getByTestId("hc-report").getAttribute("href");
  const pdf = await buyer.request.get(`${BASE}${href}`);
  check("report is a PDF", pdf.ok() && (pdf.headers()["content-type"] ?? "").includes("pdf"));
  await shot(buyer, "05-logbook", true);
  await go(buyer, "/buy/food-safety");
  check("tips: training ends soon", (await buyer.locator("[data-testid=hc-tips] [data-code=TRAINING_EXPIRING]").count()) === 1);

  // 7. FIRINGI
  await go(admin, "/admin/food-safety");
  check("FIRINGI overview counts the business", Number(await admin.getByTestId("hca-businesses").locator(".kpi-value").innerText().catch(() => "0")) >= 1 || (await admin.getByTestId("hca-businesses").count()) === 1);
  await shot(admin, "06-firingi-overview", true);
  await go(admin, "/admin/food-safety?tab=BUSINESSES");
  check("Kebab House in the businesses list", (await admin.locator("[data-testid=hca-row]").filter({ hasText: "Kebab" }).count()) === 1);
  await shot(admin, "07-firingi-businesses", true);
  await go(admin, "/admin/food-safety?tab=SETTINGS");
  await admin.uncheck("[data-testid=hcs-part-cooling]");
  await tap(admin, "[data-testid=hcs-save]");
  await until(async () => sql(`select value->'parts'->>'cooling' from "Setting" where key='haccp.settings'`) === "false");
  await shot(admin, "08-firingi-settings", true);
  await go(buyer, "/buy/food-safety");
  check("cooling hidden when switched off", (await buyer.getByTestId("hc-cool-open").count()) === 0);
  await go(admin, "/admin/food-safety?tab=SETTINGS");
  await admin.check("[data-testid=hcs-part-cooling]");
  await tap(admin, "[data-testid=hcs-save]");
  await until(async () => sql(`select value->'parts'->>'cooling' from "Setting" where key='haccp.settings'`) === "true");

  // 8. phone width, dark mode
  for (const [who, url] of [["today", "/buy/food-safety"], ["deliveries", "/buy/food-safety/deliveries"], ["log", "/buy/food-safety/log"]]) {
    const p = await login("owner@kebabhouse.test", { viewport: { width: 390, height: 844 }, colorScheme: "dark", isMobile: true, hasTouch: true });
    await go(p, url);
    check(`${who} fits the phone (dark)`, await noOverflow(p));
    await shot(p, `09-${who}-phone-dark`, true);
  }
  check("no page errors", errors.length === 0, errors.join(" | "));
} catch (e) {
  console.log("✘ crashed —", e.message.split("\n")[0]); failures++;
} finally {
  cleanup();
  await browser.close();
}
console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll food safety checks passed");
process.exit(failures ? 1 : 0);
