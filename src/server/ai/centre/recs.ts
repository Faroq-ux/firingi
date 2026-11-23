import "server-only";
/**
 * AI Centre (Phase 66): the recommendation kinds added to Phase 17's feed (see feed.ts computeRecommendations).
 *   SALES      SALES_DROP — a supplier's sales over the last 4 weeks fell by a third or more against the 4 before.
 *   PRICING    PRICE_REVIEW — an offer far above / below the market median; COMMISSION_REVIEW — a supplier's margin under
 *              FIRINGI's margin rule (both from Price Intelligence).
 *   CUSTOMERS  CUSTOMER_LAPSING — a regular customer hasn't ordered for (lapse factor) × its usual gap;
 *              OVERDUE_PAYMENT — invoices open past their due date by FIRINGI's days.
 *   ROUTES     ROUTE_SAVING — a planned route whose stops can be driven in a shorter order; ROUTE_MERGE — two small routes
 *              of the same fleet on the same day in the same area. Each with km, fuel / energy, € and CO₂ saved.
 * Everything is a suggestion; nothing changes until a person acts.
 */
import { prisma } from "@/server/db";
import { optimiseOrder, routeKm, type PlanStop, type LatLng } from "@/server/delivery/routing";
import { haversineKm } from "@/lib/co2";
import { fuelOf, tripCost, worthIt, type AiCentreSettings, type AnyRecKind } from "@/lib/ai-centre";

const DAY = 86400_000;
const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const eur = (n: number) => `€${Math.round(n).toLocaleString("en")}`;
const nameOf = (c: { legalName: string; tradeName: string | null } | null | undefined) => c?.tradeName ?? c?.legalName ?? "—";
export type CentreRec = { kind: AnyRecKind; audience: "STAFF" | "VENDOR"; companyId: string | null; subjectType: string | null; subjectId: string | null; dedupeKey: string; title: string; detail: Record<string, unknown>; score: number };

// ── sales ───────────────────────────────────────────────────────────────────

export async function salesDrops(now: Date) {
  const since = new Date(now.getTime() - 56 * DAY), mid = new Date(now.getTime() - 28 * DAY);
  const rows = await prisma.$queryRaw<{ seller: string; recent: number; before: number }[]>`
    SELECT o."sellerCompanyId" AS seller,
      COALESCE(SUM(l."lineNet") FILTER (WHERE o."placedAt" >= ${mid}), 0)::float8 AS recent,
      COALESCE(SUM(l."lineNet") FILTER (WHERE o."placedAt" < ${mid}), 0)::float8 AS before
    FROM "OrderLine" l JOIN "Order" o ON o.id = l."orderId"
    WHERE o.status <> 'CANCELLED' AND o."placedAt" >= ${since} AND o."placedAt" < ${now} GROUP BY 1`;
  const drops = rows.filter((r) => r.before >= 300 && r.recent <= r.before * 0.67);
  const cos = await prisma.company.findMany({ where: { id: { in: drops.map((d) => d.seller) } }, select: { id: true, legalName: true, tradeName: true } });
  return drops.map((d) => ({ sellerId: d.seller, seller: nameOf(cos.find((c) => c.id === d.seller)), recent: Math.round(d.recent), before: Math.round(d.before), change: Math.round(((d.recent - d.before) / d.before) * 100) }));
}

// ── customers ───────────────────────────────────────────────────────────────

export async function lapsingCustomers(now: Date, factor: number) {
  const since = new Date(now.getTime() - 365 * DAY);
  const orders = await prisma.order.findMany({ where: { status: { not: "CANCELLED" }, placedAt: { gte: since, lt: now } }, select: { buyerCompanyId: true, placedAt: true, grandTotal: true }, orderBy: { placedAt: "asc" } });
  const by = new Map<string, { at: Date[]; total: number }>();
  for (const o of orders) { const b = by.get(o.buyerCompanyId) ?? { at: [], total: 0 }; b.at.push(o.placedAt); b.total += Number(o.grandTotal); by.set(o.buyerCompanyId, b); }
  const out: { buyerId: string; lastOrder: string; daysSince: number; usualGap: number; orders: number; yearSpend: number }[] = [];
  for (const [buyerId, b] of by) {
    if (b.at.length < 3) continue;
    const gaps = b.at.slice(1).map((d, i) => (d.getTime() - b.at[i].getTime()) / DAY).filter((g) => g > 0.5).sort((x, y) => x - y);
    if (!gaps.length) continue;
    const usual = gaps[Math.floor(gaps.length / 2)];
    const last = b.at[b.at.length - 1];
    const days = (now.getTime() - last.getTime()) / DAY;
    if (days >= Math.max(14, usual * factor)) out.push({ buyerId, lastOrder: last.toISOString().slice(0, 10), daysSince: Math.round(days), usualGap: Math.round(usual), orders: b.at.length, yearSpend: Math.round(b.total) });
  }
  const cos = await prisma.company.findMany({ where: { id: { in: out.map((o) => o.buyerId) }, status: "APPROVED" }, select: { id: true, legalName: true, tradeName: true } });
  return out.filter((o) => cos.some((c) => c.id === o.buyerId)).map((o) => ({ ...o, buyer: nameOf(cos.find((c) => c.id === o.buyerId)) }));
}

