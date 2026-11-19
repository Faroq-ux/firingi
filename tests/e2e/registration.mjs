/**
 * Browser test of Phase 47d — registration details fixed, one company per NIF, the activity code (CAE in Portugal),
 * addresses approved by FIRINGI the first time with a recent till invoice:
 * the customer registration form asks for the CAE → Kebab House (approved, Portuguese) can't edit NIF / VAT / legal
 * name → adds a new shop address with a photo of a till invoice → it waits → FIRINGI (English) sees the invoice and
 * approves → the address is there → a second request is approved without the invoice (bypass) → the company page's
 * registration-correction card → phone width, dark mode → no page errors.
 *   node tests/e2e/registration.mjs [baseUrl] [screenshotDir]
 */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
const { chromium } = createRequire(import.meta.url)("playwright");

const BASE = process.argv[2] ?? "http://localhost:3000";
const SHOTS = process.argv[3] ?? null;
const PASSWORD = process.env.SEED_PASSWORD ?? "Firingi!2026";
const DB = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/firingi";
let failures = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "✔" : "✘"} ${name}${extra ? ` — ${extra}` : ""}`); if (!ok) failures++; };
const shot = async (page, name, full = true) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: full });
const sql = (q) => execFileSync("psql", ["-At", DB, "-c", q], { encoding: "utf8" }).trim();
const browser = await chromium.launch();
const settle = async (p) => { await p.waitForLoadState("networkidle").catch(() => {}); await p.waitForTimeout(400); };
const go = async (p, url) => { await p.goto(`${BASE}${url}`); await settle(p); };
const text = async (loc) => ((await loc.first().innerText().catch(() => "")) ?? "").replace(/\s+/g, " ");
const errors = [];
const PHONE = { width: 390, height: 844 };
async function login(email, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, locale: "en-GB", reducedMotion: "reduce", deviceScaleFactor: SHOTS ? 2 : 1, ...opts });
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
// a small real PNG (the till invoice photo)
const dir = mkdtempSync(path.join(tmpdir(), "firingi-e2e-"));
const photo = path.join(dir, "talao-caixa.png");
writeFileSync(photo, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64"));
const stamp = Date.now().toString(36);
const KH = sql(`select id from "Company" where "legalName"='Kebab House Lisboa, Lda'`);
const savedApproval = sql(`select value::text from "Setting" where key='address.approval'`);
const cleanup = () => {
  sql(`delete from "AddressChangeRequest" where "companyId"='${KH}' and data->>'label' like '%${stamp}%'`);
  sql(`update "Address" set "isActive"=false where "companyId"='${KH}' and label like '%${stamp}%'`);
  sql(`delete from "Setting" where key='address.approval'`);
  if (savedApproval) sql(`insert into "Setting" (id, scope, "scopeId", key, value, "updatedAt") values ('e2e-addr-restore', 'GLOBAL', '', 'address.approval', '${savedApproval.replace(/'/g, "''")}'::jsonb, now())`);
};
const today = new Date().toISOString().slice(0, 10);

