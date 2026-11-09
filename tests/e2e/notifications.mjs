/**
 * Browser test of Phase 7 against a running server with the demo seed:
 * order → vendor's bell (Portuguese) → notifications page → vendor preferences (phone +
 * WhatsApp consent) → back office message log, WhatsApp test send, template edit + preview,
 * per-event channels; Operations can't change channels.
 *   node tests/e2e/notifications.mjs [baseUrl] [screenshotDir]
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
const settle = async (p) => { await p.waitForLoadState("networkidle"); await p.waitForTimeout(600); };
const go = async (p, url) => { await p.goto(`${BASE}${url}`); await settle(p); };
async function login(email) {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 950 } })).newPage();
  await go(page, "/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await settle(page);
  return page;
}
const main = (p) => p.textContent("main");

// ── 1. A customer order lights up the vendor's bell ──
const vendor = await login("owner@lisboacentral.test");
await vendor.getByTestId("bell").click();
await vendor.getByRole("button", { name: /Marcar todas como lidas|Mark all as read/ }).click().catch(() => {});
await settle(vendor);

const customer = await login("owner@kebabhouse.test");
const api = await (await customer.request.get(`${BASE}/api/catalogue/offers?q=pizza`)).json();
const offer = api.items.find((i) => i.vendor.name === "Lisboa Central");
await go(customer, "/buy/orders/cart");
const clear = customer.getByRole("button", { name: /Esvaziar carrinho|Clear cart/ });
if (await clear.count()) { await clear.click(); await settle(customer); }
await go(customer, `/buy/catalogue/offers/${offer.offerId}`);
await customer.locator('main input[type="number"]').first().fill("8");
await customer.getByRole("button", { name: /Adicionar ao carrinho|Add to cart/ }).click();
await settle(customer);
await go(customer, "/buy/orders/cart");
await customer.getByRole("button", { name: /Fazer encomenda|Place order/ }).click();
await customer.waitForURL("**placed=1", { timeout: 15000 });
await settle(customer);
const number = (await main(customer)).match(/FO-\d{4}-\d{6}/)[0];

await go(vendor, "/vendor/dashboard/overview");
const badge = await vendor.getByTestId("bell").getAttribute("aria-label");
check("vendor's bell shows unread notifications", /\((\d+)\)/.test(badge) && Number(badge.match(/\((\d+)\)/)[1]) > 0, badge);
await vendor.getByTestId("bell").click();
await vendor.waitForTimeout(500);
const panel = vendor.getByTestId("bell-panel");
check("bell lists the new order in Portuguese", (await panel.textContent()).includes(`Nova encomenda ${number}`));
await shot(vendor, "p7-01-bell", false);
await panel.getByRole("button", { name: new RegExp(`Nova encomenda ${number}`) }).click();
await vendor.waitForURL(`**/vendor/orders/**`, { timeout: 10000 });
check("clicking the notification opens the order", (await main(vendor)).includes(number));
await go(vendor, "/vendor/me/notifications");
check("notifications page lists it", (await main(vendor)).includes(`Nova encomenda ${number}`));

// ── 2. Vendor preferences: phone + WhatsApp consent ──
await go(vendor, "/vendor/me/notification-settings");
await vendor.fill('input[name="phone"]', "+351 912 000 222");
await vendor.locator('input[name="whatsappConsent"]').check();
await vendor.getByRole("button", { name: /^Guardar$|^Save$/ }).click();
await settle(vendor);
check("vendor saves phone + WhatsApp consent", /Guardado|Saved/.test(await main(vendor)));
await shot(vendor, "p7-02-preferences");

// ── 3. Back office ──
const sa = await login("superadmin@firingi.test");
await go(sa, `/admin/notifications/all?q=${encodeURIComponent("Nova encomenda")}`);
check("message log shows the order e-mails", (await main(sa)).includes(`Nova encomenda ${number}`));
await shot(sa, "p7-03-message-log");
await go(sa, "/admin/notifications/whatsapp");
check("WhatsApp page shows the provider status", /development \(log\)|live|not configured/.test(await main(sa)));
await sa.fill('input[name="testTo"]', "+351 912 345 678");
await sa.getByRole("button", { name: "Send test" }).click();
await settle(sa);
check("WhatsApp test message sent (log driver)", /Result: SENT/.test(await main(sa)));
await go(sa, "/admin/notifications/templates?event=order.confirmed&channel=EMAIL&locale=pt-PT");
const stamp = Date.now().toString().slice(-5);
await sa.fill('input[name="tplSubject"]', `Confirmada! {number} (${stamp})`);
await sa.getByRole("button", { name: "Save" }).first().click();
await settle(sa);
check("template override saved and previewed", (await sa.getByTestId("template-preview").textContent()).includes(`Confirmada! FO-2026-000123 (${stamp})`));
await shot(sa, "p7-04-templates");
await sa.getByRole("button", { name: "Reset to default" }).click();
await settle(sa);
check("template reset to the default text", (await sa.getByTestId("template-preview").textContent()).includes("Encomenda FO-2026-000123 confirmada"));
const row = sa.locator("tr", { hasText: "order.ready_for_pickup" });
await row.locator('input[name="order.ready_for_pickup-EMAIL"]').check();
await row.getByRole("button", { name: "Save" }).click();
await settle(sa);
check("event channels changed", await sa.locator('input[name="order.ready_for_pickup-EMAIL"]').isChecked());
await sa.locator("tr", { hasText: "order.ready_for_pickup" }).getByRole("button", { name: "Default" }).click();
await settle(sa);
check("event channels back to default", !(await sa.locator('input[name="order.ready_for_pickup-EMAIL"]').isChecked()));
const ops = await login("ops@firingi.test");
await go(ops, "/admin/notifications/email");
check("operations can't switch channels off", await ops.locator('input[name="channel-EMAIL"]').isDisabled());
await go(ops, "/admin/notifications/customer-messages");
check("operations can open the customer inbox", /Customer Messages/.test(await main(ops)));

// cleanup
await go(vendor, "/vendor/me/notification-settings");
await vendor.locator('input[name="whatsappConsent"]').uncheck();
await vendor.fill('input[name="phone"]', "");
await vendor.getByRole("button", { name: /^Guardar$|^Save$/ }).click();
await settle(vendor);

await browser.close();
console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll notification e2e checks passed");
process.exit(failures ? 1 : 0);
