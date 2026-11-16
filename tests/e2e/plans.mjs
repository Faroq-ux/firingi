/**
 * Browser test of Phase 36 — supplier plans & early payout:
 * FIRINGI (English) switches plans on (suppliers pay by invoice), makes Business's early payout paid;
 * the supplier (Portuguese) is on a free trial of Business, picks Pro for after the trial; FIRINGI moves it to
 * Free now → Inventory/Warehouse show the upgrade card and leave the menu; back to Business (upgrade invoice);
 * an approved supplier invoice is paid early: the supplier sees the fee and what it receives, asks, FIRINGI
 * marks it paid, the supplier sees it paid with the fee invoice (PDF). Phone width + dark. Plans off at the end.
 *   node tests/e2e/plans.mjs [baseUrl] [screenshotDir]
 */
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");

const BASE = process.argv[2] ?? "http://localhost:3000";
const SHOTS = process.argv[3] ?? null;
const PASSWORD = process.env.SEED_PASSWORD ?? "Firingi!2026";
let failures = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "✔" : "✘"} ${name}${extra ? ` — ${extra}` : ""}`); if (!ok) failures++; };
const shot = async (page, name, full = false) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: full });
const browser = await chromium.launch();
const settle = async (p) => { await p.waitForLoadState("networkidle").catch(() => {}); await p.waitForTimeout(400); };
const go = async (p, url) => { await p.goto(`${BASE}${url}`); await settle(p); };
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn().catch(() => false)) return true; await new Promise((r) => setTimeout(r, 300)); } return false; };
const errors = [];
async function login(email, { viewport = { width: 1280, height: 900 }, colorScheme = "light" } = {}) {
  const ctx = await browser.newContext({ viewport, colorScheme, reducedMotion: "reduce", deviceScaleFactor: SHOTS ? 2 : 1 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${email} @ ${page.url().replace(BASE, "")}: ${e.message.slice(0, 140)}`));
  await go(page, "/login");
  await page.fill("#email", email); await page.fill("#password", PASSWORD); await page.click("button[type=submit]");
  await page.waitForURL((u) => u.pathname !== "/login", { timeout: 15000 }).catch(() => {});
  await settle(page);
  return page;
}
const main = (p) => p.textContent("main");
const stamp = Date.now().toString().slice(-6);
const PDF = { name: "fatura.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n% supplier invoice\n%%EOF") };

const sa = await login("superadmin@firingi.test");
const lx = await login("owner@lisboacentral.test");

// ── 0. An approved supplier invoice (order → delivered → statement → invoice → FIRINGI approves) ──
const customer = await login("owner@kebabhouse.test");
const api = await (await customer.request.get(`${BASE}/api/catalogue/offers?q=mozzarella`)).json();
const mozz = api.items.find((i) => i.vendor.name === "Lisboa Central" && i.packaging.unitsPerPack === 1);
await go(customer, "/buy/orders/cart");
const clear = customer.getByRole("button", { name: /Esvaziar carrinho|Clear cart/ });
if (await clear.count()) { await clear.click(); await settle(customer); }
await go(customer, `/buy/catalogue/offers/${mozz.offerId}`);
await customer.locator('main input[type="number"]').first().fill("6");
await customer.getByRole("button", { name: /Adicionar ao carrinho|Add to cart/ }).click();
await settle(customer);
await go(customer, "/buy/orders/cart");
await customer.getByRole("button", { name: /Fazer encomenda|Place order/ }).click();
await customer.waitForURL("**placed=1", { timeout: 20000 });
await settle(customer);
const number = (await main(customer)).match(/FO-\d{4}-\d{6}/)[0];
await go(lx, "/vendor/orders/incoming");
await lx.getByRole("link", { name: number }).click();
await settle(lx);
await lx.getByRole("button", { name: /Confirmar encomenda|Confirm order/ }).click();
await settle(lx);
await lx.getByRole("button", { name: /Pronta para recolha|Ready for pickup/ }).click();
await settle(lx);
await go(sa, "/admin/orders/ready-for-pickup");
await sa.getByRole("link", { name: number }).click();
await settle(sa);
for (const step of [/Expedida|Dispatched/, /Em distribuição|Out for delivery/, /Entregue|Delivered/]) { await sa.getByRole("button", { name: step }).click(); await settle(sa); }
await go(lx, "/vendor/finance/statements");
await lx.locator("label").filter({ hasText: number }).locator('input[type="checkbox"]').check();
const viNumber = `FT LC/EP${stamp}`;
await lx.fill('input[name="externalNumber"]', viNumber);
await lx.setInputFiles('input[name="file"]', PDF);
await lx.getByRole("button", { name: /^Carregar|^Upload/ }).click();
await settle(lx);
const fin = await login("finance@firingi.test");
await go(fin, "/admin/invoices/vendor");
await fin.locator("tr").filter({ hasText: viNumber }).getByRole("button", { name: "Approve" }).click();
await settle(fin);
check("supplier invoice approved (due in 30 days)", await until(async () => { await go(fin, "/admin/invoices/vendor"); return /Approved|Aprovad/.test(await fin.locator("tr").filter({ hasText: viNumber }).textContent()); }));

