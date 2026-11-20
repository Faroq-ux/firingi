/**
 * Browser test of Phase 55 (rewards shop), as FIRINGI (English), Lisboa Central (supplier) and Kebab House (customer):
 *  FIRINGI adds a voucher, a gift with stock and a partner offer with pasted codes; the supplier offers its own product,
 *  FIRINGI accepts it; the customer browses the shop (desktop + phone, dark), redeems the voucher (code → cart coupon),
 *  the supplier's product (free in the cart), the gift (to an address) and the partner offer (code shown); FIRINGI ships
 *  the gift with tracking; the supplier sees what to hand over; FIRINGI switches a kind off and then the business; no
 *  page errors.
 *   node tests/e2e/rewards.mjs [baseUrl] [screenshotDir]
 */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
const { chromium } = createRequire(import.meta.url)("playwright");

const DB = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/firingi";
const sql = (q) => execFileSync("psql", ["-At", DB, "-c", q], { encoding: "utf8" }).trim();
const BASE = process.argv[2] ?? "http://localhost:3000";
const SHOTS = process.argv[3] ?? null;
const PASSWORD = process.env.SEED_PASSWORD ?? "Firingi!2026";
let failures = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "✔" : "✘"} ${name}${extra ? ` — ${extra}` : ""}`); if (!ok) failures++; };
const shot = async (page, name, full = true) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: full });
const settle = async (p) => { await p.waitForLoadState("networkidle").catch(() => {}); await p.waitForFunction(() => !document.querySelector("[aria-busy=true]"), null, { timeout: 15000 }).catch(() => {}); await p.waitForTimeout(500); };
const go = async (p, url) => { await p.goto(`${BASE}${url}`); await settle(p); };
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn().catch(() => false)) return true; await new Promise((r) => setTimeout(r, 400)); } return false; };

const kebab = sql(`select c.id from "Company" c join "Membership" m on m."companyId"=c.id join "User" u on u.id=m."userId" where u.email='owner@kebabhouse.test' limit 1`);
const lx = sql(`select c.id from "Company" c join "Membership" m on m."companyId"=c.id join "User" u on u.id=m."userId" where u.email='owner@lisboacentral.test' limit 1`);
const balance = () => Number(sql(`select coalesce((select balance from "LoyaltyAccount" where "companyId"='${kebab}'), 0)`));

function restore() {
  sql(`update "Cart" set "couponCode"=null where "buyerCompanyId"='${kebab}'`);
  sql(`delete from "CartItem" where "cartId" in (select id from "Cart" where "buyerCompanyId"='${kebab}')`);
  sql(`update "Promotion" set status='ENDED' where id in (select "promotionId" from "RewardRedemption" where "promotionId" is not null)`);
  sql(`delete from "RewardPartnerCode"`);
  sql(`delete from "RewardRedemption"`);
  sql(`delete from "RewardItem"`);
  sql(`delete from "Setting" where key='rewards.settings'`);
  sql(`delete from "CompanyFeature" where key='REWARDS_SHOP'`);
}
restore();
// the points ledger as it was (spending touches older lots), put back at the end
sql(`insert into "LoyaltyAccount" ("companyId", balance, "lifetimeEarned", "referralCode", "updatedAt") values ('${kebab}', 0, 0, 'E2ERW' || substr(md5(random()::text), 1, 5), now()) on conflict do nothing`);
const ledger = sql(`select coalesce(json_agg(json_build_object('id', id, 'r', remaining)), '[]') from "LoyaltyEntry" where "companyId"='${kebab}'`);
const [bal0, life0] = sql(`select balance || '|' || "lifetimeEarned" from "LoyaltyAccount" where "companyId"='${kebab}'`).split("|");
function restoreLedger() {
  const rows = JSON.parse(ledger);
  sql(`delete from "LoyaltyEntry" where "companyId"='${kebab}'${rows.length ? ` and id not in (${rows.map((r) => `'${r.id}'`).join(",")})` : ""}`);
  for (const r of rows) sql(`update "LoyaltyEntry" set remaining=${r.r} where id='${r.id}'`);
  sql(`update "LoyaltyAccount" set balance=${bal0}, "lifetimeEarned"=${life0}, "goalRewardId"=null where "companyId"='${kebab}'`);
}
process.on("exit", () => { restore(); restoreLedger(); });
// points to spend (a FIRINGI bonus)
if (!sql(`select 1 from "LoyaltyEntry" where "dedupeKey"='e2e-rewards-bonus'`)) {
  sql(`insert into "LoyaltyEntry" (id, "companyId", kind, points, remaining, "expiresAt", note, "dedupeKey", "createdAt") values ('e2e-rewards-bonus', '${kebab}', 'BONUS', 20000, 20000, now() + interval '300 days', 'e2e rewards', 'e2e-rewards-bonus', now())`);
  sql(`update "LoyaltyAccount" set balance = balance + 20000, "lifetimeEarned" = "lifetimeEarned" + 20000 where "companyId"='${kebab}'`);
}
check("Kebab House has points to spend", balance() >= 5000, String(balance()));

const browser = await chromium.launch();
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
const itemId = (title) => sql(`select id from "RewardItem" where title->>'en'='${title}' order by "createdAt" desc limit 1`);

// ── 1. FIRINGI fills the shop ──
const sa = await login("superadmin@firingi.test");
async function newReward(kind, title, fill) {
  await go(sa, `/admin/marketing/rewards/new?kind=${kind}`);
  await sa.getByTestId("ar-title-en").fill(title);
  await fill();
  await sa.getByTestId("ar-save").click();
  await until(async () => !!itemId(title));
  await sa.waitForURL(/\/admin\/marketing\/rewards\/(?!new)/, { timeout: 15000 }).catch(() => {});
  await settle(sa);
  return itemId(title);
}
const voucher = await newReward("VOUCHER", "€5 off your order", async () => { await sa.getByTestId("ar-points").fill("1000"); await sa.getByTestId("ar-amount").fill("5"); });
check("FIRINGI adds a voucher (live in the shop)", sql(`select status from "RewardItem" where id='${voucher}'`) === "ACTIVE");
await shot(sa, "p55-01-admin-voucher");
const gift = await newReward("GIFT", "FIRINGI chef apron", async () => { await sa.getByTestId("ar-points").fill("1500"); await sa.getByTestId("ar-stock").fill("3"); });
check("…a gift with a stock count", sql(`select stock from "RewardItem" where id='${gift}'`) === "3");
const partner = await newReward("PARTNER", "10% at Café Central", async () => { await sa.getByTestId("ar-points").fill("400"); await sa.getByTestId("ar-partner").fill("Café Central"); });
await sa.getByTestId("codes-text").fill("CAFE-001\nCAFE-002\nCAFE-001\nx");
await sa.getByTestId("codes-add").click();
check("…a partner offer with pasted codes (duplicates and bad ones skipped)", await until(async () => sql(`select count(*) from "RewardPartnerCode" where "rewardId"='${partner}'`) === "2"));

// ── 2. The supplier offers its own product; FIRINGI accepts it ──
const sup = await login("owner@lisboacentral.test");
await go(sup, "/vendor/products/rewards");
const mozz = await sup.getByTestId("sr-offer").evaluate((s) => [...s.options].find((o) => /mozzarella/i.test(o.text))?.value ?? s.options[0]?.value);
await sup.getByTestId("sr-offer").selectOption(mozz);
await sup.getByTestId("sr-title").fill("2 × mozzarella on us");
await sup.getByTestId("sr-qty").fill("2");
await sup.getByTestId("sr-points").fill("800");
await sup.getByTestId("sr-stock").fill("5");
await sup.getByTestId("sr-save").click();
const supReward = await until(async () => !!itemId("2 × mozzarella on us")) ? itemId("2 × mozzarella on us") : "";
check("the supplier offers a product — waiting for FIRINGI", sql(`select status from "RewardItem" where id='${supReward}'`) === "PENDING");
await go(sup, "/vendor/products/rewards");
check("…shown as waiting on its page", (await sup.getByTestId("sr-row").filter({ hasText: "2 × mozzarella" }).getByTestId("sr-status").innerText()).length > 0);
await shot(sup, "p55-02-supplier-rewards");
await go(sa, `/admin/marketing/rewards/${supReward}`);
await sa.getByTestId("ar-approve").click();
check("FIRINGI accepts it", await until(async () => sql(`select status from "RewardItem" where id='${supReward}'`) === "ACTIVE"));

// ── 3. The customer shops ──
const ow = await login("owner@kebabhouse.test");
await go(ow, "/buy/rewards");
check("the points page links to the shop", (await ow.getByTestId("to-shop").count()) === 1);
await go(ow, "/buy/rewards/shop");
check("the shop shows the rewards", (await ow.getByTestId("shop-item").count()) >= 4, String(await ow.getByTestId("shop-item").count()));
check("…and the points", (await ow.getByTestId("shop-points").innerText()).replace(/\D/g, "") === String(balance()));
await shot(ow, "p55-03-shop");
// voucher → code → cart
const b0 = balance();
await go(ow, `/buy/rewards/shop/${voucher}`);
await ow.getByTestId("redeem-btn").click();
await ow.getByTestId("redeem-done").waitFor({ timeout: 15000 }).catch(() => {});
const code = (await ow.getByTestId("reward-code").first().innerText().catch(() => "")).trim();
check("redeeming the voucher gives a code", /^RW-[A-Z0-9]{8}$/.test(code), code);
check("…and takes the points", balance() === b0 - 1000);
await shot(ow, "p55-04-redeemed");
await ow.getByTestId("reward-use").click();
check("“use in cart” puts the coupon in the cart", await until(async () => sql(`select "couponCode" from "Cart" where "buyerCompanyId"='${kebab}' and "couponCode" is not null limit 1`) === code));
// supplier product → free in the cart
await go(ow, `/buy/rewards/shop/${supReward}`);
await ow.getByTestId("redeem-btn").click();
await ow.getByTestId("redeem-done").waitFor({ timeout: 15000 }).catch(() => {});
await ow.getByTestId("reward-use").click();
await ow.waitForURL(/\/buy\/orders\/cart/, { timeout: 15000 }).catch(() => {});
await settle(ow);
check("the supplier's product is free in the cart", (await ow.getByTestId("cart-free-reward").count()) === 1);
await shot(ow, "p55-05-cart-free");
// gift → address; partner → code
await go(ow, `/buy/rewards/shop/${gift}`);
check("a gift asks where to send it", (await ow.getByTestId("gift-address").count()) === 1);
await ow.getByTestId("redeem-btn").click();
await ow.getByTestId("redeem-done").waitFor({ timeout: 15000 }).catch(() => {});
check("…redeemed, stock down", sql(`select stock from "RewardItem" where id='${gift}'`) === "2");
await go(ow, `/buy/rewards/shop/${partner}`);
await ow.getByTestId("redeem-btn").click();
await ow.getByTestId("redeem-done").waitFor({ timeout: 15000 }).catch(() => {});
check("the partner offer shows its code", (await ow.getByTestId("reward-code").first().innerText().catch(() => "")).trim() === "CAFE-001");
await go(ow, "/buy/rewards/mine");
check("My Rewards lists all four", (await ow.getByTestId("mine-row").count()) === 4);
await shot(ow, "p55-06-mine");

// ── 4. FIRINGI ships the gift; the supplier sees what to hand over ──
await go(sa, "/admin/marketing/rewards/redemptions?kind=GIFT");
const giftRow = sa.getByTestId("red-row").filter({ hasText: "apron" }).first();
await giftRow.getByTestId("gift-tracking").fill("CTT RR123456789PT");
await giftRow.getByTestId("gift-ship").click();
check("FIRINGI ships the gift with tracking", await until(async () => sql(`select r.status || '|' || r.tracking from "RewardRedemption" r join "RewardItem" i on i.id=r."rewardId" where i.id='${gift}'`) === "SHIPPED|CTT RR123456789PT"));
await shot(sa, "p55-07-admin-redemptions");
await go(ow, "/buy/rewards/mine");
check("…the customer sees it on its way", (await ow.getByTestId("mine-row").filter({ hasText: "CTT RR123456789PT" }).count()) === 1);
await go(sup, "/vendor/products/rewards/handover");
check("the supplier sees the customer's reward to hand over", (await sup.getByTestId("handover-row").count()) === 1);
await shot(sup, "p55-08-supplier-handover", false);
await go(sa, "/admin/marketing/rewards");
check("FIRINGI's shop page lists them with numbers", (await sa.getByTestId("ar-row").count()) === 4);
await shot(sa, "p55-09-admin-shop");

// ── 5. Phone, dark ──
const ph = await login("owner@kebabhouse.test", { viewport: { width: 390, height: 844 }, colorScheme: "dark", isMobile: true, hasTouch: true });
await go(ph, "/buy/rewards/shop");
check("the shop fits a phone", await ph.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
await shot(ph, "p55-10-phone-shop", false);
await go(ph, "/buy/rewards/mine");
check("My Rewards fits a phone", await ph.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
await shot(ph, "p55-11-phone-mine", false);

// ── 6. FIRINGI's switches ──
await go(sa, "/admin/settings/rewards");
await sa.getByTestId("rs-kind-GIFT").uncheck();
await sa.getByTestId("rs-save").click();
check("FIRINGI switches gifts off", await until(async () => sql(`select value->'kinds'->>'GIFT' from "Setting" where key='rewards.settings'`) === "false"));
await shot(sa, "p55-12-admin-settings");
await go(ow, "/buy/rewards/shop");
check("…gifts leave the shop", (await ow.getByTestId("shop-tab-GIFT").count()) === 0 && (await ow.getByTestId("shop-item").filter({ hasText: "apron" }).count()) === 0);
sql(`insert into "CompanyFeature" ("companyId", key, enabled, "updatedAt") values ('${kebab}', 'REWARDS_SHOP', false, now()) on conflict do nothing`);
await go(ow, "/buy/rewards/shop");
check("a business switched off sees the shop closed and loses the menu items", (await ow.getByTestId("rewards-closed").count()) === 1 && (await ow.locator('a[href="/buy/rewards/shop"]').count()) === 0);

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nAll rewards checks passed");
process.exit(failures ? 1 : 0);
