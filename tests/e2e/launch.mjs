/**
 * Browser test of Phase 33 — launch readiness & pilot:
 * FIRINGI — Launch Readiness (verdict, sections, "must fix" items with links), launch settings (legal
 * links, support e-mail, pilot on), Company Settings (edit FIRINGI's invoicing details), Pilot & invites
 * (create a link-only invitation, revoke another); public registration during the pilot (closed without an
 * invitation, refused with a bad one, opens with a good one: business and e-mail filled in, terms and
 * privacy links), the invited business registers, the invitation shows "Used"; the pilot banner for a
 * customer (phone, dark); pilot off → open registration again.
 *   node tests/e2e/launch.mjs [baseUrl] [screenshotDir]
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
const settle = async (p) => { await p.waitForLoadState("networkidle").catch(() => {}); await p.waitForTimeout(400); };
const go = async (p, url) => { await p.goto(`${BASE}${url}`); await settle(p); };
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn().catch(() => false)) return true; await new Promise((r) => setTimeout(r, 250)); } return false; };
const errors = [];
const watch = (page, who) => page.on("pageerror", (e) => errors.push(`${who} @ ${page.url().replace(BASE, "")}: ${e.message.slice(0, 140)}`));
async function login(email, { viewport = { width: 1280, height: 900 }, colorScheme = "light" } = {}) {
  const ctx = await browser.newContext({ viewport, colorScheme, reducedMotion: "reduce", deviceScaleFactor: SHOTS ? 2 : 1 });
  const page = await ctx.newPage();
  watch(page, email);
  await go(page, "/login");
  await page.fill("#email", email); await page.fill("#password", PASSWORD); await page.click("button[type=submit]");
  await page.waitForURL((u) => u.pathname !== "/login", { timeout: 15000 }).catch(() => {});
  await settle(page);
  return page;
}
async function anonymous(locale = "pt-PT", opts = {}) {
  const ctx = await browser.newContext({ locale, extraHTTPHeaders: { "Accept-Language": locale }, reducedMotion: "reduce", deviceScaleFactor: SHOTS ? 2 : 1, ...opts });
  const page = await ctx.newPage();
  watch(page, "visitor");
  return page;
}
const text = (p, id) => p.getByTestId(id).textContent();
const state = (p, key) => p.getByTestId(`check-${key}`).getAttribute("data-state");

const base8 = String(52000000 + Math.floor(Math.random() * 8000000));
const sum = [...base8].reduce((a, d, i) => a + Number(d) * (9 - i), 0);
const nif = base8 + ((11 - (sum % 11)) >= 10 ? 0 : 11 - (sum % 11));
const stamp = Date.now();
const invitedEmail = `piloto.${stamp}@tasca.pt`, invitedName = `Tasca Piloto ${stamp}`;

const sa = await login("superadmin@firingi.test");

// ── 1. Launch Readiness ──
await go(sa, "/admin/settings/launch");
check("readiness: verdict and sections (English)", /Not ready to launch|Ready for a pilot|Ready to launch/.test(await text(sa, "verdict-badge")) && (await sa.getByTestId("section-company").count()) === 1 && (await sa.getByTestId("section-marketplace").count()) === 1);
check("this demo setup is not ready (demo data, no legal links)", /Not ready/.test(await text(sa, "verdict-badge")) && (await state(sa, "demo")) === "fail" && (await state(sa, "terms")) === "fail");
check("each problem links to the page that fixes it", (await sa.getByTestId("check-terms").locator("a").count()) === 1 && (await sa.getByTestId("check-demo").locator("a").getAttribute("href")).startsWith("/admin/"));
await shot(sa, "launch-01-readiness");

await sa.locator("#lc-termsUrl").fill("https://firingi.pt/termos");
await sa.locator("#lc-privacyUrl").fill("https://firingi.pt/privacidade");
await sa.locator("#lc-supportEmail").fill("piloto@firingi.pt");
await sa.getByTestId("pilot-on").check();
await sa.getByTestId("launch-save").click();
check("launch settings saved", await until(async () => /Saved/.test(await text(sa, "launch-settings"))));
await go(sa, "/admin/settings/launch");
check("terms, privacy and support now OK", (await state(sa, "terms")) === "pass" && (await state(sa, "privacy")) === "pass" && (await state(sa, "support")) === "pass");
check("registration: pilot, by invitation only", /invitation only/.test(await text(sa, "check-pilot")));

// ── 2. Company Settings: FIRINGI's invoicing details ──
await go(sa, "/admin/settings/company");
const pt = sa.getByTestId("entity-PT");
const phone = pt.locator("input[id$='-phone']");
const oldPhone = await phone.inputValue();
await phone.fill("+351 210 999 999");
await pt.getByTestId("entity-save").click();
check("FIRINGI's invoicing details edited", await until(async () => /Saved/.test(await pt.textContent())));
check("tax number locked once invoices exist", await pt.locator("input[id$='-taxId']").isDisabled());
await shot(sa, "launch-02-company");
await phone.fill(oldPhone || "+351 210 000 000");
await pt.getByTestId("entity-save").click();
await until(async () => /Saved/.test(await pt.textContent()));

// ── 3. Pilot & invites ──
await go(sa, "/admin/settings/launch/pilot");
check("pilot is on", /Pilot is ON/.test(await text(sa, "pilot-state")));
await sa.locator("#inv-company").fill(invitedName);
await sa.locator("#inv-email").fill(invitedEmail);
await sa.locator("#inv-country").selectOption("PT");
await sa.locator("#inv-type").selectOption("CUSTOMER");
await sa.locator("#inv-note").fill("Conhecido na feira Horexpo");
await sa.getByTestId("invite-link-only").click();
check("invitation link created", await until(async () => (await sa.getByTestId("invite-new-link").count()) === 1));
const link = (await sa.getByTestId("invite-new-link").locator("code").textContent()).trim();
const code = new URL(link).searchParams.get("invite");
check("link opens the customer form with the code", /\/register\/customer\?invite=[A-Z0-9]{12}$/.test(link), link);
await sa.locator("#inv-company").fill(`Café Revogar ${stamp}`);
await sa.locator("#inv-email").fill(`revogar.${stamp}@cafe.pt`);
await sa.getByTestId("invite-link-only").click();
await until(async () => (await sa.getByTestId("invites-table").textContent()).includes(`Café Revogar ${stamp}`));
await go(sa, "/admin/settings/launch/pilot");
const revRow = sa.getByTestId("invites-table").locator("tr", { hasText: `Café Revogar ${stamp}` }).first();
await revRow.getByTestId("invite-revoke").click();
check("an invitation revoked", await until(async () => /Revoked/.test(await sa.getByTestId("invites-table").locator("tr", { hasText: `Café Revogar ${stamp}` }).first().textContent())));
await shot(sa, "launch-03-pilot");

// ── 4. Registration during the pilot ──
const v = await anonymous("pt-PT");
await go(v, "/register");
check("register page says: by invitation", (await v.getByTestId("pilot-note").count()) === 1 && /piloto@firingi.pt/.test(await text(v, "pilot-note")));
await go(v, "/register/customer");
check("no invitation → no form, told why (Portuguese)", (await v.getByTestId("pilot-closed").count()) === 1 && (await v.locator("#legalName").count()) === 0 && /convite/i.test(await text(v, "pilot-closed")));
await go(v, "/register/customer?invite=ZZZZZZZZZZZZ");
check("bad invitation → refused", /não é válido/.test(await text(v, "pilot-reason")));
await go(v, `/register/customer?invite=${code}`);
check("good invitation → form, business and e-mail filled in", (await v.getByTestId("invite-note").count()) === 1 && (await v.locator("#legalName").inputValue()) === invitedName && (await v.locator("#ownerEmail").inputValue()) === invitedEmail);
const terms = v.getByTestId("terms-text").locator("a");
check("terms and privacy links on the form", (await terms.count()) === 2 && (await terms.first().getAttribute("href")) === "https://firingi.pt/termos");
await v.fill("#taxId", nif);
await v.fill("#companyEmail", invitedEmail);
await v.fill("#phone", "+351 912 345 678");
await v.fill("#line1", "Rua dos Fanqueiros 12");
await v.selectOption("#city", { label: "Lisboa" });
await v.fill("#postalCode", "1100-231");
await v.fill("#ownerName", "Zé Piloto");
await v.fill("#password", "Password123!");
await v.check('input[name="acceptTerms"]');
await v.check('input[name="businessDeclaration"]');
await v.evaluate(() => window.scrollTo(0, 0));
await shot(v, "launch-04-register-invite");
await v.click('button[type="submit"]');
await v.waitForURL("**/application-status", { timeout: 20000 }).catch(() => {});
check("invited business registered", v.url().endsWith("/application-status"), v.url());
await v.context().close();
const v2 = await anonymous("pt-PT");
await go(v2, `/register/customer?invite=${code}`);
check("the invitation can't be used twice", /já foi usado/.test(await text(v2, "pilot-reason")));
await v2.context().close();
await go(sa, "/admin/settings/launch/pilot");
check("invitation shows Used and the new company", /Used/.test(await sa.getByTestId("invites-table").locator("tr", { hasText: invitedName }).first().textContent()));

