/**
 * Browser test of Phase 44 (food information & allergens). Supplier and customer in Portuguese, FIRINGI in English:
 * the supplier uploads the kebab cone's label photo, lets the (simulated) AI fill in a draft, corrects it (milk, no
 * vegan claim) and sends it → FIRINGI approves it in the review queue → the customer sees allergens, ingredients
 * (allergens in bold) and nutrition on the product page, filters "free from gluten", sets a kitchen allergen profile
 * (warning on the product page and in the cart), orders → the supplier changes the recipe (now may contain sesame)
 * → FIRINGI sees "new allergen" and approves → the customer is told (urgent: sesame is on its avoid list) → allergen
 * book, shelf QR labels and CSV export → the public page in German without login → spreadsheet import → FIRINGI's
 * data-quality page and settings → phone width, dark mode → no page errors. Cleans up after itself.
 *   node tests/e2e/food-info.mjs [baseUrl] [screenshotDir]
 */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
const { chromium } = createRequire(import.meta.url)("playwright");

const BASE = process.argv[2] ?? "http://localhost:3000";
const SHOTS = process.argv[3] ?? null;
const PASSWORD = process.env.SEED_PASSWORD ?? "Firingi!2026";
const DB = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/firingi";
let failures = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "✔" : "✘"} ${name}${extra ? ` — ${extra}` : ""}`); if (!ok) failures++; };
const shot = async (page, name, full = false) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: full });
const browser = await chromium.launch();
const settle = async (p) => { await p.waitForLoadState("networkidle").catch(() => {}); await p.waitForTimeout(400); };
const go = async (p, url) => { await p.goto(`${BASE}${url}`); await settle(p); };
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn().catch(() => false)) return true; await new Promise((r) => setTimeout(r, 400)); } return false; };
const sql = (q) => execFileSync("psql", ["-At", DB, "-c", q], { encoding: "utf8" }).trim();
const errors = [];
const PHONE = { width: 390, height: 844 };
async function login(email, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, locale: "pt-PT", reducedMotion: "reduce", deviceScaleFactor: SHOTS ? 2 : 1, serviceWorkers: "block", ...opts });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${email} @ ${page.url()}: ${e.message.slice(0, 140)}`));
  page.on("dialog", (d) => d.accept());
  await go(page, "/login");
  await page.fill("#email", email); await page.fill("#password", PASSWORD); await page.click("button[type=submit]");
  await page.waitForURL((u) => u.pathname !== "/login", { timeout: 15000 }).catch(() => {});
  await settle(page);
  return page;
}
const noSideways = async (p, label) => {
  const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(`phone width: no sideways scrolling (${label})`, over <= 1, `${over}px`);
};
// a real 1×1 PNG (the upload checks the file's signature)
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

const LX = sql(`select c.id from "Company" c join "Membership" m on m."companyId"=c.id join "User" u on u.id=m."userId" where u.email='owner@lisboacentral.test' limit 1`);
const KB = sql(`select c.id from "Company" c join "Membership" m on m."companyId"=c.id join "User" u on u.id=m."userId" where u.email='owner@kebabhouse.test' limit 1`);
const offerOf = (sku) => sql(`select id from "VendorOffer" where "vendorCompanyId"='${LX}' and "vendorSku"='${sku}' and status='ACTIVE' order by "createdAt" limit 1`);
const productOf = (offer) => sql(`select v."productId" from "VendorOffer" o join "PackagingUnit" pu on pu.id=o."packagingUnitId" join "ProductVariant" v on v.id=pu."variantId" where o.id='${offer}'`);
const CONE = offerOf("GRO-KEBAB10"), RICE = offerOf("GRO-ARROZ1"), CAKE = offerOf("GRO-RUMCAKE");
const coneP = productOf(CONE), cakeP = productOf(CAKE);
const placed = [];
const cleanup = () => {
  sql(`delete from "Setting" where key='food.settings'`);
  sql(`delete from "FoodProfile" where "companyId"='${KB}'`);
  sql(`delete from "FoodChange" where "productId" in ('${coneP}','${cakeP}')`);
  sql(`update "Product" set "foodInfoId"=null, "allergensContain"='{}', "allergensMayContain"='{}', "allergensFree"='{}', diets='{}', "foodBlockedAt"=null, "foodBlockReason"=null where id in ('${coneP}','${cakeP}')`);
  sql(`delete from "FoodInfo" where "productId" in ('${coneP}','${cakeP}')`);
};
cleanup();
sql(`insert into "Setting" (id, scope, "scopeId", key, value, "updatedAt") values ('e2e_food', 'GLOBAL', '', 'food.settings', '{"profile": true}', now())`);

