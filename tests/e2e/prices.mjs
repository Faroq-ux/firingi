/**
 * Browser test of Phase 29 (price intelligence), as the wholesaler Lisboa Central (Portuguese UI),
 * its customer Kebab House and FIRINGI (English):
 *  the supplier sees its anonymous market position → raises the mozzarella base price 25 % → it waits
 *  for FIRINGI (customers keep the old price) → FIRINGI's dashboard and approvals show it → FIRINGI
 *  approves it with notice → the customer sees the increase coming → the supplier withdraws it →
 *  FIRINGI's comparison, history chart, alerts, margin heat-map, suggestions and rules → hourly job →
 *  phone width → no page errors.
 *   node tests/e2e/prices.mjs [baseUrl] [screenshotDir]
 */
import { createRequire } from "node:module";
const { chromium, devices } = createRequire(import.meta.url)("playwright");

const BASE = process.argv[2] ?? "http://localhost:3000";
const SHOTS = process.argv[3] ?? null;
const PASSWORD = process.env.SEED_PASSWORD ?? "Firingi!2026";
let failures = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "✔" : "✘"} ${name}${extra ? ` — ${extra}` : ""}`); if (!ok) failures++; };
const shot = async (page, name) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png` });
const browser = await chromium.launch();
const settle = async (p) => { await p.waitForLoadState("networkidle").catch(() => {}); await p.waitForFunction(() => !document.querySelector("[aria-busy=true]"), null, { timeout: 15000 }).catch(() => {}); await p.waitForTimeout(400); };
const go = async (p, url) => { await p.goto(`${BASE}${url}`); await settle(p); };
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn().catch(() => false)) return true; await new Promise((r) => setTimeout(r, 400)); } return false; };
const errors = [];
async function login(email, opts = { viewport: { width: 1440, height: 950 } }) {
  const page = await (await browser.newContext({ ...opts, reducedMotion: "reduce" })).newPage();
  page.on("pageerror", (e) => errors.push(`${email} @ ${page.url().replace(BASE, "")}: ${e.message.slice(0, 140)}`));
  page.on("dialog", (d) => d.accept());
  await go(page, "/login");
  await page.fill("#email", email); await page.fill("#password", PASSWORD); await page.click("button[type=submit]");
  await page.waitForURL((u) => u.pathname !== "/login", { timeout: 15000 }).catch(() => {});
  await settle(page);
  return page;
}
const main = (p) => p.textContent("main");

const sa = await login("superadmin@firingi.test");
const owner = await login("owner@kebabhouse.test");
const lx = await login("owner@lisboacentral.test");

const offers = await (await owner.request.get(`${BASE}/api/catalogue/offers?q=mozzarella`)).json();
const mozzItem = offers.items.find((i) => i.vendor.name === "Lisboa Central" && i.packaging.unitsPerPack === 1);
check("found Lisboa Central's mozzarella", !!mozzItem);
const mozz = mozzItem.offerId;
const oldPrice = Number(mozzItem.price.listUnitNet);

// ── 1. Supplier: market position ──
await go(lx, "/vendor/products/price-insights");
check("supplier sees the approval rule", /FIRINGI/.test(await lx.getByTestId("price-rule").textContent()));
check("supplier sees its market position", /Entre os mais|Abaixo da mediana|Acima da mediana|Among|Below|Above/.test(await lx.getByTestId("price-insights").textContent()));
const insightsText = await main(lx);
check("no competitor names on the supplier page", !/C&C Almada|FIRINGI Armazém/.test(insightsText));
await shot(lx, "p29-01-supplier-insights");

// ── 2. Supplier raises the mozzarella price 25 % → waits for FIRINGI ──
await go(lx, "/vendor/products/catalogue");
const row = lx.getByTestId(`offer-${mozz}`);
await row.locator('input[type="number"]').first().fill((oldPrice * 1.25).toFixed(2));
await row.getByRole("button", { name: /Guardar|Save/ }).click();
check("big increase is sent to FIRINGI", await until(async () => (await row.getByTestId("price-held").count()) === 1));
const after = (await (await owner.request.get(`${BASE}/api/catalogue/offers?q=mozzarella`)).json()).items.find((i) => i.offerId === mozz);
check("customers keep the old price", Math.abs(Number(after.price.listUnitNet) - oldPrice) < 0.01, `${after.price.listUnitNet} vs ${oldPrice}`);

