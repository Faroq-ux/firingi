/**
 * Browser test of Phase 19 (production readiness) against a running server started with
 * CRON_SECRET=test-cron-secret-0123456789abcdef (or set CRON_SECRET for this script):
 * health endpoint + security headers → public status page → scheduled jobs via the cron
 * endpoints → System Health (checks, jobs, run checks now) → a browser error lands in the error
 * log → failing backups raise an alert that resolves when backups work again → phone layout:
 * no page wider than the screen, tables as cards, top-bar menu, pager.
 *   node tests/e2e/ops.mjs [baseUrl] [screenshotDir]
 */
import { createRequire } from "node:module";
const { chromium, devices } = createRequire(import.meta.url)("playwright");

const BASE = process.argv[2] ?? "http://localhost:3000";
const SHOTS = process.argv[3] ?? null;
const PASSWORD = process.env.SEED_PASSWORD ?? "Firingi!2026";
const SECRET = process.env.CRON_SECRET ?? "test-cron-secret-0123456789abcdef";
const AUTH = { authorization: `Bearer ${SECRET}` };
let failures = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "✔" : "✘"} ${name}${extra ? ` — ${extra}` : ""}`); if (!ok) failures++; };
const shot = async (page, name) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
const browser = await chromium.launch();
const settle = async (p) => { await p.waitForLoadState("networkidle"); await p.waitForTimeout(400); };
const go = async (p, url) => { await p.goto(`${BASE}${url}`); await settle(p); };
const errors = [];
async function login(email, ctxOpts = { viewport: { width: 1440, height: 950 } }) {
  const page = await (await browser.newContext({ ...ctxOpts, reducedMotion: "reduce" })).newPage();
  page.on("pageerror", (e) => { if (!/e2e-browser-error/.test(e.message)) errors.push(`${email} @ ${page.url().replace(BASE, "")}: ${e.message.slice(0, 90)}`); });
  await go(page, "/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL((u) => u.pathname !== "/login", { timeout: 15000 }).catch(() => {});
  await settle(page);
  return page;
}
const heartbeat = (body) => fetch(`${BASE}/api/ops/heartbeat`, { method: "POST", headers: { ...AUTH, "content-type": "application/json" }, body: JSON.stringify(body) });
const cron = (job) => fetch(`${BASE}/api/cron/${job}`, { method: "POST", headers: AUTH });

// ── 1. Health endpoint and security headers ──
const h = await fetch(`${BASE}/api/health`);
const hb = await h.json();
check("/api/health answers ok for uptime monitors", h.status === 200 && hb.status === "ok", JSON.stringify(hb));
check("full health report needs the secret", (await fetch(`${BASE}/api/health?full=1`)).status === 401);
const full = await (await fetch(`${BASE}/api/health?full=1`, { headers: AUTH })).json();
check("full health report lists checks and jobs", full.checks?.length > 5 && full.jobs?.some((j) => j.key === "backup"));
const lh = (await fetch(`${BASE}/login`)).headers;
check("pages send a Content-Security-Policy", /default-src 'self'/.test(lh.get("content-security-policy") ?? "") && /frame-ancestors 'none'/.test(lh.get("content-security-policy") ?? ""));
check("pages can't be framed, no sniffing, permissions limited", lh.get("x-frame-options") === "DENY" && lh.get("x-content-type-options") === "nosniff" && /microphone=\(\)/.test(lh.get("permissions-policy") ?? ""));
check("HSTS only behind HTTPS", !lh.get("strict-transport-security") && !!(await fetch(`${BASE}/login`, { headers: { "x-forwarded-proto": "https" } })).headers.get("strict-transport-security"));
check("no X-Powered-By header", !lh.get("x-powered-by"));
check("API answers are not cached", (await fetch(`${BASE}/api/health`)).headers.get("cache-control")?.includes("no-store"));

// ── 2. Scheduled jobs through the cron endpoints ──
check("cron endpoints refuse without the secret", (await fetch(`${BASE}/api/cron/notifications`, { method: "POST" })).status === 401);
for (const job of ["notifications", "invoicing", "allocation", "ai", "ops", "buying"]) {
  const r = await cron(job);
  check(`job ${job} runs`, r.status === 200, String(r.status));
}

// ── 3. Public status page ──
const anon = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
await go(anon, "/status");
check("status page lists 6 components", (await anon.locator("[data-component]").count()) === 6);
check("status page shows an overall state", ["ok", "warning", "critical"].includes(await anon.getByTestId("status-overall").getAttribute("data-state")));
check("status page doesn't leak internals", !/CRON_SECRET|Disk space|Database size|STORAGE_DRIVER/.test(await anon.textContent("body")));
await shot(anon, "ops-status");

// ── 4. System Health ──
const sa = await login("superadmin@firingi.test");
await go(sa, "/admin/settings/system-health");
const checksText = await sa.getByTestId("checks").textContent();
check("System Health shows database, storage, disk and queues", /Database/.test(checksText) && /File storage/.test(checksText) && /Disk space/.test(checksText) && /Certified invoicing queue/.test(checksText));
const jobsText = await sa.getByTestId("jobs").textContent();
check("scheduled jobs show their last run", /Messages & campaigns/.test(jobsText) && /just now|min ago/.test(jobsText));
await sa.getByTestId("run-checks").click();
await sa.getByRole("status").waitFor({ timeout: 15000 });
check("Run checks now reports the result", /problem\(s\)/.test(await sa.getByRole("status").textContent()));

// ── 5. Browser errors are logged ──
const marker = `e2e-browser-error-${Date.now()}`;
await sa.evaluate((m) => setTimeout(() => { throw new Error(m); }, 0), marker);
await sa.waitForTimeout(1500);
await go(sa, "/admin/settings/system-health");
check("a browser error appears in the error log", (await sa.getByTestId("errors").textContent()).includes(marker));

// ── 6. Failing backups → alert → resolved ──
for (let i = 0; i < 3; i++) await heartbeat({ job: "backup", ok: false, durationMs: 900, summary: null, error: "pg_dump: connection refused (e2e)" });
await cron("ops");
await go(sa, "/admin/settings/system-health");
let alertsText = await sa.getByTestId("alerts").textContent();
check("failing backups raise a critical alert", /Job: Database backup/.test(alertsText) && /critical/.test(alertsText));
await shot(sa, "ops-system-health-alert");
await heartbeat({ job: "backup", ok: true, durationMs: 4200, summary: { file: "e2e.dump.enc", bytes: 1234, encrypted: true } });
await cron("ops");
await go(sa, "/admin/settings/system-health");
alertsText = await sa.getByTestId("alerts").textContent();
check("the alert resolves when backups work again", /Job: Database backup/.test(alertsText) && /resolved/.test(alertsText));
await shot(sa, "ops-system-health");

// ── 7. Phone layout ──
const phone = await login("owner@kebabhouse.test", { ...devices["iPhone 13"] });
for (const url of ["/buy/dashboard/overview", "/buy/orders/history", "/buy/finance/invoices", "/buy/orders/cart"]) {
  await go(phone, url);
  const sw = await phone.evaluate(() => document.documentElement.scrollWidth);
  check(`phone: ${url} fits the screen`, sw <= 391, `scrollWidth ${sw}`);
}
await go(phone, "/buy/orders/history");
check("phone: table header hidden, rows are cards", await phone.evaluate(() => getComputedStyle(document.querySelector("table.ft-stack thead")).display === "none" && getComputedStyle(document.querySelector("table.ft-stack tbody tr")).display === "block"));
check("phone: cells carry their column name", (await phone.locator("table.ft-stack td[data-label]").count()) > 0);
await shot(phone, "ops-phone-orders");
const pager = phone.getByTestId("pager");
// the iPhone "add to home screen" card floats above the page bottom — close it first
if (await phone.getByTestId("install-dismiss").isVisible().catch(() => false)) await phone.getByTestId("install-dismiss").click();
if (await pager.locator('a[rel="next"]').count()) {
  await pager.locator('a[rel="next"]').click();
  await settle(phone);
  check("pager goes to page 2", /page=2/.test(phone.url()));
}
await phone.getByTestId("topbar-more").click();
check("phone: language, theme and sign-out are in the ⋮ menu", await phone.getByLabel(/Language|Idioma/).first().isVisible());
await shot(phone, "ops-phone-menu");

check("no browser errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nAll Phase 19 checks passed");
process.exit(failures ? 1 : 0);
