import "server-only";
/**
 * Automation (Phase 67): workflows FIRINGI's staff build — a trigger (an event, a schedule or by hand),
 * conditions on the event's values, then steps in order: notify a staff group, create a follow-up task,
 * ask an AI agent, wait for a person's approval, wait, call another system (webhook) or make an AI
 * report. Steps run with the rights of the workflow's owner. Every run is logged step by step; one run
 * per workflow and event. The automation job (every 5 minutes) picks up events, schedules and waits.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { EVENT_TRIGGERS, TRIGGERS, fill, matches, nextRun, stepText, type Condition, type Payload, type Schedule, type Step, type TriggerKind } from "@/lib/ai-ops";
import { eventsSince, latestEvents, type AutoEvent } from "./events";
import { governance } from "./governance";
import type { WorkflowInput } from "./schema";

const DAY = 86400_000;
type Wf = Awaited<ReturnType<typeof prisma.aiWorkflow.findUniqueOrThrow>>;
type LogLine = { step: number; type: string; at: string; ok: boolean; text: string };

export const mayAutomate = (ctx: Ctx) => ctx.company.type === "ADMIN" && can(ctx, "admin.ai.automate");
function assertView(ctx: Ctx) { if (ctx.company.type !== "ADMIN" || !can(ctx, "admin.ai.view")) throw new ForbiddenError(); }
function assertManage(ctx: Ctx) { if (!mayAutomate(ctx)) throw new ForbiddenError("Building automations needs the Automation right."); }

// ── set-up ──────────────────────────────────────────────────────────────────

async function validate(i: WorkflowInput) {
  if (i.trigger === "SCHEDULE" && !i.schedule) throw new ValidationError("Choose when it runs.");
  const fields = TRIGGERS[i.trigger].fields as Record<string, unknown>;
  for (const c of i.conditions) if (!fields[c.field]) throw new ValidationError(`"${c.field}" isn't a value of this trigger.`);
  const agentIds = i.steps.filter((s): s is Extract<Step, { type: "AGENT" }> => s.type === "AGENT").map((s) => s.agentId);
  if (agentIds.length) {
    const found = await prisma.aiAgent.count({ where: { id: { in: agentIds } } });
    if (found !== new Set(agentIds).size) throw new ValidationError("Choose an existing agent.");
  }
}

export async function saveWorkflow(ctx: Ctx, id: string | null, i: WorkflowInput) {
  assertManage(ctx);
  await validate(i);
  const now = new Date();
  const before = id ? await prisma.aiWorkflow.findUnique({ where: { id } }) : null;
  if (id && !before) throw new NotFoundError("Automation");
  const triggerConfig = (i.trigger === "SCHEDULE" ? { schedule: i.schedule } : {}) as Prisma.InputJsonValue;
  const active = before?.active ?? false;
  const data = {
    name: i.name, description: i.description?.trim() || null, trigger: i.trigger, triggerConfig, conditions: i.conditions as Prisma.InputJsonValue, match: i.match,
    steps: i.steps as unknown as Prisma.InputJsonValue, maxRunsPerDay: i.maxRunsPerDay,
    nextRunAt: active && i.trigger === "SCHEDULE" && i.schedule ? nextRun(i.schedule, now) : null,
    ...(before && before.trigger !== i.trigger ? { cursorAt: now } : {}),
  };
  const w = before
    ? await prisma.aiWorkflow.update({ where: { id: before.id }, data: { ...data, updatedById: ctx.user.id } })
    : await prisma.aiWorkflow.create({ data: { ...data, template: i.template ?? null, ownerId: ctx.user.id, createdById: ctx.user.id } });
  const { logAi } = await import("../feed");
  await logAi({ kind: "AUTOMATION_SETUP", ctx, summary: `${before ? "Automation changed" : "Automation created"}: ${w.name}`, detail: { workflowId: w.id, trigger: w.trigger, conditions: w.conditions, steps: w.steps, ...(before ? { before: { trigger: before.trigger, conditions: before.conditions, steps: before.steps } } : {}) } });
  return w;
}

export async function setWorkflowActive(ctx: Ctx, id: string, active: boolean) {
  assertManage(ctx);
  const w = await prisma.aiWorkflow.findUnique({ where: { id } });
  if (!w) throw new NotFoundError("Automation");
  const now = new Date();
  const s = (w.triggerConfig as { schedule?: Schedule }).schedule;
  // Switching on picks up events from now on — history doesn't fire.
  await prisma.aiWorkflow.update({ where: { id }, data: { active, updatedById: ctx.user.id, ...(active ? { cursorAt: now, nextRunAt: w.trigger === "SCHEDULE" && s ? nextRun(s, now) : null } : { nextRunAt: null }) } });
  const { logAi } = await import("../feed");
  await logAi({ kind: "AUTOMATION_SETUP", ctx, summary: `Automation ${active ? "switched on" : "switched off"}: ${w.name}`, detail: { workflowId: id, active } });
}

export async function deleteWorkflow(ctx: Ctx, id: string) {
  assertManage(ctx);
  const w = await prisma.aiWorkflow.delete({ where: { id } }).catch(() => null);
  if (!w) throw new NotFoundError("Automation");
  await prisma.aiApproval.updateMany({ where: { workflowId: id, status: "PENDING" }, data: { status: "EXPIRED", note: "The automation was deleted." } });
  const { logAi } = await import("../feed");
  await logAi({ kind: "AUTOMATION_SETUP", ctx, summary: `Automation deleted: ${w.name}`, detail: { workflowId: id } });
}

// ── reading ─────────────────────────────────────────────────────────────────

export async function listWorkflows(ctx: Ctx, now = new Date()) {
  assertView(ctx);
  const rows = await prisma.aiWorkflow.findMany({ orderBy: [{ active: "desc" }, { updatedAt: "desc" }] });
  const since = new Date(now.getTime() - 30 * DAY);
  const counts = await prisma.aiWorkflowRun.groupBy({ by: ["workflowId", "status"], where: { startedAt: { gte: since }, source: { not: "TEST" } }, _count: { _all: true } });
  return rows.map((w) => {
    const c = counts.filter((x) => x.workflowId === w.id);
    const n = (s?: string) => c.filter((x) => !s || x.status === s).reduce((a, x) => a + x._count._all, 0);
    return { ...w, runs30: n(), failed30: n("FAILED"), waiting: n("WAITING_APPROVAL") + n("WAITING") };
  });
}

export async function getWorkflow(ctx: Ctx, id: string) {
  assertView(ctx);
  const w = await prisma.aiWorkflow.findUnique({ where: { id }, include: { runs: { orderBy: { startedAt: "desc" }, take: 30 } } });
  if (!w) throw new NotFoundError("Automation");
  const owner = await prisma.user.findUnique({ where: { id: w.ownerId }, select: { name: true } });
  return { ...w, ownerName: owner?.name ?? null };
}

export async function listRuns(ctx: Ctx, f: { status?: string | null; workflowId?: string | null; page?: number } = {}) {
  assertView(ctx);
  const size = 40, page = Math.max(1, f.page ?? 1);
  const where = { ...(f.status ? { status: f.status } : {}), ...(f.workflowId ? { workflowId: f.workflowId } : {}) };
  const [rows, total] = await Promise.all([
    prisma.aiWorkflowRun.findMany({ where, orderBy: { startedAt: "desc" }, skip: (page - 1) * size, take: size, include: { workflow: { select: { name: true, trigger: true } } } }),
    prisma.aiWorkflowRun.count({ where }),
  ]);
  return { rows, total, page, pages: Math.max(1, Math.ceil(total / size)) };
}

/** Everything that runs by the clock: scheduled automations and agents, and the AI jobs. */
export async function listSchedules(ctx: Ctx) {
  assertView(ctx);
  const [workflows, agents] = await Promise.all([
    prisma.aiWorkflow.findMany({ where: { trigger: "SCHEDULE" }, orderBy: { nextRunAt: "asc" } }),
    prisma.aiAgent.findMany({ orderBy: { nextRunAt: "asc" } }),
  ]);
  const { jobStatus } = await import("@/server/ops/jobs");
  const jobs = (await jobStatus()).filter((j) => ["ai", "ai-reports", "automation"].includes(j.key));
  return { workflows, agents: agents.filter((a) => a.schedule), jobs };
}