// ── 5. Pilot banner for customers (phone, dark) ──
const kp = await login("owner@kebabhouse.test", { viewport: { width: 390, height: 844 }, colorScheme: "dark" });
await go(kp, "/buy");
check("customer sees the pilot banner (Portuguese)", (await kp.getByTestId("pilot-banner").count()) === 1 && /primeiros utilizadores/.test(await text(kp, "pilot-banner")));
const overflow = await kp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check("phone width: no sideways scrolling", overflow <= 1, `${overflow}px`);
await shot(kp, "launch-05-banner-phone-dark");
await go(sa, "/admin");
check("FIRINGI staff don't see the banner", (await sa.getByTestId("pilot-banner").count()) === 0);
const sp = await login("superadmin@firingi.test", { viewport: { width: 390, height: 844 }, colorScheme: "dark" });
await go(sp, "/admin/settings/launch");
const over2 = await sp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check("readiness on a phone: no sideways scrolling", over2 <= 1, `${over2}px`);
await shot(sp, "launch-06-readiness-phone-dark");

// ── 6. Pilot off → open again ──
await go(sa, "/admin/settings/launch");
await sa.getByTestId("pilot-on").uncheck();
await sa.getByTestId("launch-save").click();
await until(async () => /Saved/.test(await text(sa, "launch-settings")));
const v3 = await anonymous("pt-PT");
await go(v3, "/register/customer");
check("pilot off: the form is open to everyone", (await v3.locator("#legalName").count()) === 1 && (await v3.getByTestId("pilot-closed").count()) === 0);
await v3.context().close();
await go(kp, "/buy");
check("pilot off: banner gone", (await kp.getByTestId("pilot-banner").count()) === 0);

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nall launch checks passed");
process.exit(failures ? 1 : 0);
