/**
 * Browser test of Phase 26 (quotes, recurring orders, buyer approvals, order lists), as the customer
 * Kebab House (owner = manager, Bruno = purchaser; Portuguese UI), its supplier Lisboa Central and
 * FIRINGI staff (English):
 *  quote asked from the cart → the supplier answers (sees its payout; the buyer never sees commission)
 *  → the buyer accepts and the order is placed at the quoted price → order saved as a list → list put
 *  in the cart → recurring order from the cart (skip next, order now, end) → approval rule → Bruno's
 *  order waits → the manager approves and it is placed → FIRINGI's quotes and recurring pages → phone
 *  width → no page errors.
 *   node tests/e2e/buying.mjs [baseUrl] [screenshotDir]
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
const stamp = Date.now().toString(36).slice(-5).toUpperCase();
const main = (p) => p.textContent("main");
const euros = (s) => Number(s.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", "."));
const pt = (n) => n.toFixed(2).replace(".", ",");
async function clearCart(p) {
  await go(p, "/buy/orders/cart");
  const clear = p.getByRole("button", { name: /Esvaziar carrinho|Clear cart/ });
  if (await clear.count()) { await clear.click(); await settle(p); }
}
async function addToCart(p, offerId, qty) {
  await go(p, `/buy/catalogue/offers/${offerId}`);
  await p.locator('input[type="number"]').first().fill(String(qty));
  await p.getByRole("button", { name: /Adicionar ao carrinho|Add to cart/ }).click();
  await settle(p);
}

const kebab = await login("owner@kebabhouse.test");
const bruno = await login("buyer@kebabhouse.test");
const lx = await login("owner@lisboacentral.test");
const sa = await login("superadmin@firingi.test");

const offers = await (await kebab.request.get(`${BASE}/api/catalogue/offers?q=mozzarella`)).json();
const mozz = offers.items.find((i) => i.vendor.name === "Lisboa Central" && i.packaging.unitsPerPack === 1)?.offerId;
check("found Lisboa Central's mozzarella", !!mozz);

// ── 0. Start clean: empty carts, no approval rules left over ──
await clearCart(kebab); await clearCart(bruno);
await go(kebab, "/buy/orders/approvals");
for (let i = 0; i < 10 && await kebab.getByTestId("approval-rules").getByRole("button", { name: /Eliminar|Delete/ }).count(); i++) {
  await kebab.getByTestId("approval-rules").getByRole("button", { name: /Eliminar|Delete/ }).first().click(); await settle(kebab);
}

// ── 1. Quote asked from the cart ──
await addToCart(kebab, mozz, 12);
await go(kebab, "/buy/orders/cart");
await kebab.getByTestId("ask-quote").click();
await kebab.fill("#q-note", `Encomendamos isto todas as semanas (${stamp})`);
await shot(kebab, "p26-01-cart-ask-quote");
await kebab.getByTestId("quote-form").getByRole("button", { name: /Enviar pedido/ }).click();
await kebab.waitForURL("**/buy/orders/quotes/**", { timeout: 15000 }).catch(() => {});
await settle(kebab);
const quoteUrl = new URL(kebab.url()).pathname;
const quoteNo = (await main(kebab)).match(/QR-\d{4}-\d{6}/)?.[0];
check("quote request sent, one per supplier", /\/buy\/orders\/quotes\/[\w-]+$/.test(quoteUrl) && !!quoteNo, quoteNo ?? kebab.url());
check("the buyer sees: waiting for the supplier", /À espera do fornecedor/.test(await kebab.getByTestId("quote-status").textContent()));

// ── 2. The supplier answers with a better price ──
await go(lx, "/vendor/orders/quotes");
check("the supplier sees the request", (await main(lx)).includes(quoteNo));
await lx.getByRole("link", { name: quoteNo }).first().click();
await lx.waitForURL("**/vendor/orders/quotes/**").catch(() => {}); await settle(lx);
const row = lx.getByTestId("answer-quote").locator("tbody tr").first();
const listPrice = euros(await row.locator("td").nth(2).textContent());
const quoted = Math.round(listPrice * 90) / 100;
check("the supplier sees its list price for the line", listPrice > 0, String(listPrice));
await row.getByTestId("quote-price").fill(String(quoted));
await lx.fill("#aq-m", "Preço especial para 12 unidades");
check("the supplier sees what it receives after FIRINGI's commission", /comiss/i.test(await lx.getByTestId("payout-preview").textContent()));
await shot(lx, "p26-02-supplier-answers");
await lx.getByTestId("answer-quote").getByRole("button", { name: /Enviar preços/ }).click();
check("prices sent", await until(async () => /Preços recebidos/.test(await lx.getByTestId("quote-status").textContent())));

// ── 3. The buyer accepts: the order is placed at the quoted price ──
await go(kebab, quoteUrl);
check("the buyer sees: prices received", /Preços recebidos/.test(await kebab.getByTestId("quote-status").textContent()));
check("the buyer sees the quoted price and the saving", (await kebab.getByTestId("quote-lines").textContent()).includes(pt(quoted)) && /Poupa/.test(await main(kebab)));
check("the buyer never sees FIRINGI's commission or the supplier's payout", !/comiss|recebe \(/i.test(await main(kebab)));
await shot(kebab, "p26-03-buyer-quote-received");
await kebab.getByTestId("accept-quote").getByRole("button", { name: /Aceitar e encomendar/ }).click();
await kebab.waitForURL("**/buy/orders/**placed=1", { timeout: 20000 }).catch(() => {});
await settle(kebab);
const orderUrl = new URL(kebab.url()).pathname;
check("the order is placed", /placed=1/.test(kebab.url()) && /FO-\d{4}-\d{6}/.test(await main(kebab)), kebab.url());
check("the order uses the quoted price", (await main(kebab)).includes(pt(quoted)));
await go(kebab, quoteUrl);
check("the quote is now accepted", /Aceite/.test(await kebab.getByTestId("quote-status").textContent()));

// ── 4. Order lists: save the order as a list, put the list in the cart ──
await go(kebab, orderUrl);
await kebab.getByTestId("order-to-list").click();
await kebab.waitForURL("**/buy/orders/lists/**", { timeout: 15000 }).catch(() => {}); await settle(kebab);
const listUrl = new URL(kebab.url()).pathname;
check("order saved as a list", /\/buy\/orders\/lists\/[\w-]+$/.test(listUrl) && (await kebab.getByTestId("list-lines").locator("tbody tr").count()) >= 1);
const qtyBox = kebab.getByTestId("list-qty").first();
await qtyBox.fill("8"); await qtyBox.blur(); await settle(kebab);
await go(kebab, listUrl);
check("list quantity changed", (await kebab.getByTestId("list-qty").first().inputValue()) === "8");
await shot(kebab, "p26-04-order-list");
await clearCart(kebab);
await go(kebab, listUrl);
await kebab.getByTestId("list-to-cart").click();
await kebab.waitForURL("**/buy/orders/cart**", { timeout: 15000 }).catch(() => {}); await settle(kebab);
check("the whole list went into the cart", /Mozzarella/i.test(await main(kebab)) && !(await kebab.getByRole("button", { name: /Esvaziar carrinho|Clear cart/ }).count() === 0));

