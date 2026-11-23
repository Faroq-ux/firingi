/**
 * Phase 67: Automation, AI Agents, AI Governance — an automation picks up a new order once and notifies a team; an
 * approval step waits for a person (approve → the next steps run, reject → it stops); waits resume later; schedules run
 * and move on; a test run changes nothing; a custom agent reads with its own data areas (narrowed), proposes a follow-up
 * that a person approves (the task is created with their rights) or acts on its own only where AI Governance allows;
 * report-only agents get no acting tools; daily limits; the master switch and the monthly budget stop Claude; every step
 * lands in the audit trail.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/server/db";
import { setAiTransportForTests, type AiTransport } from "@/server/ai/assistant";
import { automationJob, runWorkflowNow, saveWorkflow, setWorkflowActive, testWorkflow, listWorkflows } from "@/server/ai/ops/workflows";
import { agentStats, decideApproval, listApprovals, runAgent, saveAgent, expireApprovals } from "@/server/ai/ops/agents";
import { claudeGate, governance, modelFor, saveGovernance } from "@/server/ai/ops/governance";
import type { AgentInput, WorkflowInput } from "@/server/ai/ops/schema";
import { ctxFor } from "../helpers";

type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
const ADMIN = "superadmin@firingi.test";
const TAG = "P67TEST";
const msg = (content: unknown[], stop_reason: string, model = "claude-opus-5-5") => ({
  id: `msg_${Math.random()}`, type: "message", role: "assistant", model, content, stop_reason, stop_sequence: null,
  usage: { input_tokens: 400, output_tokens: 60, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
}) as unknown as Awaited<ReturnType<AiTransport>>;
const toolUse = (name: string, input: unknown, id = `tu_${name}_${Math.random()}`) => ({ type: "tool_use", id, name, input });
const text = (t: string) => ({ type: "text", text: t });
let calls: Params[] = [];
function script(...replies: ((p: Params) => Awaited<ReturnType<AiTransport>>)[]) {
  calls = [];
  setAiTransportForTests(async (p) => { calls.push(structuredClone(p)); const r = replies[calls.length - 1]; if (!r) throw new Error("unexpected call"); return r(p); });
}
const toolResults = (p: Params) => p.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((b) => (b as { type: string }).type === "tool_result") as unknown as { content: string; is_error?: boolean }[];

const agentInput = (o: Partial<AgentInput> = {}): AgentInput => ({
  name: `${TAG} Credit`, role: "Chases overdue customers", instructions: "List overdue customers and propose one follow-up task for the biggest.", icon: "Wallet", tone: "tone-orange",
  tools: ["overdue_customers", "find_company", "create_task", "notify_staff"], dataAreas: ["FINANCE", "CUSTOMERS"], autonomy: "APPROVAL", model: "default", effort: "low",
  maxRunsPerDay: 10, active: true, schedule: null, scheduleTask: null, ...o,
});
const wf = (o: Partial<WorkflowInput> = {}): WorkflowInput => ({
  name: `${TAG} flow`, description: null, trigger: "ORDER_PLACED", schedule: null, conditions: [], match: "ALL",
  steps: [{ type: "NOTIFY", group: "admin.ai.view", title: "Order {{number}}: €{{total}}", body: "{{buyer}} ordered from {{supplier}}." }], maxRunsPerDay: 50, ...o,
});

async function clean() {
  await prisma.aiApproval.deleteMany({ where: { title: { contains: TAG } } });
  const wfs = await prisma.aiWorkflow.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } });
  await prisma.aiApproval.deleteMany({ where: { workflowId: { in: wfs.map((w) => w.id) } } });
  await prisma.aiWorkflow.deleteMany({ where: { name: { startsWith: TAG } } });
  const ags = await prisma.aiAgent.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } });
  await prisma.aiApproval.deleteMany({ where: { agentId: { in: ags.map((a) => a.id) } } });
  await prisma.aiAgent.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.crmTask.deleteMany({ where: { title: { contains: TAG } } });
  await prisma.setting.deleteMany({ where: { key: "ai.governance" } });
}

let admin: Awaited<ReturnType<typeof ctxFor>>;
let overdueBuyer: { id: string; name: string } | null = null;
let order: { id: string; number: string; placedAt: Date; netTotal: unknown };

beforeAll(async () => {
  await clean();
  admin = await ctxFor(ADMIN);
  let o = await prisma.order.findFirst({ orderBy: { placedAt: "desc" }, select: { id: true, number: true, placedAt: true, netTotal: true } });
  if (!o) {
    // the test database may start empty: one small order handed over on the spot
    const { placeOrder } = await import("@/server/services/orders");
    const kb = await ctxFor("owner@kebabhouse.test"), lx = await ctxFor("owner@lisboacentral.test");
    const wh = await prisma.address.findFirstOrThrow({ where: { companyId: lx.company.id, kind: "WAREHOUSE", isActive: true } });
    const addr = await prisma.address.findFirstOrThrow({ where: { companyId: kb.company.id, kind: "DELIVERY", isActive: true } });
    const offer = await prisma.vendorOffer.findFirstOrThrow({ where: { vendorCompanyId: lx.company.id, vendorSku: "GRO-ARROZ1", status: "ACTIVE" } });
    await placeOrder(kb, { deliveryAddressId: addr.id, items: [{ offerId: offer.id, qty: 1 }], approved: true, handover: { warehouseId: wh.id, paidNow: true, reason: "AI automation test" } });
    o = await prisma.order.findFirst({ orderBy: { placedAt: "desc" }, select: { id: true, number: true, placedAt: true, netTotal: true } });
  }
  expect(o, "the test database needs at least one order").toBeTruthy();
  order = o!;
  const buyer = await prisma.company.findFirstOrThrow({ where: { type: "CUSTOMER" }, select: { id: true, legalName: true } });
  overdueBuyer = { id: buyer.id, name: buyer.legalName };
});
afterEach(() => setAiTransportForTests(null));
afterAll(async () => { await clean(); });

describe("AI Governance", () => {
  it("defaults, rights and the per-feature model", async () => {
    const g = await governance();
    expect(g.enabled && g.agents && g.automation).toBe(true);
    expect(g.autoActions).toEqual(["notify_staff"]);
    const support = await ctxFor("support@firingi.test");
    await expect(saveGovernance(support, { enabled: false })).rejects.toThrow();
    await saveGovernance(admin, { models: { assistant: "default", agents: "claude-haiku-5-5", reports: "default" } });
    expect(await modelFor("agents")).toBe("claude-haiku-5-5");
    expect(await modelFor("agents", "claude-sonnet-5-5")).toBe("claude-sonnet-5-5"); // an agent's own choice wins
    const log = await prisma.aiActivity.findFirstOrThrow({ where: { kind: "GOVERNANCE" }, orderBy: { at: "desc" } });
    expect(log.summary).toContain("models");
  });
  it("the master switch and the budget stop Claude", async () => {
    await saveGovernance(admin, { enabled: false });
    expect((await claudeGate("assistant")).ok).toBe(false);
    const { ask } = await import("@/server/ai/assistant");
    script(() => msg([text("hi")], "end_turn"));
    await expect(ask(admin, "STAFF", { text: "hello" })).rejects.toThrow(/switched off the AI/);
    expect(calls.length).toBe(0);
    await saveGovernance(admin, { enabled: true, monthlyTokens: 1, budgetStops: "AGENTS" });
    await prisma.aiActivity.create({ data: { kind: "ASSISTANT", summary: `${TAG} usage`, tokensIn: 10, tokensOut: 5 } });
    expect((await claudeGate("agents")).ok).toBe(false);
    expect((await claudeGate("assistant")).ok).toBe(true); // budget stops agents only
    await saveGovernance(admin, { monthlyTokens: 0 });
    await prisma.aiActivity.deleteMany({ where: { summary: `${TAG} usage` } });
  });
});

describe("AI agents", () => {
  it("reads within its data areas, proposes a task, a person approves it", async () => {
    const a = await saveAgent(admin, null, agentInput());
    // make sure a customer is overdue: an invoice due long ago, unpaid
    const rows = (await (await import("@/server/ai/centre/recs")).overdueByCustomer(new Date(), 0));
    const target = rows[0] ? { id: rows[0].buyerId, name: rows[0].buyer } : overdueBuyer!;
    script(
      () => msg([toolUse("overdue_customers", { min_days_late: 0, limit: 5 })], "tool_use"),
      () => msg([toolUse("create_task", { company_id: target.id, title: `${TAG} Call ${target.name}`, notes: "Agree a date.", due_in_days: 1, why: "Biggest overdue amount" })], "tool_use"),
      () => msg([text("Proposed a call to the biggest overdue customer.")], "end_turn"),
    );
    const run = await runAgent(admin, a.id, { task: "Who should we chase today? (ana@example.com, +351 912 345 678)", source: "MANUAL" });
    expect(run.status).toBe("DONE");
    expect(run.proposals).toBe(1);
    expect(run.output).toContain("Proposed");
    expect(calls[0].model).toBe("claude-haiku-5-5"); // AI Governance's model for agents
    expect(calls[0].tools!.map((t) => (t as { name: string }).name).sort()).toEqual(["create_task", "find_company", "notify_staff", "overdue_customers"]);
    expect(String(calls[0].system)).toContain("PROPOSE");
    // personal data in tool results is redacted (the task text itself is the person's own words)
    for (const r of toolResults(calls[1])) expect(r.content).not.toMatch(/@[a-z0-9-]+\.[a-z]{2,}/i);
    const [p] = (await listApprovals(admin)).filter((x) => x.agentId === a.id);
    expect(p.status).toBe("PENDING");
    expect(p.reason).toBe("Biggest overdue amount");
    expect(p.canDecide).toBe(true);
    expect(await prisma.crmTask.count({ where: { title: { contains: TAG } } })).toBe(0); // nothing done yet
    await decideApproval(admin, p.id, true, "ok");
    expect(await prisma.crmTask.count({ where: { title: { contains: TAG }, companyId: target.id } })).toBe(1);
    await expect(decideApproval(admin, p.id, true, null)).rejects.toThrow(/already decided/);
    const s = (await agentStats([a.id], new Date(Date.now() - 86400_000))).get(a.id)!;
    expect(s).toMatchObject({ runs: 1, done: 1, proposals: 1, approved: 1, approvalRate: 100 });
    expect(await prisma.aiActivity.count({ where: { kind: { in: ["AGENT", "APPROVED", "AGENT_SETUP"] }, detail: { path: ["agentId"], equals: a.id } } })).toBeGreaterThanOrEqual(3);
  });

  it("data it may not read is refused; report-only agents get no acting tools", async () => {
    const a = await saveAgent(admin, null, agentInput({ name: `${TAG} Narrow`, dataAreas: ["STOCK"], autonomy: "SUGGEST", tools: ["overdue_customers", "stock_outlook", "create_task"] }));
    script(
      () => msg([toolUse("overdue_customers", { min_days_late: 0, limit: 5 })], "tool_use"),
      () => msg([text("No finance access.")], "end_turn"),
    );
    const r = await runAgent(admin, a.id, { task: "Overdue?", source: "MANUAL" });
    expect(r.status).toBe("DONE");
    expect(calls[0].tools!.map((t) => (t as { name: string }).name).sort()).toEqual(["overdue_customers", "stock_outlook"]);
    const res = toolResults(calls[1])[0];
    expect(res.is_error).toBe(true);
    expect(res.content).toMatch(/No access/);
  });

  it("acts on its own only where AI Governance allows it", async () => {
    const a = await saveAgent(admin, null, agentInput({ name: `${TAG} Auto`, autonomy: "AUTO" }));
    const before = await prisma.notification.count({ where: { type: "ai.automation" } });
    script(
      () => msg([toolUse("notify_staff", { group: "admin.ai.view", title: `${TAG} heads-up`, body: "Stock is low.", why: "x" }), toolUse("create_task", { company_id: overdueBuyer!.id, title: `${TAG} auto task`, notes: "", due_in_days: 0, why: "y" })], "tool_use"),
      () => msg([text("Done.")], "end_turn"),
    );
    const r = await runAgent(admin, a.id, { task: "Check", source: "MANUAL" });
    expect(r.proposals).toBe(1); // the task waits; the message went out
    expect(await prisma.notification.count({ where: { type: "ai.automation" } })).toBeGreaterThan(before);
    expect(await prisma.crmTask.count({ where: { title: `${TAG} auto task` } })).toBe(0);
    const tools = r.tools as { name: string; done?: boolean; proposalId?: string }[];
    expect(tools.find((t) => t.name === "notify_staff")?.done).toBe(true);
    expect(tools.find((t) => t.name === "create_task")?.proposalId).toBeTruthy();
    const p = await prisma.aiApproval.findFirstOrThrow({ where: { agentId: a.id } });
    await decideApproval(admin, p.id, false, "not now");
    expect((await prisma.aiApproval.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("REJECTED");
  });

  it("daily limit, paused agents, switched-off agents and expired proposals", async () => {
    const a = await saveAgent(admin, null, agentInput({ name: `${TAG} Limit`, maxRunsPerDay: 1, tools: ["open_suggestions"], autonomy: "SUGGEST" }));
    script(() => msg([text("ok")], "end_turn"));
    expect((await runAgent(admin, a.id, { task: "one", source: "MANUAL" })).status).toBe("DONE");
    const second = await runAgent(admin, a.id, { task: "two", source: "MANUAL" });
    expect(second.status).toBe("BLOCKED");
    expect(second.error).toMatch(/Daily limit/);
    await prisma.aiAgent.update({ where: { id: a.id }, data: { active: false, maxRunsPerDay: 10 } });
    expect((await runAgent(admin, a.id, { task: "sched", source: "SCHEDULE" })).error).toMatch(/paused/);
    await saveGovernance(admin, { agents: false });
    expect((await runAgent(admin, a.id, { task: "x", source: "MANUAL" })).error).toMatch(/switched off/);
    await saveGovernance(admin, { agents: true });
    const p = await prisma.aiApproval.create({ data: { source: "AGENT", agentId: a.id, action: "notify_staff", title: `${TAG} old`, detail: {}, expiresAt: new Date(Date.now() - 1000) } });
    expect(await expireApprovals()).toBeGreaterThanOrEqual(1);
    expect((await prisma.aiApproval.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("EXPIRED");
  });

  it("only people with the agents right set them up", async () => {
    const support = await ctxFor("support@firingi.test");
    await expect(saveAgent(support, null, agentInput({ name: `${TAG} Nope` }))).rejects.toThrow();
  });
});

describe("Automation", () => {
  it("an event automation runs once per new order and notifies the team", async () => {
    const w = await saveWorkflow(admin, null, wf({ conditions: [{ field: "total", op: "gte", value: "0" }] }));
    await setWorkflowActive(admin, w.id, true);
    // events from just before the latest order (as if it was switched on then)
    await prisma.aiWorkflow.update({ where: { id: w.id }, data: { cursorAt: new Date(order.placedAt.getTime() - 1) } });
    const before = await prisma.notification.count({ where: { type: "ai.automation" } });
    await automationJob();
    const runs = await prisma.aiWorkflowRun.findMany({ where: { workflowId: w.id } });
    expect(runs.length).toBeGreaterThanOrEqual(1);
    const run = runs.find((r) => r.subjectId === order.id)!;
    expect(run.status).toBe("DONE");
    expect((run.payload as { number: string }).number).toBe(order.number);
    expect(JSON.stringify(run.log)).toContain(`Order ${order.number}`);
    expect(await prisma.notification.count({ where: { type: "ai.automation" } })).toBeGreaterThan(before);
    // the cursor moved on: nothing runs twice
    await prisma.aiWorkflow.update({ where: { id: w.id }, data: { cursorAt: new Date(order.placedAt.getTime() - 1) } });
    await automationJob();
    expect(await prisma.aiWorkflowRun.count({ where: { workflowId: w.id, subjectId: order.id } })).toBe(1);
  });

  it("conditions that don't hold don't run; switched off doesn't run", async () => {
    const w = await saveWorkflow(admin, null, wf({ name: `${TAG} big`, conditions: [{ field: "total", op: "gt", value: "999999999" }] }));
    await setWorkflowActive(admin, w.id, true);
    await prisma.aiWorkflow.update({ where: { id: w.id }, data: { cursorAt: new Date(order.placedAt.getTime() - 1) } });
    await automationJob();
    expect(await prisma.aiWorkflowRun.count({ where: { workflowId: w.id } })).toBe(0);
    await setWorkflowActive(admin, w.id, false);
    await saveGovernance(admin, { automation: false });
    expect((await automationJob()).runs).toBe(0);
    await saveGovernance(admin, { automation: true });
  });

  it("approval step: waits, approve → next steps; reject → stops", async () => {
    const steps: WorkflowInput["steps"] = [
      { type: "APPROVAL", title: "Chase {{buyer}}?", group: "admin.ai.approve" },
      { type: "TASK", title: `${TAG} WF Call {{buyer}} about {{number}}`, notes: "From the automation", dueDays: 1 },
    ];
    const w = await saveWorkflow(admin, null, wf({ name: `${TAG} approve`, trigger: "MANUAL", steps }));
    const r1 = await runWorkflowNow(admin, w.id);
    expect(r1.status).toBe("WAITING_APPROVAL");
    const ap = await prisma.aiApproval.findFirstOrThrow({ where: { workflowRunId: r1.id } });
    expect(ap.permission).toBe("admin.ai.approve");
    await decideApproval(admin, ap.id, true, null);
    const done = await prisma.aiWorkflowRun.findUniqueOrThrow({ where: { id: r1.id } });
    expect(done.status).toBe("DONE");
    expect(await prisma.crmTask.count({ where: { title: { startsWith: `${TAG} WF Call` } } })).toBe(1);
    const r2 = await runWorkflowNow(admin, w.id);
    const ap2 = await prisma.aiApproval.findFirstOrThrow({ where: { workflowRunId: r2.id } });
    await decideApproval(admin, ap2.id, false, "no");
    expect((await prisma.aiWorkflowRun.findUniqueOrThrow({ where: { id: r2.id } })).status).toBe("REJECTED");
    expect(await prisma.crmTask.count({ where: { title: { startsWith: `${TAG} WF Call` } } })).toBe(1);
  });

  it("wait steps resume later; schedules run and move on; failures are logged", async () => {
    const w = await saveWorkflow(admin, null, wf({ name: `${TAG} wait`, trigger: "MANUAL", steps: [{ type: "WAIT", hours: 2 }, { type: "NOTIFY", group: "admin.ai.view", title: `${TAG} later`, body: "" }] }));
    const r = await runWorkflowNow(admin, w.id);
    expect(r.status).toBe("WAITING");
    await automationJob(new Date(Date.now() + 3 * 3600_000));
    expect((await prisma.aiWorkflowRun.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("DONE");

    const s = await saveWorkflow(admin, null, wf({ name: `${TAG} sched`, trigger: "SCHEDULE", schedule: { every: "DAILY", hour: 6, weekday: 1, day: 1 } }));
    await setWorkflowActive(admin, s.id, true);
    const next = (await prisma.aiWorkflow.findUniqueOrThrow({ where: { id: s.id } })).nextRunAt!;
    await automationJob(new Date(next.getTime() + 60_000));
    expect(await prisma.aiWorkflowRun.count({ where: { workflowId: s.id, source: "SCHEDULE" } })).toBe(1);
    expect((await prisma.aiWorkflow.findUniqueOrThrow({ where: { id: s.id } })).nextRunAt!.getTime()).toBe(next.getTime() + 86400_000);

    const f = await saveWorkflow(admin, null, wf({ name: `${TAG} hook`, trigger: "MANUAL", steps: [{ type: "WEBHOOK", url: "http://127.0.0.1:9/nothing" }] }));
    const fr = await runWorkflowNow(admin, f.id);
    expect(fr.status).toBe("FAILED");
    expect((await listWorkflows(admin)).find((x) => x.id === f.id)?.failed30).toBe(1);
  });

  it("a test run shows what would happen and changes nothing", async () => {
    const before = await prisma.aiWorkflowRun.count();
    const t = await testWorkflow(admin, wf({ conditions: [{ field: "total", op: "gte", value: "0" }] }));
    expect(t.events.length).toBeGreaterThan(0);
    expect(t.events[0].matched).toBe(true);
    expect(t.events[0].steps[0]).toMatch(/^notify AI Centre users: “Order /);
    expect(await prisma.aiWorkflowRun.count()).toBe(before);
  });

  it("only the automation right builds automations; unknown fields are refused", async () => {
    const support = await ctxFor("support@firingi.test");
    await expect(saveWorkflow(support, null, wf())).rejects.toThrow();
    await expect(saveWorkflow(admin, null, wf({ conditions: [{ field: "nope", op: "eq", value: "1" }] }))).rejects.toThrow(/isn't a value/);
    await expect(saveWorkflow(admin, null, wf({ steps: [{ type: "AGENT", agentId: "missing", task: "do it" }] }))).rejects.toThrow(/existing agent/);
  });
});
