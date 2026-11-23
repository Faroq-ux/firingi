/**
 * Browser test of Phase 65 (consignment stock). Supplier and customer in Portuguese, FIRINGI in English:
 * the supplier opens a site at Kebab House (customer search) → waiting for FIRINGI → FIRINGI approves → the supplier
 * sends rice → the customer confirms 19 of 20 → the customer counts 12 left → the supplier confirms → FIRINGI's order
 * and invoice → the supplier takes the rest back and closes the site → FIRINGI's page (channels, per-supplier switch)
 * → phone width, dark mode → no page errors. Cleans up after itself.
 *   node tests/e2e/consignment.mjs [baseUrl] [screenshotDir]
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
const LX = idOf("owner@lisboacentral.test"), KB = idOf("owner@kebabhouse.test");
const cleanup = () => {
  const sites = `select id from "ConsignmentSite" where "vendorCompanyId"='${LX}'`;
  sql(`delete from "ConsignmentLot" where "siteId" in (${sites})`); sql(`delete from "ConsignmentShipment" where "siteId" in (${sites})`);
  sql(`delete from "ConsignmentCount" where "siteId" in (${sites})`); sql(`delete from "ConsignmentSite" where "vendorCompanyId"='${LX}'`);
  sql(`delete from "Setting" where key='consignment.settings'`);
};
cleanup();
let siteId = "";
try {
  const vendor = await login("owner@lisboacentral.test");
  const admin = await login("superadmin@firingi.test", { locale: "en-GB" });
  const buyer = await login("owner@kebabhouse.test");
  const row = (p) => p.locator("[data-testid=cs-product]").first();

  // 1. the supplier opens a site at Kebab House
  await go(vendor, "/vendor/consignment");
  check("consignment page opens with no sites", (await vendor.locator("[data-testid=cs-no-sites]").count()) === 1);
  check("menu shows Consignment Stock", (await vendor.locator('a[href="/vendor/consignment"]').count()) >= 1);
  await vendor.fill("[data-testid=cs-customer-search]", "Kebab");
  await vendor.locator("[data-testid=cs-customer-search]").press("Enter");
  await until(async () => (await vendor.locator("[data-testid=cs-pick-customer]").count()) > 0);
  await vendor.locator("[data-testid=cs-pick-customer]").first().click();
  await vendor.fill("[data-testid=cs-every]", "7");
  await shot(vendor, "01-supplier-new-consignment", true);
  await vendor.click("[data-testid=cs-create]");
  await vendor.waitForURL(/\/vendor\/consignment\/[a-z0-9]+$/, { timeout: 30000 }).catch(() => {});
  await settle(vendor);
  siteId = vendor.url().split("/").pop();
  check("site created, waiting for FIRINGI", (await vendor.locator("[data-testid=cs-status]").first().getAttribute("data-status")) === "PENDING" && (await vendor.locator("[data-testid=cs-pending]").count()) === 1);
  check("no sending before approval", (await vendor.locator("[data-testid=cs-send]").count()) === 0);
  check("customer doesn't see a pending site", (await go(buyer, "/buy/orders/consignment"), (await buyer.locator("[data-testid=cs-none]").count()) === 1));

  // 2. FIRINGI approves
  await go(admin, "/admin/vendors/consignment");
  const pending = admin.locator(`[data-testid=csa-pending-row][data-id="${siteId}"]`);
  check("FIRINGI sees it waiting (wholesaler → shop)", (await pending.count()) === 1 && /Wholesaler → shop/.test(await pending.textContent()));
  await shot(admin, "02-firingi-approval", true);
  await pending.locator("[data-testid=csa-approve]").click();
  check("approved", await until(async () => (await admin.locator(`[data-testid=csa-pending-row][data-id="${siteId}"]`).count()) === 0));

  // 3. the supplier sends 20 rice
  await go(vendor, `/vendor/consignment/${siteId}`);
  check("site active", (await vendor.locator("[data-testid=cs-status]").first().getAttribute("data-status")) === "ACTIVE");
  await vendor.fill("[data-testid=cs-product-search]", "GRO-ARROZ1");
  await vendor.locator("[data-testid=cs-product-search]").press("Enter");
  await until(async () => (await vendor.locator("[data-testid=cs-add-product]").count()) > 0);
  await vendor.locator("[data-testid=cs-add-product]").first().click();
  await vendor.fill("[data-testid=cs-send-qty]", "20");
  await vendor.click("[data-testid=cs-send-go]");
  check("delivery sent", await until(async () => (await vendor.locator("[data-testid=cs-sent-ok]").count()) === 1));
  check("on the way to the customer", await until(async () => (await vendor.locator("[data-testid=cs-shipment][data-status=SENT]").count()) === 1));

  // 4. the customer confirms 19 of 20
  await go(buyer, "/buy/orders/consignment");
  check("customer sees the supplier's delivery", (await buyer.locator("[data-testid=cs-shipment][data-status=SENT]").count()) === 1);
  await buyer.fill("[data-testid=cs-receive-qty]", "19");
  await shot(buyer, "03-customer-confirms-delivery", true);
  await tap(buyer, "[data-testid=cs-receive-go]");
  check("19 on the shelf, 1 short", await until(async () => (await row(buyer).getAttribute("data-shelf")) === "19"));
  check("customer doesn't see the supplier's cost", (await buyer.locator("[data-testid=cs-products] th").count()) === 6);

  // 5. the customer counts 12 left
  await buyer.fill("[data-testid=cs-count-qty]", "12");
  await tap(buyer, "[data-testid=cs-count-go]");
  check("count sent, waiting for the supplier", await until(async () => (await buyer.locator("[data-testid=cs-count-row][data-status=SUBMITTED]").count()) === 1));
  await shot(buyer, "04-customer-count", true);

  // 6. the supplier confirms → FIRINGI invoices 7
  await go(vendor, `/vendor/consignment/${siteId}`);
  await tap(vendor, "[data-testid=cs-accept]");
  check("count invoiced", await until(async () => (await vendor.locator("[data-testid=cs-count-row][data-status=INVOICED]").count()) === 1, 40000));
  check("order and invoice shown", await until(async () => (await vendor.locator("[data-testid=cs-billed] a").count()) === 1));
  const order = sql(`select o.status||'|'||o."buyerCompanyId"||'|'||(select sum("qtyDelivered") from "OrderLine" where "orderId"=o.id) from "ConsignmentCount" c join "Order" o on o.id=c."orderId" where c."siteId"='${siteId}' and c.status='INVOICED' limit 1`);
  check("FIRINGI order delivered to Kebab House for 7", order === `DELIVERED|${KB}|7`, order);
  check("FIRINGI invoice to the customer", sql(`select count(*) from "Invoice" i join "ConsignmentCount" c on c."orderId"=i."orderId" where c."siteId"='${siteId}' and i."recipientCompanyId"='${KB}'`) !== "0");
  check("used 7, 12 on the shelf", (await row(vendor).getAttribute("data-used")) === "7" && (await row(vendor).getAttribute("data-shelf")) === "12");
  await shot(vendor, "05-supplier-site", true);
  await go(buyer, "/buy/orders/consignment");
  check("customer sees the invoiced count", (await buyer.locator("[data-testid=cs-count-row][data-status=INVOICED] [data-testid=cs-billed]").count()) === 1);

  // 7. the supplier takes the rest back and closes
  await go(vendor, `/vendor/consignment/${siteId}`);
  await vendor.fill("[data-testid=cs-pickup-qty]", "12");
  await tap(vendor, "[data-testid=cs-pickup-go]");
  check("all taken back", await until(async () => (await row(vendor).getAttribute("data-shelf")) === "0"));
  await tap(vendor, "[data-testid=cs-close]");
  check("site closed", await until(async () => (await vendor.locator("[data-testid=cs-status]").first().getAttribute("data-status")) === "CLOSED"));
  await go(vendor, "/vendor/consignment");
  check("list shows the closed site", (await vendor.locator(`[data-testid=cs-site-row][data-id="${siteId}"][data-status=CLOSED]`).count()) === 1);
  await shot(vendor, "06-supplier-list");

  // 8. FIRINGI's page: channel switch, per-supplier switch
  await go(admin, "/admin/vendors/consignment");
  check("FIRINGI sees the site", (await admin.locator("[data-testid=csa-site]").count()) >= 1);
  await admin.uncheck("[data-testid=csa-ch-WHOLESALER_CUSTOMER]");
  await admin.click("[data-testid=csa-save]");
  check("channel switched off", await until(async () => sql(`select value->'channels'->>'WHOLESALER_CUSTOMER' from "Setting" where key='consignment.settings'`) === "false"));
  await go(vendor, "/vendor/consignment");
  check("supplier told it's off", (await vendor.locator("[data-testid=cs-off]").count()) === 1 && (await vendor.locator("[data-testid=cs-new]").count()) === 0);
  await go(admin, "/admin/vendors/consignment");
  await admin.check("[data-testid=csa-ch-WHOLESALER_CUSTOMER]");
  await admin.click("[data-testid=csa-save]");
  await until(async () => sql(`select value->'channels'->>'WHOLESALER_CUSTOMER' from "Setting" where key='consignment.settings'`) === "true");
  await go(admin, "/admin/vendors/consignment");
  await admin.fill('input[aria-label="Search a supplier"]', "Lisboa Central");
  await admin.locator('input[aria-label="Search a supplier"]').press("Enter");
  await until(async () => (await admin.locator("[data-testid=csa-vendor-switch]").count()) > 0);
  await admin.locator("[data-testid=csa-vendor-switch]").first().click();
  check("supplier switched off", await until(async () => sql(`select value->'disabledVendors' ? '${LX}' from "Setting" where key='consignment.settings'`) === "t"));
  await go(admin, "/admin/vendors/consignment");
  await shot(admin, "07-firingi-page", true);

  // 9. phone width, dark mode
  for (const [who, email, url] of [["customer", "owner@kebabhouse.test", "/buy/orders/consignment"], ["supplier", "owner@lisboacentral.test", `/vendor/consignment/${siteId}`]]) {
    const p = await login(email, { viewport: { width: 390, height: 844 }, colorScheme: "dark", isMobile: true, hasTouch: true });
    await go(p, url);
    check(`${who} page fits the phone (dark)`, await noOverflow(p));
    await shot(p, `08-${who}-phone-dark`, true);
  }
  check("no page errors", errors.length === 0, errors.join(" | "));
} catch (e) {
  console.log("✘ crashed —", e.message.split("\n")[0]); failures++;
} finally {
  cleanup();
  await browser.close();
}
console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll consignment checks passed");
process.exit(failures ? 1 : 0);
