/**
 * Browser test of Phase 57 (EU trade reporting). FIRINGI in English, the Spanish supplier in Spanish:
 * a Portuguese wholesaler buys rice from the Spanish distributor (setup script) → FIRINGI's EU trade overview
 * lists the returns and thresholds → the Intrastat arrivals return shows the line with "No CN8 code" →
 * the supplier gives the CN8 code, net mass and origin in Products › Customs Codes → FIRINGI accepts it →
 * the rebuilt return has the code, the INE file downloads with it → FIRINGI marks it filed with the reference →
 * the supplier's EU trade report shows FIRINGI Portugal's VAT number and downloads → VIES checks page →
 * settings saved → phone width → no page errors. Cleans up after itself.
 *   node tests/e2e/eu-trade.mjs [baseUrl] [screenshotDir]
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
const main = (p) => p.textContent("main");
async function login(email, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, locale: "en-GB", reducedMotion: "reduce", deviceScaleFactor: SHOTS ? 2 : 1, serviceWorkers: "block", ...opts });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${email}: ${e.message.slice(0, 160)}`));
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

const NOW = new Date().toISOString().slice(0, 7);
const RICE = sql(`select v."productId" from "ProductVariant" v where v.sku='FIR-ARROZ1'`);
const PACK = sql(`select o."packagingUnitId" from "VendorOffer" o join "Company" c on c.id=o."vendorCompanyId" join "PackagingUnit" pu on pu.id=o."packagingUnitId" join "ProductVariant" v on v.id=pu."variantId" where c."legalName"='Distribuciones Ibéricas S.L.' and v.sku='FIR-ARROZ1' and o.status='ACTIVE' limit 1`);
const IB = sql(`select id from "Company" where "legalName"='Distribuciones Ibéricas S.L.'`);
const cleanup = () => {
  sql(`delete from "TradeReturn"`);
  sql(`delete from "Setting" where key in ('trade.settings','trade.thresholdWarned')`);
  sql(`delete from "TradeCodeProposal" where "companyId"='${IB}'`);
  sql(`update "Product" set "hsCode"=null, "originCountryCode"=null, "cnCheckedAt"=null where id='${RICE}'`);
  sql(`update "PackagingUnit" set "netWeightKg"=null, "suppUnits"=null where id='${PACK}'`);
};
cleanup();
const ORDER = execFileSync("npx", ["tsx", "--require", "./tests/e2e/setup/no-server-only.cjs", "tests/e2e/setup/trade-order.ts"], { encoding: "utf8" }).trim().split("\n").pop();
check("a delivered order from the Spanish distributor (reverse-charge statement)", sql(`select "taxRegime" from "VendorBillingStatement" where "orderId"='${ORDER}' and not "isCreditStatement"`) === "INTRA_EU_REVERSE_CHARGE");

const admin = await login("superadmin@firingi.test");
const supplier = await login("owner@ibericas.test", { locale: "es-ES" });

// ── FIRINGI: overview ──
await go(admin, "/admin/invoices/eu-trade");
await admin.getByTestId("trade-refresh").click();
check("the overview lists the returns of this month", await until(async () => (await admin.getByTestId("trade-returns").textContent()).includes("Intrastat arrivals") && (await admin.getByTestId("trade-returns").textContent()).includes(NOW)));
check("…and the thresholds per flow", /Arrivals[\s\S]*650\D?000,00/.test(await admin.getByTestId("trade-thresholds").textContent()));
await shot(admin, "p57-01-overview", true);

// ── the arrivals return flags the missing customs data ──
const RET = sql(`select r.id from "TradeReturn" r join "LegalEntity" l on l.id=r."legalEntityId" join "Country" c on c.id=l."countryId" where c.code='PT' and r.kind='ARRIVALS' and r.period='${NOW}'`);
await go(admin, `/admin/invoices/eu-trade/returns/${RET}`);
const linesText = await admin.getByTestId("trade-lines").textContent();
check("the arrival line shows the supplier's VAT number and 'No CN8 code'", linesText.includes("ESB12345678") && linesText.includes("No CN8 code"));
check("…'Mark ready' is off while data is missing", await admin.getByTestId("trade-ready").isDisabled());

// ── the supplier gives the customs data (Spanish) ──
await go(supplier, "/vendor/products/customs");
check("the supplier's customs page is in Spanish and flags missing data", /Códigos aduaneros/.test(await main(supplier)) && (await supplier.getByTestId(`customs-row-${PACK}`).textContent()).includes("Faltan datos"));
await supplier.getByTestId(`customs-edit-${PACK}`).click();
await supplier.fill(`#cu-${PACK}-cn`, "1006 30 98");
await supplier.fill(`#cu-${PACK}-kg`, "1");
await supplier.fill(`#cu-${PACK}-origin`, "ES");
await supplier.getByTestId(`customs-send-${PACK}`).click();
check("…sent to FIRINGI, waiting for the check", await until(async () => (await supplier.getByTestId(`customs-row-${PACK}`).textContent()).includes("pendiente de revisión")));
await shot(supplier, "p57-02-supplier-customs");

// ── FIRINGI accepts it ──
await go(admin, "/admin/invoices/eu-trade/codes");
const PROP = sql(`select id from "TradeCodeProposal" where "companyId"='${IB}' and status='PENDING' limit 1`);
check("FIRINGI sees the supplier's proposal", (await admin.getByTestId("trade-proposals").textContent()).includes("Ibéricas"));
await shot(admin, "p57-03-codes");
await admin.getByTestId(`proposal-accept-${PROP}`).click();
check("…accepted: copied to the product", await until(async () => sql(`select "hsCode" from "Product" where id='${RICE}'`) === "10063098"));

// ── rebuilt return, file, filing ──
await go(admin, `/admin/invoices/eu-trade/returns/${RET}`);
await admin.getByTestId("trade-rebuild").click();
await until(async () => !(await admin.getByTestId("trade-lines").textContent()).includes("No CN8 code"));
const mine = await admin.locator("[data-testid=trade-lines] tr", { hasText: "ESB12345678" }).first().textContent();
check("the rebuilt line has the CN8 code and no problem", mine.includes("10063098") && !mine.includes("No CN8 code"));
const ine = await admin.request.get(`${BASE}/api/trade/returns/${RET}?format=national`);
check("the INE Intrastat file downloads with the code", ine.ok() && (await ine.text()).includes("10063098;ES;11;3;DAP;"));
const xlsx = await admin.request.get(`${BASE}/api/trade/returns/${RET}?format=xlsx`);
check("…and the Excel file", xlsx.ok() && (await xlsx.body()).subarray(0, 2).toString() === "PK");
await shot(admin, "p57-04-return", true);
await admin.getByTestId("trade-ref").fill("INE-2026-0001234");
await admin.getByTestId("trade-file").click();
check("marked filed with the reference", await until(async () => (await admin.getByTestId("trade-filed").textContent()).includes("INE-2026-0001234")));

// ── the supplier's own report ──
await go(supplier, "/vendor/reports/eu-trade");
check("the supplier's EU trade report shows FIRINGI Portugal's VAT number", await until(async () => (await supplier.getByTestId("eu-ecsl").textContent()).includes("PT517000008")));
check("…and the goods with the CN8 code", (await supplier.getByTestId("eu-intrastat").textContent()).includes("10063098"));
const sup = await supplier.request.get(`${BASE}/api/trade/supplier?period=${NOW}&kind=ECSL&format=csv`);
check("…the CSV downloads", sup.ok() && (await sup.text()).includes("PT517000008"));
await shot(supplier, "p57-05-supplier-report", true);

// ── VIES and settings ──
await go(admin, "/admin/invoices/eu-trade/vies");
check("the VIES page lists the Spanish supplier", (await admin.getByTestId("vies-partners").textContent()).includes("Ibéricas"));
await admin.getByTestId(`vies-recheck-${IB}`).click();
check("…a check is recorded with its purpose", await until(async () => sql(`select count(*) from "VatValidation" where "companyId"='${IB}' and purpose='RECHECK'`) !== "0"));
await go(admin, "/admin/settings/eu-trade");
await admin.getByTestId("ts-arr-obliged-PT").check();
await admin.getByTestId("ts-save").click();
check("settings saved (Portugal must file arrivals)", await until(async () => sql(`select value->'countries'->'PT'->>'arrivalsObliged' from "Setting" where key='trade.settings'`) === "true"));
await shot(admin, "p57-06-settings", true);

// ── phone width ──
await admin.setViewportSize(PHONE);
await go(admin, "/admin/invoices/eu-trade");
await noSideways(admin, "FIRINGI overview");
await supplier.setViewportSize(PHONE);
await go(supplier, "/vendor/reports/eu-trade");
await noSideways(supplier, "supplier report");
await shot(supplier, "p57-07-phone");

check("no page errors", errors.length === 0, errors.join(" | "));
cleanup();
await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nAll EU trade checks passed");
process.exit(failures ? 1 : 0);
