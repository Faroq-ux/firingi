/**
 * Browser test of Phase 13 against a running server with the demo seed:
 * sales creates a lead, logs a call, adds a follow-up and a deal; pipeline move; account
 * manager / tier / tags on Kebab House; segment; customer activity; sales performance.
 * Support: Kebab House (Portuguese) asks for help → support answers with an internal note and
 * a reply → the customer sees the answer (not the note) and is notified → replies → resolved.
 *   node tests/e2e/crm.mjs [baseUrl] [screenshotDir]
 */
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");

const BASE = process.argv[2] ?? "http://localhost:3000";
const SHOTS = process.argv[3] ?? null;
const PASSWORD = process.env.SEED_PASSWORD ?? "Firingi!2026";
let failures = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "✔" : "✘"} ${name}${extra ? ` — ${extra}` : ""}`); if (!ok) failures++; };
const shot = async (page, name) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
const browser = await chromium.launch();
const settle = async (p) => { await p.waitForLoadState("networkidle"); await p.waitForTimeout(500); };
const go = async (p, url) => { await p.goto(`${BASE}${url}`); await settle(p); };
const errors = [];
async function login(email) {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 950 } })).newPage();
  page.on("pageerror", (e) => errors.push(`${email}: ${e.message}`));
  await go(page, "/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await settle(page);
  return page;
}
const main = (p) => p.textContent("main");
const stamp = Date.now().toString().slice(-6);

const sales = await login("sales@firingi.test");

// ── 1. Lead → call → follow-up → deal ──
await go(sales, "/admin/crm/leads");
await sales.getByRole("button", { name: "New lead" }).click();
const lf = sales.getByTestId("lead-form");
await lf.locator('input[name="companyName"]').fill(`Pastelaria Aurora ${stamp}`);
await lf.locator('input[name="contactName"]').fill("Aurora Silva");
await lf.locator('input[name="email"]').fill(`aurora.${stamp}@pastelaria.test`);
await lf.locator('input[name="estimatedMonthlyNet"]').fill("1500");
await lf.getByRole("button", { name: "Create lead" }).click();
await sales.waitForURL(/\/admin\/crm\/leads\/[a-z0-9]+$/);
await settle(sales);
check("lead created and opened", (await main(sales)).includes(`Pastelaria Aurora ${stamp}`));
const leadUrl = sales.url();

await sales.getByRole("button", { name: "Log activity" }).click();
const af = sales.getByTestId("activity-form");
await af.locator('select[name="activityKind"]').selectOption("CALL");
await af.locator('input[name="activitySubject"]').fill("Intro call — wants daily bread and dairy");
await af.getByRole("button", { name: "Save" }).click();
await settle(sales);
check("call logged on the timeline", (await sales.getByTestId("timeline").textContent()).includes("Intro call"));
check("lead moved to Contacted", /Contacted/.test(await sales.locator("main").textContent()));

await sales.getByRole("button", { name: "Add follow-up" }).click();
const tf = sales.getByTestId("task-form");
await tf.locator('input[name="taskTitle"]').fill(`Send price list to Aurora ${stamp}`);
await tf.getByRole("button", { name: "Save" }).click();
await settle(sales);
check("follow-up added", (await sales.getByTestId("task-list").textContent()).includes(`Send price list to Aurora ${stamp}`));

await sales.getByRole("button", { name: "New deal" }).click();
const df = sales.getByTestId("deal-form");
await df.locator('input[name="dealTitle"]').fill(`Aurora weekly supply ${stamp}`);
await df.locator('input[name="dealValue"]').fill("1500");
await df.getByRole("button", { name: "Create deal" }).click();
await settle(sales);
check("deal created on the lead", (await main(sales)).includes(`Aurora weekly supply ${stamp}`));
await shot(sales, "p13-01-lead");

// ── 2. Pipeline: move the deal to Proposal ──
await go(sales, "/admin/crm/pipeline");
const card = sales.getByTestId("stage-PROSPECTING").locator("li", { hasText: `Aurora weekly supply ${stamp}` });
await card.locator('select[name="dealStage"]').selectOption("PROPOSAL");
await card.getByRole("button", { name: "Move" }).click();
await settle(sales);
check("deal moved to Proposal", (await sales.getByTestId("stage-PROPOSAL").textContent()).includes(`Aurora weekly supply ${stamp}`));
await shot(sales, "p13-02-pipeline");

// ── 3. Account: manager, tier, tags; segment ──
await go(sales, "/admin/crm/accounts?q=Kebab");
await sales.getByTestId("accounts-table").getByRole("link", { name: /Kebab House/ }).first().click();
await settle(sales);
const accUrl = new URL(sales.url()).pathname;
const acc = sales.getByTestId("account-form");
await acc.locator('select[name="accountOwner"]').selectOption({ label: "Sara Vendas" });
await acc.locator('select[name="tier"]').selectOption("A");
await acc.locator('input[name="tags"]').fill(`kebab, e2e${stamp}`);
await acc.getByRole("button", { name: "Save" }).click();
await settle(sales);
await go(sales, `/admin/crm/accounts?tag=e2e${stamp}`);
check("account tagged and filterable", (await sales.getByTestId("accounts-table").textContent()).includes("Kebab House"));
await go(sales, accUrl);
check("account 360 shows KPIs and recent orders", (await sales.getByTestId("account-kpis").count()) === 1 && /FO-\d{4}-\d{6}/.test(await main(sales)));
await shot(sales, "p13-03-account");

await go(sales, "/admin/crm/segments?new=1");
const sf = sales.getByTestId("segment-form");
await sf.locator('input[name="segmentName"]').fill(`Tier A ${stamp}`);
await sf.getByRole("button", { name: "A", exact: true }).click();
await sf.getByRole("button", { name: "Save segment" }).click();
await sales.waitForURL(/segments\?id=/);
await settle(sales);
check("segment lists Kebab House", (await sales.getByTestId("segment-members").textContent()).includes("Kebab House"));

await go(sales, "/admin/customers/activity?status=ALL");
check("customer activity lists buyers with status", (await sales.getByTestId("activity-table").textContent()).includes("Kebab House"));
await go(sales, "/admin/crm/performance");
check("sales performance shows Sara", (await sales.getByTestId("sales-performance").textContent()).includes("Sara Vendas"));
await go(sales, "/admin/crm/follow-ups");
check("my follow-ups list the new one", (await main(sales)).includes(`Send price list to Aurora ${stamp}`));

// ── 4. Support: customer (Portuguese) ↔ support ──
const customer = await login("owner@kebabhouse.test");
await go(customer, "/buy/support");
check("customer support page in Portuguese", (await main(customer)).includes("Ajuda e Suporte") && (await main(customer)).includes("Novo pedido"));
const nt = customer.getByTestId("new-ticket");
await nt.locator('select[name="category"]').selectOption("DELIVERY");
await nt.locator('input[name="subject"]').fill(`Falta uma caixa ${stamp}`);
await nt.locator('textarea[name="body"]').fill("Na entrega de hoje faltou uma caixa de cola.");
await nt.getByRole("button", { name: "Enviar" }).click();
await customer.waitForURL(/\/buy\/support\/[a-z0-9]+\?sent=1/);
await settle(customer);
check("request sent", (await main(customer)).includes("recebemos o seu pedido"));
const ticketPath = new URL(customer.url()).pathname;
const ticketId = ticketPath.split("/").pop();
await shot(customer, "p13-04-customer-ticket");

const support = await login("support@firingi.test");
await go(support, "/admin/customers/support");
check("support queue shows the request", (await support.getByTestId("tickets-table").textContent()).includes(`Falta uma caixa ${stamp}`));
await go(support, `/admin/customers/support/${ticketId}`);
const rf = support.getByTestId("reply-form");
await rf.locator("textarea").fill("Driver confirms the box stayed at the depot.");
await rf.locator('input[type="checkbox"]').check();
await rf.getByRole("button", { name: "Add internal note" }).click();
await settle(support);
await rf.locator("textarea").fill("Pedimos desculpa! Levamos a caixa amanhã de manhã.");
await rf.getByRole("button", { name: "Send answer" }).click();
await settle(support);
check("support sees note and answer", (await support.getByTestId("internal-note").count()) === 1 && (await support.getByTestId("thread").textContent()).includes("Levamos a caixa"));
await shot(support, "p13-05-support");

await go(customer, ticketPath);
const thread = await customer.getByTestId("thread").textContent();
check("customer sees the answer, not the internal note", thread.includes("Levamos a caixa") && !thread.includes("stayed at the depot"));
check("status: answered", /Respondido/.test(await main(customer)));
await customer.getByTestId("bell").click();
await customer.waitForTimeout(400);
check("customer notified in Portuguese", (await customer.getByTestId("bell-panel").textContent()).includes("A FIRINGI respondeu ao seu pedido"));
await customer.goto(`${BASE}${ticketPath}`); await settle(customer);
await customer.getByTestId("reply-form").locator("textarea").fill("Obrigado, antes das 11h por favor.");
await customer.getByTestId("reply-form").getByRole("button", { name: "Enviar" }).click();
await settle(customer);
check("customer reply reopens the request", /À espera da FIRINGI/.test(await main(customer)));

await go(support, `/admin/customers/support/${ticketId}`);
await support.getByTestId("reply-form").locator("textarea").fill("Combinado, antes das 11h.");
await support.getByTestId("reply-form").getByRole("button", { name: "Send and resolve" }).click();
await settle(support);
check("resolved", /Resolved/.test(await main(support)));

check("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nAll CRM e2e checks passed");
process.exit(failures ? 1 : 0);
