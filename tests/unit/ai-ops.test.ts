import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { conditionHolds, fill, matches, mergeGovernance, nextRun, redact, ruleSentence, scheduleText, tokenCost, AGENT_TEMPLATES, AGENT_TOOLS, TRIGGERS, WORKFLOW_TEMPLATES, STAFF_GROUPS } from "@/lib/ai-ops";
import { agentSchema, workflowSchema } from "@/server/ai/ops/schema";
import { JOBS } from "@/server/ops/jobs";
import { PERMISSIONS } from "@/server/rbac/permissions";

describe("conditions", () => {
  const p = { total: 6200, buyer: "Kebab House", country: "PT", score: 80 };
  it("compares numbers and text", () => {
    expect(conditionHolds({ field: "total", op: "gt", value: "5000" }, p)).toBe(true);
    expect(conditionHolds({ field: "total", op: "lte", value: "5000" }, p)).toBe(false);
    expect(conditionHolds({ field: "score", op: "gte", value: "80" }, p)).toBe(true);
    expect(conditionHolds({ field: "country", op: "eq", value: "pt" }, p)).toBe(true);
    expect(conditionHolds({ field: "buyer", op: "contains", value: "kebab" }, p)).toBe(true);
    expect(conditionHolds({ field: "buyer", op: "ne", value: "Kebab House" }, p)).toBe(false);
    expect(conditionHolds({ field: "missing", op: "eq", value: "x" }, p)).toBe(false);
    expect(conditionHolds({ field: "buyer", op: "gt", value: "1" }, p)).toBe(false);
  });
  it("ALL / ANY, and no conditions = always", () => {
    const c = [{ field: "total", op: "gt" as const, value: "9000" }, { field: "country", op: "eq" as const, value: "PT" }];
    expect(matches(c, "ALL", p)).toBe(false);
    expect(matches(c, "ANY", p)).toBe(true);
    expect(matches([], "ALL", p)).toBe(true);
  });
  it("fills {{values}} and leaves unknown names visible", () => {
    expect(fill("Order {{ number }} — €{{total}} from {{buyer}} {{nope}}", { number: "ORD-1", total: 10, buyer: "X" })).toBe("Order ORD-1 — €10 from X {{nope}}");
  });
});

describe("schedules", () => {
  const at = new Date("2026-11-23T08:30:00Z"); // a Monday
  it("next run", () => {
    expect(nextRun({ every: "HOURLY", hour: 0, weekday: 1, day: 1 }, at).toISOString()).toBe("2026-11-23T09:00:00.000Z");
    expect(nextRun({ every: "DAILY", hour: 7, weekday: 1, day: 1 }, at).toISOString()).toBe("2026-11-24T07:00:00.000Z");
    expect(nextRun({ every: "DAILY", hour: 9, weekday: 1, day: 1 }, at).toISOString()).toBe("2026-11-23T09:00:00.000Z");
    expect(nextRun({ every: "WEEKLY", hour: 6, weekday: 1, day: 1 }, at).toISOString()).toBe("2026-11-30T06:00:00.000Z");
    expect(nextRun({ every: "WEEKDAYS", hour: 7, weekday: 1, day: 1 }, new Date("2026-11-27T08:00:00Z")).toISOString()).toBe("2026-11-30T07:00:00.000Z"); // Fri → Mon
    expect(nextRun({ every: "MONTHLY", hour: 6, weekday: 1, day: 1 }, at).toISOString()).toBe("2026-12-01T06:00:00.000Z");
  });
  it("says it in words", () => {
    expect(scheduleText({ every: "WEEKLY", hour: 6, weekday: 1, day: 1 })).toBe("every Monday at 06:00 UTC");
  });
});

