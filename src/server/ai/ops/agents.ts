import "server-only";
/**
 * AI Agents (Phase 67): specialist agents FIRINGI's staff create — a job description (instructions),
 * the tools and data it may use, how freely it may act (report only / propose for approval / act within
 * AI Governance's limits), its model, effort and schedule. A run is one task: Claude works through the
 * tools with the rights of the person it runs for, narrowed to the agent's data areas; actions become
 * proposals in the approval queue unless the agent may act on its own and Governance allows the action.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import type { PermissionCode } from "@/server/rbac/permissions";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { ACT_TOOLS, AGENT_TOOLS, AGENT_TOOL_NAMES, DATA_AREAS, nextRun, redact, type Autonomy, type DataArea, type Payload, type Schedule } from "@/lib/ai-ops";
import { aiTransport, type AiTransport } from "../assistant";
import { TOOLS } from "../tools";
import { AGENT_ONLY_TOOLS } from "./agent-tools";
import { claudeGate, modelFor } from "./governance";
import type { AgentInput } from "./schema";

type BetaMessage = Anthropic.Beta.Messages.BetaMessage;
type BetaMessageParam = Anthropic.Beta.Messages.BetaMessageParam;
type ToolResult = Anthropic.Beta.Messages.BetaToolResultBlockParam;
const MAX_STEPS = 10;
const MAX_TOOL_CHARS = 14_000;
const DAY = 86400_000;

export const mayManageAgents = (ctx: Ctx) => ctx.company.type === "ADMIN" && can(ctx, "admin.ai.agents");
function assertView(ctx: Ctx) { if (ctx.company.type !== "ADMIN" || !can(ctx, "admin.ai.view")) throw new ForbiddenError(); }
function assertManage(ctx: Ctx) { if (!mayManageAgents(ctx)) throw new ForbiddenError("Setting up AI agents needs the AI agents right."); }

// ── set-up ──────────────────────────────────────────────────────────────────

function clean(i: AgentInput) {
  const tools = [...new Set(i.tools.filter((t) => AGENT_TOOL_NAMES.includes(t)))];
  if (!tools.length) throw new ValidationError("Choose at least one tool.");
  if (i.autonomy === "SUGGEST" && tools.every((t) => ACT_TOOLS.includes(t))) throw new ValidationError("A report-only agent needs at least one tool to read with.");
  if (i.schedule && !i.scheduleTask?.trim()) throw new ValidationError("Write the task it does on its schedule.");
  return {
    name: i.name.trim(), role: i.role.trim(), instructions: i.instructions.trim(), icon: i.icon, tone: i.tone, tools,
    dataAreas: [...new Set(i.dataAreas)], autonomy: i.autonomy, model: i.model === "default" ? null : i.model, effort: i.effort,
    maxRunsPerDay: i.maxRunsPerDay, active: i.active,
    schedule: (i.schedule ?? null) as Prisma.InputJsonValue | typeof Prisma.JsonNull, scheduleTask: i.scheduleTask?.trim() || null,
  };
}

export async function saveAgent(ctx: Ctx, id: string | null, i: AgentInput) {
  assertManage(ctx);
  const data = clean(i);
  const nextRunAt = i.schedule && i.active ? nextRun(i.schedule, new Date()) : null;
  const { Prisma: P } = await import("@prisma/client");
  const json = { ...data, schedule: i.schedule ? (i.schedule as unknown as Prisma.InputJsonValue) : P.JsonNull, nextRunAt };
  const a = id
    ? await prisma.aiAgent.update({ where: { id }, data: { ...json, updatedById: ctx.user.id } })
    : await prisma.aiAgent.create({ data: { ...json, template: i.template ?? null, ownerId: ctx.user.id, createdById: ctx.user.id } });
  const { logAi } = await import("../feed");
  await logAi({ kind: "AGENT_SETUP", ctx, summary: `${id ? "Agent changed" : "Agent created"}: ${a.name}`, detail: { agentId: a.id, tools: a.tools, dataAreas: a.dataAreas, autonomy: a.autonomy, model: a.model, schedule: a.schedule, active: a.active } });
  return a;
}

export async function setAgentActive(ctx: Ctx, id: string, active: boolean) {
  assertManage(ctx);
  const a = await prisma.aiAgent.findUnique({ where: { id } });
  if (!a) throw new NotFoundError("Agent");
  const s = a.schedule as Schedule | null;
  await prisma.aiAgent.update({ where: { id }, data: { active, nextRunAt: active && s ? nextRun(s, new Date()) : null, updatedById: ctx.user.id } });
  const { logAi } = await import("../feed");
  await logAi({ kind: "AGENT_SETUP", ctx, summary: `Agent ${active ? "switched on" : "paused"}: ${a.name}`, detail: { agentId: id, active } });
}

export async function deleteAgent(ctx: Ctx, id: string) {
  assertManage(ctx);
  const a = await prisma.aiAgent.delete({ where: { id } }).catch(() => null);
  if (!a) throw new NotFoundError("Agent");
  await prisma.aiApproval.updateMany({ where: { agentId: id, status: "PENDING" }, data: { status: "EXPIRED", note: "The agent was deleted." } });
  const { logAi } = await import("../feed");
  await logAi({ kind: "AGENT_SETUP", ctx, summary: `Agent deleted: ${a.name}`, detail: { agentId: id } });
}

export async function rateRun(ctx: Ctx, runId: string, rating: 1 | -1 | 0) {
  assertView(ctx);
  await prisma.aiAgentRun.update({ where: { id: runId }, data: { rating: rating || null, ratedById: ctx.user.id } });
}

// ── lists & performance ─────────────────────────────────────────────────────

export async function listAgents(ctx: Ctx, now = new Date()) {
  assertView(ctx);
  const agents = await prisma.aiAgent.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }] });
  const stats = await agentStats(agents.map((a) => a.id), new Date(now.getTime() - 30 * DAY));
  return agents.map((a) => ({ ...a, stats: stats.get(a.id) ?? emptyStats() }));
}
const emptyStats = () => ({ runs: 0, done: 0, failed: 0, blocked: 0, tokens: 0, tokensIn: 0, tokensOut: 0, avgMs: 0, proposals: 0, approved: 0, rejected: 0, up: 0, down: 0, successRate: null as number | null, approvalRate: null as number | null, lastRun: null as Date | null });
export async function agentStats(ids: string[], since: Date) {
  const out = new Map<string, ReturnType<typeof emptyStats>>();
  if (!ids.length) return out;
  const [runs, decided] = await Promise.all([
    prisma.aiAgentRun.findMany({ where: { agentId: { in: ids }, startedAt: { gte: since } }, select: { agentId: true, status: true, tokensIn: true, tokensOut: true, durationMs: true, proposals: true, rating: true, startedAt: true } }),
    prisma.aiApproval.groupBy({ by: ["agentId", "status"], where: { agentId: { in: ids }, createdAt: { gte: since } }, _count: { _all: true } }),
  ]);
  for (const id of ids) {
    const r = runs.filter((x) => x.agentId === id), s = emptyStats();
    s.runs = r.length; s.done = r.filter((x) => x.status === "DONE").length; s.failed = r.filter((x) => x.status === "FAILED").length; s.blocked = r.filter((x) => x.status === "BLOCKED").length;
    s.tokensIn = r.reduce((a, x) => a + x.tokensIn, 0); s.tokensOut = r.reduce((a, x) => a + x.tokensOut, 0); s.tokens = s.tokensIn + s.tokensOut;
    const timed = r.filter((x) => x.durationMs); s.avgMs = timed.length ? Math.round(timed.reduce((a, x) => a + (x.durationMs ?? 0), 0) / timed.length) : 0;
    s.proposals = r.reduce((a, x) => a + x.proposals, 0); s.up = r.filter((x) => x.rating === 1).length; s.down = r.filter((x) => x.rating === -1).length;
    const d = decided.filter((x) => x.agentId === id);
    s.approved = d.filter((x) => x.status === "APPROVED").reduce((a, x) => a + x._count._all, 0);
    s.rejected = d.filter((x) => x.status === "REJECTED").reduce((a, x) => a + x._count._all, 0);
    s.successRate = s.done + s.failed ? Math.round((s.done / (s.done + s.failed)) * 100) : null;
    s.approvalRate = s.approved + s.rejected ? Math.round((s.approved / (s.approved + s.rejected)) * 100) : null;
    s.lastRun = r.reduce<Date | null>((a, x) => (!a || x.startedAt > a ? x.startedAt : a), null);
    out.set(id, s);
  }
  return out;
}

export async function getAgent(ctx: Ctx, id: string) {
  assertView(ctx);
  const a = await prisma.aiAgent.findUnique({ where: { id } });
  if (!a) throw new NotFoundError("Agent");
  const [runs, stats, pending] = await Promise.all([
    prisma.aiAgentRun.findMany({ where: { agentId: id }, orderBy: { startedAt: "desc" }, take: 25 }),
    agentStats([id], new Date(Date.now() - 30 * DAY)),
    prisma.aiApproval.count({ where: { agentId: id, status: "PENDING" } }),
  ]);
  const daily = await prisma.$queryRaw<{ day: Date; runs: number; ok: number; tokens: number }[]>`
    SELECT date_trunc('day', "startedAt") AS day, COUNT(*)::int AS runs, COUNT(*) FILTER (WHERE status = 'DONE')::int AS ok, COALESCE(SUM("tokensIn" + "tokensOut"), 0)::int AS tokens
    FROM "AiAgentRun" WHERE "agentId" = ${id} AND "startedAt" >= ${new Date(Date.now() - 30 * DAY)} GROUP BY 1 ORDER BY 1`;
  return { agent: a, runs, stats: stats.get(id) ?? emptyStats(), pending, daily: daily.map((d) => ({ day: d.day.toISOString().slice(0, 10), runs: d.runs, ok: d.ok, tokens: d.tokens })) };
}

/** Agents to choose from (automation steps, templates). */
export async function agentOptions(ctx: Ctx) {
  assertView(ctx);
  return prisma.aiAgent.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, template: true, autonomy: true, tools: true, dataAreas: true, active: true } });
}

