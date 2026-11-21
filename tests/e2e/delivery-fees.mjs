/**
 * Browser test of the delivery fee rules against a running server with the demo seed:
 *  • admin switches FIRINGI free delivery on (Portugal, free from 60 €) → a small customer
 *    order below the wholesaler's minimum shows free delivery; switched off → flat rate again;
 *  • distributor sets its minimum by units + its flat rate → a wholesaler's small order shows
 *    the distributor's flat rate; then restores its rule.
 *   node tests/e2e/delivery-fees.mjs [baseUrl] [screenshotDir]
 */
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import { execFileSync as execDf } from "node:child_process";
// FIRINGI's free delivery in Portugal back off however this run ends (a crash used to leave it on for the other suites)
// The Kebab House's loyalty tier can include free delivery (Gold); test the delivery rules at Bronze and put the tier back after.
const DFDB = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/firingi";
const KEBAB_TIER = execDf("psql", ["-At", DFDB, "-c", `select a.tier from "LoyaltyAccount" a join "Company" c on c.id=a."companyId" where c."legalName"='Kebab House Lisboa, Lda'`], { encoding: "utf8" }).trim();
const setKebabTier = (t) => execDf("psql", ["-At", DFDB, "-c", `update "LoyaltyAccount" set tier='${t}' where "companyId"=(select id from "Company" where "legalName"='Kebab House Lisboa, Lda')`]);
if (KEBAB_TIER) { setKebabTier("BRONZE"); process.on("exit", () => { try { setKebabTier(KEBAB_TIER); } catch { /* best effort */ } }); }
process.on("exit", () => { try { execDf("psql", ["-At", process.env.E2E_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/firingi", "-c", `update "DeliveryRule" set "firingiFreeEnabled"=false, "firingiFreeFrom"=null where scope='COUNTRY' and "validTo" is null and "countryId"=(select id from "Country" where code='PT')`]); } catch { /* best effort */ } });

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
async function login(email) {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 950 } })).newPage();
  page.on("pageerror", (e) => errors.push(`${email}: ${e.message}`));
  await go(page, "/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await settle(page);
  return page;
}
const main = (p) => p.textContent("main");
async function fillCart(page, query, pick, qty) {
  const api = await (await page.request.get(`${BASE}/api/catalogue/offers?q=${query}`)).json();
  const offer = api.items.find(pick);
  await go(page, "/buy/orders/cart");
  const clear = page.getByRole("button", { name: /Esvaziar carrinho|Clear cart/ });
  if (await clear.count()) { await clear.click(); await settle(page); }
  await go(page, `/buy/catalogue/offers/${offer.offerId}`);
  await page.locator('main input[type="number"]').first().fill(String(qty));
  await page.getByRole("button", { name: /Adicionar ao carrinho|Add to cart/ }).click();
  await settle(page);
  await go(page, "/buy/orders/cart");
}
async function emptyCart(page) {
  await go(page, "/buy/orders/cart");
  const clear = page.getByRole("button", { name: /Esvaziar carrinho|Clear cart/ });
  if (await clear.count()) { await clear.click(); await settle(page); }
}

const ops = await login("ops@firingi.test");
const customer = await login("owner@kebabhouse.test");

// ── 1. FIRINGI free delivery (customer orders) ──
await go(ops, "/admin/delivery/minimum-order");
const pt = ops.getByTestId("country-rule-PT");
check("Portugal rule shows free delivery off", (await pt.textContent()).includes("free delivery off"));
const setFree = async (on, from) => {
  const form = ops.getByTestId("country-rule-PT").getByTestId("firingi-rule-form");
  if (on) await form.locator('input[name="freeEnabled"]').check(); else await form.locator('input[name="freeEnabled"]').uncheck();
  if (from !== undefined) await form.locator('input[name="freeFrom"]').fill(String(from));
  await form.getByRole("button", { name: "Save" }).click();
  await settle(ops);
};
await setFree(true, 60);
check("admin switches FIRINGI free delivery on from 60 €", (await ops.getByTestId("country-rule-PT").textContent()).includes("free from"));
await shot(ops, "fees-01-admin");

await fillCart(customer, "mozzarella", (i) => i.vendor.name === "Lisboa Central" && i.packaging.unitsPerPack === 1, 5); // ≈ 61 €
check("customer: FIRINGI delivers free (Portuguese)", (await customer.getByTestId("free-delivery").count()) === 1 && /Entrega gratuita/.test(await customer.getByTestId("free-delivery").textContent()));
await shot(customer, "fees-02-customer-free");

await go(ops, "/admin/delivery/minimum-order");
await setFree(false);
await go(customer, "/buy/orders/cart");
check("switched off: flat rate again", (await customer.getByTestId("free-delivery").count()) === 0 && /9,90/.test(await main(customer)));
await emptyCart(customer);

// ── 2. Distributor: minimum by units + its own flat rate ──
const atl = await login("owner@atlantico.test");
await go(atl, "/vendor/fleet/delivery-rules");
check("distributor sees the flat-rate field (Portuguese)", (await atl.getByText(/Taxa fixa de entrega abaixo do mínimo/).count()) === 1);
const rule = atl.getByTestId("vendor-delivery-rule");
const kindBefore = await rule.locator('select[name="minKind"]').inputValue();
const amountBefore = kindBefore === "AMOUNT" ? await rule.locator('input[name="minAmount"]').inputValue() : "";
const flatBefore = await rule.locator('input[name="flatFee"]').inputValue();
await rule.locator('select[name="minKind"]').selectOption("UNITS");
await rule.locator('input[name="minUnits"]').fill("8");
await rule.locator('input[name="flatFee"]').fill("12");
await rule.getByRole("button", { name: /^Guardar$|^Save$/ }).click();
await settle(atl);
const cur = await atl.getByTestId("current-rule").textContent();
check("distributor rule saved: free from 8 units, flat rate 12 €", cur.includes("8 unidades") && cur.includes("12,00"), cur);
await shot(atl, "fees-03-distributor");

const wholesaler = await login("purchasing@lisboacentral.test");
await fillCart(wholesaler, "farinha", (i) => i.vendor.name === "Atlântico", 5);
const cart = await main(wholesaler);
check("wholesaler: the distributor delivers at its flat rate", /taxa fixa/.test(cart) && /12,00/.test(cart), cart.match(/Entrega[^.]*\./)?.[0] ?? "");
await shot(wholesaler, "fees-04-wholesaler");
await emptyCart(wholesaler);

// restore the distributor's rule
await go(atl, "/vendor/fleet/delivery-rules");
await rule.locator('select[name="minKind"]').selectOption(kindBefore);
if (kindBefore === "AMOUNT") await rule.locator('input[name="minAmount"]').fill(amountBefore);
await rule.locator('input[name="flatFee"]').fill(flatBefore);
await rule.getByRole("button", { name: /^Guardar$|^Save$/ }).click();
await settle(atl);

check("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nAll delivery fee e2e checks passed");
process.exit(failures ? 1 : 0);
