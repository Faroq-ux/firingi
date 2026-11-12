/**
 * Demand planning engine (Phase 30): loads one stock-holding company's history, stock, open
 * purchases, lead times, events and planning choices, and works out — per product × warehouse —
 * the forecast, the restock plan and the overstock / expiry risk. No side effects; the nightly run
 * (./service.ts) stores forecasts and suggestions from it, the pages read it live.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { pickLocalized } from "@/i18n/config";
import { isExpired } from "@/server/inventory/ledger";
import {
  addDays, cleanHistory, DAY, demandOver, eventFactor, expiryRisk, fit, leadStats, leadTimeToUse, markdownPct, mondayOf, overstock, plan, startOfDay, withEvents,
  type EventSpan, type Fit, type LeadStats, type Plan,
} from "./model";

export const SETTINGS_KEY = "planning.defaults";
export type PlanningDefaults = { serviceLevel: number; reviewDays: number; overstockDays: number; leadTimeDays: number; historyWeeks: number; horizonWeeks: number; notify: boolean };
export const DEFAULTS: PlanningDefaults = { serviceLevel: 95, reviewDays: 7, overstockDays: 60, leadTimeDays: 3, historyWeeks: 78, horizonWeeks: 8, notify: true };

export async function planningDefaults(): Promise<PlanningDefaults> {
  const row = await prisma.setting.findUnique({ where: { scope_scopeId_key: { scope: "GLOBAL", scopeId: "", key: SETTINGS_KEY } } });
  return { ...DEFAULTS, ...((row?.value as Partial<PlanningDefaults>) ?? {}) };
}

export type CompanyPlanning = { serviceLevel: number; reviewDays: number; overstockDays: number; custom: { serviceLevel: boolean; reviewDays: boolean; overstockDays: boolean } };
export async function companyPlanning(companyId: string, d?: PlanningDefaults): Promise<CompanyPlanning> {
  const [defs, row] = await Promise.all([d ?? planningDefaults(), prisma.planningSettings.findUnique({ where: { companyId } })]);
  return {
    serviceLevel: row?.serviceLevel ?? defs.serviceLevel, reviewDays: row?.reviewDays ?? defs.reviewDays, overstockDays: row?.overstockDays ?? defs.overstockDays,
    custom: { serviceLevel: row?.serviceLevel != null, reviewDays: row?.reviewDays != null, overstockDays: row?.overstockDays != null },
  };
}

// ── sources & lead times ────────────────────────────────────────────────────

export type SourceRef = { kind: "OUTSIDE"; id: string; name: string } | { kind: "FIRINGI"; id: string; name: string; sourceOfferId: string | null };
export type SourceLead = { key: string; kind: "OUTSIDE" | "FIRINGI"; id: string; name: string; stated: number | null; useMeasured: boolean; stats: LeadStats; days: number; basis: "MEASURED" | "STATED" | "DEFAULT"; active: boolean };

/** Every source this company buys from, with stated and measured lead times. */
export async function sourceLeadTimes(companyId: string, defaults: PlanningDefaults): Promise<SourceLead[]> {
  const [suppliers, pos] = await Promise.all([
    prisma.purchaseSupplier.findMany({ where: { ownerCompanyId: companyId }, select: { id: true, name: true, leadTimeDays: true, useMeasuredLeadTime: true, isActive: true } }),
    prisma.purchaseOrder.findMany({
      where: { ownerCompanyId: companyId, sentAt: { not: null }, status: { not: "CANCELLED" } },
      select: { supplierId: true, sellerCompanyId: true, sentAt: true, expectedOn: true, seller: { select: { legalName: true, tradeName: true } }, receipts: { select: { at: true }, orderBy: { at: "asc" }, take: 1 }, lines: { select: { qty: true, receivedQty: true } } },
      orderBy: { sentAt: "desc" }, take: 2000,
    }),
  ]);
  const samples = new Map<string, Parameters<typeof leadStats>[0]>();
  const sellers = new Map<string, string>();
  for (const p of pos) {
    const key = p.supplierId ? `S:${p.supplierId}` : `F:${p.sellerCompanyId}`;
    if (p.sellerCompanyId && p.seller) sellers.set(p.sellerCompanyId, p.seller.tradeName ?? p.seller.legalName);
    const list = samples.get(key) ?? [];
    if (list.length < 20) list.push({ sentAt: p.sentAt!, receivedAt: p.receipts[0]?.at ?? null, expectedOn: p.expectedOn, ordered: p.lines.reduce((a, l) => a + l.qty, 0), received: p.lines.reduce((a, l) => a + l.receivedQty, 0) });
    samples.set(key, list);
  }
  const out: SourceLead[] = suppliers.map((s) => {
    const stats = leadStats(samples.get(`S:${s.id}`) ?? []);
    const use = leadTimeToUse(s.leadTimeDays, stats, s.useMeasuredLeadTime);
    return { key: `S:${s.id}`, kind: "OUTSIDE", id: s.id, name: s.name, stated: s.leadTimeDays, useMeasured: s.useMeasuredLeadTime, stats, days: use.days, basis: use.source, active: s.isActive };
  });
  for (const [id, name] of sellers) {
    const stats = leadStats(samples.get(`F:${id}`) ?? []);
    const m = stats.orders >= 3 && stats.measured !== null;
    out.push({ key: `F:${id}`, kind: "FIRINGI", id, name, stated: null, useMeasured: true, stats, days: m ? Math.ceil(stats.measured!) : defaults.leadTimeDays, basis: m ? "MEASURED" : "DEFAULT", active: true });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// ── loading ─────────────────────────────────────────────────────────────────

const qty = Prisma.sql`COALESCE(l."qtyDelivered", l."qtyConfirmed", l."qtyOrdered")`;

/** Weekly units shipped per offer × warehouse: key → number[] (oldest first; last = the last complete week). */
async function weeklyHistory(companyId: string, weeks: number, thisMonday: Date) {
  const from = addDays(thisMonday, -7 * weeks);
  const rows = await prisma.$queryRaw<{ offerId: string; addressId: string; w: number; units: number }[]>`
    SELECT l."offerId", o."sourceAddressId" AS "addressId",
      floor(EXTRACT(EPOCH FROM (${thisMonday}::timestamptz - o."placedAt")) / 604800)::int AS w, sum(${qty})::float8 AS units
    FROM "OrderLine" l JOIN "Order" o ON o.id = l."orderId"
    WHERE o."sellerCompanyId" = ${companyId} AND o.status NOT IN ('CANCELLED', 'ON_HOLD')
      AND o."sourceAddressId" IS NOT NULL AND o."placedAt" >= ${from} AND o."placedAt" < ${thisMonday}
    GROUP BY 1, 2, 3`;
  const out = new Map<string, number[]>();
  for (const r of rows) {
    if (r.w < 0 || r.w >= weeks) continue;
    const k = `${r.offerId}|${r.addressId}`;
    const arr = out.get(k) ?? Array(weeks).fill(0);
    arr[weeks - 1 - r.w] += Number(r.units);
    out.set(k, arr);
  }
  return out;
}

/** Units per weekday (Mon…Sun) over the last 12 weeks, per offer × warehouse. */
export async function weekdayUnits(companyId: string, offerId: string, addressId: string, now = new Date()) {
  const rows = await prisma.$queryRaw<{ dow: number; units: number }[]>`
    SELECT ((EXTRACT(ISODOW FROM o."placedAt")::int) - 1) AS dow, sum(${qty})::float8 AS units
    FROM "OrderLine" l JOIN "Order" o ON o.id = l."orderId"
    WHERE o."sellerCompanyId" = ${companyId} AND l."offerId" = ${offerId} AND o."sourceAddressId" = ${addressId}
      AND o.status NOT IN ('CANCELLED', 'ON_HOLD') AND o."placedAt" >= ${addDays(now, -84)}
    GROUP BY 1`;
  const out = Array(7).fill(0);
  for (const r of rows) out[r.dow] = Number(r.units);
  return out as number[];
}

export type PlanEvent = EventSpan & { id: string; name: string; companyId: string | null; countryId: string | null; categoryIds: string[]; offerIds: string[] };
export async function eventsFor(companyId: string, countryId: string | null) {
  const rows = await prisma.planningEvent.findMany({
    where: { isActive: true, OR: [{ companyId }, { companyId: null, OR: [{ countryId: null }, ...(countryId ? [{ countryId }] : [])] }] },
    orderBy: { startsOn: "asc" },
  });
  return rows.map((e) => ({ id: e.id, name: e.name, companyId: e.companyId, countryId: e.countryId, startsOn: e.startsOn, endsOn: e.endsOn, upliftPct: e.upliftPct, categoryIds: e.categoryIds, offerIds: e.offerIds })) as PlanEvent[];
}
/** Events that apply to one product (no products and no categories = all). */
export const eventsForOffer = (events: PlanEvent[], offerId: string, categoryPath: string) =>
  events.filter((e) => (!e.offerIds.length && !e.categoryIds.length) || e.offerIds.includes(offerId) || e.categoryIds.some((c) => categoryPath.includes(`/${c}/`)));

// ── the plan of one company ────────────────────────────────────────────────

export type BatchRisk = { id: string; lotCode: string | null; expiresOn: Date; daysLeft: number; free: number; sells: number; atRisk: number; value: number; expired: boolean };
export type PlanRow = {
  key: string; offerId: string; addressId: string; warehouse: string; product: Prisma.JsonValue; packaging: Prisma.JsonValue; sku: string | null; categoryPath: string;
  history: number[]; mondays: Date[]; fit: Fit; forecast: number[]; low: number[]; high: number[]; futureMondays: Date[]; events: PlanEvent[];
  onHand: number; reserved: number; usable: number; expired: number; incoming: number; draft: number; inTransit: number; avgCost: number;
  manualReorderPoint: number | null; manualReorderQty: number | null;
  serviceLevel: number; leadTimeDays: number; leadBasis: "ITEM" | "MEASURED" | "STATED" | "DEFAULT"; source: SourceRef | null; unitCost: number | null;
  minOrderQty: number; packMultiple: number; excluded: boolean; itemId: string | null; note: string | null;
  plan: Plan; overstock: { excess: number; coverDays: number | null; noSales: boolean; value: number }; batches: BatchRisk[];
};

export type CompanyPlan = {
  companyId: string; name: string; type: string; inHouse: boolean; countryId: string | null; settings: CompanyPlanning; defaults: PlanningDefaults;
  thisMonday: Date; rows: PlanRow[]; sources: SourceLead[]; events: PlanEvent[]; warehouses: { id: string; label: string }[]; markdown: boolean;
};

export async function computeCompanyPlan(companyId: string, opts: { now?: Date; offerId?: string } = {}): Promise<CompanyPlan> {
  const now = opts.now ?? new Date();
  const thisMonday = mondayOf(now);
  const defaults = await planningDefaults();
  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { id: true, legalName: true, tradeName: true, type: true, isInHouse: true, countryId: true } });
  const [settings, sources, events, wh, invSettings] = await Promise.all([
    companyPlanning(companyId, defaults), sourceLeadTimes(companyId, defaults), eventsFor(companyId, company.countryId),
    prisma.address.findMany({ where: { companyId, isActive: true, kind: { in: ["WAREHOUSE", "PICKUP"] } }, select: { id: true, label: true }, orderBy: { label: "asc" } }),
    import("@/server/inventory/settings").then((m) => m.inventorySettings(prisma, companyId)),
  ]);
  const weeks = Math.max(8, Math.min(104, defaults.historyWeeks)), ahead = Math.max(4, Math.min(26, defaults.horizonWeeks));
  const offerWhere = { vendorCompanyId: companyId, status: { not: "ARCHIVED" as const }, ...(opts.offerId ? { id: opts.offerId } : {}) };
  const [offers, history, levels, batches, poLines, transfers, items, lastLines] = await Promise.all([
    prisma.vendorOffer.findMany({ where: offerWhere, select: { id: true, vendorSku: true, status: true, packaging: { select: { name: true, variant: { select: { product: { select: { name: true, category: { select: { id: true, path: true } } } } } } } } } }),
    weeklyHistory(companyId, weeks, thisMonday),
    prisma.stockLevel.findMany({ where: { offer: offerWhere } }),
    prisma.stockBatch.findMany({ where: { offer: offerWhere, writtenOffAt: null, blockedAt: null, onHand: { gt: 0 } }, select: { id: true, offerId: true, addressId: true, lotCode: true, expiresOn: true, onHand: true, reserved: true } }),
    prisma.purchaseOrderLine.findMany({ where: { offer: offerWhere, po: { ownerCompanyId: companyId, status: { in: ["DRAFT", "SENT", "PARTIALLY_RECEIVED"] } } }, select: { offerId: true, qty: true, receivedQty: true, po: { select: { addressId: true, status: true } } } }),
    prisma.stockTransferLine.findMany({ where: { offer: offerWhere, transfer: { ownerCompanyId: companyId, status: "IN_TRANSIT" } }, select: { offerId: true, qty: true, transfer: { select: { toAddressId: true } } } }),
    prisma.planningItem.findMany({ where: { offer: offerWhere } }),
    prisma.purchaseOrderLine.findMany({
      where: { offer: offerWhere, po: { ownerCompanyId: companyId, status: { not: "CANCELLED" } } },
      select: { offerId: true, unitCost: true, sourceOfferId: true, po: { select: { addressId: true, supplierId: true, sellerCompanyId: true, supplier: { select: { name: true } }, seller: { select: { legalName: true, tradeName: true } } } } },
      orderBy: { po: { createdAt: "desc" } }, take: 3000,
    }),
  ]);
  const whName = new Map(wh.map((w) => [w.id, w.label]));
  const offerById = new Map(offers.map((o) => [o.id, o]));
  const supplierName = new Map(sources.filter((s) => s.kind === "OUTSIDE").map((s) => [s.id, s.name]));
  const leadOf = new Map(sources.map((s) => [s.key, s]));
  const mondays = Array.from({ length: weeks }, (_, i) => addDays(thisMonday, -7 * (weeks - i)));
  const futureMondays = Array.from({ length: ahead }, (_, i) => addDays(thisMonday, 7 * i));
  const today = startOfDay(now);

  const keys = new Set<string>();
  for (const l of levels) if (whName.has(l.addressId)) keys.add(`${l.offerId}|${l.addressId}`);
  for (const k of history.keys()) { const [o, a] = k.split("|"); if (offerById.has(o) && whName.has(a)) keys.add(k); }

  const rows: PlanRow[] = [];
  for (const key of keys) {
    const [offerId, addressId] = key.split("|");
    const o = offerById.get(offerId)!;
    const lvl = levels.find((l) => l.offerId === offerId && l.addressId === addressId);
    const item = items.find((i) => i.offerId === offerId && i.addressId === addressId) ?? null;
    const path = o.packaging.variant.product.category?.path ?? "";
    const evs = eventsForOffer(events, offerId, path);
    const raw = history.get(key) ?? Array(weeks).fill(0);
    const f = fit(cleanHistory(raw, mondays, evs), ahead);
    const forecast = withEvents(f.forecast, futureMondays, evs);
    const low = f.low.map((v, i) => Math.round(v * eventFactor(evs, futureMondays[i]) * 100) / 100);
    const high = f.high.map((v, i) => Math.round(v * eventFactor(evs, futureMondays[i]) * 100) / 100);
    const sigma = f.sigma * Math.max(1, ...futureMondays.slice(0, 2).map((m) => eventFactor(evs, m)));

    const bs = batches.filter((b) => b.offerId === offerId && b.addressId === addressId);
    const expired = bs.filter((b) => isExpired(b.expiresOn)).reduce((a, b) => a + Math.max(0, b.onHand - b.reserved), 0);
    const onHand = lvl?.onHand ?? 0, reserved = lvl?.reserved ?? 0;
    const usable = Math.max(0, onHand - reserved - expired);
    const open = poLines.filter((l) => l.offerId === offerId && l.po.addressId === addressId);
    const sent = open.filter((l) => l.po.status !== "DRAFT").reduce((a, l) => a + Math.max(0, l.qty - l.receivedQty), 0);
    const draft = open.filter((l) => l.po.status === "DRAFT").reduce((a, l) => a + l.qty, 0);
    const inTransit = transfers.filter((t) => t.offerId === offerId && t.transfer.toAddressId === addressId).reduce((a, t) => a + t.qty, 0);
    const incoming = sent + draft + inTransit;

    // where it is bought: the planning item's choice, else the last purchase order of it
    let source: SourceRef | null = null;
    let unitCost: number | null = item?.unitCost ? Number(item.unitCost) : null;
    if (item?.supplierId) source = { kind: "OUTSIDE", id: item.supplierId, name: supplierName.get(item.supplierId) ?? "—" };
    else if (item?.sellerCompanyId) source = { kind: "FIRINGI", id: item.sellerCompanyId, name: leadOf.get(`F:${item.sellerCompanyId}`)?.name ?? "—", sourceOfferId: item.sourceOfferId };
    if (!source) {
      const last = lastLines.find((l) => l.offerId === offerId && l.po.addressId === addressId) ?? lastLines.find((l) => l.offerId === offerId);
      if (last?.po.supplierId) source = { kind: "OUTSIDE", id: last.po.supplierId, name: last.po.supplier?.name ?? "—" };
      else if (last?.po.sellerCompanyId) source = { kind: "FIRINGI", id: last.po.sellerCompanyId, name: last.po.seller?.tradeName ?? last.po.seller?.legalName ?? "—", sourceOfferId: last.sourceOfferId };
      if (unitCost === null && last) unitCost = Number(last.unitCost);
    }
    if (unitCost === null && lvl && Number(lvl.avgCost) > 0) unitCost = Number(lvl.avgCost);
    const lead = source ? leadOf.get(source.kind === "OUTSIDE" ? `S:${source.id}` : `F:${source.id}`) : undefined;
    const leadTimeDays = item?.leadTimeDays ?? lead?.days ?? defaults.leadTimeDays;
    const leadBasis = item?.leadTimeDays != null ? "ITEM" : lead ? lead.basis : "DEFAULT";
    const serviceLevel = item?.serviceLevel ?? settings.serviceLevel;
    const excluded = item?.excluded ?? false;

    const p = plan({
      weekly: forecast, sigma, leadTimeDays, reviewDays: settings.reviewDays, serviceLevel, usable, incoming,
      minOrderQty: item?.minOrderQty ?? 1, packMultiple: item?.packMultiple ?? 1, manualReorderPoint: lvl?.reorderPoint ?? null, manualReorderQty: lvl?.reorderQty ?? null,
    });
    if (excluded || o.status !== "ACTIVE") { p.urgency = null; p.qty = 0; }
    const avgCost = Number(lvl?.avgCost ?? 0);
    const os = overstock(usable, forecast, settings.overstockDays);
    const risks = expiryRisk(bs.filter((b) => b.expiresOn && !isExpired(b.expiresOn)).map((b) => ({ id: b.id, free: Math.max(0, b.onHand - b.reserved), daysLeft: Math.round((startOfDay(b.expiresOn!).getTime() - today.getTime()) / DAY) })), forecast);
    const batchRows: BatchRisk[] = bs.filter((b) => b.expiresOn).map((b) => {
      const exp = isExpired(b.expiresOn);
      const r = risks.find((x) => x.id === b.id);
      const free = Math.max(0, b.onHand - b.reserved);
      const atRisk = exp ? free : r?.atRisk ?? 0;
      return { id: b.id, lotCode: b.lotCode, expiresOn: b.expiresOn!, daysLeft: Math.round((startOfDay(b.expiresOn!).getTime() - today.getTime()) / DAY), free, sells: exp ? 0 : r?.sells ?? free, atRisk, value: Math.round(atRisk * avgCost * 100) / 100, expired: exp };
    }).sort((a, b) => a.daysLeft - b.daysLeft);

    rows.push({
      key, offerId, addressId, warehouse: whName.get(addressId) ?? "—", product: o.packaging.variant.product.name, packaging: o.packaging.name, sku: o.vendorSku, categoryPath: path,
      history: raw.map((v) => Math.round(v * 100) / 100), mondays, fit: f, forecast, low, high, futureMondays, events: evs,
      onHand, reserved, usable, expired, incoming, draft, inTransit, avgCost, manualReorderPoint: lvl?.reorderPoint ?? null, manualReorderQty: lvl?.reorderQty ?? null,
      serviceLevel, leadTimeDays, leadBasis, source, unitCost, minOrderQty: item?.minOrderQty ?? 1, packMultiple: item?.packMultiple ?? 1, excluded, itemId: item?.id ?? null, note: item?.note ?? null,
      plan: p, overstock: { ...os, value: Math.round(os.excess * avgCost * 100) / 100 }, batches: batchRows,
    });
  }
  return {
    companyId, name: company.tradeName ?? company.legalName, type: company.type, inHouse: company.isInHouse, countryId: company.countryId, settings, defaults,
    thisMonday, rows, sources, events, warehouses: wh, markdown: invSettings.markdown,
  };
}

