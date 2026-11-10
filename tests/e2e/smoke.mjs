/**
 * End-to-end smoke test against a running server (default http://localhost:3000).
 *   node tests/e2e/smoke.mjs [baseUrl] [screenshotDir]
 * Uses the seeded demo accounts (password SEED_PASSWORD, default "Firingi!2026").
 */
import { createRequire } from "node:module";
// CommonJS resolution so a globally installed Playwright (NODE_PATH) also works.
const { chromium } = createRequire(import.meta.url)("playwright");

const BASE = process.argv[2] ?? "http://localhost:3000";
const SHOTS = process.argv[3] ?? null;
const PASSWORD = process.env.SEED_PASSWORD ?? "Firingi!2026";
let failures = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "✔" : "✘"} ${name}${extra ? ` — ${extra}` : ""}`);
  if (!ok) failures++;
};

const browser = await chromium.launch();

async function login(email, password = PASSWORD) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`); await page.waitForLoadState("networkidle"); await page.waitForTimeout(400);
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
  // A portal root (/admin, /vendor, /buy, /driver) redirects to its landing page: wait for it.
  await page.waitForURL((u) => !/\/(admin|vendor|buy|driver)\/?$/.test(u.pathname), { timeout: 15000 }).catch(() => {});
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(500);
  return { ctx, page };
}
const shot = async (page, name) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });

// 1. Super admin: dashboard + full sidebar
{
  const { ctx, page } = await login("superadmin@firingi.test");
  check("super admin lands on admin dashboard", page.url().endsWith("/admin/dashboard/overview"), page.url());
  const sections = await page.locator("aside nav > div > div > button").count();
  check("super admin sees all 20 sidebar sections", sections === 20, `${sections}`);
  await shot(page, "01-admin-dashboard");
  await page.goto(`${BASE}/admin/ai/demand-forecasting`); await page.waitForLoadState("networkidle"); await page.waitForTimeout(400);
  check("placeholder page renders Coming soon (PT: Brevemente)", /Coming soon|Brevemente/.test(await page.textContent("main")));
  await shot(page, "02-coming-soon");
  await page.goto(`${BASE}/admin/users/all`); await page.waitForLoadState("networkidle"); await page.waitForTimeout(400);
  check("admin users page lists staff", (await page.textContent("main")).includes("rm.lisboa@firingi.test"));
  await shot(page, "03-admin-users");
  await page.goto(`${BASE}/admin/international/countries`); await page.waitForLoadState("networkidle"); await page.waitForTimeout(400);
  const rows = page.locator("tbody tr");
  check("countries page lists the 29 Schengen countries (+ CY, IE inactive)", (await rows.count()) === 31 && (await rows.filter({ hasText: "Schengen" }).filter({ hasNotText: "Outside" }).count()) === 29);
  await shot(page, "04-countries");
  await page.goto(`${BASE}/admin/settings/audit-logs`); await page.waitForLoadState("networkidle"); await page.waitForTimeout(400);
  check("audit log shows logins", (await page.textContent("main")).includes("auth.login"));
  await shot(page, "05-audit-log");
  await ctx.close();
}

// 2. Support agent: limited sidebar, blocked from finance
{
  const { ctx, page } = await login("support@firingi.test");
  const sections = await page.locator("aside nav > div > div > button").count();
  check("support agent sees a reduced sidebar", sections > 0 && sections < 20, `${sections} sections`);
  await page.goto(`${BASE}/admin/users/all`); await page.waitForLoadState("networkidle"); await page.waitForTimeout(400);
  check("support agent is blocked from Users (forbidden)", page.url().endsWith("/forbidden"), page.url());
  await page.goto(`${BASE}/admin/finance/overview`); await page.waitForLoadState("networkidle"); await page.waitForTimeout(400);
  check("support agent is blocked from a Finance placeholder URL", page.url().endsWith("/forbidden"), page.url());
  await ctx.close();
}

