/**
 * Browser test of Phase 63 (van sales). Supplier, seller and customer in Portuguese, FIRINGI in English:
 * the owner opens a van load for the seller, loads rice (it leaves the warehouse) and starts the round → the seller
 * (phone) sells to Kebab House at its prices, cash, signature → FIRINGI order delivered and invoiced, "collect" shows
 * the exact amount → a second sale without signal is kept on the phone and sent when back online (done once) → the
 * seller unloads and counts the cash → the owner sees the closed van → the customer sees its van purchases → FIRINGI's
 * page, per-supplier switch (off hides selling) → phone width, dark mode → no page errors. Cleans up after itself.
 *   node tests/e2e/van-sales.mjs [baseUrl] [screenshotDir]
 */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
const { chromium, devices } = createRequire(import.meta.url)("playwright");

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
const setup = (a) => JSON.parse(execFileSync("npx", ["tsx", "--require", "./tests/e2e/setup/no-server-only.cjs", "tests/e2e/setup/vs-setup.ts", a], { encoding: "utf8", env: { ...process.env, DATABASE_URL: DB } }).trim().split("\n").pop());
const errors = [];
async function login(email, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, locale: "pt-PT", reducedMotion: "reduce", deviceScaleFactor: SHOTS ? 2 : 1, serviceWorkers: "block", ...opts });
  const page = await ctx.newPage();
  if (process.env.E2E_SLOW) page.setDefaultTimeout(240000); // a dev server compiles pages on first visit
  page.on("pageerror", (e) => errors.push(`${email}: ${e.message.slice(0, 160)}`));
  page.on("dialog", (d) => d.accept());
  await go(page, "/login");
  await page.fill("#email", email); await page.fill("#password", PASSWORD); await page.click("button[type=submit]");
  await page.waitForURL((u) => u.pathname !== "/login", { timeout: 15000 }).catch(() => {});
  await settle(page);
  return page;
}
/** Tap on a phone: the element is brought to the middle first (not under the bottom bar or a banner). */
const tap = async (p, sel) => { const l = p.locator(sel).first(); await l.evaluate((e) => e.scrollIntoView({ block: "center" })); await p.waitForTimeout(200); await l.click(); };
const noOverflow = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
async function sign(p) {
  const c = p.locator("[data-testid=vs-signature]");
  await c.evaluate((e) => e.scrollIntoView({ block: "center" })); // not under the phone's install banner
  await p.waitForTimeout(300);
  const b = await c.boundingBox();
  await p.mouse.move(b.x + 20, b.y + 40); await p.mouse.down();
  for (let i = 1; i <= 12; i++) await p.mouse.move(b.x + 20 + i * 18, b.y + 40 + (i % 2 ? 30 : -10));
  await p.mouse.up();
}
const onHand = (ids) => Number(sql(`select "onHand" from "StockLevel" where "offerId"='${ids.rice}' and "addressId"='${ids.wh}'`));

