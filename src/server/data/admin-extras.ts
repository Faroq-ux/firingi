import "server-only";
/**
 * More cards for FIRINGI's Executive Overview: the AI Centre at a glance, consignment stock and what accepted route suggestions saved this month (km, fuel / energy, €, CO₂). Each is null when the viewer's role
 * doesn't include that data or FIRINGI switched the feature off.
 */
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { KIND_AREA, type AnyRecKind, type RecArea } from "@/lib/ai-centre";

const r2 = (n: number) => Math.round(n * 100) / 100;
type RouteDetail = { savedKm?: number; savedCost?: number; savedCo2Kg?: number; savedAmount?: number; unit?: string };
const sumRoutes = (rows: { detail: unknown }[]) => rows.reduce((a, r) => {
  const d = r.detail as RouteDetail;
  return { km: a.km + (d.savedKm ?? 0), cost: a.cost + (d.savedCost ?? 0), co2: a.co2 + (d.savedCo2Kg ?? 0), litres: a.litres + (d.unit === "L" ? d.savedAmount ?? 0 : 0), kwh: a.kwh + (d.unit === "kWh" ? d.savedAmount ?? 0 : 0) };
}, { km: 0, cost: 0, co2: 0, litres: 0, kwh: 0 });
const round = (x: ReturnType<typeof sumRoutes>) => ({ km: Math.round(x.km * 10) / 10, cost: r2(x.cost), co2: Math.round(x.co2 * 10) / 10, litres: Math.round(x.litres * 10) / 10, kwh: Math.round(x.kwh * 10) / 10 });

async function aiCard(ctx: Ctx) {
  if (!can(ctx, "admin.ai.view")) return null;
  const { aiCentreSettings } = await import("@/server/ai/centre/settings");
  const s = await aiCentreSettings();
  const open = (await prisma.aiRecommendation.findMany({ where: { audience: "STAFF", status: "OPEN" }, orderBy: [{ score: "desc" }, { createdAt: "desc" }], select: { id: true, kind: true, title: true, score: true, detail: true } }))
    .filter((r) => s.areas[KIND_AREA[r.kind as AnyRecKind] ?? "SALES"]);
  const routes = open.filter((r) => r.kind === "ROUTE_SAVING" || r.kind === "ROUTE_MERGE");
  const alerts = open.filter((r) => (r.kind === "STOCK_OUT" && r.score >= 80) || (r.kind === "DELIVERY_RISK" && r.score >= 70) || (r.kind === "OVERDUE_PAYMENT" && r.score >= 70)).length;
  return {
    open: open.length, important: open.filter((r) => r.score >= 75).length, alerts, routes: round(sumRoutes(routes)), routeCount: routes.length,
    top: open.slice(0, 3).map((r) => ({ id: r.id, title: r.title, area: (KIND_AREA[r.kind as AnyRecKind] ?? "SALES") as RecArea, score: r.score })),
  };
}

async function consignmentCard(ctx: Ctx) {
  if (!can(ctx, ["admin.vendors.view", "admin.settings.manage"])) return null;
  const { consignmentSettings } = await import("@/server/consignment/service");
  if (!(await consignmentSettings()).enabled) return null;
  const { onShelf } = await import("@/lib/consignment");
  const [active, pending, toConfirm, disputes, lots] = await Promise.all([
    prisma.consignmentSite.count({ where: { status: "ACTIVE" } }),
    prisma.consignmentSite.count({ where: { status: "PENDING" } }),
    prisma.consignmentCount.count({ where: { status: "SUBMITTED" } }),
    prisma.consignmentCount.count({ where: { status: { in: ["DISPUTED", "FAILED"] } } }),
    prisma.consignmentLot.findMany({ where: { site: { status: "ACTIVE" } }, include: { shipment: { select: { status: true } } } }),
  ]);
  const value = lots.reduce((a, l) => a + Number(l.unitCost) * onShelf({ ...l, received: l.shipment.status === "RECEIVED" }), 0);
  return { active, pending, toConfirm, disputes, value: r2(value) };
}

async function savingsCard(ctx: Ctx, now: Date) {
  if (!can(ctx, ["admin.ai.view", "admin.delivery.view"])) return null;
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const accepted = await prisma.aiRecommendation.findMany({ where: { kind: { in: ["ROUTE_SAVING", "ROUTE_MERGE"] }, status: "ACCEPTED", decidedAt: { gte: month } }, select: { detail: true, audience: true, subjectId: true } });
  // a route accepted by FIRINGI and by its supplier counts once
  const seen = new Set<string>();
  const unique = accepted.filter((r) => { const k = r.subjectId ?? ""; if (seen.has(k)) return false; seen.add(k); return true; });
  const waiting = await prisma.aiRecommendation.findMany({ where: { audience: "STAFF", kind: { in: ["ROUTE_SAVING", "ROUTE_MERGE"] }, status: "OPEN" }, select: { detail: true } });
  return { month: round(sumRoutes(unique)), changes: unique.length, waiting: round(sumRoutes(waiting)) };
}

export async function adminExtras(ctx: Ctx, now = new Date()) {
  const [ai, consignment, savings] = await Promise.all([aiCard(ctx).catch(() => null), consignmentCard(ctx).catch(() => null), savingsCard(ctx, now).catch(() => null)]);
  return { ai, consignment, savings };
}
export type AdminExtras = Awaited<ReturnType<typeof adminExtras>>;
