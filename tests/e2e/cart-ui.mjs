/**
 * The cart page: compact lines per supplier, − / + stepper, remove, and on phones the total +
 * "Place order" bar that leads to the checkout form. No sideways scrolling.
 * Run: node tests/e2e/cart-ui.mjs http://localhost:3000
 */
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");

const BASE = process.argv[2] ?? "http://localhost:3000";
const PASSWORD = process.env.SEED_PASSWORD ?? "Firingi!2026";
let failed = 0;
const ok = (c, m) => { console.log(`${c ? "✓" : "✗"} ${m}`); if (!c) failed++; };
const settle = async (p) => { await p.waitForLoadState("networkidle").catch(() => {}); await p.waitForTimeout(600); };

const browser = await chromium.launch();
async function login(viewport) {
  const ctx = await browser.newContext({ viewport, locale: "pt-PT", serviceWorkers: "block" });
  const p = await ctx.newPage(); p.setDefaultTimeout(120000);
  await p.goto(`${BASE}/login`); await p.fill("#email", "owner@kebabhouse.test"); await p.fill("#password", PASSWORD); await p.click("button[type=submit]");
  await p.waitForURL((u) => u.pathname !== "/login");
  return p;
}
const totalOf = async (p) => (await p.getByTestId("cart-line-total").first().textContent()).trim();

const desk = await login({ width: 1360, height: 900 });
// Start clean, then add two products from Lisboa Central.
await desk.goto(`${BASE}/buy/orders/cart`); await settle(desk);
const clear = desk.getByRole("button", { name: /Esvaziar carrinho|Clear cart/ });
if (await clear.count()) { await clear.click(); await settle(desk); }
const offers = [];
for (const q of ["mozzarella", "azeite"]) {
  const r = await (await desk.request.get(`${BASE}/api/catalogue/offers?q=${q}`)).json();
  const o = r.items.find((i) => i.vendor.name === "Lisboa Central");
  if (o) offers.push(o.offerId);
}
for (const id of offers) {
  await desk.goto(`${BASE}/buy/catalogue/offers/${id}`); await settle(desk);
  await desk.locator('input[type="number"]').first().fill("2");
  await desk.getByRole("button", { name: /Adicionar ao carrinho|Add to cart/ }).click(); await settle(desk);
}
await desk.goto(`${BASE}/buy/orders/cart`); await settle(desk);
ok(await desk.getByTestId("cart-line").count() === offers.length, `cart shows ${offers.length} lines`);
ok(await desk.locator("main table").count() === 0, "no data-table tools (filter / columns / CSV) in the cart");

// Desktop: price, quantity and total sit close to the product, no wide empty strip.
const gap = await desk.getByTestId("cart-line").first().evaluate((li) => {
  const kids = [...li.children].map((c) => c.getBoundingClientRect());
  return kids[1].left - kids[0].right;
});
ok(gap >= 0 && gap < 60, `desktop: price column follows the product (gap ${Math.round(gap)} px)`);

// Stepper + and −
const before = await totalOf(desk);
await desk.getByTestId("cart-line").first().getByRole("button", { name: /\+$/ }).click(); await settle(desk);
await desk.waitForFunction((b) => document.querySelector("[data-testid='cart-line-total']")?.textContent?.trim() !== b, before, { timeout: 60000 }).catch(() => {});
const qty = await desk.getByTestId("cart-line").first().getByRole("spinbutton").inputValue();
ok(Number(qty) > 2 && (await totalOf(desk)) !== before, `+ raises the quantity (now ${qty}) and the line total`);
await desk.getByTestId("cart-line").first().getByRole("button", { name: /−$/ }).click(); await settle(desk);
await desk.waitForFunction((b) => document.querySelector("[data-testid='cart-line-total']")?.textContent?.trim() === b, before, { timeout: 60000 }).catch(() => {});
ok((await totalOf(desk)) === before, "− brings it back");

// Phone: total bar leads to the checkout form; no sideways scrolling.
const phone = await login({ width: 390, height: 844 });
await phone.goto(`${BASE}/buy/orders/cart`); await settle(phone);
const bar = phone.getByTestId("cart-bar");
ok(await bar.isVisible(), "phone: total + Place order bar is on screen");
ok(/€/.test(await bar.textContent()), "phone: bar shows the total");
ok(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "phone: no sideways scroll");
await bar.getByRole("button").click(); await phone.waitForTimeout(1500);
ok(await phone.locator("#checkout").evaluate((f) => { const r = f.getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0; }), "phone: the button scrolls to the checkout form");
ok(await bar.evaluate((b) => getComputedStyle(b).opacity === "0" || b.className.includes("opacity-0")), "phone: bar steps aside once the form is in view");
await phone.context().close();

// Remove: the line folds away and the cart reloads without it.
const n = await desk.getByTestId("cart-line").count();
await desk.getByTestId("cart-line").last().getByRole("button", { name: /Remover|Remove/ }).click();
await desk.waitForFunction((k) => document.querySelectorAll("[data-testid='cart-line']").length < k, n, { timeout: 60000 }).catch(() => {});
ok(await desk.getByTestId("cart-line").count() === n - 1, "remove takes the line out");

if (await clear.count()) { await clear.click(); await settle(desk); }
await browser.close();
console.log(failed ? `\n${failed} failed` : "\nAll passed");
process.exit(failed ? 1 : 0);
