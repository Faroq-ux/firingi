/**
 * Browser test of Phase 15 against a running server with the demo seed:
 * sales creates a FIRINGI coupon → Kebab House (Portuguese) sees it in "My offers", puts it in
 * the cart, sees the saving, orders → the order shows the coupon. Sales builds a campaign for
 * Kebab House promoting the coupon, previews the audience, sends it → the customer gets it in
 * the bell (Portuguese), clicks through (tracked) → campaign shows delivery + click; the
 * customer unsubscribes → "Offers & news" off in its settings. Marketing analytics lists the
 * coupon; Lisboa Central creates its own coupon (Portuguese form). Phone width of My offers.
 *   node tests/e2e/marketing.mjs [baseUrl] [screenshotDir]
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
async function login(email, viewport = { width: 1440, height: 950 }) {
  const page = await (await browser.newContext({ viewport, reducedMotion: "reduce" })).newPage();
  page.on("pageerror", (e) => errors.push(`${email}: ${e.message}`));
  await go(page, "/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await settle(page);
  return page;
}
const main = (p) => p.textContent("main");
const stamp = Date.now().toString(36).toUpperCase().slice(-6);
const CODE = `PIZZA${stamp}`;

// ── 1. FIRINGI coupon ──
const sales = await login("sales@firingi.test");
await go(sales, "/admin/marketing/coupons");
await sales.getByTestId("new-offer").click();
const f = sales.getByTestId("offer-form");
await f.locator('input[name="name"]').fill(`Pizza week ${stamp}`);
await f.locator('input[name="namePt"]').fill(`Semana da pizza ${stamp}`);
await f.locator('select[name="kind"]').selectOption("PERCENT");
await f.locator('input[name="value"]').fill("10");
await f.locator('input[name="code"]').fill(CODE.toLowerCase());
await f.locator('input[name="maxPerCustomer"]').fill("1");
await f.getByRole("button", { name: "Save" }).click();
await settle(sales);
check("coupon listed (stored in capitals)", (await sales.getByTestId("coupons-table").textContent()).includes(CODE));
await shot(sales, "p15-01-coupons");

// ── 2. Customer: My offers → use → cart → order ──
const customer = await login("owner@kebabhouse.test");
await go(customer, "/buy/dashboard/overview");
check("offers banner on the dashboard", (await customer.getByTestId("offers-banner").count()) === 1 && /Ofertas para si/.test(await customer.getByTestId("offers-banner").textContent()));
await go(customer, "/buy/catalogue/deals");
const card = customer.getByTestId("offer-card").filter({ hasText: CODE });
check("My offers lists the coupon (Portuguese)", (await card.count()) === 1 && /10 % de desconto/.test(await card.textContent()));
await shot(customer, "p15-02-my-offers");
// fill the cart with a Lisboa Central product
const api = await (await customer.request.get(`${BASE}/api/catalogue/offers?q=mozzarella`)).json();
const offer = api.items.find((i) => i.vendor.name === "Lisboa Central" && i.packaging.unitsPerPack === 1);
await go(customer, "/buy/orders/cart");
const clear = customer.getByRole("button", { name: /Esvaziar carrinho|Clear cart/ });
if (await clear.count()) { await clear.click(); await settle(customer); }
await go(customer, `/buy/catalogue/offers/${offer.offerId}`);
await customer.locator('main input[type="number"]').first().fill("12");
await customer.getByRole("button", { name: /Adicionar ao carrinho|Add to cart/ }).click();
await settle(customer);
await go(customer, "/buy/catalogue/deals");
await customer.getByTestId(`use-${CODE}`).click();
await settle(customer);
check("coupon added from My offers", /Adicionado ao carrinho/.test(await customer.getByTestId("offer-card").filter({ hasText: CODE }).textContent()));
await go(customer, "/buy/orders/cart");
const applied = await customer.getByTestId("coupon-applied").textContent();
check("cart shows the coupon and the saving", applied.includes(CODE) && /Poupa/.test(applied), applied);
await shot(customer, "p15-03-cart-coupon");
await customer.getByRole("button", { name: /Fazer encomenda|Place order/ }).click();
await customer.waitForURL("**placed=1", { timeout: 15000 });
await settle(customer);
check("order shows the coupon", (await customer.getByTestId("order-coupon").textContent()).includes(CODE));
await go(customer, "/buy/catalogue/deals");
check("used coupon (once per customer) leaves My offers", (await customer.getByTestId("offer-card").filter({ hasText: CODE }).count()) === 0);

// ── 3. Campaign ── (the customer may have unsubscribed in an earlier run: offers & news back on)
await go(customer, "/buy/me/notification-settings");
for (const b of await customer.locator('input[name^="marketing:"]').all()) if (!(await b.isChecked())) await b.check();
await customer.getByRole("button", { name: "Guardar" }).click();
await settle(customer);
await go(sales, "/admin/marketing/campaigns");
await sales.getByTestId("new-campaign").click();
const cf = sales.getByTestId("campaign-form");
await cf.locator('input[name="name"]').fill(`Kebab news ${stamp}`);
await cf.getByLabel("Chosen companies").check();
const kebabValue = await cf.locator('select[name="companyIds"] option', { hasText: "Kebab House" }).first().getAttribute("value");
await cf.locator('select[name="companyIds"]').selectOption(kebabValue);
await cf.getByRole("button", { name: "Preview audience" }).click();
await sales.waitForTimeout(800);
check("audience preview counts the company", /\b1\b companies/.test(await cf.getByTestId("audience-preview").textContent()));
await cf.locator('input[name="subject_en"]').fill(`New flour ${stamp}`);
await cf.locator('textarea[name="body_en"]').fill("Fresh flour and boxes on offer this week.");
await cf.locator('input[name="subject_pt"]').fill(`Farinha nova ${stamp}`);
await cf.locator('textarea[name="body_pt"]').fill("Farinha e caixas em promoção esta semana.");
await cf.getByRole("button", { name: "Save campaign" }).click();
await sales.waitForURL(/\/admin\/marketing\/campaigns\/[a-z0-9]+$/, { timeout: 15000 });
await settle(sales);
sales.once("dialog", (d) => d.accept());
await sales.getByTestId("campaign-actions").getByRole("button", { name: "Send now" }).click();
await settle(sales);
await sales.reload(); await settle(sales);
check("campaign sent", /sent/.test(await main(sales)) && (await sales.getByTestId("by-channel").textContent()).includes("E-mail"));
const campaignUrl = sales.url();

await go(customer, "/buy/dashboard/overview");
await customer.getByTestId("bell").click();
await customer.waitForTimeout(600);
const item = customer.getByTestId("bell-panel").getByRole("button", { name: new RegExp(`Farinha nova ${stamp}`) });
check("customer got the campaign in the bell, in Portuguese", (await item.count()) === 1);
await item.click();
await customer.waitForURL("**/buy/catalogue/deals", { timeout: 15000 });
check("the campaign link opens My offers (tracked)", customer.url().endsWith("/buy/catalogue/deals"));
await go(sales, campaignUrl.replace(BASE, ""));
const stats = await sales.getByTestId("campaign-stats").textContent();
check("campaign counts the click", /Clicked\s*1/.test(stats.replace(/\s+/g, " ")), stats.replace(/\s+/g, " ").slice(0, 160));
await shot(sales, "p15-04-campaign");

