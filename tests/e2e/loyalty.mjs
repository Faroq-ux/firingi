/**
 * Browser test of Phase 32 — loyalty & rewards:
 * FIRINGI — Loyalty & Rewards page (KPIs, rules), a 2× bonus campaign, members, giving points by hand;
 * customer (Portuguese) — Rewards page (points, level, benefits, campaign, invite link, history),
 * points in the cart (FIRINGI-funded discount, shown apart), order placed with points, points earned on
 * delivery (2× campaign), points turned into a credit note on an unpaid invoice; referral code on the
 * registration form; FIRINGI switches loyalty off for the company → gone; phone width + dark.
 *   node tests/e2e/loyalty.mjs [baseUrl] [screenshotDir]
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
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn().catch(() => false)) return true; await new Promise((r) => setTimeout(r, 250)); } return false; };
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
const pointsOf = async (p) => Number((await p.getByTestId("points-balance").textContent()).replace(/\D/g, ""));

const sa = await login("superadmin@firingi.test");
const k = await login("owner@kebabhouse.test");
const lx = await login("owner@lisboacentral.test");

// ── 1. FIRINGI: Loyalty & Rewards ──
await go(sa, "/admin/marketing/loyalty/members"); // make sure the job ran once (accounts exist)
await go(sa, "/admin/marketing/loyalty");
await sa.getByTestId("loyalty-run").click();
await until(async () => /up to date/.test(await main(sa)), 60000);
check("Loyalty page: KPIs and rules (English)", (await sa.getByTestId("loyalty-kpis").count()) === 1 && (await sa.getByTestId("loyalty-settings").count()) === 1 && /Points outstanding/.test(await main(sa)));
await sa.locator("#ls-minRedeem").fill("500");
await sa.getByTestId("loyalty-save").click();
check("rules saved", await until(async () => /Saved/.test(await sa.getByTestId("loyalty-settings").textContent())));
await shot(sa, "loyalty-01-admin-overview");

await go(sa, "/admin/marketing/loyalty/campaigns");
await sa.locator("#cf-name").fill("Semana de pontos a dobrar");
await sa.locator("#cf-msg").fill("Pontos a dobrar em tudo esta semana");
await sa.getByRole("button", { name: "Start campaign" }).click();
check("2× campaign running", await until(async () => /Running/.test(await sa.getByTestId("campaigns-table").textContent()) && /Semana de pontos a dobrar/.test(await sa.getByTestId("campaigns-table").textContent())));
await shot(sa, "loyalty-02-admin-campaigns");

await go(sa, "/admin/marketing/loyalty/members");
const kRow = sa.getByTestId("members-table").locator("a", { hasText: "Kebab House" }).first();
check("Kebab House is a member", (await kRow.count()) === 1);
await kRow.click(); await settle(sa);
const before = Number((await sa.getByTestId("member-balance").textContent()).replace(/\D/g, ""));
await sa.locator("#adj-points").fill("3000");
await sa.locator("#adj-reason").fill("E2E: boas-vindas ao programa");
await sa.getByRole("button", { name: "Change points" }).click();
check("FIRINGI gave 3000 points (audited reason)", await until(async () => Number((await sa.getByTestId("member-balance").textContent()).replace(/\D/g, "")) === before + 3000) && /E2E: boas-vindas/.test(await sa.getByTestId("ledger-table").textContent()));
await shot(sa, "loyalty-03-admin-member");

// ── 2. Customer: Rewards page (Portuguese) ──
await go(k, "/buy/rewards");
check("menu shows Recompensas", (await k.locator("aside").getByText(/^Recompensas$/).count()) > 0);
check("Rewards: points, level, benefits", (await pointsOf(k)) >= 3000 && (await k.getByTestId("tier-name").count()) === 1 && /pontos por cada €/.test(await k.getByTestId("tier-perks").textContent()));
check("Rewards: running campaign shown", /2× pontos até/.test(await k.getByTestId("rewards-campaigns").textContent()) && /Pontos a dobrar em tudo/.test(await k.getByTestId("rewards-campaigns").textContent()));
const code = (await k.getByTestId("referral-code").textContent()).trim();
check("invite code and link", /^[A-Z0-9]{6,}$/.test(code) && (await k.getByTestId("referral-link").textContent()).includes(`ref=${code}`));
check("history in Portuguese", /Bónus da FIRINGI/.test(await k.getByTestId("points-history").textContent()));
await shot(k, "loyalty-04-rewards", true);

// ── 3. Points in the cart → order ──
const api = await (await k.request.get(`${BASE}/api/catalogue/offers?q=pizza`)).json();
const offer = api.items.find((i) => i.vendor.name === "Lisboa Central");
await go(k, "/buy/orders/cart");
const clear = k.getByRole("button", { name: /Esvaziar carrinho|Clear cart/ });
if (await clear.count()) { await clear.click(); await settle(k); }
await go(k, `/buy/catalogue/offers/${offer.offerId}`);
await k.locator('main input[type="number"]').first().fill("8");
await k.getByRole("button", { name: /Adicionar ao carrinho|Add to cart/ }).click();
await settle(k);
await go(k, "/buy/orders/cart");
const totalBefore = (await main(k)).match(/Total \(c\/ IVA\)\s*([\d.,\s]+€)/)?.[1];
check("cart offers the points (Portuguese)", (await k.getByTestId("cart-points").count()) === 1 && /Usar os seus pontos/.test(await k.getByTestId("cart-points").textContent()));
await k.locator("#cart-points-input").fill("100");
await k.getByTestId("cart-points").getByRole("button", { name: "Usar", exact: true }).click();
check("below the minimum → told", await until(async () => /pelo menos 500/i.test(await k.getByTestId("cart-points").textContent())));
await k.locator("#cart-points-input").fill("1000");
await k.getByTestId("cart-points").getByRole("button", { name: "Usar", exact: true }).click();
check("1000 points = −10 € in the cart, shown apart from offers", await until(async () => (await k.getByTestId("points-discount").count()) === 1) && /10,00/.test(await k.getByTestId("points-discount").textContent()) && /1000 pontos usados/.test(await k.getByTestId("cart-points-applied").textContent()));
const totalAfter = (await main(k)).match(/Total \(c\/ IVA\)\s*([\d.,\s]+€)/)?.[1];
check("total went down", !!totalBefore && !!totalAfter && totalBefore !== totalAfter, `${totalBefore} → ${totalAfter}`);
await shot(k, "loyalty-05-cart-points");
const ptsBeforeOrder = await (async () => { const p = await login("owner@kebabhouse.test"); await go(p, "/buy/rewards"); const n = await pointsOf(p); await p.context().close(); return n; })();
await k.getByRole("button", { name: /Fazer encomenda|Place order/ }).click();
await k.waitForURL("**placed=1", { timeout: 15000 }).catch(() => {});
await settle(k);
const orderId = k.url().split("/").pop().split("?")[0];
await go(k, "/buy/rewards");
check("points spent on the order", (await pointsOf(k)) === ptsBeforeOrder - 1000 && /Usados numa encomenda/.test(await k.getByTestId("points-history").textContent()));

// supplier delivers → points earned (2× campaign)
await go(lx, `/vendor/orders/${orderId}`);
await lx.getByRole("button", { name: /Confirmar encomenda|Confirm order/ }).click(); await settle(lx);
for (const s of [/Pronta para recolha|Ready for pickup/, /Expedida|Dispatched/, /Em distribuição|Out for delivery/, /Entregue|Delivered/]) { await lx.getByRole("button", { name: s }).first().click(); await settle(lx); }
await go(k, "/buy/rewards");
const afterDelivery = await pointsOf(k);
check("points earned on delivery (2× campaign)", afterDelivery > ptsBeforeOrder - 1000 && /Encomenda entregue/.test(await k.getByTestId("points-history").textContent()), `${ptsBeforeOrder - 1000} → ${afterDelivery}`);

// ── 4. Points → credit note ──
await k.locator("#credit-points").fill("1000");
await k.getByTestId("credit-submit").click();
check("credit note on an unpaid invoice", await until(async () => /Nota de crédito .+ de 10,00/.test(await k.getByTestId("credit-msg").textContent())), (await k.getByTestId("credit-msg").textContent().catch(() => "")) ?? "");
await go(k, "/buy/rewards");
check("history: turned into credit", /Convertidos em crédito/.test(await k.getByTestId("points-history").textContent()));
await shot(k, "loyalty-06-credit");

// ── 5. Referral code on the registration form ──
const anon = await (await browser.newContext()).newPage();
await go(anon, `/register/customer?ref=${code}`);
check("registration shows the invitation", (await anon.getByTestId("referral-note").count()) === 1 && (await anon.getByTestId("referral-note").textContent()).includes(code));
await anon.context().close();

// ── 6. Phone + dark ──
const kp = await login("owner@kebabhouse.test", { viewport: { width: 390, height: 844 }, colorScheme: "dark" });
await go(kp, "/buy/rewards");
const overflow = await kp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check("phone width: no sideways scrolling", overflow <= 1, `${overflow}px`);
await shot(kp, "loyalty-07-phone-dark");

// ── 7. Switched off for the company → gone; end the campaign ──
await go(sa, "/admin/settings/business-features");
const row = sa.getByTestId("business-features").locator("tr", { hasText: "Kebab House" }).first();
check("Business Features: Loyalty on by default", (await row.getByTestId("loyalty-switch").getAttribute("aria-checked")) === "true");
await row.getByTestId("loyalty-switch").click();
check("loyalty switched off for Kebab House", await until(async () => (await row.getByTestId("loyalty-switch").getAttribute("aria-checked")) === "false"));
check("customer: Rewards gone", await until(async () => (await k.request.get(`${BASE}/buy/rewards`)).status() === 404));
await row.getByTestId("loyalty-switch").click();
await until(async () => (await row.getByTestId("loyalty-switch").getAttribute("aria-checked")) === "true");
await go(sa, "/admin/marketing/loyalty/campaigns");
const end = sa.getByTestId("campaigns-table").getByTestId("campaign-end").first();
if (await end.count()) { await end.click(); await settle(sa); }
check("campaign ended", await until(async () => /Ended/.test(await sa.getByTestId("campaigns-table").textContent())));

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nall loyalty checks passed");
process.exit(failures ? 1 : 0);
