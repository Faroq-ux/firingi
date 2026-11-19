/**
 * Browser test of Phase 46 (e-invoicing). FIRINGI in English, the Polish customer and supplier in Polish:
 * FIRINGI's e-invoicing overview (services on the test network) and settings (routes per country, languages, the
 * FIRINGI companies) → the Polish customer's e-invoicing page (KSeF is mandatory; English as second language) →
 * an order delivered → its invoice goes to KSeF (queue → sent → accepted), shown in the invoices list with the XML,
 * the PDF in Polish → the supplier agrees to self-billing → its next invoice is issued by FIRINGI (badge, PDF) →
 * a supplier e-invoice received and matched → document detail (XML, history, checks) → archive (auditor ZIP,
 * integrity check) → phone width, dark mode → no page errors.
 *   node tests/e2e/einvoice.mjs [baseUrl] [screenshotDir]
 */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
const { chromium } = createRequire(import.meta.url)("playwright");

const BASE = process.argv[2] ?? "http://localhost:3000";
const SHOTS = process.argv[3] ?? null;
const PASSWORD = process.env.SEED_PASSWORD ?? "Firingi!2026";
const CRON = process.env.CRON_SECRET ?? "test-cron-secret-0123456789abcdef";
const DB = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/firingi";
let failures = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "✔" : "✘"} ${name}${extra ? ` — ${extra}` : ""}`); if (!ok) failures++; };
const shot = async (page, name, full = false) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: full });
const browser = await chromium.launch();
const settle = async (p) => { await p.waitForLoadState("networkidle").catch(() => {}); await p.waitForTimeout(400); };
const go = async (p, url) => { await p.goto(`${BASE}${url}`); await settle(p); };
const sql = (q) => execFileSync("psql", ["-At", DB, "-c", q], { encoding: "utf8" }).trim();
const errors = [];
const PHONE = { width: 390, height: 844 };
async function login(email, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, locale: "en-GB", reducedMotion: "reduce", deviceScaleFactor: SHOTS ? 2 : 1, serviceWorkers: "block", ...opts });
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
const text = async (loc) => ((await loc.first().innerText().catch(() => "")) ?? "").replace(/\s+/g, " ");
/** The e-invoice queue, as the scheduler runs it (sent, then the network's answer). */
const runQueue = async (p, times = 2) => {
  sql(`update "EInvoiceDocument" set "nextAt" = null where status = 'QUEUED'`);
  for (let i = 0; i < times; i++) await p.request.post(`${BASE}/api/cron/einvoice`, { headers: { authorization: `Bearer ${CRON}` } });
};
const deliver = (orderId) => execFileSync("npx", ["tsx", "--require", "./tests/e2e/setup/no-server-only.cjs", "tests/e2e/setup/deliver.ts", orderId], { encoding: "utf8", env: { ...process.env, EINVOICE_SIMULATE: "1" } }).trim().split("\n").pop();

const companyOf = (email) => sql(`select c.id from "Company" c join "Membership" m on m."companyId"=c.id join "User" u on u.id=m."userId" where u.email='${email}' limit 1`);
const KK = companyOf("owner@kebabkrakow.test"), HK = companyOf("owner@hurtownia.test");
const offerOf = (sku) => sql(`select o.id from "VendorOffer" o join "PackagingUnit" pu on pu.id=o."packagingUnitId" join "ProductVariant" v on v.id=pu."variantId" where o."vendorCompanyId"='${HK}' and v.sku='${sku}' and o.status='ACTIVE' limit 1`);
const COLA = offerOf("FIR-COLA33"), OIL = offerOf("FIR-AZEITE75");
const placed = [];
const cleanup = () => {
  for (const id of placed) sql(`update "Order" set status='CANCELLED' where id='${id}' and status in ('NEW','PENDING_CONFIRMATION','ON_HOLD')`);
  sql(`delete from "CartItem" where "cartId" in (select id from "Cart" where "buyerCompanyId"='${KK}')`);
  sql(`delete from "EInvoiceProfile" where "companyId" in ('${KK}', '${HK}')`);
  sql(`delete from "Setting" where key='einvoice.settings'`);
};
check("demo data: Polish customer, supplier, offers; FIRINGI Polska has a Peppol id", !!KK && !!HK && !!COLA && !!OIL && sql(`select "peppolId" from "LegalEntity" le join "Country" c on c.id=le."countryId" where c.code='PL'`).startsWith("9945:"));

async function placeOrder(buyer) {
  await go(buyer, `/buy/catalogue/offers/${COLA}`);
  await buyer.locator('main input[type="number"]').first().fill("5");
  await buyer.getByRole("button", { name: /Dodaj do koszyka/ }).click();
  await settle(buyer);
  await go(buyer, `/buy/catalogue/offers/${OIL}`);
  await buyer.locator('main input[type="number"]').first().fill("1");
  await buyer.getByRole("button", { name: /Dodaj do koszyka/ }).click();
  await settle(buyer);
  await go(buyer, "/buy/orders/cart");
  await buyer.getByRole("button", { name: /Złóż zamówienie/ }).click();
  await buyer.waitForURL("**placed=1", { timeout: 25000 }).catch(() => {});
  await settle(buyer);
  const id = buyer.url().includes("placed=1") ? buyer.url().split("/").pop().split("?")[0] : null;
  if (id) placed.push(id);
  return id;
}

try {
  // ── 1. FIRINGI: overview and settings ──
  const sa = await login("superadmin@firingi.test");
  await go(sa, "/admin/invoices/e-invoicing");
  const prov = await text(sa.getByTestId("einv-providers"));
  check("overview: every service listed, on the test network here", /KSeF/.test(prov) && /Peppol access point/.test(prov) && /Test network/.test(prov), prov.slice(0, 120));
  check("overview: KPIs", (await sa.getByTestId("kpi-sent").count()) === 1 && (await sa.getByTestId("kpi-attention").count()) === 1);
  await shot(sa, "ein-01-admin-overview", true);

  await go(sa, "/admin/invoices/e-invoicing/settings");
  check("settings: Poland goes to KSeF, mandatory", (await sa.getByTestId("es-format-PL").inputValue()) === "KSEF_FA3" && (await sa.getByTestId("es-provider-PL").inputValue()) === "ksef"
    && await sa.getByTestId("es-route-PL").locator('input[type="checkbox"]').nth(1).isChecked());
  check("settings: Germany XRechnung, France Factur-X, Italy SDI, Spain Verifactu", (await sa.getByTestId("es-format-DE").inputValue()) === "XRECHNUNG" && (await sa.getByTestId("es-format-FR").inputValue()) === "FACTURX"
    && (await sa.getByTestId("es-format-IT").inputValue()) === "FATTURAPA" && (await sa.getByTestId("es-format-ES").inputValue()) === "VERIFACTU");
  // a format that the chosen service can't carry moves to one that can
  await sa.getByTestId("es-format-NL").selectOption("FATTURAPA");
  check("settings: SDI format offers only services that carry it in NL (the EU-wide service)", (await sa.getByTestId("es-provider-NL").inputValue()) === "eu-hub");
  await sa.getByTestId("es-format-NL").selectOption("PEPPOL_BIS3");
  await sa.getByTestId("es-prio-0").selectOption("CUSTOMER_COUNTRY");
  await sa.getByTestId("es-save").click();
  await settle(sa);
  check("settings saved", /Saved/.test(await text(sa.getByTestId("einvoice-settings"))));
  check("FIRINGI companies: Peppol ids shown", (await sa.getByTestId("entity-peppol-PL").inputValue()).startsWith("9945:"));
  await shot(sa, "ein-02-admin-settings", true);

  // ── 2. The Polish customer: e-invoicing page ──
  const buyer = await login("owner@kebabkrakow.test");
  await go(buyer, "/buy/company/e-invoicing");
  check("customer: page in Polish", /Faktury elektroniczne/.test(await text(buyer.locator("main h1"))));
  check("customer: KSeF is required by law here, the country named in Polish", /KSeF/.test(await text(buyer.getByTestId("ep-route"))) && /Polska/.test(await text(buyer.getByTestId("ep-route"))));
  await buyer.getByTestId("ep-second").selectOption("en");
  await buyer.getByTestId("ep-save").click();
  await settle(buyer);
  check("customer: second language saved", /Zapisano/.test(await text(buyer.getByTestId("einvoice-profile"))) && sql(`select "secondLanguage" from "EInvoiceProfile" where "companyId"='${KK}'`) === "en");
  await buyer.getByTestId("ep-peppolId").fill("not an id");
  await buyer.getByTestId("ep-save").click();
  await settle(buyer);
  check("customer: a bad Peppol id is refused", /Peppol/.test(await text(buyer.getByTestId("einvoice-profile"))));
  await buyer.getByTestId("ep-peppolId").fill("");
  await buyer.getByTestId("ep-save").click();
  await settle(buyer);
  await shot(buyer, "ein-03-customer-settings", true);

  // ── 3. An order delivered → KSeF ──
  const orderId = await placeOrder(buyer);
  check("order placed", !!orderId);
  let inv = "";
  if (orderId) {
    inv = deliver(orderId);
    check("delivered → invoice issued, in Polish with English", !!inv && sql(`select language || '/' || coalesce("secondLanguage", '-') from "Invoice" where id='${inv}'`) === "pl/en");
    check("…queued for KSeF", sql(`select format || ' ' || channel from "EInvoiceDocument" where "invoiceId"='${inv}'`) === "KSEF_FA3 KSEF");
    await runQueue(sa);
    check("…sent and cleared by KSeF (with its KSeF number)", /^ACCEPTED \d{8}-EE-/.test(sql(`select status || ' ' || coalesce("networkRef", '') from "EInvoiceDocument" where "invoiceId"='${inv}'`)));
    await go(buyer, "/buy/finance/invoices");
    const tbl = await text(buyer.getByTestId("invoices-table"));
    check("customer invoices: e-invoice status shown", /Przyjęta/.test(tbl) && /KSeF FA\(3\)/.test(tbl), tbl.slice(0, 160));
    await shot(buyer, "ein-04-customer-invoices", true);
    const docId = sql(`select id from "EInvoiceDocument" where "invoiceId"='${inv}'`);
    const xml = await buyer.request.get(`${BASE}/api/einvoice/${docId}/xml`);
    check("customer downloads the KSeF XML", xml.ok() && /<Faktura/.test(await xml.text()));
    const pdf = await buyer.request.get(`${BASE}/api/invoices/${inv}/pdf`);
    check("invoice PDF renders (Polish, DejaVu font)", pdf.ok() && (await pdf.body()).subarray(0, 4).toString() === "%PDF");
    await go(buyer, "/buy/company/e-invoicing");
    check("customer: the document listed on its e-invoicing page", /Przyjęta/.test(await text(buyer.getByTestId("ep-docs"))));
  }

  // ── 4. The supplier: self-billing ──
  const vendor = await login("owner@hurtownia.test");
  await go(vendor, "/vendor/company/e-invoicing");
  check("supplier: self-billing offered", (await vendor.getByTestId("ep-selfbilling").count()) === 1);
  await vendor.getByTestId("ep-selfbilling-agree").check();
  await vendor.getByTestId("ep-save").click();
  await settle(vendor);
  await go(vendor, "/vendor/company/e-invoicing");
  check("supplier: agreement number and date shown", /SB-/.test(await text(vendor.getByTestId("ep-agreement"))));
  await shot(vendor, "ein-05-supplier-selfbilling", true);
  const order2 = await placeOrder(buyer);
  if (order2) {
    deliver(order2);
    const st = sql(`select coalesce("selfBilledNumber", '') || ' ' || status from "VendorBillingStatement" where "orderId"='${order2}' and not "isCreditStatement"`);
    check("next statement self-billed by FIRINGI (own series) and matched", /^AF 6762495634 \d{4}\/\d+ MATCHED$/.test(st), st);
    await runQueue(sa);
    check("…the self-billed invoice sent to KSeF", /^(SENT|ACCEPTED)$/.test(sql(`select status from "EInvoiceDocument" where kind='SELF_BILLED' and "statementId" in (select id from "VendorBillingStatement" where "orderId"='${order2}')`)));
    await go(vendor, "/vendor/finance/invoices");
    check("supplier invoices: 'self-billed' badge", (await vendor.getByTestId("selfbilled-badge").count()) >= 1);
    await shot(vendor, "ein-06-supplier-invoices", true);
    const viId = sql(`select id from "VendorInvoice" where source='SELF_BILLED' and "vendorCompanyId"='${HK}' order by "createdAt" desc limit 1`);
    const f = await vendor.request.get(`${BASE}/api/vendor-invoices/${viId}/file`);
    check("self-billed invoice PDF", f.ok() && (await f.body()).subarray(0, 4).toString() === "%PDF");
  }

  // ── 5. FIRINGI: a supplier e-invoice received and matched ──
  const openSt = orderId ? sql(`select id from "VendorBillingStatement" where "orderId"='${orderId}' and not "isCreditStatement" and status='OPEN'`) : "";
  await go(sa, "/admin/invoices/e-invoicing/inbound");
  if (openSt) {
    await sa.getByTestId("einv-sim-statement").selectOption(openSt);
    await sa.getByTestId("einv-sim-send").click();
    await settle(sa);
    await go(sa, "/admin/invoices/e-invoicing/inbound");
    check("received supplier e-invoice matched to its statement", /Matched/.test(await text(sa.getByTestId("inbound-rows"))) && sql(`select status from "VendorBillingStatement" where id='${openSt}'`) === "MATCHED");
  } else check("an open statement to receive against", false);
  await shot(sa, "ein-07-admin-inbound", true);

  // ── 6. Document detail, archive ──
  if (inv) {
    const docId = sql(`select id from "EInvoiceDocument" where "invoiceId"='${inv}'`);
    await go(sa, `/admin/invoices/e-invoicing/${docId}`);
    check("detail: the XML as sent", /<Faktura/.test(await text(sa.getByTestId("einv-xml-preview"))));
    check("detail: history queued → sent → accepted", /Queued/.test(await text(sa.getByTestId("einv-events"))) && /Accepted/.test(await text(sa.getByTestId("einv-events"))));
    await sa.getByTestId("einv-check").click();
    await settle(sa);
    check("detail: check now finds no problems", (await sa.getByTestId("einv-check-ok").count()) === 1);
    await shot(sa, "ein-08-admin-document", true);
  }
  await go(sa, "/admin/invoices/e-invoicing/archive");
  check("archive: documents listed", /KSeF/.test(await text(sa.getByTestId("archive-rows"))));
  const href = await sa.getByTestId("archive-export").getAttribute("href");
  const zip = await sa.request.get(`${BASE}${href}`);
  check("archive: auditor export is a ZIP", zip.ok() && (await zip.body()).subarray(0, 2).toString() === "PK");
  await sa.getByTestId("einv-verify").click();
  await settle(sa);
  const ver = await text(sa.getByTestId("einv-verify-result"));
  check("archive: every file intact", /files intact\.$/.test(ver) || /intact\./.test(ver), ver);
  await shot(sa, "ein-09-admin-archive", true);
  await go(sa, "/admin/invoices/e-invoicing");
  check("overview: sent documents counted", Number(await text(sa.getByTestId("kpi-sent"))) >= 2);

  // ── 7. Phone, dark mode ──
  const phone = await login("owner@kebabkrakow.test", { viewport: PHONE, colorScheme: "dark" });
  await go(phone, "/buy/company/e-invoicing");
  await noSideways(phone, "/buy/company/e-invoicing");
  await shot(phone, "ein-10-customer-phone-dark", true);
  const aphone = await login("superadmin@firingi.test", { viewport: PHONE, colorScheme: "dark" });
  for (const u of ["/admin/invoices/e-invoicing", "/admin/invoices/e-invoicing/settings", "/admin/invoices/e-invoicing/archive"]) { await go(aphone, u); await noSideways(aphone, u); }
  await go(aphone, "/admin/invoices/e-invoicing");
  await shot(aphone, "ein-11-admin-phone-dark", true);
  const vphone = await login("owner@hurtownia.test", { viewport: PHONE });
  await go(vphone, "/vendor/company/e-invoicing");
  await noSideways(vphone, "/vendor/company/e-invoicing");

  check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (e) {
  check("no exceptions", false, e instanceof Error ? e.message.split("\n")[0] : String(e));
} finally {
  cleanup();
  await browser.close();
}
console.log(failures ? `\n${failures} check(s) failed` : "\nAll Phase 46 checks passed");
process.exit(failures ? 1 : 0);
