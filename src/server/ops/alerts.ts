/**
 * Built-in alerts: every 5 minutes (/api/cron/ops) the health checks are turned into alerts.
 * One open alert per problem; FIRINGI's super admins are told when it opens (and again every
 * 6 hours while it lasts, or when it gets worse) and when it is resolved. Env-check findings
 * outside production and plain "ok" checks never alert.
 */
import "server-only";
import { prisma } from "@/server/db";
import { healthReport, type Check } from "./health";

const RENOTIFY_HOURS = 6;

async function superAdmins() {
  const rows = await prisma.membership.findMany({ where: { status: "ACTIVE", company: { type: "ADMIN" }, roles: { some: { role: { key: "SUPER_ADMIN" } } } }, select: { userId: true } });
  return [...new Set(rows.map((r) => r.userId))];
}

async function tell(event: "ops.alert" | "ops.resolved", vars: Record<string, string>, ref: string) {
  const { notify } = await import("@/server/notify/dispatch");
  const users = await superAdmins();
  if (users.length) await notify(event, users.map((userId) => ({ userId, link: "/admin/settings/system-health" })), vars, { ref: { type: "OpsAlert", id: ref } });
}

export async function checkAndAlert(now = new Date()) {
  const report = await healthReport(now);
  const problems = report.checks.filter((c) => c.state !== "ok" && !(c.key.startsWith("env:") && c.state === "warning"));
  const open = await prisma.opsAlert.findMany({ where: { resolvedAt: null } });
  const byKey = new Map(open.map((a) => [a.key, a]));
  let opened = 0, resolved = 0, renotified = 0;
  for (const c of problems) {
    const severity = c.state === "critical" ? ("CRITICAL" as const) : ("WARNING" as const);
    const a = byKey.get(c.key);
    if (!a) {
      const created = await prisma.opsAlert.create({ data: { key: c.key, severity, title: c.label, detail: c.detail, notifiedAt: now } }).catch(() => null); // unique: another run raced us
      if (created) { opened++; await tell("ops.alert", vars(c, severity), created.id); }
      continue;
    }
    const worse = a.severity === "WARNING" && severity === "CRITICAL";
    const due = !a.notifiedAt || now.getTime() - a.notifiedAt.getTime() > RENOTIFY_HOURS * 3600_000;
    await prisma.opsAlert.update({ where: { id: a.id }, data: { lastSeenAt: now, detail: c.detail, severity: worse ? "CRITICAL" : a.severity, ...(worse || due ? { notifiedAt: now } : {}) } });
    if (worse || due) { renotified++; await tell("ops.alert", vars(c, worse ? "CRITICAL" : a.severity), a.id); }
  }
  const stillBad = new Set(problems.map((p) => p.key));
  for (const a of open) {
    if (stillBad.has(a.key)) continue;
    await prisma.opsAlert.update({ where: { id: a.id }, data: { resolvedAt: now } });
    resolved++;
    await tell("ops.resolved", { title: a.title }, a.id);
  }
  return { status: report.status, problems: problems.length, opened, renotified, resolved };
}

const vars = (c: Check, severity: "WARNING" | "CRITICAL") => ({ severity: severity === "CRITICAL" ? "CRITICAL" : "Warning", title: c.label, detail: c.detail });

export async function listAlerts(limit = 50) {
  return prisma.opsAlert.findMany({ orderBy: [{ resolvedAt: { sort: "desc", nulls: "first" } }, { openedAt: "desc" }], take: limit });
}