export async function overdueByCustomer(now: Date, days: number) {
  const cutoff = new Date(now.getTime() - days * DAY);
  const rows = await prisma.$queryRaw<{ buyer: string; open: number; invoices: number; oldest: Date }[]>`
    SELECT x.buyer, SUM(x.open)::float8 AS open, COUNT(*)::int AS invoices, MIN(x.due) AS oldest FROM (
      SELECT i."recipientCompanyId" AS buyer, i."dueAt" AS due,
        (i."grossTotal" - COALESCE((SELECT sum(a.amount) FROM "PaymentAllocation" a JOIN "Payment" p ON p.id = a."paymentId" WHERE a."invoiceId" = i.id AND p.status = 'CONFIRMED'), 0)
         - COALESCE((SELECT sum(c."grossTotal") FROM "Invoice" c WHERE c."originalInvoiceId" = i.id AND c.status <> 'DRAFT'), 0))::float8 AS open
      FROM "Invoice" i WHERE i."docType" = 'INVOICE' AND i.status <> 'DRAFT' AND i."dueAt" < ${cutoff}) x
    WHERE x.open > 0.5 GROUP BY 1`;
  const cos = await prisma.company.findMany({ where: { id: { in: rows.map((r) => r.buyer) } }, select: { id: true, legalName: true, tradeName: true } });
  return rows.map((r) => ({ buyerId: r.buyer, buyer: nameOf(cos.find((c) => c.id === r.buyer)), open: Math.round(r.open * 100) / 100, invoices: r.invoices, oldestDue: r.oldest.toISOString().slice(0, 10), daysLate: Math.round((now.getTime() - r.oldest.getTime()) / DAY) }));
}

// ── routes ──────────────────────────────────────────────────────────────────

type RouteLoad = Awaited<ReturnType<typeof plannedRoutes>>[number];
async function plannedRoutes(now: Date) {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return prisma.route.findMany({
    where: { status: "PLANNED", date: { gte: today, lt: new Date(today.getTime() + 8 * DAY) } },
    include: { stops: { orderBy: { sequence: "asc" } }, vehicle: { select: { plate: true, fuel: true } }, executor: { select: { id: true, legalName: true, tradeName: true, type: true } } },
    take: 300,
  });
}
const stopsOf = (r: RouteLoad): PlanStop[] => r.stops.filter((s) => !s.doneAt).map((s) => ({ key: s.id, deliveryId: s.deliveryId, kind: s.kind, at: s.lat != null && s.lng != null ? { lat: Number(s.lat), lng: Number(s.lng) } : null }));
const startOf = (r: RouteLoad): LatLng | null => (r.startLat != null && r.startLng != null ? { lat: Number(r.startLat), lng: Number(r.startLng) } : null);
function centroid(stops: PlanStop[]) {
  const pts = stops.map((s) => s.at).filter((x): x is LatLng => !!x);
  return pts.length ? { lat: pts.reduce((a, p) => a + p.lat, 0) / pts.length, lng: pts.reduce((a, p) => a + p.lng, 0) / pts.length } : null;
}

export type RouteSaving = {
  routeId: string; number: string; date: string; executor: string; executorId: string; firingi: boolean; vehicle: string | null; stops: number;
  currentKm: number; betterKm: number; savedKm: number; fuel: string; unit: "L" | "kWh"; savedAmount: number; savedCost: number; savedCo2Kg: number; savedMinutes: number; order: string[];
};
export type RouteMerge = {
  routeIds: [string, string]; numbers: [string, string]; date: string; executor: string; executorId: string; firingi: boolean; stops: number; distanceKm: number;
  currentKm: number; combinedKm: number; savedKm: number; fuel: string; unit: "L" | "kWh"; savedAmount: number; savedCost: number; savedCo2Kg: number;
};