// ── 3. FIRINGI: dashboard and approval ──
await go(sa, "/admin/pricing/intelligence/overview");
check("dashboard counts an increase to approve", Number((await sa.getByTestId("kpi-pending").textContent()).replace(/\D/g, "")) >= 1);
check("weekly chart and movers shown", (await sa.getByTestId("weekly-changes").count()) === 1 && (await sa.getByTestId("movers").count()) === 1);
await shot(sa, "p29-02-admin-overview");
await go(sa, "/admin/pricing/intelligence/requests");
const card = sa.getByTestId("pending-requests").locator("div.motion-rise", { hasText: "Lisboa Central" }).first();
check("the increase waits with the market median", /median/.test(await card.textContent()) && /\+\d+(\.\d)? %/.test(await card.textContent()));
await shot(sa, "p29-03-admin-approvals");
await card.getByTestId("approve-change").click();
check("approved — moved to the history with customers told", await until(async () => (await sa.getByTestId("requests-history").locator("tr", { hasText: "Lisboa Central" }).filter({ hasText: /approved/ }).count()) >= 1));

// ── 4. Customer sees it coming ──
await go(owner, "/buy/catalogue/price-changes");
check("customer sees the coming increase", await until(async () => { await owner.reload(); await settle(owner); return /Mozzarella/i.test(await owner.getByTestId("upcoming-changes").textContent()); }));
await shot(owner, "p29-04-customer-price-changes");

// ── 5. Supplier sees the approval and withdraws it ──
await go(lx, "/vendor/products/price-insights");
check("supplier sees the approved change", /Aprovado|Approved/.test(await lx.getByTestId("price-requests").textContent()));
await lx.getByTestId("price-requests").getByTestId("cancel-change").first().click();
check("supplier withdrew it", await until(async () => /Retirado|Withdrawn/.test(await lx.getByTestId("price-requests").textContent())));

// ── 6. FIRINGI analysis pages ──
await go(sa, "/admin/pricing/intelligence/comparison");
check("comparison lists products sold by several suppliers", (await sa.getByTestId("comparison").locator("tbody tr").count()) >= 1);
await shot(sa, "p29-05-admin-comparison");
await go(sa, `/admin/pricing/intelligence/history`);
await sa.selectOption("#pick-product", { index: 1 });
await sa.waitForURL(/variant=/);
await settle(sa);
check("price history chart with several suppliers", (await sa.getByTestId("price-timeline").locator("svg path").count()) >= 2);
await sa.getByTestId("price-timeline").locator("svg").hover({ position: { x: 400, y: 120 } });
check("chart tooltip shows prices", await until(async () => (await sa.getByTestId("price-timeline").locator("[role=status]").count()) === 1, 4000));
await shot(sa, "p29-06-admin-history");
await go(sa, "/admin/pricing/intelligence/alerts");
await sa.getByTestId("run-pricing").click();
await until(async () => /Checked/.test(await main(sa)));
await shot(sa, "p29-07-admin-alerts");
await go(sa, "/admin/pricing/intelligence/margin?by=SUPPLIER&days=365");
check("margin heat-map", (await sa.getByTestId("heatmap").locator("tbody tr").count()) >= 1);
await shot(sa, "p29-08-admin-margin");
await go(sa, "/admin/pricing/intelligence/margin?by=BUSINESS_TYPE&days=365");
check("heat-map by customer type", (await sa.getByTestId("heatmap").count()) === 1);
await go(sa, "/admin/pricing/intelligence/suggestions");
check("suggestions page", /Commission/.test(await main(sa)) && /Price reviews/.test(await main(sa)));
await shot(sa, "p29-09-admin-suggestions");
await go(sa, "/admin/pricing/intelligence/settings");
await sa.getByTestId("ps-approvalThresholdPct").fill("12");
await sa.getByTestId("save-price-settings").click();
check("rules saved", await until(async () => /Saved/.test(await main(sa))));
await sa.getByTestId("ps-approvalThresholdPct").fill("10");
await sa.getByTestId("save-price-settings").click();
await until(async () => /Saved/.test(await main(sa)));
await shot(sa, "p29-10-admin-rules");
const cron = await sa.request.post(`${BASE}/api/cron/pricing`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET ?? "test-cron-secret-0123456789abcdef"}` } });
check("hourly pricing job runs", cron.status() === 200, String(cron.status()));

// ── 7. Phone width ──
const phone = await login("owner@lisboacentral.test", { ...devices["iPhone 13"] });
await go(phone, "/vendor/products/price-insights");
check("phone: supplier price insights fit", (await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 1);
await shot(phone, "p29-11-phone-supplier");
const phoneBuyer = await login("owner@kebabhouse.test", { ...devices["iPhone 13"] });
await go(phoneBuyer, "/buy/catalogue/price-changes");
check("phone: customer price changes fit", (await phoneBuyer.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 1);
await shot(phoneBuyer, "p29-12-phone-customer");

check("mozzarella price unchanged at the end", Math.abs(Number((await (await owner.request.get(`${BASE}/api/catalogue/offers?q=mozzarella`)).json()).items.find((i) => i.offerId === mozz).price.listUnitNet) - oldPrice) < 0.01);
check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