// ── running ─────────────────────────────────────────────────────────────────

/** The rights an agent's run reads with: the person's own, narrowed to the agent's data areas. */
export function agentCtx(ctx: Ctx, areas: string[]): Ctx {
  const allowed = new Set<string>(["admin.ai.view", ...areas.flatMap((a) => (DATA_AREAS[a as DataArea]?.perms ?? []) as readonly string[])]);
  return { ...ctx, permissions: new Set([...ctx.permissions].filter((p) => allowed.has(p))) as Set<PermissionCode> };
}

type Runner = { name: string; description: string; properties: Record<string, unknown>; parse: (x: unknown) => { success: true; data: unknown } | { success: false; error: { issues: { message: string }[] } }; act: boolean; run: (ctx: Ctx, input: unknown) => Promise<unknown> };
function runnersFor(names: string[], autonomy: Autonomy): Runner[] {
  const out: Runner[] = [];
  for (const n of names) {
    if (autonomy === "SUGGEST" && ACT_TOOLS.includes(n)) continue;
    const own = AGENT_ONLY_TOOLS.find((t) => t.name === n);
    if (own) { out.push({ name: n, description: own.description, properties: own.properties, parse: (x) => own.input.safeParse(x) as ReturnType<Runner["parse"]>, act: !!own.act, run: (ctx, i) => own.run(ctx, i as never) }); continue; }
    const t = TOOLS.find((x) => x.name === n && x.sides.includes("STAFF"));
    if (t) out.push({ name: n, description: t.description, properties: t.properties, parse: (x) => t.input.safeParse(x) as ReturnType<Runner["parse"]>, act: false, run: (ctx, i) => t.run(ctx, "STAFF", i, ctx.user.locale ?? "en", { channel: "WEB" }) });
  }
  return out;
}