// ── running ─────────────────────────────────────────────────────────────────

/** What a test run would do on the latest events (or the trigger's sample) — nothing is changed. */
export async function testWorkflow(ctx: Ctx, i: WorkflowInput) {
  assertView(ctx);
  const agents = await prisma.aiAgent.findMany({ select: { id: true, name: true } });
  const name = (id: string) => agents.find((a) => a.id === id)?.name ?? "an agent";
  const real = (EVENT_TRIGGERS as string[]).includes(i.trigger) ? await latestEvents(i.trigger, new Date(), 5) : [];
  const evs: Payload[] = real.length ? real.map((e) => e.payload) : [TRIGGERS[i.trigger].sample as Payload];
  return {
    sample: !real.length,
    events: evs.map((p) => ({
      payload: p, matched: matches(i.conditions as Condition[], i.match, p),
      steps: (i.steps as Step[]).map((s) => {
        const filled = { ...s } as Record<string, unknown>;
        for (const k of ["title", "body", "notes", "task"]) if (typeof filled[k] === "string") filled[k] = fill(filled[k] as string, p);
        return stepText(filled as Step, name);
      }),
    })),
  };
}

/** Run now: a scheduled / by-hand automation for today, an event automation on its latest matching event. */
export async function runWorkflowNow(ctx: Ctx, id: string) {
  assertManage(ctx);
  if (!(await governance()).automation) throw new AppError("AUTOMATION_OFF", "Automation is switched off (AI Governance).", 503);
  const w = await prisma.aiWorkflow.findUnique({ where: { id } });
  if (!w) throw new NotFoundError("Automation");
  const now = new Date();
  let ev: AutoEvent;
  if (w.trigger === "SCHEDULE" || w.trigger === "MANUAL") ev = { key: `M:${now.getTime()}`, at: now, subjectType: "Workflow", subjectId: w.id, companyId: null, link: `/admin/ai/automation/${w.id}`, payload: { date: now.toISOString().slice(0, 10) } };
  else {
    const latest = (await latestEvents(w.trigger as TriggerKind, now, 50)).find((e) => matches(w.conditions as Condition[], w.match as "ALL" | "ANY", e.payload));
    if (!latest) throw new ValidationError("No recent event matches this automation's conditions.");
    ev = { ...latest, key: `M:${now.getTime()}:${latest.key}` };
  }
  const run = await startRun(w, ev, "MANUAL", ctx.user.id);
  if (!run) throw new ValidationError("It is already running for this event.");
  return prisma.aiWorkflowRun.findUniqueOrThrow({ where: { id: run } });
}

