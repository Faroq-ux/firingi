/**
 * Browser test of Phase 16 against a running server with the demo seed:
 * superadmin tightens the risk thresholds (Fraud Detection) → Kebab House (Portuguese) orders →
 * the order is held ("being checked"), the supplier doesn't see it → Suspicious Orders: release →
 * the supplier now sees it. Four-eyes: finance raises Kebab House's credit limit above the
 * threshold → "sent for approval" → sales approves on Approval Workflows → the limit changes.
 * Order Split page. Thresholds restored.
 *   node tests/e2e/risk.mjs [baseUrl] [screenshotDir]
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
const setNum = async (p, id, v) => { await p.locator(`#${id}`).fill(String(v)); };

// ── 1. Tighten the thresholds (Fraud Detection) ──
const sa = await login("superadmin@firingi.test");
await go(sa, "/admin/risk/fraud");
check("fraud detection page", (await sa.getByTestId("risk-kpis").count()) === 1 && (await sa.getByTestId("risk-settings").count()) === 1);
const rs = sa.getByTestId("risk-settings");
const original = {};
for (const k of ["holdScore", "flagScore", "bigOrderAmount", "newAccountDays"]) original[k] = await sa.locator(`#risk-${k}`).inputValue();
const wasOn = await rs.locator('input[name="riskEnabled"]').isChecked();
if (!wasOn) await rs.locator('input[name="riskEnabled"]').check();
await setNum(sa, "risk-newAccountDays", 100000);
await setNum(sa, "risk-bigOrderAmount", 50);
await rs.getByRole("button", { name: "Save risk settings" }).click();
await settle(sa);
check("risk settings saved", /Saved/.test(await rs.textContent()));

// ── 2. Customer orders → held ──
const customer = await login("owner@kebabhouse.test");
const api = await (await customer.request.get(`${BASE}/api/catalogue/offers?q=mozzarella`)).json();
const offer = api.items.find((i) => i.vendor.name === "Lisboa Central" && i.packaging.unitsPerPack === 1);
await go(customer, "/buy/orders/cart");
const clear = customer.getByRole("button", { name: /Esvaziar carrinho|Clear cart/ });
if (await clear.count()) { await clear.click(); await settle(customer); }
await go(customer, `/buy/catalogue/offers/${offer.offerId}`);
await customer.locator('main input[type="number"]').first().fill("10");
await customer.getByRole("button", { name: /Adicionar ao carrinho|Add to cart/ }).click();
await settle(customer);
await go(customer, "/buy/orders/cart");
await customer.getByRole("button", { name: /Fazer encomenda|Place order/ }).click();
await customer.waitForURL("**placed=1", { timeout: 15000 });
await settle(customer);
const orderUrl = customer.url().split("?")[0];
const orderId = orderUrl.split("/").pop();
const number = (await main(customer)).match(/FO-\d{4}-\d{6}/)[0];
check("order held, customer told it's being checked (Portuguese)", /Em verificação/.test(await main(customer)) && (await customer.getByTestId("held-note").count()) === 1, number);
await shot(customer, "p16-01-held-order");

const vendor = await login("owner@lisboacentral.test");
await go(vendor, "/vendor/orders/incoming");
check("supplier doesn't see the held order", !(await main(vendor)).includes(number));

// ── 3. Suspicious Orders: release ──
await go(sa, "/admin/risk/suspicious-orders");
const row = sa.getByTestId("suspicious-orders").locator("tr", { hasText: number });
check("held order listed with its reasons", (await row.count()) === 1 && /held/.test(await row.textContent()) && /account/.test(await row.textContent()));
await shot(sa, "p16-02-suspicious-orders");
await row.getByPlaceholder(/Note/).fill("Called the customer — fine");
await row.getByRole("button", { name: "Release to supplier" }).click();
await settle(sa);
await go(vendor, "/vendor/orders/incoming");
check("released: the supplier now sees it", (await main(vendor)).includes(number));
await go(customer, orderUrl.replace(BASE, ""));
check("customer's order now waits for the supplier", /A aguardar confirmação/.test(await main(customer)));

// restore the thresholds
await go(sa, "/admin/risk/fraud");
for (const [k, v] of Object.entries(original)) await setNum(sa, `risk-${k}`, v);
if (!wasOn) await sa.getByTestId("risk-settings").locator('input[name="riskEnabled"]').uncheck();
await sa.getByTestId("risk-settings").getByRole("button", { name: "Save risk settings" }).click();
await settle(sa);

// ── 4. Four-eyes: credit limit ──
const fin = await login("finance@firingi.test");
await go(fin, "/admin/customers/credit");
const kebabRow = fin.locator("tr", { hasText: "Kebab House" }).first();
const limitInput = kebabRow.getByLabel("Credit limit");
const oldLimit = await limitInput.inputValue();
if (!oldLimit) { await limitInput.fill("2000"); await kebabRow.getByRole("button", { name: "Save" }).click(); await settle(fin); }
await fin.locator("tr", { hasText: "Kebab House" }).first().getByLabel("Credit limit").fill("75000");
await fin.locator("tr", { hasText: "Kebab House" }).first().getByRole("button", { name: "Save" }).click();
await settle(fin);
check("raising the limit is sent for approval", /Sent for approval/.test(await fin.getByTestId("approval-pending").first().textContent()));
await go(fin, "/admin/users/approval-workflows");
const req = fin.getByTestId("approvals-table").locator("tr", { hasText: "75000" }).first();
check("requester sees it waiting, can only withdraw", (await req.count()) === 1 && (await req.getByRole("button", { name: "Approve" }).count()) === 0 && (await req.getByRole("button", { name: "Withdraw" }).count()) === 1);
const sales = await login("sales@firingi.test");
await go(sales, "/admin/users/approval-workflows");
const sreq = sales.getByTestId("approvals-table").locator("tr", { hasText: "75000" }).first();
await shot(sales, "p16-03-approvals");
await sreq.getByRole("button", { name: "Approve" }).click();
await settle(sales);
await go(fin, "/admin/customers/credit");
check("approved by a second person: the new limit applies", (await fin.locator("tr", { hasText: "Kebab House" }).first().getByLabel("Credit limit").inputValue()) === "75000");
// put the limit back: lowering needs no approval; back to "no limit" (the most generous) does
await fin.locator("tr", { hasText: "Kebab House" }).first().getByLabel("Credit limit").fill(oldLimit);
await fin.locator("tr", { hasText: "Kebab House" }).first().getByRole("button", { name: "Save" }).click();
await settle(fin);
if (!oldLimit) {
  await go(sales, "/admin/users/approval-workflows");
  await sales.getByTestId("approvals-table").locator("tr", { hasText: "75000 → none" }).first().getByRole("button", { name: "Approve" }).click();
  await settle(sales);
}
await go(fin, "/admin/customers/credit");
check("limit restored", (await fin.locator("tr", { hasText: "Kebab House" }).first().getByLabel("Credit limit").inputValue()) === oldLimit);

// ── 5. Order split ──
await go(sa, "/admin/orders/split");
check("order split page", (await sa.getByTestId("split-checkouts").count()) === 1 && (await sa.getByTestId("moved-orders").count()) === 1);

check("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nAll risk e2e checks passed");
process.exit(failures ? 1 : 0);
