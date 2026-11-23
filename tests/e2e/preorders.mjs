/**
 * Browser test of Phase 71 (pre-orders & price locks). Supplier (Lisboa Central, Portuguese) drafts a pre-order with a
 * tier price and short supply → sends it → FIRINGI (English) approves → the customer (Kebab House, Portuguese)
 * pre-orders more than there is → the supplier closes it → the customer accepts the smaller quantity → the supplier
 * places the orders → the customer sees its order. Price lock: asked → accepted → called off. FIRINGI switches
 * wholesalers off (page and menu gone) and back on. Phone width, dark mode, no page errors. Cleans up after itself.
 *   node tests/e2e/preorders.mjs [baseUrl] [screenshotDir]
 */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
const { chromium } = createRequire(import.meta.url)("playwright");

const BASE = process.argv[2] ?? "http://localhost:3000";
const SHOTS = process.argv[3] ?? null;
const PASSWORD = process.env.SEED_PASSWORD ?? "Firingi!2026";
const DB = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/firingi";
const TITLE = `Natal E2E ${Date.now()}`;
let failures = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "✔" : "✘"} ${name}${extra ? ` — ${extra}` : ""}`); if (!ok) failures++; };
const shot = async (page, name, full = true) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: full });
const settle = async (p) => { await p.waitForLoadState("networkidle").catch(() => {}); await p.waitForTimeout(400); };
const go = async (p, url) => { const r = await p.goto(`${BASE}${url}`); await settle(p); return r; };
const until = async (fn, ms = 30000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn().catch(() => false)) return true; await new Promise((r) => setTimeout(r, 400)); } return false; };
const sql = (q) => execFileSync("psql", ["-At", DB, "-c", q], { encoding: "utf8" }).trim();
const tap = async (p, sel) => { const l = typeof sel === "string" ? p.locator(sel).first() : sel; await l.evaluate((e) => e.scrollIntoView({ block: "center" })); await l.click(); };
const errors = [];
const browser = await chromium.launch();
async function login(email, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, locale: "pt-PT", reducedMotion: "reduce", deviceScaleFactor: SHOTS ? 2 : 1, serviceWorkers: "block", ...opts });
  const page = await ctx.newPage();
  if (process.env.E2E_SLOW) page.setDefaultTimeout(240000);
  page.on("pageerror", (e) => errors.push(`${email}: ${e.message.slice(0, 160)}`));
  page.on("dialog", (d) => d.accept());
  await go(page, "/login");
  await page.fill("#email", email); await page.fill("#password", PASSWORD); await page.click("button[type=submit]");
  await page.waitForURL((u) => u.pathname !== "/login", { timeout: 30000 }).catch(() => {});
  await settle(page);
  const dismiss = page.locator("[data-testid=install-dismiss]");
  if (await dismiss.count()) await dismiss.first().click().catch(() => {});
  return page;
}
const noOverflow = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const KB = sql(`select id from "Company" where "legalName"='Kebab House Lisboa, Lda'`);
const START = new Date().toISOString();
const cleanup = () => {
  sql(`delete from "PreorderCampaign" where title like 'Natal E2E%'`);
  sql(`delete from "PriceLock" where "buyerCompanyId"='${KB}' and "createdAt" >= '${START}'`);
  sql(`delete from "Setting" where key='preorders.settings'`);
};
const campaignId = () => sql(`select id from "PreorderCampaign" where title='${TITLE}'`);
const status = () => sql(`select status from "PreorderCampaign" where title='${TITLE}'`);
const resStatus = () => sql(`select r.status from "PreorderReservation" r join "PreorderCampaign" c on c.id=r."campaignId" where c.title='${TITLE}'`);
sql(`delete from "PriceLock" where "buyerCompanyId"='${KB}' and status in ('REQUESTED','REVIEW','ACTIVE')`);
sql(`delete from "Setting" where key='preorders.settings'`);
const PAGE = "/buy/orders/preorders";
try {
  const vendor = await login("owner@lisboacentral.test");
  const admin = await login("superadmin@firingi.test", { locale: "en-GB" });
  const buyer = await login("owner@kebabhouse.test");

  // 1. supplier drafts and sends
  await go(vendor, "/vendor/orders/preorders");
  check("supplier sees its pre-orders page", (await vendor.getByTestId("vp-tabs").count()) === 1);
  await tap(vendor, "[data-testid=vp-new]");
  await vendor.waitForURL(/preorders\/new/);
  await settle(vendor);
  await vendor.fill("[data-testid=pc-title]", TITLE);
  await vendor.locator("[data-testid=pc-offer]").first().selectOption({ index: 1 });
  await vendor.fill("[data-testid=pc-price]", "9.50");
  await vendor.fill("[data-testid=pc-supply]", "10");
  await tap(vendor, "[data-testid=pc-add-tier]");
  await vendor.fill("[data-testid=pc-tier-min]", "8");
  await vendor.fill("[data-testid=pc-tier-price]", "8.90");
  await shot(vendor, "01-supplier-new");
  await tap(vendor, "[data-testid=pc-save]");
  check("draft saved", await until(async () => status() === "DRAFT"));
  await vendor.waitForURL(/preorders\/c[a-z0-9]+$/, { timeout: 60000 }).catch(() => {});
  await settle(vendor);
  await tap(vendor, "[data-testid=pc-submit]");
  check("sent to FIRINGI", await until(async () => status() === "PENDING"));

  // 2. FIRINGI approves
  await go(admin, "/admin/orders/preorders");
  check("admin: waiting for review", (await admin.locator(`[data-testid=ap-row][data-status=PENDING]`).count()) >= 1);
  await shot(admin, "02-admin-list");
  await go(admin, `/admin/orders/preorders/${campaignId()}`);
  await tap(admin, "[data-testid=ap-approve]");
  check("approved → open", await until(async () => status() === "OPEN"));

  // 3. the customer pre-orders more than there is
  await go(buyer, PAGE);
  const card = buyer.locator(`[data-testid=po-campaign][data-title="${TITLE}"]`);
  check("customer sees the open pre-order", (await card.count()) === 1);
  check("price and next tier shown", (await card.getByTestId("po-price").count()) === 1 && (await card.getByTestId("po-next").count()) === 1);
  check("Portuguese texts", /Pré-encomenda|pré-encomenda/.test(await buyer.locator("body").innerText()));
  await card.getByTestId("po-qty").first().fill("12");
  await tap(buyer, card.getByTestId("po-submit"));
  check("pre-order placed", await until(async () => resStatus() === "PLACED"));
  await go(buyer, PAGE);
  await shot(buyer, "03-customer-open");

  // 4. supplier closes and shares out (10 of 12) at the tier price
  await go(vendor, `/vendor/orders/preorders/${campaignId()}`);
  await tap(vendor, "[data-testid=pc-close]");
  check("closed and shared out", await until(async () => status() === "ALLOCATED" && resStatus() === "ALLOCATED"));
  check("tier price reached", Number(sql(`select l."unitNet" from "PreorderLine" l join "PreorderReservation" r on r.id=l."reservationId" join "PreorderCampaign" c on c.id=r."campaignId" where c.title='${TITLE}'`)) === 8.9);
  await go(vendor, `/vendor/orders/preorders/${campaignId()}`);
  check("supplier plan per delivery date", (await vendor.getByTestId("vc-plan").count()) === 1);
  await shot(vendor, "04-supplier-detail");

  // 5. customer accepts the smaller quantity
  await go(buyer, `${PAGE}?tab=MINE`);
  const mine = buyer.locator("[data-testid=po-mine][data-status=ALLOCATED]").first();
  check("given 10 of 12", (await mine.getByTestId("po-given").innerText()).trim() === "10");
  await shot(buyer, "05-customer-confirm");
  await tap(buyer, mine.getByTestId("po-accept"));
  check("accepted", await until(async () => resStatus() === "CONFIRMED"));

  // 6. supplier places the orders now
  await go(vendor, `/vendor/orders/preorders/${campaignId()}`);
  await tap(vendor, "[data-testid=pc-order]");
  check("order placed from the pre-order", await until(async () => resStatus() === "ORDERED"));
  await go(buyer, `${PAGE}?tab=MINE`);
  check("customer sees its order", (await buyer.getByTestId("po-order").count()) >= 1);

  // 7. price lock: ask → accept → call off
  await go(buyer, `${PAGE}?tab=LOCKS`);
  const sug = buyer.locator("[data-testid=pl-suggest]").first();
  check("products worth locking suggested", (await sug.count()) === 1);
  await tap(buyer, sug.getByTestId("pl-request"));
  check("lock requested", await until(async () => Number(sql(`select count(*) from "PriceLock" where "buyerCompanyId"='${KB}' and status='REQUESTED'`)) === 1));
  await go(vendor, "/vendor/orders/preorders?tab=LOCKS");
  await shot(vendor, "06-supplier-locks");
  await tap(vendor, vendor.locator("[data-testid=vl-request]").first().getByTestId("vl-accept"));
  check("lock accepted", await until(async () => Number(sql(`select count(*) from "PriceLock" where "buyerCompanyId"='${KB}' and status='ACTIVE'`)) === 1));
  await go(buyer, `${PAGE}?tab=LOCKS`);
  const lock = buyer.locator("[data-testid=pl-lock][data-status=ACTIVE]").first();
  // enough packs to pass the supplier's delivery minimum (call-offs keep it)
  const lockPrice = Number(sql(`select "unitNet" from "PriceLock" where "buyerCompanyId"='${KB}' and status='ACTIVE'`));
  const take = Math.max(1, Math.ceil(80 / lockPrice));
  await lock.getByTestId("pl-calloff-qty").fill(String(take));
  await tap(buyer, lock.getByTestId("pl-calloff-submit"));
  check("called off at the locked price", await until(async () => Number(sql(`select "qtyTaken" from "PriceLock" where "buyerCompanyId"='${KB}' and status='ACTIVE'`)) === take), `${take} packs`);
  check("call-off order at the locked price", Number(sql(`select ol."unitSalePriceNet" from "PriceLockCalloff" c join "PriceLock" l on l.id=c."lockId" join "OrderLine" ol on ol."orderId"=c."orderId" where l."buyerCompanyId"='${KB}' and l.status='ACTIVE' limit 1`)) === lockPrice);
  await go(buyer, `${PAGE}?tab=LOCKS`);
  await shot(buyer, "07-customer-locks");

  // 8. FIRINGI switches wholesalers off and on
  await go(admin, "/admin/orders/preorders?tab=SETTINGS");
  await shot(admin, "08-admin-settings");
  await tap(admin, "[data-testid=aps-whs]");
  await tap(admin, "[data-testid=aps-save]");
  check("wholesalers switched off", await until(async () => sql(`select value::text from "Setting" where key='preorders.settings'`).includes(`"WHOLESALER": false`)));
  check("customer page gone", (await buyer.goto(`${BASE}${PAGE}`))?.status() === 404);
  await go(buyer, "/buy");
  check("menu item hidden", (await buyer.locator(`a[href="${PAGE}"]`).count()) === 0);
  await go(admin, "/admin/orders/preorders?tab=SETTINGS");
  await tap(admin, "[data-testid=aps-whs]");
  await tap(admin, "[data-testid=aps-save]");
  check("back on", await until(async () => sql(`select value::text from "Setting" where key='preorders.settings'`).includes(`"WHOLESALER": true`)));
  check("customer page back", (await buyer.goto(`${BASE}${PAGE}?tab=MINE`))?.status() === 200);

  // 9. phone + dark
  const phone = await login("owner@kebabhouse.test", { viewport: { width: 390, height: 844 }, colorScheme: "dark" });
  await go(phone, `${PAGE}?tab=MINE`);
  check("phone: no sideways scroll", await noOverflow(phone));
  await shot(phone, "09-customer-phone-dark");
  const vphone = await login("owner@lisboacentral.test", { viewport: { width: 390, height: 844 } });
  await go(vphone, `/vendor/orders/preorders/new`);
  check("phone: supplier form fits", await noOverflow(vphone));
} finally {
  cleanup();
  check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  await browser.close();
}
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