const admin = await login("superadmin@firingi.test", { locale: "en-GB" });
const vendor = await login("owner@lisboacentral.test");
const buyer = await login("owner@kebabhouse.test");

// ── 1. Supplier: list → editor → label photo → AI draft → corrections → send ──
await go(vendor, "/vendor/products/food");
const row = vendor.locator(`[data-testid=food-row][data-product="${coneP}"]`);
check("supplier: kebab cone listed, nothing filled in yet", (await row.count()) === 1 && (await row.getAttribute("data-score")) === "0");
await shot(vendor, "fi-01-supplier-list", true);
await go(vendor, `/vendor/products/food/${coneP}`);
const up = vendor.getByTestId("food-upload-label");
await up.getByTestId("food-file-label").setInputFiles({ name: "rotulo.png", mimeType: "image/png", buffer: PNG });
await up.getByRole("button", { name: /Carregar/ }).click();
check("label photo uploaded (a draft is started)", await until(async () => sql(`select ("labelKey" is not null)::text from "FoodInfo" where "productId"='${coneP}' and status='DRAFT'`) === "true"));
await go(vendor, `/vendor/products/food/${coneP}`);
await vendor.getByTestId("food-ai").click();
check("AI filled in the draft (simulated reading)", await until(async () => sql(`select source||'|'||(allergens->>'GLUTEN') from "FoodInfo" where "productId"='${coneP}' and status='DRAFT'`) === "AI|CONTAINS"));
await go(vendor, `/vendor/products/food/${coneP}`);
check("AI remarks shown to the supplier", (await vendor.getByTestId("food-ai-remark").count()) === 1);
await vendor.getByTestId("al-MILK-CONTAINS").click();
check("live check: vegan + milk is flagged", /vegano|vegan/i.test((await vendor.getByTestId("food-issues").textContent().catch(() => "")) ?? ""));
await vendor.getByTestId("food-diet-VEGAN").uncheck();
await vendor.evaluate(() => window.scrollTo(0, 0));
await shot(vendor, "fi-02-supplier-editor", true);
await vendor.getByTestId("food-submit").click();
check("sent to FIRINGI", await until(async () => sql(`select status from "FoodInfo" where "productId"='${coneP}' order by version desc limit 1`) === "PENDING"));
check("FIRINGI told", await until(async () => Number(sql(`select count(*) from "NotificationMessage" where "eventKey"='food.review'`)) > 0));

// ── 2. FIRINGI approves ──
await go(admin, "/admin/catalogue/food-review");
const q = admin.locator(`[data-testid=food-queue-row][data-product="${coneP}"]`);
check("FIRINGI queue: the kebab cone, first version", (await q.count()) === 1 && /First version/.test((await q.textContent()) ?? ""));
await q.locator("a").first().click();
await settle(admin);
check("review page shows the label photo", (await admin.getByTestId("food-review-label").count()) === 1);
await shot(admin, "fi-03-admin-review", true);
await admin.getByTestId("food-approve").click();
check("approved — the product carries it", await until(async () => sql(`select ("foodInfoId" is not null)::text||'|'||array_to_string("allergensContain", ',') from "Product" where id='${coneP}'`) === "true|GLUTEN,MILK"));

// ── 3. Customer: product page, filter ──
await go(buyer, `/buy/catalogue/offers/${CONE}#food`);
const panel = buyer.getByTestId("product-food");
check("product page: allergens (gluten contains)", (await panel.locator("[data-allergen=GLUTEN][data-level=CONTAINS]").count()) === 1);
check("ingredients with the allergen in bold", (await panel.getByTestId("food-ingredients").locator("b", { hasText: "trigo" }).count()) === 1);
check("nutrition table", (await panel.getByTestId("food-nutrition").count()) === 1);
await panel.scrollIntoViewIfNeeded();
await shot(buyer, "fi-04-customer-product");
await go(buyer, `/buy/catalogue/suppliers/${LX}?free=GLUTEN`);
check("filter 'free from gluten': the kebab cone is gone", (await buyer.locator(`a[href="/buy/catalogue/offers/${CONE}"]`).count()) === 0);
check("filter 'free from gluten': the rice is there", (await buyer.locator(`a[href="/buy/catalogue/offers/${RICE}"]`).count()) >= 1);
await buyer.getByTestId("food-filter").scrollIntoViewIfNeeded();
await shot(buyer, "fi-05-customer-filter");

