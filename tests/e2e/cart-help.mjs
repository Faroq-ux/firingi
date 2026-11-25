/**
 * Browser test: buying from several wholesalers. Customer (pt-PT) with a Lisboa Central item in the cart scans a Coca-Cola
 * can → Lisboa Central first, "in your cart · … more" badge, others show their minimum; the cart suggests what the
 * customer usually buys from that supplier, one tap adds it. FIRINGI (English) switches Portugal to "FIRINGI + area" →
 * the customer sees "FIRINGI Lisboa" in results and cart, not the name; a supplier set to "always its name" shows again;
 * phone width; no page errors.
 *   node tests/e2e/cart-help.mjs [baseUrl] [screenshotDir]
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

const KEBAB_USER = sql(`select id from "User" where email='owner@kebabhouse.test'`);
const KEBAB = sql(`select c.id from "Company" c where c."tradeName"='Kebab House'`);
const LC = sql(`select id from "Company" where "tradeName"='Lisboa Central'`);
const CAN = sql(`select o.id from "VendorOffer" o join "PackagingUnit" pu on pu.id=o."packagingUnitId" join "ProductVariant" v on v.id=pu."variantId" where o."vendorCompanyId"='${LC}' and v.gtin='5449000000996' and pu."unitsPerPack"=1 and o.status='ACTIVE' limit 1`);
const savedCart = sql(`select coalesce(string_agg(ci."offerId"||':'||ci.qty, ','),'') from "CartItem" ci join "Cart" c on c.id=ci."cartId" where c."buyerCompanyId"='${KEBAB}' and c."userId"='${KEBAB_USER}'`);
const cartId = () => sql(`select id from "Cart" where "buyerCompanyId"='${KEBAB}' and "userId"='${KEBAB_USER}'`);
const settings = () => sql(`delete from "Setting" where key in ('cartHelp.settings','supplierNames.settings')`);
const restore = () => {
  settings();
  const id = cartId();
  if (!id) return;
  sql(`delete from "CartItem" where "cartId"='${id}'`);
  for (const x of savedCart.split(",").filter(Boolean)) { const [o, q] = x.split(":"); sql(`insert into "CartItem" (id, "cartId", "offerId", qty) values ('e2e'||md5(random()::text), '${id}', '${o}', ${q}) on conflict do nothing`); }
};
settings();
process.on("exit", () => { try { restore(); } catch (e) { console.log("restore:", e.message); } });

const errors = [];
const browser = await chromium.launch();
async function login(email, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, locale: "pt-PT", reducedMotion: "reduce", deviceScaleFactor: SHOTS ? 2 : 1, serviceWorkers: "block", ...opts });
  const page = await ctx.newPage();
  page.setDefaultTimeout(240000);
  page.on("pageerror", (e) => errors.push(`${email}: ${e.message.slice(0, 160)}`));
  await go(page, "/login");
  await page.fill("#email", email); await page.fill("#password", PASSWORD); await page.click("button[type=submit]");
  await page.waitForURL((u) => u.pathname !== "/login", { timeout: 120000 }).catch(() => {});
  await settle(page);
  return page;
}
const vendors = (p) => p.locator("[data-testid=search-hit]").evaluateAll((els) => els.map((e) => e.innerText));

try {
  const c = await login("owner@kebabhouse.test");
  await go(c, "/buy/orders/cart");
  const id = cartId();
  sql(`delete from "CartItem" where "cartId"='${id}'`);
  sql(`insert into "CartItem" (id, "cartId", "offerId", qty) values ('e2e'||md5(random()::text), '${id}', '${CAN}', 6)`);

  // 1. results: the supplier in the cart first, with where it stands; others show their minimum
  await go(c, "/buy/catalogue/search?q=5449000000996");
  const hits = await vendors(c);
  check("results found", hits.length >= 2, String(hits.length));
  check("supplier in the cart first", /Lisboa Central/.test(hits[0] ?? ""));
  check("badge: in your cart · … more", await c.locator("[data-testid=search-hit]").first().getByTestId("min-badge-cart").isVisible());
  check("other suppliers show their minimum", (await c.getByTestId("min-badge").count()) >= 1);
  await shot(c, "01-results-cart-first", true);

  // 2. cart: what the customer usually buys from Lisboa Central, one tap
  await go(c, "/buy/orders/cart");
  check("cart suggests top-up", await c.getByTestId("top-up").isVisible());
  const before = await c.getByTestId("top-up-add").count();
  check("usual items listed", before >= 1, String(before));
  await shot(c, "02-cart-top-up", true);
  const items0 = Number(sql(`select count(*) from "CartItem" where "cartId"='${id}'`));
  await tap(c, "[data-testid=top-up-add]");
  check("one tap adds it", await until(async () => Number(sql(`select count(*) from "CartItem" where "cartId"='${id}'`)) === items0 + 1));

  // 3. FIRINGI: Portugal sees "FIRINGI + area"
  const a = await login("superadmin@firingi.test", { locale: "en-GB" });
  await go(a, "/admin/catalogue/suppliers-shown");
  check("admin page", await a.getByTestId("sn-form").isVisible());
  await a.getByTestId("sn-country-PT").selectOption("AREA");
  await tap(a, "[data-testid=sn-save]");
  check("saved", await until(async () => sql(`select value->'countries'->>'PT' from "Setting" where key='supplierNames.settings'`) === "AREA"));
  await shot(a, "03-admin", true);
  await go(c, "/buy/catalogue/search?q=5449000000996");
  const masked = (await vendors(c)).join(" | ");
  check("customer sees FIRINGI + area", /FIRINGI Lisboa/.test(masked) && /FIRINGI Almada/.test(masked), masked.slice(0, 160));
  check("…not the wholesaler's name", !/Lisboa Central|C&C Almada/.test(masked));
  await shot(c, "04-results-area-names", true);
  await go(c, "/buy/orders/cart");
  const cartText = await c.locator("main").innerText();
  check("cart shows FIRINGI + area", /FIRINGI Lisboa/.test(cartText) && !/Lisboa Central/.test(cartText));
  await shot(c, "05-cart-area-names", true);

  // 4. one supplier always by name
  await go(a, "/admin/catalogue/suppliers-shown");
  const row = a.getByTestId("sn-row").filter({ hasText: "Lisboa Central" }).first();
  await row.getByTestId("sn-company").selectOption("NAME");
  check("override saved", await until(async () => sql(`select value->'companies'->>'${LC}' from "Setting" where key='supplierNames.settings'`) === "NAME"));
  await go(c, "/buy/catalogue/search?q=5449000000996");
  const mixed = (await vendors(c)).join(" | ");
  check("that supplier by name again, others still FIRINGI + area", /Lisboa Central/.test(mixed) && /FIRINGI Almada/.test(mixed));

  // 5. phone
  const ph = await login("owner@kebabhouse.test", { viewport: { width: 390, height: 844 } });
  await go(ph, "/buy/orders/cart");
  check("phone: no sideways scroll", !(await ph.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)));
  await shot(ph, "06-phone-cart", true);

  check("no page errors", errors.length === 0, errors.join(" | "));
} catch (e) {
  console.log("✘ crashed —", e.message); failures++;
} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
