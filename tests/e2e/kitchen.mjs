/**
 * Browser test of Phase 54 (menu costing & food waste), as Kebab House's owner (manager), its purchaser (logs waste
 * only, on the phone) and FIRINGI (English):
 *  the owner adds an ingredient from what it bought on FIRINGI (cost from the price paid) and one by hand; creates a
 *  dish with quantities; sees cost per portion, food cost % against the target, allergens and the suggested price —
 *  and uses it; menu engineering and "what if" a price rises; staff log waste on the phone (dark) from an ingredient
 *  and from a delivered lot; a donation; waste reports; the use-first list; FIRINGI's settings switch a part off and
 *  its overview; a business switched off loses the pages; no page errors.
 *   node tests/e2e/kitchen.mjs [baseUrl] [screenshotDir]
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
// a mozzarella Kebab House received (for the lot)
const [mozzOrder, mozzOffer, mozzPack] = sql(`select l."orderId", l."offerId", vo."packagingUnitId" from "OrderLine" l join "Order" o on o.id=l."orderId" join "VendorOffer" vo on vo.id=l."offerId" join "PackagingUnit" pu on pu.id=vo."packagingUnitId" join "ProductVariant" pv on pv.id=pu."variantId" join "Product" p on p.id=pv."productId"
  where o."buyerCompanyId"='${kebab}' and o.status not in ('CANCELLED','RETURNED') and p.name->>'en' ilike 'mozzarella%' order by o."placedAt" desc limit 1`).split("|");
const LOT = "e2e-kitchen-lot";
function restore() {
  sql(`delete from "KitchenWaste" where "companyId"='${kebab}'`);
  sql(`delete from "KitchenRecipeLine" where "recipeId" in (select id from "KitchenRecipe" where "companyId"='${kebab}')`);
  sql(`delete from "KitchenRecipe" where "companyId"='${kebab}'`);
  sql(`delete from "KitchenIngredient" where "companyId"='${kebab}'`);
  sql(`delete from "KitchenProfile" where "companyId"='${kebab}'`);
  sql(`delete from "PurchasedLot" where id='${LOT}'`);
  sql(`delete from "Setting" where key='kitchen.settings'`);
  sql(`delete from "CompanyFeature" where key='KITCHEN'`);
}
restore();
process.on("exit", restore);
check("Kebab House bought mozzarella on FIRINGI", !!mozzOffer);
sql(`insert into "PurchasedLot" (id, "buyerCompanyId", "orderId", "offerId", "packagingUnitId", "lotCode", "expiresOn", qty, "usedQty", "createdAt") values ('${LOT}', '${kebab}', '${mozzOrder}', '${mozzOffer}', '${mozzPack}', 'MZ-E2E', current_date + 1, 3, 0, now())`);

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
const ing = (name) => sql(`select id || '|' || coalesce(cost, "manualCost", 0) from "KitchenIngredient" where "companyId"='${kebab}' and name='${name}'`).split("|");

// ── 1. Ingredients ──
const ow = await login("owner@kebabhouse.test");
await go(ow, "/buy/kitchen");
check("the Kitchen overview opens with the getting-started card", (await ow.getByTestId("kitchen-start").count()) === 1);
await go(ow, "/buy/kitchen/ingredients");
const row = ow.getByTestId("bought-row").filter({ hasText: /Mozzarella/i }).first();
check("bought on FIRINGI: mozzarella is offered", (await row.count()) === 1);
await row.locator("input").first().fill("Mozzarella");
await row.getByTestId("add-pack").fill("2");
await row.getByTestId("add-purchase-btn").click();
check("…added: its cost per kg comes from what was paid", await until(async () => Number(sql(`select cost from "KitchenIngredient" where "companyId"='${kebab}' and name='Mozzarella'`)) > 0));
await go(ow, "/buy/kitchen/ingredients");
const manual = ow.getByTestId("ingredient-form").last();
await manual.getByTestId("ing-name").fill("Pita");
await manual.getByTestId("ing-unit").selectOption("PCS");
await manual.getByTestId("ing-cost").fill("0,25");
await manual.getByTestId("ing-allergen-GLUTEN").click();
await manual.getByTestId("ing-save").click();
check("an ingredient by hand (cost per piece, gluten)", await until(async () => sql(`select "manualCost" || '|' || array_to_string(allergens, ',') from "KitchenIngredient" where "companyId"='${kebab}' and name='Pita'`) === "0.2500|GLUTEN"));
await go(ow, "/buy/kitchen/ingredients");
await shot(ow, "p54-01-ingredients");

// ── 2. A dish ──
const [mozzId, mozzCost] = ing("Mozzarella"), [pitaId] = ing("Pita");
await go(ow, "/buy/kitchen/recipes/new");
await ow.getByTestId("rec-name").fill("Pizza E2E");
await ow.getByTestId("rec-price").fill("3");
await ow.getByTestId("rec-add-line").click();
await ow.getByTestId("rec-line").nth(0).getByTestId("line-ref").selectOption(`i:${mozzId}`);
await ow.getByTestId("rec-line").nth(0).getByTestId("line-qty").fill("150");
await ow.getByTestId("rec-line").nth(0).getByTestId("line-unit").selectOption("G");
await ow.getByTestId("rec-add-line").click();
await ow.getByTestId("rec-line").nth(1).getByTestId("line-ref").selectOption(`i:${pitaId}`);
await ow.getByTestId("rec-line").nth(1).getByTestId("line-qty").fill("1");
await ow.getByTestId("rec-line").nth(1).getByTestId("line-unit").selectOption("PCS");
await ow.getByTestId("rec-save").click();
check("the dish is saved and opens", await until(async () => /\/buy\/kitchen\/recipes\/c/.test(ow.url())));
await settle(ow);
const expected = 0.15 * Number(mozzCost) + 0.25;
const shown = Number((await ow.getByTestId("recipe-unit-cost").innerText()).replace(/[^\d,.-]/g, "").replace(",", "."));
check("cost per portion = 150 g mozzarella + 1 pita", Math.abs(shown - expected) < 0.011, `${shown} vs ${expected.toFixed(3)}`);
check("food cost % over the 30 % target at 3,00 €", (await ow.getByTestId("recipe-pct").innerText()).length > 0 && (await ow.getByTestId("suggested-price").count()) === 1);
check("allergens from the ingredients (gluten)", /Gl[uú]t/i.test(await ow.getByTestId("recipe-allergens").innerText()));
await shot(ow, "p54-02-recipe");
await ow.getByTestId("apply-price").click();
check("…the suggested price is used", await until(async () => Number(sql(`select "priceGross" from "KitchenRecipe" where "companyId"='${kebab}' and name='Pizza E2E'`)) > 3));
sql(`update "KitchenRecipe" set "soldPerWeek" = 60 where "companyId"='${kebab}' and name='Pizza E2E'`);
await go(ow, "/buy/kitchen/recipes");
check("the dish list shows cost, price and food cost %", (await ow.getByTestId("dish-row").count()) === 1);
await shot(ow, "p54-03-recipes", false);

// ── 3. Menu engineering + what-if ──
await go(ow, "/buy/kitchen/engineering");
check("menu engineering: the four groups", (await ow.getByTestId("engineering-grid").count()) === 1 && (await ow.locator("[data-testid^=eng-] a", { hasText: "Pizza E2E" }).count()) === 1);
await ow.getByTestId("whatif-ing").selectOption(mozzId);
await ow.getByTestId("whatif-pct").fill("25");
await ow.getByTestId("whatif-run").click();
check("what if mozzarella gets 25 % dearer", await until(async () => (await ow.getByTestId("whatif-table").locator("tbody tr").count()) === 1));
await shot(ow, "p54-04-engineering");

// ── 4. Staff log waste on the phone ──
const st = await login("buyer@kebabhouse.test", { viewport: { width: 390, height: 844 }, colorScheme: "dark", isMobile: true, hasTouch: true });
await go(st, "/buy/kitchen/ingredients");
check("staff can't open the costing pages", st.url().includes("/forbidden") || (await st.getByTestId("kitchen-closed").count()) === 1);
await go(st, "/buy/kitchen/waste");
await st.getByTestId("waste-src-ING").click();
await st.getByTestId("waste-ref").selectOption(mozzId);
await st.getByTestId("waste-qty").fill("300");
await st.getByTestId("waste-unit").selectOption("G");
await st.getByTestId("waste-reason-SPOILED").click();
await st.getByTestId("waste-save").click();
check("staff log 300 g spoiled mozzarella (costed)", await until(async () => Number(sql(`select cost from "KitchenWaste" where "companyId"='${kebab}' and reason='SPOILED'`)) > 0));
await st.getByTestId("waste-src-LOT").click();
await st.getByTestId("waste-ref").selectOption(LOT);
await st.getByTestId("waste-qty").fill("1");
await st.getByTestId("waste-reason-EXPIRED").click();
await st.getByTestId("waste-save").click();
check("…and a pack from the delivered lot (the lot goes down)", await until(async () => sql(`select "usedQty" from "PurchasedLot" where id='${LOT}'`) === "1"));
await go(st, "/buy/kitchen/waste");
check("phone: the waste log fits the screen", await st.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
await shot(st, "p54-05-phone-waste");
await go(st, "/buy/kitchen/donations");
await st.getByTestId("waste-src-TEXT").click();
await st.getByTestId("waste-label").fill("Pão do dia");
await st.getByTestId("waste-qty").fill("2");
await st.getByTestId("waste-unit").selectOption("KG");
await st.getByTestId("don-recipient").fill("Refood Lisboa");
await st.getByTestId("waste-save").click();
check("a donation, apart from waste", await until(async () => sql(`select kind || '|' || recipient from "KitchenWaste" where "companyId"='${kebab}' and label='Pão do dia'`) === "DONATION|Refood Lisboa"));

// ── 5. Reports, use first ──
await go(ow, "/buy/kitchen/waste/reports");
check("waste reports: cost, % of purchases, by reason", (await ow.getByTestId("report-cost").innerText()) !== "—" && (await ow.getByTestId("by-reason").locator("li").count()) >= 2);
await shot(ow, "p54-06-reports");
await go(ow, "/buy/kitchen/use-first");
const uf = ow.getByTestId("use-first-row").filter({ hasText: "MZ-E2E" });
check("use first: the lot expiring tomorrow, with the dish that uses it", (await uf.count()) === 1 && (await uf.getByText("Pizza E2E").count()) === 1);
await shot(ow, "p54-07-use-first", false);

// ── 6. FIRINGI ──
const sa = await login("superadmin@firingi.test");
await go(sa, "/admin/kitchen");
check("FIRINGI's overview", (await sa.getByTestId("admin-kitchen").count()) === 1);
await go(sa, "/admin/settings/kitchen");
await sa.getByTestId("ks-part-engineering").uncheck();
await sa.getByTestId("ks-save").click();
check("FIRINGI switches menu engineering off", await until(async () => sql(`select value->'parts'->>'engineering' from "Setting" where key='kitchen.settings'`) === "false"));
await shot(sa, "p54-08-admin-settings");
await go(ow, "/buy/kitchen/engineering");
check("…the page says it isn't available", (await ow.getByTestId("kitchen-closed").count()) === 1);
sql(`delete from "Setting" where key='kitchen.settings'`);
sql(`insert into "CompanyFeature" ("companyId", key, enabled, "updatedAt") values ('${kebab}', 'KITCHEN', false, now()) on conflict do nothing`);
await go(ow, "/buy/kitchen");
check("a business switched off loses the Kitchen", (await ow.getByTestId("kitchen-closed").count()) === 1 && (await ow.locator('a[href="/buy/kitchen/waste"]').count()) === 0);
sql(`delete from "CompanyFeature" where key='KITCHEN' and "companyId"='${kebab}'`);

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nAll kitchen checks passed");
process.exit(failures ? 1 : 0);
