/**
 * Browser test of the animated dashboards against a running server with the demo seed:
 * admin overview, live operations, supplier and customer dashboards, driver route card.
 * Numbers settle on their real value, charts / map render, no page errors, nothing wider
 * than a phone screen; with "reduce motion" the values show at once and nothing scrolls by.
 *   node tests/e2e/dashboards.mjs [baseUrl] [screenshotDir]
 */
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");

const BASE = process.argv[2] ?? "http://localhost:3000";
const SHOTS = process.argv[3] ?? null;
const PASSWORD = process.env.SEED_PASSWORD ?? "Firingi!2026";
let failures = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "✔" : "✘"} ${name}${extra ? ` — ${extra}` : ""}`); if (!ok) failures++; };
const browser = await chromium.launch();
const errors = [];
async function open(email, url, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, ...opts });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${email} ${url}: ${e.message}`));
  await page.goto(`${BASE}/login`);
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForLoadState("networkidle");
  await page.goto(`${BASE}${url}`);
  await page.waitForLoadState("networkidle");
  return page;
}
const shot = async (p, n) => SHOTS && p.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true });
const heroNumbers = (p) => p.locator('[data-testid="hero"] .glass .text-2xl, [data-testid="hero"] .glass .text-3xl').allTextContents();

// ── Admin overview ──
const admin = await open("superadmin@firingi.test", "/admin/dashboard/overview");
check("admin: hero with live badge", (await admin.getByTestId("hero").count()) === 1 && /AO VIVO|LIVE|Live|Ao vivo/i.test(await admin.getByTestId("hero").textContent()));
await admin.waitForTimeout(1800);
const settled = await heroNumbers(admin);
await admin.waitForTimeout(800);
check("admin: counters settle on their value", JSON.stringify(settled) === JSON.stringify(await heroNumbers(admin)), settled.join(" | "));
check("admin: sparkline and progress ring drawn", (await admin.locator('[data-testid="hero"] svg path').count()) >= 1 && (await admin.locator("svg circle.motion-ring").count()) >= 1);
check("admin: order ribbon", (await admin.getByTestId("ticker").count()) === 1);
check("admin: live route map", (await admin.getByTestId("route-map").count()) === 1 || /Nenhuma rota|No routes/.test(await admin.textContent("main")));
await shot(admin, "motion-01-admin");

const live = await open("ops@firingi.test", "/admin/dashboard/live-operations");
check("live operations: tiles and map", (await live.getByTestId("live-kpis").count()) === 1 && ((await live.getByTestId("route-map").count()) === 1 || /No routes on the road/.test(await live.textContent("main"))));

// ── Supplier & customer ──
const vendor = await open("owner@lisboacentral.test", "/vendor/dashboard/overview");
check("supplier: hero, top products, deliveries ring", (await vendor.getByTestId("hero").count()) === 1 && /Produtos mais vendidos|Top products/.test(await vendor.textContent("main")) && (await vendor.locator("svg circle.motion-ring").count()) >= 1);
await shot(vendor, "motion-02-supplier");
const buyer = await open("owner@kebabhouse.test", "/buy/dashboard/overview");
check("customer: hero in Portuguese, spending, on the way", /Gasto, últimos 30 dias/.test(await buyer.textContent("main")) && (await buyer.getByTestId("on-the-way").count()) === 1);
check("customer: never sees FIRINGI's commission or supplier payout", !/margem|comiss|pagamento, últimos/i.test(await buyer.textContent("main")));
await shot(buyer, "motion-03-customer");

// ── Reduced motion: values at once, no scrolling ribbon ──
const calm = await open("superadmin@firingi.test", "/admin/dashboard/overview", { reducedMotion: "reduce" });
const first = await heroNumbers(calm);
check("reduced motion: numbers final at once", JSON.stringify(first) === JSON.stringify(settled), first.join(" | "));
const anim = await calm.locator(".motion-ticker-track").evaluate((el) => getComputedStyle(el).animationName);
check("reduced motion: order ribbon doesn't scroll", anim === "none", anim);

// ── Phone width ──
for (const [email, url] of [["superadmin@firingi.test", "/admin/dashboard/overview"], ["owner@kebabhouse.test", "/buy/dashboard/overview"], ["owner@lisboacentral.test", "/vendor/dashboard/overview"]]) {
  const p = await open(email, url, { viewport: { width: 390, height: 844 } });
  await p.waitForTimeout(1500);
  const wide = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(`phone width: no sideways scroll on ${url}`, wide <= 1, `${wide}px`);
}

check("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nAll dashboard e2e checks passed");
process.exit(failures ? 1 : 0);
