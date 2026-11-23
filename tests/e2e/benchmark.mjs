/**
 * Browser test of Phase 70 (price benchmark). Three test restaurants buy what Kebab House bought, for less (helper
 * bench-setup.ts). Customer in Portuguese: savings, position, cheaper offers → add to cart, basket, trend, no other
 * buyer named; supplier price position; FIRINGI overview (English) and switches (customers off → the page and the
 * menu item go; back on); phone width, dark mode; no page errors. Cleans up after itself.
 *   node tests/e2e/benchmark.mjs [baseUrl] [screenshotDir]
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
const settle = async (p) => { await p.waitForLoadState("networkidle").catch(() => {}); await p.waitForTimeout(400); };
const go = async (p, url) => { const r = await p.goto(`${BASE}${url}`); await settle(p); return r; };
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn().catch(() => false)) return true; await new Promise((r) => setTimeout(r, 400)); } return false; };
const sql = (q) => execFileSync("psql", ["-At", DB, "-c", q], { encoding: "utf8" }).trim();
const tap = async (p, sel) => { const l = typeof sel === "string" ? p.locator(sel).first() : sel; await l.evaluate((e) => e.scrollIntoView({ block: "center" })); await l.click(); };
const setup = (arg) => execFileSync("npx", ["tsx", "--require", "./tests/e2e/setup/no-server-only.cjs", "tests/e2e/setup/bench-setup.ts", arg], { encoding: "utf8", env: { ...process.env, DATABASE_URL: DB } }).trim().split("\n").pop();
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
  await page.waitForURL((u) => u.pathname !== "/login", { timeout: 15000 }).catch(() => {});
  await settle(page);
  const dismiss = page.locator("[data-testid=install-dismiss]");
  if (await dismiss.count()) await dismiss.first().click().catch(() => {});
  return page;
}
const noOverflow = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const KB = sql(`select id from "Company" where "legalName"='Kebab House Lisboa, Lda'`);
const cartLines = () => Number(sql(`select count(*) from "CartItem" ci join "Cart" c on c.id=ci."cartId" where c."buyerCompanyId"='${KB}'`) || 0);
const PAGE = "/buy/reports/price-benchmark";

const run = JSON.parse(setup("add"));
check("benchmark rebuilt with groups", run.rebuilt && run.groups > 0, `${run.groups} groups`);
try {
  const buyer = await login("owner@kebabhouse.test");
  const vendor = await login("owner@lisboacentral.test");
  const admin = await login("superadmin@firingi.test", { locale: "en-GB" });

  // 1. customer: savings, position, cheaper offers
  await go(buyer, PAGE);
  const rows = buyer.locator("[data-testid=bm-all] [data-testid=bm-row]");
  check("products compared", (await rows.count()) >= 1, `${await rows.count()} rows`);
  check("above the market on at least one product", (await buyer.locator("[data-testid=bm-all] [data-testid=bm-row][data-band=ABOVE]").count()) >= 1);
  check("yearly saving shown", (await buyer.getByTestId("bm-total").count()) === 1 && (await buyer.locator("[data-testid=bm-savers] [data-testid=bm-saving]").count()) >= 1);
  check("range bar drawn", (await buyer.getByTestId("bm-range").count()) >= 1);
  check("basket check", (await buyer.getByTestId("bm-basket").count()) === 1);
  check("6-month trend", (await buyer.getByTestId("bm-trend").count()) === 1);
  const body = await buyer.locator("body").innerText();
  check("Portuguese texts", /mercado|poupan/i.test(body), body.slice(0, 80).replace(/\n/g, " "));
  check("no other buyer named", !/Restaurante E2E/.test(body));
  await shot(buyer, "01-customer-benchmark", true);
  const alts = buyer.locator("[data-testid=bm-alt]");
  check("cheaper offers listed", (await alts.count()) >= 1, `${await alts.count()} offers`);
  if (await alts.count()) {
    const before = cartLines();
    await tap(buyer, alts.first().getByTestId("bm-alt-add"));
    check("cheaper offer added to the cart", await until(async () => cartLines() > before || /adicionad|carrinho/i.test(await buyer.locator("body").innerText())));
  }

  // 2. phone + dark
  const phone = await login("owner@kebabhouse.test", { viewport: { width: 390, height: 844 }, colorScheme: "dark" });
  await go(phone, PAGE);
  check("phone: no sideways scroll", await noOverflow(phone));
  await shot(phone, "02-customer-phone-dark", true);

  // 3. supplier price position
  await go(vendor, "/vendor/reports/price-position");
  check("supplier sees its price position", (await vendor.getByTestId("bm-v-row").count()) >= 1);
  check("supplier page names no buyer", !/Kebab House|Restaurante E2E/.test(await vendor.locator("body").innerText()));
  await shot(vendor, "03-supplier-position", true);

  // 4. FIRINGI overview + switches
  await go(admin, "/admin/pricing/intelligence/benchmark");
  check("admin: groups tile", (await admin.getByTestId("bma-groups").count()) === 1);
  check("admin: top savers list Kebab House", /Kebab House/.test(await admin.getByTestId("bma-top").innerText().catch(() => "")));
  await shot(admin, "04-admin-overview", true);
  await go(admin, "/admin/pricing/intelligence/benchmark?tab=SETTINGS");
  await shot(admin, "05-admin-settings", true);
  await tap(admin, "[data-testid=bms-aud-customers]");
  await tap(admin, "[data-testid=bms-save]");
  check("customers switched off (saved)", await until(async () => sql(`select value::text from "Setting" where key='benchmark.settings'`).includes(`"customers": false`)));
  const off = await buyer.goto(`${BASE}${PAGE}`);
  check("customer page gone when off", off?.status() === 404);
  await go(buyer, "/buy");
  check("menu item hidden when off", (await buyer.locator(`a[href="${PAGE}"]`).count()) === 0);
  await go(admin, "/admin/pricing/intelligence/benchmark?tab=SETTINGS");
  await tap(admin, "[data-testid=bms-aud-customers]");
  await tap(admin, "[data-testid=bms-save]");
  check("customers back on", await until(async () => sql(`select value::text from "Setting" where key='benchmark.settings'`).includes(`"customers": true`)));
  const on = await buyer.goto(`${BASE}${PAGE}`);
  check("customer page back", on?.status() === 200);
  // one business switched off, then back to the settings
  await go(admin, "/admin/pricing/intelligence/benchmark");
  const kbRow = admin.locator("[data-testid=bma-top] li", { hasText: "Kebab House" }).first();
  await kbRow.getByTestId("bms-company").selectOption("OFF");
  check("Kebab House switched off on its own", await until(async () => sql(`select value::text from "Setting" where key='benchmark.settings'`).includes(`"${KB}": "OFF"`)));
  check("its page gone", (await buyer.goto(`${BASE}${PAGE}`))?.status() === 404);
  await go(admin, "/admin/pricing/intelligence/benchmark?tab=SETTINGS");
  check("listed under single businesses", /Kebab House/.test(await admin.getByTestId("bms-overrides").innerText().catch(() => "")));
  await admin.getByTestId("bms-overrides").getByTestId("bms-company").first().selectOption("DEFAULT");
  check("back to the settings", await until(async () => !sql(`select value::text from "Setting" where key='benchmark.settings'`).includes(KB)));
  check("its page back", (await buyer.goto(`${BASE}${PAGE}`))?.status() === 200);
  await tap(admin, "[data-testid=bms-rebuild]");
  check("rebuild now", await until(async () => /Rebuilt/.test(await admin.locator("body").innerText())));
} finally {
  setup("remove");
  check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  await browser.close();
}
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
