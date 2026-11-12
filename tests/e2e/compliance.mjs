/**
 * Browser test of Phase 28 (supplier compliance), as FIRINGI (English), the wholesaler Lisboa Central
 * (Portuguese UI) and its customer Kebab House:
 *  FIRINGI makes HACCP required → Lisboa Central is paused: its offers disappear from the customer's
 *  catalogue, its dashboard and product list say so → it adds its permanent certificate code and uploads
 *  the HACCP certificate → FIRINGI's dashboard and review queue show it → FIRINGI approves it → the
 *  offers are back, with a verified HACCP badge, a badge filter and a supplier panel → FIRINGI hides the
 *  supplier's badge, switches the HACCP badge off and on → grace period, audit trail, daily job → phone
 *  width → HACCP back to optional → no page errors.
 *   node tests/e2e/compliance.mjs [baseUrl] [screenshotDir]
 */
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const { chromium, devices } = createRequire(import.meta.url)("playwright");

const BASE = process.argv[2] ?? "http://localhost:3000";
const SHOTS = process.argv[3] ?? null;
const PASSWORD = process.env.SEED_PASSWORD ?? "Firingi!2026";
let failures = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "✔" : "✘"} ${name}${extra ? ` — ${extra}` : ""}`); if (!ok) failures++; };
const shot = async (page, name) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
const browser = await chromium.launch();
const settle = async (p) => { await p.waitForLoadState("networkidle").catch(() => {}); await p.waitForFunction(() => !document.querySelector("[aria-busy=true]"), null, { timeout: 15000 }).catch(() => {}); await p.waitForTimeout(400); };
const go = async (p, url) => { await p.goto(`${BASE}${url}`); await settle(p); };
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn().catch(() => false)) return true; await new Promise((r) => setTimeout(r, 400)); } return false; };
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
const main = (p) => p.textContent("main");
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const dir = mkdtempSync(join(tmpdir(), "p28-"));
const pdf = join(dir, "haccp-2027.pdf");
writeFileSync(pdf, "%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

async function setHaccp(sa, changes) {
  await go(sa, "/admin/vendors/compliance/types");
  const box = sa.getByTestId("edit-HACCP");
  await box.locator("summary").click();
  for (const [k, v] of Object.entries(changes)) {
    const cb = box.getByTestId(`type-${k}`);
    if ((await cb.isChecked()) !== v) await cb.click();
  }
  await box.getByTestId("save-type").click();
  return until(async () => /Saved/.test(await box.textContent()));
}
async function catalogue(p, q = "mozzarella", badge = "") {
  return (await (await p.request.get(`${BASE}/api/catalogue/offers?q=${q}${badge ? `&badge=${badge}` : ""}`)).json()).items ?? [];
}
const lxItems = (items) => items.filter((i) => i.vendor.name === "Lisboa Central");

const sa = await login("superadmin@firingi.test");
const owner = await login("owner@kebabhouse.test");
const lx = await login("owner@lisboacentral.test");

// ── 0. Baseline: built-in certificate types are optional; Lisboa Central sells ──
check("customer sees Lisboa Central's mozzarella", lxItems(await catalogue(owner)).length > 0);
await go(sa, "/admin/vendors/compliance/types");
check("built-in certificate types listed", (await sa.locator('[data-testid^="type-row-"]').count()) >= 9);
await shot(sa, "p28-01-admin-types");

// ── 1. FIRINGI makes HACCP required → Lisboa Central is paused ──
check("HACCP made required (rules re-applied)", await setHaccp(sa, { required: true }));
check("paused supplier's offers disappear from the customer's catalogue", await until(async () => lxItems(await catalogue(owner)).length === 0));
await go(lx, "/vendor/dashboard/overview");
check("supplier dashboard warns about the pause", (await lx.getByTestId("compliance-alert").count()) === 1);
await go(lx, "/vendor/products/catalogue");
check("supplier's product list marks offers paused", (await lx.getByTestId("compliance-paused").count()) > 0);
await go(lx, "/vendor/company/compliance");
check("compliance page shows the pause banner", (await lx.getByTestId("paused-banner").count()) === 1);
check("HACCP is missing and required", /Em falta|Missing/.test(await lx.getByTestId("cert-HACCP").getByTestId("cert-state").textContent()));
await shot(lx, "p28-02-supplier-paused");

// ── 2. Supplier: permanent certificate code + HACCP upload ──
await go(lx, "/vendor/company/profile");
await lx.fill("#certificateCode", "1234 5678 9012");
await lx.getByRole("button", { name: /Guardar|Save/ }).first().click();
await until(async () => (await lx.locator("[role=status]").count()) > 0);
await go(lx, "/vendor/company/profile");
check("permanent certificate code saved (normalised)", (await lx.inputValue("#certificateCode")) === "1234-5678-9012", await lx.inputValue("#certificateCode"));
await go(lx, "/vendor/company/compliance");
await lx.getByTestId("upload-HACCP").click();
await lx.fill("#n-ctype_haccp", `HACCP-${Date.now().toString(36).toUpperCase()}`);
await lx.fill("#i-ctype_haccp", "SGS Portugal");
await lx.fill("#d-ctype_haccp", day(-20));
await lx.fill("#e-ctype_haccp", day(400));
await lx.setInputFiles("#f-ctype_haccp", pdf);
await lx.locator("form:has(#f-ctype_haccp) button[type=submit]").click();
check("certificate sent to FIRINGI", await until(async () => /À espera de análise|Waiting for review/.test(await lx.getByTestId("cert-HACCP").getByTestId("cert-state").textContent())));
check("still paused while waiting for review", lxItems(await catalogue(owner)).length === 0);
await shot(lx, "p28-03-supplier-uploaded");

// ── 3. FIRINGI dashboard, review queue, approval ──
await go(sa, "/admin/vendors/compliance/overview");
check("dashboard counts a paused supplier and a certificate to review", Number((await sa.getByTestId("kpi-paused").textContent()).replace(/\D/g, "")) >= 1 && Number((await sa.getByTestId("kpi-review").textContent()).replace(/\D/g, "")) >= 1);
await shot(sa, "p28-04-admin-dashboard");
await go(sa, "/admin/vendors/compliance/review");
const row = sa.getByTestId("review-table").locator("tr", { hasText: "Lisboa Central" }).first();
check("certificate in the review queue", (await row.count()) === 1);
await row.getByRole("link", { name: /HACCP/ }).first().click();
await settle(sa);
check("certificate file is shown", (await sa.locator("iframe[title]").count()) === 1);
await shot(sa, "p28-05-admin-certificate");
await sa.getByTestId("approve-cert").click();
check("certificate approved", await until(async () => /APPROVED/.test(await main(sa))));
const certPath = sa.url().replace(BASE, "");
check("offers are back for the customer", await until(async () => lxItems(await catalogue(owner)).length > 0));
const item = lxItems(await catalogue(owner))[0];
check("customer sees the verified HACCP badge", (item?.vendor.badges ?? []).some((b) => b.key === "HACCP"));
await go(lx, "/vendor/company/compliance");
check("supplier: HACCP valid, no pause banner, badge preview", /Válido|Valid/.test(await lx.getByTestId("cert-HACCP").getByTestId("cert-state").textContent()) && (await lx.getByTestId("paused-banner").count()) === 0 && (await lx.getByTestId("badge-preview").count()) === 1);
await shot(lx, "p28-06-supplier-valid");

// ── 4. Customer: badges, filter, supplier panel ──
await go(owner, "/buy/catalogue/suppliers");
await owner.getByTestId("badge-filter").getByRole("link", { name: /HACCP/ }).click();
await settle(owner);
check("badge filter keeps Lisboa Central", owner.url().includes("badge=HACCP") && (await main(owner)).includes("Lisboa Central"));
check("supplier card shows the badge", (await owner.getByTestId("verified-badges").count()) >= 1);
await shot(owner, "p28-07-customer-filter");
check("API badge filter works", lxItems(await catalogue(owner, "mozzarella", "HACCP")).length > 0 && lxItems(await catalogue(owner, "mozzarella", "HALAL")).length === 0);
await go(owner, `/buy/catalogue/offers/${item.offerId}`);
check("product page shows the verified panel", (await owner.getByTestId("verified-panel").count()) === 1);
await shot(owner, "p28-08-customer-product");

// ── 5. FIRINGI controls the badges ──
await go(sa, certPath);
await sa.getByTestId("toggle-badge").click();
check("badge hidden for this supplier", await until(async () => !((lxItems(await catalogue(owner))[0]?.vendor.badges ?? []).some((b) => b.key === "HACCP"))));
await sa.getByTestId("toggle-badge").click();
check("badge shown again", await until(async () => (lxItems(await catalogue(owner))[0]?.vendor.badges ?? []).some((b) => b.key === "HACCP")));
await go(sa, "/admin/vendors/compliance/types");
await sa.getByTestId("badge-switch-HACCP").click();
check("HACCP badge switched off for everyone", await until(async () => !((lxItems(await catalogue(owner))[0]?.vendor.badges ?? []).some((b) => b.key === "HACCP"))));
await sa.getByTestId("badge-switch-HACCP").click();
check("HACCP badge switched on again", await until(async () => (lxItems(await catalogue(owner))[0]?.vendor.badges ?? []).some((b) => b.key === "HACCP")));

// ── 6. Supplier detail, grace period, audit, daily job ──
await go(sa, "/admin/vendors/compliance/suppliers");
await sa.getByTestId("supplier-compliance").getByRole("link", { name: /Lisboa Central/ }).first().click();
await settle(sa);
check("supplier compliance page shows the certificate code", (await main(sa)).includes("1234-5678-9012"));
await sa.selectOption("#w-type", { label: "Halal" });
await sa.fill("#w-until", day(21));
await sa.fill("#w-reason", "Halal audit booked with the certification body");
await sa.getByRole("button", { name: "Grant grace period" }).click();
check("grace period granted", await until(async () => /Grace period granted/.test(await main(sa))));
await shot(sa, "p28-09-admin-supplier");
await go(sa, "/admin/vendors/compliance/audit");
const audit = await main(sa);
check("audit shows upload, approval, badge and waiver decisions", ["certificate uploaded", "certificate approved", "badge hidden", "waiver granted", "paused", "resumed"].every((a) => audit.includes(a)));
await shot(sa, "p28-10-admin-audit");
const cron = await sa.request.post(`${BASE}/api/cron/compliance`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET ?? "test-cron-secret-0123456789abcdef"}` } });
check("daily compliance job runs", cron.status() === 200, String(cron.status()));

// ── 7. Phone width ──
const phone = await login("owner@lisboacentral.test", { ...devices["iPhone 13"] });
for (const u of ["/vendor/company/compliance"]) {
  await go(phone, u);
  const over = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(`phone: ${u} fits the screen`, over <= 1, `overflow ${over}px`);
}
await shot(phone, "p28-11-phone-supplier");
const phoneBuyer = await login("owner@kebabhouse.test", { ...devices["iPhone 13"] });
await go(phoneBuyer, "/buy/catalogue/suppliers?badge=HACCP");
check("phone: badge filter fits the screen", (await phoneBuyer.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 1);
await shot(phoneBuyer, "p28-12-phone-customer");

// ── 8. Leave things as they were: HACCP optional again ──
check("HACCP back to optional", await setHaccp(sa, { required: false }));

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
