import "server-only";
/**
 * Services job (Phase 68, hourly): plan visits ahead for every active plan, remind customers and providers before a
 * visit, mark visits nobody recorded as missed (tells the customer and FIRINGI), ask for a collection when used-oil
 * containers are nearly full, "change the oil" alerts, providers' licences running out, and — from the 1st of the
 * month — FIRINGI's commission invoices for the visits providers invoiced themselves last month.
 */
import { prisma } from "@/server/db";
import { isoDay } from "@/lib/services";
import { servicesSettings } from "./settings";

const DAY = 86400_000;
const today = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

export async function processServices(now = new Date()) {
  const s = await servicesSettings();
  const out = { planned: 0, reminded: 0, missed: 0, autoRequests: 0, oilAlerts: 0, licences: 0, commissionInvoices: 0 };
  if (!s.enabled) return out;
  const { notify } = await import("@/server/notify/dispatch");
  const { planVisits, invoiceCommissions } = await import("./plans");

  // 1. plan ahead
  const plans = await prisma.servicePlan.findMany({ where: { status: { in: ["ACTIVE", "PAUSED"] } }, select: { id: true, status: true, pausedUntil: true } });
  for (const p of plans) {
    if (p.status === "PAUSED" && p.pausedUntil && p.pausedUntil <= now) await prisma.servicePlan.update({ where: { id: p.id }, data: { status: "ACTIVE", pausedUntil: null } });
    else if (p.status === "PAUSED") continue;
    out.planned += await planVisits(p.id, now);
  }

  // 2. reminders (visits on or before the reminder window, not reminded yet)
  const soon = await prisma.serviceVisit.findMany({ where: { status: { in: ["SCHEDULED", "CONFIRMED"] }, remindedAt: null, date: { gte: today(now), lte: new Date(now.getTime() + s.reminderHours * 3600_000) } }, include: { provider: { select: { companyId: true } }, serviceType: { select: { name: true, code: true } } }, take: 500 });
  for (const v of soon) {
    const vars = { number: v.number, date: isoDay(v.date), service: String((v.serviceType.name as Record<string, string>).en ?? v.serviceType.code) };
    await notify("service.visit_reminder", [{ companyId: v.customerCompanyId, link: "/buy/services" }, ...(v.provider ? [{ companyId: v.provider.companyId, link: "/vendor/services" }] : [])], vars, { ref: { type: "ServiceVisit", id: v.id } }).catch(() => null);
    await prisma.serviceVisit.update({ where: { id: v.id }, data: { remindedAt: now } });
    out.reminded++;
  }

  // 3. missed: the day is over by more than FIRINGI's hours and nothing was recorded
  const late = await prisma.serviceVisit.findMany({ where: { status: { in: ["REQUESTED", "SCHEDULED", "CONFIRMED"] }, date: { lt: new Date(now.getTime() - DAY - s.missedAfterHours * 3600_000) } }, select: { id: true, number: true, customerCompanyId: true }, take: 500 });
  for (const v of late) {
    const c = await prisma.serviceVisit.updateMany({ where: { id: v.id, status: { in: ["REQUESTED", "SCHEDULED", "CONFIRMED"] } }, data: { status: "MISSED", missedReason: "Not recorded by the provider" } });
    if (!c.count) continue;
    await notify("service.visit_missed", [{ companyId: v.customerCompanyId, link: "/buy/services" }], { number: v.number, reason: "—" }, { ref: { type: "ServiceVisit", id: v.id } }).catch(() => null);
    out.missed++;
  }

  // 4. used oil: nearly full → ask for a collection; fryers due → alert
  if (s.parts.oil) {
    const { autoRequestIfFull, oilChangeAlerts } = await import("./oil");
    const oilPlans = await prisma.servicePlan.findMany({ where: { status: "ACTIVE", autoRequestWhenFull: true, serviceType: { isOil: true } }, select: { customerCompanyId: true } });
    for (const p of oilPlans) if (await autoRequestIfFull(p.customerCompanyId, now).catch(() => null)) out.autoRequests++;
    out.oilAlerts = await oilChangeAlerts(now);
  }

  // 5. licences ending within 30 days (once)
  const exp = await prisma.serviceProvider.findMany({ where: { status: "APPROVED", licenceAlertedAt: null, licenceExpiresAt: { lte: new Date(now.getTime() + 30 * DAY) } }, include: { serviceType: { select: { name: true, code: true } } } });
  const admin = await prisma.company.findFirst({ where: { type: "ADMIN" }, orderBy: { createdAt: "asc" }, select: { id: true } });
  for (const p of exp) {
    const vars = { service: String((p.serviceType.name as Record<string, string>).en ?? p.serviceType.code), date: p.licenceExpiresAt ? isoDay(p.licenceExpiresAt) : "—" };
    await notify("service.licence_expiring", [{ companyId: p.companyId, link: "/vendor/services" }, ...(admin ? [{ companyId: admin.id, link: "/admin/services?tab=PROVIDERS" }] : [])], vars).catch(() => null);
    await prisma.serviceProvider.update({ where: { id: p.id }, data: { licenceAlertedAt: now } });
    out.licences++;
  }

  // 6. FIRINGI's commission on last month's provider-invoiced visits
  out.commissionInvoices = await invoiceCommissions(null, new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))).catch((e) => { console.error("service commissions", e); return 0; });
  return out;
}
