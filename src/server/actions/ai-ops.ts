"use server";
/** AI Centre, Phase 67: automations, AI agents, approvals and AI Governance (the services re-check every right). */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { defineAction } from "./_action";
import { agentSchema, governanceSchema, workflowSchema } from "@/server/ai/ops/schema";
import { firstIssue } from "@/server/ai/ops/parse";

const done = <T>(v: T) => { revalidatePath("/admin/ai", "layout"); return v; };
const id = z.string().min(1).max(40);

export const saveWorkflowAction = defineAction({
  permission: "admin.ai.automate", schema: z.object({ id: id.nullable(), input: z.unknown() }),
  handler: async (ctx, i) => { const w = await (await import("@/server/ai/ops/workflows")).saveWorkflow(ctx, i.id, firstIssue(workflowSchema, i.input)); return done({ id: w.id }); },
});
export const setWorkflowActiveAction = defineAction({ permission: "admin.ai.automate", schema: z.object({ id, active: z.boolean() }), handler: async (ctx, i) => done(await (await import("@/server/ai/ops/workflows")).setWorkflowActive(ctx, i.id, i.active)) });
export const deleteWorkflowAction = defineAction({ permission: "admin.ai.automate", schema: z.object({ id }), handler: async (ctx, i) => done(await (await import("@/server/ai/ops/workflows")).deleteWorkflow(ctx, i.id)) });
export const testWorkflowAction = defineAction({ permission: "admin.ai.view", schema: z.object({ input: z.unknown() }), handler: async (ctx, i) => (await import("@/server/ai/ops/workflows")).testWorkflow(ctx, firstIssue(workflowSchema, i.input)) });
export const runWorkflowNowAction = defineAction({ permission: "admin.ai.automate", schema: z.object({ id }), handler: async (ctx, i) => { const r = await (await import("@/server/ai/ops/workflows")).runWorkflowNow(ctx, i.id); return done({ id: r.id, status: r.status }); } });
export const cancelRunAction = defineAction({ permission: "admin.ai.automate", schema: z.object({ id }), handler: async (ctx, i) => done(await (await import("@/server/ai/ops/workflows")).cancelRun(ctx, i.id)) });

export const saveAgentAction = defineAction({
  permission: "admin.ai.agents", schema: z.object({ id: id.nullable(), input: z.unknown() }),
  handler: async (ctx, i) => { const a = await (await import("@/server/ai/ops/agents")).saveAgent(ctx, i.id, firstIssue(agentSchema, i.input)); return done({ id: a.id }); },
});
export const setAgentActiveAction = defineAction({ permission: "admin.ai.agents", schema: z.object({ id, active: z.boolean() }), handler: async (ctx, i) => done(await (await import("@/server/ai/ops/agents")).setAgentActive(ctx, i.id, i.active)) });
export const deleteAgentAction = defineAction({ permission: "admin.ai.agents", schema: z.object({ id }), handler: async (ctx, i) => done(await (await import("@/server/ai/ops/agents")).deleteAgent(ctx, i.id)) });
export const runAgentAction = defineAction({
  permission: ["admin.ai.agents", "admin.ai.approve"], schema: z.object({ id, task: z.string().trim().min(3, "Write the task.").max(4000) }),
  handler: async (ctx, i) => { const r = await (await import("@/server/ai/ops/agents")).runAgent(ctx, i.id, { task: i.task, source: "MANUAL" }); return done({ id: r.id, status: r.status, error: r.error }); },
});
export const rateAgentRunAction = defineAction({ permission: "admin.ai.view", schema: z.object({ id, rating: z.union([z.literal(1), z.literal(-1), z.literal(0)]) }), handler: async (ctx, i) => done(await (await import("@/server/ai/ops/agents")).rateRun(ctx, i.id, i.rating)) });

export const decideAiApprovalAction = defineAction({
  permission: "admin.ai.view", schema: z.object({ id, approve: z.boolean(), note: z.string().trim().max(500).optional().nullable() }),
  handler: async (ctx, i) => done(await (await import("@/server/ai/ops/agents")).decideApproval(ctx, i.id, i.approve, i.note ?? null)),
});

export const saveGovernanceAction = defineAction({ permission: "admin.ai.govern", schema: governanceSchema, handler: async (ctx, i) => done(await (await import("@/server/ai/ops/governance")).saveGovernance(ctx, i)) });
