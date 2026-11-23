/**
 * Browser test of Phase 17 (AI Centre) against a running server with the demo seed and the demo
 * buying history (pnpm db:demo-history):
 * staff — AI Insights dashboard, refresh, reorder / demand / stock / supplier / delivery pages,
 * accepting a late-reorder suggestion creates a CRM call task, activity log, assistant "not
 * connected" state with settings (no API key here: no live AI calls);
 * customer (Portuguese) — "time to reorder" on the dashboard, Buy Again puts the usual order in
 * the cart, the Assistant on by default and FIRINGI can switch it off per company (Business Features);
 * supplier — Demand & Stock page and the stock card on its dashboard; Assistant there by default.
 *   node tests/e2e/ai.mjs [baseUrl] [screenshotDir]
 */
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");

const BASE = process.argv[2] ?? "http://localhost:3000";
const SHOTS = process.argv[3] ?? null;
const PASSWORD = process.env.SEED_PASSWORD ?? "Firingi!2026";
let failures = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "✔" : "✘"} ${name}${extra ? ` — ${extra}` : ""}`); if (!ok) failures++; };
const shot = async (page, name) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
const browser = await chromium.launch();
const settle = async (p) => { await p.waitForLoadState("networkidle"); await p.waitForTimeout(500); };
const go = async (p, url) => { await p.goto(`${BASE}${url}`); await settle(p); };
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn().catch(() => false)) return true; await new Promise((r) => setTimeout(r, 400)); } return false; };
const errors = [];
async function login(email) {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 950 }, reducedMotion: "reduce" })).newPage();
  page.on("pageerror", (e) => errors.push(`${email}: ${e.message}`));
  await go(page, "/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL((u) => u.pathname !== "/login", { timeout: 15000 }).catch(() => {});
  await settle(page);
  return page;
}
const main = (p) => p.textContent("main");
const rows = (p, id) => p.getByTestId(id).locator("tbody tr").filter({ hasNot: p.locator("td[colspan]") }).count();

// ── 1. Staff: AI Insights dashboard + refresh ──
const sa = await login("superadmin@firingi.test");
await go(sa, "/admin/dashboard/ai-insights");
check("AI Insights dashboard", (await sa.getByTestId("ai-hero").count()) === 1 && (await sa.getByTestId("ai-top").count()) === 1);
await sa.getByTestId("refresh-ai").click();
await settle(sa);
let refreshed = false;
for (let i = 0; i < 60 && !refreshed; i++) { refreshed = /new, \d+ expired/.test(await main(sa)); if (!refreshed) await sa.waitForTimeout(500); }
check("refresh recomputes the suggestions", refreshed);
check("open suggestions listed", (await sa.getByTestId("ai-top").getByTestId("rec-decision").count()) > 0);
check("demand forecasts drawn", (await sa.getByTestId("ai-demand").locator("svg").count()) > 0);
await shot(sa, "p17-01-ai-insights");

// ── 2. Insight pages ──
await go(sa, "/admin/ai/recommendations?area=CUSTOMERS");
const cc = sa.getByTestId("ins-reorders").locator("tr", { hasText: "C&C Almada" }).filter({ hasText: "Atlântico" });
check("C&C Almada is late with its usual Atlântico order", (await cc.count()) === 1 && /days late/.test(await cc.textContent()));
await shot(sa, "p17-02-reorder");
await go(sa, "/admin/ai/forecasting?tab=DEMAND");
check("demand forecast table with sparklines", (await rows(sa, "fc-demand")) > 0 && (await sa.getByTestId("fc-demand").locator("svg").count()) > 0);
await shot(sa, "p17-03-demand");
await go(sa, "/admin/ai/forecasting?tab=INVENTORY");
check("stock predictions", (await rows(sa, "fc-inventory")) > 0);
for (const [url, id] of [["/admin/ai/recommendations?area=SUPPLIERS", "ins-suppliers"], ["/admin/ai/recommendations?area=PRICING", "ins-pricing"], ["/admin/ai/recommendations?area=ROUTES", "ins-delivery"], ["/admin/ai/reports?tab=FRAUD", "rep-summary"], ["/admin/ai/recommendations?area=ROUTES", "ins-routes"]]) {
  await go(sa, url);
  check(`${url} renders`, (await sa.getByTestId(id).count()) === 1);
}

// ── 3. Who gets the AI Centre: Super Admin by default, other staff only through a role ──
const sales = await login("sales@firingi.test");
check("Sales staff without the AI right don't see the AI Centre", (await sales.locator("aside").getByText("AI Centre", { exact: true }).count()) === 0 && (await sales.locator("aside").getByText(/Centro de IA/).count()) === 0);
await go(sales, "/admin/ai/recommendations");
check("Sales staff without the AI right are blocked", sales.url().endsWith("/forbidden"), sales.url());

// ── 3b. Accept a late reorder → CRM call task for the account owner ──
await go(sa, "/admin/ai/recommendations?area=CUSTOMERS&kind=REORDER_DUE");
// C&C Almada late with its usual Atlântico order (not Kebab House late with C&C Almada as supplier)
const rec = sa.getByTestId("recommendations").locator("tr", { hasText: /C&C Almada is \d+ days late reordering/ }).first();
// A suggestion is made once per situation: on a rerun this week it may already be accepted.
const already = !(await rec.count());
check("late reorder suggested to staff", already || (await rec.getByRole("button", { name: "Create call task" }).count()) === 1, already ? "already accepted earlier" : "");
if (!already) { await rec.getByRole("button", { name: "Create call task" }).click(); await settle(sa); }
await go(sa, "/admin/ai/recommendations?area=CUSTOMERS&kind=REORDER_DUE&status=ACCEPTED");
check("suggestion accepted", (await sa.getByTestId("recommendations").locator("tr", { hasText: "C&C Almada" }).count()) > 0);
// The task goes to C&C Almada's account owner (Super Admin when the account has none) — look at the team list.
await go(sa, "/admin/crm/follow-ups?who=all");
check("CRM call task created for the account owner", /Call C&C Almada/.test(await main(sa)));
await shot(sa, "p17-04-recommendations");

// ── 4. Assistant (no API key here) + activity log ──
await go(sa, "/admin/ai/assistant");
check("assistant explains how to connect it", (await sa.getByTestId("assistant-off").count()) === 1 && /ANTHROPIC_API_KEY/.test(await main(sa)));
check("AI settings for admins", (await sa.getByTestId("ai-settings").count()) === 1 && (await sa.locator("#ai-model option").count()) === 3);
await shot(sa, "p17-05-assistant");
await go(sa, "/admin/ai/activity-log");
const log = await main(sa);
check("activity log shows refreshes and decisions", /refresh/.test(log) && /accept/.test(log));
const support = await login("support@firingi.test");
await go(support, "/admin/ai/forecasting");
check("support (no AI right) is blocked", support.url().endsWith("/forbidden"), support.url());

// ── 5. Customer (Portuguese): time to reorder, buy again ──
const k = await login("owner@kebabhouse.test");
await go(k, "/buy/orders/cart");
const clear = k.getByRole("button", { name: /Esvaziar carrinho|Clear cart/ });
if (await clear.count()) { await clear.click(); await settle(k); }
await go(k, "/buy/dashboard/overview");
check("dashboard: time to reorder (Portuguese)", (await k.getByTestId("reorder-card").count()) === 1 && /Hora de voltar a encomendar/.test(await k.getByTestId("reorder-card").textContent()));
await shot(k, "p17-06-buyer-dashboard");
await go(k, "/buy/orders/buy-again");
const usual = k.getByTestId("usual-order").filter({ hasText: "C&C Almada" });
check("buy again lists the usual C&C Almada order, late", (await usual.count()) === 1 && /mais tarde do que o habitual/.test(await usual.textContent()));
await usual.getByRole("button", { name: "Adicionar ao carrinho" }).click();
await settle(k);
let addedMsg = false;
for (let i = 0; i < 30 && !addedMsg; i++) { addedMsg = /\d+ produtos adicionados ao carrinho/.test((await usual.textContent()) ?? ""); if (!addedMsg) await k.waitForTimeout(500); }
check("usual order put in the cart", addedMsg);
await shot(k, "p17-07-buy-again");
await go(k, "/buy/orders/cart");
check("cart holds C&C Almada's products", /C&C Almada/.test(await main(k)));
const clear2 = k.getByRole("button", { name: /Esvaziar carrinho|Clear cart/ });
if (await clear2.count()) { await clear2.click(); await settle(k); }
// The Assistant: on for every customer and supplier; FIRINGI can switch it off per company (Settings › Business Features).
await go(k, "/buy/assistant");
check("customer: menu shows \"Assistente\" by default (not \"Assistente IA\")", (await k.locator("aside").getByText(/^Assistente$/).count()) > 0 && (await k.locator("aside").getByText(/Assistente IA/).count()) === 0);
check("customer Assistant page in Portuguese", /Assistente/.test(await k.locator("h1").textContent()) && /assistente da FIRINGI/.test(await main(k)));
await go(sa, "/admin/settings/business-features");
check("Business Features: Assistant on by default", /the Assistant and its photos are on by default/.test(await main(sa)));
const kRow = sa.getByTestId("business-features").locator("tr", { hasText: "Kebab House" }).first();
check("Kebab House: Assistant on", (await kRow.getByTestId("assistant-switch").getAttribute("aria-checked")) === "true");
await kRow.getByTestId("assistant-switch").click();
await settle(sa);
check("FIRINGI switched the Assistant off for Kebab House", await until(async () => (await kRow.getByTestId("assistant-switch").getAttribute("aria-checked")) === "false"));
await shot(sa, "p17-08-business-features-assistant");
check("switched off → hidden from the customer", await until(async () => (await k.request.get(`${BASE}/buy/assistant`)).status() === 404));
await go(k, "/buy/dashboard/overview");
check("…and gone from the menu", (await k.locator("aside").getByText(/^Assistente$/).count()) === 0);
await kRow.getByTestId("assistant-switch").click();
await settle(sa);
check("switched on again → back", await until(async () => (await k.request.get(`${BASE}/buy/assistant`)).status() === 200));
check("nav shows Comprar de Novo", (await k.locator("aside").getByText("Comprar de Novo").count()) > 0);

// ── 6. Supplier: Demand & Stock ──
const atl = await login("owner@atlantico.test");
check("supplier: Assistant there by default", (await atl.locator("aside").getByText(/^Assistente$/).count()) > 0 && (await atl.request.get(`${BASE}/vendor/assistant`)).status() === 200);
await go(atl, "/vendor/reports/demand");
check("supplier demand forecast", (await rows(atl, "vendor-demand")) > 0);
check("supplier sees customers due to reorder", /C&C Almada/.test(await atl.getByTestId("vendor-due").textContent()));
await shot(atl, "p17-08-vendor-demand");
await go(atl, "/vendor/dashboard/overview");
check("supplier dashboard stock card", (await atl.getByTestId("stock-card").count()) === 1);

check("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nAll AI e2e checks passed");
process.exit(failures ? 1 : 0);