// ── 1. FIRINGI switches plans on ──
await go(sa, "/admin/vendors/plans");
check("Supplier Plans page (English): KPIs, settings, three plans", (await sa.getByTestId("plans-kpis").count()) === 1 && (await sa.getByTestId("plan-editor-FREE").count()) === 1 && (await sa.getByTestId("plan-editor-PRO").count()) === 1 && (await sa.getByTestId("plan-editor-BUSINESS").count()) === 1);
await sa.getByTestId("BUSINESS-early-free").fill("0");
await sa.getByTestId("BUSINESS-save").click();
check("Business: no free early payouts (saved)", await until(async () => /Saved/.test(await sa.getByTestId("plan-editor-BUSINESS").textContent())));
await sa.locator("#pl-trial").fill("30");
await sa.locator("#pl-billing").selectOption("INVOICE");
await sa.getByTestId("plans-enabled").check();
await sa.getByTestId("plans-save").click();
check("plans switched on", await until(async () => /Saved/.test(await sa.getByTestId("plans-settings").textContent())));
await shot(sa, "plans-01-admin", true);

// ── 2. Supplier: free trial of Business, picks Pro for after it ──
await go(lx, "/vendor/company/plan");
check("supplier (Portuguese): free trial of Business", /Teste gratuito/.test(await lx.getByTestId("trial-badge").textContent()) && (await lx.getByTestId("current-plan").textContent()) === "Business");
check("plan cards with features, limits and early payout terms", (await lx.getByTestId("plan-cards").locator('[data-testid^="plan-"]').count()) === 3 && /Pagamento antecipado/.test(await lx.getByTestId("plan-PRO").textContent()));
const proId = (await lx.getByTestId("plan-PRO").locator('[data-testid^="choose-"]').getAttribute("data-testid")).replace("choose-", "");
// a click that lands before the page is interactive does nothing — choosing the same plan again is harmless, so retry
for (let i = 0; i < 4; i++) {
  await lx.getByTestId(`choose-${proId}`).click();
  if (await until(async () => (await lx.getByTestId("pending-plan").count()) > 0 || (await lx.getByTestId("plan-PRO").locator('[role="status"],[role="alert"]').count()) > 0, 5000)) break; // not the page-wide route announcer (role=alert)
}
check("Pro chosen — starts after the trial", await until(async () => { await go(lx, "/vendor/company/plan"); return /Pro começa/.test(await lx.getByTestId("pending-plan").textContent()); }));
await shot(lx, "plans-02-supplier-trial", true);

// ── 3. FIRINGI moves it to Free now: features outside the plan are locked ──
await go(sa, "/admin/vendors/plans/subscribers");
const subRow = () => sa.getByTestId("subscribers").locator("tr", { hasText: "Lisboa Central" }).first();
await subRow().getByTestId("sub-plan").selectOption({ label: "Free" });
await subRow().getByTestId("sub-set").click();
check("FIRINGI sets Free now", await until(async () => { await go(sa, "/admin/vendors/plans/subscribers"); return /^Free/.test((await subRow().locator("td").nth(2).textContent()).trim()); }));
await go(lx, "/vendor/inventory/overview");
check("Free: inventory shows the upgrade card (Portuguese)", (await lx.getByTestId("plan-gate").count()) === 1 && /não está no seu plano/.test(await main(lx)));
await shot(lx, "plans-03-gate");
const nav = await lx.locator("nav, aside").first().textContent();
check("Free: Inventory, Planning and Warehouse leave the menu", !/Stock e Lotes|Prateleiras|Previsão da Procura/.test(nav));
await go(lx, "/vendor/company/plan");
check("usage against Free's limits", /\/ 50/.test(await lx.getByTestId("plan-usage").textContent()));

