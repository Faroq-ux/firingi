/**
 * Browser test of Phase 35 — order chat:
 * customer orders → writes to the supplier (a phone number is hidden, warned); the supplier (Portuguese)
 * sees it with an unread badge and answers; read in English it is translated, "show original" works;
 * inboxes; FIRINGI sees every conversation and what was typed, reviews the flag; the supplier's own driver
 * writes to the customer with a photo from the delivery page, the customer sees it; FIRINGI switches the
 * buyer ↔ supplier channel off and on; Business Features switches; phone width + dark.
 *   node tests/e2e/chat.mjs [baseUrl] [screenshotDir]
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
async function login(email, { password = PASSWORD, viewport = { width: 1280, height: 900 }, colorScheme = "light", locale } = {}) {
  const ctx = await browser.newContext({ viewport, colorScheme, reducedMotion: "reduce", deviceScaleFactor: SHOTS ? 2 : 1 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${email} @ ${page.url().replace(BASE, "")}: ${e.message.slice(0, 140)}`));
  await go(page, "/login");
  await page.fill("#email", email); await page.fill("#password", password); await page.click("button[type=submit]");
  await page.waitForURL((u) => u.pathname !== "/login", { timeout: 15000 }).catch(() => {});
  if (locale) await ctx.addCookies([{ name: "NEXT_LOCALE", value: locale, url: BASE }]); // signing in sets the user's own language
  await settle(page);
  return page;
}
const main = (p) => p.textContent("main");
const stamp = Date.now().toString().slice(-6);
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
async function pickOption(page, selector, text) {
  const value = await page.locator(`${selector} option`, { hasText: text }).first().getAttribute("value");
  await page.locator(selector).selectOption(value);
}
async function send(page, text, photo = false) {
  await page.getByTestId("chat-input").fill(text);
  if (photo) await page.getByTestId("chat-photos").setInputFiles({ name: "porta.png", mimeType: "image/png", buffer: PNG });
  await page.getByTestId("chat-send").click();
  await until(async () => (await page.getByTestId("chat-input").inputValue()) === "");
  await settle(page);
}

const sa = await login("superadmin@firingi.test");
const kebab = await login("owner@kebabhouse.test");
const lx = await login("owner@lisboacentral.test");

// ── 0. FIRINGI: everything on ──
await go(sa, "/admin/orders/chat");
check("Order Chat page (English): KPIs, channels, settings", (await sa.getByTestId("chat-kpis").count()) === 1 && (await sa.getByTestId("chat-settings").count()) === 1 && /Who can talk on an order/.test(await main(sa)));
for (const c of ["BUYER_SUPPLIER", "BUYER_FIRINGI", "SUPPLIER_FIRINGI", "DRIVER"]) await sa.getByTestId(`chat-channel-${c}`).check();
await sa.getByTestId("chat-enabled").check();
await sa.getByTestId("chat-mask").check();
await sa.getByTestId("chat-translate").check();
await sa.getByTestId("chat-save").click();
check("settings saved", await until(async () => /Saved/.test(await sa.getByTestId("chat-settings").textContent())));
await shot(sa, "chat-01-admin-settings", true);

// ── 1. Customer orders from Lisboa Central (its own delivery) ──
const api = await (await kebab.request.get(`${BASE}/api/catalogue/offers?q=pizza`)).json();
const offer = api.items.find((i) => i.vendor.name === "Lisboa Central");
await go(kebab, "/buy/orders/cart");
const clear = kebab.getByRole("button", { name: /Esvaziar carrinho|Clear cart/ });
if (await clear.count()) { await clear.click(); await settle(kebab); }
await go(kebab, `/buy/catalogue/offers/${offer.offerId}`);
await kebab.locator('main input[type="number"]').first().fill("8");
await kebab.getByRole("button", { name: /Adicionar ao carrinho|Add to cart/ }).click();
await settle(kebab);
await go(kebab, "/buy/orders/cart");
await kebab.getByRole("button", { name: /Fazer encomenda|Place order/ }).click();
await kebab.waitForURL("**placed=1", { timeout: 20000 });
await settle(kebab);
const orderId = kebab.url().split("/").pop().split("?")[0];
const number = (await main(kebab)).match(/FO-\d{4}-\d{6}/)[0];

// ── 2. Customer writes to the supplier: the phone number is hidden ──
await go(kebab, `/buy/orders/${orderId}`);
check("order page: Mensagens card with Fornecedor and FIRINGI tabs", (await kebab.getByTestId("order-chat-card").count()) === 1 && (await kebab.getByTestId("chat-tab-BUYER_SUPPLIER").textContent()).includes("Fornecedor") && (await kebab.getByTestId("chat-tab-BUYER_FIRINGI").count()) === 1);
check("customer can't see the supplier ↔ FIRINGI conversation", (await kebab.getByTestId("chat-tab-SUPPLIER_FIRINGI").count()) === 0);
await kebab.getByTestId("chat-tab-BUYER_SUPPLIER").click();
await send(kebab, "Podem entregar antes das 10h? Liguem-me 912 345 678");
check("sender warned: contact details hidden", (await kebab.getByTestId("chat-hidden-warning").count()) === 1);
check("message shows [•••] instead of the number", /Liguem-me \[•••\]/.test(await kebab.getByTestId("chat-messages").textContent()) && !/912 345 678/.test(await kebab.getByTestId("chat-messages").textContent()));
await shot(kebab, "chat-02-buyer-sent");

// ── 3. Supplier (Portuguese) sees it unread and answers ──
await go(lx, `/vendor/orders/${orderId}`);
check("supplier: Cliente tab with an unread badge", (await lx.getByTestId("chat-tab-BUYER_SUPPLIER").textContent()).includes("Cliente") && (await lx.getByTestId("chat-tab-BUYER_SUPPLIER").getByTestId("chat-unread").count()) === 1);
check("supplier sees the hidden version, from Kebab House", /Kebab House/.test(await lx.getByTestId("chat-messages").textContent()) && /\[•••\]/.test(await lx.getByTestId("chat-messages").textContent()));
await send(lx, "Sim, entregamos às 9h. Obrigado!");
check("supplier's answer in the thread", /entregamos às 9h/.test(await lx.getByTestId("chat-messages").textContent()));
await shot(lx, "chat-03-supplier");

// ── 4. Read in English: translated (simulated translator), "show original" ──
const lxEn = await login("owner@lisboacentral.test", { locale: "en" });
await go(lxEn, `/vendor/orders/${orderId}`);
const firstMsg = lxEn.getByTestId("chat-message").first();
check("English reader: message translated", /\[EN\]/.test(await firstMsg.textContent()) && (await firstMsg.getByTestId("chat-original").count()) === 1, (await firstMsg.textContent()).slice(0, 120));
await firstMsg.getByTestId("chat-original").click();
check("own reply stays as written (not translated)", !/\[EN\]/.test(await lxEn.getByTestId("chat-message").nth(1).textContent()));
check("show original → the Portuguese text", /Podem entregar/.test(await firstMsg.getByTestId("chat-body").textContent()) && !/\[EN\]/.test(await firstMsg.getByTestId("chat-body").textContent()));
await shot(lxEn, "chat-04-translated");

// ── 5. Inboxes ──
await go(kebab, "/buy/orders/messages");
const row = kebab.getByTestId("chat-inbox-row").filter({ hasText: number }).first();
check("customer inbox: the order with 1 new message from Lisboa Central", (await row.count()) === 1 && /Lisboa Central/.test(await row.textContent()) && /1 nov/.test(await row.textContent()), (await row.textContent()).slice(0, 120));
await row.click();
check("inbox row opens the order's chat", await until(async () => kebab.url().includes(`/buy/orders/${orderId}`)));
await go(lx, "/vendor/orders/messages");
check("supplier inbox lists the conversation", (await lx.getByTestId("chat-inbox-row").filter({ hasText: number }).count()) >= 1);

// ── 6. FIRINGI sees everything, what was typed, reviews the flag ──
await go(sa, `/admin/orders/${orderId}`);
check("FIRINGI: Buyer ↔ supplier tab (English)", /Buyer ↔ supplier/.test(await sa.getByTestId("chat-tab-BUYER_SUPPLIER").textContent()));
await sa.getByTestId("chat-tab-BUYER_SUPPLIER").click();
check("FIRINGI sees the flag and what was typed", /Typed: .*912 345 678/.test(await sa.getByTestId("chat-flag").first().textContent()));
await sa.getByTestId("chat-tab-SUPPLIER_FIRINGI").click();
await send(sa, `Bom dia — confirmem a hora da entrega da ${number}, por favor.`);
await go(sa, "/admin/orders/chat/flagged");
const flag = sa.getByTestId("flagged-row").filter({ hasText: number }).first();
check("Flagged messages: the customer's phone number", (await flag.count()) === 1 && /Phone number/.test(await flag.textContent()) && /912 345 678/.test(await flag.textContent()));
await shot(sa, "chat-05-admin-flagged");
await flag.getByTestId("flag-review").click();
check("reviewed → off the list", await until(async () => { await go(sa, "/admin/orders/chat/flagged"); return (await sa.getByTestId("flagged-row").filter({ hasText: number }).count()) === 0; }));
await go(lx, `/vendor/orders/${orderId}`);
check("supplier sees FIRINGI's message in the FIRINGI tab", (await lx.getByTestId("chat-tab-SUPPLIER_FIRINGI").getByTestId("chat-unread").count()) === 1);

// ── 7. The supplier's own driver writes to the customer, with a photo ──
const driverEmail = `chat.${stamp}@lisboacentral.test`, driverPass = "Estafeta!2026", driverName = `Tiago Estafeta ${stamp}`;
await go(lx, "/vendor/fleet/drivers");
await lx.getByRole("button", { name: /Adicionar motorista|Add driver/ }).click();
await lx.fill('input[name="driverName"]', driverName);
await lx.fill('input[name="driverEmail"]', driverEmail);
await lx.fill('input[name="driverPassword"]', driverPass);
await lx.fill('input[name="licenceNumber"]', `LX-${stamp}`);
await lx.getByRole("button", { name: /^Guardar$|^Save$/ }).first().click();
await settle(lx);
await go(lx, `/vendor/orders/${orderId}`);
await lx.getByRole("button", { name: /Confirmar encomenda|Confirm order/ }).click();
await settle(lx);
const panel = '[data-testid="delivery-panel"]';
await pickOption(lx, `${panel} select[name="driverId"]`, driverName);
await lx.locator(panel).getByRole("button", { name: /^Atribuir$|^Assign$/ }).click();
await settle(lx);
check("order assigned to the supplier's driver", (await lx.locator(panel).textContent()).includes(driverName));
const drv = await login(driverEmail, { password: driverPass, viewport: { width: 390, height: 844 } });
await go(drv, "/driver/deliveries/today");
await drv.locator('[data-testid="driver-delivery"]', { hasText: number }).getByRole("link").first().click().catch(() => {});
await settle(drv);
if (!/\/driver\/deliveries\/[a-z0-9]+/.test(drv.url())) {
  const href = await drv.locator(`a[href^="/driver/deliveries/"]`).filter({ hasText: number }).first().getAttribute("href").catch(() => null);
  if (href) await go(drv, href);
}
check("driver's delivery page has the chat with the customer", (await drv.getByTestId("chat-tab-DRIVER").count()) === 1 && /Cliente/.test(await drv.getByTestId("chat-tab-DRIVER").textContent()), drv.url().replace(BASE, ""));
await send(drv, "Estou à porta, está fechado.", true);
check("driver's message with photo", (await drv.getByTestId("chat-messages").locator("img").count()) === 1);
await shot(drv, "chat-06-driver-phone", true);

await go(kebab, `/buy/orders/${orderId}`);
await kebab.getByTestId("chat-tab-DRIVER").click();
const img = kebab.getByTestId("chat-messages").locator("img").first();
const src = await img.getAttribute("src");
check("customer sees the driver's message and photo", /Motorista/.test(await kebab.getByTestId("chat-messages").textContent()) && (await kebab.request.get(`${BASE}${src}`)).status() === 200);
check("another supplier can't open the photo", (await (await login("owner@ibericas.test")).request.get(`${BASE}${src.replace("/buy/", "/vendor/")}`)).status() === 404);
await send(kebab, "Já vou abrir!");
await go(lx, `/vendor/orders/${orderId}`);
check("supplier (runs this delivery) is in the driver conversation", (await lx.getByTestId("chat-tab-DRIVER").count()) === 1);

// ── 8. FIRINGI switches the buyer ↔ supplier channel off and on; Business Features ──
await go(sa, "/admin/orders/chat");
await sa.getByTestId("chat-channel-BUYER_SUPPLIER").uncheck();
await sa.getByTestId("chat-save").click();
await until(async () => /Saved/.test(await sa.getByTestId("chat-settings").textContent()));
await go(kebab, `/buy/orders/${orderId}`);
check("channel off: no Fornecedor tab for the customer", (await kebab.getByTestId("chat-tab-BUYER_SUPPLIER").count()) === 0 && (await kebab.getByTestId("chat-tab-BUYER_FIRINGI").count()) === 1);
await go(sa, "/admin/orders/chat");
await sa.getByTestId("chat-channel-BUYER_SUPPLIER").check();
await sa.getByTestId("chat-save").click();
await until(async () => /Saved/.test(await sa.getByTestId("chat-settings").textContent()));
await go(sa, "/admin/settings/business-features");
const bf = sa.getByTestId("business-features").locator("tr", { hasText: "Lisboa Central" }).first();
check("Business Features: Order chat and Hide contacts switches (on)", (await bf.getByTestId("chat-switch").getAttribute("aria-checked")) === "true" && (await bf.getByTestId("chat-mask-switch").getAttribute("aria-checked")) === "true");

// ── 9. Phone width + dark ──
const kp = await login("owner@kebabhouse.test", { viewport: { width: 390, height: 844 }, colorScheme: "dark" });
await go(kp, `/buy/orders/${orderId}`);
await kp.getByTestId("order-chat-card").scrollIntoViewIfNeeded();
const over = await kp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check("phone width: no sideways scrolling (order with chat)", over <= 1, `${over}px`);
await shot(kp, "chat-07-phone-dark");
await go(kp, "/buy/orders/messages");
const over2 = await kp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check("phone width: no sideways scrolling (inbox)", over2 <= 1, `${over2}px`);

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nall chat checks passed");
process.exit(failures ? 1 : 0);