// ── 5. Recurring order from the cart ──
const REC = `Reposição ${stamp}`;
await go(kebab, "/buy/orders/recurring");
await kebab.fill("#nr-n", REC);
await kebab.getByTestId("new-recurring").getByRole("button", { name: /Criar encomenda recorrente/ }).click();
await kebab.waitForURL("**/buy/orders/recurring/**", { timeout: 15000 }).catch(() => {}); await settle(kebab);
const recUrl = new URL(kebab.url()).pathname;
check("recurring order created and active", /\/buy\/orders\/recurring\/[\w-]+$/.test(recUrl) && /Ativa/.test(await kebab.getByTestId("recurring-status").textContent()));
check("next order date shown, products priced today", (await kebab.getByTestId("next-run").count()) === 1 && /Mozzarella/i.test(await kebab.getByTestId("recurring-lines").textContent()));
await kebab.getByRole("button", { name: /Saltar a próxima/ }).click();
check("next one skipped", await until(async () => /será saltada/.test(await main(kebab))));
await kebab.getByRole("button", { name: /Não saltar/ }).click();
check("skip undone", await until(async () => !/será saltada/.test(await main(kebab))));
await shot(kebab, "p26-05-recurring");
await kebab.getByTestId("order-now").click();
check("order placed now from the recurring order", await until(async () => /Encomenda feita/.test(await main(kebab))));
await go(sa, "/admin/orders/recurring");
check("FIRINGI sees the recurring order (English)", (await main(sa)).includes(REC) && /Recurring/.test(await main(sa)));
await go(kebab, recUrl);
await kebab.getByTestId("recurring-actions").getByRole("button", { name: /^Terminar$/ }).click();
check("recurring order ended", await until(async () => /Terminada/.test(await kebab.getByTestId("recurring-status").textContent())));
await clearCart(kebab);

