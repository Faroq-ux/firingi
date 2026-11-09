/**
 * Browser test of Phase 9 against a running server with the demo seed:
 * margin floor → customer order → supplier declines → FIRINGI moves it to C&C Almada →
 * buyer and new supplier see the link → Control Tower / history; then an excluded supplier
 * leaves an open case that the back office solves with a manual move.
 *   node tests/e2e/allocation.mjs [baseUrl] [screenshotDir]
 */
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");

const BASE = process.argv[2] ?? "http://localhost:3000";
const SHOTS = process.argv[3] ?? null;
const PASSWORD = process.env.SEED_PASSWORD ?? "Firingi!2026";
let failures = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "✔" : "✘"} ${name}${extra ? ` — ${extra}` : ""}`); if (!ok) failures++; };
const shot = async (page, name, full = true) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: full });
const browser = await chromium.launch();
const settle = async (p) => { await p.waitForLoadState("networkidle"); await p.waitForTimeout(500); };
const go = async (p, url) => { await p.goto(`${BASE}${url}`); await settle(p); };
const errors = [];
async function login(email) {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 950 } })).newPage();
  page.on("pageerror", (e) => errors.push(`${email}: ${e.message}`));
  await go(page, "/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await settle(page);
  return page;
}
const main = (p) => p.textContent("main");
const saveRules = async (p) => {
  const btn = p.getByTestId("rules-form").getByRole("button", { name: "Save" });
  if (await btn.isEnabled()) { await btn.click(); await settle(p); }
};

const sa = await login("superadmin@firingi.test");
const customer = await login("owner@kebabhouse.test");
const lx = await login("owner@lisboacentral.test");
const cca = await login("owner@ccalmada.test");

// ── 0. Rules: FIRINGI may absorb up to 10 % (C&C Almada is a little dearer) ──
await go(sa, "/admin/allocation/margin-rules");
const floorBefore = await sa.inputValue('input[name="minMarginPercent"]');
await sa.fill('input[name="minMarginPercent"]', "-10");
await saveRules(sa);
await go(sa, "/admin/allocation/margin-rules");
check("margin floor saved", (await sa.inputValue('input[name="minMarginPercent"]')) === "-10");
await shot(sa, "p9-01-margin-rules");
// This test is about wholesalers: keep FIRINGI's in-house warehouse out of it.
await go(sa, "/admin/allocation/auto-allocation");
const inHouseForm = sa.locator('[data-testid="rules-form"]', { has: sa.locator('select[name="inHouse"]') });
const inHouseBefore = await sa.inputValue('select[name="inHouse"]');
await sa.selectOption('select[name="inHouse"]', "OFF");
if (await inHouseForm.getByRole("button", { name: "Save" }).isEnabled()) { await inHouseForm.getByRole("button", { name: "Save" }).click(); await settle(sa); }
await go(sa, "/admin/allocation/stock-availability?q=FIR-MOZZ2");
check("stock across suppliers lists C&C Almada", (await main(sa)).includes("C&C Almada"));

async function placeMozzOrder(qty) {
  const api = await (await customer.request.get(`${BASE}/api/catalogue/offers?q=mozzarella`)).json();
  const offer = api.items.find((i) => i.vendor.name === "Lisboa Central" && i.packaging.unitsPerPack === 1);
  await go(customer, "/buy/orders/cart");
  const clear = customer.getByRole("button", { name: /Esvaziar carrinho|Clear cart/ });
  if (await clear.count()) { await clear.click(); await settle(customer); }
  await go(customer, `/buy/catalogue/offers/${offer.offerId}`);
  await customer.locator('main input[type="number"]').first().fill(String(qty));
  await customer.getByRole("button", { name: /Adicionar ao carrinho|Add to cart/ }).click();
  await settle(customer);
  await go(customer, "/buy/orders/cart");
  await customer.getByRole("button", { name: /Fazer encomenda|Place order/ }).click();
  await customer.waitForURL("**placed=1", { timeout: 15000 });
  await settle(customer);
  return { id: customer.url().split("/").pop().split("?")[0], number: (await main(customer)).match(/FO-\d{4}-\d{6}/)[0] };
}
async function decline(id) {
  await go(lx, `/vendor/orders/${id}`);
  await lx.fill("#reason", "Sem stock");
  await lx.getByRole("button", { name: /Cancelar encomenda|Cancel order/ }).click();
  await settle(lx);
  // The customer chose Lisboa Central, so the customer decides: let FIRINGI find another.
  await go(customer, `/buy/orders/${id}`);
  await customer.getByTestId("decision-panel").getByRole("button", { name: "Deixar a FIRINGI encontrar outro grossista" }).click();
  await customer.getByTestId("decision-done").waitFor();
}

// ── 1. Supplier declines → customer lets FIRINGI find another → moved ──
const first = await placeMozzOrder(5);
await decline(first.id);
await go(customer, `/buy/orders/${first.id}`);
const movedTo = customer.getByTestId("moved-to");
check("buyer sees the order was passed on", (await movedTo.count()) === 1 && (await movedTo.textContent()).includes("C&C Almada"));
const childHref = await movedTo.locator("a").first().getAttribute("href");
const childNumber = (await movedTo.locator("a").first().textContent()).trim();
await shot(customer, "p9-02-buyer-original");
await go(customer, childHref);
check("new order says what it replaces (Portuguese)", (await customer.getByTestId("moved-from").textContent()).includes(`substitui a encomenda ${first.number}`));
await customer.getByTestId("bell").click();
await customer.waitForTimeout(400);
check("buyer notified of the new supplier", (await customer.getByTestId("bell-panel").textContent()).includes(`Encomenda ${first.number}: novo fornecedor`));
const childId = childHref.split("/").pop();
await go(cca, `/vendor/orders/${childId}`);
const passed = await cca.getByTestId("moved-from").textContent();
check("new supplier sees it was passed on, without the competitor's order", passed.includes("passou-lhe esta encomenda") && !passed.includes(first.number));

await go(sa, "/admin/allocation/control-tower");
check("control tower counts the move", Number((await sa.getByTestId("kpi-moved").textContent()).match(/\d+/)[0]) >= 1);
check("recent moves list it", (await main(sa)).includes(first.number) && (await main(sa)).includes(childNumber));
await shot(sa, "p9-03-control-tower");
await go(sa, `/admin/allocation/allocation-history?order=${first.id}`);
const hist = await main(sa);
check("history shows the automatic move", hist.includes("Supplier declined") && hist.includes("Moved") && hist.includes("Automatic"));

// ── 2. Excluded supplier → open case → manual move ──
await go(sa, "/admin/allocation/vendor-priority");
const ccaRow = sa.locator("tr", { hasText: "C&C Almada" });
await ccaRow.locator('input[name="excluded"]').check();
await ccaRow.getByRole("button", { name: "Save" }).click();
await settle(sa);
const second = await placeMozzOrder(5);
await decline(second.id);
await go(sa, "/admin/allocation/control-tower");
const openCase = sa.getByTestId("open-case").filter({ hasText: second.number });
check("no supplier found → open case in the control tower", (await openCase.count()) === 1);
await openCase.getByRole("link", { name: /Decide/ }).click();
await settle(sa);
const cand = sa.locator('[data-testid^="cand-"]', { hasText: "C&C Almada" });
check("manual page explains why C&C Almada was skipped", (await cand.textContent()).includes("Excluded by FIRINGI"));
await go(sa, "/admin/allocation/vendor-priority");
await sa.locator("tr", { hasText: "C&C Almada" }).locator('input[name="excluded"]').uncheck();
await sa.locator("tr", { hasText: "C&C Almada" }).getByRole("button", { name: "Save" }).click();
await settle(sa);
await go(sa, `/admin/allocation/manual-allocation?order=${second.id}`);
await shot(sa, "p9-04-manual");
const cand2 = sa.locator('[data-testid^="cand-"]', { hasText: "C&C Almada" });
await cand2.getByRole("button", { name: "Move here" }).click();
await sa.fill('input[name="moveNote"]', "Customer asked to keep the order");
await sa.getByRole("button", { name: "Confirm move" }).click();
await settle(sa);
check("manual move creates the new order", /Moved → FO-\d{4}-\d{6}/.test(await main(sa)));
await go(sa, "/admin/allocation/control-tower");
check("case closed after the manual move", (await sa.getByTestId("open-case").filter({ hasText: second.number }).count()) === 0);
await go(sa, "/admin/allocation/allocation-overrides");
check("overrides list the manual move", (await main(sa)).includes(second.number) && (await main(sa)).includes("Super Admin"));

// ── 3. Other pages, scheduled check, permissions ──
for (const p of ["auto-allocation", "distributor-vs-wholesaler", "distance-rules", "route-matching", "existing-order-matching", "delivery-capacity", "manual-allocation"]) {
  const res = await sa.goto(`${BASE}/admin/allocation/${p}`);
  await settle(sa);
  check(`/admin/allocation/${p} renders`, res.status() === 200 && !/Application error|Something went wrong/.test(await main(sa)));
}
await go(sa, "/admin/allocation/auto-allocation");
await shot(sa, "p9-05-auto");
await sa.getByRole("button", { name: "Check unanswered orders now" }).click();
await settle(sa);
check("scheduled check runs on demand", /\d+ overdue · \d+ moved/.test(await sa.getByTestId("run-result").textContent()));
const fin = await login("finance@firingi.test");
await go(fin, "/admin/allocation/control-tower");
check("finance can't open allocation", fin.url().includes("/forbidden"), fin.url());

// cleanup: restore the floor; the buyer cancels the moved orders (frees C&C Almada's stock)
await go(sa, "/admin/allocation/margin-rules");
await sa.fill('input[name="minMarginPercent"]', floorBefore || "0");
await saveRules(sa);
await go(sa, "/admin/allocation/auto-allocation");
await sa.selectOption('select[name="inHouse"]', inHouseBefore || "SMALL_ORDERS");
if (await inHouseForm.getByRole("button", { name: "Save" }).isEnabled()) { await inHouseForm.getByRole("button", { name: "Save" }).click(); await settle(sa); }
for (const o of [first, second]) {
  await go(customer, `/buy/orders/${o.id}`);
  for (const href of await customer.getByTestId("moved-to").locator("a").evaluateAll((as) => as.map((a) => a.getAttribute("href")))) {
    await go(customer, href);
    const btn = customer.getByRole("button", { name: /Cancelar encomenda|Cancel order/ });
    if (await btn.count()) { await customer.fill("#reason", "e2e cleanup"); await btn.click(); await settle(customer); }
  }
}

check("no browser errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll allocation e2e checks passed");
process.exit(failures ? 1 : 0);