function systemPrompt(a: { name: string; role: string; instructions: string; autonomy: string }, auto: string[]) {
  const acting = a.autonomy === "SUGGEST"
    ? "You can only read and report; you have no tools that change anything."
    : a.autonomy === "APPROVAL"
      ? "Your action tools (create_task, notify_staff) only PROPOSE: each call puts the action in FIRINGI's approval queue, where a person approves or rejects it. Propose only what is clearly worth a person's time, with the facts in the notes and a one-line reason in `why`."
      : `You may act on your own only for: ${auto.join(", ") || "nothing"}. Every other action you call goes to FIRINGI's approval queue for a person to decide. Act only on clear facts from the tools; give a one-line reason in \`why\`.`;
  return [
    `You are "${a.name}", an AI agent working for FIRINGI's back-office staff. FIRINGI is a B2B wholesale marketplace in the Schengen area: restaurants and shops (customers) buy from wholesalers; wholesalers buy from distributors. FIRINGI buys from each supplier and resells, invoicing every buyer.`,
    `Your job: ${a.role}`,
    `Instructions from FIRINGI:\n${a.instructions}`,
    "Use the tools for every number — never guess. The tools read live data with the access of the person you work for, limited to your data areas; if a tool says there is no access, say so and carry on with what you can see.",
    acting,
    "Finish with a short report in English for FIRINGI staff: first the answer in 1–2 sentences, then the few numbers that matter (EUR, excl. VAT unless said), then what you proposed or did, and what a person should do next. Plain words; a small Markdown table only when comparing rows.",
  ].join("\n\n");
}