async function startRun(w: Wf, ev: AutoEvent, source: string, startedById: string | null): Promise<string | null> {
  // one run per workflow and event (the unique index catches a race between two workers)
  if (await prisma.aiWorkflowRun.findUnique({ where: { workflowId_subjectKey: { workflowId: w.id, subjectKey: ev.key } }, select: { id: true } })) return null;
  const run = await prisma.aiWorkflowRun.create({
    data: { workflowId: w.id, source, subjectKey: ev.key, subjectType: ev.subjectType, subjectId: ev.subjectId, companyId: ev.companyId, link: ev.link, payload: ev.payload as Prisma.InputJsonValue, startedById },
  }).catch((e: { code?: string }) => { if (e.code === "P2002") return null; throw e; });
  if (!run) return null;
  await prisma.aiWorkflow.update({ where: { id: w.id }, data: { lastRunAt: new Date() } });
  await executeRun(run.id);
  return run.id;
}

const line = (step: number, type: string, ok: boolean, text: string): LogLine => ({ step, type, at: new Date().toISOString(), ok, text: text.slice(0, 600) });

/** Run the steps from where the run stands until it finishes, fails or has to wait. */
export async function executeRun(runId: string) {
  const run = await prisma.aiWorkflowRun.findUnique({ where: { id: runId }, include: { workflow: true } });
  if (!run || !["RUNNING"].includes(run.status)) return;
  const w = run.workflow;
  const steps = w.steps as unknown as Step[];
  const p = run.payload as Payload;
  const log = [...((run.log as unknown as LogLine[]) ?? [])];
  const save = (data: Prisma.AiWorkflowRunUpdateInput) => prisma.aiWorkflowRun.update({ where: { id: runId }, data: { ...data, log: log as unknown as Prisma.InputJsonValue } });
  const { staffCtx } = await import("./notify");
  const owner = await staffCtx(w.ownerId);
  if (!owner) { log.push(line(run.stepIndex, "-", false, "The automation's owner no longer has access to FIRINGI's back office — give it a new owner by saving it again.")); await save({ status: "FAILED", error: "Owner has no access", finishedAt: new Date() }); return; }
  for (let i = run.stepIndex; i < steps.length; i++) {
    const s = steps[i];
    try {
      switch (s.type) {
        case "NOTIFY": {
          const { notifyStaffGroup } = await import("./notify");
          const n = await notifyStaffGroup(s.group, fill(s.title, p), fill(s.body, p), run.link ?? `/admin/ai/automation/${w.id}`, { type: "AiWorkflowRun", id: runId });
          log.push(line(i, s.type, true, `Notified ${n} ${n === 1 ? "person" : "people"}: ${fill(s.title, p)}`));
          break;
        }
        case "TASK": {
          if (!can(owner, "admin.crm.manage")) throw new ForbiddenError("The owner needs the CRM (manage) right to create tasks.");
          const { createTask } = await import("@/server/services/crm");
          const accountOwner = run.companyId ? (await prisma.crmAccount.findUnique({ where: { companyId: run.companyId }, select: { ownerId: true } }))?.ownerId : null;
          const t = await createTask(owner, { kind: run.companyId ? "FOLLOW_UP" : "TASK", companyId: run.companyId ?? undefined, assigneeId: accountOwner ?? owner.user.id, dueAt: new Date(Date.now() + s.dueDays * DAY), title: fill(s.title, p), notes: `${fill(s.notes, p)}\n\n(Automation: ${w.name})`.trim() });
          log.push(line(i, s.type, true, `Task created: ${t.title}`));
          break;
        }
        case "AGENT": {
          const { runAgent } = await import("./agents");
          const r = await runAgent(owner, s.agentId, { task: fill(s.task, p), source: "WORKFLOW", workflowRunId: runId, context: p });
          if (r.status !== "DONE") throw new AppError("AGENT", `The agent didn't run: ${r.error ?? r.status}`);
          log.push(line(i, s.type, true, `Agent report${r.proposals ? ` (${r.proposals} proposal${r.proposals === 1 ? "" : "s"} for approval)` : ""}: ${(r.output ?? "").replace(/\s+/g, " ").slice(0, 400)}`));
          break;
        }
        case "APPROVAL": {
          const g = await governance();
          const title = fill(s.title, p);
          const ap = await prisma.aiApproval.create({ data: { source: "WORKFLOW", workflowId: w.id, workflowRunId: runId, action: "STEP", title: `${w.name}: ${title}`.slice(0, 200), reason: Object.entries(p).slice(0, 6).map(([k, v]) => `${k}: ${v}`).join(" · ").slice(0, 500), detail: { payload: p, nextSteps: steps.slice(i + 1).map((x) => stepText(x)) } as Prisma.InputJsonValue, permission: s.group, expiresAt: new Date(Date.now() + g.approvalHours * 3600_000) } });
          log.push(line(i, s.type, true, `Waiting for approval: ${title}`));
          await save({ status: "WAITING_APPROVAL", stepIndex: i });
          const { notifyStaffGroup } = await import("./notify");
          await notifyStaffGroup(s.group, `Approval needed: ${title}`, `${w.name}\n${ap.reason ?? ""}`, "/admin/ai/automation?tab=APPROVALS", { type: "AiApproval", id: ap.id });
          return;
        }
        case "WAIT": {
          log.push(line(i, s.type, true, `Waiting ${s.hours} h`));
          await save({ status: "WAITING", stepIndex: i + 1, resumeAt: new Date(Date.now() + s.hours * 3600_000) });
          return;
        }
        case "WEBHOOK": {
          const { assertPublicUrl } = await import("@/server/integrations/feeds");
          await assertPublicUrl(s.url);
          const res = await fetch(s.url, { method: "POST", redirect: "manual", signal: AbortSignal.timeout(10_000), headers: { "content-type": "application/json", "user-agent": "FIRINGI-automation/1.0", "x-firingi-automation": w.id },
            body: JSON.stringify({ automation: { id: w.id, name: w.name }, run: runId, trigger: w.trigger, event: p, at: new Date().toISOString() }) });
          if (res.status < 200 || res.status >= 300) throw new AppError("WEBHOOK", `The other system answered ${res.status}.`);
          log.push(line(i, s.type, true, `Sent (${res.status})`));
          break;
        }
        case "REPORT": {
          const { generateReport } = await import("../centre/reports");
          const r = await generateReport(owner, s.kind, { days: s.days, claude: true });
          log.push(line(i, s.type, true, `Report made (${r.byClaude ? "Claude" : "FIRINGI's wording"}): /admin/ai/reports?tab=${s.kind}&run=${r.id}`));
          break;
        }
      }
      await save({ stepIndex: i + 1 });
    } catch (e) {
      const msg = e instanceof AppError ? e.message : e instanceof Error ? e.message : String(e);
      log.push(line(i, s.type, false, msg));
      await save({ status: "FAILED", error: msg.slice(0, 1000), finishedAt: new Date() });
      const { logAi } = await import("../feed");
      await logAi({ kind: "AUTOMATION", summary: `${w.name} failed at step ${i + 1}: ${msg.slice(0, 200)}`, detail: { workflowId: w.id, runId } });
      return;
    }
  }
  await save({ status: "DONE", finishedAt: new Date(), resumeAt: null });
  const { logAi } = await import("../feed");
  await logAi({ kind: "AUTOMATION", summary: `${w.name} ran (${steps.length} step${steps.length === 1 ? "" : "s"})`, detail: { workflowId: w.id, runId, source: run.source, subject: run.subjectKey } });
}