// ── 4. Back to Business (difference invoiced) ──
await go(sa, "/admin/vendors/plans/subscribers");
await subRow().getByTestId("sub-plan").selectOption({ label: "Business" });
await subRow().getByTestId("sub-set").click();
check("FIRINGI sets Business now", await until(async () => { await go(sa, "/admin/vendors/plans/subscribers"); return /^Business/.test((await subRow().locator("td").nth(2).textContent()).trim()); }));
await go(lx, "/vendor/inventory/overview");
check("Business: inventory open again", (await lx.getByTestId("plan-gate").count()) === 0);
await go(sa, "/admin/vendors/plans/invoices");
check("plan invoice for the change (upgrade)", (await sa.getByTestId("plan-invoices-table").locator("tr", { hasText: "Lisboa Central" }).filter({ hasText: "Upgrade" }).count()) >= 1);
await go(lx, "/vendor/company/plan");
const planPdf = await lx.getByTestId("plan-invoices").locator("a").first().getAttribute("href");
check("supplier opens its plan invoice (PDF)", (await lx.request.get(`${BASE}${planPdf}`)).status() === 200);

// ── 5. Early payout ──
await go(lx, "/vendor/finance/early-payout");
check("early payout page (Portuguese): terms, limit, room", (await lx.getByTestId("early-summary").count()) === 1 && /por dia/.test(await lx.getByTestId("early-summary").textContent()));
const row = lx.getByTestId("early-invoice").filter({ hasText: viNumber }).first();
check("the approved invoice can be paid early (≈30 days)", (await row.count()) === 1 && /dias antes/.test(await row.textContent()), (await row.textContent().catch(() => "")).slice(0, 120));
await row.getByTestId("early-check").check();
const quote = await lx.getByTestId("early-quote").textContent();
check("quote: minimum fee 3,00 € + VAT, what is received", /3,00\s€/.test(quote) && (await lx.getByTestId("early-net").textContent()).length > 0, quote.slice(0, 160));
await shot(lx, "plans-04-early-quote");
await lx.getByTestId("early-request").click();
await until(async () => /Enviado/.test(await main(lx)));
await go(lx, "/vendor/finance/early-payout");
check("asked — waiting for FIRINGI", (await lx.getByTestId("early-history").count()) === 1 && /À espera da FIRINGI/.test(await lx.getByTestId("early-history").textContent()));

await go(sa, "/admin/vendors/plans/early-payouts");
const ep = sa.getByTestId("early-admin-row").filter({ hasText: "Lisboa Central" }).first();
check("FIRINGI sees the request with the invoice", (await ep.count()) === 1 && (await ep.textContent()).includes(viNumber));
await shot(sa, "plans-05-admin-early");
await ep.getByTestId("early-ref").fill(`TRF-${stamp}`);
await ep.getByTestId("early-pay").click();
await until(async () => (await sa.getByTestId("early-admin-row").filter({ hasText: viNumber }).count()) === 0 || (await sa.locator('[data-testid="early-decision"] [role="status"],[data-testid="early-decision"] [role="alert"]').count()) > 0, 30000);
const payErr = await sa.locator('[data-testid="early-decision"] [role="alert"]').first().textContent({ timeout: 500 }).catch(() => "");
await go(sa, "/admin/vendors/plans/early-payouts?all=1");
const paidRow = sa.getByTestId("early-admin-row").filter({ hasText: `TRF-${stamp}` });
check("FIRINGI marks it paid", (await paidRow.count()) === 1 && /paid/.test(await paidRow.first().textContent()), payErr);
await go(lx, "/vendor/finance/early-payout");
const h = lx.getByTestId("early-row").first();
check("supplier: paid, with what it received and the fee invoice", /Pago/.test(await h.textContent()) && /recebeu/.test(await h.textContent()) && (await h.locator("a").count()) === 1);
check("fee invoice PDF opens", (await lx.request.get(`${BASE}${await h.locator("a").getAttribute("href")}`)).status() === 200);
await go(fin, "/admin/invoices/vendor");
check("the supplier invoice is fully paid", /Pa(id|ga)/.test(await fin.locator("tr").filter({ hasText: viNumber }).textContent()));
await shot(lx, "plans-06-supplier-paid");

// ── 6. Phone + dark ──
const lp = await login("owner@lisboacentral.test", { viewport: { width: 390, height: 844 }, colorScheme: "dark" });
for (const u of ["/vendor/company/plan", "/vendor/finance/early-payout"]) {
  await go(lp, u);
  const over = await lp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(`phone width: no sideways scrolling (${u})`, over <= 1, `${over}px`);
}
await shot(lp, "plans-07-phone-dark", true);

// ── tidy: plans off again (other tests run without them) ──
await go(sa, "/admin/vendors/plans");
await sa.getByTestId("plans-enabled").uncheck();
await sa.getByTestId("plans-save").click();
await until(async () => /Saved/.test(await sa.getByTestId("plans-settings").textContent()));
await go(lx, "/vendor/inventory/overview");
check("plans off: everything open again", (await lx.getByTestId("plan-gate").count()) === 0);

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nall plans checks passed");
process.exit(failures ? 1 : 0);
