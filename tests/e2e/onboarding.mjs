/**
 * Browser test of the Phase 2 flow against a running server:
 * register a customer → add address + documents → submit → admin approves docs + account
 * → customer lands in the Buy portal → requests tobacco access → admin approves.
 *   node tests/e2e/onboarding.mjs [baseUrl] [screenshotDir]
 */
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
const { chromium } = createRequire(import.meta.url)("playwright");

const BASE = process.argv[2] ?? "http://localhost:3000";
const SHOTS = process.argv[3] ?? null;
const PASSWORD = process.env.SEED_PASSWORD ?? "Firingi!2026";
let failures = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "✔" : "✘"} ${name}${extra ? ` — ${extra}` : ""}`); if (!ok) failures++; };
const shot = async (page, name) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });

const dir = mkdtempSync(path.join(tmpdir(), "firingi-e2e-"));
const pdf = path.join(dir, "certidao.pdf");
writeFileSync(pdf, "%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");
const exe = path.join(dir, "evil.pdf");
writeFileSync(exe, "MZ not a pdf");

// Valid PT NIF from a random 8-digit base.
const base8 = String(52000000 + Math.floor(Math.random() * 8000000));
const sum = [...base8].reduce((a, d, i) => a + Number(d) * (9 - i), 0);
const nif = base8 + ((11 - (sum % 11)) >= 10 ? 0 : 11 - (sum % 11));
const email = `e2e.${Date.now()}@restaurante.pt`;
const legalName = `Restaurante E2E ${Date.now()}`;

const browser = await chromium.launch();
const settle = async (page) => { await page.waitForLoadState("networkidle"); await page.waitForTimeout(600); };

// ── 1. Register ──
const applicant = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
await applicant.goto(`${BASE}/register`);
await shot(applicant, "p2-01-register-choose");
await applicant.click('a[href="/register/customer"]');
await settle(applicant);
await applicant.fill("#legalName", legalName);
await applicant.fill("#taxId", "123456780"); // invalid check digit first
await applicant.fill("#companyEmail", email);
await applicant.fill("#phone", "+351 912 345 678");
await applicant.fill("#line1", "Rua Augusta 10");
await applicant.selectOption("#city", { label: "Lisboa" });
await applicant.fill("#postalCode", "1100-053");
await applicant.fill("#ownerName", "Teresa Teste");
await applicant.fill("#ownerEmail", email);
await applicant.fill("#password", "Password123!");
await applicant.check('input[name="acceptTerms"]');
await applicant.check('input[name="businessDeclaration"]');
await shot(applicant, "p2-02-register-form");
await applicant.click('button[type="submit"]');
await settle(applicant);
check("invalid NIF is rejected", (await applicant.textContent("form")).match(/NIF/i) && applicant.url().includes("/register/customer"));
await applicant.fill("#taxId", nif);
await applicant.click('button[type="submit"]');
await applicant.waitForURL("**/application-status", { timeout: 15000 }).catch(() => {});
await settle(applicant);
check("registration signs in and opens the application page", applicant.url().endsWith("/application-status"), applicant.url());
check("checklist asks for documents and a delivery address", /Certidão|Business registration/.test(await applicant.textContent("main")));

// ── 2. Onboarding: delivery address + documents ──
await applicant.getByRole("button", { name: /Adicionar morada|Add address/ }).click();
await applicant.selectOption("#kind", "DELIVERY");
await applicant.fill("#label", "Restaurante");
await applicant.fill("#line1", "Rua da Prata 20");
await applicant.locator("[role=dialog] #city").selectOption({ label: "Lisboa" });
await applicant.fill("#postalCode", "1100-420");
await applicant.locator('[role=dialog] button[type="submit"]').click();
await settle(applicant);
check("delivery address added", (await applicant.textContent("main")).includes("Rua da Prata 20"));

await applicant.setInputFiles("#doc-file", exe);
await applicant.selectOption("#doc-type", "BUSINESS_REGISTRATION");
await applicant.locator("form:has(#doc-file) button[type=submit]").click();
await settle(applicant);
check("disguised file is rejected", /PDF, JPG/.test(await applicant.textContent("main")));
for (const type of ["BUSINESS_REGISTRATION", "TAX_ID_CERTIFICATE"]) {
  await applicant.selectOption("#doc-type", type);
  await applicant.setInputFiles("#doc-file", pdf);
  await applicant.locator("form:has(#doc-file) button[type=submit]").click();
  await settle(applicant);
}
check("two documents uploaded", (await applicant.locator('a[href^="/api/files/"]').count()) === 2);
await shot(applicant, "p2-03-application-ready");
await applicant.getByRole("button", { name: /Enviar candidatura|Submit application/ }).click();
await settle(applicant);
check("application submitted (under review)", /Em análise|Under review/.test(await applicant.textContent("main")));
await applicant.goto(`${BASE}/buy`);
check("applicant still cannot open the Buy portal", applicant.url().endsWith("/application-status"), applicant.url());

// ── 3. Admin review ──
const admin = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
await admin.goto(`${BASE}/login`);
await admin.fill("#email", "ops@firingi.test");
await admin.fill("#password", PASSWORD);
await admin.click("button[type=submit]");
await settle(admin);
await admin.goto(`${BASE}/admin/customers/applications`);
await settle(admin);
check("application appears in Customer Applications", (await admin.textContent("main")).includes(legalName));
await shot(admin, "p2-04-admin-applications");
await admin.getByRole("link", { name: legalName }).click();
await settle(admin);
check("approve is blocked until documents are approved", await admin.getByRole("button", { name: "Approve", exact: true }).first().isDisabled());
await shot(admin, "p2-05-admin-company-before");
const docApprove = admin.locator("li").filter({ hasText: "certidao.pdf" }).getByRole("button", { name: "Approve" });
while ((await docApprove.count()) > 0) { await docApprove.first().click(); await settle(admin); }
const fileRes = await admin.request.get(`${BASE}${await admin.locator('a[href^="/api/files/"]').first().getAttribute("href")}`);
check("admin can open the uploaded document", fileRes.status() === 200 && (await fileRes.text()).startsWith("%PDF"));
await admin.getByRole("button", { name: "Approve", exact: true }).first().click();
await settle(admin);
check("company approved", /APPROVED|Aprovado/.test(await admin.textContent("main")));
await shot(admin, "p2-06-admin-company-approved");

// ── 4. Customer is now active ──
await applicant.goto(`${BASE}/`);
await settle(applicant);
check("approved customer lands in the Buy portal", applicant.url().includes("/buy/"), applicant.url());
await applicant.goto(`${BASE}/buy/company/restricted-products`);
await settle(applicant);
await applicant.getByRole("button", { name: /Pedir acesso|Request access/ }).first().click();
await applicant.fill("#ln-TOBACCO", "TAB-2026-0001");
await applicant.fill("#ia-TOBACCO", "Autoridade Tributária");
await applicant.setInputFiles("#f-TOBACCO", pdf);
await applicant.locator("form:has(#ln-TOBACCO) button[type=submit]").click();
await settle(applicant);
check("tobacco access requested", /A aguardar|Waiting/.test(await applicant.textContent("main")));
await shot(applicant, "p2-07-restricted-request");

await admin.goto(`${BASE}/admin/risk/compliance`);
await settle(admin);
const row = admin.locator("tr").filter({ hasText: legalName });
await row.locator('input[type="date"]').fill(`${new Date().getFullYear() + 1}-12-31`);
await row.getByRole("button", { name: "Approve" }).click();
await settle(admin);
await applicant.reload();
await settle(applicant);
check("tobacco access approved with expiry date", /Acesso até|Access until/.test(await applicant.textContent("main")));

// ── 5. Other company cannot download the document ──
const other = await (await browser.newContext()).newPage();
await other.goto(`${BASE}/login`);
await other.fill("#email", "owner@kebabhouse.test");
await other.fill("#password", PASSWORD);
await other.click("button[type=submit]");
await settle(other);
const foreign = await other.request.get(fileRes.url());
check("another company cannot download the document", foreign.status() === 404, String(foreign.status()));
const anon = await browser.newContext();
check("anonymous download is refused", (await anon.request.get(fileRes.url())).status() === 401);

await browser.close();
console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll onboarding e2e checks passed");
process.exit(failures ? 1 : 0);