/** Shorter orders and routes worth combining, with what they save (fuel or energy by each vehicle's fuel). */
export async function routeSavings(now: Date, s: AiCentreSettings) {
  const { routingSettings } = await import("@/server/services/routes");
  const rs = await routingSettings();
  const routes = await plannedRoutes(now);
  const savings: RouteSaving[] = [], merges: RouteMerge[] = [];
  for (const r of routes) {
    const stops = stopsOf(r);
    if (stops.length < 3 || stops.some((x) => !x.at)) continue;
    const start = startOf(r);
    const cur = routeKm(start, stops, rs);
    const best = optimiseOrder(start, stops, rs);
    const better = routeKm(start, best, rs);
    if (!worthIt(cur, better, s)) continue;
    const fuel = fuelOf(r.vehicle?.fuel, s);
    const t = tripCost(cur - better, fuel, s);
    savings.push({
      routeId: r.id, number: r.number, date: r.date.toISOString().slice(0, 10), executor: nameOf(r.executor), executorId: r.executor.id, firingi: r.executor.type === "ADMIN", vehicle: r.vehicle?.plate ?? null, stops: stops.length,
      currentKm: Math.round(cur * 10) / 10, betterKm: Math.round(better * 10) / 10, savedKm: t.km, fuel, unit: t.unit, savedAmount: t.amount, savedCost: t.cost, savedCo2Kg: t.co2Kg,
      savedMinutes: Math.round(((cur - better) / Math.max(5, rs.avgSpeedKmh)) * 60), order: best.map((x) => x.key),
    });
  }
  // two small routes of the same fleet, same day, close together
  const groups = new Map<string, RouteLoad[]>();
  for (const r of routes) { const k = `${r.executingCompanyId}|${r.date.toISOString().slice(0, 10)}`; groups.set(k, [...(groups.get(k) ?? []), r]); }
  for (const list of groups.values()) {
    const small = list.filter((r) => { const st = stopsOf(r); return st.length > 0 && st.length <= 12 && !st.some((x) => !x.at); });
    const used = new Set<string>();
    for (let i = 0; i < small.length; i++) for (let j = i + 1; j < small.length; j++) {
      const a = small[i], b = small[j];
      if (used.has(a.id) || used.has(b.id)) continue;
      const sa = stopsOf(a), sb = stopsOf(b);
      if (sa.length + sb.length > 20) continue;
      const ca = centroid(sa), cb = centroid(sb);
      if (!ca || !cb) continue;
      const dist = haversineKm(ca, cb);
      if (dist > s.mergeWithinKm) continue;
      const start = startOf(a) ?? startOf(b);
      const cur = routeKm(startOf(a), sa, rs) + routeKm(startOf(b), sb, rs);
      const combined = routeKm(start, optimiseOrder(start, [...sa, ...sb], rs), rs);
      if (!worthIt(cur, combined, s)) continue;
      const fuel = fuelOf(a.vehicle?.fuel ?? b.vehicle?.fuel, s);
      const t = tripCost(cur - combined, fuel, s);
      used.add(a.id); used.add(b.id);
      merges.push({
        routeIds: [a.id, b.id], numbers: [a.number, b.number], date: a.date.toISOString().slice(0, 10), executor: nameOf(a.executor), executorId: a.executor.id, firingi: a.executor.type === "ADMIN",
        stops: sa.length + sb.length, distanceKm: Math.round(dist * 10) / 10, currentKm: Math.round(cur * 10) / 10, combinedKm: Math.round(combined * 10) / 10, savedKm: t.km, fuel, unit: t.unit, savedAmount: t.amount, savedCost: t.cost, savedCo2Kg: t.co2Kg,
      });
    }
  }
  return { savings: savings.sort((x, y) => y.savedCost - x.savedCost), merges: merges.sort((x, y) => y.savedCost - x.savedCost) };
}

// ── the feed ────────────────────────────────────────────────────────────────

