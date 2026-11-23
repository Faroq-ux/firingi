/** Phase 67 input shapes (zod) — shared by the services and the server actions. */
import { z } from "zod";
import { AI_MODELS } from "@/lib/ai";
import { REPORTS } from "@/lib/ai-centre";
import { AGENT_ICONS, AGENT_TONES, AGENT_TOOL_NAMES, DATA_AREA_KEYS, EFFORTS, OPS, STAFF_GROUPS, TRIGGER_KINDS, type DataArea, type Op, type StaffGroup, type TriggerKind } from "@/lib/ai-ops";

const group = z.enum(Object.keys(STAFF_GROUPS) as [StaffGroup, ...StaffGroup[]]);
export const scheduleSchema = z.object({
  every: z.enum(["HOURLY", "DAILY", "WEEKDAYS", "WEEKLY", "MONTHLY"]), hour: z.number().int().min(0).max(23),
  weekday: z.number().int().min(1).max(7), day: z.number().int().min(1).max(28),
});
const text = (max: number) => z.string().trim().max(max);

export const stepSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("NOTIFY"), group, title: text(150).min(2, "Give the message a title."), body: text(1500) }),
  z.object({ type: z.literal("TASK"), title: text(150).min(2, "Say what the task is."), notes: text(2000), dueDays: z.number().int().min(0).max(30) }),
  z.object({ type: z.literal("AGENT"), agentId: z.string().min(1, "Choose an agent."), task: text(2000).min(3, "Write what the agent should do.") }),
  z.object({ type: z.literal("APPROVAL"), title: text(150).min(2, "Say what is being approved."), group }),
  z.object({ type: z.literal("WAIT"), hours: z.number().int().min(1).max(720) }),
  z.object({ type: z.literal("WEBHOOK"), url: z.string().trim().url("Enter the full https:// address.").max(500) }),
  z.object({ type: z.literal("REPORT"), kind: z.enum(REPORTS), days: z.number().int().min(1).max(90) }),
]);

export const workflowSchema = z.object({
  name: text(120).min(2, "Name the automation."),
  description: text(500).optional().nullable(),
  trigger: z.enum(TRIGGER_KINDS as [TriggerKind, ...TriggerKind[]]),
  schedule: scheduleSchema.optional().nullable(),
  conditions: z.array(z.object({ field: z.string().min(1).max(40), op: z.enum(Object.keys(OPS) as [Op, ...Op[]]), value: text(200) })).max(10),
  match: z.enum(["ALL", "ANY"]),
  steps: z.array(stepSchema).min(1, "Add at least one step.").max(10),
  maxRunsPerDay: z.number().int().min(1).max(1000),
  template: z.string().max(40).optional().nullable(),
});
export type WorkflowInput = z.infer<typeof workflowSchema>;

export const agentSchema = z.object({
  name: text(80).min(2, "Name the agent."),
  role: text(200).min(5, "Describe its job in one line."),
  instructions: text(6000).min(20, "Write its instructions (at least a sentence or two)."),
  icon: z.enum(AGENT_ICONS),
  tone: z.enum(AGENT_TONES),
  tools: z.array(z.string().refine((t) => AGENT_TOOL_NAMES.includes(t), "Unknown tool")).min(1, "Choose at least one tool."),
  dataAreas: z.array(z.enum(DATA_AREA_KEYS as [DataArea, ...DataArea[]])),
  autonomy: z.enum(["SUGGEST", "APPROVAL", "AUTO"]),
  model: z.enum(["default", ...AI_MODELS]),
  effort: z.enum(EFFORTS),
  maxRunsPerDay: z.number().int().min(1).max(500),
  active: z.boolean(),
  schedule: scheduleSchema.nullable(),
  scheduleTask: text(2000).nullable(),
  template: z.string().max(40).nullable().optional(),
});
export type AgentInput = z.infer<typeof agentSchema>;

export const governanceSchema = z.object({
  enabled: z.boolean(), agents: z.boolean(), automation: z.boolean(),
  models: z.object({ assistant: z.enum(["default", ...AI_MODELS]), agents: z.enum(["default", ...AI_MODELS]), reports: z.enum(["default", ...AI_MODELS]) }),
  monthlyTokens: z.number().int().min(0).max(10_000_000_000), budgetStops: z.enum(["AGENTS", "ALL"]), alertPct: z.number().int().min(10).max(100),
  autoActions: z.array(z.enum(["create_task", "notify_staff"])), redact: z.boolean(), approvalHours: z.number().int().min(1).max(720),
  agentRunsPerDay: z.number().int().min(1).max(5000), retentionDays: z.number().int().min(30).max(3650),
  pricePerMTokIn: z.number().min(0).max(10_000), pricePerMTokOut: z.number().min(0).max(10_000),
}).partial();
