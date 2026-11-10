/**
 * Browser test of Phase 11 against a running server with the demo seed:
 *  1. Two-factor login: turn on with an authenticator app (TOTP computed here), sign in with a
 *     code and with a backup code, required-by-policy redirect, sessions, turn off again.
 *  2. SAF-T page and download.
 *  3. Data privacy, payments and settings pages (added as they are built).
 *   node tests/e2e/go-live.mjs [baseUrl] [screenshotDir]
 */
import { createHmac } from "node:crypto";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");

const BASE = process.argv[2] ?? "http://localhost:3000";
const SHOTS = process.argv[3] ?? null;
const PASSWORD = process.env.SEED_PASSWORD ?? "Firingi!2026";
let failures = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "✔" : "✘"} ${name}${extra ? ` — ${extra}` : ""}`); if (!ok) failures++; };
const shot = async (page, name, full = true) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: full });
const browser = await chromium.launch();
const settle = async (p) => { await p.waitForLoadState("networkidle"); await p.waitForTimeout(500); };
const go = async (p, url) => { await p.goto(`${BASE}${url}`); await settle(p); };
const errors = [];

/** RFC 6238 TOTP (SHA-1, 30 s, 6 digits) from a base32 key. */
function totp(key, at = Date.now()) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of key.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
  const bytes = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30000)));
  const h = createHmac("sha1", bytes).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

async function newPage() {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 950 } })).newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  return page;
}
async function login(email, code) {
  const page = await newPage();
  await go(page, "/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await settle(page);
  if (code) {
    await page.getByTestId("two-factor-step").waitFor();
    await page.fill("#code", typeof code === "function" ? code() : code);
    await page.click("button[type=submit]");
    await settle(page);
  }
  return page;
}

// ── 1. Two-factor login ──
const USER = "sales@firingi.test";
const sa = await login("superadmin@firingi.test");
let u = await login(USER);
await go(u, "/admin/me/security");
check("security page reachable from the user's name", (await u.getByTestId("my-security").getAttribute("href")) === "/admin/me/security");
await u.fill('input[name="password"]', PASSWORD);
await u.getByRole("button", { name: /^(Turn on|Ativar)$/ }).click();
await u.getByTestId("two-factor-setup").waitFor();
const key = (await u.getByTestId("totp-key").textContent()).trim();
const backup = (await u.getByTestId("backup-codes").locator("li").allTextContents()).map((s) => s.trim());
check("setup shows QR key and 10 backup codes", key.length >= 16 && backup.length === 10);
await shot(u, "p11-01-two-factor-setup");
await u.fill('input[name="totp"]', totp(key));
await u.getByRole("button", { name: /Verify and turn on|Verificar e ativar/ }).click();
await settle(u);
check("two-factor login turned on", (await u.getByTestId("two-factor-on").count()) === 1);

const withCode = await login(USER, () => totp(key));
check("sign in asks for the code and accepts it", withCode.url().includes("/admin"), withCode.url());
const badPage = await newPage();
await go(badPage, "/login");
await badPage.fill("#email", USER); await badPage.fill("#password", PASSWORD); await badPage.click("button[type=submit]");
await badPage.getByTestId("two-factor-step").waitFor();
await badPage.fill("#code", "000000"); await badPage.click("button[type=submit]"); await settle(badPage);
check("a wrong code is refused", (await badPage.textContent("form")).includes("That code didn't work") || (await badPage.textContent("form")).includes("não funcionou"));
await badPage.getByRole("button", { name: /backup|recuperação/i }).click();
await badPage.fill("#code", backup[0]); await badPage.click("button[type=submit]"); await settle(badPage);
check("a backup code works once", badPage.url().includes("/admin"), badPage.url());

await go(u, "/admin/me/security");
const rows = await u.getByTestId("sessions").locator("li").count();
check("sessions list shows every signed-in device", rows >= 3, String(rows));
await u.getByRole("button", { name: /Sign out all other devices|Terminar sessão em todos os outros dispositivos/ }).click();
await settle(u);
await go(withCode, "/admin");
check("other devices are signed out", withCode.url().includes("/login"), withCode.url());

// back office overview + policy redirect (Super Admin must use two-factor first)
await go(sa, "/admin/settings/security");
check("security settings list two-factor status", (await sa.getByTestId("security-user").filter({ hasText: USER }).textContent()).includes("On"));
await sa.locator('input[name="requireTwoFactorStaff"]').check();
await sa.getByTestId("security-policy").getByRole("button", { name: "Save" }).click();
await settle(sa);
check("can't require it before using it yourself", (await sa.getByTestId("security-policy").textContent()).includes("for yourself first"));
await sa.waitForTimeout(11000); // better-auth rate-limits two-factor calls (a few per 10 s per IP)
await go(sa, "/admin/me/security");
await sa.fill('input[name="password"]', PASSWORD);
await sa.getByRole("button", { name: /^(Turn on|Ativar)$/ }).click();
await sa.getByTestId("two-factor-setup").waitFor();
const saKey = (await sa.getByTestId("totp-key").textContent()).trim();
await sa.fill('input[name="totp"]', totp(saKey));
await sa.getByRole("button", { name: /Verify and turn on|Verificar e ativar/ }).click();
await settle(sa);
await go(sa, "/admin/settings/security");
await sa.locator('input[name="requireTwoFactorStaff"]').check();
await sa.getByTestId("security-policy").getByRole("button", { name: "Save" }).click();
await settle(sa);
await shot(sa, "p11-02-security-settings");
const ops = await login("ops@firingi.test");
await go(ops, "/admin/orders/all");
check("staff without two-factor are sent to set it up", ops.url().includes("/admin/me/security?required=1") && (await ops.getByTestId("two-factor-required").count()) === 1, ops.url());
await go(sa, "/admin/settings/security");
await sa.locator('input[name="requireTwoFactorStaff"]').uncheck();
await sa.getByTestId("security-policy").getByRole("button", { name: "Save" }).click();
await settle(sa);
await go(ops, "/admin/orders/all");
check("policy off: no redirect", !ops.url().includes("/me/security"), ops.url());
await go(sa, "/admin/me/security");
await sa.fill('input[name="password"]', PASSWORD);
await sa.getByRole("button", { name: /^(Turn off|Desativar)$/ }).click();
await settle(sa);

// turn it off again (keeps other suites' logins simple)
await go(u, "/admin/me/security");
await u.fill('input[name="password"]', PASSWORD);
await u.getByRole("button", { name: /^(Turn off|Desativar)$/ }).click();
await settle(u);
check("two-factor login turned off", (await u.getByTestId("two-factor-on").count()) === 0);

// ── 2. SAF-T ──
await go(sa, "/admin/invoices/saft");
check("SAF-T page warns that the provider isn't certified", (await sa.getByTestId("not-certified").count()) === 1);
check("series check listed", (await sa.getByTestId("series-row").count()) > 0);
await shot(sa, "p11-03-saft");
const href = await sa.getByTestId("saft-download").getAttribute("href");
const res = await sa.request.get(`${BASE}${href}`);
const xml = await res.text();
check("SAF-T download is an XML audit file", res.status() === 200 && xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>') && xml.includes("<AuditFileVersion>1.04_01</AuditFileVersion>") && /filename="SAFT-PT_\d{9}_/.test(res.headers()["content-disposition"]));
check("customers can't download SAF-T", (await (await login("owner@kebabhouse.test")).request.get(`${BASE}${href}`)).status() === 403);

// ── 3. Data privacy ──
const buyer = await login("buyer@kebabhouse.test");
await go(buyer, "/buy/me/security");
const dl = await buyer.request.get(`${BASE}${await buyer.getByTestId("download-my-data").getAttribute("href")}`);
const mine = await dl.json();
check("download my data (JSON)", dl.status() === 200 && mine.account.email === "buyer@kebabhouse.test" && /attachment/.test(dl.headers()["content-disposition"]));
await buyer.fill('input[name="eraseReason"]', "e2e test");
await buyer.getByTestId("privacy-panel").getByRole("button").last().click();
await settle(buyer);
check("deletion request recorded", (await buyer.getByTestId("erasure-open").count()) === 1);
await shot(buyer, "p11-04-my-security");
await go(sa, "/admin/risk/data-privacy?status=REQUESTED");
const reqRow = sa.getByTestId("data-request").filter({ hasText: "buyer@kebabhouse.test" });
check("back office sees the request", (await reqRow.count()) === 1);
await reqRow.locator('input[name="erasureNote"]').fill("Test only — not deleted");
await reqRow.getByRole("button", { name: "Reject" }).click();
await settle(sa);
await go(buyer, "/buy/me/security");
check("the person sees FIRINGI's answer", (await buyer.getByTestId("erasure-rejected").textContent()).includes("Test only"));

// ── 4. Payments ──
await go(sa, "/admin/settings/payment");
check("payment settings page", (await sa.getByTestId("payment-policy").count()) === 1 && (await sa.locator('input[name="method-CARD"]').isDisabled()));
await go(sa, "/admin/risk/payment-risk");
check("payment risk lists buyers", (await sa.getByTestId("risk-row").count()) > 0);
await shot(sa, "p11-05-payment-risk");
const kebabOwner = await login("owner@kebabhouse.test");
await go(kebabOwner, "/buy/finance/invoices");
check("buyers see how to pay (IBAN)", (await kebabOwner.getByTestId("how-to-pay").textContent()).match(/PT\d{2}/) !== null);

// ── 5. Settings: notice on every portal ──
await go(sa, "/admin/settings/marketplace");
await sa.fill('textarea[name="notice"]', "Planned maintenance Sunday 22:00–23:00");
await sa.getByTestId("platform-settings").getByRole("button", { name: "Save" }).click();
await settle(sa);
const vendorPage = await login("owner@lisboacentral.test");
await go(vendorPage, "/vendor/orders/incoming");
check("notice shown on the vendor portal", (await vendorPage.getByTestId("platform-notice").textContent()).includes("Planned maintenance"));
await go(sa, "/admin/settings/marketplace");
await sa.fill('textarea[name="notice"]', "");
await sa.getByTestId("platform-settings").getByRole("button", { name: "Save" }).click();
await settle(sa);
for (const pg of ["orders", "vendors", "customers"]) {
  const r = await sa.goto(`${BASE}/admin/settings/${pg}`); await settle(sa);
  check(`/admin/settings/${pg} renders`, r.status() === 200 && (await sa.getByTestId("platform-settings").count()) === 1);
}

// ── 6. API key ──
await go(sa, "/admin/settings/api");
await sa.selectOption('select[name="apiCompany"]', { label: "Kebab House (customer)" });
await sa.fill('input[name="apiName"]', `e2e ${Date.now()}`);
await sa.locator('input[name="scope-orders.read"]').check();
await sa.locator('input[name="scope-catalogue.read"]').uncheck();
await sa.getByRole("button", { name: "Create key" }).click();
await sa.getByTestId("new-api-key").waitFor();
const apiKey = (await sa.getByTestId("api-key-value").textContent()).trim();
await shot(sa, "p11-06-api-keys");
const anon = await browser.newContext();
const ok = await anon.request.get(`${BASE}/api/v1/orders?as=buyer`, { headers: { authorization: `Bearer ${apiKey}` } });
const body = await ok.json();
check("API key reads the company's orders", ok.status() === 200 && Array.isArray(body.items ?? body.orders ?? body.rows));
const cat = await anon.request.get(`${BASE}/api/catalogue/offers?q=mozzarella`, { headers: { authorization: `Bearer ${apiKey}` } });
check("API key without catalogue scope can't read the catalogue", cat.status() === 403, String(cat.status()));
await go(sa, "/admin/settings/api");
await sa.getByRole("button", { name: "Done" }).click().catch(() => {});
sa.once("dialog", (d) => d.accept());
await sa.getByTestId("api-key-row").first().getByRole("button", { name: "Revoke" }).click();
await settle(sa);
const after = await anon.request.get(`${BASE}/api/v1/orders?as=buyer`, { headers: { authorization: `Bearer ${apiKey}` } });
check("revoked key is refused", after.status() === 401, String(after.status()));

check("no browser errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll go-live e2e checks passed");
process.exit(failures ? 1 : 0);