// 3. Customer: buy portal only, never admin or vendor
{
  const { ctx, page } = await login("owner@kebabhouse.test");
  check("customer lands in buy portal", page.url().includes("/buy/"), page.url());
  await shot(page, "06-customer-dashboard");
  await page.goto(`${BASE}/admin`); await page.waitForLoadState("networkidle"); await page.waitForTimeout(400);
  check("customer is blocked from admin", page.url().endsWith("/forbidden"), page.url());
  await page.goto(`${BASE}/vendor`); await page.waitForLoadState("networkidle"); await page.waitForTimeout(400);
  check("customer is blocked from vendor portal", page.url().endsWith("/forbidden"), page.url());
  await page.goto(`${BASE}/buy/company/users`); await page.waitForLoadState("networkidle"); await page.waitForTimeout(400);
  check("customer owner can manage team", (await page.textContent("main")).includes("buyer@kebabhouse.test"));
  await shot(page, "07-customer-team");
  await ctx.close();
}

// 4. Wholesaler owner: both Sell and Buy portals
{
  const { ctx, page } = await login("owner@lisboacentral.test");
  check("wholesaler lands in vendor portal", page.url().includes("/vendor/"), page.url());
  const tabs = await page.locator("[role=tab]").allTextContents();
  check("wholesaler has Sell + Buy switch", tabs.length === 2, tabs.join(" / "));
  await page.goto(`${BASE}/vendor/company/roles`); await page.waitForLoadState("networkidle"); await page.waitForTimeout(400);
  await shot(page, "08-wholesaler-roles");
  await ctx.close();
}

// 5. Limited vendor employee (warehouse)
{
  const { ctx, page } = await login("warehouse@lisboacentral.test");
  check("warehouse employee lands in vendor portal", page.url().includes("/vendor/"), page.url());
  await page.goto(`${BASE}/vendor/company/users`); await page.waitForLoadState("networkidle"); await page.waitForTimeout(400);
  check("warehouse employee blocked from Users", page.url().endsWith("/forbidden"), page.url());
  await page.goto(`${BASE}/vendor/products/price-lists`); await page.waitForLoadState("networkidle"); await page.waitForTimeout(400);
  check("warehouse employee blocked from Price Lists", page.url().endsWith("/forbidden"), page.url());
  await page.goto(`${BASE}/buy`); await page.waitForLoadState("networkidle"); await page.waitForTimeout(400);
  check("warehouse employee blocked from Buy portal", page.url().endsWith("/forbidden"), page.url());
  await ctx.close();
}

// 6. Pending account
{
  const { ctx, page } = await login("owner@portonorte.test");
  check("pending account is sent to application status", page.url().endsWith("/application-status"), page.url());
  await shot(page, "09-application-pending");
  await page.goto(`${BASE}/vendor`); await page.waitForLoadState("networkidle"); await page.waitForTimeout(400);
  check("pending account cannot open vendor portal", page.url().endsWith("/application-status"), page.url());
  await ctx.close();
}

// 7. Wrong password
{
  const { ctx, page } = await login("superadmin@firingi.test", "wrong-password!!");
  check("wrong password is rejected", page.url().includes("/login") && (await page.isVisible("[role=alert]")));
  await ctx.close();
}

// 8. Language: Portuguese by default for a PT company, switchable to English
{
  const { ctx, page } = await login("ops@firingi.test");
  check("PT user gets Portuguese UI by default", (await page.textContent("aside")).includes("Encomendas"));
  const options = await page.locator("header select").last().locator("option").allTextContents();
  check("language choices = country language + English", options.join(",") === "Português,English", options.join(","));
  await page.locator("header select").last().selectOption("en");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1000);
  check("language switches to English", (await page.textContent("aside")).includes("Orders"));
  await shot(page, "10-admin-en-operations");
  // The choice is saved on the user — restore Portuguese so the test can be re-run.
  await page.locator("header select").last().selectOption("pt-PT");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(800);
  await ctx.close();
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const mp = await m.newPage();
  await mp.goto(`${BASE}/login`); await mp.waitForLoadState("networkidle"); await mp.waitForTimeout(400);
  await mp.fill("#email", "owner@kebabhouse.test");
  await mp.fill("#password", PASSWORD);
  await mp.click("button[type=submit]");
  await mp.waitForLoadState("networkidle");
  await mp.waitForTimeout(500);
  const overflow = await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check("no horizontal scroll on phone width", !overflow);
  await shot(mp, "11-mobile");
  await m.close();
}

await browser.close();
console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll e2e checks passed");
process.exit(failures ? 1 : 0);