// ── 6. Buyer approvals: rule, Bruno's order waits, the manager approves ──
const RULE = `E2E ${stamp}`;
await go(kebab, "/buy/orders/approvals");
await kebab.fill("#r-n-new", RULE); await kebab.fill("#r-a-new", "1");
await kebab.getByTestId("approval-rules").getByRole("button", { name: /Adicionar regra/ }).click();
const ruleInput = () => kebab.getByTestId("approval-rules").locator(`input[value="${RULE}"]`);
check("approval rule added", await until(async () => (await ruleInput().count()) === 1));
await shot(kebab, "p26-06-approval-rules");
await go(bruno, "/buy/orders/approvals");
check("the purchaser cannot change the rules", (await bruno.locator("#r-n-new").count()) === 0);
await addToCart(bruno, mozz, 6); // above the supplier's 50 € minimum
await go(bruno, "/buy/orders/cart");
await bruno.getByRole("button", { name: /Fazer encomenda|Place order/ }).click();
await bruno.waitForURL("**/buy/orders/approvals/**", { timeout: 20000 }).catch(() => {}); await settle(bruno);
const apprUrl = new URL(bruno.url()).pathname;
check("Bruno's order waits for approval instead of being placed", /\/buy\/orders\/approvals\/[\w-]+$/.test(apprUrl) && /À espera/.test(await bruno.getByTestId("approval-status").textContent()), bruno.url());
check("Bruno cannot approve his own order", (await bruno.getByTestId("approve").count()) === 0);
await shot(bruno, "p26-07-purchaser-waiting");
await go(kebab, "/buy/orders/approvals");
check("the manager sees it in Approvals", (await kebab.locator(`a[href="${apprUrl}"]`).count()) >= 1);
await go(kebab, apprUrl);
await kebab.getByTestId("approve").click();
await kebab.waitForURL("**/buy/orders/**placed=1", { timeout: 20000 }).catch(() => {}); await settle(kebab);
check("approved: the order is placed", /placed=1/.test(kebab.url()) && /FO-\d{4}-\d{6}/.test(await main(kebab)), kebab.url());
await go(bruno, apprUrl);
check("Bruno sees it approved", /Aprovado/.test(await bruno.getByTestId("approval-status").textContent()));
await go(kebab, "/buy/orders/approvals");
const ruleForm = kebab.getByTestId("rule-form").filter({ has: kebab.locator(`input[value="${RULE}"]`) });
await ruleForm.getByRole("button", { name: /Eliminar|Delete/ }).click();
check("test rule removed", await until(async () => (await ruleInput().count()) === 0));

// ── 7. FIRINGI's quotes page (English) ──
await go(sa, "/admin/orders/quotes");
check("FIRINGI sees the quote (English)", (await main(sa)).includes(quoteNo) && (await sa.getByTestId("admin-quote-kpis").count()) === 1);
await shot(sa, "p26-08-admin-quotes");

// ── 8. Phone width ──
const phone = await login("owner@kebabhouse.test", { ...devices["iPhone 13"] });
for (const u of ["/buy/orders/quotes", quoteUrl, "/buy/orders/recurring", recUrl, "/buy/orders/lists", listUrl, "/buy/orders/approvals", apprUrl]) {
  await go(phone, u);
  const over = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(`phone: ${u} fits the screen`, over <= 1, `overflow ${over}px`);
}
await go(phone, quoteUrl);
await shot(phone, "p26-09-phone-quote");
const lxPhone = await login("owner@lisboacentral.test", { ...devices["iPhone 13"] });
await go(lxPhone, "/vendor/orders/quotes");
const over = await lxPhone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
check("phone: supplier quote requests fit the screen", over <= 1, `overflow ${over}px`);

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
