import "server-only";
/**
 * AI Governance (Phase 67): FIRINGI's rules for every use of Claude — a master switch, switches for
 * agents and automation, the model per feature, a monthly token budget, what agents may do without a
 * person, personal-data redaction, approval expiry and how long the AI's records are kept. Every
 * Claude call (assistant, WhatsApp, agents, Claude-written reports) asks `claudeGate` first.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { AppError, ForbiddenError } from "@/server/errors";
import { mergeGovernance, type Governance } from "@/lib/ai-ops";
import type { AiModel } from "@/lib/ai";

const KEY = "ai.governance";
const DAY = 86400_000;

export async function governance(): Promise<Governance> {
  const row = await prisma.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: KEY } });
  return mergeGovernance(row?.value as Partial<Governance> | null);
}

export async function saveGovernance(ctx: Ctx, input: Partial<Governance>) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, "admin.ai.govern")) throw new ForbiddenError();
  const before = await governance();
  const next = mergeGovernance({ ...before, ...input, models: { ...before.models, ...(input.models ?? {}) } });
  await prisma.setting.upsert({
    where: { scope_scopeId_key: { scope: "GLOBAL", scopeId: "", key: KEY } },
    update: { value: next as unknown as Prisma.InputJsonValue, updatedById: ctx.user.id }, create: { scope: "GLOBAL", key: KEY, value: next as unknown as Prisma.InputJsonValue, updatedById: ctx.user.id },
  });
  const changed = (Object.keys(next) as (keyof Governance)[]).filter((k) => JSON.stringify(next[k]) !== JSON.stringify(before[k]));
  const { logAi } = await import("../feed");
  await logAi({ kind: "GOVERNANCE", ctx, summary: `AI Governance changed: ${changed.join(", ") || "nothing"}`, detail: { before, after: next, changed } });
  return next;
}

const monthStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

/** Tokens used this calendar month (every Claude call is logged with its tokens). */
export async function usageThisMonth(now = new Date()) {
  const a = await prisma.aiActivity.aggregate({ where: { at: { gte: monthStart(now) } }, _sum: { tokensIn: true, tokensOut: true } });
  const tokensIn = a._sum.tokensIn ?? 0, tokensOut = a._sum.tokensOut ?? 0;
  return { tokensIn, tokensOut, total: tokensIn + tokensOut };
}

export type ClaudeFeature = "assistant" | "agents" | "reports";

/** May this feature call Claude now? Returns the reason when not. */
export async function claudeGate(feature: ClaudeFeature, now = new Date()): Promise<{ ok: true; g: Governance } | { ok: false; g: Governance; code: string; reason: string }> {
  const g = await governance();
  if (!g.enabled) return { ok: false, g, code: "AI_OFF", reason: "FIRINGI has switched off the AI (AI Governance)." };
  if (feature === "agents" && !g.agents) return { ok: false, g, code: "AGENTS_OFF", reason: "AI agents are switched off (AI Governance)." };
  if (g.monthlyTokens > 0 && (feature === "agents" || g.budgetStops === "ALL")) {
    const u = await usageThisMonth(now);
    if (u.total >= g.monthlyTokens) return { ok: false, g, code: "AI_BUDGET", reason: `This month's AI budget (${g.monthlyTokens.toLocaleString("en")} tokens) is used up.` };
  }
  return { ok: true, g };
}
export async function assertClaude(feature: ClaudeFeature) {
  const r = await claudeGate(feature);
  if (!r.ok) throw new AppError(r.code, r.reason, 503);
  return r.g;
}

/** The model a feature uses: its own choice in AI Governance, else the AI settings' default. */
export async function modelFor(feature: ClaudeFeature, own?: string | null): Promise<AiModel> {
  const [{ aiSettings }, g] = await Promise.all([import("../assistant"), governance()]);
  const base = (await aiSettings()).model;
  const pick = own && own !== "default" ? own : g.models[feature] !== "default" ? g.models[feature] : base;
  return pick as AiModel;
}

