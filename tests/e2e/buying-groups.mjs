/**
 * Browser test of Phase 49 (buying groups), as the customer Kebab House, FIRINGI staff (English), the wholesaler
 * Cash & Carry Almada (a member buying from distributors) and the supplier Lisboa Central:
 *  Kebab House starts a group → FIRINGI sees it waiting and approves it → Kebab invites Almada by NIF → Almada
 *  accepts → Lisboa Central gives the group 5 % off (group prices) → the members see the supplier's prices on
 *  the group page → Kebab opens a group order with Lisboa Central, adds a product, sees the group's totals; the
 *  wholesaler (it buys from distributors) is told it can't add to it →
 *  the report → phone & dark → FIRINGI settings and a per-business switch → Kebab cancels the group order →
 *  no page errors.
 *   node tests/e2e/buying-groups.mjs [baseUrl] [screenshotDir]
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

const stamp = Date.now().toString(36).slice(-5).toUpperCase();
const NAME = `E2E Restaurantes ${stamp}`;
const lxId = sql(`select id from "Company" where "legalName"='Grossista Lisboa Central, Lda'`);
const kebabId = sql(`select c.id from "Company" c join "Membership" m on m."companyId"=c.id join "User" u on u.id=m."userId" where u.email='owner@kebabhouse.test' limit 1`);
const almada = sql(`select id || '|' || "taxId" from "Company" where "legalName"='Cash & Carry Almada, Lda'`).split("|");
const savedSettings = sql(`select value::text from "Setting" where key='groups.settings' and scope='GLOBAL'`);
const E2E = `(select id from "BuyingGroup" where name like 'E2E %')`;
function cleanup() {
  sql(`delete from "PriceList" where "targetGroupId" in (select id from "CustomerGroup" where "buyingGroupId" in ${E2E})`);
  sql(`delete from "CustomerGroup" where "buyingGroupId" in ${E2E}`);
  sql(`delete from "BuyingGroup" where name like 'E2E %'`);
  sql(`delete from "CompanyFeature" where key='BUYING_GROUPS' and "companyId" in ('${kebabId}', '${almada[0]}')`);
  sql(`delete from "Setting" where key='groups.settings'`);
  if (savedSettings) sql(`insert into "Setting" (id, scope, "scopeId", key, value, "updatedAt") values ('e2e-groups', 'GLOBAL', '', 'groups.settings', '${savedSettings.replace(/'/g, "''")}'::jsonb, now())`);
}
cleanup();
sql(`delete from "BuyingGroupMember" where "companyId" in ('${kebabId}', '${almada[0]}') and "groupId" in (select id from "BuyingGroup" where status <> 'CLOSED')`);
process.on("exit", cleanup);

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

// ── 1. Kebab House starts a group ──
const kb = await login("owner@kebabhouse.test");
await go(kb, "/buy/groups");
check("customer's Buying Groups page with the start form", (await kb.getByTestId("bg-create").count()) === 1);
await kb.fill("#bg-name", NAME);
await kb.getByTestId("bg-create-btn").click();
check("group started → its page, waiting for FIRINGI", await until(async () => /\/buy\/groups\/[a-z0-9]+$/.test(kb.url()) && (await kb.getByTestId("bg-status").count()) === 1));
await settle(kb);
const groupId = kb.url().split("/").pop();
check("…saved as PENDING with Kebab as its admin", sql(`select g.status || ':' || m.role from "BuyingGroup" g join "BuyingGroupMember" m on m."groupId"=g.id and m."companyId"='${kebabId}' where g.id='${groupId}'`) === "PENDING:ADMIN");

// ── 2. FIRINGI approves ──
const sa = await login("superadmin@firingi.test");
await go(sa, "/admin/customers/buying-groups");
const row = sa.getByTestId("bg-pending-row").filter({ hasText: NAME });
check("FIRINGI sees the group waiting", (await row.count()) === 1);
await shot(sa, "p49-01-admin-buying-groups");
await row.getByTestId("bg-approve").click();
check("FIRINGI approves it", await until(async () => sql(`select status from "BuyingGroup" where id='${groupId}'`) === "APPROVED"));

// ── 3. Invite Almada by NIF; Almada accepts ──
await go(kb, `/buy/groups/${groupId}`);
await kb.fill("#bg-tax", almada[1]);
await kb.getByTestId("bg-invite-btn").click();
check("invitation sent by NIF", await until(async () => sql(`select status from "BuyingGroupMember" where "groupId"='${groupId}' and "companyId"='${almada[0]}'`) === "INVITED"));
const al = await login("owner@ccalmada.test");
await go(al, "/buy/groups");
const inv = al.getByTestId("bg-invite-row").filter({ hasText: NAME });
check("the wholesaler sees the invitation", (await inv.count()) === 1);
await shot(al, "p49-02-invitation");
await inv.getByTestId("bg-accept").click();
check("…and joins", await until(async () => sql(`select status from "BuyingGroupMember" where "groupId"='${groupId}' and "companyId"='${almada[0]}'`) === "ACTIVE"));

// ── 4. The supplier gives group prices ──
const lx = await login("owner@lisboacentral.test");
await go(lx, "/vendor/products/buying-groups");
const vg = lx.getByTestId("bg-vendor-group").filter({ hasText: NAME });
check("the supplier sees the approved group", (await vg.count()) === 1);
await vg.getByTestId("bg-set-prices").locator("summary").click();
await vg.getByTestId("bg-pct").fill("5");
await vg.getByTestId("bg-prices-save").click();
check("5 % off its base prices for the group", await until(async () => Number(sql(`select count(*) from "PriceListItem" i join "PriceList" p on p.id=i."priceListId" join "CustomerGroup" g on g.id=p."targetGroupId" where g."buyingGroupId"='${groupId}' and p."isActive"`)) > 0));
check("…the members are in the supplier's price group", sql(`select count(*) from "CustomerGroupMember" m join "CustomerGroup" g on g.id=m."groupId" where g."buyingGroupId"='${groupId}'`) === "2");
await go(lx, "/vendor/products/buying-groups");
check("…shown as the group's current prices", (await lx.getByTestId("bg-vendor-group").filter({ hasText: NAME }).getByTestId("bg-current").count()) === 1);
await shot(lx, "p49-03-supplier-group-prices");

// ── 5. A group order ──
await go(kb, `/buy/groups/${groupId}`);
check("members see the supplier's group prices", (await kb.getByTestId("bg-prices").filter({ hasText: "Lisboa Central" }).count()) === 1);
check("both members listed", (await kb.getByTestId("bg-member").count()) === 2);
await kb.selectOption("#bg-seller", lxId);
await kb.fill("#bg-rtitle", "Entrega de sexta");
await shot(kb, "p49-04-group-page");
await kb.getByTestId("bg-round-open").click();
check("group order opened → its page", await until(async () => /\/rounds\/[a-z0-9]+$/.test(kb.url())));
await settle(kb);
const roundId = kb.url().split("/").pop();
check("…open, with Lisboa Central", sql(`select status || ':' || "sellerCompanyId" from "GroupOrderRound" where id='${roundId}'`) === `OPEN:${lxId}`);
await until(async () => (await kb.getByTestId("bg-offer").count()) > 0);
await kb.getByTestId("bg-offer-add").first().click();
check("a product added to my lines", await until(async () => (await kb.getByTestId("bg-my-line").count()) === 1));
check("…and in the group's totals", await until(async () => (await kb.getByTestId("bg-totals").locator("tbody tr").count()) === 1));
await shot(kb, "p49-05-group-order");

// the wholesaler buys from distributors, not from Lisboa Central: it is told, and can't add
await go(al, `/buy/groups/${groupId}/rounds/${roundId}`);
check("a member that can't buy from this supplier is told so", (await al.getByTestId("bg-not-for-you").count()) === 1 && (await al.getByTestId("bg-offer-search").count()) === 0);
check("…it still sees the group's totals", (await al.getByTestId("bg-totals").locator("tbody tr").count()) === 1);

// ── 6. Report, phone, dark ──
await go(kb, `/buy/groups/${groupId}?period=YEAR`);
check("the group report (group admin sees each member)", (await kb.getByTestId("bg-report").count()) === 1 && (await kb.getByTestId("bg-by-member").locator("tbody tr").count()) === 2);
const phone = await login("owner@kebabhouse.test", { viewport: { width: 390, height: 844 }, colorScheme: "dark", isMobile: true, hasTouch: true });
for (const [url, name] of [[`/buy/groups/${groupId}`, "p49-06-group-phone-dark"], [`/buy/groups/${groupId}/rounds/${roundId}`, "p49-07-group-order-phone-dark"], ["/buy/groups", null]]) {
  await go(phone, url);
  const o = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(`phone: ${url.replace(groupId, ":id").replace(roundId, ":round")} fits`, o <= 1, `${o}px`);
  if (name) await shot(phone, name);
}
const vphone = await login("owner@lisboacentral.test", { viewport: { width: 390, height: 844 }, colorScheme: "dark", isMobile: true, hasTouch: true });
await go(vphone, "/vendor/products/buying-groups");
check("phone: the supplier's page fits", (await vphone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 1);

// ── 7. FIRINGI's settings, group page, a per-business switch ──
await go(sa, `/admin/customers/buying-groups/${groupId}`);
check("FIRINGI's group page: members and group orders", (await sa.getByTestId("bg-member").count()) === 2 && (await sa.getByTestId("bg-rounds").count()) === 1);
await shot(sa, "p49-08-admin-group");
await go(sa, "/admin/customers/buying-groups/settings");
check("settings form", (await sa.getByTestId("bs-form").count()) === 1);
await sa.getByTestId("bg-find").fill("Almada");
await until(async () => (await sa.getByTestId("bg-find-hits").count()) === 1);
await sa.getByTestId("bg-find-hits").getByTestId("bg-switch").first().selectOption("OFF");
check("a business switched off on its own", await until(async () => sql(`select enabled from "CompanyFeature" where key='BUYING_GROUPS' and "companyId"='${almada[0]}'`) === "f"));
await shot(sa, "p49-09-admin-settings");
await go(al, "/buy/groups");
check("…it's told buying groups aren't open for it", (await al.getByTestId("bg-closed").count()) === 1);

// ── 8. Kebab cancels the group order ──
await go(kb, `/buy/groups/${groupId}/rounds/${roundId}`);
await kb.getByTestId("bg-cancel").click();
check("group order cancelled", await until(async () => sql(`select status from "GroupOrderRound" where id='${roundId}'`) === "CANCELLED"));
check("…no orders were placed", sql(`select count(*) from "Order" where "groupRoundId"='${roundId}'`) === "0");

check("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll buying groups e2e checks passed");
process.exit(failures ? 1 : 0);