const textOf = (m: BetaMessage) => m.content.filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
const simulating = () => process.env.ASSISTANT_SIMULATE === "1" && !process.env.ANTHROPIC_API_KEY && process.env.FIRINGI_ENV !== "production";

export type RunInput = { task: string; source: "MANUAL" | "SCHEDULE" | "WORKFLOW" | "TEST"; workflowRunId?: string | null; context?: Payload | null };

/** Run an agent on one task, as `ctx` (the person who started it, or its owner for schedules and workflows). */
export async function runAgent(ctx: Ctx, agentId: string, input: RunInput, now = new Date()) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, "admin.ai.view")) throw new ForbiddenError();
  if (input.source === "MANUAL" && !can(ctx, ["admin.ai.agents", "admin.ai.approve"])) throw new ForbiddenError("Running agents needs the AI agents or AI approvals right.");
  const a = await prisma.aiAgent.findUnique({ where: { id: agentId } });
  if (!a) throw new NotFoundError("Agent");
  const task = input.task.trim();
  if (!task) throw new ValidationError("Write the task for the agent.");
  if (task.length > 4000) throw new ValidationError("Keep the task under 4,000 characters.");
  const run = await prisma.aiAgentRun.create({ data: { agentId, source: input.source, task, workflowRunId: input.workflowRunId ?? null, runById: ctx.user.id === "system" ? null : ctx.user.id, startedAt: now } });
  const block = async (reason: string) => {
    const r = await prisma.aiAgentRun.update({ where: { id: run.id }, data: { status: "BLOCKED", error: reason, finishedAt: new Date(), durationMs: 0 } });
    const { logAi } = await import("../feed");
    await logAi({ kind: "AGENT", ctx, summary: `${a.name} did not run: ${reason}`, detail: { agentId, runId: run.id, source: input.source } });
    return r;
  };
  if (!a.active && input.source !== "MANUAL" && input.source !== "TEST") return block("The agent is paused.");
  const gate = await claudeGate("agents", now);
  if (!gate.ok) return block(gate.reason);
  const g = gate.g;
  const day = new Date(now.getTime() - DAY);
  const [mine, all] = await Promise.all([
    prisma.aiAgentRun.count({ where: { agentId, startedAt: { gte: day }, status: { not: "BLOCKED" }, id: { not: run.id } } }),
    prisma.aiAgentRun.count({ where: { startedAt: { gte: day }, status: { not: "BLOCKED" }, id: { not: run.id } } }),
  ]);
  if (mine >= a.maxRunsPerDay) return block(`Daily limit reached (${a.maxRunsPerDay} runs in 24 hours).`);
  if (all >= g.agentRunsPerDay) return block(`FIRINGI's daily limit for all agents is reached (${g.agentRunsPerDay}).`);
  const transport: AiTransport | null = aiTransport() ?? (simulating() ? (await import("./agent-sim")).simulatedAgentTransport : null);
  if (!transport) return block("Claude isn't connected (no Anthropic API key).");

  const t0 = Date.now();
  const readCtx = agentCtx(ctx, a.dataAreas);
  const runners = runnersFor(a.tools, a.autonomy as Autonomy);
  const byName = new Map(runners.map((r) => [r.name, r]));
  const tools = runners.map((r) => ({ name: r.name, description: r.description, strict: true, input_schema: { type: "object" as const, properties: r.properties, required: Object.keys(r.properties), additionalProperties: false } }));
  const model = await modelFor("agents", a.model);
  const ctxText = input.context ? `\n\nWhat this run is about (from the automation that started it):\n${Object.entries(input.context).filter(([, v]) => v !== null && v !== undefined && v !== "").map(([k, v]) => `- ${k}: ${v}`).join("\n")}` : "";
  const messages: BetaMessageParam[] = [{ role: "user", content: `[Today is ${now.toISOString().slice(0, 10)}]\n\n${task}${ctxText}` }];
  const used: { name: string; input: unknown; ok: boolean; proposalId?: string; done?: boolean }[] = [];
  let tokensIn = 0, tokensOut = 0, answer = "", stop: string | null = null, servedBy: string = model, proposals = 0;
  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const res = await transport({
        model, max_tokens: 16000, system: systemPrompt(a, g.autoActions), tools, tool_choice: { type: "auto" }, messages,
        thinking: { type: "adaptive" }, output_config: { effort: a.effort as "low" | "medium" | "high" }, cache_control: { type: "ephemeral" },
        betas: ["server-side-fallback-2026-07-01"], fallbacks: "default", metadata: { user_id: ctx.user.id },
      });
      tokensIn += (res.usage.input_tokens ?? 0) + (res.usage.cache_read_input_tokens ?? 0) + (res.usage.cache_creation_input_tokens ?? 0);
      tokensOut += res.usage.output_tokens ?? 0;
      servedBy = res.model; stop = res.stop_reason;
      messages.push({ role: "assistant", content: res.content as unknown as Anthropic.Beta.Messages.BetaContentBlockParam[] });
      const said = textOf(res);
      if (said) answer = said;
      if (res.stop_reason === "pause_turn") continue;
      if (res.stop_reason !== "tool_use") break;
      const results: ToolResult[] = [];
      for (const b of res.content) {
        if (b.type !== "tool_use") continue;
        const r = byName.get(b.name);
        const parsed = r?.parse(b.input);
        let content: string, isError = false, proposalId: string | undefined, done = false;
        if (!r) { content = `Unknown tool ${b.name}.`; isError = true; }
        else if (!parsed!.success) { content = `Invalid input: ${parsed!.error.issues.map((x) => x.message).join("; ")}`; isError = true; }
        else if (r.act) {
          const out = await agentAct(ctx, a, run.id, r.name, parsed!.data as Record<string, unknown>, g.autoActions, g.approvalHours);
          content = JSON.stringify(out.result); isError = !out.ok; proposalId = out.proposalId; done = out.done;
          if (out.proposalId) proposals++;
        } else {
          try {
            content = JSON.stringify((await r.run(readCtx, parsed!.data)) ?? null);
            if (g.redact) content = redact(content);
            if (content.length > MAX_TOOL_CHARS) content = `${content.slice(0, MAX_TOOL_CHARS)}… [cut: ask for fewer rows]`;
          } catch (e) {
            isError = true;
            content = e instanceof ForbiddenError ? "No access to that data (outside this agent's data areas or the person's rights)." : e instanceof AppError ? e.message : "The data couldn't be read just now.";
          }
        }
        used.push({ name: b.name, input: b.input, ok: !isError, ...(proposalId ? { proposalId } : {}), ...(done ? { done } : {}) });
        results.push({ type: "tool_result", tool_use_id: b.id, content, ...(isError ? { is_error: true } : {}) });
      }
      messages.push({ role: "user", content: results });
      if (step === MAX_STEPS - 1) stop = "max_steps";
    }
  } catch (e) {
    const msg = e instanceof Anthropic.APIError ? `The AI service answered ${e.status ?? "an error"}: ${e.message.slice(0, 200)}` : e instanceof Error ? e.message : String(e);
    const r = await prisma.aiAgentRun.update({ where: { id: run.id }, data: { status: "FAILED", error: msg.slice(0, 1000), tools: used as Prisma.InputJsonValue, tokensIn, tokensOut, model: servedBy, durationMs: Date.now() - t0, finishedAt: new Date(), proposals } });
    const { logAi } = await import("../feed");
    await logAi({ kind: "AGENT", ctx, summary: `${a.name} failed: ${msg.slice(0, 200)}`, detail: { agentId, runId: run.id, source: input.source }, model: servedBy, tokensIn, tokensOut });
    return r;
  }
  if (stop === "refusal") answer = "The agent declined this task.";
  else if (stop === "max_tokens") answer = `${answer}\n\n(The report was cut short.)`.trim();
  else if (stop === "max_steps" || stop === "tool_use") answer = answer || "The task needed more steps than an agent run allows — make it narrower.";
  if (!answer) answer = "The agent finished without a report.";
  const r = await prisma.aiAgentRun.update({
    where: { id: run.id },
    data: { status: "DONE", output: answer, tools: used as Prisma.InputJsonValue, model: servedBy, byClaude: !simulating() || !!aiTransport(), tokensIn, tokensOut, durationMs: Date.now() - t0, proposals, finishedAt: new Date() },
  });
  const { logAi } = await import("../feed");
  await logAi({ kind: "AGENT", ctx, summary: `${a.name}: ${task.slice(0, 140)}`, detail: { agentId, runId: run.id, source: input.source, tools: used.map((u) => `${u.name}${u.ok ? "" : " (error)"}`), proposals }, model: servedBy, tokensIn, tokensOut });
  if (proposals) {
    const { notifyStaffGroup } = await import("./notify");
    await notifyStaffGroup("admin.ai.approve", `${a.name} proposes ${proposals} action${proposals === 1 ? "" : "s"}`, `${task.slice(0, 200)}\n\nOpen the approval queue to approve or reject.`, "/admin/ai/automation?tab=APPROVALS");
  }
  return r;
}

