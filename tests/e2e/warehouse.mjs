/**
 * Browser test of Phase 25 (warehouse operations & traceability), as the wholesaler Lisboa Central
 * (Portuguese UI), its customer Kebab House and FIRINGI staff (English):
 *  shelves (a range, put a new lot on a shelf, shelf labels PDF) → the customer orders → the supplier
 *  accepts → pick list in shelf order → wrong scan refused, lots confirmed by scanning → packed (order
 *  ready, packing slip + box labels PDF) → FIRINGI delivers → scanner (lot, shelf) → trace the lot →
 *  recall it → the customer sees the recall notice, acknowledges and reports → FIRINGI's recalls and
 *  trace pages → phone width → no page errors.
 *   node tests/e2e/warehouse.mjs [baseUrl] [screenshotDir]
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
const settle = async (p) => { await p.waitForLoadState("networkidle").catch(() => {}); await p.waitForTimeout(400); };
const go = async (p, url) => { await p.goto(`${BASE}${url}`); await settle(p); };
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn().catch(() => false)) return true; await new Promise((r) => setTimeout(r, 400)); } return false; };
const errors = [];
async function login(email, opts = { viewport: { width: 1440, height: 950 } }) {
  const page = await (await browser.newContext({ ...opts, reducedMotion: "reduce" })).newPage();
  page.on("pageerror", (e) => errors.push(`${email} @ ${page.url().replace(BASE, "")}: ${e.message.slice(0, 140)}`));
  await go(page, "/login");
  await page.fill("#email", email); await page.fill("#password", PASSWORD); await page.click("button[type=submit]");
  await page.waitForURL((u) => u.pathname !== "/login", { timeout: 15000 }).catch(() => {});
  await settle(page);
  return page;
}
const stamp = Date.now().toString(36).slice(-5).toUpperCase();
const LOT = `WH-${stamp}`;
const iso = (days) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const isPdf = async (page, url) => { const r = await page.request.get(`${BASE}${url}`); return r.ok() && (r.headers()["content-type"] ?? "").includes("pdf") && (await r.body()).subarray(0, 4).toString() === "%PDF"; };
const scan = async (page, testId, code) => { const i = page.getByTestId(testId); await i.fill(code); await i.press("Enter"); await settle(page); };

const lx = await login("owner@lisboacentral.test");
const kebab = await login("owner@kebabhouse.test");
const sa = await login("superadmin@firingi.test");

// ── 1. Shelves ──
await go(lx, "/vendor/warehouse/shelves");
check("menu shows the Armazém section (Portuguese)", /Preparação e Embalagem/.test(await lx.locator("aside").textContent()));
await lx.fill("#br-a", "W"); await lx.fill("#br-r", "2"); await lx.fill("#br-l", "2");
await lx.getByTestId("bin-range-form").getByRole("button", { name: /Criar 4 prateleiras/ }).click();
check("a range of shelves is created (or already there)", await until(async () => (await lx.getByTestId("shelves-table").textContent()).includes("W-01-1")));
const binLink = await lx.getByTestId("shelves-table").getByRole("link", { name: "W-01-1" }).first().getAttribute("href");
const binId = binLink.split("/").pop();
check("shelf labels print as a PDF with QR codes", await isPdf(lx, `/api/warehouse/labels/bins?ids=${binId}`));

// a new lot comes in, expiring tomorrow (first to expire, first out), and goes on shelf W-01-1
// (Armazém Lisboa holds most of the stock, so orders reserve there)
await go(lx, "/vendor/inventory/overview");
const mozzId = await lx.locator("#rc-offer option", { hasText: "Bloco 2kg · GRO-MOZZ2" }).first().getAttribute("value");
await lx.selectOption("#rc-offer", mozzId);
await lx.fill("#rc-qty", "30"); await lx.fill("#rc-cost", "8"); await lx.fill("#rc-lot", LOT); await lx.fill("#rc-exp", iso(1));
await lx.getByTestId("receive-form").getByRole("button", { name: /Receber/ }).click();
check("lot received", await until(async () => /Guardado/.test(await lx.getByTestId("receive-form").textContent())));
await go(lx, "/vendor/warehouse/shelves");
const loose = lx.getByTestId("unshelved").locator("li", { hasText: LOT });
check("the new lot waits to be put away", (await loose.count()) === 1);
await loose.locator("select").selectOption({ label: "W-01-1" });
await loose.getByRole("button", { name: /Colocar/ }).click();
check("lot put on shelf W-01-1", await until(async () => !(await lx.getByTestId("unshelved").locator("li", { hasText: LOT }).count())));
await shot(lx, "p25-01-shelves");

// ── 2. The customer orders, the supplier accepts ──
await go(kebab, "/buy/orders/cart");
const clear = kebab.getByRole("button", { name: /Esvaziar carrinho|Clear cart/ });
if (await clear.count()) { await clear.click(); await settle(kebab); }
await go(kebab, `/buy/catalogue/offers/${mozzId}`);
await kebab.locator('input[type="number"]').first().fill("6");
await kebab.getByRole("button", { name: /Adicionar ao carrinho|Add to cart/ }).click();
await settle(kebab);
await go(kebab, "/buy/orders/cart");
await kebab.getByRole("button", { name: /Fazer encomenda|Place order/ }).click();
await kebab.waitForURL("**/buy/orders/**placed=1", { timeout: 15000 }).catch(() => {});
await settle(kebab);
const orderId = new URL(kebab.url()).pathname.split("/").pop();
const number = (await kebab.textContent("main")).match(/FO-\d{4}-\d{6}/)?.[0];
check("customer placed the order", !!number, number);
await go(lx, `/vendor/orders/${orderId}`);
await lx.getByRole("button", { name: /Confirmar encomenda|Confirm order/ }).click();
check("supplier accepted it", await until(async () => !(await lx.getByRole("button", { name: /Confirmar encomenda|Confirm order/ }).count())));

// ── 3. Pick list in shelf order, scan-verified ──
await go(lx, "/vendor/warehouse/pick");
check("pick & pack tiles show", /Encomendas por preparar/.test(await lx.getByTestId("pick-kpis").textContent()));
const boxes = lx.locator('[data-testid^="pick-order-"]');
for (let i = 0; i < await boxes.count(); i++) if (await boxes.nth(i).isChecked()) await boxes.nth(i).uncheck();
await lx.getByTestId(`pick-order-${number}`).check();
await shot(lx, "p25-02-new-pick-list");
await lx.getByTestId("create-pick-list").click();
await lx.waitForURL(/\/vendor\/warehouse\/pick\/[a-z0-9]+$/, { timeout: 15000 });
await settle(lx);
const pickUrl = new URL(lx.url()).pathname;
check("pick list opens with the next shelf to go to", (await lx.getByTestId("pick-bin").textContent()).trim().length > 0, await lx.getByTestId("pick-bin").textContent());
// the order took the lot that expires first — this run's lot, or one left on W-01-1 by an earlier run
const PICKED_LOT = (await lx.getByTestId("pick-lot").textContent()).trim();
check("the shelved lot is on the list, at its shelf", /W-01-1/.test(await lx.getByTestId("pick-lines").textContent()) && /^WH-/.test(PICKED_LOT), PICKED_LOT);
await shot(lx, "p25-03-picking");
await scan(lx, "pick-scan", "NOT-A-REAL-CODE");
check("a wrong scan is refused", await until(async () => /não é o produto|Lote errado/.test(await lx.getByTestId("pick-feedback").textContent())));
for (let n = 0; n < 8 && !(await lx.getByTestId("pick-all-done").count()); n++) {
  const lot = (await lx.getByTestId("pick-lot").textContent()).trim();
  const take = (await lx.getByTestId("pick-take").textContent()).trim();
  if (lot === "—") { await lx.getByTestId("pick-manual").click(); await settle(lx); continue; }
  await lx.fill("#pk-qty", take);
  await scan(lx, "pick-scan", lot);
  await until(async () => (await lx.getByTestId("pick-all-done").count()) > 0 || /Recolhido/.test(await lx.getByTestId("pick-feedback").textContent()), 8000);
}
check("every line picked by scanning", await until(async () => (await lx.getByTestId("pick-all-done").count()) > 0));
const pack = lx.getByTestId(`pack-order-${number}`);
await pack.locator('input[type="number"]').fill("2");
await pack.getByRole("button", { name: /Embalada — pronta para recolha/ }).click();
check("order packed in 2 boxes", await until(async () => /Embalada · 2 volumes/.test(await lx.getByTestId(`pack-order-${number}`).textContent())));
const plId = pickUrl.split("/").pop();
check("packing slip prints as a PDF", await isPdf(lx, `/api/warehouse/pick-lists/${plId}/slip?order=${orderId}`));
check("box labels print as a PDF", await isPdf(lx, `/api/warehouse/pick-lists/${plId}/boxes?order=${orderId}`));
await shot(lx, "p25-04-packed");
await go(lx, `/vendor/orders/${orderId}`);
check("the order is ready for pickup", /Pronta para recolha|Ready for pickup/.test(await lx.textContent("main")));

// FIRINGI moves it on to delivered (whoever delivers it)
for (const s of ["Expedida|Dispatched", "Em distribuição|Out for delivery", "Entregue|Delivered"]) {
  await go(sa, `/admin/orders/${orderId}`);
  const b = sa.getByRole("button", { name: new RegExp(`: (${s})$`) });
  if (await b.count()) { await b.first().click(); await until(async () => !(await sa.getByRole("button", { name: new RegExp(`: (${s})$`) }).count()), 15000); }
}
await go(sa, `/admin/orders/${orderId}`);
check("order delivered", (await sa.getByRole("button", { name: /: (Devolvida|Returned)$/ }).count()) > 0);

// ── 4. Scanner ──
await go(lx, "/vendor/warehouse/scan");
await scan(lx, "scan-input", "w-01-1");
check("scanning a shelf code shows the shelf", await until(async () => (await lx.getByTestId("scan-result").getAttribute("data-kind")) === "BIN"));
await scan(lx, "scan-input", number);
check("scanning an order number finds the order", await until(async () => (await lx.getByTestId("scan-result").getAttribute("data-kind")) === "ORDER"));
await scan(lx, "scan-input", "XYZ-NOTHING");
check("an unknown code says so", await until(async () => (await lx.getByTestId("scan-result").getAttribute("data-kind")) === "UNKNOWN"));

// ── 5. Trace & recall ──
await go(lx, `/vendor/warehouse/trace?offer=${mozzId}&lot=${encodeURIComponent(PICKED_LOT)}`);
const tv = await lx.getByTestId("trace-view").textContent();
check("trace shows where the lot came from and the order it left on", tv.includes(PICKED_LOT) && tv.includes(number));
await shot(lx, "p25-05-trace");
await lx.fill("#rc-r", "Listeria found in a lab test (E2E)");
await lx.selectOption("#rc-c", "CLASS_I");
await lx.getByTestId("recall-confirm").check();
await lx.getByTestId("recall-form").getByRole("button", { name: /Iniciar recolha/ }).click();
await lx.waitForURL(/\/vendor\/warehouse\/recalls\/[a-z0-9]+$/, { timeout: 30000 }).catch(() => {});
await settle(lx);
const rv = await lx.getByTestId("recall-view").textContent().catch(() => "");
check("recall started: lot blocked, customer told", /Aberta/.test(rv) && /Kebab House/.test(await lx.getByTestId("recall-recipients").textContent().catch(() => "")));
const recallNo = (await lx.textContent("h1")).match(/RC-\d{4}-\d{6}/)?.[0];
await shot(lx, "p25-06-recall");
await go(lx, "/vendor/warehouse/scan");
await scan(lx, "scan-input", PICKED_LOT);
check("the scanner now warns the lot is recalled", await until(async () => (await lx.getByTestId("scan-result").getAttribute("data-kind")) === "BLOCKED"));

// ── 6. The customer's recall notice ──
await go(kebab, "/buy/orders/recalls");
const notice = kebab.getByTestId("recall-notice").filter({ hasText: recallNo ?? PICKED_LOT });
check("customer sees the recall notice", (await notice.count()) === 1);
await shot(kebab, "p25-07-customer-notices");
await notice.click(); await settle(kebab);
await kebab.getByTestId("recall-ack").click(); await settle(kebab);
await kebab.fill("#rn-d", "6");
await kebab.getByTestId("recall-report").getByRole("button", { name: /Enviar/ }).click();
check("customer reported: done", await until(async () => /Concluído/.test(await kebab.getByTestId("recall-notice-detail").textContent())));
await shot(kebab, "p25-08-customer-notice");

// ── 7. FIRINGI ──
await go(sa, "/admin/inventory/recalls");
check("FIRINGI sees the recall with its progress", (await sa.getByTestId("recalls-table").textContent()).includes(recallNo ?? "RC-"));
await shot(sa, "p25-09-admin-recalls");
await go(sa, `/admin/inventory/trace?offer=${mozzId}&lot=${encodeURIComponent(PICKED_LOT)}`);
check("FIRINGI's trace shows the blocked lot", /Blocked/.test(await sa.getByTestId("trace-view").textContent()));

// ── 8. Leave no test stock behind: write off what is left of this run's lot (unless it was recalled) ──
if (PICKED_LOT !== LOT) {
  await go(lx, `/vendor/inventory/stock/${mozzId}`);
  const row = lx.getByTestId("batch-row").filter({ hasText: LOT });
  if (await row.count()) {
    await row.getByTestId("write-off").click();
    await row.getByPlaceholder(/Motivo|Reason/).fill("E2E test lot");
    await row.getByRole("button", { name: /Abater/ }).first().click();
    check("leftover test lot written off", await until(async () => !(await lx.getByTestId("batch-row").filter({ hasText: LOT }).count())));
  }
}

// ── 9. Phone width ──
const phone = await login("owner@lisboacentral.test", { ...devices["iPhone 13"] });
for (const u of ["/vendor/warehouse/pick", pickUrl, "/vendor/warehouse/scan", "/vendor/warehouse/shelves", "/vendor/warehouse/recalls"]) {
  await go(phone, u);
  const over = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(`phone: ${u} fits the screen`, over <= 1, `overflow ${over}px`);
}
await go(phone, "/vendor/warehouse/scan");
await shot(phone, "p25-10-phone-scanner");

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
