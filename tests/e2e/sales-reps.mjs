/**
 * Browser test of Phase 62 (sales reps). Supplier, rep and customer in Portuguese, FIRINGI in English:
 * the owner makes a company user a rep (commission, target), assigns Kebab House and plans today's visit → the rep (phone)
 * sees the visit, checks in (location), takes an order at the customer's prices → it waits → the customer confirms it →
 * order placed → the rep finishes the visit (outcome, note, photo) → the customer lets the reps order directly → the rep's
 * next order is placed at once → the manager sees the map, the visit, the photo, the results and the CSV → FIRINGI's
 * overview and switch (off hides the rep pages) → phone width, dark mode → no page errors. Cleans up after itself.
 *   node tests/e2e/sales-reps.mjs [baseUrl] [screenshotDir]
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
const setup = (a) => JSON.parse(execFileSync("npx", ["tsx", "--require", "./tests/e2e/setup/no-server-only.cjs", "tests/e2e/setup/sr-setup.ts", a], { encoding: "utf8", env: { ...process.env, DATABASE_URL: DB } }).trim().split("\n").pop());
const errors = [];
async function login(email, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, locale: "pt-PT", reducedMotion: "reduce", deviceScaleFactor: SHOTS ? 2 : 1, serviceWorkers: "block", ...opts });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${email}: ${e.message.slice(0, 160)}`));
  page.on("dialog", (d) => d.accept());
  await go(page, "/login");
  await page.fill("#email", email); await page.fill("#password", PASSWORD); await page.click("button[type=submit]");
  await page.waitForURL((u) => u.pathname !== "/login", { timeout: 15000 }).catch(() => {});
  await settle(page);
  return page;
}
const noOverflow = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

const ids = setup("add");
const REP_EMAIL = "rep.e2e@lisboacentral.test";
const today = new Date().toISOString().slice(0, 10);
try {
  const vendor = await login("owner@lisboacentral.test");
  const admin = await login("superadmin@firingi.test", { locale: "en-GB" });
  const buyer = await login("owner@kebabhouse.test");

  // 1. the owner makes the user a rep
  await go(vendor, "/vendor/reps");
  check("sales team page opens", (await vendor.title()).length > 0 && await vendor.locator("[data-testid=rep-add-form]").isVisible());
  const opt = await vendor.locator("[data-testid=rep-user] option", { hasText: REP_EMAIL }).getAttribute("value");
  await vendor.selectOption("[data-testid=rep-user]", opt);
  await vendor.fill("[data-testid=rep-add-form] [data-testid=rep-pct]", "3");
  await vendor.fill("[data-testid=rep-add-form] [data-testid=rep-target]", "5000");
  await vendor.click("[data-testid=rep-add-form] [data-testid=rep-save]");
  check("rep added", await until(async () => (await vendor.locator("[data-testid=sr-rep]", { hasText: "Rita Vendas" }).count()) === 1));
  check("rep got the Sales Rep role", sql(`select count(*) from "MembershipRole" mr join "Role" r on r.id=mr."roleId" join "Membership" m on m.id=mr."membershipId" where m."userId"='${ids.userId}' and r.key='VENDOR_REP'`) === "1");
  await shot(vendor, "sr-01-team");

  // 2. assign Kebab House (search finds it)
  await go(vendor, "/vendor/reps/customers?q=Kebab");
  const row = vendor.locator("[data-testid=sr-customer]").first();
  check("customer found by name", (await row.count()) === 1);
  const repId = sql(`select id from "SalesRep" where "userId"='${ids.userId}'`);
  await row.locator("[data-testid=assign-rep]").selectOption(repId);
  check("customer assigned", await until(async () => sql(`select "repId" from "RepAssignment" where "buyerCompanyId"='${ids.kb}' and "vendorCompanyId"='${ids.lx}'`) === repId));
  await shot(vendor, "sr-02-customers");

  // 3. plan today's visit
  await go(vendor, "/vendor/reps/visits");
  await vendor.selectOption("[data-testid=pv-rep]", repId);
  await vendor.selectOption("[data-testid=pv-customer]", ids.kb);
  await vendor.fill("[data-testid=pv-date]", today);
  await vendor.click("[data-testid=pv-save]");
  check("visit planned", await until(async () => (await vendor.locator("[data-testid=sv-visit]").count()) === 1));

  // 4. the rep on the phone: my day → check in → take order
  const rep = await login(REP_EMAIL, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, geolocation: { latitude: 38.7371, longitude: -9.1427 }, permissions: ["geolocation"] });
  await go(rep, "/vendor/reps/my-day");
  check("rep sees today's visit", (await rep.locator("[data-testid=md-visit]", { hasText: "Kebab" }).count()) === 1);
  check("month progress shown", await rep.locator("[data-testid=md-month]").isVisible());
  await rep.click("[data-testid=md-visit] [data-testid=rep-checkin]");
  check("checked in with the location", await until(async () => sql(`select count(*) from "RepVisit" where "repId"='${repId}' and "checkInAt" is not null and latitude is not null`) === "1"));
  check("rep page fits the phone", await noOverflow(rep));
  await shot(rep, "sr-03-rep-my-day", true);
  await rep.click("[data-testid=md-visit] [data-testid=visit-order]");
  await settle(rep);
  check("customer card opens", await rep.locator("[data-testid=order-taker]").isVisible());
  check("customer confirms (no direct ordering yet)", (await rep.locator("[data-testid=order-mode]").getAttribute("data-auto")) === "false");
  await rep.fill("[data-testid=rep-product-search]", "GRO-ARROZ1");
  await rep.keyboard.press("Enter");
  check("products at the customer's prices", await until(async () => (await rep.locator("[data-testid=rep-add-product]").count()) > 0));
  await rep.locator("[data-testid=rep-add-product]").first().click();
  await rep.fill("[data-testid=rep-line-qty]", "10");
  await shot(rep, "sr-04-rep-take-order", true);
  await rep.click("[data-testid=rep-send]");
  check("order sent to the customer", await until(async () => (await rep.locator("[data-testid=rep-result]").getAttribute("data-status")) === "PENDING"));
  check("rep order waiting", sql(`select status from "RepOrder" where "repId"='${repId}' order by "createdAt" desc limit 1`) === "PENDING");

  // 5. the customer confirms
  await go(buyer, "/buy/orders/rep-orders");
  check("customer sees the rep's order", (await buyer.locator("[data-testid=ro-card]").count()) === 1);
  check("customer's prices shown", /\d/.test(await buyer.locator("[data-testid=ro-total]").innerText()));
  await shot(buyer, "sr-05-customer-confirm", true);
  await buyer.click("[data-testid=ro-confirm]");
  check("order placed on confirm", await until(async () => sql(`select status from "RepOrder" where "repId"='${repId}' order by "createdAt" desc limit 1`) === "PLACED"));
  await go(buyer, "/buy/orders/rep-orders");
  check("customer sees it placed", (await buyer.locator("[data-testid=ro-done][data-status=PLACED]").count()) === 1);
  check("the order carries the rep", sql(`select count(*) from "Order" o where o."salesRepId"='${repId}' and o."buyerCompanyId"='${ids.kb}'`) === "1");

  // 6. the rep finishes the visit: outcome, note, photo
  await go(rep, "/vendor/reps/my-day");
  const pic = await (async () => { const p = await browser.newPage({ viewport: { width: 320, height: 240 } }); await p.setContent(`<body style="margin:0;background:linear-gradient(135deg,#0d9488,#0ea5e9);height:240px;font:bold 40px sans-serif;color:#fff;display:grid;place-items:center">Montra</body>`); const b = await p.screenshot({ type: "png" }); await p.close(); return b; })();
  await rep.setInputFiles("[data-testid=visit-photo-input]", { name: "shelf.png", mimeType: "image/png", buffer: pic });
  check("photo added", await until(async () => sql(`select coalesce(array_length("photoKeys",1),0) from "RepVisit" where "repId"='${repId}'`) === "1"));
  await rep.click("[data-testid=visit-finish-open]");
  await rep.click("[data-testid=visit-outcome][value=ORDER]");
  await rep.fill("[data-testid=visit-note]", "Pediu também azeite para a próxima semana.");
  await rep.click("[data-testid=visit-finish]");
  check("visit done", await until(async () => sql(`select status||'/'||coalesce(outcome::text,'') from "RepVisit" where "repId"='${repId}'`) === "DONE/ORDER"));

  // 7. the customer lets the reps order directly → next order placed at once
  await go(buyer, "/buy/orders/rep-orders");
  await buyer.click("[data-testid=ro-auto]");
  check("direct ordering on", await until(async () => sql(`select "autoConfirm" from "RepOrderPreference" where "buyerCompanyId"='${ids.kb}' and "vendorCompanyId"='${ids.lx}'`) === "t"));
  await go(rep, `/vendor/reps/my-customers/${ids.kb}`);
  check("card says the order is placed directly", (await rep.locator("[data-testid=order-mode]").getAttribute("data-auto")) === "true");
  await rep.fill("[data-testid=rep-product-search]", "GRO-ARROZ1");
  await rep.keyboard.press("Enter");
  await until(async () => (await rep.locator("[data-testid=rep-add-product]").count()) > 0);
  await rep.locator("[data-testid=rep-add-product]").first().click();
  await rep.fill("[data-testid=rep-line-qty]", "10");
  await rep.click("[data-testid=rep-send]");
  check("placed at once", await until(async () => (await rep.locator("[data-testid=rep-result]").getAttribute("data-status")) === "PLACED"));
  await go(rep, "/vendor/reps/my-orders");
  check("orders I took: 2 placed", (await rep.locator("[data-testid=mo-row][data-status=PLACED]").count()) === 2);
  await shot(rep, "sr-06-rep-orders", true);

  // 8. the manager: map, visit with photo, results, CSV
  await go(vendor, "/vendor/reps/visits");
  check("map drawn", await vendor.locator("[data-testid=route-map]").isVisible());
  check("visit done with the photo", (await vendor.locator("[data-testid=sv-visit] [data-testid=visit-status][data-status=DONE]").count()) === 1 && (await vendor.locator("[data-testid=sv-visit] img").count()) === 1);
  const img = await vendor.locator("[data-testid=sv-visit] img").first().getAttribute("src");
  check("photo served to the manager", (await vendor.request.get(`${BASE}${img}`)).status() === 200);
  check("photo hidden from the customer", (await buyer.request.get(`${BASE}${img}`)).status() === 404);
  await shot(vendor, "sr-07-visit-map", true);
  await go(vendor, "/vendor/reps");
  check("results: 2 orders taken", (await vendor.locator("[data-testid=sr-rep-taken]").first().innerText()).trim() === "2");
  const csv = await vendor.request.get(`${BASE}/api/salesreps/results`);
  check("results CSV", csv.status() === 200 && (await csv.text()).includes("Rita Vendas"));
  check("customer can't read the results", (await buyer.request.get(`${BASE}/api/salesreps/results`)).status() === 403);

  // 9. FIRINGI: overview + switch
  await go(admin, "/admin/vendors/sales-reps");
  check("FIRINGI overview lists the rep", (await admin.locator("[data-testid=asr-reps]", { hasText: "Rita Vendas" }).count()) === 1);
  await shot(admin, "sr-08-admin", true);
  await admin.click("[data-testid=srs-enabled]");
  await admin.click("[data-testid=srs-save]");
  await until(async () => sql(`select value->>'enabled' from "Setting" where key='salesreps.settings'`) === "false");
  await go(rep, "/vendor/reps/my-day");
  check("switched off: page says so", await rep.locator("[data-testid=sr-off]").isVisible());
  check("switched off: rep pages out of the menu", (await rep.locator('a[href="/vendor/reps/my-day"]').count()) === 0);
  await go(admin, "/admin/vendors/sales-reps");
  await admin.click("[data-testid=srs-enabled]");
  await admin.click("[data-testid=srs-save]");
  await until(async () => sql(`select value->>'enabled' from "Setting" where key='salesreps.settings'`) === "true");

  // 10. dark mode + phone for the customer
  const dark = await login("owner@kebabhouse.test", { viewport: { width: 390, height: 844 }, isMobile: true, colorScheme: "dark" });
  await go(dark, "/buy/orders/rep-orders");
  check("customer page fits the phone (dark)", await noOverflow(dark));
  await shot(dark, "sr-09-customer-dark-phone", true);
} finally {
  sql(`update "RepOrderPreference" set "autoConfirm"=false where "vendorCompanyId"='${ids.lx}'`);
  setup("remove");
  await browser.close();
}
check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
