/**
 * Browser test of Phase 64 (customer assortments). Supplier and customer in Portuguese, FIRINGI in English:
 * the customer sees the olive oil in Lisboa Central's store → the supplier hides it for Kebab House (customer search,
 * product search) → gone from the customer's store → a must-stock list from pasted SKUs (one not found) → the customer's
 * must-stock page (and adding the missing ones to the cart) → the supplier's "see it as a customer" → FIRINGI's page
 * and per-supplier switch (off: the oil is back) → phone width, dark mode → no page errors. Cleans up after itself.
 *   node tests/e2e/assortments.mjs [baseUrl] [screenshotDir]
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
  return page;
}
const noOverflow = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const LX = sql(`select c.id from "Company" c join "Membership" m on m."companyId"=c.id join "User" u on u.id=m."userId" where u.email='owner@lisboacentral.test' limit 1`);
const KB = sql(`select c.id from "Company" c join "Membership" m on m."companyId"=c.id join "User" u on u.id=m."userId" where u.email='owner@kebabhouse.test' limit 1`);
const cleanup = () => { sql(`delete from "CartItem" where "cartId" in (select id from "Cart" where "buyerCompanyId"='${KB}')`); sql(`delete from "Assortment" where "vendorCompanyId"='${LX}'`); sql(`delete from "Setting" where key='assortments.settings'`); sql(`delete from "MustStockReminder" where "buyerCompanyId"='${KB}'`); };
const OIL = "Azeite";
cleanup();
try {
  const vendor = await login("owner@lisboacentral.test");
  const admin = await login("superadmin@firingi.test", { locale: "en-GB" });
  const buyer = await login("owner@kebabhouse.test");
  const store = async () => { await go(buyer, `/buy/catalogue/suppliers/${LX}?q=${OIL}`); return (await buyer.textContent("main")).includes(OIL); };

  // 0. the customer sees the olive oil today
  check("customer sees the olive oil before any list", await store());

  // 1. the supplier hides it for Kebab House
  await go(vendor, "/vendor/products/assortments");
  check("assortments page opens with no lists", (await vendor.locator("[data-testid=as-none]").count()) === 1);
  await vendor.fill("[data-testid=as-name]", "Sem azeite para o Kebab");
  await vendor.click("[data-testid=as-mode-HIDE_LISTED]");
  await vendor.selectOption("[data-testid=as-target]", "CUSTOMER");
  await vendor.fill("[data-testid=as-customer-search]", "Kebab");
  await vendor.locator("[data-testid=as-customer-search]").press("Enter");
  check("customer found", await until(async () => (await vendor.locator("[data-testid=as-pick-customer]").count()) > 0));
  await vendor.locator("[data-testid=as-pick-customer]", { hasText: "Kebab" }).first().click();
  await shot(vendor, "as-01-new-list");
  await vendor.click("[data-testid=as-create]");
  check("list created, its page opens", await until(async () => /\/vendor\/products\/assortments\/[a-z0-9]+$/.test(new URL(vendor.url()).pathname)));
  await settle(vendor);
  await vendor.fill("[data-testid=as-product-search]", "GRO-AZEITE75");
  await vendor.locator("[data-testid=as-add] form button[type=submit]").click();
  check("product found", await until(async () => (await vendor.locator("[data-testid=as-found-row]").count()) > 0));
  // the supplier sells the oil in more than one pack under the same SKU: hide every pack
  const packs = await vendor.locator("[data-testid=as-found-row]").count();
  for (let i = 0; i < packs; i++) {
    await vendor.locator("[data-testid=as-add-one]").first().click();
    await until(async () => (await vendor.locator("[data-testid=as-add-one]").count()) === packs - i - 1);
  }
  check("olive oil (every pack) on the hidden list", await until(async () => (await vendor.locator("[data-testid=as-item]").count()) === packs));
  await shot(vendor, "as-02-hidden-list");

  // 2. gone from the customer's store
  check("customer no longer sees the olive oil", !(await store()));
  await shot(buyer, "as-03-customer-store");

  // 3. a must-stock list from pasted SKUs
  await go(vendor, "/vendor/products/assortments");
  await vendor.fill("[data-testid=as-name]", "Essenciais Kebab House");
  await vendor.click("[data-testid=as-mode-MUST_STOCK]");
  await vendor.selectOption("[data-testid=as-target]", "CUSTOMER");
  await vendor.fill("[data-testid=as-customer-search]", "Kebab");
  await vendor.locator("[data-testid=as-customer-search]").press("Enter");
  await until(async () => (await vendor.locator("[data-testid=as-pick-customer]").count()) > 0);
  await vendor.locator("[data-testid=as-pick-customer]", { hasText: "Kebab" }).first().click();
  await vendor.click("[data-testid=as-create]");
  await until(async () => /\/vendor\/products\/assortments\/[a-z0-9]+$/.test(new URL(vendor.url()).pathname));
  await settle(vendor);
  await vendor.fill("[data-testid=as-skus]", "GRO-LUSO15\nGRO-ARROZ1, NOPE-404");
  await vendor.click("[data-testid=as-add-skus]");
  check("SKUs added, unknown one reported", await until(async () => /NOPE-404/.test((await vendor.locator("[data-testid=as-skus-result]").textContent()) ?? "")));
  check("two products on the must-stock list", await until(async () => (await vendor.locator("[data-testid=as-item]").count()) === 2));
  await shot(vendor, "as-04-must-stock-list");

  // 4. the supplier's lists and "see it as a customer"
  await go(vendor, "/vendor/products/assortments");
  check("both lists listed", (await vendor.locator("[data-testid=as-list]").count()) === 2);
  await vendor.fill("[data-testid=as-preview-search]", "Kebab");
  await vendor.locator("[data-testid=as-preview] form button[type=submit]").click();
  await until(async () => (await vendor.locator("[data-testid=as-preview-show]").count()) > 0);
  await vendor.locator("[data-testid=as-preview-show]").first().click();
  check("preview: the oil packs hidden for Kebab House", await until(async () => Number(await vendor.locator("[data-testid=as-preview-result]").getAttribute("data-hidden")) >= 1));
  await shot(vendor, "as-05-lists-preview", true);

  // 5. the customer's must-stock page
  await go(buyer, "/buy/orders/must-stock");
  check("customer sees the must-stock products", (await buyer.locator("[data-testid=ms-item]").count()) === 2);
  const gaps = await buyer.locator("[data-testid=ms-item][data-gap=true]").count();
  if (gaps > 0) {
    await buyer.locator("[data-testid=ms-add-all]").click();
    check("missing ones added to the cart", await until(async () => Number(await buyer.locator("[data-testid=ms-added]").getAttribute("data-n")) === gaps));
  } else check("nothing missing (ordered recently)", true);
  await shot(buyer, "as-06-customer-must-stock");

  // 6. FIRINGI: page and switch per supplier
  await go(admin, "/admin/vendors/assortments");
  check("FIRINGI page lists the supplier", (await admin.locator("[data-testid=asa-supplier]", { hasText: "Lisboa" }).count()) === 1);
  await shot(admin, "as-07-admin", true);
  await admin.locator("[data-testid=asa-supplier]", { hasText: "Lisboa" }).locator("[data-testid=as-vendor-switch]").click();
  check("switched off for the supplier", await until(async () => sql(`select value->'disabledVendors' ? '${LX}' from "Setting" where key='assortments.settings'`) === "t"));
  check("customer sees the olive oil again", await store());
  await go(admin, "/admin/vendors/assortments");
  await admin.locator("[data-testid=asa-disabled] [data-testid=as-vendor-switch]").first().click();
  check("switched on again", await until(async () => sql(`select value->'disabledVendors' ? '${LX}' from "Setting" where key='assortments.settings'`) === "f"));
  check("hidden again", !(await store()));

  // 7. phone + dark
  const phone = await login("owner@kebabhouse.test", { ...devices["iPhone 13"], locale: "pt-PT", reducedMotion: "reduce", serviceWorkers: "block", colorScheme: "dark" });
  await go(phone, "/buy/orders/must-stock");
  check("no horizontal scroll on phone (must-stock)", await noOverflow(phone));
  await shot(phone, "as-08-phone-dark", true);
  const vphone = await login("owner@lisboacentral.test", { ...devices["iPhone 13"], locale: "pt-PT", reducedMotion: "reduce", serviceWorkers: "block" });
  await go(vphone, "/vendor/products/assortments");
  check("no horizontal scroll on phone (lists)", await noOverflow(vphone));
  check("no page errors", errors.length === 0, errors.join(" | "));
} catch (e) {
  console.error(e);
  failures++;
} finally {
  await browser.close();
  cleanup();
}
console.log(failures ? `\n${failures} check(s) failed` : "\nAll assortment checks passed");
process.exit(failures ? 1 : 0);