// ── 4. Customer: kitchen profile → warnings; order ──
await go(buyer, "/buy/catalogue/allergens");
const prof = buyer.getByTestId("food-profile");
await prof.getByTestId("avoid-MILK").check();
await prof.getByTestId("avoid-SESAME").check();
await prof.getByTestId("avoid-save").click();
check("profile saved (milk, sesame)", await until(async () => sql(`select array_to_string(avoid, ',') from "FoodProfile" where "companyId"='${KB}'`) === "MILK,SESAME"));
await go(buyer, `/buy/catalogue/offers/${CONE}#food`);
check("product page: on your avoid list", (await buyer.getByTestId("product-food").getByTestId("food-hit").count()) === 1);
await go(buyer, "/buy/orders/cart");
const clear = buyer.getByRole("button", { name: /Esvaziar carrinho/ });
if (await clear.count()) { await clear.click(); await settle(buyer); }
await go(buyer, `/buy/catalogue/offers/${CONE}`);
await buyer.locator('main input[type="number"]').first().fill("2");
await buyer.getByRole("button", { name: /Adicionar ao carrinho/ }).click();
await settle(buyer);
await go(buyer, "/buy/orders/cart");
check("cart: allergen warning", /leite/i.test((await buyer.getByTestId("cart-food-warn").textContent().catch(() => "")) ?? ""));
await shot(buyer, "fi-06-customer-cart");
await buyer.getByRole("button", { name: /Fazer encomenda/ }).click();
await buyer.waitForURL("**placed=1", { timeout: 20000 }).catch(() => {});
await settle(buyer);
const orderId = buyer.url().includes("placed=1") ? buyer.url().split("/").pop().split("?")[0] : null;
if (orderId) placed.push(orderId);
check("order placed", !!orderId);

// ── 5. Recipe change → FIRINGI → customer told ──
await go(vendor, `/vendor/products/food/${coneP}`);
await vendor.getByTestId("al-SESAME-MAY_CONTAIN").click();
await vendor.getByTestId("food-submit").click();
check("new version sent", await until(async () => sql(`select status from "FoodInfo" where "productId"='${coneP}' order by version desc limit 1`) === "PENDING"));
await go(admin, "/admin/catalogue/food-review");
const q2 = admin.locator(`[data-testid=food-queue-row][data-product="${coneP}"]`);
check("FIRINGI queue: new allergen flagged", (await q2.getByTestId("food-queue-allergen").count()) === 1);
await q2.locator("a").first().click();
await settle(admin);
check("review: side by side, new allergen", (await admin.getByTestId("food-review-allergen-added").count()) === 1);
await admin.getByTestId("food-approve").click();
check("change recorded, customer told", await until(async () => Number(sql(`select coalesce(max("notifiedCompanies"),0) from "FoodChange" where "productId"='${coneP}'`)) >= 1));
await go(buyer, "/buy/catalogue/allergens");
check("customer: recipe change, urgent (sesame avoided)", (await buyer.locator("[data-testid=food-change][data-urgent='1']").count()) >= 1);
check("customer: products × allergens table", (await buyer.locator(`[data-testid=food-matrix-row][data-product="${coneP}"]`).count()) === 1);
await shot(buyer, "fi-07-customer-allergens", true);

// ── 6. Reseller outputs ──
const book = await buyer.request.get(`${BASE}/api/food/book`);
check("allergen book PDF", book.status() === 200 && /pdf/.test(book.headers()["content-type"] ?? ""), String(book.status()));
const labels = await buyer.request.get(`${BASE}/api/food/labels`);
check("shelf labels PDF (QR)", labels.status() === 200 && /pdf/.test(labels.headers()["content-type"] ?? ""), String(labels.status()));
const csv = await buyer.request.get(`${BASE}/api/food/export`);
const csvText = await csv.text();
check("export CSV has the kebab cone with its allergens", csv.status() === 200 && /allergen_gluten/.test(csvText) && /contains/.test(csvText));
const anon = await browser.newContext({ viewport: PHONE, locale: "de-DE", colorScheme: "dark" });
const pub = await anon.newPage();
pub.on("pageerror", (e) => errors.push(`public: ${e.message.slice(0, 140)}`));
await pub.goto(`${BASE}/food/${coneP}?lang=de`); await settle(pub);
check("public page without login, in German", (await pub.getByTestId("public-food").count()) === 1 && /Enthält/.test((await pub.textContent("body")) ?? ""));
check("public page: no prices", !/€/.test(await pub.innerText("body")));
await noSideways(pub, "/food/:id");
await shot(pub, "fi-08-public-page", true);
const none = await pub.goto(`${BASE}/food/${cakeP}`);
check("public page: nothing for a product without approved data", none?.status() === 404);

