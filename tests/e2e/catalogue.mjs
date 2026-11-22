/**
 * Browser + HTTP test of Phase 3 against a running server (seeded demo data):
 * buyer visibility (UI and JSON API), vendor pricing / proposals, admin approval.
 *   node tests/e2e/catalogue.mjs [baseUrl] [screenshotDir]
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
const settle = async (p) => { await p.waitForLoadState("networkidle"); await p.waitForFunction(() => !document.querySelector("[aria-busy=true]"), null, { timeout: 15000 }).catch(() => {}); await p.waitForTimeout(500); };
async function login(email) {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 950 } })).newPage();
  await page.goto(`${BASE}/login`); await page.waitForLoadState("networkidle"); await page.waitForTimeout(400);
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await settle(page);
  return page;
}

// ── 1. Customer: shop home → category → nearest wholesaler's store ──
const customer = await login("owner@kebabhouse.test");
await customer.goto(`${BASE}/buy/catalogue/browse`); await customer.waitForLoadState("networkidle"); await customer.waitForFunction(() => !document.querySelector("[aria-busy=true]"), null, { timeout: 15000 }).catch(() => {}); await customer.waitForTimeout(400);
await settle(customer);
await shot(customer, "p3-01-customer-shop");
const home = await customer.textContent("main");
check("shop home shows categories and the nearest wholesaler", /Mercearia|Groceries/.test(home) && home.includes("Lisboa Central") && /km/.test(home));
check("customer never sees distributors", !/Atlântico|Ibéricas/.test(home));
check("no tobacco / alcohol categories without licence", !/Tabaco|Tobacco/.test(home));
await customer.getByRole("link", { name: /Produtos para Kebab e Pizza|Kebab & Pizza Supplies/ }).click();
await settle(customer);
check("category page lists wholesalers carrying it", (await customer.textContent("main")).includes("Lisboa Central"));
await customer.getByRole("link", { name: /Lisboa Central/ }).first().click();
await settle(customer);
await shot(customer, "p3-01b-customer-store");
// the products only (Phase 61: the store's offers panel above may name other products)
const text = await customer.evaluate(() => { const m = document.querySelector("main").cloneNode(true); m.querySelector("[data-testid=shop-store-panel]")?.remove(); return m.textContent; });
check("store opens filtered on that category", /Cone de kebab|Chicken kebab/.test(text) && !/Coca-Cola/.test(text));
await customer.getByRole("link", { name: /Todos os produtos|All products/ }).click();
await settle(customer);
// The store pages its products (earlier runs add more): look the two up by search within the store.
const all = await customer.textContent("main");
const storeUrl = customer.url().split("?")[0];
const inStore = async (q) => { await customer.goto(`${storeUrl}?q=${encodeURIComponent(q)}`); await settle(customer); return (await customer.textContent("main")).includes(q); };
check("store shows all the wholesaler's products", (await inStore("Coca-Cola")) && (await inStore("Mozzarella")));
check("no restricted products in the store", !/Cigarros|Cigarettes|Cerveja|Lager|Vinho|Douro|Bolo de rum|Rum cake/.test(all));
check("contract / group price badge shown", /Preço de contrato|Contract price|Preço de grupo|Group price/.test(all));

const api = await customer.request.get(`${BASE}/api/catalogue/offers`);
const json = await api.json();
const vendors = [...new Set(json.items.map((i) => i.vendor.name))];
check("JSON API: only wholesalers, never distributors", api.status() === 200 && vendors.includes("Lisboa Central") && !vendors.some((v) => /Atlântico|Ibéricas/.test(v)), vendors.join());
check("JSON API: no restricted products", json.items.every((i) => !i.restriction));

await customer.locator('a[href^="/buy/catalogue/offers/"]').first().click();
await settle(customer);
const pp = await customer.textContent("main");
check("product page shows price incl. and excl. IVA", /c\/ IVA/.test(pp) && /s\/ IVA/.test(pp) && /IVA \d+%/.test(pp));
check("product page shows SKU and barcode", /SKU FIR-/.test(pp) && /▮▯▮ \d{8,14}/.test(pp));

// Barcode search from the shop home (typed or scanned with a USB scanner)
await customer.goto(`${BASE}/buy/catalogue/browse`); await customer.waitForLoadState("networkidle"); await customer.waitForFunction(() => !document.querySelector("[aria-busy=true]"), null, { timeout: 15000 }).catch(() => {}); await customer.waitForTimeout(400);
await settle(customer);
await customer.fill('input[name="q"]', "5449000000996");
await customer.keyboard.press("Enter");
await settle(customer);
const found = await customer.textContent("main");
check("barcode search finds the product at the nearest wholesaler", customer.url().includes("/buy/catalogue/search") && /Coca-Cola/.test(found) && found.includes("Lisboa Central"));
await shot(customer, "p3-08-barcode-search");
await shot(customer, "p3-02-customer-product", true);

// Discover a distributor offer id as a wholesaler, then try it as the customer.
const wholesaler = await login("purchasing@lisboacentral.test");
const wApi = await (await wholesaler.request.get(`${BASE}/api/catalogue/offers`)).json();
const wVendors = [...new Set(wApi.items.map((i) => i.vendor.name))].sort();
check("wholesaler sees distributors (PT + ES)", wVendors.join() === "Atlântico,Ibéricas", wVendors.join());
const distOfferId = wApi.items[0].offerId;
check("customer gets 404 for a distributor offer via API", (await customer.request.get(`${BASE}/api/catalogue/offers/${distOfferId}`)).status() === 404);
await customer.goto(`${BASE}/buy/catalogue/offers/${distOfferId}`); await customer.waitForLoadState("networkidle"); await customer.waitForFunction(() => !document.querySelector("[aria-busy=true]"), null, { timeout: 15000 }).catch(() => {}); await customer.waitForTimeout(400);
check("customer gets 404 page for a distributor offer URL", /404|could not be found|não/i.test(await customer.textContent("body")));
await wholesaler.goto(`${BASE}/buy/catalogue/browse`); await wholesaler.waitForLoadState("networkidle"); await wholesaler.waitForTimeout(400);
await settle(wholesaler);
const wHome = await wholesaler.textContent("main");
check("wholesaler shop home: nearest distributor first", wHome.indexOf("Atlântico") > -1 && wHome.indexOf("Atlântico") < wHome.indexOf("Ibéricas"));
await shot(wholesaler, "p3-03-wholesaler-buying");
const distId = wApi.items.find((i) => i.vendor.name === "Atlântico").vendor.id;
await customer.goto(`${BASE}/buy/catalogue/suppliers/${distId}`); await customer.waitForLoadState("networkidle"); await customer.waitForFunction(() => !document.querySelector("[aria-busy=true]"), null, { timeout: 15000 }).catch(() => {}); await customer.waitForTimeout(400);
check("customer gets 404 for a distributor's store", /404|could not be found/i.test(await customer.textContent("body")));

// ── 2. Vendor ──
const vendor = await login("owner@lisboacentral.test");
await vendor.goto(`${BASE}/vendor/products/catalogue`); await vendor.waitForLoadState("networkidle"); await vendor.waitForTimeout(400);
await settle(vendor);
await shot(vendor, "p3-04-vendor-products", true);
const rowAzeite = vendor.locator("tr").filter({ hasText: /Azeite virgem extra 750ml/ }).filter({ hasText: /Garrafa|Bottle/ });
const newPrice = (6 + (Date.now() % 90) / 100 + 0.01).toFixed(2); // a fresh price each run
await rowAzeite.locator("input[type=number]").fill(newPrice);
await rowAzeite.getByRole("button", { name: /Guardar|Save/ }).click();
await settle(vendor);
let seen = false; // the save is a server action: give it a moment to land before asking the catalogue
for (let i = 0; i < 30 && !seen; i++) {
  const after = await (await customer.request.get(`${BASE}/api/catalogue/offers?q=azeite`)).json();
  seen = after.items.some((x) => x.packaging.unitsPerPack === 1 && x.price.listUnitNet === newPrice);
  if (!seen) await new Promise((r) => setTimeout(r, 500));
}
check("vendor base-price change is visible to the customer", seen, newPrice);

const productName = `Molho de alho ${Date.now()}`;
await vendor.getByRole("button", { name: /Propor um novo produto|Propose a new product/ }).click();
await vendor.fill("#nameEn", `Garlic sauce ${productName.slice(-6)}`);
await vendor.fill("#namePt", productName);
await vendor.locator("#categoryId").selectOption({ label: "— Molhos" });
await vendor.fill("#packName", "Caixa 6 × 1L");
await vendor.selectOption("#uomCode", "CX");
await vendor.fill("#unitsPerPack", "6");
await vendor.fill("#basePrice", "21.90");
await vendor.getByRole("button", { name: /Enviar para aprovação|Send for approval/ }).click();
await settle(vendor);
check("proposal sent (pending)", /A aguardar aprovação|Waiting for approval/.test(await vendor.textContent("main")));
check("pending product not visible to customer", !(await (await customer.request.get(`${BASE}/api/catalogue/offers?q=${encodeURIComponent(productName)}`)).json()).total);

// ── 3. Admin approves ──
const admin = await login("ops@firingi.test");
await admin.goto(`${BASE}/admin/catalogue/approval`); await admin.waitForLoadState("networkidle"); await admin.waitForTimeout(400);
await settle(admin);
await shot(admin, "p3-05-admin-approval");
await admin.locator("tr").filter({ hasText: productName }).getByRole("button", { name: "Approve" }).click();
await settle(admin);
const visible = await (await customer.request.get(`${BASE}/api/catalogue/offers?q=${encodeURIComponent(productName)}`)).json();
check("approved product now visible to customer at the vendor's price", visible.total === 1 && visible.items[0].price.unitPriceNet === "21.90");

await admin.goto(`${BASE}/admin/catalogue/categories`); await admin.waitForLoadState("networkidle"); await admin.waitForTimeout(400);
await settle(admin);
check("category tree lists restricted branches", /ALCOHOL/.test(await admin.textContent("main")) && /TOBACCO/.test(await admin.textContent("main")));
await shot(admin, "p3-06-admin-categories");
await admin.goto(`${BASE}/admin/catalogue/products`); await admin.waitForLoadState("networkidle"); await admin.waitForTimeout(400);
await settle(admin);
await admin.getByRole("link", { name: /Coca-Cola/ }).first().click();
await settle(admin);
await shot(admin, "p3-07-admin-product", true);
check("product editor shows variants and vendor offers", /FIR-COLA33/.test(await admin.textContent("main")) && /offer\(s\)/.test(await admin.textContent("main")));

// ── 4. Limited employee ──
const warehouse = await login("warehouse@lisboacentral.test");
await warehouse.goto(`${BASE}/vendor/products/price-lists`); await warehouse.waitForLoadState("networkidle"); await warehouse.waitForTimeout(400);
check("warehouse employee blocked from price lists", warehouse.url().endsWith("/forbidden"));
await warehouse.goto(`${BASE}/vendor/products/stock`); await warehouse.waitForLoadState("networkidle"); await warehouse.waitForTimeout(400);
await settle(warehouse);
check("warehouse employee can edit stock", (await warehouse.locator("tbody input[type=number]").count()) > 0);

await browser.close();
console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll catalogue e2e checks passed");
process.exit(failures ? 1 : 0);