/** Once a month at the alert level (and at 100%): tell the AI Centre's governors. */
export async function budgetAlert(now = new Date()) {
  const g = await governance();
  if (!g.monthlyTokens) return null;
  const u = await usageThisMonth(now);
  const pct = Math.floor((u.total / g.monthlyTokens) * 100);
  const level = pct >= 100 ? 100 : pct >= g.alertPct ? g.alertPct : 0;
  if (!level) return { pct, sent: false };
  const mark = `budget:${now.toISOString().slice(0, 7)}:${level}`;
  if (await prisma.aiActivity.findFirst({ where: { kind: "BUDGET", summary: { contains: mark } } })) return { pct, sent: false };
  const { notifyStaffGroup } = await import("./notify");
  await notifyStaffGroup("admin.ai.govern", level >= 100 ? "AI budget used up" : `AI budget ${pct}% used`,
    `${u.total.toLocaleString("en")} of ${g.monthlyTokens.toLocaleString("en")} tokens used this month.${level >= 100 ? (g.budgetStops === "ALL" ? " Every Claude call is stopped until next month or until the budget is raised." : " AI agents are stopped until next month or until the budget is raised.") : ""}`,
    "/admin/ai/governance");
  const { logAi } = await import("../feed");
  await logAi({ kind: "BUDGET", summary: `AI budget alert ${pct}% (${mark})`, detail: { ...u, budget: g.monthlyTokens } });
  return { pct, sent: true };
}

/** Old AI records go after the retention period (activity log, agent runs, finished workflow runs, decided approvals). */
export async function pruneAi(now = new Date()) {
  const g = await governance();
  const before = new Date(now.getTime() - g.retentionDays * DAY);
  const [a, r, w, p] = await Promise.all([
    prisma.aiActivity.deleteMany({ where: { at: { lt: before } } }),
    prisma.aiAgentRun.deleteMany({ where: { startedAt: { lt: before } } }),
    prisma.aiWorkflowRun.deleteMany({ where: { startedAt: { lt: before }, status: { in: ["DONE", "FAILED", "REJECTED", "CANCELLED"] } } }),
    prisma.aiApproval.deleteMany({ where: { createdAt: { lt: before }, status: { not: "PENDING" } } }),
  ]);
  return { activity: a.count, agentRuns: r.count, workflowRuns: w.count, approvals: p.count };
}

/** Who holds which AI right (for the Permissions tab). */
export async function aiPermissionMatrix() {
  const { SYSTEM_ROLES } = await import("@/server/rbac/system-roles");
  const codes = ["admin.ai.view", "admin.ai.automate", "admin.ai.agents", "admin.ai.approve", "admin.ai.govern"] as const;
  const admin = await prisma.company.findFirst({ where: { type: "ADMIN" }, orderBy: { createdAt: "asc" }, select: { id: true } });
  const roles = await prisma.role.findMany({ where: { OR: [{ isSystem: true }, { companyId: admin?.id ?? "-" }] }, include: { permissions: { select: { permissionCode: true } }, _count: { select: { members: true } } }, orderBy: { name: "asc" } }).catch(() => []);
  return roles
    .filter((r) => r.appliesTo.includes("ADMIN"))
    .map((r) => {
      const sys = r.isSystem ? SYSTEM_ROLES.find((s) => s.key === r.key) : undefined;
      const all = sys?.permissions.includes("ALL_ADMIN" as never);
      const have = new Set(r.permissions.map((p) => p.permissionCode));
      return { id: r.id, name: r.name, system: r.isSystem, people: r._count.members, rights: Object.fromEntries(codes.map((c) => [c, !!all || have.has(c) || !!sys?.permissions.includes(c as never)])) as Record<(typeof codes)[number], boolean> };
    });
}

/** The numbers on the AI Governance page (FIRINGI staff with the AI right). */
export async function governanceData(ctx: Ctx) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, "admin.ai.view")) throw new ForbiddenError();
  const [pending, autoAgents, byModel] = await Promise.all([
    prisma.aiApproval.count({ where: { status: "PENDING" } }),
    prisma.aiAgent.count({ where: { autonomy: "AUTO", active: true } }),
    prisma.aiActivity.groupBy({ by: ["model"], where: { at: { gte: new Date(Date.now() - 30 * DAY) }, model: { not: null } }, _sum: { tokensIn: true, tokensOut: true }, _count: { _all: true } }),
  ]);
  return { pending, autoAgents, byModel: byModel.map((m) => ({ model: m.model ?? "", calls: m._count._all, tokensIn: m._sum.tokensIn ?? 0, tokensOut: m._sum.tokensOut ?? 0 })) };
}