// ── 7. Spreadsheet import (supplier) ──
await go(vendor, "/vendor/products/food/import");
const sheet = ["sku;gluten;crustaceans;eggs;fish;peanuts;soy;milk;nuts;celery;mustard;sesame;sulphites;lupin;molluscs;ingredients_pt;basis;energy_kj;energy_kcal;fat;saturates;carbohydrate;sugars;protein;salt;storage_pt",
  "GRO-RUMCAKE;contém;não;sim;não;não;não;sim;pode conter;não;não;não;sim;não;não;Farinha de *trigo*, *ovos*, manteiga (*leite*), rum (*sulfitos*);100g;1674;400;18;10;52;30;6;0,4;Local seco",
  "NOPE-1;contém;;;;;;;;;;;;;;x;;;;;;;;;;"].join("\n");
await vendor.getByTestId("food-import-file").setInputFiles({ name: "alimentos.csv", mimeType: "text/csv", buffer: Buffer.from(sheet, "utf8") });
await vendor.getByTestId("food-import-check").click();
check("import preview: one complete, one not found", await until(async () => (await vendor.locator("[data-testid=food-import-row][data-status=OK]").count()) === 1 && (await vendor.locator("[data-testid=food-import-row][data-status=NOT_FOUND]").count()) === 1));
await shot(vendor, "fi-09-supplier-import", true);
await vendor.getByTestId("food-import-apply").click();
check("imported and sent to FIRINGI", await until(async () => sql(`select source||'|'||status from "FoodInfo" where "productId"='${cakeP}' order by version desc limit 1`) === "IMPORT|PENDING"));

// ── 8. FIRINGI: quality, settings ──
await go(admin, "/admin/catalogue/food-quality");
check("data quality: tiles and requirements", (await admin.getByTestId("food-quality-tiles").count()) === 1 && (await admin.getByTestId("food-req").count()) > 10);
check("data quality: 'would be hidden' warning while required-to-sell is off", (await admin.getByTestId("food-would-block").count()) === 1);
await shot(admin, "fi-10-admin-quality", true);
await go(admin, "/admin/settings/food");
await admin.getByTestId("fs-alerts").uncheck();
await admin.getByTestId("fs-save").click();
check("settings saved (alerts off, profile kept on)", await until(async () => { const v = JSON.parse(sql(`select value from "Setting" where key='food.settings'`) || "{}"); return v.changeAlerts === false && v.profile === true; }));
await shot(admin, "fi-11-admin-settings", true);

// ── 9. Phone width, dark mode ──
const phone = await login("owner@kebabhouse.test", { viewport: PHONE, colorScheme: "dark" });
for (const url of ["/buy/catalogue/allergens", `/buy/catalogue/offers/${CONE}`]) { await go(phone, url); await noSideways(phone, url.replace(CONE, ":id")); }
await go(phone, `/buy/catalogue/offers/${CONE}#food`);
await phone.getByTestId("product-food").scrollIntoViewIfNeeded().catch(() => {});
await shot(phone, "fi-12-phone-dark");
const vphone = await login("owner@lisboacentral.test", { viewport: PHONE });
for (const url of ["/vendor/products/food", `/vendor/products/food/${coneP}`, "/vendor/products/food/import"]) { await go(vphone, url); await noSideways(vphone, url.replace(coneP, ":id")); }

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
for (const id of placed) sql(`update "Order" set status='CANCELLED' where id='${id}' and status in ('NEW','PENDING_CONFIRMATION','ON_HOLD')`);
cleanup();
await browser.close();
if (failures) { console.log(`\n${failures} check(s) failed`); process.exit(1); }
console.log("\nall checks passed");