// ── actions & approvals ─────────────────────────────────────────────────────

/** An agent's action: straight away (act on its own + allowed by Governance), else a proposal for a person. */
async function agentAct(ctx: Ctx, a: { id: string; name: string; autonomy: string }, runId: string, action: string, input: Record<string, unknown>, auto: string[], hours: number) {
  const tool = AGENT_ONLY_TOOLS.find((t) => t.name === action)!;
  if (a.autonomy === "AUTO" && auto.includes(action)) {
    try {
      const result = await tool.run(ctx, input as never);
      const { logAi } = await import("../feed");
      await logAi({ kind: "AGENT_ACTION", ctx, summary: `${a.name} did on its own: ${AGENT_TOOLS[action].label} — ${String(input.title ?? "")}`.slice(0, 480), detail: { agentId: a.id, runId, action, input, result } });
      return { ok: true, done: true, result: { done: true, result } };
    } catch (e) {
      return { ok: false, done: false, result: { done: false, error: e instanceof AppError ? e.message : "The action failed." } };
    }
  }
  const p = await prisma.aiApproval.create({
    data: {
      source: "AGENT", agentId: a.id, agentRunId: runId, action, title: `${AGENT_TOOLS[action]?.label ?? action}: ${String(input.title ?? "")}`.slice(0, 200),
      reason: typeof input.why === "string" ? input.why.slice(0, 500) : null, detail: input as Prisma.InputJsonValue,
      permission: "admin.ai.approve", expiresAt: new Date(Date.now() + hours * 3600_000),
    },
  });
  return { ok: true, done: false, proposalId: p.id, result: { proposed: true, note: "Waiting in FIRINGI's approval queue — a person approves or rejects it. Mention it in your report." } };
}