const ids = setup("add");
let loadId = "";
try {
  const vendor = await login("owner@lisboacentral.test");
  const admin = await login("superadmin@firingi.test", { locale: "en-GB" });
  const buyer = await login("owner@kebabhouse.test");
  const phone = { ...devices["iPhone 13"], locale: "pt-PT", reducedMotion: "reduce", serviceWorkers: "block" };
  const seller = await login("van.e2e@lisboacentral.test", phone);

  // 1. the owner opens a load for the seller
  await go(vendor, "/vendor/van");
  check("van sales page opens", await vendor.locator("[data-testid=vl-new]").isVisible());
  await vendor.selectOption("[data-testid=vl-warehouse]", ids.wh);
  await vendor.selectOption("[data-testid=vl-seller]", ids.userId);
  await vendor.click("[data-testid=vl-create]");
  check("load created, its page opens", await until(async () => /\/vendor\/van\/[a-z0-9]+$/.test(new URL(vendor.url()).pathname)));
  await settle(vendor);
  loadId = new URL(vendor.url()).pathname.split("/").pop();
  check("load is being loaded", (await vendor.locator("[data-testid=vl-status]").getAttribute("data-status")) === "OPEN");

  // 2. load rice: it leaves the warehouse
  const before = onHand(ids);
  await vendor.fill("[data-testid=vl-product-search]", "GRO-ARROZ1");
  await vendor.locator("[data-testid=vl-load-goods] button[type=submit]").click();
  const prod = vendor.locator(`[data-testid=vl-product][data-offer="${ids.rice}"]`);
  check("rice found with free stock", await until(async () => (await prod.count()) === 1));
  await prod.locator("[data-testid=vl-qty]").fill("20");
  await prod.locator("[data-testid=vl-add]").click();
  check("rice on the van", await until(async () => (await vendor.locator(`[data-testid=vl-good][data-offer="${ids.rice}"] [data-testid=vl-good-left]`).textContent()) === "20"));
  check("warehouse stock went down by 20", onHand(ids) === before - 20, `${before} → ${onHand(ids)}`);
  await shot(vendor, "vs-01-load");
  await vendor.click("[data-testid=vl-start]");
  check("round started", await until(async () => (await vendor.locator("[data-testid=vl-status]").getAttribute("data-status")) === "ON_ROAD"));

  // 3. the seller sells to Kebab House (phone): cash, signature
  await go(seller, "/vendor/van/sell");
  if (await seller.getByTestId("install-dismiss").isVisible().catch(() => false)) await seller.getByTestId("install-dismiss").click(); // the phone's "install the app" card
  check("seller sees the van", (await seller.locator("[data-testid=vs-van]").count()) === 1);
  await seller.fill("[data-testid=vs-customer-search]", "Kebab");
  await seller.locator("[data-testid=vs-customer-search]").press("Enter");
  check("customer found", await until(async () => (await seller.locator("[data-testid=vs-pick-customer]").count()) > 0));
  await seller.locator("[data-testid=vs-pick-customer]", { hasText: "Kebab" }).first().click();
  const sp = seller.locator(`[data-testid=vs-product][data-offer="${ids.rice}"]`);
  check("rice at the customer's price, 20 on the van", await until(async () => (await sp.count()) === 1 && /20/.test(await sp.textContent())));
  for (let i = 0; i < 3; i++) await sp.locator("[data-testid=vs-plus]").click();
  check("estimate shown", /€/.test(await seller.locator("[data-testid=vs-estimate]").textContent()));
  await tap(seller, "[data-testid=vs-method-CASH]");
  await seller.fill("[data-testid=vs-given]", "50");
  check("change shown", (await seller.locator("[data-testid=vs-change]").count()) === 1);
  await seller.fill("[data-testid=vs-signed-by]", "Karim");
  await sign(seller);
  await shot(seller, "vs-02-seller-phone", true);
  await tap(seller, "[data-testid=vs-confirm]");
  check("sale done, amount to collect", await until(async () => (await seller.locator("[data-testid=vs-collect]").count()) === 1, 30000));
  await seller.locator("[data-testid=vs-done]").evaluate((e) => e.scrollIntoView({ block: "center" }));
  await shot(seller, "vs-03-sale-done");
  const sale1 = sql(`select s.status||'|'||o.status||'|'||s.method||'|'||(s.paid=s."grossTotal")::text||'|'||(s."signatureKey" is not null)::text from "VanSale" s join "Order" o on o.id=s."orderId" where s."loadId"='${loadId}' order by s."createdAt" limit 1`);
  check("FIRINGI order delivered, paid in cash, signed", sale1 === "DONE|DELIVERED|CASH|true|true", sale1);
  check("FIRINGI invoiced the customer", sql(`select count(*) from "Invoice" i join "VanSale" s on s."orderId"=i."orderId" where s."loadId"='${loadId}' and i."recipientCompanyId"='${ids.kb}'`) !== "0");
  const shown = Number(await seller.locator("[data-testid=vs-collect]").getAttribute("data-amount"));
  check("collect = invoice amount", Math.abs(shown - Number(sql(`select paid from "VanSale" where "loadId"='${loadId}' limit 1`))) < 0.005);

  // 4. a sale without signal: kept on the phone, sent when back online, done once
  await tap(seller, "[data-testid=vs-new]");
  await seller.context().setOffline(true);
  check("offline shown", await until(async () => (await seller.locator("[data-testid=vs-offline]").count()) === 1));
  await seller.locator("[data-testid=vs-pick-customer]", { hasText: "Kebab" }).first().click();
  check("prices from the phone", await until(async () => (await sp.count()) === 1));
  for (let i = 0; i < 2; i++) await sp.locator("[data-testid=vs-plus]").click();
  await tap(seller, "[data-testid=vs-method-MB_WAY]");
  await seller.fill("[data-testid=vs-signed-by]", "Karim");
  await sign(seller);
  await tap(seller, "[data-testid=vs-confirm]");
  check("sale kept on the phone", await until(async () => (await seller.locator("[data-testid=vs-done][data-queued=true]").count()) === 1));
  await seller.locator("[data-testid=vs-done]").evaluate((e) => e.scrollIntoView({ block: "center" }));
  await shot(seller, "vs-04-offline");
  check("not sent while offline", sql(`select count(*) from "VanSale" where "loadId"='${loadId}' and status='DONE'`) === "1");
  await seller.context().setOffline(false);
  check("sent when back online", await until(async () => sql(`select count(*) from "VanSale" where "loadId"='${loadId}' and status='DONE'`) === "2", 40000));
  await seller.waitForTimeout(2500);
  check("sent once", sql(`select count(*) from "VanSale" where "loadId"='${loadId}'`) === "2");
  check("van stock follows the sales", sql(`select sum("qtySold") from "VanLot" where "loadId"='${loadId}'`) === "5");

  // 5. end of the day: unload and count the cash (seller)
  await go(seller, "/vendor/van/sell");
  check("today's sales listed", (await seller.locator("[data-testid=vs-today-row]").count()) === 2);
  const expected = Number(sql(`select "cashExpected" from "VanLoad" where id='${loadId}'`));
  await seller.fill("[data-testid=vl-cash]", (expected - 1).toFixed(2));
  await seller.locator("[data-testid=vl-count]").first().fill("15");
  await tap(seller, "[data-testid=vl-close]");
  check("van unloaded", await until(async () => sql(`select status from "VanLoad" where id='${loadId}'`) === "CLOSED"));
  check("seller sees the unload result", await until(async () => (await seller.locator("[data-testid=vs-last-closed], [data-testid=vl-closed]").count()) >= 1));
  const closed = sql(`select status||'|'||"cashVariance" from "VanLoad" where id='${loadId}'`);
  check("load closed, cash 1 € short", closed === "CLOSED|-1.00", closed);
  check("15 back in the warehouse", onHand(ids) === before - 20 + 15, String(onHand(ids)));

  // 6. the owner sees the closed van
  await go(vendor, `/vendor/van/${loadId}`);
  check("owner sees it unloaded", (await vendor.locator("[data-testid=vl-status]").getAttribute("data-status")) === "CLOSED");
  check("owner sees both sales", (await vendor.locator("[data-testid=vl-sale]").count()) === 2);
  await shot(vendor, "vs-05-closed", true);
  await go(vendor, "/vendor/van");
  await shot(vendor, "vs-06-loads");

  // 7. the customer sees its van purchases
  await go(buyer, "/buy/orders/van");
  check("customer sees van purchases", (await buyer.locator("[data-testid=vb-row]").count()) >= 2);
  await shot(buyer, "vs-07-customer");

  // 8. FIRINGI: overview, switch off for the supplier → the seller can't sell
  await go(admin, "/admin/vendors/van-sales");
  check("FIRINGI page lists the supplier", (await admin.locator("[data-testid=vsa-supplier]", { hasText: "Lisboa" }).count()) === 1);
  await shot(admin, "vs-08-admin", true);
  await admin.locator("[data-testid=vsa-supplier]", { hasText: "Lisboa" }).locator("[data-testid=vs-vendor-switch]").click();
  check("switched off for the supplier", await until(async () => sql(`select value->'disabledVendors' ? '${ids.lx}' from "Setting" where key='vansales.settings'`) === "t"));
  await go(seller, "/vendor/van/sell");
  check("seller sees van sales are off", (await seller.locator("[data-testid=vs-off]").count()) === 1);
  await go(admin, "/admin/vendors/van-sales");
  await admin.locator("[data-testid=vsa-disabled] [data-testid=vs-vendor-switch]").first().click();
  check("switched on again", await until(async () => sql(`select value->'disabledVendors' ? '${ids.lx}' from "Setting" where key='vansales.settings'`) === "f"));

  // 9. phone width + dark
  const dark = await login("owner@lisboacentral.test", { ...phone, colorScheme: "dark" });
  await go(dark, `/vendor/van/${loadId}`);
  check("no horizontal scroll on phone (load)", await noOverflow(dark));
  await shot(dark, "vs-09-phone-dark", true);
  await go(seller, "/vendor/van/sell");
  check("no horizontal scroll on phone (sell)", await noOverflow(seller));
  check("no page errors", errors.length === 0, errors.join(" | "));
} catch (e) {
  console.error(e);
  failures++;
} finally {
  await browser.close();
  setup("remove");
}
console.log(failures ? `\n${failures} check(s) failed` : "\nAll van sales checks passed");
process.exit(failures ? 1 : 0);
