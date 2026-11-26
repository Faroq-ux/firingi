/**
 * Browser test: printing and refrigeration services.
 *   Print supplier (Atlântico, approved for "Printing") adds a leaflet product and a shelf-labels product; the customer
 *   (Kebab House, pt-PT) orders 150 leaflets with a PDF file; the supplier accepts, prints, delivers → FIRINGI invoices.
 *   The customer orders printed shelf labels from the shelf-labels page. Refrigeration: the customer asks for a repair,
 *   the technician records parts & labour; the customer sees them. FIRINGI (English) sees print orders. Phone; no errors.
 *   node tests/e2e/services-print.mjs [baseUrl] [screenshotDir]
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
const settle = async (p) => { await p.waitForLoadState("networkidle").catch(() => {}); await p.waitForTimeout(500); };
const go = async (p, url) => { const r = await p.goto(`${BASE}${url}`, { timeout: 240000 }); await settle(p); return r; };
const until = async (fn, ms = 60000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn().catch(() => false)) return true; await new Promise((r) => setTimeout(r, 400)); } return false; };
const sql = (q) => execFileSync("psql", ["-At", DB, "-c", q], { encoding: "utf8" }).trim();
const tap = async (p, sel) => { const l = typeof sel === "string" ? p.locator(sel).first() : sel; await l.evaluate((e) => e.scrollIntoView({ block: "center" })); await l.click(); };

const AT = sql(`select c.id from "Company" c join "Membership" m on m."companyId"=c.id join "User" u on u.id=m."userId" where u.email='owner@atlantico.test' limit 1`);
const KB = sql(`select id from "Company" where "tradeName"='Kebab House'`);
const typeId = (code) => sql(`select id from "ServiceType" where code='${code}'`);
const clean = () => {
  sql(`delete from "PrintJob" where "customerCompanyId"='${KB}'`);
  sql(`delete from "PrintProduct" where "providerId" in (select id from "ServiceProvider" where "companyId"='${AT}')`);
  sql(`delete from "ServiceVisit" where "customerCompanyId"='${KB}' and "serviceTypeId" in (select id from "ServiceType" where code='FRIDGE_SERVICE')`);
  sql(`delete from "ServicePlan" where "customerCompanyId"='${KB}' and "serviceTypeId" in (select id from "ServiceType" where code='FRIDGE_SERVICE')`);
  sql(`delete from "ShelfLabel" where "companyId"='${KB}'`);
};

const errors = [];
const browser = await chromium.launch();
async function login(email, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, locale: "pt-PT", reducedMotion: "reduce", deviceScaleFactor: SHOTS ? 2 : 1, serviceWorkers: "block", ...opts });
  const page = await ctx.newPage();
  page.setDefaultTimeout(240000);
  page.on("pageerror", (e) => errors.push(`${email}: ${e.message.slice(0, 160)}`));
  await go(page, "/login");
  await page.fill("#email", email); await page.fill("#password", PASSWORD); await page.click("button[type=submit]");
  await page.waitForURL((u) => u.pathname !== "/login", { timeout: 120000 }).catch(() => {});
  await settle(page);
  return page;
}

try {
  // the built-in services exist once the services pages ran; make Atlântico an approved print + refrigeration provider
  const a = await login("superadmin@firingi.test", { locale: "en-GB" });
  await go(a, "/admin/services?tab=CATALOGUE");
  check("built-in refrigeration + printing services", !!typeId("FRIDGE_SERVICE") && !!typeId("PRINTING"));
  clean();
  sql(`delete from "ServiceProvider" where "companyId"='${AT}' and "serviceTypeId" in ('${typeId("PRINTING")}', '${typeId("FRIDGE_SERVICE")}')`);
  // suppliers can't apply themselves (FIRINGI adds providers)
  const v0 = await login("owner@atlantico.test");
  await go(v0, "/vendor/services");
  check("supplier: no apply form", (await v0.locator("[data-testid=pv-apply]").count()) === 0);
  await v0.context().close();
  // FIRINGI adds Atlântico as provider of Printing and of Refrigeration (licence)
  await go(a, "/admin/services?tab=PROVIDERS");
  for (const [code, lic] of [["PRINTING", ""], ["FRIDGE_SERVICE", "F-GAS-E2E"]]) {
    await a.getByTestId("svp-add-type").selectOption(typeId(code));
    await a.getByTestId("svp-add-find").fill("Atl");
    await until(async () => (await a.getByTestId("svp-add-hit").count()) > 0, 20000);
    await tap(a, a.getByTestId("svp-add-hit").first());
    if (lic) await a.getByTestId("svp-add-licence").fill(lic);
    await tap(a, "[data-testid=svp-add-save]");
    check(`provider added by FIRINGI (${code})`, await until(async () => sql(`select status from "ServiceProvider" where "companyId"='${AT}' and "serviceTypeId"='${typeId(code)}'`) === "APPROVED"));
    await go(a, "/admin/services?tab=PROVIDERS");
  }
  await shot(a, "01-admin-add-provider", true);
  // a new service, translated by AI into all languages
  sql(`delete from "ServiceType" where code='E2E_DRAIN'`);
  await go(a, "/admin/services?tab=CATALOGUE");
  await tap(a, "[data-testid=svt-new]");
  await a.getByTestId("svt-code").fill("E2E_DRAIN"); await a.getByTestId("svt-name").fill("Drain cleaning");
  await a.getByTestId("svt-freq-ON_REQUEST").check();
  await tap(a, "[data-testid=svt-save]");
  await until(async () => sql(`select count(*) from "ServiceType" where code='E2E_DRAIN'`) === "1");
  await go(a, "/admin/services?tab=CATALOGUE");
  const drain = a.locator("[data-testid=svt-row][data-code=E2E_DRAIN]");
  check("new service: 1 language", /1\/25/.test(await drain.getByTestId("svt-lang-count").innerText()));
  await tap(a, drain.getByTestId("svt-translate"));
  check("AI translated into 25 languages", await until(async () => sql(`select count(*) from jsonb_object_keys((select name from "ServiceType" where code='E2E_DRAIN'))`) === "25"));
  await go(a, "/admin/services?tab=CATALOGUE");
  await tap(a, a.locator("[data-testid=svt-row][data-code=E2E_DRAIN]").getByTestId("svt-lang-edit"));
  await shot(a, "01b-admin-languages", true);
  sql(`delete from "ServiceType" where code='E2E_DRAIN'`);

  // 1. print supplier adds products
  const v = await login("owner@atlantico.test");
  await go(v, "/vendor/services/printing");
  check("supplier printing page", await v.getByTestId("pp-new").isVisible());
  await tap(v, "[data-testid=pp-new]");
  await v.getByTestId("pp-kind").selectOption("LEAFLET");
  await v.getByTestId("pp-name").fill("Folhetos A5, 135 g, cores frente e verso");
  await v.getByTestId("pp-unit").fill("0.05"); await v.getByTestId("pp-setup").fill("15");
  await v.getByTestId("pp-min").fill("100"); await v.getByTestId("pp-step").fill("50");
  await v.getByTestId("pp-delivery-PICKUP").check();
  await tap(v, "[data-testid=pp-save]");
  check("leaflet product saved", await until(async () => sql(`select count(*) from "PrintProduct" where kind='LEAFLET' and "providerId" in (select id from "ServiceProvider" where "companyId"='${AT}')`) === "1"));
  await go(v, "/vendor/services/printing");
  await tap(v, "[data-testid=pp-new]");
  await v.getByTestId("pp-kind").selectOption("SHELF_LABELS");
  await v.getByTestId("pp-name").fill("Etiquetas de prateleira em papel autocolante");
  await v.getByTestId("pp-label-format").selectOption("A4_21");
  await v.getByTestId("pp-unit").fill("0.06"); await v.getByTestId("pp-setup").fill("0");
  await v.getByTestId("pp-min").fill("2");
  await tap(v, "[data-testid=pp-save]");
  check("shelf-labels product saved", await until(async () => sql(`select count(*) from "PrintProduct" where kind='SHELF_LABELS' and "providerId" in (select id from "ServiceProvider" where "companyId"='${AT}')`) === "1"));
  await go(v, "/vendor/services/printing");
  await shot(v, "02-supplier-products", true);

  // 2. customer orders leaflets with a file
  const c = await login("owner@kebabhouse.test");
  await go(c, "/buy/services/printing");
  check("customer sees the leaflets", (await c.getByTestId("pr-product").count()) >= 1);
  await tap(c, c.getByTestId("pr-product").first().getByTestId("pr-order-open"));
  await c.getByTestId("pr-qty").fill("150"); await c.getByTestId("pr-qty").blur();
  await c.getByTestId("pr-title").fill("Inauguração");
  await c.getByTestId("pr-file").setInputFiles({ name: "folheto.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF\n") });
  check("file uploaded", await until(async () => (await c.getByTestId("pr-file-chip").count()) === 1, 30000));
  check("price shown", /22,50/.test(await c.getByTestId("pr-total").innerText()), await c.getByTestId("pr-total").innerText());
  await shot(c, "03-customer-order-form", true);
  await tap(c, "[data-testid=pr-send]");
  check("order created", await until(async () => sql(`select count(*) from "PrintJob" where "customerCompanyId"='${KB}' and kind='LEAFLET' and qty=150 and array_length("artworkKeys",1)=1`) === "1"));

  // 3. supplier accepts, prints, delivers → FIRINGI invoices
  await go(v, "/vendor/services/printing");
  const row = v.getByTestId("pj-row").first();
  check("supplier sees the order + file", (await row.getByTestId("pj-file").count()) === 1);
  await tap(v, row.getByTestId("pj-accept"));
  await until(async () => sql(`select status from "PrintJob" where "customerCompanyId"='${KB}' and kind='LEAFLET'`) === "ACCEPTED");
  await go(v, "/vendor/services/printing");
  await tap(v, v.getByTestId("pj-row").first().getByTestId("pj-printing"));
  await until(async () => sql(`select status from "PrintJob" where "customerCompanyId"='${KB}' and kind='LEAFLET'`) === "PRINTING");
  await go(v, "/vendor/services/printing");
  await tap(v, v.getByTestId("pj-row").first().getByTestId("pj-delivered"));
  check("delivered + FIRINGI invoice", await until(async () => sql(`select status||':'||("invoiceId" is not null) from "PrintJob" where "customerCompanyId"='${KB}' and kind='LEAFLET'`) === "DELIVERED:true"));
  await go(v, "/vendor/services/printing");
  await shot(v, "04-supplier-orders", true);
  await go(c, "/buy/services/printing");
  check("customer: delivered", (await c.locator("[data-testid=pr-job][data-status=DELIVERED]").count()) === 1);
  await shot(c, "05-customer-orders", true);

  // 4. printed shelf labels from the labels page
  for (const k of [1, 2]) sql(`insert into "ShelfLabel" (id, "companyId", name, barcode, "vatRate", "priceGross", content, "contentUnit", "createdAt", "updatedAt") values ('e2e'||md5(random()::text), '${KB}', 'Arroz agulha 1kg ${k}', '5601000000226', 23, 1.49, 1, 'KG', now(), now())`);
  await go(c, "/buy/catalogue/shelf-labels");
  check("have them printed", await c.getByTestId("sl-order-print").isVisible());
  await shot(c, "06-labels-print-order", true);
  await tap(c, "[data-testid=sl-print-order]");
  check("labels print order with PDF", await until(async () => sql(`select count(*) from "PrintJob" where "customerCompanyId"='${KB}' and kind='SHELF_LABELS' and "pdfKey" is not null`) === "1"));

  // 5. refrigeration repair with parts & labour
  await go(c, "/buy/services");
  const fridge = c.locator("[data-testid=sv-type][data-code=FRIDGE_SERVICE]");
  check("refrigeration service offered", await fridge.isVisible());
  await tap(c, fridge.getByTestId("sv-request-FRIDGE_SERVICE"));
  await fridge.getByTestId("sv-req-note").fill("Câmara frigorífica a 9 °C");
  await tap(c, fridge.getByTestId("sv-req-send"));
  check("repair requested", await until(async () => sql(`select count(*) from "ServiceVisit" where "customerCompanyId"='${KB}' and "serviceTypeId"='${typeId("FRIDGE_SERVICE")}'`) !== "0"));
  sql(`update "ServiceVisit" set date=current_date where "customerCompanyId"='${KB}' and "serviceTypeId"='${typeId("FRIDGE_SERVICE")}'`);
  await go(v, "/vendor/services");
  const vrow = v.locator("[data-testid=pv-visit-row]").filter({ hasText: /Kebab/ }).first();
  await tap(v, vrow.getByTestId("pv-done"));
  await v.getByTestId("pv-extras").fill("120");
  await v.getByTestId("pv-extras-note").fill("Relé do compressor + 1 h mão de obra");
  await v.getByTestId("pv-signed").fill("Ana");
  await shot(v, "07-technician-parts", true);
  await tap(v, "[data-testid=pv-done-save]");
  check("visit done with parts", await until(async () => sql(`select "extrasNet"::text from "ServiceVisit" where "customerCompanyId"='${KB}' and "serviceTypeId"='${typeId("FRIDGE_SERVICE")}' and status='DONE'`) === "120.00"));
  await go(c, "/buy/services");
  check("customer sees parts & labour", /Relé do compressor/.test(await c.locator("main").innerText()));
  await shot(c, "08-customer-services", true);

  // 6. FIRINGI
  await go(a, "/admin/services?tab=PRINTING");
  check("admin print orders", (await a.getByTestId("pa-job").count()) >= 2);
  await shot(a, "09-admin-printing", true);

  // 7. phone
  const ph = await login("owner@kebabhouse.test", { viewport: { width: 390, height: 844 } });
  await go(ph, "/buy/services/printing");
  check("phone: no sideways scroll", !(await ph.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)));
  await shot(ph, "10-phone", true);

  check("no page errors", errors.length === 0, errors.join(" | "));
} catch (e) {
  console.log("✘ crashed —", e.message); failures++;
} finally {
  await browser.close();
  try { clean(); sql(`delete from "ServiceProvider" where "companyId"='${AT}' and "serviceTypeId" in ('${typeId("PRINTING")}', '${typeId("FRIDGE_SERVICE")}')`); sql(`delete from "ServiceType" where code='E2E_DRAIN'`); } catch (e) { console.log("cleanup:", e.message); }
}
console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