export async function listApprovals(ctx: Ctx, status: "PENDING" | "DECIDED" = "PENDING") {
  assertView(ctx);
  const rows = await prisma.aiApproval.findMany({ where: status === "PENDING" ? { status: "PENDING" } : { status: { not: "PENDING" } }, orderBy: { createdAt: "desc" }, take: 200 });
  const [agents, workflows, users] = await Promise.all([
    prisma.aiAgent.findMany({ where: { id: { in: rows.map((r) => r.agentId).filter((x): x is string => !!x) } }, select: { id: true, name: true, icon: true, tone: true } }),
    prisma.aiWorkflow.findMany({ where: { id: { in: rows.map((r) => r.workflowId).filter((x): x is string => !!x) } }, select: { id: true, name: true } }),
    prisma.user.findMany({ where: { id: { in: rows.map((r) => r.decidedById).filter((x): x is string => !!x) } }, select: { id: true, name: true } }),
  ]);
  return rows.map((r) => ({
    ...r, agent: agents.find((x) => x.id === r.agentId) ?? null, workflow: workflows.find((x) => x.id === r.workflowId) ?? null,
    decidedBy: users.find((u) => u.id === r.decidedById)?.name ?? null, canDecide: r.status === "PENDING" && can(ctx, r.permission as PermissionCode),
  }));
}

