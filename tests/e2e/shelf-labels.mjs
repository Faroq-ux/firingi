/**
 * Browser test: shelf price labels. A shop (pt-PT) adds three products it bought on FIRINGI with a 40% margin (prices
 * end in 9, the product's own barcode), puts one on promo, prints an A4 sheet (PDF) → labels marked printed, "to print"
 * empty; a price change puts it back on "to print". FIRINGI (English) turns Portugal off → the shop sees "not
 * available"; turns this shop on → it works again. Phone width; no page errors.
 *   node tests/e2e/shelf-labels.mjs [baseUrl] [screenshotDir]
 */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
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

const KEBAB = sql(`select id from "Company" where "tradeName"='Kebab House'`);
const clean = () => { sql(`delete from "ShelfLabel" where "companyId"='${KEBAB}'`); sql(`delete from "Setting" where key='shelfLabels.settings'`); };
clean();
process.on("exit", () => { try { clean(); } catch (e) { console.log("cleanup:", e.message); } });
const count = (w = "true") => Number(sql(`select count(*) from "ShelfLabel" where "companyId"='${KEBAB}' and ${w}`));

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

try {
  const c = await login("owner@kebabhouse.test");
  await go(c, "/buy/catalogue/shelf-labels");
  check("shop page", await c.getByTestId("sl-add").isVisible());
  check("empty list", await c.getByTestId("sl-empty").isVisible());
  const cands = c.getByTestId("sl-candidate");
  check("products bought on FIRINGI listed", (await cands.count()) >= 3, String(await cands.count()));
  await shot(c, "01-add-products", true);

  // 1. add three with a 40% margin
  for (let k = 0; k < 3; k++) await cands.nth(k).locator("input").check();
  await c.getByTestId("sl-margin").fill("40");
  await tap(c, "[data-testid=sl-add-btn]");
  check("3 labels added", await until(async () => count() === 3));
  check("prices end in 9", count(`"priceGross"::text like '%9'`) === 3);
  check("product barcode on the label", count(`barcode is not null`) >= 1);
  await settle(c);
  check("listed as to print", await until(async () => (await c.getByTestId("sl-row").count()) === 3));

  // 2. a promo on the first
  await tap(c, c.getByTestId("sl-edit").first());
  await c.getByTestId("sl-f-promo").fill("0,79");
  await tap(c, "[data-testid=sl-f-save]");
  check("promo saved", await until(async () => count(`"promoPrice" = 0.79`) === 1));
  await settle(c);
  await shot(c, "02-labels", true);

  // 3. print an A4 sheet
  await c.getByTestId("sl-format").selectOption("A4_21");
  const [resp] = await Promise.all([c.waitForResponse((r) => r.url().includes("/api/buy/shelf-labels/pdf")), tap(c, "[data-testid=sl-print-btn]")]);
  check("print answered", resp.status() === 200 && /pdf/.test(resp.headers()["content-type"] ?? ""), String(resp.status()));
  // the same PDF again (the browser keeps the first one in the new tab), every size
  const ids = sql(`select string_agg(id, ',') from "ShelfLabel" where "companyId"='${KEBAB}'`).split(",");
  for (const format of ["A4_21", "A4_12", "A4_4", "STRIP_27", "ROLL_58x40", "ROLL_62x29", "ROLL_40x30"]) {
    const r = await c.request.post(`${BASE}/api/buy/shelf-labels/pdf`, { data: { ids, format, copies: 1, fields: { brand: true, origin: false, code: "BARCODE", unitPrice: true, shopName: true, date: true } } });
    const body = await r.body();
    check(`PDF ${format}`, r.status() === 200 && body.subarray(0, 4).toString() === "%PDF", String(r.status()));
    if (SHOTS) writeFileSync(`${SHOTS}/labels-${format}.pdf`, body);
  }
  check("marked printed", await until(async () => count(`"printedAt" is not null`) === 3));
  await go(c, "/buy/catalogue/shelf-labels");
  check("nothing to print", sql(`select count(*) from "ShelfLabel" where "companyId"='${KEBAB}' and "printedPrice" is null`) === "0" && /\b0\b/.test(await c.getByTestId("kpi-toprint").innerText()));

  // 4. a new price → to print again
  await tap(c, "[data-testid=sl-filter-all]");
  await tap(c, c.getByTestId("sl-edit").nth(1));
  await c.getByTestId("sl-f-price").fill("9,99");
  await tap(c, "[data-testid=sl-f-save]");
  check("price saved", await until(async () => count(`"priceGross" = 9.99`) === 1));
  await go(c, "/buy/catalogue/shelf-labels");
  check("back on to print", (await c.getByTestId("sl-row").count()) === 1);
  await shot(c, "03-to-print-again", true);

  // 5. FIRINGI: Portugal off, this shop on
  const a = await login("superadmin@firingi.test", { locale: "en-GB" });
  await go(a, "/admin/catalogue/shelf-labels");
  check("admin page", await a.getByTestId("sla-form").isVisible());
  await a.getByTestId("sla-country-PT").uncheck();
  await tap(a, "[data-testid=sla-save]");
  check("saved", await until(async () => sql(`select value->'offCountries' ? 'PT' from "Setting" where key='shelfLabels.settings'`) === "t"));
  await shot(a, "04-admin", true);
  await go(c, "/buy/catalogue/shelf-labels");
  check("shop: not available", await c.getByTestId("sl-off").isVisible());
  await a.getByTestId("sla-find").fill("Kebab");
  await until(async () => (await a.getByTestId("sla-hit").count()) > 0, 20000);
  await a.getByTestId("sla-hit").first().getByTestId("sla-company").selectOption("ON");
  check("shop switched on", await until(async () => sql(`select value->'companies'->>'${KEBAB}' from "Setting" where key='shelfLabels.settings'`) === "ON"));
  await go(c, "/buy/catalogue/shelf-labels");
  check("shop: works again", await c.getByTestId("sl-list").isVisible());

  // 6. phone
  const ph = await login("owner@kebabhouse.test", { viewport: { width: 390, height: 844 } });
  await go(ph, "/buy/catalogue/shelf-labels");
  check("phone: no sideways scroll", !(await ph.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)));
  await shot(ph, "05-phone", true);

  check("no page errors", errors.length === 0, errors.join(" | "));
} catch (e) {
  console.log("✘ crashed —", e.message); failures++;
} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
