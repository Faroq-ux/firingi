/**
 * Browser test of Phase 61 (wholesaler storefronts). Supplier, visitor and customer in Portuguese, FIRINGI in English:
 * the supplier builds its storefront (link name, tagline, about, colour, featured products, logo + banner) and sends it
 * for approval → not public yet → FIRINGI approves → a visitor sees branding, delivery terms (minimum order, free
 * delivery from), current offers and products without prices, and "register" goes to registration with the store →
 * a signed-in customer opens the store in the shop (branding + delivery + offers on the supplier page) → visits counted
 * → FIRINGI suspends / restores → phone width, dark mode → no page errors. Cleans up after itself.
 *   node tests/e2e/storefront.mjs [baseUrl] [screenshotDir]
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
const tsx = (...a) => execFileSync("npx", ["tsx", "--require", "./tests/e2e/setup/no-server-only.cjs", "tests/e2e/setup/sf-promo.ts", ...a], { encoding: "utf8", env: { ...process.env, DATABASE_URL: DB } }).trim().split("\n").pop();
const errors = [];
async function login(email, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, locale: "pt-PT", reducedMotion: "reduce", deviceScaleFactor: SHOTS ? 2 : 1, serviceWorkers: "block", ...opts });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${email ?? "visitor"}: ${e.message.slice(0, 160)}`));
  page.on("dialog", (d) => d.accept());
  if (!email) return page;
  await go(page, "/login");
  await page.fill("#email", email); await page.fill("#password", PASSWORD); await page.click("button[type=submit]");
  await page.waitForURL((u) => u.pathname !== "/login", { timeout: 15000 }).catch(() => {});
  await settle(page);
  return page;
}
/** A picture made in the browser (logo / banner). */
async function picture(w, h, html) {
  const p = await browser.newPage({ viewport: { width: w, height: h } });
  await p.setContent(`<body style="margin:0">${html}</body>`);
  const buf = await p.screenshot({ type: "png" });
  await p.close();
  return buf;
}

const LX = sql(`select c.id from "Company" c join "Membership" m on m."companyId"=c.id join "User" u on u.id=m."userId" where u.email='owner@lisboacentral.test' limit 1`);
const cleanup = () => {
  sql(`delete from "Storefront" where "companyId"='${LX}'`);
  sql(`delete from "Setting" where key='storefront.settings'`);
};
cleanup();
const promos = JSON.parse(tsx("add"));

const vendor = await login("owner@lisboacentral.test");
const admin = await login("superadmin@firingi.test", { locale: "en-GB" });
const visitor = await login(null);

// ── 1. Supplier builds its storefront ──
await go(vendor, "/vendor/company/storefront");
check("storefront page in Portuguese", /montra/i.test((await vendor.textContent("main")) ?? ""));
await vendor.getByTestId("sf-slug").fill("lisboa-central");
await vendor.getByTestId("sf-tagline-input").fill("Frescos todas as manhãs, entregues em Lisboa");
await vendor.getByTestId("sf-about-input").fill("Grossista familiar desde 1987. Mercearia, bebidas e produtos frescos para restaurantes, cafés e mercearias.");
await vendor.getByTestId("sf-accent").nth(5).click();
for (const id of promos.offers.slice(0, 2)) await vendor.locator(`[data-testid=sf-feature][value="${id}"]`).check();
await vendor.getByTestId("sf-save").click();
check("saved", await until(async () => sql(`select slug from "Storefront" where "companyId"='${LX}'`) === "lisboa-central"));
await go(vendor, "/vendor/company/storefront");
const logo = await picture(240, 240, `<div style="width:240px;height:240px;display:grid;place-items:center;background:#fff"><div style="width:200px;height:200px;border-radius:40px;background:#be185d;color:#fff;font:700 92px system-ui;display:grid;place-items:center">LC</div></div>`);
const banner = await picture(1200, 400, `<div style="width:1200px;height:400px;background:linear-gradient(120deg,#be185d,#7c3aed 60%,#0d7f8c);position:relative;overflow:hidden">${Array.from({ length: 14 }, (_, i) => `<div style="position:absolute;left:${(i * 97) % 1200}px;top:${(i * 53) % 400}px;width:${80 + (i % 4) * 40}px;height:${80 + (i % 4) * 40}px;border-radius:50%;background:rgba(255,255,255,${0.06 + (i % 3) * 0.04})"></div>`).join("")}</div>`);
await vendor.getByTestId("sf-logo-file").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: logo });
check("logo uploaded", await until(async () => sql(`select ("logoKey" is not null)::text from "Storefront" where "companyId"='${LX}'`) === "true"));
await vendor.getByTestId("sf-banner-file").setInputFiles({ name: "banner.png", mimeType: "image/png", buffer: banner });
check("banner uploaded", await until(async () => sql(`select ("bannerKey" is not null)::text from "Storefront" where "companyId"='${LX}'`) === "true"));
await go(vendor, "/vendor/company/storefront");
await vendor.getByTestId("sf-publish").click();
check("sent for approval", await until(async () => sql(`select status from "Storefront" where "companyId"='${LX}'`) === "PENDING"));
check("QR code shown", await vendor.getByTestId("sf-qr").isVisible());

