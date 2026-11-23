import "server-only";
/**
 * AI Dashboard + recommendation lists (Phase 66): KPIs, the most important actions across every area, alerts, savings
 * found on routes, the forecast at a glance and the AI's recent activity. Lists are grouped by area and paged.
 */
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { aiScope } from "../insights";
import { KIND_AREA, REC_AREAS, kindsOf, type RecArea } from "@/lib/ai-centre";
import { aiCentreSettings } from "./settings";

const DAY = 86400_000;
type Status = "OPEN" | "ACCEPTED" | "DISMISSED" | "EXPIRED" | "ALL";

export async function centreDashboard(ctx: Ctx, now = new Date()) {
  aiScope(ctx, "STAFF");
  const s = await aiCentreSettings();
  const { ensureFresh } = await import("../feed");
  await ensureFresh(60).catch((e) => console.error("ai refresh", e));
  const open = await prisma.aiRecommendation.findMany({ where: { audience: "STAFF", status: "OPEN" }, orderBy: [{ score: "desc" }, { createdAt: "desc" }], select: { id: true, kind: true, title: true, score: true, createdAt: true, detail: true } });
  const shown = open.filter((r) => s.areas[KIND_AREA[r.kind as keyof typeof KIND_AREA] ?? "SALES"]);
  const byArea = Object.fromEntries(REC_AREAS.map((a) => [a, shown.filter((r) => KIND_AREA[r.kind as keyof typeof KIND_AREA] === a).length])) as Record<RecArea, number>;
  const route = shown.filter((r) => r.kind === "ROUTE_SAVING" || r.kind === "ROUTE_MERGE").reduce((a, r) => {
    const d = r.detail as { savedKm?: number; savedCost?: number; savedCo2Kg?: number; savedAmount?: number; unit?: string };
    return { km: a.km + (d.savedKm ?? 0), cost: a.cost + (d.savedCost ?? 0), co2: a.co2 + (d.savedCo2Kg ?? 0), litres: a.litres + (d.unit === "L" ? d.savedAmount ?? 0 : 0), kwh: a.kwh + (d.unit === "kWh" ? d.savedAmount ?? 0 : 0) };
  }, { km: 0, cost: 0, co2: 0, litres: 0, kwh: 0 });
  const since30 = new Date(now.getTime() - 30 * DAY);
  const [decided, usage, activity, lastRefresh, held, aiStatus, reports] = await Promise.all([
    prisma.aiRecommendation.groupBy({ by: ["status"], where: { audience: "STAFF", decidedAt: { gte: since30 } }, _count: { _all: true } }),
    prisma.aiActivity.aggregate({ where: { at: { gte: since30 } }, _sum: { tokensIn: true, tokensOut: true }, _count: { _all: true } }),
    prisma.aiActivity.findMany({ orderBy: { at: "desc" }, take: 8, select: { id: true, kind: true, summary: true, at: true, model: true } }),
    prisma.aiActivity.findFirst({ where: { kind: "REFRESH" }, orderBy: { at: "desc" }, select: { at: true } }),
    can(ctx, ["admin.risk.view", "admin.risk.manage"]) ? prisma.riskAssessment.count({ where: { held: true, review: "OPEN" } }) : Promise.resolve(null),
    (await import("../assistant")).assistantStatus("STAFF"),
    prisma.aiReportRun.findMany({ orderBy: { createdAt: "desc" }, take: 5, select: { id: true, kind: true, createdAt: true, byClaude: true } }),
  ]);
  const accepted = decided.find((d) => d.status === "ACCEPTED")?._count._all ?? 0, dismissed = decided.find((d) => d.status === "DISMISSED")?._count._all ?? 0;
  const alerts = [
    ...shown.filter((r) => r.kind === "STOCK_OUT" && r.score >= 80).slice(0, 3).map((r) => ({ tone: "destructive" as const, area: "STOCK" as RecArea, text: r.title, id: r.id })),
    ...shown.filter((r) => r.kind === "DELIVERY_RISK" && r.score >= 70).slice(0, 3).map((r) => ({ tone: "warning" as const, area: "ROUTES" as RecArea, text: r.title, id: r.id })),
    ...shown.filter((r) => r.kind === "OVERDUE_PAYMENT" && r.score >= 70).slice(0, 2).map((r) => ({ tone: "warning" as const, area: "CUSTOMERS" as RecArea, text: r.title, id: r.id })),
  ];
  let forecast: { last4: number; next4: number; trend: number | null; history: number[]; forecast: number[] } | null = null;
  if (s.forecasts.SALES && can(ctx, ["admin.orders.view", "admin.analytics.view", "admin.finance.view"])) {
    const { forecastSales } = await import("./forecasts");
    const f = await forecastSales(ctx, now).catch(() => null);
    if (f) forecast = { last4: f.total.last4, next4: f.total.next4, trend: f.total.trend, history: f.total.history, forecast: f.total.forecast };
  }
  return {
    settings: s, byArea, open: shown.length, high: shown.filter((r) => r.score >= 75).length,
    top: shown.slice(0, 8).map((r) => ({ id: r.id, kind: r.kind, area: KIND_AREA[r.kind as keyof typeof KIND_AREA], title: r.title, score: r.score, createdAt: r.createdAt })),
    alerts, route: { km: Math.round(route.km * 10) / 10, cost: Math.round(route.cost * 100) / 100, co2: Math.round(route.co2 * 10) / 10, litres: Math.round(route.litres * 10) / 10, kwh: Math.round(route.kwh * 10) / 10 },
    decided30: { accepted, dismissed, rate: accepted + dismissed ? Math.round((accepted / (accepted + dismissed)) * 100) : null },
    usage30: { events: usage._count._all, tokensIn: usage._sum.tokensIn ?? 0, tokensOut: usage._sum.tokensOut ?? 0 },
    activity, lastRefresh: lastRefresh?.at ?? null, fraudHeld: held, assistant: aiStatus, forecast, reports,
  };
}