/** A person decided the approval step (or it expired). */
export async function approvalDecided(runId: string, approve: boolean, by: string | null, why?: string) {
  const run = await prisma.aiWorkflowRun.findUnique({ where: { id: runId } });
  if (!run || run.status !== "WAITING_APPROVAL") return;
  const log = [...((run.log as unknown as LogLine[]) ?? []), line(run.stepIndex, "APPROVAL", approve, why ?? `${approve ? "Approved" : "Rejected"}${by ? ` by ${by}` : ""}`)];
  if (!approve) {
    await prisma.aiWorkflowRun.update({ where: { id: runId }, data: { status: "REJECTED", log: log as unknown as Prisma.InputJsonValue, finishedAt: new Date() } });
    return;
  }
  await prisma.aiWorkflowRun.update({ where: { id: runId }, data: { status: "RUNNING", stepIndex: run.stepIndex + 1, log: log as unknown as Prisma.InputJsonValue } });
  await executeRun(runId);
}

export async function cancelRun(ctx: Ctx, runId: string) {
  assertManage(ctx);
  const r = await prisma.aiWorkflowRun.updateMany({ where: { id: runId, status: { in: ["WAITING", "WAITING_APPROVAL"] } }, data: { status: "CANCELLED", finishedAt: new Date() } });
  if (!r.count) throw new ValidationError("Only waiting runs can be cancelled.");
  await prisma.aiApproval.updateMany({ where: { workflowRunId: runId, status: "PENDING" }, data: { status: "EXPIRED", note: `Run cancelled by ${ctx.user.name}` } });
}