// ── 4. Unsubscribe (link from the notification) ──
await go(customer, "/buy/me/notifications");
const href = await customer.locator('main a[href^="/api/m/c/"]').first().getAttribute("href");
await go(customer, `/m/u/${href.split("/").pop()}`);
check("unsubscribe page (Portuguese)", /Subscrição cancelada/.test(await customer.getByTestId("unsubscribed").textContent()));
await go(customer, "/buy/me/notification-settings");
const boxes = customer.locator('input[name^="marketing:"]');
check("Offers & news switched off in the settings", (await boxes.count()) > 0 && (await boxes.evaluateAll((els) => els.every((e) => !e.checked))));

// ── 5. Analytics, customer offers, supplier coupon ──
await go(sales, "/admin/marketing/analytics");
check("marketing analytics lists the coupon", (await sales.getByTestId("top-offers").textContent()).includes(CODE));
await shot(sales, "p15-05-analytics");
await go(sales, "/admin/marketing/customer-offers");
check("customer offers page renders", (await sales.getByTestId("offers-table").count()) === 1);

const vendor = await login("owner@lisboacentral.test");
await go(vendor, "/vendor/products/promotions");
await vendor.getByTestId("new-offer").click();
const vf = vendor.getByTestId("offer-form");
check("supplier form in Portuguese", /Código de cupão/.test(await vf.textContent()));
await vf.locator('input[name="name"]').fill(`Leve 11 ${stamp}`);
await vf.locator('select[name="kind"]').selectOption("BUY_X_GET_Y");
await vf.locator('input[name="buyQty"]').fill("10");
await vf.locator('input[name="freeQty"]').fill("1");
await vf.locator('input[name="code"]').fill(`LX${stamp}`);
await vf.getByRole("button", { name: /Guardar|Save/ }).click();
await settle(vendor);
check("supplier coupon listed", (await main(vendor)).includes(`LX${stamp}`) && /Compre 10, leve 1 grátis/.test(await main(vendor)));
await shot(vendor, "p15-06-supplier-coupon");

const phone = await login("owner@kebabhouse.test", { width: 390, height: 844 });
await go(phone, "/buy/catalogue/deals");
const wide = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check("phone width: My offers has no sideways scroll", wide <= 1, `${wide}px`);

check("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nAll marketing e2e checks passed");
process.exit(failures ? 1 : 0);