export const rowLabel = (r: Pick<PlanRow, "product" | "packaging" | "sku">, locale: string) =>
  `${pickLocalized(r.product as never, locale)} · ${pickLocalized(r.packaging as never, locale)}${r.sku ? ` · ${r.sku}` : ""}`;

// ── overstock & expiry actions ─────────────────────────────────────────────

/** A discount only makes sense close to the date; further out: stop buying and watch it. */
export const MARKDOWN_WITHIN_DAYS = 30;

export type RiskAction =
  | { kind: "TRANSFER"; toAddressId: string; to: string; qty: number }
  | { kind: "MARKDOWN"; pct: number; batchId: string; enabled: boolean }
  | { kind: "WRITE_OFF"; batchId: string }
  | { kind: "STOP_BUYING" };
export type RiskRow = {
  key: string; kind: "EXPIRY" | "OVERSTOCK"; offerId: string; addressId: string; warehouse: string; product: Prisma.JsonValue; packaging: Prisma.JsonValue; sku: string | null;
  units: number; value: number; coverDays: number | null; dailyDemand: number; batch: BatchRisk | null; action: RiskAction; noSales: boolean;
};

/** Spare demand in another warehouse of the company within `days`: its forecast minus what it already has. */
function needElsewhere(rows: PlanRow[], r: PlanRow, days: number) {
  let best: { row: PlanRow; need: number } | null = null;
  for (const o of rows) {
    if (o.offerId !== r.offerId || o.addressId === r.addressId) continue;
    const want = Math.floor(demandOver(o.forecast, days) + o.plan.safetyStock);
    const need = want - (o.usable + o.incoming);
    if (need > 0 && (!best || need > best.need)) best = { row: o, need };
  }
  return best;
}

