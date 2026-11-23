import "server-only";
/**
 * AI Centre forecasting (Phase 66). Each forecast learns from the past weeks with trend-following smoothing (Holt) and
 * shows the history (solid) and the next weeks (dashed). Suggest-only: nothing changes by itself.
 *   DEMAND     units per product (Phase 17's demandForecast)
 *   SALES      net sales per week — total and by supplier
 *   ORDERS     orders per week — total, by country, and by weekday
 *   INVENTORY  days of stock cover per product (Phase 17's stockPredictions) and what runs out in the next 2 weeks
 *   CASH       money in / out by week ahead (Phase 14's cash flow)
 *   DELIVERY   deliveries per week ahead, the share late, and the driver capacity it needs
 */
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { holtForecast } from "../forecast";
import { aiScope, demandForecast, stockPredictions } from "../insights";
import { change, startOfWeek, weekly, type ForecastKind } from "@/lib/ai-centre";

const DAY = 86400_000;
const HIST = 16, AHEAD = 8;
const round = (xs: number[]) => xs.map((x) => Math.max(0, Math.round(x * 100) / 100));
const sum = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) * 100) / 100;
export type Series = { key: string; label: string; history: number[]; forecast: number[]; last4: number; next4: number; trend: number | null };
function series(key: string, label: string, history: number[]): Series {
  const forecast = round(holtForecast(history, AHEAD));
  const last4 = sum(history.slice(-4)), next4 = sum(forecast.slice(0, 4));
  return { key, label, history, forecast, last4, next4, trend: last4 > 0 ? Math.round(((next4 - last4) / last4) * 100) / 100 : null };
}
const weekLabels = (now: Date) => {
  const w0 = startOfWeek(now).getTime();
  return { past: Array.from({ length: HIST }, (_, i) => new Date(w0 - (HIST - i) * 7 * DAY).toISOString().slice(0, 10)), ahead: Array.from({ length: AHEAD }, (_, i) => new Date(w0 + i * 7 * DAY).toISOString().slice(0, 10)) };
};
const nameOf = (c: { legalName: string; tradeName: string | null } | undefined) => c?.tradeName ?? c?.legalName ?? "—";

export const FORECAST_DATA: Record<ForecastKind, Parameters<typeof aiScope>[2]> = {
  DEMAND: ["admin.orders.view", "admin.analytics.view", "admin.catalogue.view"],
  SALES: ["admin.orders.view", "admin.analytics.view", "admin.finance.view"],
  ORDERS: ["admin.orders.view", "admin.analytics.view"],
  INVENTORY: ["admin.orders.view", "admin.analytics.view", "admin.catalogue.view"],
  CASH: ["admin.finance.view"],
  DELIVERY: ["admin.delivery.view", "admin.orders.view"],
};
export const canForecast = (ctx: Ctx, k: ForecastKind) => ctx.company.type === "ADMIN" && can(ctx, "admin.ai.view") && can(ctx, FORECAST_DATA[k]!);

async function orderRows(now: Date) {
  const since = new Date(startOfWeek(now).getTime() - HIST * 7 * DAY);
  return prisma.order.findMany({ where: { status: { not: "CANCELLED" }, placedAt: { gte: since, lt: now } }, select: { placedAt: true, netTotal: true, sellerCompanyId: true, countryId: true } });
}

export async function forecastSales(ctx: Ctx, now = new Date()) {
  aiScope(ctx, "STAFF", FORECAST_DATA.SALES);
  const rows = await orderRows(now);
  const total = series("ALL", "All sales (net)", weekly(rows.map((r) => ({ at: r.placedAt, v: Number(r.netTotal) })), HIST, now));
  const bySeller = new Map<string, { at: Date; v: number }[]>();
  for (const r of rows) bySeller.set(r.sellerCompanyId, [...(bySeller.get(r.sellerCompanyId) ?? []), { at: r.placedAt, v: Number(r.netTotal) }]);
  const cos = await prisma.company.findMany({ where: { id: { in: [...bySeller.keys()] } }, select: { id: true, legalName: true, tradeName: true } });
  const suppliers = [...bySeller].map(([id, v]) => series(id, nameOf(cos.find((c) => c.id === id)), weekly(v, HIST, now))).sort((a, b) => b.next4 - a.next4);
  return { weeks: weekLabels(now), total, suppliers };
}

