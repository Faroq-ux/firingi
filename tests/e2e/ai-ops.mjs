/**
 * Browser test of Phase 67 (AI Centre: Automation, AI Agents, AI Governance — FIRINGI back office in English):
 * an agent from a template → run it (simulated Claude) → its proposal → approved in the queue → rated; an automation
 * from a template → tested (changes nothing) → saved → switched on → run on the latest order → logged; a by-hand
 * automation with an approval step → waits → approved → finishes; Rules, Schedules, Logs; AI Governance: switches
 * (agents off blocks runs), approvals policy, permissions, audit trail + CSV, models & budget; the AI Dashboard tiles;
 * the old activity log redirects; phone width in dark mode; no page errors. Cleans up after itself.
 *   node tests/e2e/ai-ops.mjs [baseUrl] [screenshotDir]
 */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
const { chromium } = createRequire(import.meta.url)("playwright");

const BASE = process.argv[2] ?? "http://localhost:3000";
const SHOTS = process.argv[3] ?? null;
const PASSWORD = process.env.SEED_PASSWORD ?? "Firingi!2026";
const DB = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/firingi";
let failures = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "✔" : "✘"} ${name}${extra ? ` — ${extra}` : ""}`); if (!ok) failures++; };
const shot = async (page, name, full = false) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: full });
const browser = await chromium.launch();
const settle = async (p) => { await p.waitForLoadState("networkidle").catch(() => {}); await p.waitForTimeout(400); };
const go = async (p, url) => { const r = await p.goto(`${BASE}${url}`); await settle(p); return r; };
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn().catch(() => false)) return true; await new Promise((r) => setTimeout(r, 400)); } return false; };
const sql = (q) => execFileSync("psql", ["-At", DB, "-c", q], { encoding: "utf8" }).trim();
const errors = [];
async function login(email, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "en-GB", reducedMotion: "reduce", deviceScaleFactor: SHOTS ? 2 : 1, serviceWorkers: "block", ...opts });
  await ctx.addCookies([{ name: "NEXT_LOCALE", value: "en", url: BASE }]);
  const page = await ctx.newPage();
  if (process.env.E2E_SLOW) page.setDefaultTimeout(240000);
  page.on("pageerror", (e) => errors.push(`${email}: ${e.message.slice(0, 160)}`));
  page.on("dialog", (d) => d.accept());
  await go(page, "/login");
  await page.fill("#email", email); await page.fill("#password", PASSWORD); await page.click("button[type=submit]");
  await page.waitForURL((u) => u.pathname !== "/login", { timeout: 15000 }).catch(() => {});
  await settle(page);
  return page;
}
const noOverflow = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const cleanup = () => {
  sql(`delete from "AiApproval" where "agentId" in (select id from "AiAgent" where name like 'E2E %') or "workflowId" in (select id from "AiWorkflow" where name like 'E2E %')`);
  sql(`delete from "AiWorkflow" where name like 'E2E %'`);
  sql(`delete from "AiAgent" where name like 'E2E %'`);
  sql(`delete from "CrmTask" where notes like '%Simulated agent%'`);
  sql(`delete from "Setting" where key='ai.governance'`);
};

const adminLocale = sql(`select locale from "User" where email='superadmin@firingi.test'`);
sql(`update "User" set locale='en' where email='superadmin@firingi.test'`);
cleanup();
try {
  const sa = await login("superadmin@firingi.test");

  // 1. AI Agents: a template → own agent
  await go(sa, "/admin/ai/agents?tab=TEMPLATES");
  check("agent templates", (await sa.getByTestId("ag-template").count()) === 6);
  await shot(sa, "01-agent-templates", true);
  await sa.getByTestId("ag-template").filter({ hasText: "Credit Controller" }).getByTestId("ag-use-template").click();
  await settle(sa);
  check("template fills the agent", (await sa.getByTestId("ag-name").inputValue()) === "Credit Controller" && (await sa.getByTestId("ag-tool-create_task").isChecked()) && (await sa.getByTestId("ag-area-FINANCE").isChecked()));
  await sa.getByTestId("ag-name").fill("E2E Credit Controller");
  await shot(sa, "02-agent-settings", true);
  await sa.getByTestId("ag-save").click();
  check("saved → the agent's page", await until(async () => /\/admin\/ai\/agents\/c/.test(sa.url()), 90000), sa.url());
  await settle(sa);
  const agentId = sql(`select id from "AiAgent" where name='E2E Credit Controller'`);

  // 2. Run it (simulated Claude) → a proposal
  await sa.getByTestId("ag-run-task").fill("Daily overdue check: who to chase today?");
  await sa.getByTestId("ag-run").click();
  check("the run finishes with a report", await until(async () => (await sa.getByTestId("ag-output").count()) > 0 && /Simulated agent report/.test(await sa.getByTestId("ag-output").first().textContent()), 60000));
  const proposals = Number(sql(`select count(*) from "AiApproval" where "agentId"='${agentId}' and status='PENDING'`));
  check("it proposed an action for approval", proposals === 1, String(proposals));
  check("tools shown on the run", /for approval/.test(await sa.getByTestId("ag-run-row").first().textContent()));
  await sa.getByTestId("ag-rate").first().getByRole("button", { name: "Useful", exact: true }).click();
  check("rated useful", await until(async () => sql(`select rating from "AiAgentRun" where "agentId"='${agentId}' order by "startedAt" desc limit 1`) === "1"));
  await shot(sa, "03-agent-run", true);

  // 3. Approval queue
  await go(sa, "/admin/ai/automation?tab=APPROVALS");
  const row = sa.getByTestId("ap-row").filter({ hasText: "E2E Credit Controller" });
  check("proposal in the queue with its reason", (await row.count()) === 1 && /Why:/.test(await row.textContent()));
  await shot(sa, "04-approvals", true);
  await row.getByTestId("ap-approve").click();
  check("approved → done", await until(async () => sql(`select status from "AiApproval" where "agentId"='${agentId}' order by "createdAt" desc limit 1`) === "APPROVED"), sql(`select status || ' ' || coalesce(result::text,'') from "AiApproval" where "agentId"='${agentId}' order by "createdAt" desc limit 1`));

  // 4. Agents list + performance
  await go(sa, "/admin/ai/agents");
  check("agent card with its numbers", (await sa.getByTestId("ag-card").filter({ hasText: "E2E Credit Controller" }).count()) === 1);
  await shot(sa, "05-agents", true);
  await go(sa, "/admin/ai/agents?tab=PERFORMANCE");
  const perf = sa.getByTestId("ag-perf-row").filter({ hasText: "E2E Credit Controller" });
  check("performance: 1 run, 100% approved", (await perf.count()) === 1 && /100%/.test(await perf.textContent()), (await perf.textContent()).slice(0, 160));
  await go(sa, `/admin/ai/agents/${agentId}?tab=PERFORMANCE`);
  check("agent performance tab", (await sa.getByTestId("ag-kpis").count()) === 1 && (await sa.getByTestId("ag-daily").locator("tbody tr").count()) >= 1);

  // 5. Automation from a template: test → save → switch on → run now
  await go(sa, "/admin/ai/automation?tab=RULES");
  check("templates on the Rules tab", (await sa.getByTestId("wf-template").count()) === 8);
  await sa.getByTestId("wf-template").filter({ hasText: "Big order alert" }).getByTestId("wf-use-template").click();
  await settle(sa);
  check("template fills the builder", (await sa.getByTestId("wf-name").inputValue()) === "Big order alert" && (await sa.getByTestId("wf-cond").count()) === 1 && (await sa.getByTestId("wf-step").count()) === 1);
  await sa.getByTestId("wf-name").fill("E2E Big order alert");
  await sa.getByTestId("wf-cond-value").fill("0");
  await sa.getByTestId("wf-test").click();
  check("test run: matched on recent orders, nothing changed", await until(async () => (await sa.locator('[data-testid="wf-test-event"][data-matched="true"]').count()) > 0) && sql(`select count(*) from "AiWorkflow" where name='E2E Big order alert'`) === "0");
  await shot(sa, "06-automation-builder", true);
  await sa.getByTestId("wf-save").click();
  check("saved → its page, switched off", await until(async () => /\/admin\/ai\/automation\/c/.test(sa.url()), 90000) && /Off/.test(await sa.getByTestId("wf-state").textContent().catch(() => "")));
  await settle(sa);
  await sa.getByTestId("wf-toggle").click();
  check("switched on", await until(async () => sql(`select active from "AiWorkflow" where name='E2E Big order alert'`) === "t"));
  await sa.getByTestId("wf-run").click();
  check("run now → done on the latest order", await until(async () => { await sa.reload(); await settle(sa); return (await sa.locator('[data-testid="wf-run"][data-status="DONE"]').count()) === 1; }, 30000));
  await shot(sa, "07-automation-detail", true);

  // 6. A by-hand automation with an approval step
  await go(sa, "/admin/ai/automation/new");
  await sa.getByTestId("wf-name").fill("E2E Approve then tell");
  await sa.getByTestId("wf-trigger").selectOption("MANUAL");
  await sa.getByTestId("wf-step").first().locator("select").first().selectOption("APPROVAL");
  await sa.getByTestId("wf-step").first().getByTestId("st-title").fill("Send the note?");
  await sa.getByTestId("wf-add-NOTIFY").click();
  await sa.getByTestId("wf-step").nth(1).getByTestId("st-title").fill("E2E approved note");
  await sa.getByTestId("wf-save").click();
  await until(async () => /\/admin\/ai\/automation\/c/.test(sa.url()), 90000);
  await settle(sa);
  await sa.getByTestId("wf-run").click();
  check("waits for approval", await until(async () => sql(`select r.status from "AiWorkflowRun" r join "AiWorkflow" w on w.id=r."workflowId" where w.name='E2E Approve then tell'`) === "WAITING_APPROVAL"));
  await go(sa, "/admin/ai/automation?tab=APPROVALS");
  await sa.getByTestId("ap-row").filter({ hasText: "E2E Approve then tell" }).getByTestId("ap-approve").click();
  check("approved → finished", await until(async () => sql(`select r.status from "AiWorkflowRun" r join "AiWorkflow" w on w.id=r."workflowId" where w.name='E2E Approve then tell'`) === "DONE"));

  // 7. Workflows, Rules, Schedules, Logs
  await go(sa, "/admin/ai/automation");
  check("workflow list", (await sa.getByTestId("wf-row").filter({ hasText: "E2E Big order alert" }).count()) === 1 && (await sa.getByTestId("auto-kpis").count()) === 1);
  await shot(sa, "08-automation", true);
  await go(sa, "/admin/ai/automation?tab=RULES");
  check("rules in one sentence", /When an order is placed and order total .* is more than 0: notify Finance team/.test(await sa.getByTestId("rule-list").textContent()));
  await go(sa, "/admin/ai/automation?tab=SCHEDULES");
  check("schedules: the AI jobs", (await sa.getByTestId("ai-job").count()) === 3);
  await go(sa, "/admin/ai/automation?tab=LOGS");
  const log = sa.getByTestId("log-row").filter({ hasText: "E2E Approve then tell" });
  check("execution log, step by step", (await log.count()) === 1 && /Approved by/.test(await log.textContent()) && /Notified/.test(await log.textContent()));
  await log.locator("summary").click();
  await shot(sa, "09-logs", true);

  // 8. AI Governance
  await go(sa, "/admin/ai/governance");
  check("governance overview", (await sa.getByTestId("gov-kpis").count()) === 1 && (await sa.getByTestId("gov-enabled").isChecked()));
  await shot(sa, "10-governance", true);
  await sa.getByTestId("gov-agents").uncheck();
  await sa.getByTestId("gov-save").click();
  check("agents switched off", await until(async () => sql(`select value->>'agents' from "Setting" where key='ai.governance'`) === "false"));
  await go(sa, `/admin/ai/agents/${agentId}`);
  await sa.getByTestId("ag-run").click();
  check("agents off → the run is blocked", await until(async () => sql(`select status from "AiAgentRun" where "agentId"='${agentId}' order by "startedAt" desc limit 1`) === "BLOCKED"));
  await go(sa, "/admin/ai/governance");
  await sa.getByTestId("gov-agents").check();
  await sa.getByTestId("gov-save").click();
  await until(async () => sql(`select value->>'agents' from "Setting" where key='ai.governance'`) === "true");
  await go(sa, "/admin/ai/governance?tab=APPROVALS");
  check("approval policy and decisions", (await sa.getByTestId("gov-auto-create_task").count()) === 1 && (await sa.getByTestId("gov-decisions").locator("tbody tr").count()) >= 2);
  await go(sa, "/admin/ai/governance?tab=PERMISSIONS");
  const sup = sa.getByTestId("gov-rights").locator("tr", { hasText: "Super Admin" });
  check("permissions: Super Admin holds every AI right", (await sup.count()) >= 1 && ((await sup.first().textContent()).match(/✓/g) ?? []).length === 5);
  await shot(sa, "11-governance-permissions", true);
  await go(sa, "/admin/ai/governance?tab=AUDIT&kind=AGENT");
  check("audit trail: agent runs", (await sa.getByTestId("audit-row").count()) >= 2 && /E2E Credit Controller/.test(await sa.getByTestId("activity-log").textContent()));
  const csv = await sa.request.get(`${BASE}/api/admin/ai/audit?kind=APPROVED`);
  check("audit CSV", csv.ok() && /^when,kind,who/.test(await csv.text()));
  await go(sa, "/admin/ai/governance?tab=AUDIT");
  await shot(sa, "12-audit-trail", true);
  await go(sa, "/admin/ai/governance?tab=MODELS");
  check("models & budget", (await sa.getByTestId("gov-model-agents").count()) === 1 && (await sa.getByTestId("ai-settings").count()) === 1);
  await go(sa, "/admin/ai/activity-log");
  check("old activity log → audit trail", /governance\?tab=AUDIT/.test(sa.url()));

  // 9. AI Dashboard tiles + menu
  await go(sa, "/admin/ai");
  check("AI Dashboard: approvals, automations, agents, tokens", (await sa.getByTestId("aid-ops").count()) === 1 && (await sa.locator('aside a[href="/admin/ai/agents"]').count()) >= 1 && (await sa.locator('aside a[href="/admin/ai/governance"]').count()) >= 1 && (await sa.locator('aside a[href="/admin/ai/automation"]').count()) >= 1);

  // 10. Phone, dark
  const ph = await login("superadmin@firingi.test", { viewport: { width: 390, height: 844 }, colorScheme: "dark", isMobile: true, hasTouch: true });
  for (const u of ["/admin/ai/agents", `/admin/ai/agents/${agentId}`, "/admin/ai/automation", "/admin/ai/automation?tab=LOGS", "/admin/ai/governance", "/admin/ai/governance?tab=AUDIT"]) {
    await go(ph, u);
    check(`phone ${u}: no sideways scroll`, await noOverflow(ph));
  }
  await go(ph, `/admin/ai/agents/${agentId}`);
  await shot(ph, "13-phone-agent", true);

  // 11. No right, no access
  const sup2 = await login("support@firingi.test");
  await go(sup2, "/admin/ai/automation");
  check("support (no AI right) is blocked", sup2.url().endsWith("/forbidden"), sup2.url());
  check("no page errors", errors.length === 0, errors.join(" | "));
} finally {
  cleanup();
  sql(`update "User" set locale=${adminLocale ? `'${adminLocale}'` : "NULL"} where email='superadmin@firingi.test'`);
  await browser.close();
}
console.log(failures ? `\n${failures} check(s) failed` : "\nAll Phase 67 checks passed");
process.exit(failures ? 1 : 0);