/** A person approves (the action runs with their rights) or rejects. Workflow approvals continue or stop the run. */
export async function decideApproval(ctx: Ctx, id: string, approve: boolean, note: string | null) {
  assertView(ctx);
  const p = await prisma.aiApproval.findUnique({ where: { id } });
  if (!p) throw new NotFoundError("Approval");
  if (!can(ctx, p.permission as PermissionCode)) throw new ForbiddenError("You can't decide this approval.");
  const claimed = await prisma.aiApproval.updateMany({ where: { id, status: "PENDING" }, data: { status: approve ? "APPROVED" : "REJECTED", decidedById: ctx.user.id, decidedAt: new Date(), note: note?.trim() || null } });
  if (!claimed.count) throw new ValidationError("This was already decided.");
  const { logAi } = await import("../feed");
  let result: unknown = null, failed: string | null = null;
  if (approve && p.source === "AGENT") {
    const tool = AGENT_ONLY_TOOLS.find((t) => t.name === p.action);
    try { result = tool ? await tool.run(ctx, p.detail as never) : null; } catch (e) { failed = e instanceof AppError ? e.message : e instanceof Error ? e.message : "The action failed."; }
    await prisma.aiApproval.update({ where: { id }, data: failed ? { status: "FAILED", result: { error: failed } } : { result: (result ?? null) as Prisma.InputJsonValue } });
  }
  await logAi({ kind: approve ? (failed ? "APPROVAL_FAILED" : "APPROVED") : "REJECTED", ctx, summary: `${approve ? (failed ? "Approved but failed" : "Approved") : "Rejected"}: ${p.title}`.slice(0, 480), detail: { approvalId: id, source: p.source, action: p.action, agentId: p.agentId, workflowRunId: p.workflowRunId, note, result, error: failed } });
  if (p.source === "WORKFLOW" && p.workflowRunId) {
    const { approvalDecided } = await import("./workflows");
    await approvalDecided(p.workflowRunId, approve, ctx.user.name);
  }
  if (failed) throw new AppError("ACTION_FAILED", `Approved, but the action failed: ${failed}`, 400);
  return { status: approve ? "APPROVED" : "REJECTED", result };
}

/** Proposals nobody decided in time expire (workflow runs waiting on them stop). */
export async function expireApprovals(now = new Date()) {
  const due = await prisma.aiApproval.findMany({ where: { status: "PENDING", expiresAt: { lt: now } }, select: { id: true, workflowRunId: true } });
  if (!due.length) return 0;
  await prisma.aiApproval.updateMany({ where: { id: { in: due.map((d) => d.id) }, status: "PENDING" }, data: { status: "EXPIRED", decidedAt: now } });
  const { approvalDecided } = await import("./workflows");
  for (const d of due) if (d.workflowRunId) await approvalDecided(d.workflowRunId, false, null, "The approval expired.");
  return due.length;
}

/** Scheduled agents that are due (the automation job). */
export async function runScheduledAgents(now = new Date()) {
  const due = await prisma.aiAgent.findMany({ where: { active: true, nextRunAt: { lte: now } }, take: 20 });
  const { staffCtx } = await import("./notify");
  let ran = 0;
  for (const a of due) {
    const s = a.schedule as Schedule | null;
    // claim this slot first (another worker may be running the same job)
    const claimed = await prisma.aiAgent.updateMany({ where: { id: a.id, nextRunAt: a.nextRunAt }, data: { nextRunAt: s ? nextRun(s, now) : null } });
    if (!claimed.count) continue;
    const ctx = await staffCtx(a.ownerId);
    if (!ctx) { await prisma.aiAgentRun.create({ data: { agentId: a.id, source: "SCHEDULE", task: a.scheduleTask ?? "", status: "BLOCKED", error: "The agent's owner no longer has access to FIRINGI's back office.", finishedAt: now } }); continue; }
    await runAgent(ctx, a.id, { task: a.scheduleTask ?? a.role, source: "SCHEDULE" }, now).catch((e) => console.error("agent run", a.id, e));
    ran++;
  }
  return ran;
}