export async function forecastOrders(ctx: Ctx, now = new Date()) {
  aiScope(ctx, "STAFF", FORECAST_DATA.ORDERS);
  const rows = await orderRows(now);
  const total = series("ALL", "Orders", weekly(rows.map((r) => ({ at: r.placedAt, v: 1 })), HIST, now));
  const byCountry = new Map<string, { at: Date; v: number }[]>();
  for (const r of rows) byCountry.set(r.countryId, [...(byCountry.get(r.countryId) ?? []), { at: r.placedAt, v: 1 }]);
  const countries = await prisma.country.findMany({ where: { id: { in: [...byCountry.keys()] } }, select: { id: true, name: true, flag: true } });
  const cname = (id: string) => { const c = countries.find((x) => x.id === id); return c ? `${c.flag ?? ""} ${typeof c.name === "string" ? c.name : (c.name as Record<string, string>)?.en ?? id}`.trim() : id; };
  const byCountrySeries = [...byCountry].map(([id, v]) => series(id, cname(id), weekly(v, HIST, now))).sort((a, b) => b.next4 - a.next4);
  // usual share per weekday over the last 8 weeks
  const recent = rows.filter((r) => r.placedAt.getTime() >= now.getTime() - 56 * DAY);
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d, i) => ({ day: d, orders: recent.filter((r) => (r.placedAt.getUTCDay() + 6) % 7 === i).length }));
  const n = days.reduce((a, d) => a + d.orders, 0);
  const nextWeek = total.forecast[0] ?? 0;
  return { weeks: weekLabels(now), total, countries: byCountrySeries, weekdays: days.map((d) => ({ ...d, share: n ? Math.round((d.orders / n) * 100) : 0, expectedNextWeek: n ? Math.round((d.orders / n) * nextWeek) : 0 })) };
}

export async function forecastInventory(ctx: Ctx, now = new Date()) {
  aiScope(ctx, "STAFF", FORECAST_DATA.INVENTORY);
  const rows = await stockPredictions(ctx, "STAFF", { now, locale: "en" });
  const withSales = rows.filter((r) => r.dailyUnits > 0);
  return {
    rows: withSales.sort((a, b) => (a.days ?? -1) - (b.days ?? -1)).slice(0, 300),
    out: withSales.filter((r) => r.status === "OUT").length, critical: withSales.filter((r) => r.status === "CRITICAL").length, low: withSales.filter((r) => r.status === "LOW").length,
    runOutTwoWeeks: withSales.filter((r) => r.days !== null && r.days <= 14).length,
  };
}

export async function forecastCash(ctx: Ctx) {
  aiScope(ctx, "STAFF", FORECAST_DATA.CASH);
  const { cashFlow } = await import("@/server/services/profit");
  const c = await cashFlow(ctx, { months: 6, weeksAhead: AHEAD });
  return { history: c.rows, forecast: c.forecast, overdueReceivable: c.overdueReceivable, inNext8: sum(c.forecast.map((f) => f.receivable)), outNext8: sum(c.forecast.map((f) => f.payable + f.costs)), lowest: Math.min(0, ...c.forecast.map((f) => f.cumulative)) };
}

export async function forecastDelivery(ctx: Ctx, now = new Date()) {
  aiScope(ctx, "STAFF", FORECAST_DATA.DELIVERY);
  const since = new Date(startOfWeek(now).getTime() - HIST * 7 * DAY);
  const rows = await prisma.delivery.findMany({ where: { createdAt: { gte: since, lt: now } }, select: { createdAt: true, completedAt: true, status: true, order: { select: { requestedDeliveryDate: true } } } });
  const total = series("ALL", "Deliveries", weekly(rows.map((r) => ({ at: r.createdAt, v: 1 })), HIST, now));
  const late = weekly(rows.filter((r) => r.completedAt && r.order?.requestedDeliveryDate && r.completedAt.getTime() > r.order.requestedDeliveryDate.getTime() + DAY).map((r) => ({ at: r.createdAt, v: 1 })), HIST, now);
  const lateShare = total.history.map((t, i) => (t ? Math.round((late[i] / t) * 100) : 0));
  const drivers = await prisma.driver.count({ where: { status: "APPROVED" } }).catch(() => 0);
  const perDriverWeek = drivers ? Math.round((total.last4 / 4 / drivers) * 10) / 10 : null;
  const needNext = drivers && perDriverWeek ? Math.ceil((total.forecast[0] ?? 0) / Math.max(1, perDriverWeek)) : null;
  return { weeks: weekLabels(now), total, lateShare, lateTrend: change(lateShare, 4), drivers, perDriverWeek, driversNeededNextWeek: needNext };
}

export async function forecastDemand(ctx: Ctx, now = new Date()) {
  return demandForecast(ctx, "STAFF", { now, limit: 300, locale: "en" });
}
