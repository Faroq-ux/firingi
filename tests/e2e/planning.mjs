/**
 * Browser test of Phase 30 (demand planning & restock), as the distributor Distribuidora Atlântico
 * (Portuguese UI; demo data from `pnpm db:demo-planning`) and FIRINGI (English):
 *  the supplier recalculates its plan → dashboard tiles → restock suggestions with urgency and reasons →
 *  FIRINGI sees the stock-out risk and asks the supplier to restock → forecast list and one product's
 *  chart (method, event, measured lead time) → planning choices → lead times (measured vs promised) →
 *  own demand event → overstock & expiry risk → settings → the supplier hides one suggestion and turns
 *  two into draft purchase orders (nothing sent) → FIRINGI's accuracy, lead times, overstock, events,
 *  settings, run now → phone width → no page errors.
 *   node tests/e2e/planning.mjs [baseUrl] [screenshotDir]
 */
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");

const BASE = process.argv[2] ?? "http://localhost:3000";
const SHOTS = process.argv[3] ?? null;
const PASSWORD = process.env.SEED_PASSWORD ?? "Firingi!2026";
let failures = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "✔" : "✘"} ${name}${extra ? ` — ${extra}` : ""}`); if (!ok) failures++; };
const shot = async (page, name) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
const browser = await chromium.launch();
const settle = async (p) => { await p.waitForLoadState("networkidle").catch(() => {}); await p.waitForFunction(() => !document.querySelector("[aria-busy=true]"), null, { timeout: 15000 }).catch(() => {}); await p.waitForTimeout(400); };
const go = async (p, url) => { await p.goto(`${BASE}${url}`); await settle(p); };
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn().catch(() => false)) return true; await new Promise((r) => setTimeout(r, 400)); } return false; };
const errors = [];
async function login(email, opts = { viewport: { width: 1440, height: 950 } }) {
  const page = await (await browser.newContext({ ...opts, reducedMotion: "reduce", deviceScaleFactor: SHOTS ? 2 : 1 })).newPage();
  page.on("pageerror", (e) => errors.push(`${email} @ ${page.url().replace(BASE, "")}: ${e.message.slice(0, 140)}`));
  page.on("dialog", (d) => d.accept());
  await go(page, "/login");
  await page.fill("#email", email); await page.fill("#password", PASSWORD); await page.click("button[type=submit]");
  await page.waitForURL((u) => u.pathname !== "/login", { timeout: 15000 }).catch(() => {});
  await settle(page);
  return page;
}
const main = (p) => p.textContent("main");
const V = "/vendor/inventory/planning", A = "/admin/inventory/planning";

const atl = await login("owner@atlantico.test");
const sa = await login("superadmin@firingi.test");

// ── 1. Supplier: recalculate, dashboard ──
await go(atl, V);
await atl.getByTestId("recalc").click();
check("plan recalculated", await until(async () => /Plano atualizado|Plan updated/.test(await main(atl))));
await go(atl, V);
const n = async (id) => Number((await atl.getByTestId(id).textContent()).replace(/[^\d]/g, "").slice(0, 3) || "0");
check("out-of-stock tile counts the flour", (await n("kpi-out")) >= 1);
check("order-now tile counts kebab and rice", (await n("kpi-order-now")) >= 2);
check("expiry risk tile has a value", /€/.test(await atl.getByTestId("kpi-expiry").textContent()));
check("forecast vs actual chart", (await atl.getByTestId("accuracy-chart").locator("svg").count()) === 1);
check("most urgent list names the kebab", /kebab/i.test(await atl.getByTestId("urgent-list").textContent()));
await atl.waitForTimeout(1600); // tiles count up
await shot(atl, "p30-01-supplier-planning");

// ── 2. Restock suggestions ──
await go(atl, `${V}/restock`);
const table = atl.getByTestId("restock-table");
// match on the product link (every row's supplier list names all suppliers)
const rowOf = (re) => table.locator('[data-testid^="restock-"]').filter({ has: atl.locator("a", { hasText: re }) }).first();
const flour = rowOf(/farinha|flour/i), kebab = rowOf(/kebab/i), rice = rowOf(/arroz|rice/i);
check("flour is out of stock", /Sem stock|Out of stock/.test(await flour.getByTestId("urgency").textContent()));
check("kebab runs out before goods can arrive", /Tarde demais|Too late/.test(await kebab.getByTestId("urgency").textContent()));
check("kebab suggestion is a multiple of 10 (pallet) and ≥ 20", await (async () => { const q = Number(await kebab.getByTestId("qty").inputValue()); return q >= 20 && q % 10 === 0; })());
check("kebab is bought from the cold-chain supplier", /Frigoríficos/.test(await kebab.getByTestId("source").locator("option:checked").textContent()));
check("the reason is shown (free + on order, reorder point, lead time)", /livre .* encomendado|free .* on order/.test(await kebab.textContent()) && /prazo 7 d|lead time 7 d/.test(await kebab.textContent()));
check("rice is rounded to its pack multiple of 12", Number(await rice.getByTestId("qty").inputValue()) % 12 === 0);
await shot(atl, "p30-02-supplier-restock");

// ── 3. FIRINGI sees the stock-out risk and asks the supplier to restock ──
await go(sa, `${A}/overview`);
check("FIRINGI overview: out of stock across suppliers", Number((await sa.getByTestId("kpi-out").textContent()).replace(/[^\d]/g, "").slice(0, 3)) >= 1);
check("FIRINGI overview lists Distribuidora Atlântico", /Atlântico/.test(await sa.getByTestId("planning-suppliers").textContent()));
await sa.waitForTimeout(1600);
await shot(sa, "p30-08-admin-overview");
await go(sa, `${A}/stockouts`);
const risk = sa.getByTestId("stockouts").locator("tbody tr").filter({ hasText: /Atlântico/ }).filter({ hasText: /flour|Farinha/i }).first();
check("FIRINGI sees the flour out of stock at Atlântico", (await risk.count()) === 1 && /Out of stock/.test(await risk.textContent()));
if (await risk.getByTestId("flag-open").count()) {
  await risk.getByTestId("flag-open").click();
  await risk.locator('input[aria-label="Message"]').fill("Customers in Porto are asking for it");
  await risk.getByTestId("flag-send").click();
  check("supplier asked to restock", await until(async () => /Supplier asked|Asked/.test(await risk.textContent())));
} else check("supplier already asked (rerun within 3 days)", /Asked/.test(await risk.textContent()));
await shot(sa, "p30-09-admin-stockouts");

// ── 4. Forecast list and one product ──
await go(atl, `${V}/forecast`);
const ft = await atl.getByTestId("forecast-table").textContent();
check("forecast list shows methods", /Tendência|Trend|Média|Average|Intermitente|Intermittent/.test(ft));
await atl.getByTestId("forecast-table").locator("tbody tr").filter({ hasText: /kebab/i }).first().locator("a").first().click();
await settle(atl);
check("product chart: sales, forecast and range", (await atl.getByTestId("forecast-chart").locator("svg path").count()) >= 3);
check("the winter kebab campaign is applied", /Campanha kebab de inverno/.test(await atl.getByTestId("product-events").textContent()));
check("lead time is the measured one (7 d, not the promised 5)", /7 d · medido|7 d · measured/.test(await atl.getByTestId("plan-lead").textContent()));
check("back-test table compares methods", (await atl.getByTestId("backtest").locator("tbody tr").count()) >= 2);
await shot(atl, "p30-03-supplier-forecast");
// planning choices: save unchanged
await atl.getByTestId("save-item").click();
check("planning choices saved", await until(async () => /Guardado|Saved/.test(await atl.getByTestId("item-form").textContent())));

// ── 5. Lead times ──
await go(atl, `${V}/lead-times`);
const lt = atl.getByTestId("lead-times").locator("tbody tr").filter({ hasText: /Frigoríficos/ }).first();
check("measured lead time is longer than promised", /5 d/.test(await lt.textContent()) && /7 d/.test(await lt.textContent()));
await shot(atl, "p30-05-supplier-lead-times");

// ── 6. Own demand event ──
await go(atl, `${V}/events`);
await atl.getByTestId("ev-name").fill("E2E Promoção de verão");
await atl.getByTestId("ev-pct").fill("25");
await atl.getByTestId("save-event").click();
check("event added", await until(async () => /E2E Promoção de verão/.test(await atl.getByTestId("events").textContent())));
check("FIRINGI's public events are listed too", /Christmas & New Year/.test(await atl.getByTestId("events").textContent()));

// ── 7. Overstock & expiry ──
await go(atl, `${V}/risk`);
const exp = atl.getByTestId("expiry-risk");
check("the short-dated mozzarella lot is at risk", /MZ-2611-DEMO/.test(await exp.textContent()));
check("markdown is suggested close to the date", /Desconto|Discount|remarcações|markdowns/.test(await exp.locator("li").filter({ hasText: "MZ-2611-DEMO" }).first().textContent()));
await shot(atl, "p30-04-supplier-risk");

// ── 8. Settings ──
await go(atl, `${V}/settings`);
await atl.getByTestId("ps-serviceLevel").fill("97");
await atl.getByTestId("save-settings").click();
check("service level saved", await until(async () => /Guardado|Saved/.test(await main(atl))));
await atl.getByTestId("ps-serviceLevel").fill("");
await atl.getByTestId("save-settings").click();
await settle(atl);

// ── 9. Hide rice, order kebab + flour as draft purchase orders ──
await go(atl, `${V}/restock`);
await rowOf(/arroz|rice/i).getByTestId("dismiss").click();
await rowOf(/arroz|rice/i).getByTestId("confirm-dismiss").click();
check("rice hidden", await until(async () => (await rowOf(/arroz|rice/i).count()) === 0));
// keep only kebab and flour ticked
for (const r of await table.locator('[data-testid^="restock-"]').all()) {
  const t = await r.locator("a").first().textContent();
  const box = r.locator('input[type="checkbox"]');
  if (/kebab|farinha|flour/i.test(t)) { if (!(await box.isChecked())) await box.check(); } else if (await box.isChecked()) await box.uncheck();
}
await atl.getByTestId("make-pos").click();
check("two draft purchase orders created (one per supplier)", await until(async () => (await atl.getByTestId("made-pos").locator("a").count()) === 2));
await go(atl, `${V}/restock`);
check("ordered suggestions leave the list", (await rowOf(/kebab/i).count()) === 0);
check("decided list shows them as ordered", /Encomendado|Ordered/.test(await atl.getByTestId("decided").textContent()));
await atl.getByTestId("recalc").click();
await until(async () => /Plano atualizado|Plan updated/.test(await main(atl)));
await go(atl, `${V}/restock`);
check("drafts count as ordered — kebab not suggested again", (await rowOf(/kebab/i).count()) === 0);

// ── 10. FIRINGI: accuracy, lead times, overstock, events, settings, run now ──
await go(sa, `${A}/accuracy`);
check("accuracy by supplier", /Atlântico/.test(await sa.getByTestId("accuracy-suppliers").textContent()) && (await sa.getByTestId("accuracy-chart").locator("svg").count()) === 1);
await shot(sa, "p30-10-admin-accuracy");
await go(sa, `${A}/lead-times`);
check("lead times across suppliers", /Frigoríficos/.test(await sa.getByTestId("admin-lead-times").textContent()));
await go(sa, `${A}/overstock`);
check("overstock & expiry across suppliers", /MZ-2611-DEMO/.test(await sa.getByTestId("admin-overstock").textContent()));
await shot(sa, "p30-11-admin-overstock");
await go(sa, `${A}/events`);
await sa.getByTestId("ge-name").fill("E2E Santos Populares");
await sa.getByTestId("ge-pct").fill("30");
await sa.getByTestId("save-global-event").click();
check("FIRINGI-wide event added", await until(async () => /E2E Santos Populares/.test(await sa.getByTestId("global-events").textContent())));
await shot(sa, "p30-12-admin-events");
await go(sa, `${A}/settings`);
await sa.getByTestId("save-defaults").click();
check("defaults saved", await until(async () => /Saved/.test(await main(sa))));
await go(sa, `${A}/overview`);
await sa.getByTestId("run-planning").click();
check("FIRINGI ran planning for all suppliers", await until(async () => /Planned all suppliers/.test(await main(sa)), 60000));

// ── 11. Phone width ──
const phone = await login("owner@atlantico.test", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
for (const [url, name] of [[V, "p30-06-phone-overview"], [`${V}/restock`, "p30-07-phone-restock"], [`${V}/forecast`, null]]) {
  await go(phone, url);
  const over = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(`phone: ${url} fits the screen`, over <= 1, `overflow ${over}px`);
  if (name) { await phone.waitForTimeout(1600); await shot(phone, name); }
}

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nall planning checks passed");
process.exit(failures ? 1 : 0);