/** Recommendations of one area (or all), paged. */
export async function areaRecommendations(ctx: Ctx, area: RecArea | "ALL", f: { status?: Status; kind?: string | null; page?: number; size?: number } = {}) {
  aiScope(ctx, "STAFF");
  const s = await aiCentreSettings();
  const areas = area === "ALL" ? REC_AREAS.filter((a) => s.areas[a]) : s.areas[area] ? [area] : [];
  const kinds = areas.flatMap((a) => kindsOf(a)).filter((k) => !f.kind || k === f.kind);
  const status = f.status ?? "OPEN";
  const size = Math.min(100, Math.max(5, f.size ?? 25)), page = Math.max(1, f.page ?? 1);
  const where = { audience: "STAFF" as const, kind: { in: kinds as string[] }, ...(status === "ALL" ? {} : { status }) };
  const [rows, total, counts] = await Promise.all([
    prisma.aiRecommendation.findMany({ where, orderBy: status === "OPEN" ? [{ score: "desc" }, { createdAt: "desc" }] : [{ updatedAt: "desc" }], skip: (page - 1) * size, take: size }),
    prisma.aiRecommendation.count({ where }),
    prisma.aiRecommendation.groupBy({ by: ["kind"], where: { audience: "STAFF", status: "OPEN" }, _count: { _all: true } }),
  ]);
  const byKind = Object.fromEntries(counts.map((c) => [c.kind, c._count._all])) as Record<string, number>;
  const byArea = Object.fromEntries(REC_AREAS.map((a) => [a, s.areas[a] ? kindsOf(a).reduce((n, k) => n + (byKind[k] ?? 0), 0) : 0])) as Record<RecArea, number>;
  return { rows, total, page, pages: Math.max(1, Math.ceil(total / size)), byKind, byArea, enabled: s.areas };
}

/**
 * Phase 66 kinds when accepted — the small safe step a person would take:
 * customers (going quiet / overdue) → a CRM call task; a shorter route → the stops are put in the shorter order
 * (only the fleet that drives it may change it; FIRINGI tells the supplier otherwise); prices / commission →
 * a CRM task for the supplier's account manager. Combining routes is a planning decision: accepted = noted.
 */
export async function acceptCentreKind(ctx: Ctx, r: { kind: string; audience: string; detail: unknown; subjectId: string | null; title: string }) {
  const d = r.detail as Record<string, unknown>;
  const task = async (companyId: string, title: string, notes: string) => {
    if (!can(ctx, "admin.crm.manage")) return null;
    const { createTask } = await import("@/server/services/crm");
    const owner = (await prisma.crmAccount.findUnique({ where: { companyId }, select: { ownerId: true } }))?.ownerId;
    const t = await createTask(ctx, { kind: "FOLLOW_UP", companyId, assigneeId: owner ?? ctx.user.id, dueAt: new Date(), title, notes: `${notes} (AI suggestion)` }).catch(() => null);
    return t ? { taskId: t.id } : null;
  };
  switch (r.kind) {
    case "CUSTOMER_LAPSING": return (await task(String(d.buyerId), `Call ${d.buyer}: no order for ${d.daysSince} days`, `Usually orders every ${d.usualGap} days; last order ${d.lastOrder}; ${d.orders} orders, about €${d.yearSpend} in the last year.`)) ?? {};
    case "OVERDUE_PAYMENT": return (await task(String(d.buyerId), `Chase ${d.buyer}: €${d.open} overdue`, `${d.invoices} invoices open; oldest due ${d.oldestDue} (${d.daysLate} days late).`)) ?? {};
    case "PRICE_REVIEW": return (await task(String(d.vendorId), `Ask ${d.vendor} to review the price of ${d.product}`, String(d.why ?? ""))) ?? {};
    case "COMMISSION_REVIEW": return (await task(String(d.vendorId), `Review commission with ${d.vendor}`, String(d.why ?? ""))) ?? {};
    case "SALES_DROP": return (await task(String(d.sellerId), `Talk to ${d.seller}: sales down ${Math.abs(Number(d.change))}%`, `Last 4 weeks €${d.recent} vs €${d.before} the 4 before.`)) ?? {};
    case "ROUTE_SAVING": {
      const { reoptimiseRoute } = await import("@/server/services/routes");
      const mine = String(d.executorId) === ctx.company.id;
      if (mine) { const x = await reoptimiseRoute(ctx, String(d.routeId)).catch(() => null); if (x) return { reordered: true, beforeKm: x.beforeKm, afterKm: x.afterKm }; }
      if (r.audience === "STAFF" && !d.firingi) {
        const { notify } = await import("@/server/notify/dispatch");
        const n = await notify("ai.route_saving", [{ companyId: String(d.executorId), link: `/vendor/fleet/routes/${d.routeId}` }], { number: String(d.number), km: String(d.savedKm), cost: String(d.savedCost), co2: String(d.savedCo2Kg) }, { ref: { type: "Route", id: String(d.routeId) } }).catch(() => ({ recipients: 0 }));
        return { notified: n.recipients };
      }
      return {};
    }
    default: return {};
  }
}
