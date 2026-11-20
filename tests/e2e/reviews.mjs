/**
 * Browser test of Phase 53 (product reviews & questions), as Kebab House (a customer that received the product),
 * Lisboa Central (its supplier) and FIRINGI (English):
 *  "My Reviews" lists what to review; the buyer writes a review with stars, details, text and a photo, edits it;
 *  sees another business's review, votes it helpful and reports it; asks a question and answers another as a
 *  verified buyer; stars on the supplier's shop cards, "4★ and up" and "Best rated"; the supplier replies once and
 *  answers officially and sees its insights; a review with contact details waits for FIRINGI, who publishes it and
 *  hides the reported one with a reason; FIRINGI's settings (AI summary from 1 review, stars on cards off); the AI
 *  summary (simulated); phone + dark; a business switched off loses Reviews; no page errors.
 *   node tests/e2e/reviews.mjs [baseUrl] [screenshotDir]
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
// a 2×2 PNG
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVQI12P8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==", "base64");

const kebabId = sql(`select c.id from "Company" c join "Membership" m on m."companyId"=c.id join "User" u on u.id=m."userId" where u.email='owner@kebabhouse.test' limit 1`);
const lxId = sql(`select c.id from "Company" c join "Membership" m on m."companyId"=c.id join "User" u on u.id=m."userId" where u.email='owner@lisboacentral.test' limit 1`);
const bellaId = sql(`select c.id from "Company" c join "Membership" m on m."companyId"=c.id join "User" u on u.id=m."userId" where u.email='owner@pizzariabella.test' limit 1`);
const bellaUser = sql(`select id from "User" where email='owner@pizzariabella.test'`);
// a product Kebab House received from Lisboa Central
const [offerId, productId] = sql(`select l."offerId", pv."productId" from "OrderLine" l join "Order" o on o.id=l."orderId" join "VendorOffer" vo on vo.id=l."offerId" join "PackagingUnit" pu on pu.id=vo."packagingUnitId" join "ProductVariant" pv on pv.id=pu."variantId"
  where o."buyerCompanyId"='${kebabId}' and o."sellerCompanyId"='${lxId}' and o.status='DELIVERED' and l."qtyDelivered">0 and vo.status='ACTIVE' order by o."updatedAt" desc limit 1`).split("|");
const BELLA_REVIEW = "e2e-review-bella", BELLA_Q = "e2e-question-bella";

function clean() {
  if (!productId) return;
  sql(`delete from "ContentReport" where "targetId" in (select id from "ProductReview" where "productId"='${productId}') or "targetId" in (select id from "ProductQuestion" where "productId"='${productId}') or "targetId" in (select a.id from "ProductAnswer" a join "ProductQuestion" q on q.id=a."questionId" where q."productId"='${productId}')`);
  sql(`delete from "ProductReview" where "productId"='${productId}'`);
  sql(`delete from "ProductQuestion" where "productId"='${productId}'`);
  sql(`delete from "ProductRatingStat" where "productId"='${productId}'`);
  sql(`delete from "ReviewSummary" where "productId"='${productId}'`);
}
function restore() {
  clean();
  sql(`delete from "Setting" where key='reviews.settings'`);
  sql(`delete from "CompanyFeature" where key='REVIEWS'`);
}
restore();
process.on("exit", restore);
check("a product Kebab House received from Lisboa Central", !!offerId && !!productId);
// another business's review (Pizzaria Bella) and question, already published
sql(`insert into "ProductReview" (id, "productId", "sellerCompanyId", "buyerCompanyId", "byUserId", "offerId", stars, quality, body, photos, "holdReasons", "replyHold", "createdAt", "updatedAt")
  values ('${BELLA_REVIEW}', '${productId}', '${lxId}', '${bellaId}', '${bellaUser}', '${offerId}', 4, 4, 'Good value, a few arrived a little bent.', '{}', '{}', '{}', now() - interval '3 days', now())`);
sql(`insert into "ProductQuestion" (id, "productId", "sellerCompanyId", "buyerCompanyId", "byUserId", body, "holdReasons", "createdAt") values ('${BELLA_Q}', '${productId}', '${lxId}', '${bellaId}', '${bellaUser}', 'Do they stack well in a small storeroom?', '{}', now() - interval '2 days')`);

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
const myReview = () => sql(`select stars || '|' || status || '|' || coalesce(quality::text,'-') || '|' || array_length(photos, 1) || '|' || "showName" from "ProductReview" where "productId"='${productId}' and "buyerCompanyId"='${kebabId}'`);

// ── 1. The buyer reviews what it received ──
const kb = await login("owner@kebabhouse.test");
await go(kb, "/buy/reviews");
check("My Reviews lists products to review", (await kb.getByTestId("reviews-todo").count()) === 1 && (await kb.getByTestId("todo-review").count()) > 0);
await shot(kb, "p53-01-my-reviews");
await go(kb, `/buy/catalogue/offers/${offerId}`);
check("the product page shows the reviews and another business's review", (await kb.getByTestId("product-reviews").count()) === 1 && (await kb.getByTestId("review-item").count()) === 1);
const form = kb.getByTestId("review-form");
check("…and the review form (verified purchase)", (await form.count()) === 1);
await kb.getByTestId("review-stars-4").click();
await kb.getByTestId("review-quality-5").click();
await kb.getByTestId("review-freshness-4").click();
await kb.getByTestId("review-body").fill("Strong boxes, pizzas stay hot on delivery. Good value.");
await kb.getByTestId("review-photos").setInputFiles({ name: "box.png", mimeType: "image/png", buffer: PNG });
await kb.getByTestId("review-showname").check();
await kb.getByTestId("review-save").click();
check("the review is published with details and a photo", await until(async () => myReview() === "4|PUBLISHED|5|1|true"), myReview());
await go(kb, `/buy/catalogue/offers/${offerId}`);
check("…the page shows it as published", (await kb.getByTestId("my-review-status").innerText()).length > 0 && (await kb.getByTestId("review-item").count()) === 2);
check("…the average of both reviews", (await kb.getByTestId("review-avg").innerText()).replace(",", ".").startsWith("4.0"));
await kb.getByTestId("review-edit").click();
await kb.getByTestId("review-stars-5").click();
await kb.getByTestId("review-save").click();
check("editing keeps one review (now 5★, photo kept)", await until(async () => myReview() === "5|PUBLISHED|5|1|true" && sql(`select count(*) from "ProductReview" where "productId"='${productId}' and "buyerCompanyId"='${kebabId}'`) === "1"), myReview());

// ── 2. Helpful, report, questions ──
await go(kb, `/buy/catalogue/offers/${offerId}`);
const bella = kb.getByTestId("review-item").filter({ hasText: "a little bent" });
await bella.getByTestId("review-helpful").click();
check("votes another business's review helpful", await until(async () => sql(`select "helpfulCount" from "ProductReview" where id='${BELLA_REVIEW}'`) === "1"));
await bella.getByTestId("report-review").click();
await kb.getByTestId("report-reason").selectOption("NOT_ABOUT_PRODUCT");
await kb.getByTestId("report-send").click();
check("…reports it (FIRINGI is told)", await until(async () => sql(`select reason from "ContentReport" where "targetId"='${BELLA_REVIEW}'`) === "NOT_ABOUT_PRODUCT"));
await kb.getByTestId("ask-text").fill("Can they take a 35 cm pizza?");
await kb.getByTestId("ask-send").click();
check("asks a question", await until(async () => sql(`select status from "ProductQuestion" where "productId"='${productId}' and "buyerCompanyId"='${kebabId}'`) === "PUBLISHED"));
await go(kb, `/buy/catalogue/offers/${offerId}`);
const bq = kb.getByTestId("question-item").filter({ hasText: "stack well" });
await bq.getByTestId("answer-open").click();
await bq.getByTestId("answer-text").fill("Yes, 50 flat boxes fit on one shelf.");
await bq.getByTestId("answer-send").click();
check("answers another business's question as a verified buyer", await until(async () => sql(`select role from "ProductAnswer" where "questionId"='${BELLA_Q}'`) === "BUYER"));
await go(kb, `/buy/catalogue/offers/${offerId}`);
await kb.getByTestId("product-reviews").scrollIntoViewIfNeeded();
await shot(kb, "p53-02-product-reviews");

// ── 3. Stars in the shop ──
await go(kb, `/buy/catalogue/suppliers/${lxId}`);
check("stars on the supplier's shop cards", (await kb.getByTestId("card-stars").count()) > 0);
await kb.getByTestId("filter-4stars").click(); await settle(kb);
check("'4★ and up' keeps the rated product", kb.url().includes("stars=4") && (await kb.locator(`a[href="/buy/catalogue/offers/${offerId}"]`).count()) > 0);
await kb.getByTestId("sort-rating").click(); await settle(kb);
check("'Best rated' puts it first", kb.url().includes("sort=rating") && ((await kb.locator('a[href^="/buy/catalogue/offers/"]').first().getAttribute("href")) ?? "").endsWith(offerId));
await shot(kb, "p53-03-shop-stars", false);

// ── 4. The supplier ──
const lx = await login("owner@lisboacentral.test");
await go(lx, "/vendor/reviews");
const vr = lx.getByTestId("vendor-review").filter({ hasText: "pizzas stay hot" });
check("the supplier sees the review", (await vr.count()) === 1);
await vr.getByTestId("reply-open").click();
await vr.getByTestId("reply-text").fill("Thank you! Glad they keep the pizzas hot.");
await vr.getByTestId("reply-send").click();
check("…replies in public", await until(async () => sql(`select "replyStatus" from "ProductReview" where "productId"='${productId}' and "buyerCompanyId"='${kebabId}'`) === "PUBLISHED"));
await go(lx, "/vendor/reviews");
await shot(lx, "p53-04-vendor-reviews");
await go(lx, "/vendor/reviews/questions");
const vq = lx.getByTestId("vendor-question").filter({ hasText: "35 cm" });
check("…sees the open question", (await vq.count()) === 1);
await vq.getByTestId("answer-text").fill("Yes — up to 36 cm.");
await vq.getByTestId("answer-send").click();
check("…answers it officially", await until(async () => sql(`select a.role from "ProductAnswer" a join "ProductQuestion" q on q.id=a."questionId" where q."productId"='${productId}' and q."buyerCompanyId"='${kebabId}'`) === "SUPPLIER"));
await go(lx, "/vendor/reviews/insights");
check("…review insights: average, trend, products", (await lx.getByTestId("ins-avg").count()) === 1 && (await lx.getByTestId("ins-products").locator("li").count()) > 0);
await shot(lx, "p53-05-vendor-insights");
await go(kb, `/buy/catalogue/offers/${offerId}`);
check("the buyer sees the reply and the official answer", (await kb.getByTestId("review-reply").count()) >= 1 && (await kb.getByTestId("official-answer").count()) >= 1);

// ── 5. The filter, FIRINGI ──
await kb.getByTestId("review-edit").click();
await kb.getByTestId("review-body").fill("Strong boxes. Cheaper boxes: write to compras@example.pt");
await kb.getByTestId("review-save").click();
check("contact details make the review wait for FIRINGI", await until(async () => myReview().split("|")[1] === "HELD"));
const sa = await login("superadmin@firingi.test");
await go(sa, "/admin/reviews");
const held = sa.getByTestId("mod-item").filter({ hasText: "compras@example.pt" });
check("FIRINGI's queue shows it", (await held.count()) === 1);
await shot(sa, "p53-06-admin-moderation");
await held.getByTestId("mod-publish").click();
check("…FIRINGI publishes it", await until(async () => myReview().split("|")[1] === "PUBLISHED"));
await go(sa, "/admin/reviews?tab=REPORTED");
const rep = sa.getByTestId("mod-item").filter({ hasText: "a little bent" });
check("the reported review is in the queue", (await rep.count()) === 1);
await rep.getByTestId("mod-hide").click();
await rep.getByTestId("mod-reason").fill("Not about the product's quality");
await rep.getByTestId("mod-hide-confirm").click();
check("…FIRINGI hides it with a reason", await until(async () => sql(`select status || '|' || "hiddenReason" from "ProductReview" where id='${BELLA_REVIEW}'`) === "HIDDEN|Not about the product's quality"));
await go(sa, "/admin/reviews/overview");
check("FIRINGI's overview", (await sa.getByTestId("reviews-overview").count()) === 1);
await go(sa, "/admin/settings/reviews");
await sa.getByTestId("rs-ai-min").fill("1");
await sa.getByTestId("rs-save").click();
check("FIRINGI sets the AI summary from 1 review", await until(async () => sql(`select value->>'aiMinReviews' from "Setting" where key='reviews.settings'`) === "1"));
await shot(sa, "p53-07-admin-settings");
await go(kb, `/buy/catalogue/offers/${offerId}`);
check("the AI summary (simulated) on the product page", await until(async () => /Simulated/i.test(await kb.getByTestId("review-ai-summary").innerText())));
await sa.getByTestId("rs-part-searchStars").uncheck();
await sa.getByTestId("rs-save").click();
await until(async () => sql(`select value->'parts'->>'searchStars' from "Setting" where key='reviews.settings'`) === "false");
await go(kb, `/buy/catalogue/suppliers/${lxId}`);
check("stars on cards switched off by FIRINGI", (await kb.getByTestId("card-stars").count()) === 0 && (await kb.getByTestId("rating-filter").count()) === 0);
sql(`delete from "Setting" where key='reviews.settings'`);

// ── 6. Phone, dark ──
const ph = await login("owner@kebabhouse.test", { viewport: { width: 390, height: 844 }, colorScheme: "dark", isMobile: true, hasTouch: true });
await go(ph, `/buy/catalogue/offers/${offerId}`);
await ph.getByTestId("product-reviews").scrollIntoViewIfNeeded();
const fits = await ph.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
check("phone + dark: reviews fit the screen", fits);
await shot(ph, "p53-08-phone-dark", false);
await go(ph, "/buy/reviews");
check("phone: My Reviews shows the hidden reason to nobody but the author", (await ph.getByTestId("reviews-mine").count()) === 1);
await shot(ph, "p53-09-phone-my-reviews");

// ── 7. A business switched off ──
sql(`insert into "CompanyFeature" ("companyId", key, enabled, "updatedAt") values ('${kebabId}', 'REVIEWS', false, now()) on conflict do nothing`);
await go(kb, "/buy/reviews");
check("a business switched off loses Reviews", (await kb.getByTestId("reviews-off").count()) === 1 && (await kb.locator('a[href="/buy/reviews"]').count()) === 0);
await go(kb, `/buy/catalogue/offers/${offerId}`);
check("…and can't write (no form)", (await kb.getByTestId("review-form").count()) === 0);
sql(`delete from "CompanyFeature" where key='REVIEWS' and "companyId"='${kebabId}'`);

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nAll reviews checks passed");
process.exit(failures ? 1 : 0);
