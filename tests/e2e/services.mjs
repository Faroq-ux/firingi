/**
 * Browser test of Phase 68 (Services & used cooking oil). Supplier and customer in Portuguese, FIRINGI in English:
 * a distributor offers oil collection and pest control → FIRINGI approves (pest: the provider invoices, 20 %
 * commission) and adds a service to the catalogue → the restaurant takes pest control every month and oil "when
 * requested" → logs two oil changes, the containers fill and a collection is asked for by itself → the provider
 * confirms and records it (litres, signature, e-GAR) and a pest visit with its own invoice number → the customer's
 * history and PDF → FIRINGI's Money tab (buy-back paid, commission invoiced) → a switch hides Fryers & Oil → phone
 * width, dark mode → no page errors. Cleans up after itself.
 *   node tests/e2e/services.mjs [baseUrl] [screenshotDir]
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
const idOf = (email) => sql(`select c.id from "Company" c join "Membership" m on m."companyId"=c.id join "User" u on u.id=m."userId" where u.email='${email}' limit 1`);
const AT = idOf("owner@atlantico.test"), KB = idOf("owner@kebabhouse.test");
const today = new Date().toISOString().slice(0, 10);
const cleanup = () => {
  sql(`delete from "FryerLog" where "companyId"='${KB}'`); sql(`delete from "Fryer" where "companyId"='${KB}'`);
  sql(`delete from "ServiceVisit" where "customerCompanyId"='${KB}'`); sql(`delete from "ServicePlan" where "customerCompanyId"='${KB}'`);
  sql(`delete from "ServiceProvider" where "companyId"='${AT}'`);
  sql(`delete from "ServiceType" where code='DRAIN_E2E'`);
  sql(`delete from "Setting" where key='services.settings'`);
};
cleanup();
try {
  const vendor = await login("owner@atlantico.test");
  const admin = await login("superadmin@firingi.test", { locale: "en-GB" });
  const buyer = await login("owner@kebabhouse.test");

  // 1. the distributor offers two services
  await go(vendor, "/vendor/services");
  check("supplier page opens, no services yet", (await vendor.locator("[data-testid=pv-none]").count()) === 1);
  const typeId = (code) => sql(`select id from "ServiceType" where code='${code}'`);
  for (const [code, lic] of [["OIL_COLLECTION", "APA-2026-77"], ["PEST_CONTROL", "DGAV-123"]]) {
    await vendor.selectOption("[data-testid=pv-apply-service]", typeId(code));
    await vendor.fill("[data-testid=pv-licence]", lic);
    await vendor.fill("[data-testid=pv-licence-until]", "2028-12-31");
    await tap(vendor, "[data-testid=pv-apply]");
    await until(async () => sql(`select count(*) from "ServiceProvider" where "companyId"='${AT}' and "serviceTypeId"='${typeId(code)}'`) === "1");
    await go(vendor, "/vendor/services");
  }
  check("two applications waiting for FIRINGI", (await vendor.locator("[data-testid=pv-provider-row][data-status=PENDING]").count()) === 2);
  await shot(vendor, "01-supplier-applies", true);

  // 2. FIRINGI approves; pest: the provider invoices, 20 % commission
  await go(admin, "/admin/services?tab=PROVIDERS");
  check("applications on the Providers tab", (await admin.locator("[data-testid=svp-row][data-status=PENDING]").count()) === 2);
  for (const [svc, pct] of [["Used cooking oil", null], ["Pest control", "20"]]) {
    const row = admin.locator("[data-testid=svp-row][data-status=PENDING]").filter({ hasText: svc }).first();
    await tap(admin, row.getByTestId("svp-decide"));
    if (pct) await row.getByTestId("svp-pct").fill(pct);
    await tap(admin, row.getByTestId("svp-approve"));
    await until(async () => sql(`select status from "ServiceProvider" where "companyId"='${AT}' and "serviceTypeId"='${typeId(svc === "Pest control" ? "PEST_CONTROL" : "OIL_COLLECTION")}'`) === "APPROVED");
    await go(admin, "/admin/services?tab=PROVIDERS");
  }
  check("both approved, pest commission 20 %", sql(`select count(*) from "ServiceProvider" where "companyId"='${AT}' and status='APPROVED'`) === "2" && sql(`select "commissionPct" from "ServiceProvider" where "companyId"='${AT}' and "serviceTypeId"='${typeId("PEST_CONTROL")}'`).startsWith("20"));
  await shot(admin, "02-firingi-providers", true);

  // 3. FIRINGI adds a service (provider invoices, commission only)
  await go(admin, "/admin/services?tab=CATALOGUE");
  check("built-in services in the catalogue", (await admin.locator("[data-testid=svt-row]").count()) >= 4);
  await tap(admin, "[data-testid=svt-new]");
  await admin.fill("[data-testid=svt-code]", "DRAIN_E2E");
  await admin.fill("[data-testid=svt-name]", "Drain cleaning");
  await admin.check("[data-testid=svt-by-PROVIDER]");
  await admin.fill("[data-testid=svt-fee]", "80");
  await admin.fill("[data-testid=svt-comm-pct]", "10");
  await tap(admin, "[data-testid=svt-save]");
  check("new service saved, the provider invoices", await until(async () => sql(`select "invoicedBy" || ':' || "commissionPct"::int from "ServiceType" where code='DRAIN_E2E'`) === "PROVIDER:10"));
  await go(admin, "/admin/services?tab=CATALOGUE");
  await shot(admin, "03-firingi-catalogue", true);

  // 4. the restaurant takes pest control monthly and oil "when requested"
  await go(buyer, "/buy/services");
  check("customer sees the services", (await buyer.locator("[data-testid=sv-type]").count()) >= 4);
  await tap(buyer, "[data-testid=sv-take-PEST_CONTROL]");
  await buyer.selectOption("[data-testid=sv-freq]", "MONTHLY");
  await buyer.fill("[data-testid=sv-daya]", "10");
  await tap(buyer, "[data-testid=sv-save]");
  check("pest plan made, visits planned", await until(async () => Number(sql(`select count(*) from "ServiceVisit" v join "ServicePlan" p on p.id=v."planId" where p."customerCompanyId"='${KB}' and p."serviceTypeId"='${typeId("PEST_CONTROL")}'`)) >= 1));
  await go(buyer, "/buy/services");
  await tap(buyer, "[data-testid=sv-take-OIL_COLLECTION]");
  await buyer.selectOption("[data-testid=sv-freq]", "ON_REQUEST");
  await buyer.fill("[data-testid=sv-containers]", "2");
  await buyer.fill("[data-testid=sv-litres]", "50");
  await tap(buyer, "[data-testid=sv-save]");
  await until(async () => sql(`select count(*) from "ServicePlan" where "customerCompanyId"='${KB}'`) === "2");
  await go(buyer, "/buy/services");
  check("two plans", (await buyer.locator("[data-testid=sv-plan-row]").count()) === 2);
  const seen = await buyer.locator("body").innerText();
  check("no commission or provider amounts on the customer page", !/commission|comiss/i.test(seen) && !seen.includes("0,05"));
  await shot(buyer, "04-customer-services", true);

  // 5. fryers: two oil changes fill the containers → a collection is asked for by itself
  await go(buyer, "/buy/services/oil");
  await tap(buyer, "[data-testid=oil-add]");
  await buyer.fill("[data-testid=oil-name]", "Fritadeira 1");
  await buyer.fill("[data-testid=oil-cap]", "25");
  await buyer.fill("[data-testid=oil-cost]", "2.10");
  await tap(buyer, "[data-testid=oil-save]");
  await until(async () => (await buyer.locator("[data-testid=oil-fryer-row]").count()) === 1);
  for (const l of ["50", "40"]) {
    await tap(buyer, "[data-testid=oil-log]");
    await buyer.selectOption("[data-testid=oil-kind]", "CHANGE");
    await buyer.fill("[data-testid=oil-litres]", l);
    await tap(buyer, "[data-testid=oil-log-save]");
    await until(async () => (await buyer.locator("[data-testid=oil-log-row]").count()) === (l === "50" ? 1 : 2));
  }
  check("collection asked for by itself", await until(async () => sql(`select "requestReason" from "ServiceVisit" where "customerCompanyId"='${KB}' and origin='REQUESTED'`) === "CONTAINER_FULL"));
  await go(buyer, "/buy/services/oil");
  check("containers 90 % full, tip shown", (await buyer.getByTestId("oil-storage").innerText()).includes("90%") && (await buyer.locator("[data-testid=oil-insights] [data-code=FULL]").count()) === 1);
  await shot(buyer, "05-customer-fryers-oil", true);

  // 6. the provider confirms and records the collection; a pest visit with its own invoice
  await go(vendor, "/vendor/services");
  const req = vendor.locator("[data-testid=pv-requests] [data-testid=pv-visit-row]").first();
  check("request reaches the provider", (await req.count()) === 1);
  await shot(vendor, "06-supplier-requests", true);
  await tap(vendor, req.getByTestId("pv-confirm"));
  await until(async () => sql(`select status from "ServiceVisit" where "customerCompanyId"='${KB}' and origin='REQUESTED'`) === "CONFIRMED");
  await go(vendor, "/vendor/services");
  const conf = vendor.locator("[data-testid=pv-upcoming] [data-testid=pv-visit-row][data-status=CONFIRMED]").first();
  await tap(vendor, conf.getByTestId("pv-done"));
  await vendor.fill("[data-testid=pv-qty]", "95");
  await vendor.fill("[data-testid=pv-signed]", "Karim");
  await vendor.fill("[data-testid=pv-doc]", "EGAR-PT-2026-0001");
  await tap(vendor, "[data-testid=pv-done-save]");
  check("collection recorded: FIRINGI invoices, buy-back 19 €, provider 4.75 €", await until(async () => sql(`select status || ':' || "invoicedBy" || ':' || "buybackNet" || ':' || "providerAmount" from "ServiceVisit" where "customerCompanyId"='${KB}' and origin='REQUESTED'`) === "DONE:FIRINGI:19.00:4.75"));
  await go(vendor, "/vendor/services");
  const pest = vendor.locator("[data-testid=pv-upcoming] [data-testid=pv-visit-row]").first();
  await tap(vendor, pest.getByTestId("pv-move"));
  await vendor.fill("[data-testid=sv-move-date]", today);
  await tap(vendor, "[data-testid=sv-move-save]");
  await until(async () => sql(`select count(*) from "ServiceVisit" where "customerCompanyId"='${KB}' and "serviceTypeId"='${typeId("PEST_CONTROL")}' and date='${today}'`) === "1");
  await go(vendor, "/vendor/services");
  const pestToday = vendor.locator("[data-testid=pv-upcoming] [data-testid=pv-visit-row]").first();
  await tap(vendor, pestToday.getByTestId("pv-done"));
  check("provider must give its invoice number", (await vendor.locator("[data-testid=pv-inv]").count()) === 1);
  await vendor.fill("[data-testid=pv-signed]", "Karim");
  await vendor.fill("[data-testid=pv-inv]", "FT 2026/88");
  await tap(vendor, "[data-testid=pv-done-save]");
  check("pest visit: provider invoices, FIRINGI's commission 9 €", await until(async () => sql(`select "invoicedBy" || ':' || "commissionNet" from "ServiceVisit" where "customerCompanyId"='${KB}' and "serviceTypeId"='${typeId("PEST_CONTROL")}' and status='DONE'`) === "PROVIDER:9.00"));
  await go(vendor, "/vendor/services");
  await shot(vendor, "07-supplier-board", true);

  // 7. the customer's history and document
  await go(buyer, "/buy/services");
  check("history shows both visits", (await buyer.locator("[data-testid=sv-history-row][data-status=DONE]").count()) === 2);
  const href = await buyer.locator("[data-testid=sv-doc]").first().getAttribute("href");
  const pdf = await buyer.request.get(`${BASE}${href}`);
  check("visit document is a PDF", pdf.ok() && (pdf.headers()["content-type"] ?? "").includes("pdf"));
  await shot(buyer, "08-customer-history", true);

  // 8. FIRINGI: overview, money (buy-back paid, commission invoiced), visits
  await go(admin, "/admin/services");
  await shot(admin, "09-firingi-overview", true);
  await go(admin, "/admin/services?tab=MONEY");
  check("money tab lists what's open", (await admin.locator("[data-testid=svm-buyback] li").count()) === 1 && (await admin.locator("[data-testid=svm-commission] li").count()) === 1);
  await shot(admin, "10-firingi-money", true);
  await tap(admin, "[data-testid=svm-paid-BUYBACK]");
  check("buy-back recorded as paid", await until(async () => sql(`select count(*) from "ServiceVisit" where "customerCompanyId"='${KB}' and "buybackPaidAt" is not null`) === "1"));
  await go(admin, "/admin/services?tab=MONEY");
  await tap(admin, "[data-testid=svm-invoice]");
  check("commission invoiced to the provider", await until(async () => sql(`select i."recipientCompanyId" from "ServiceVisit" v join "Invoice" i on i.id=v."commissionInvoiceId" where v."customerCompanyId"='${KB}'`) === AT));
  await go(admin, "/admin/services?tab=VISITS");
  check("visits and plans on FIRINGI's page", (await admin.locator("[data-testid=sva-visit-row]").count()) >= 2 && (await admin.locator("[data-testid=sva-plan-row]").count()) >= 2);
  await shot(admin, "11-firingi-visits", true);

  // 9. a switch: Fryers & Oil off → the page goes; back on
  await go(admin, "/admin/services?tab=SETTINGS");
  await admin.uncheck("[data-testid=svs-part-oil]");
  await tap(admin, "[data-testid=svs-save]");
  await until(async () => sql(`select value->'parts'->>'oil' from "Setting" where key='services.settings'`) === "false");
  await shot(admin, "12-firingi-settings", true);
  const off = await go(buyer, "/buy/services/oil");
  check("Fryers & Oil hidden when switched off", off.status() === 404);
  await go(admin, "/admin/services?tab=SETTINGS");
  await admin.check("[data-testid=svs-part-oil]");
  await tap(admin, "[data-testid=svs-save]");
  await until(async () => sql(`select value->'parts'->>'oil' from "Setting" where key='services.settings'`) === "true");

  // 10. phone width, dark mode
  for (const [who, email, url] of [["customer-services", "owner@kebabhouse.test", "/buy/services"], ["customer-oil", "owner@kebabhouse.test", "/buy/services/oil"], ["supplier", "owner@atlantico.test", "/vendor/services"]]) {
    const p = await login(email, { viewport: { width: 390, height: 844 }, colorScheme: "dark", isMobile: true, hasTouch: true });
    await go(p, url);
    check(`${who} page fits the phone (dark)`, await noOverflow(p));
    await shot(p, `13-${who}-phone-dark`, true);
  }
  check("no page errors", errors.length === 0, errors.join(" | "));
} catch (e) {
  console.log("✘ crashed —", e.message.split("\n")[0]); failures++;
} finally {
  cleanup();
  await browser.close();
}
console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll services checks passed");
process.exit(failures ? 1 : 0);