try {
  sql(`delete from "Setting" where key='address.approval'`); // defaults: approval on, till invoice asked for
  // ── 1. The customer registration form asks for the CAE ──
  const anon = await (await browser.newContext({ locale: "pt-PT" })).newPage();
  await go(anon, "/register/customer");
  const caeLabel = await text(anon.locator('label[for="activityCode"]'));
  check("registration form: CAE field for a Portuguese wholesale customer, required", /CAE/.test(caeLabel) && (await anon.locator("#activityCode").getAttribute("required")) !== null, caeLabel);
  await shot(anon, "reg-01-register-cae");
  await anon.selectOption("#country", "ES").catch(() => null);
  await settle(anon);
  const esLabel = await text(anon.locator('label[for="activityCode"]'));
  if (await anon.locator('#country option[value="ES"]').count()) check("…another EU country: its own code (CNAE in Spain)", /CNAE/.test(esLabel), esLabel);
  await anon.context().close();

  // ── 2. The company can't edit its registration details ──
  const kh = await login("owner@kebabhouse.test", { locale: "pt-PT" });
  await go(kh, "/buy/company/profile");
  check("profile: legal name and VAT number can't be edited; the reason is shown", await kh.locator("#legalName").isDisabled() && await kh.locator("#vatNumber").isDisabled() && (await kh.getByTestId("profile-registration-locked").count()) === 1);
  check("profile: the CAE field (enter once)", (await kh.getByTestId("profile-activity-code").count()) === 1);
  await shot(kh, "reg-02-profile-locked");

  // ── 3. A new shop address: sent to FIRINGI with a photo of a till invoice ──
  await go(kh, "/buy/company/addresses");
  check("addresses: FIRINGI's approval explained", (await kh.getByTestId("addr-approval-note").count()) === 1);
  await kh.getByRole("button", { name: /Adicionar morada|Add address/ }).click();
  await kh.selectOption("#kind", "DELIVERY");
  await kh.fill("#label", `Loja Graça ${stamp}`);
  await kh.fill("#line1", `Largo da Graça ${stamp}`);
  await kh.locator("[role=dialog] #city").selectOption({ label: "Lisboa" });
  await kh.fill("#postalCode", "1170-165");
  await kh.setInputFiles("#proof", photo);
  await kh.fill("#proofIssuedOn", today);
  await shot(kh, "reg-03-address-with-till-invoice", false);
  await kh.locator('[role=dialog] button[type="submit"]').click();
  await settle(kh);
  check("sent for approval — not added yet", (await kh.getByTestId("addr-sent").count()) === 1 && sql(`select count(*) from "Address" where "companyId"='${KH}' and label='Loja Graça ${stamp}'`) === "0");
  check("…listed as waiting for FIRINGI, with the till invoice", /FIRINGI/.test(await text(kh.getByTestId("addr-request-status"))) && (await kh.getByTestId("addr-request-proof").count()) >= 1);
  await shot(kh, "reg-04-address-waiting");
  // a second one without the invoice
  await kh.getByRole("button", { name: /Adicionar morada|Add address/ }).click();
  await kh.selectOption("#kind", "DELIVERY");
  await kh.fill("#label", `Quiosque ${stamp}`);
  await kh.fill("#line1", `Praça ${stamp}`);
  await kh.locator("[role=dialog] #city").selectOption({ label: "Lisboa" });
  await kh.fill("#postalCode", "1100-001");
  await kh.locator('[role=dialog] button[type="submit"]').click();
  await settle(kh);
  check("a request without the invoice asks for it", (await kh.getByTestId("addr-attach").count()) >= 1);

  // ── 4. FIRINGI: the invoice, approve; the other one approved without it (bypass) ──
  const sa = await login("superadmin@firingi.test");
  await go(sa, "/admin/customers/address-requests");
  const row = sa.getByTestId("admin-address-request").filter({ hasText: `Loja Graça ${stamp}` });
  check("FIRINGI's queue lists the request with its till invoice", (await row.count()) === 1 && (await row.getByTestId("admin-address-proof").count()) === 1);
  const proofUrl = await row.getByTestId("admin-address-proof").getAttribute("href");
  const proofRes = await sa.request.get(`${BASE}${proofUrl}`);
  check("…the invoice opens for FIRINGI (an image)", proofRes.ok() && /image\/png/.test(proofRes.headers()["content-type"] ?? ""));
  const anonProof = await (await browser.newContext()).request.get(`${BASE}${proofUrl}`);
  check("…but not without signing in", anonProof.status() === 401);
  await shot(sa, "reg-05-admin-address-approvals");
  await row.getByTestId("ad-approve").click(); await settle(sa);
  check("approved: the address exists for the company", sql(`select count(*) from "Address" where "companyId"='${KH}' and label='Loja Graça ${stamp}' and "isActive"`) === "1");
  const row2 = sa.getByTestId("admin-address-request").filter({ hasText: `Quiosque ${stamp}` });
  check("no invoice: approving needs the bypass", await row2.getByTestId("ad-approve").isDisabled());
  await row2.getByTestId("ad-bypass").check();
  await row2.getByTestId("ad-approve").click(); await settle(sa);
  check("approved without the invoice — recorded", sql(`select "proofBypassed" from "AddressChangeRequest" where "companyId"='${KH}' and data->>'label'='Quiosque ${stamp}'`) === "t");
  await go(kh, "/buy/company/addresses");
  check("the company sees its new address and the decision", (await text(kh.locator("main"))).includes(`Largo da Graça ${stamp}`) && /Aprovad/.test(await text(kh.getByTestId("addr-requests"))));
  // ── 5. FIRINGI corrects registration details (company page) ──
  await go(sa, `/admin/companies/${KH}`);
  await sa.getByTestId("reg-correct-open").click();
  check("company page: registration details card with the correction form (reason required)", (await sa.getByTestId("reg-correct").count()) === 1 && await sa.getByTestId("rc-save").isDisabled());
  await shot(sa, "reg-06-admin-registration-details");
  // ── 6. Phone, dark ──
  const ph = await login("owner@kebabhouse.test", { viewport: PHONE, colorScheme: "dark", locale: "pt-PT" });
  for (const u of ["/buy/company/addresses", "/buy/company/profile"]) { await go(ph, u); await noSideways(ph, u); }
  await go(ph, "/buy/company/addresses"); await shot(ph, "reg-07-addresses-phone-dark");
  const aph = await login("superadmin@firingi.test", { viewport: PHONE });
  await go(aph, "/admin/customers/address-requests"); await noSideways(aph, "/admin/customers/address-requests");
  check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (e) {
  check("no exceptions", false, e instanceof Error ? e.message.split("\n")[0] : String(e));
} finally {
  cleanup();
  await browser.close();
}
console.log(failures ? `\n${failures} check(s) failed` : "\nAll Phase 47d checks passed");
process.exit(failures ? 1 : 0);
