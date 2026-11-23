import "server-only";
/**
 * Food safety job (Phase 69, hourly): tells each business once a day about temperature checks that are late (past
 * their time + FIRINGI's grace), and about food-handler training running out (once per record).
 */
import { prisma } from "@/server/db";
import { dayKey, slotsFor, utcDay } from "@/lib/haccp";
import { haccpOn, haccpSettings } from "./settings";

const DAY = 86400_000;

export async function processHaccp(now = new Date()) {
  const s = await haccpSettings();
  const out = { businesses: 0, missedAlerts: 0, trainingAlerts: 0 };
  if (!s.enabled || !s.parts.reminders) return out;
  const { notify } = await import("@/server/notify/dispatch");
  const t0 = utcDay(now);

  // missed temperature checks today (once a day per business)
  if (s.parts.temperatures) {
    const units = await prisma.haccpUnit.findMany({ where: { active: true }, select: { id: true, name: true, times: true, companyId: true, alertedAt: true } });
    const byCo = new Map<string, typeof units>();
    for (const u of units) byCo.set(u.companyId, [...(byCo.get(u.companyId) ?? []), u]);
    const cos = await prisma.company.findMany({ where: { id: { in: [...byCo.keys()] } }, select: { id: true, type: true } });
    for (const c of cos) {
      if (!haccpOn(s, c)) continue;
      out.businesses++;
      const us = byCo.get(c.id)!;
      if (us.some((u) => u.alertedAt && dayKey(u.alertedAt) === dayKey(now))) continue;
      const entries = await prisma.haccpEntry.findMany({ where: { companyId: c.id, kind: "TEMP", forDate: t0 }, select: { unitId: true, slot: true, ok: true } });
      const late = slotsFor(us, entries, t0, now, s.rules.graceMinutes).filter((x) => x.state === "LATE");
      if (!late.length) continue;
      const list = late.map((x) => `${us.find((u) => u.id === x.unitId)?.name} ${x.time}`).slice(0, 8).join(", ");
      await notify("haccp.checks_missed", [{ companyId: c.id, link: "/buy/food-safety" }], { count: late.length, list }).catch(() => null);
      await prisma.haccpUnit.updateMany({ where: { companyId: c.id, active: true }, data: { alertedAt: now } });
      out.missedAlerts++;
    }
  }

  // training running out within FIRINGI's warning days (once)
  if (s.parts.training) {
    const due = await prisma.haccpTraining.findMany({ where: { alertedAt: null, expiresAt: { lte: new Date(now.getTime() + s.rules.trainingWarnDays * DAY) } }, take: 500 });
    const cos = await prisma.company.findMany({ where: { id: { in: [...new Set(due.map((t) => t.companyId))] } }, select: { id: true, type: true } });
    for (const t of due) {
      const c = cos.find((x) => x.id === t.companyId);
      if (!c || !haccpOn(s, c)) continue;
      await notify("haccp.training_expiring", [{ companyId: t.companyId, link: "/buy/food-safety/training" }], { person: t.personName, course: t.course, date: dayKey(t.expiresAt!) }).catch(() => null);
      await prisma.haccpTraining.update({ where: { id: t.id }, data: { alertedAt: now } });
      out.trainingAlerts++;
    }
  }
  return out;
}
