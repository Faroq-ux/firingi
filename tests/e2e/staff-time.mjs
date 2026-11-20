/**
 * Browser test of Phase 52 (staff shifts & time), as Kebab House's owner (manager) and its buyer (staff), FIRINGI
 * (English) and Lisboa Central (a supplier):
 *  the owner sets a staff member's role, hours, rate and clock PIN; plans a shift and publishes the week; the staff
 *  member clocks in at the kiosk with the PIN and is "in now"; clocks out; on the phone (dark) clocks in and out with
 *  the location; asks for leave; the owner corrects an entry with a reason, approves the week and exports payroll;
 *  approves the leave; FIRINGI's settings (switches, holidays) and FIRINGI's own staff pages; a supplier is sent to
 *  its own portal; a business switched off loses the pages; no page errors.
 *   node tests/e2e/staff-time.mjs [baseUrl] [screenshotDir]
 */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
const { chromium } = createRequire(import.meta.url)("playwright");

const DB = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/firingi";
const sql = (q) => execFileSync("psql", ["-At", DB, "-c", q], { encoding: "utf8" }).trim();
const BASE = process.argv[2] ?? "http://localhost:3000";
const SHOTS = process.argv[3] ?? null;
const PASSWORD = process.env.SEED_PASSWORD ?? "Firingi!2026";
let failures = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "✔" : "✘"} ${name}${extra ? ` — ${extra}` : ""}`); if (!ok) failures++; };
const shot = async (page, name, full = true) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: full });
const settle = async (p) => { await p.waitForLoadState("networkidle").catch(() => {}); await p.waitForFunction(() => !document.querySelector("[aria-busy=true]"), null, { timeout: 15000 }).catch(() => {}); await p.waitForTimeout(500); };
const go = async (p, url) => { await p.goto(`${BASE}${url}`); await settle(p); };
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn().catch(() => false)) return true; await new Promise((r) => setTimeout(r, 400)); } return false; };

const kebabId = sql(`select c.id from "Company" c join "Membership" m on m."companyId"=c.id join "User" u on u.id=m."userId" where u.email='owner@kebabhouse.test' limit 1`);
const staffUser = sql(`select id from "User" where email='buyer@kebabhouse.test'`);
const staffM = sql(`select id from "Membership" where "userId"='${staffUser}' and "companyId"='${kebabId}'`);
const savedPin = sql(`select "pinHash" from "PosPin" where "companyId"='${kebabId}' and "userId"='${staffUser}'`);
const site = sql(`select id || '|' || latitude || '|' || longitude from "Address" where "companyId"='${kebabId}' and "isActive" and latitude is not null order by "isDefault" desc limit 1`).split("|");
const PIN = "4826";
function clean() {
  for (const t of ["TimeEntry", "ShiftSwap", "StaffShift", "Timesheet", "LeaveRequest"]) sql(`delete from "${t}" where "companyId"='${kebabId}'`);
  sql(`delete from "StaffProfile" where "companyId"='${kebabId}'`);
}
function restore() {
  clean();
  sql(`delete from "Setting" where key='staff.settings'`);
  sql(`delete from "CompanyFeature" where key='STAFF_TIME'`);
  sql(`delete from "PosPin" where "companyId"='${kebabId}' and "userId"='${staffUser}'`);
  if (savedPin) sql(`insert into "PosPin" ("companyId", "userId", "pinHash", "updatedAt") values ('${kebabId}', '${staffUser}', '${savedPin}', now())`);
}
restore();
process.on("exit", restore);

const browser = await chromium.launch();
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

// ── 1. The owner sets up a staff member ──
const ow = await login("owner@kebabhouse.test");
await go(ow, "/buy/staff/people");
const person = ow.getByTestId("person").filter({ hasText: "buyer@kebabhouse.test" });
check("the owner sees the staff list", (await person.count()) === 1);
await person.getByTestId("profile-role").fill("Cozinheiro");
await person.getByTestId("profile-hours").fill("40");
await person.getByTestId("profile-rate").fill("9.5");
await person.getByTestId("profile-save").click();
check("…saves role, contract hours and rate", await until(async () => sql(`select role || '|' || "hourlyRate" from "StaffProfile" where "membershipId"='${staffM}'`) === "Cozinheiro|9.50"));
await person.getByTestId("pin-input").fill(PIN);
await person.getByTestId("pin-save").click();
check("…and the clock PIN", await until(async () => sql(`select count(*) from "PosPin" where "companyId"='${kebabId}' and "userId"='${staffUser}'`) === "1"));
await shot(ow, "p52-01-people");

// ── 2. Rota: a shift today, published ──
await go(ow, "/buy/staff/rota");
const today = new Date().toISOString().slice(0, 10);
const form = ow.getByTestId("shift-form");
await form.getByTestId("shift-day").selectOption(today);
await form.getByTestId("shift-person").selectOption(staffM);
await form.getByTestId("shift-start").fill("00:05");
await form.getByTestId("shift-end").fill("15:55");
await form.getByTestId("shift-break").fill("0");
await form.getByTestId("shift-save").click();
check("the owner adds a shift (draft)", await until(async () => sql(`select status from "StaffShift" where "companyId"='${kebabId}' and "membershipId"='${staffM}'`) === "DRAFT"));
await go(ow, "/buy/staff/rota");
check("…it is on the rota with a working-time warning (no break for a long shift)", (await ow.getByTestId("rota-shift").count()) >= 1 && (await ow.getByTestId("rota-warning").count()) >= 1);
await ow.getByTestId("rota-publish").click();
check("…published", await until(async () => sql(`select status from "StaffShift" where "companyId"='${kebabId}' and "membershipId"='${staffM}'`) === "PUBLISHED"));
await go(ow, "/buy/staff/rota");
await shot(ow, "p52-02-rota");

// ── 3. Kiosk ──
await go(ow, "/buy/staff/clock");
for (const d of PIN) await ow.getByTestId(`kiosk-${d}`).click();
await ow.getByTestId("kiosk-go").click();
check("the kiosk clocks the staff member in with the PIN", await until(async () => (await ow.getByTestId("kiosk-result").count()) === 1));
check("…an open entry from the kiosk", sql(`select source from "TimeEntry" where "membershipId"='${staffM}' and "clockOut" is null`) === "KIOSK");
await shot(ow, "p52-03-kiosk", false);
await go(ow, "/buy/staff");
check("…and is in now on the overview", (await ow.getByTestId("staff-in-count").innerText()).trim() === "1");
await shot(ow, "p52-04-overview");
await go(ow, "/buy/staff/clock");
for (const d of PIN) await ow.getByTestId(`kiosk-${d}`).click();
await ow.getByTestId("kiosk-go").click();
check("…the same PIN clocks out", await until(async () => sql(`select count(*) from "TimeEntry" where "membershipId"='${staffM}' and "clockOut" is null`) === "0"));
for (const d of "0000") await ow.getByTestId(`kiosk-${d}`).click();
await ow.getByTestId("kiosk-go").click();
check("…a wrong PIN is refused", await until(async () => (await ow.getByRole("alert").count()) >= 1));

// ── 4. The staff member on the phone (dark), with the location ──
const ph = await login("buyer@kebabhouse.test", { viewport: { width: 390, height: 844 }, colorScheme: "dark", isMobile: true, hasTouch: true, geolocation: { latitude: Number(site[1]), longitude: Number(site[2]) }, permissions: ["geolocation"] });
await go(ph, "/buy/staff/me");
check("the staff member sees My Shifts", (await ph.getByTestId("my-clock").count()) === 1 && (await ph.getByTestId("my-shifts").count()) === 1);
await ph.getByTestId("clock-in").click();
check("…clocks in from the phone at the shop", await until(async () => sql(`select source || '|' || coalesce("inDistanceM",-1) from "TimeEntry" where "membershipId"='${staffM}' and "clockOut" is null`).startsWith("PHONE|")));
const dist = Number(sql(`select "inDistanceM" from "TimeEntry" where "membershipId"='${staffM}' and "clockOut" is null`));
check("…within the allowed distance", dist >= 0 && dist < 150, `${dist} m`);
await go(ph, "/buy/staff/me");
await ph.getByTestId("break-start").click();
check("…starts a break", await until(async () => (await ph.getByTestId("break-end").count()) === 1));
await ph.getByTestId("break-end").click();
await settle(ph);
await ph.getByTestId("clock-out").click();
check("…clocks out", await until(async () => sql(`select count(*) from "TimeEntry" where "membershipId"='${staffM}' and "clockOut" is null`) === "0"));
const lf = ph.getByTestId("leave-form");
const d1 = new Date(Date.now() + 21 * 86400000).toISOString().slice(0, 10), d2 = new Date(Date.now() + 23 * 86400000).toISOString().slice(0, 10);
await lf.getByTestId("leave-from").fill(d1);
await lf.getByTestId("leave-to").fill(d2);
await lf.getByTestId("leave-send").click();
check("…asks for leave", await until(async () => sql(`select status from "LeaveRequest" where "membershipId"='${staffM}'`) === "PENDING"));
await go(ph, "/buy/staff/me");
check("phone: the page fits the screen", !(await ph.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2)));
await shot(ph, "p52-05-phone-my-shifts");
await go(ph, "/buy/staff/timesheets");
check("staff can't open the managers' timesheets (sent to My Shifts)", ph.url().includes("/buy/staff/me"));

// ── 5. Timesheet: correction with a reason, approval, export ──
await go(ow, "/buy/staff/timesheets");
const row = ow.getByTestId("sheet-row").filter({ hasText: "Cozinheiro" });
check("the owner sees the week's hours", (await row.count()) === 1);
await row.getByTestId("entry-edit").first().click();
const ef = row.getByTestId("entry-form");
await ef.getByTestId("entry-in").fill("00:00");
await ef.getByTestId("entry-out").fill("00:30");
await ef.getByTestId("entry-reason").fill("Esqueceu-se de picar — confirmado");
await ef.getByTestId("entry-save").click();
check("…corrects an entry with a reason (kept, flagged)", await until(async () => sql(`select count(*) from "TimeEntry" where "membershipId"='${staffM}' and 'EDITED' = any(flags) and "editReason" like 'Esqueceu%'`) === "1"));
await go(ow, "/buy/staff/timesheets");
await shot(ow, "p52-06-timesheets");
await ow.getByTestId("sheet-row").filter({ hasText: "Cozinheiro" }).getByTestId("sheet-approve").click();
check("…approves the week", await until(async () => sql(`select status from "Timesheet" where "membershipId"='${staffM}'`) === "APPROVED"));
const csv = await ow.request.get(`${BASE}/api/staff/export?kind=PAYROLL&from=${today.slice(0, 8)}01&to=${today}`);
const csvText = await csv.text();
check("…exports payroll (CSV)", csv.ok() && csvText.includes("Payroll code") && csvText.includes("Cozinheiro"));
const rec = await ow.request.get(`${BASE}/api/staff/export?kind=RECORD&from=${today.slice(0, 8)}01&to=${today}`);
check("…and the legal time record with the correction", rec.ok() && (await rec.text()).includes("Esqueceu"));
const anon = await (await browser.newContext()).request.get(`${BASE}/api/staff/export?kind=PAYROLL&from=${today}&to=${today}`);
check("the export needs a login", !anon.ok() || !(await anon.text()).includes("Payroll code"));

// ── 6. Leave approved ──
await go(ow, "/buy/staff/leave");
await ow.getByTestId("leave-row").first().getByTestId("leave-approve").click();
check("the owner approves the leave", await until(async () => sql(`select status from "LeaveRequest" where "membershipId"='${staffM}'`) === "APPROVED"));
await shot(ow, "p52-07-leave");

// ── 7. FIRINGI ──
const sa = await login("superadmin@firingi.test");
await go(sa, "/admin/settings/staff-time");
check("FIRINGI's Staff & Time settings", (await sa.getByTestId("ss-form").count()) === 1);
await sa.getByTestId("holidays-fill").click();
check("…fills Portugal's public holidays", await until(async () => Number(sql(`select count(*) from "PublicHoliday" p join "Country" c on c.id=p."countryId" where c.code='PT' and extract(year from p.date)=${today.slice(0, 4)}`)) >= 13));
await go(sa, "/admin/settings/staff-time");
await shot(sa, "p52-08-admin-settings");
await go(sa, "/admin/staff/me");
check("FIRINGI's own staff: My Shifts in the back office", (await sa.getByTestId("my-week").count()) === 1);
await go(sa, "/admin/staff");
check("…and Who's In for FIRINGI's managers", (await sa.getByTestId("staff-in-now").count()) === 1);

// ── 8. A supplier is sent to its own portal; a business switched off ──
const lx = await login("owner@lisboacentral.test");
await go(lx, "/buy/staff");
check("a wholesaler opening /buy/staff lands in the supplier portal", lx.url().includes("/vendor/staff"));
check("…its overview opens", (await lx.getByTestId("staff-in-now").count()) === 1);
sql(`insert into "CompanyFeature" ("companyId", key, enabled, "updatedAt") values ('${kebabId}', 'STAFF_TIME', false, now()) on conflict do nothing`);
await go(ph, "/buy/staff/me");
check("a business switched off loses Staff & Time", (await ph.getByTestId("staff-closed").count()) === 1);
sql(`delete from "CompanyFeature" where key='STAFF_TIME' and "companyId"='${kebabId}'`);

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nAll staff & time checks passed");
process.exit(failures ? 1 : 0);
