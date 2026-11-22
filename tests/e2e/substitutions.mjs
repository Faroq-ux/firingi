/**
 * Browser test of Phase 60 (substitutions). Customer and supplier in Portuguese, FIRINGI in English:
 * the customer sets "never replace" for one product and "ask me" generally → the supplier chooses replacement
 * products for rice → on an accepted order the supplier marks 4 rice missing and offers flour instead (its own
 * choice first, price preview) → the customer sees the proposal on the order and accepts → the new line and
 * totals follow → the supplier's and customer's Replacements pages list it → FIRINGI overview + settings
 * (switch off → suppliers can't offer) → phone width, dark mode → no page errors. Cleans up after itself.
 *   node tests/e2e/substitutions.mjs [baseUrl] [screenshotDir]
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
const go = async (p, url) => { await p.goto(`${BASE}${url}`); await settle(p); };
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn().catch(() => false)) return true; await new Promise((r) => setTimeout(r, 400)); } return false; };
const sql = (q) => execFileSync("psql", ["-At", DB, "-c", q], { encoding: "utf8" }).trim();
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

const KB = sql(`select c.id from "Company" c join "Membership" m on m."companyId"=c.id join "User" u on u.id=m."userId" where u.email='owner@kebabhouse.test' limit 1`);
const cleanup = () => {
  sql(`delete from "Setting" where key='substitutions.settings'`);
  sql(`delete from "SubstitutionPreference" where "companyId"='${KB}'`);
  sql(`delete from "SubstitutionProductRule" where "companyId"='${KB}'`);
};
cleanup();
const o = JSON.parse(execFileSync("npx", ["tsx", "--require", "./tests/e2e/setup/no-server-only.cjs", "tests/e2e/setup/sub-order.ts"], { encoding: "utf8", env: { ...process.env, DATABASE_URL: DB } }).trim().split("\n").pop());
sql(`delete from "SubstituteLink" where "offerId"='${o.rice}'`);

const buyer = await login("owner@kebabhouse.test");
const vendor = await login("owner@lisboacentral.test");
const admin = await login("superadmin@firingi.test", { locale: "en-GB" });

// ── 1. Customer: rules ──
await go(buyer, "/buy/orders/substitutions");
check("customer Replacements page in Portuguese", /Substitui/.test((await buyer.textContent("main")) ?? ""));
await buyer.getByTestId("sub-mode").selectOption("ASK");
await buyer.getByTestId("sub-save").click();
check("customer rules saved", await until(async () => sql(`select mode from "SubstitutionPreference" where "companyId"='${KB}'`) === "ASK"));
// a product rule: never replace olive oil
await until(async () => (await buyer.getByTestId("sub-product-pick").locator("option").count()) > 1);
const oilOpt = await buyer.getByTestId("sub-product-pick").locator("option", { hasText: /Azeite|olive oil/i }).first().getAttribute("value");
await buyer.getByTestId("sub-product-pick").selectOption(oilOpt);
await buyer.getByTestId("sub-product-add").click();
check("product rule added (never)", await until(async () => (await buyer.getByTestId("sub-product-rule").count()) === 1));
await shot(buyer, "customer-rules", true);

// ── 2. Supplier: replacement products for rice ──
await go(vendor, "/vendor/orders/substitutions");
await until(async () => (await vendor.getByTestId("sub-links-offer").locator("option").count()) > 2);
await vendor.getByTestId("sub-links-offer").selectOption(o.rice);
await until(async () => (await vendor.getByTestId("sub-links-add-pick").locator("option").count()) > 1);
await vendor.getByTestId("sub-links-add-pick").selectOption(o.flour);
await vendor.getByTestId("sub-links-add").click();
await vendor.getByTestId("sub-links-save").click();
check("supplier chose flour to replace rice", await until(async () => sql(`select count(*) from "SubstituteLink" where "offerId"='${o.rice}' and "substituteOfferId"='${o.flour}'`) === "1"));

// ── 3. Supplier: offer a replacement on the order ──
await go(vendor, `/vendor/orders/${o.orderId}`);
const card = vendor.getByTestId("order-substitutions");
check("order shows the replacements card", await card.isVisible());
await vendor.getByTestId("sub-line").selectOption(o.lineId);
check("customer's rule shown (ask)", await until(async () => (await vendor.getByTestId("sub-rule").getAttribute("data-mode")) === "ASK"));
check("supplier's own choice listed first", await until(async () => (await vendor.getByTestId("sub-cand").first().getAttribute("value")) === o.flour));
await vendor.getByTestId("sub-short").fill("4");
await vendor.getByTestId("sub-qty").fill("1");
check("price preview shown", /\d/.test((await vendor.getByTestId("sub-preview").textContent()) ?? ""));
await shot(vendor, "supplier-propose", true);
await vendor.getByTestId("sub-send").click();
check("proposal waiting for the customer", await until(async () => sql(`select status from "Substitution" where "orderId"='${o.orderId}' order by "createdAt" desc limit 1`) === "PENDING"));
check("rice line now 6", sql(`select "qtyConfirmed" from "OrderLine" where id='${o.lineId}'`) === "6");
// olive oil: the customer never accepts replacements for it
const oilLine = sql(`select l.id from "OrderLine" l where l."orderId"='${o.orderId}' and l.id<>'${o.lineId}' and l."substituteForLineId" is null limit 1`);
await go(vendor, `/vendor/orders/${o.orderId}`);
await vendor.getByTestId("sub-line").selectOption(oilLine);
check("never-rule shown for olive oil", await until(async () => (await vendor.getByTestId("sub-rule").getAttribute("data-mode")) === "NEVER"));

// ── 4. Customer accepts on the order page ──
const before = Number(sql(`select "grandTotal" from "Order" where id='${o.orderId}'`));
await go(buyer, `/buy/orders/${o.orderId}`);
const pending = buyer.locator('[data-testid=substitution][data-status=PENDING]');
check("customer sees the proposal", await pending.isVisible());
await shot(buyer, "customer-proposal", true);
await pending.getByTestId("sub-accept").click();
check("accepted", await until(async () => sql(`select status from "Substitution" where "orderId"='${o.orderId}' order by "createdAt" desc limit 1`) === "ACCEPTED"));
check("flour line added", sql(`select count(*) from "OrderLine" where "orderId"='${o.orderId}' and "substituteForLineId"='${o.lineId}'`) === "1");
const after = Number(sql(`select "grandTotal" from "Order" where id='${o.orderId}'`));
check("order total changed with the replacement", after !== before, `${before} → ${after}`);
await go(buyer, `/buy/orders/${o.orderId}`);
check("customer sees it accepted", await buyer.locator('[data-testid=substitution][data-status=ACCEPTED]').isVisible());

// ── 5. Lists ──
await go(buyer, "/buy/orders/substitutions");
check("customer list shows it", (await buyer.getByTestId("sub-recent-row").count()) >= 1);
await go(vendor, "/vendor/orders/substitutions");
check("supplier list shows it", (await vendor.getByTestId("sub-recent-row").count()) >= 1);

// ── 6. FIRINGI: overview and settings ──
await go(admin, "/admin/orders/substitutions");
check("FIRINGI overview in English", /Substitutions/.test((await admin.textContent("main")) ?? ""));
check("FIRINGI table lists it", (await admin.getByTestId("sub-admin-table").locator("tbody tr").count()) >= 1);
await go(admin, `/admin/orders/${o.orderId}`);
check("FIRINGI order page shows the replacement", await admin.getByTestId("order-substitutions").isVisible());
await go(admin, "/admin/orders/substitutions");
await admin.getByTestId("sub-admin-enabled").uncheck();
await admin.getByTestId("sub-admin-save").click();
check("switched off", await until(async () => sql(`select value->>'enabled' from "Setting" where key='substitutions.settings'`) === "false"));
await shot(admin, "admin-overview", true);
await go(vendor, `/vendor/orders/${o.orderId}`);
check("switched off → no propose form", (await vendor.getByTestId("sub-propose").count()) === 0);

// ── 7. Phone width, dark mode ──
const phone = await login("owner@kebabhouse.test", { viewport: { width: 390, height: 844 }, colorScheme: "dark" });
await phone.context().addCookies([{ name: "theme", value: "dark", url: BASE }]);
for (const url of [`/buy/orders/${o.orderId}`, "/buy/orders/substitutions"]) {
  await go(phone, url);
  const over = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(`phone ${url} no sideways scroll`, over <= 1, String(over));
}
await shot(phone, "customer-phone-dark");

check("no page errors", errors.length === 0, errors.join(" | "));
cleanup();
await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nAll substitution checks passed");
process.exit(failures ? 1 : 0);