// ── the job ─────────────────────────────────────────────────────────────────

/** Every 5 minutes: events → runs, schedules, waits that are over, expired approvals, scheduled agents, budget alert. */
export async function automationJob(now = new Date()) {
  const g = await governance();
  const out = { events: 0, runs: 0, scheduled: 0, resumed: 0, expired: 0, agents: 0, capped: 0 };
  if (g.automation && g.enabled) {
    const active = await prisma.aiWorkflow.findMany({ where: { active: true } });
    for (const w of active) {
      const day = await prisma.aiWorkflowRun.count({ where: { workflowId: w.id, startedAt: { gte: new Date(now.getTime() - DAY) }, source: { in: ["EVENT", "SCHEDULE"] } } });
      let budget = w.maxRunsPerDay - day;
      if (w.trigger === "SCHEDULE") {
        if (!w.nextRunAt || w.nextRunAt > now) continue;
        const s = (w.triggerConfig as { schedule?: Schedule }).schedule;
        const claimed = await prisma.aiWorkflow.updateMany({ where: { id: w.id, nextRunAt: w.nextRunAt }, data: { nextRunAt: s ? nextRun(s, now) : null } });
        if (!claimed.count) continue;
        if (budget <= 0) { out.capped++; continue; }
        const key = `S:${w.nextRunAt.toISOString()}`;
        if (await startRun(w, { key, at: now, subjectType: "Workflow", subjectId: w.id, companyId: null, link: `/admin/ai/automation/${w.id}`, payload: { date: now.toISOString().slice(0, 10) } }, "SCHEDULE", null)) out.scheduled++;
        continue;
      }
      if (w.trigger === "MANUAL") continue;
      const since = w.cursorAt ?? w.updatedAt;
      const evs = await eventsSince(w.trigger as TriggerKind, since, now, 100);
      out.events += evs.length;
      let cursor = since;
      for (const ev of evs) {
        if (budget <= 0) { out.capped++; break; }
        cursor = ev.at > cursor ? ev.at : cursor;
        if (!matches(w.conditions as Condition[], w.match as "ALL" | "ANY", ev.payload)) continue;
        if (await startRun(w, ev, "EVENT", null)) { out.runs++; budget--; }
      }
      if (w.trigger !== "INVOICE_OVERDUE" && cursor > since) await prisma.aiWorkflow.update({ where: { id: w.id }, data: { cursorAt: cursor } });
    }
    // waits that are over
    const waiting = await prisma.aiWorkflowRun.findMany({ where: { status: "WAITING", resumeAt: { lte: now } }, select: { id: true }, take: 100 });
    for (const r of waiting) {
      const c = await prisma.aiWorkflowRun.updateMany({ where: { id: r.id, status: "WAITING" }, data: { status: "RUNNING", resumeAt: null } });
      if (c.count) { await executeRun(r.id); out.resumed++; }
    }
  }
  const { expireApprovals, runScheduledAgents } = await import("./agents");
  out.expired = await expireApprovals(now);
  if (g.agents && g.enabled) out.agents = await runScheduledAgents(now);
  const { budgetAlert, pruneAi } = await import("./governance");
  await budgetAlert(now).catch(() => null);
  if (now.getUTCHours() === 3 && now.getUTCMinutes() < 5) await pruneAi(now).catch(() => null);
  return out;
}

/** For the AI Dashboard and the Automation overview. */
export async function opsSummary(now = new Date()) {
  const day = new Date(now.getTime() - DAY);
  const [active, pending, runs24, failed24, agents, agentRuns24] = await Promise.all([
    prisma.aiWorkflow.count({ where: { active: true } }),
    prisma.aiApproval.count({ where: { status: "PENDING" } }),
    prisma.aiWorkflowRun.count({ where: { startedAt: { gte: day } } }),
    prisma.aiWorkflowRun.count({ where: { startedAt: { gte: day }, status: "FAILED" } }),
    prisma.aiAgent.count({ where: { active: true } }),
    prisma.aiAgentRun.count({ where: { startedAt: { gte: day } } }),
  ]);
  return { active, pending, runs24, failed24, agents, agentRuns24 };
}