export function riskRows(cp: CompanyPlan): RiskRow[] {
  const out: RiskRow[] = [];
  for (const r of cp.rows) {
    const base = { offerId: r.offerId, addressId: r.addressId, warehouse: r.warehouse, product: r.product, packaging: r.packaging, sku: r.sku, dailyDemand: r.plan.dailyDemand, coverDays: r.overstock.coverDays, noSales: r.overstock.noSales };
    let expiryUnits = 0;
    for (const b of r.batches) {
      if (b.atRisk <= 0) continue;
      expiryUnits += b.atRisk;
      let action: RiskAction;
      if (b.expired) action = { kind: "WRITE_OFF", batchId: b.id };
      else {
        const other = needElsewhere(cp.rows, r, b.daysLeft);
        action = other ? { kind: "TRANSFER", toAddressId: other.row.addressId, to: other.row.warehouse, qty: Math.min(b.atRisk, other.need) }
          : b.daysLeft <= MARKDOWN_WITHIN_DAYS ? { kind: "MARKDOWN", pct: markdownPct(b.daysLeft), batchId: b.id, enabled: cp.markdown } : { kind: "STOP_BUYING" };
      }
      out.push({ ...base, key: `EXPIRY:${b.id}`, kind: "EXPIRY", units: b.atRisk, value: b.value, batch: b, action });
    }
    const excess = Math.max(0, r.overstock.excess - expiryUnits);
    if (excess > 0 && r.onHand > 0) {
      const other = needElsewhere(cp.rows, r, cp.settings.overstockDays);
      out.push({
        ...base, key: `OVERSTOCK:${r.offerId}:${r.addressId}`, kind: "OVERSTOCK", units: excess, value: Math.round(excess * r.avgCost * 100) / 100, batch: null,
        action: other ? { kind: "TRANSFER", toAddressId: other.row.addressId, to: other.row.warehouse, qty: Math.min(excess, other.need) } : { kind: "STOP_BUYING" },
      });
    }
  }
  // expiry: soonest date first; overstock: largest value first
  return out.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "EXPIRY" ? -1 : 1) || (a.batch && b.batch ? a.batch.daysLeft - b.batch.daysLeft : 0) || b.value - a.value);
}

/** Stock-holding companies the nightly run plans for. */
export const plannedCompanies = () =>
  prisma.company.findMany({ where: { type: { in: ["DISTRIBUTOR", "WHOLESALER"] }, status: "APPROVED" }, select: { id: true, legalName: true, tradeName: true, type: true, isInHouse: true }, orderBy: { legalName: "asc" } });