// ── 2. Not public until FIRINGI approves ──
const r1 = await go(visitor, "/s/lisboa-central");
check("not public yet (404)", r1?.status() === 404);
await go(admin, "/admin/vendors/storefronts");
check("FIRINGI page in English", /Storefronts/.test((await admin.textContent("main")) ?? ""));
await admin.locator('tr[data-status=PENDING]').getByTestId("sf-approve").click();
check("approved", await until(async () => sql(`select status from "Storefront" where "companyId"='${LX}'`) === "PUBLISHED"));

// ── 3. Visitor sees the storefront ──
const r2 = await go(visitor, "/s/lisboa-central");
check("public page loads", r2?.status() === 200);
check("name and tagline", /Frescos todas as manhãs/.test((await visitor.getByTestId("sf-tagline").textContent()) ?? ""));
check("minimum order / free delivery shown", (await visitor.getByTestId("sf-delivery").locator("li").count()) >= 1, (await visitor.getByTestId("sf-delivery").textContent())?.slice(0, 160));
check("offers shown", (await visitor.getByTestId("sf-offer").count()) >= 3);
check("featured products first", (await visitor.getByTestId("sf-product").first().getAttribute("data-featured")) === "1");
check("no prices on products", !/€/.test((await visitor.getByTestId("sf-products").locator("ul").textContent()) ?? ""));
check("register link carries the store", (await visitor.getByTestId("sf-register").getAttribute("href")) === "/register/customer?store=lisboa-central");
check("logo and banner served", (await visitor.evaluate(async () => (await fetch("/api/storefront/lisboa-central/logo")).status)) === 200);
await shot(visitor, "public-day", true);
await visitor.getByTestId("sf-register").click();
await settle(visitor);
check("registration opens", /\/register\/customer/.test(visitor.url()));

// ── 4. A signed-in customer opens the store in the shop ──
const buyer = await login("owner@kebabhouse.test");
await go(buyer, "/s/lisboa-central");
await buyer.getByTestId("sf-open").click();
await settle(buyer);
check("shop page shows the storefront panel", await until(async () => /\/buy\/catalogue\/suppliers\//.test(buyer.url()) && (await buyer.getByTestId("shop-store-panel").isVisible())));
await settle(buyer);
check("shop shows tagline", /Frescos/.test((await buyer.getByTestId("shop-store-tagline").textContent()) ?? ""));
check("shop shows delivery and offers", (await buyer.getByTestId("sf-delivery").count()) === 1 && (await buyer.getByTestId("sf-offer").count()) >= 3);
await shot(buyer, "shop-panel");

// ── 5. Stats ──
await go(vendor, "/vendor/company/storefront");
check("visits counted", Number(sql(`select coalesce(sum(views),0) from "StorefrontStat" where "companyId"='${LX}'`)) >= 1);
await shot(vendor, "supplier-editor", true);

// ── 6. FIRINGI suspends / restores ──
await go(admin, "/admin/vendors/storefronts");
const row = admin.locator('tr[data-status=PUBLISHED]').first();
await row.locator("input").fill("Checking the photos");
await row.getByTestId("sf-suspend").click();
check("suspended", await until(async () => sql(`select status from "Storefront" where "companyId"='${LX}'`) === "SUSPENDED"));
check("suspended → not public", (await go(visitor, "/s/lisboa-central"))?.status() === 404);
await go(admin, "/admin/vendors/storefronts");
await admin.locator('tr[data-status=SUSPENDED]').getByTestId("sf-restore").click();
check("restored", await until(async () => sql(`select status from "Storefront" where "companyId"='${LX}'`) === "PUBLISHED"));
await shot(admin, "admin", true);

// ── 7. Phone width, dark mode ──
const phone = await login(null, { viewport: { width: 390, height: 844 }, colorScheme: "dark" });
await phone.context().addCookies([{ name: "theme", value: "dark", url: BASE }]);
await go(phone, "/s/lisboa-central");
const over = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
check("phone no sideways scroll", over <= 1, String(over));
await shot(phone, "public-phone-dark", true);

check("no page errors", errors.length === 0, errors.join(" | "));
if (!process.env.KEEP_STOREFRONT) cleanup();
tsx("remove");
await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nAll storefront checks passed");
process.exit(failures ? 1 : 0);