export async function centreRecommendations(now: Date, s: AiCentreSettings): Promise<CentreRec[]> {
  const out: CentreRec[] = [];
  const wk = Math.floor(now.getTime() / (7 * DAY)), mo = now.toISOString().slice(0, 7);
  if (s.areas.SALES) {
    for (const d of await salesDrops(now)) {
      out.push({ kind: "SALES_DROP", audience: "STAFF", companyId: null, subjectType: "Company", subjectId: d.sellerId, dedupeKey: `SALESDROP:${d.sellerId}:${wk}`, title: `${d.seller}: sales down ${Math.abs(d.change)}% in the last 4 weeks (${eur(d.recent)} vs ${eur(d.before)})`, detail: d, score: clamp(35 + Math.abs(d.change) / 2 + Math.log10(Math.max(1, d.before)) * 5) });
    }
  }
  if (s.areas.PRICING) {
    const { priceSuggestions } = await import("@/server/price-intel/insights");
    const sys = await (await import("../feed")).staffSystemCtx();
    const p = await priceSuggestions(sys).catch(() => ({ commission: [], reviews: [] }));
    for (const r of p.reviews.slice(0, 60)) {
      out.push({ kind: "PRICE_REVIEW", audience: "STAFF", companyId: null, subjectType: "VendorOffer", subjectId: r.offerId, dedupeKey: `PRICE:${r.offerId}:${mo}`, title: `${r.vendor} — ${r.product}: ${r.kind === "ABOVE" ? `${Math.round(r.dev)}% above` : `${Math.round(Math.abs(r.dev))}% below`} the market median of ${r.suppliers} suppliers`, detail: { ...r }, score: clamp(30 + Math.min(40, Math.abs(r.dev) / 2)) });
    }
    for (const c of p.commission) {
      out.push({ kind: "COMMISSION_REVIEW", audience: "STAFF", companyId: null, subjectType: "Company", subjectId: c.vendorId, dedupeKey: `COMMISSION:${c.vendorId}:${mo}`, title: `${c.vendor}: ${c.achieved.toFixed(1)}% margin over 90 days, the rule asks ${c.below === "MIN" ? `at least ${c.min}%` : `${c.target}%`} — about ${eur(c.extra)} more at ${c.suggested}%`, detail: { ...c }, score: clamp((c.below === "MIN" ? 55 : 35) + Math.log10(Math.max(1, c.extra)) * 8) });
    }
  }
  if (s.areas.CUSTOMERS) {
    for (const c of await lapsingCustomers(now, s.lapseFactor)) {
      out.push({ kind: "CUSTOMER_LAPSING", audience: "STAFF", companyId: null, subjectType: "Company", subjectId: c.buyerId, dedupeKey: `LAPSING:${c.buyerId}:${c.lastOrder}`, title: `${c.buyer} hasn't ordered for ${c.daysSince} days (usually every ${c.usualGap}) — ${eur(c.yearSpend)} in the last year`, detail: c, score: clamp(30 + Math.min(30, c.daysSince / c.usualGap * 5) + Math.log10(Math.max(1, c.yearSpend)) * 6) });
    }
    for (const o of await overdueByCustomer(now, s.overdueDays)) {
      out.push({ kind: "OVERDUE_PAYMENT", audience: "STAFF", companyId: null, subjectType: "Company", subjectId: o.buyerId, dedupeKey: `OVERDUE:${o.buyerId}:${o.oldestDue}`, title: `${o.buyer}: ${eur(o.open)} overdue on ${o.invoices} invoice${o.invoices === 1 ? "" : "s"} (oldest ${o.daysLate} days late)`, detail: o, score: clamp(40 + Math.min(30, o.daysLate / 3) + Math.log10(Math.max(1, o.open)) * 6) });
    }
  }
  if (s.areas.ROUTES) {
    const r = await routeSavings(now, s);
    const unit = (x: { savedAmount: number; unit: string }) => `${x.savedAmount} ${x.unit === "kWh" ? "kWh" : "L"}`;
    for (const x of r.savings) {
      const title = `${x.number} (${x.executor}, ${x.date}): a shorter stop order saves ${x.savedKm} km — ${unit(x)}, €${x.savedCost.toFixed(2)}, ${x.savedCo2Kg} kg CO₂`;
      out.push({ kind: "ROUTE_SAVING", audience: "STAFF", companyId: null, subjectType: "Route", subjectId: x.routeId, dedupeKey: `ROUTE:${x.routeId}:${x.currentKm}`, title, detail: x, score: clamp(40 + x.savedKm * 2) });
      if (!x.firingi) out.push({ kind: "ROUTE_SAVING", audience: "VENDOR", companyId: x.executorId, subjectType: "Route", subjectId: x.routeId, dedupeKey: `V:ROUTE:${x.routeId}:${x.currentKm}`, title, detail: x, score: clamp(40 + x.savedKm * 2) });
    }
    for (const x of r.merges) {
      const title = `${x.numbers[0]} + ${x.numbers[1]} (${x.executor}, ${x.date}): one route instead of two saves ${x.savedKm} km — ${unit(x)}, €${x.savedCost.toFixed(2)}, ${x.savedCo2Kg} kg CO₂`;
      out.push({ kind: "ROUTE_MERGE", audience: "STAFF", companyId: null, subjectType: "Route", subjectId: x.routeIds[0], dedupeKey: `MERGE:${x.routeIds.join(":")}`, title, detail: x, score: clamp(45 + x.savedKm * 2) });
      if (!x.firingi) out.push({ kind: "ROUTE_MERGE", audience: "VENDOR", companyId: x.executorId, subjectType: "Route", subjectId: x.routeIds[0], dedupeKey: `V:MERGE:${x.routeIds.join(":")}`, title, detail: x, score: clamp(45 + x.savedKm * 2) });
    }
  }
  return out;
}
