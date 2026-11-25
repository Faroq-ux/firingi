/**
 * Browser test of "Add by barcode with AI" (supplier in Portuguese, FIRINGI admin in English), wholesale:
 * a case barcode (GTIN-14) → the item inside is found, "per case" is chosen, items per case + price → Add;
 * a single-item barcode → "per item" with a minimum order → Add; the same item again → already on FIRINGI;
 * not found → fill in by hand; "Edit all details" opens the full form; FIRINGI leaves a country out → the supplier
 * no longer sees it, switches that one supplier back on → sees it again; phone width; no page errors.
 *   node tests/e2e/barcode-ai.mjs [baseUrl] [screenshotDir]      (server with ASSISTANT_SIMULATE=1 and no AI key)
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
const settle = async (p) => { await p.waitForLoadState("networkidle").catch(() => {}); await p.waitForTimeout(500); };
const go = async (p, url) => { const r = await p.goto(`${BASE}${url}`, { timeout: 240000 }); await settle(p); return r; };
const until = async (fn, ms = 60000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn().catch(() => false)) return true; await new Promise((r) => setTimeout(r, 400)); } return false; };
const sql = (q) => execFileSync("psql", ["-At", DB, "-c", q], { encoding: "utf8" }).trim();
const tap = async (p, sel) => { const l = typeof sel === "string" ? p.locator(sel).first() : sel; await l.evaluate((e) => e.scrollIntoView({ block: "center" })); await l.click(); };

const CODES = ["15609876543219", "5609876543212", "5601111222333", "5603333444555"];
const PRODUCTS = `select distinct v."productId" from "ProductVariant" v left join "PackagingUnit" pu on pu."variantId"=v.id where v.gtin in (${CODES.map((c) => `'${c}'`).join(",")}) or pu.gtin in (${CODES.map((c) => `'${c}'`).join(",")})`;
const cleanup = () => {
  sql(`delete from "Setting" where key='barcodeAi.settings'`);
  const ids = sql(PRODUCTS).split("\n").filter(Boolean);
  if (!ids.length) return;
  const list = ids.map((i) => `'${i}'`).join(",");
  const offers = `select o.id from "VendorOffer" o join "PackagingUnit" pu on pu.id=o."packagingUnitId" join "ProductVariant" v on v.id=pu."variantId" where v."productId" in (${list})`;
  for (const t of ["CartItem", "StockMovement", "PromotionTarget", "Substitution"]) sql(`delete from "${t}" where "${t === "Substitution" ? "substituteOfferId" : "offerId"}" in (${offers})`);
  sql(`delete from "VendorOffer" where id in (${offers})`);
  sql(`update "Product" set "foodInfoId"=null where id in (${list})`);
  sql(`delete from "FoodInfo" where "productId" in (${list})`);
  sql(`delete from "PackagingUnit" where "variantId" in (select id from "ProductVariant" where "productId" in (${list}))`);
  sql(`delete from "ProductVariant" where "productId" in (${list})`);
  sql(`delete from "Product" where id in (${list})`);
};
const safe = (f) => { try { f(); } catch (e) { console.log("cleanup:", String(e.message).split("\n")[0]); } };
safe(cleanup);
process.on("exit", () => safe(cleanup));

const errors = [];
const browser = await chromium.launch();
async function login(email, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, locale: "pt-PT", reducedMotion: "reduce", deviceScaleFactor: SHOTS ? 2 : 1, serviceWorkers: "block", ...opts });
  const page = await ctx.newPage();
  page.setDefaultTimeout(240000);
  page.on("pageerror", (e) => errors.push(`${email}: ${e.message.slice(0, 160)}`));
  page.on("dialog", (d) => d.accept());
  await go(page, "/login");
  await page.fill("#email", email); await page.fill("#password", PASSWORD); await page.click("button[type=submit]");
  await page.waitForURL((u) => u.pathname !== "/login", { timeout: 120000 }).catch(() => {});
  await settle(page);
  return page;
}
const find = async (p, code) => {
  await p.getByTestId("ba-code").fill(code);
  await tap(p, "[data-testid=ba-find]");
  return until(async () => (await p.locator("[data-testid=ba-quick],[data-testid=ba-catalogue],[data-testid=ba-notfound],[data-testid=ba-error]").count()) > 0);
};
const offerOf = (code) => sql(`select o."minOrderQty"||'/'||pu."unitsPerPack"||'/'||coalesce(pu.gtin,'-')||'/'||coalesce(v.gtin,'-') from "VendorOffer" o join "PackagingUnit" pu on pu.id=o."packagingUnitId" join "ProductVariant" v on v.id=pu."variantId" where v.gtin='${code}' or pu.gtin='${code}' limit 1`);

try {
  const s = await login("owner@lisboacentral.test");
  await go(s, "/vendor/products/catalogue");
  check("supplier sees Add by barcode", await s.getByTestId("barcode-add").isVisible());
  await shot(s, "01-add-by-barcode");

  // 1. a case barcode (GTIN-14): the item inside is found, per case
  check("case barcode → product read", await find(s, "15609876543219") && await s.getByTestId("ba-quick").isVisible());
  check("case barcode explained (item inside)", (await s.getByTestId("ba-case").innerText()).includes("5609876543212"));
  check("'per case' is chosen", (await s.getByTestId("ba-mode-case").getAttribute("aria-pressed")) === "true");
  await s.getByTestId("ba-per-case").fill("6");
  await s.getByTestId("ba-price").fill("29.90");
  await shot(s, "02-case-barcode", true);
  await tap(s, "[data-testid=ba-add]");
  check("case added", await until(() => s.getByTestId("ba-done").isVisible()));
  check("case: 6 per case, case + item barcodes", offerOf("15609876543219") === "1/6/15609876543219/5609876543212", offerOf("15609876543219"));

  // 2. a single item with a minimum order
  check("item barcode → product read", await find(s, "5601111222333") && await s.getByTestId("ba-quick").isVisible());
  await tap(s, "[data-testid=ba-mode-item]");
  await s.getByTestId("ba-min").fill("12");
  if (await s.getByTestId("ba-category").count()) await s.getByTestId("ba-category").selectOption({ index: 1 });
  await s.getByTestId("ba-price").fill("1.20");
  await shot(s, "03-per-item-minimum", true);
  await tap(s, "[data-testid=ba-add]");
  check("item added", await until(() => s.getByTestId("ba-done").isVisible()));
  check("item: minimum 12, 1 per pack", offerOf("5601111222333").startsWith("12/1/"), offerOf("5601111222333"));

  // 3. the item from the case is now on FIRINGI
  check("same item again → already on FIRINGI", await find(s, "5609876543212") && await s.getByTestId("ba-catalogue").isVisible());

  // 3b. FIRINGI approves; a customer scans the SINGLE item → the case listing shows, with the supplier's minimum
  const ids = sql(PRODUCTS).split("\n").filter(Boolean).map((i) => `'${i}'`).join(",");
  sql(`update "Product" set status='APPROVED' where id in (${ids})`);
  sql(`update "VendorOffer" set status='ACTIVE' where "packagingUnitId" in (select pu.id from "PackagingUnit" pu join "ProductVariant" v on v.id=pu."variantId" where v."productId" in (${ids}))`);
  const c = await login("owner@kebabhouse.test");
  const hitsFor = async (q) => { await go(c, `/buy/catalogue/search?q=${q}`); return c.locator("[data-testid=search-hit]").count(); };
  check("customer scans the single bottle → the case of 6 is found", (await hitsFor("5609876543212")) >= 1);
  await shot(c, "07-customer-scans-item", true);
  check("customer scans the case code → found too", (await hitsFor("15609876543219")) >= 1);
  check("customer scans the biscuits → found (minimum 12)", (await hitsFor("5601111222333")) >= 1);
  // Coca-Cola: the can and the 24-pack carry different barcodes — either shows every way suppliers sell it
  const listed = Number(sql(`select count(*) from "VendorOffer" o join "PackagingUnit" pu on pu.id=o."packagingUnitId" join "ProductVariant" v on v.id=pu."variantId" where v.gtin='5449000000996' and o.status='ACTIVE'`));
  const byCan = await hitsFor("5449000000996");
  await shot(c, "08-customer-scans-coca-cola-can", true);
  const byPack = await hitsFor("5602000000919");
  check("Coca-Cola: can or pack barcode → all the options suppliers list", listed >= 2 && byCan === byPack && byCan >= 2, `listed ${listed}, can ${byCan}, pack ${byPack}`);

  // 4. "Edit all details" → the full form, filled in
  await find(s, "5603333444555");
  await tap(s, "[data-testid=ba-edit]");
  check("Edit all details → full form filled in", await s.getByTestId("propose-form").isVisible() && (await s.locator("#nameEn").inputValue()).length > 3);

  // 5. not found → by hand
  check("unknown barcode → not found", await find(s, "4006381333931") && await s.getByTestId("ba-notfound").isVisible());
  await shot(s, "04-not-found", true);
  await tap(s, "[data-testid=ba-byhand]");
  check("fill in by hand → form with the barcode", (await s.locator("#gtin").inputValue()) === "4006381333931");

  // 6. FIRINGI: leave Portugal out, then switch this supplier back on
  const a = await login("superadmin@firingi.test", { locale: "en-GB" });
  await go(a, "/admin/catalogue/barcode-ai");
  check("admin page", await a.getByTestId("ba-form").isVisible());
  await a.getByTestId("ba-country-PT").uncheck();
  await tap(a, "[data-testid=ba-save]");
  check("country left out saved", await until(async () => sql(`select value->'offCountries' from "Setting" where key='barcodeAi.settings'`).includes("PT")));
  await go(s, "/vendor/products/catalogue");
  check("Portuguese supplier no longer sees it", (await s.getByTestId("barcode-add").count()) === 0);
  await go(a, "/admin/catalogue/barcode-ai");
  await a.getByTestId("ba-find-company").fill("Lisboa Central");
  check("supplier found", await until(() => a.getByTestId("ba-hit").first().isVisible()));
  await shot(a, "05-admin", true);
  await a.getByTestId("ba-hit").first().getByTestId("ba-company").selectOption("ON");
  check("company switched on", await until(async () => sql(`select value->'companies' from "Setting" where key='barcodeAi.settings'`).includes('"ON"')));
  await go(s, "/vendor/products/catalogue");
  check("…that supplier sees it again", await s.getByTestId("barcode-add").isVisible());

  // 7. phone
  const ph = await login("owner@lisboacentral.test", { viewport: { width: 390, height: 844 } });
  await go(ph, "/vendor/products/catalogue");
  await find(ph, "5603333444555");
  const over = await ph.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check("phone: no sideways scroll", !over);
  await shot(ph, "06-phone", true);

  check("no page errors", errors.length === 0, errors.join(" | "));
} catch (e) {
  console.log("✘ crashed —", e.message); failures++;
} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