describe("rules in words", () => {
  it("one sentence per automation", () => {
    const t = WORKFLOW_TEMPLATES.find((x) => x.key === "big-order")!;
    expect(ruleSentence({ ...t, triggerConfig: {} })).toBe("When an order is placed and order total (€, excl. vat) is more than 5000: notify Finance team: “Big order {{number}}: €{{total}}”.");
    const w = WORKFLOW_TEMPLATES.find((x) => x.key === "weekly-report")!;
    expect(ruleSentence({ ...w, triggerConfig: { schedule: w.schedule } })).toContain("Run every Monday at 06:00 UTC: make the executive report (7 days), then notify");
  });
  it("templates are valid automations and use real triggers, fields and staff groups", () => {
    for (const t of WORKFLOW_TEMPLATES) {
      const steps = t.steps.map((s) => (s.type === "AGENT" ? { ...s, agentId: "agent1" } : s));
      const r = workflowSchema.safeParse({ name: t.name, description: t.description, trigger: t.trigger, schedule: t.schedule ?? null, conditions: t.conditions, match: t.match, steps, maxRunsPerDay: 50 });
      expect(r.success, `${t.key}: ${!r.success && r.error.issues.map((i) => i.message).join(", ")}`).toBe(true);
      for (const c of t.conditions) expect(Object.keys(TRIGGERS[t.trigger].fields)).toContain(c.field);
    }
    for (const g of Object.keys(STAFF_GROUPS)) expect(PERMISSIONS[g as keyof typeof PERMISSIONS], g).toBeTruthy();
  });
  it("agent templates are valid agents with known tools", () => {
    for (const a of AGENT_TEMPLATES) {
      const r = agentSchema.safeParse({ name: a.name, role: a.role, instructions: a.instructions, icon: a.icon, tone: a.tone, tools: a.tools, dataAreas: a.data, autonomy: a.autonomy, model: "default", effort: "medium", maxRunsPerDay: 24, active: true, schedule: a.schedule, scheduleTask: a.task, template: a.key });
      expect(r.success, a.key).toBe(true);
      for (const t of a.tools) expect(AGENT_TOOLS[t], t).toBeTruthy();
    }
  });
  it("needs at least one step and a real URL for webhooks", () => {
    expect(workflowSchema.safeParse({ name: "x x", trigger: "MANUAL", conditions: [], match: "ALL", steps: [], maxRunsPerDay: 5 }).success).toBe(false);
    expect(workflowSchema.safeParse({ name: "x x", trigger: "MANUAL", conditions: [], match: "ALL", steps: [{ type: "WEBHOOK", url: "not a url" }], maxRunsPerDay: 5 }).success).toBe(false);
  });
});

describe("governance", () => {
  it("defaults and clamps", () => {
    const g = mergeGovernance({ monthlyTokens: -5, alertPct: 500, approvalHours: 0, autoActions: ["notify_staff", "drop_tables"], models: { assistant: "nope" as never, agents: "claude-haiku-5-5", reports: "default" } });
    expect(g.enabled).toBe(true);
    expect(g.monthlyTokens).toBe(0);
    expect(g.alertPct).toBe(100);
    expect(g.approvalHours).toBe(1);
    expect(g.autoActions).toEqual(["notify_staff"]);
    expect(g.models).toEqual({ assistant: "default", agents: "claude-haiku-5-5", reports: "default" });
  });
  it("cost only when prices are set", () => {
    expect(tokenCost({ pricePerMTokIn: 0, pricePerMTokOut: 0 }, 1e6, 1e6)).toBeNull();
    expect(tokenCost({ pricePerMTokIn: 3, pricePerMTokOut: 15 }, 2e6, 1e5)).toBe(7.5);
  });
  it("redacts emails, phone numbers and IBANs but keeps dates, amounts and ids", () => {
    const out = redact(JSON.stringify({ email: "ana.silva@kebab.pt", phone: "+351 912 345 678", iban: "PT50 0002 0123 1234 5678 9015 4", due: "2026-11-07", open: 1840.5, id: "cmhx1a2b3c4d5e6f7g8h9" }));
    expect(out).not.toContain("ana.silva");
    expect(out).not.toContain("912 345");
    expect(out).not.toContain("0123 1234");
    expect(out).toContain("2026-11-07");
    expect(out).toContain("1840.5");
    expect(out).toContain("cmhx1a2b3c4d5e6f7g8h9");
  });
});

describe("scheduler", () => {
  it("calls every job that has an endpoint", () => {
    const src = readFileSync("scripts/ops/scheduler.mjs", "utf8");
    const scheduled = new Set([...src.matchAll(/job: "([^"]+)"/g)].map((m) => m[1]));
    const missing = JOBS.filter((j) => j.path && !scheduled.has(j.key)).map((j) => j.key);
    expect(missing).toEqual([]);
  });
});
