import "server-only";
/**
 * Sales reps (Phase 62). Rules in src/lib/sales-reps.ts; docs in docs/sales-reps.md.
 *
 *   • The supplier's manager (vendor.reps.manage) makes company users reps (commission %, monthly target), assigns
 *     customers (one rep per customer), plans visits and sees results per month (+ CSV).
 *   • A rep (vendor.reps.field) works from the phone: today's visits (check in, outcome, note, photos), own customers
 *     (last order, days since), the customer's card, and takes orders at the customer's own prices.
 *   • An order a rep takes waits for the customer's confirmation — or is placed at once when the customer lets that
 *     supplier's reps order for it (FIRINGI can switch that off). Placing goes through the normal checkout: the
 *     customer's prices, minimums, credit, budgets; FIRINGI invoices the customer as always.
 *   • Every order from a rep's customer (any channel) carries the rep (Order.salesRepId): delivered net goods give
 *     the rep's commission — between the supplier and its rep; FIRINGI only reports it.
 */
import type { Prisma, RepOrderStatus, RepVisitOutcome } from "@prisma/client";
import Decimal from "decimal.js";
import { prisma } from "@/server/db";
import { loadContext, type Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";
import { notify } from "@/server/notify/dispatch";
import { pickLocalized } from "@/i18n/config";
import { storeUpload } from "@/server/services/storage";
import { pricedOffers } from "@/server/data/catalogue-buyer";
import { commission, daysSince, mergeSalesRepSettings, monthRange, type SalesRepSettings } from "@/lib/sales-reps";

const KEY = "salesreps.settings";
const isStaff = (ctx: Ctx) => ctx.company.type === "ADMIN";
const isSeller = (ctx: Ctx) => ctx.company.type === "WHOLESALER" || ctx.company.type === "DISTRIBUTOR";
const isBuyer = (ctx: Ctx) => ctx.company.type === "CUSTOMER" || ctx.company.type === "WHOLESALER";
const num = (v: { toString(): string } | null | undefined) => (v == null ? null : Number(v.toString()));
const nameOf = (c: { legalName: string; tradeName: string | null } | null | undefined) => c?.tradeName ?? c?.legalName ?? "—";
const day = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
async function uiLocale(ctx: Ctx) {
  try { return await (await import("next-intl/server")).getLocale(); } catch { return ctx.user.locale ?? "en"; }
}

// ── settings ────────────────────────────────────────────────────────────────

export async function salesRepSettings(): Promise<SalesRepSettings> {
  const row = await prisma.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: KEY } });
  return mergeSalesRepSettings(row?.value as Partial<SalesRepSettings> | null);
}

export async function saveSalesRepSettings(ctx: Ctx, input: Partial<SalesRepSettings>) {
  if (!isStaff(ctx) || !can(ctx, "admin.settings.manage")) throw new ForbiddenError();
  const before = await salesRepSettings();
  const v = mergeSalesRepSettings({ ...before, ...input });
  const row = await prisma.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: KEY } });
  if (row) await prisma.setting.update({ where: { id: row.id }, data: { value: v as unknown as Prisma.InputJsonValue } });
  else await prisma.setting.create({ data: { scope: "GLOBAL", scopeId: "", key: KEY, value: v as unknown as Prisma.InputJsonValue } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "salesreps.settings", entityType: "Setting", entityId: KEY, before: before as unknown as Prisma.InputJsonValue, after: v as unknown as Prisma.InputJsonValue });
  return v;
}

async function requireOn() {
  if (!(await salesRepSettings()).enabled) throw new AppError("SALES_REPS_OFF", "Sales reps are switched off by FIRINGI.", 409);
}
function requireManager(ctx: Ctx) {
  if (!isSeller(ctx) || ctx.company.status !== "APPROVED" || !can(ctx, "vendor.reps.manage")) throw new ForbiddenError();
}
async function requireRep(ctx: Ctx) {
  if (!isSeller(ctx) || !can(ctx, "vendor.reps.field")) throw new ForbiddenError();
  const rep = await prisma.salesRep.findUnique({ where: { vendorCompanyId_userId: { vendorCompanyId: ctx.company.id, userId: ctx.user.id } } });
  if (!rep || !rep.active) throw new AppError("NOT_A_REP", "You are not an active sales rep of this company.", 403);
  return rep;
}
export async function myRep(ctx: Ctx) {
  if (!isSeller(ctx)) return null;
  return prisma.salesRep.findUnique({ where: { vendorCompanyId_userId: { vendorCompanyId: ctx.company.id, userId: ctx.user.id } } });
}

// ── month results (shared by manager, rep and FIRINGI) ─────────────────────

type MonthRow = { repId: string; delivered: number; deliveredOrders: number; orders: number };
async function monthNumbers(vendorCompanyId: string | null, from: Date, to: Date): Promise<Map<string, MonthRow>> {
  const vendor = vendorCompanyId ? prisma.$queryRaw<MonthRow[]>`
      SELECT o."salesRepId" AS "repId",
        coalesce(sum(CASE WHEN d.at IS NOT NULL THEN o."netTotal" - o."deliveryFeeNet" END), 0)::float AS delivered,
        count(d.at)::int AS "deliveredOrders", count(*) FILTER (WHERE o."placedAt" >= ${from} AND o."placedAt" < ${to})::int AS orders
      FROM "Order" o
      LEFT JOIN LATERAL (SELECT max(h.at) AS at FROM "OrderStatusHistory" h WHERE h."orderId" = o.id AND h."toStatus" = 'DELIVERED' AND h.at >= ${from} AND h.at < ${to}) d ON true
      WHERE o."salesRepId" IS NOT NULL AND o."sellerCompanyId" = ${vendorCompanyId} AND o.status <> 'CANCELLED'
        AND ((o."placedAt" >= ${from} AND o."placedAt" < ${to}) OR d.at IS NOT NULL)
      GROUP BY o."salesRepId"` : prisma.$queryRaw<MonthRow[]>`
      SELECT o."salesRepId" AS "repId",
        coalesce(sum(CASE WHEN d.at IS NOT NULL THEN o."netTotal" - o."deliveryFeeNet" END), 0)::float AS delivered,
        count(d.at)::int AS "deliveredOrders", count(*) FILTER (WHERE o."placedAt" >= ${from} AND o."placedAt" < ${to})::int AS orders
      FROM "Order" o
      LEFT JOIN LATERAL (SELECT max(h.at) AS at FROM "OrderStatusHistory" h WHERE h."orderId" = o.id AND h."toStatus" = 'DELIVERED' AND h.at >= ${from} AND h.at < ${to}) d ON true
      WHERE o."salesRepId" IS NOT NULL AND o.status <> 'CANCELLED'
        AND ((o."placedAt" >= ${from} AND o."placedAt" < ${to}) OR d.at IS NOT NULL)
      GROUP BY o."salesRepId"`;
  return new Map((await vendor).map((r) => [r.repId, r]));
}

async function repResults(reps: { id: string; commissionPct: Prisma.Decimal; monthlyTarget: Prisma.Decimal | null }[], vendorCompanyId: string | null, month?: string | null) {
  const { key, from, to } = monthRange(month);
  const ids = reps.map((r) => r.id);
  const [nums, visits, repOrders, customers] = await Promise.all([
    monthNumbers(vendorCompanyId, from, to),
    prisma.repVisit.groupBy({ by: ["repId", "status"], where: { repId: { in: ids }, plannedFor: { gte: from, lt: to } }, _count: { _all: true } }),
    prisma.repOrder.groupBy({ by: ["repId", "status"], where: { repId: { in: ids }, createdAt: { gte: from, lt: to } }, _count: { _all: true } }),
    prisma.repAssignment.groupBy({ by: ["repId"], where: { repId: { in: ids } }, _count: { _all: true } }),
  ]);
  const v = (repId: string, s: string) => visits.find((x) => x.repId === repId && x.status === s)?._count._all ?? 0;
  const o = (repId: string, s: string) => repOrders.find((x) => x.repId === repId && x.status === s)?._count._all ?? 0;
  return {
    month: key,
    rows: new Map(reps.map((r) => {
      const n = nums.get(r.id);
      const delivered = Math.round((n?.delivered ?? 0) * 100) / 100;
      const c = commission(delivered, Number(r.commissionPct), num(r.monthlyTarget));
      return [r.id, {
        customers: customers.find((x) => x.repId === r.id)?._count._all ?? 0,
        visitsPlanned: v(r.id, "PLANNED") + v(r.id, "DONE") + v(r.id, "MISSED"), visitsDone: v(r.id, "DONE"),
        repOrders: o(r.id, "PLACED"), repOrdersPending: o(r.id, "PENDING"), orders: n?.orders ?? 0, deliveredOrders: n?.deliveredOrders ?? 0,
        delivered, commission: c.commission, targetPct: c.targetPct,
      }];
    })),
  };
}

// ── manager ─────────────────────────────────────────────────────────────────

export async function team(ctx: Ctx, month?: string | null) {
  requireManager(ctx);
  const reps = await prisma.salesRep.findMany({ where: { vendorCompanyId: ctx.company.id }, orderBy: { createdAt: "asc" } });
  const users = await prisma.user.findMany({ where: { id: { in: reps.map((r) => r.userId) } }, select: { id: true, name: true, email: true, phone: true } });
  const un = new Map(users.map((u) => [u.id, u]));
  const res = await repResults(reps, ctx.company.id, month);
  const members = await prisma.membership.findMany({ where: { companyId: ctx.company.id, status: "ACTIVE", userId: { notIn: reps.map((r) => r.userId) } }, select: { userId: true, user: { select: { name: true, email: true } } } });
  return {
    month: res.month,
    reps: reps.map((r) => ({
      id: r.id, userId: r.userId, name: un.get(r.userId)?.name ?? "—", email: un.get(r.userId)?.email ?? "", phone: un.get(r.userId)?.phone ?? null,
      active: r.active, commissionPct: Number(r.commissionPct), monthlyTarget: num(r.monthlyTarget), ...res.rows.get(r.id)!,
    })),
    candidates: members.map((m) => ({ userId: m.userId, name: m.user.name, email: m.user.email })),
  };
}

/** Make a company user a rep (or update one): gives the "Sales Rep" role when the user can't work as a rep yet. */
export async function saveRep(ctx: Ctx, i: { userId: string; commissionPct: number; monthlyTarget?: number | null; active?: boolean }) {
  requireManager(ctx);
  await requireOn();
  const pct = Number(i.commissionPct);
  if (!Number.isFinite(pct) || pct < 0 || pct > 50) throw new ValidationError("Commission must be between 0 and 50 %.");
  const target = i.monthlyTarget == null ? null : Number(i.monthlyTarget);
  if (target != null && (!Number.isFinite(target) || target < 0)) throw new ValidationError("Enter a valid monthly target.");
  const m = await prisma.membership.findFirst({ where: { companyId: ctx.company.id, userId: i.userId, status: "ACTIVE" }, include: { roles: { include: { role: { select: { key: true } } } } } });
  if (!m) throw new NotFoundError("User");
  const data = { commissionPct: pct.toFixed(2), monthlyTarget: target == null ? null : target.toFixed(2), active: i.active ?? true };
  const rep = await prisma.salesRep.upsert({ where: { vendorCompanyId_userId: { vendorCompanyId: ctx.company.id, userId: i.userId } }, create: { vendorCompanyId: ctx.company.id, userId: i.userId, ...data }, update: data });
  const userCtx = await loadContext(i.userId, "salesrep", ctx.company.id).catch(() => null);
  if (!m.isOwner && !(userCtx?.company.id === ctx.company.id && userCtx.permissions.has("vendor.reps.field"))) {
    const role = await prisma.role.findFirstOrThrow({ where: { companyId: null, key: "VENDOR_REP" } });
    await prisma.membershipRole.upsert({ where: { membershipId_roleId: { membershipId: m.id, roleId: role.id } }, create: { membershipId: m.id, roleId: role.id, assignedById: ctx.user.id }, update: {} });
  }
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "salesrep.saved", entityType: "SalesRep", entityId: rep.id, after: { userId: i.userId, ...data } });
  return rep.id;
}

/** The supplier's customers (ordered from it, joined from its storefront, or already assigned) with their rep. */
export async function assignableCustomers(ctx: Ctx, q?: string | null) {
  requireManager(ctx);
  const [orders, links, asg] = await Promise.all([
    prisma.order.groupBy({ by: ["buyerCompanyId"], where: { sellerCompanyId: ctx.company.id }, _max: { placedAt: true }, _count: { _all: true } }),
    prisma.storefrontLink.findMany({ where: { storeCompanyId: ctx.company.id }, select: { buyerCompanyId: true } }),
    prisma.repAssignment.findMany({ where: { vendorCompanyId: ctx.company.id } }),
  ]);
  // searching by name also finds approved businesses that haven't ordered yet (prospects)
  const t0 = (q ?? "").trim();
  const found = t0.length >= 2
    ? await prisma.company.findMany({ where: { status: "APPROVED", countryId: ctx.company.countryId, type: ctx.company.type === "DISTRIBUTOR" ? "WHOLESALER" : "CUSTOMER", OR: [{ legalName: { contains: t0, mode: "insensitive" } }, { tradeName: { contains: t0, mode: "insensitive" } }] }, select: { id: true }, take: 30 })
    : [];
  const ids = [...new Set([...orders.map((o) => o.buyerCompanyId), ...links.map((l) => l.buyerCompanyId), ...asg.map((a) => a.buyerCompanyId), ...found.map((f) => f.id)])];
  const cos = await prisma.company.findMany({ where: { id: { in: ids }, status: "APPROVED" }, select: { id: true, legalName: true, tradeName: true, addresses: { where: { kind: "DELIVERY", isActive: true }, select: { cityName: true }, take: 1 } } });
  const om = new Map(orders.map((o) => [o.buyerCompanyId, o]));
  const am = new Map(asg.map((a) => [a.buyerCompanyId, a.repId]));
  const t = (q ?? "").trim().toLowerCase();
  return cos
    .map((c) => ({ id: c.id, name: nameOf(c), city: c.addresses[0]?.cityName ?? null, orders: om.get(c.id)?._count._all ?? 0, lastOrder: om.get(c.id)?._max.placedAt?.toISOString() ?? null, repId: am.get(c.id) ?? null }))
    .filter((c) => !t || c.name.toLowerCase().includes(t) || (c.city ?? "").toLowerCase().includes(t))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function assignCustomer(ctx: Ctx, buyerCompanyId: string, repId: string | null) {
  requireManager(ctx);
  if (repId === null) { await prisma.repAssignment.deleteMany({ where: { vendorCompanyId: ctx.company.id, buyerCompanyId } }); return; }
  const rep = await prisma.salesRep.findFirst({ where: { id: repId, vendorCompanyId: ctx.company.id } });
  if (!rep) throw new NotFoundError("Rep");
  if (!(await prisma.company.findFirst({ where: { id: buyerCompanyId, type: { in: ["CUSTOMER", "WHOLESALER"] } }, select: { id: true } }))) throw new NotFoundError("Customer");
  await prisma.repAssignment.upsert({ where: { vendorCompanyId_buyerCompanyId: { vendorCompanyId: ctx.company.id, buyerCompanyId } }, create: { repId, vendorCompanyId: ctx.company.id, buyerCompanyId }, update: { repId } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "salesrep.assigned", entityType: "Company", entityId: buyerCompanyId, after: { repId } });
}

/** Plan a visit: managers for any rep, reps for themselves — always one of the rep's customers. */
export async function planVisit(ctx: Ctx, i: { buyerCompanyId: string; date: string; repId?: string | null; note?: string | null }) {
  await requireOn();
  let repId: string;
  if (i.repId && can(ctx, "vendor.reps.manage")) {
    requireManager(ctx);
    const r = await prisma.salesRep.findFirst({ where: { id: i.repId, vendorCompanyId: ctx.company.id } });
    if (!r) throw new NotFoundError("Rep");
    repId = r.id;
  } else repId = (await requireRep(ctx)).id;
  const asg = await prisma.repAssignment.findUnique({ where: { vendorCompanyId_buyerCompanyId: { vendorCompanyId: ctx.company.id, buyerCompanyId: i.buyerCompanyId } } });
  if (!asg || asg.repId !== repId) throw new ValidationError("This customer isn't assigned to that rep.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.date)) throw new ValidationError("Choose a date.");
  const when = new Date(`${i.date}T00:00:00Z`);
  if (when < day(new Date(Date.now() - 86400_000))) throw new ValidationError("Choose today or a later date.");
  const v = await prisma.repVisit.create({ data: { repId, vendorCompanyId: ctx.company.id, buyerCompanyId: i.buyerCompanyId, plannedFor: when, note: i.note?.trim().slice(0, 500) || null, createdById: ctx.user.id } });
  return v.id;
}

// ── the rep's day ───────────────────────────────────────────────────────────

async function customerFacts(vendorCompanyId: string, buyerIds: string[]) {
  if (!buyerIds.length) return new Map<string, { name: string; city: string | null; address: string | null; phone: string | null; lastOrder: string | null; openOrders: number; orders90: number }>();
  const since = new Date(Date.now() - 90 * 86400_000);
  const [cos, last, open, recent] = await Promise.all([
    prisma.company.findMany({ where: { id: { in: buyerIds } }, select: { id: true, legalName: true, tradeName: true, phone: true, addresses: { where: { kind: "DELIVERY", isActive: true }, orderBy: { isDefault: "desc" }, select: { line1: true, postalCode: true, cityName: true }, take: 1 } } }),
    prisma.order.groupBy({ by: ["buyerCompanyId"], where: { sellerCompanyId: vendorCompanyId, buyerCompanyId: { in: buyerIds }, status: { not: "CANCELLED" } }, _max: { placedAt: true } }),
    prisma.order.groupBy({ by: ["buyerCompanyId"], where: { sellerCompanyId: vendorCompanyId, buyerCompanyId: { in: buyerIds }, status: { in: ["PENDING_CONFIRMATION", "SUPPLIER_PROCESSING", "READY_FOR_PICKUP", "DISPATCHED", "OUT_FOR_DELIVERY"] } }, _count: { _all: true } }),
    prisma.order.groupBy({ by: ["buyerCompanyId"], where: { sellerCompanyId: vendorCompanyId, buyerCompanyId: { in: buyerIds }, status: { not: "CANCELLED" }, placedAt: { gte: since } }, _count: { _all: true } }),
  ]);
  return new Map(cos.map((c) => [c.id, {
    name: nameOf(c), city: c.addresses[0]?.cityName ?? null, phone: c.phone ?? null,
    address: c.addresses[0] ? `${c.addresses[0].line1}, ${c.addresses[0].postalCode} ${c.addresses[0].cityName}` : null,
    lastOrder: last.find((x) => x.buyerCompanyId === c.id)?._max.placedAt?.toISOString() ?? null,
    openOrders: open.find((x) => x.buyerCompanyId === c.id)?._count._all ?? 0,
    orders90: recent.find((x) => x.buyerCompanyId === c.id)?._count._all ?? 0,
  }]));
}

async function placesOf(buyerIds: string[]) {
  const geo = buyerIds.length ? await prisma.address.findMany({ where: { companyId: { in: buyerIds }, kind: "DELIVERY", isActive: true, latitude: { not: null } }, orderBy: { isDefault: "desc" }, select: { companyId: true, latitude: true, longitude: true } }) : [];
  const place = new Map<string, { lat: number; lng: number }>();
  for (const g of geo) if (!place.has(g.companyId) && g.latitude != null && g.longitude != null) place.set(g.companyId, { lat: Number(g.latitude), lng: Number(g.longitude) });
  return place;
}

export async function myDay(ctx: Ctx, date?: string | null) {
  const rep = await requireRep(ctx);
  const s = await salesRepSettings();
  const d = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00Z`) : day();
  const [visits, asg] = await Promise.all([
    prisma.repVisit.findMany({ where: { repId: rep.id, plannedFor: d }, orderBy: { createdAt: "asc" } }),
    prisma.repAssignment.findMany({ where: { repId: rep.id } }),
  ]);
  const facts = await customerFacts(ctx.company.id, [...new Set([...visits.map((v) => v.buyerCompanyId), ...asg.map((a) => a.buyerCompanyId)])]);
  const place = await placesOf(visits.map((v) => v.buyerCompanyId));
  const res = await repResults([rep], ctx.company.id);
  const r = res.rows.get(rep.id)!;
  return {
    enabled: s.enabled, maxPhotos: s.maxPhotos, date: d.toISOString().slice(0, 10),
    rep: { id: rep.id, commissionPct: Number(rep.commissionPct), monthlyTarget: num(rep.monthlyTarget) },
    month: { key: res.month, ...r },
    visits: visits.map((v) => ({ id: v.id, buyerCompanyId: v.buyerCompanyId, status: v.status, outcome: v.outcome, note: v.note, photos: v.photoKeys.length, checkInAt: v.checkInAt?.toISOString() ?? null, repOrderId: v.repOrderId, ...facts.get(v.buyerCompanyId)!, at: v.latitude != null && v.longitude != null ? { lat: Number(v.latitude), lng: Number(v.longitude) } : place.get(v.buyerCompanyId) ?? null })),
    customers: asg
      .map((a) => ({ id: a.buyerCompanyId, ...facts.get(a.buyerCompanyId)!, days: daysSince(facts.get(a.buyerCompanyId)?.lastOrder) }))
      .sort((a, b) => (b.days ?? 9999) - (a.days ?? 9999)),
  };
}

async function ownVisit(ctx: Ctx, id: string) {
  const rep = await requireRep(ctx);
  const v = await prisma.repVisit.findUnique({ where: { id } });
  if (!v || v.repId !== rep.id) throw new NotFoundError("Visit");
  return { rep, v };
}

/** Start a visit: today's planned one for the customer, or a new one. Location is optional. */
export async function checkIn(ctx: Ctx, i: { buyerCompanyId: string; latitude?: number | null; longitude?: number | null }) {
  await requireOn();
  const rep = await requireRep(ctx);
  const asg = await prisma.repAssignment.findUnique({ where: { vendorCompanyId_buyerCompanyId: { vendorCompanyId: ctx.company.id, buyerCompanyId: i.buyerCompanyId } } });
  if (!asg || asg.repId !== rep.id) throw new ValidationError("This customer isn't one of yours.");
  const geo = i.latitude != null && i.longitude != null && Math.abs(i.latitude) <= 90 && Math.abs(i.longitude) <= 180 ? { latitude: i.latitude.toFixed(6), longitude: i.longitude.toFixed(6) } : {};
  const planned = await prisma.repVisit.findFirst({ where: { repId: rep.id, buyerCompanyId: i.buyerCompanyId, plannedFor: day(), status: "PLANNED" } });
  const v = planned
    ? await prisma.repVisit.update({ where: { id: planned.id }, data: { checkInAt: planned.checkInAt ?? new Date(), ...geo } })
    : await prisma.repVisit.create({ data: { repId: rep.id, vendorCompanyId: ctx.company.id, buyerCompanyId: i.buyerCompanyId, plannedFor: day(), checkInAt: new Date(), createdById: ctx.user.id, ...geo } });
  return v.id;
}

export async function finishVisit(ctx: Ctx, id: string, i: { outcome: string; note?: string | null }) {
  const { v } = await ownVisit(ctx, id);
  if (v.status !== "PLANNED") throw new ValidationError("This visit is already closed.");
  if (!["ORDER", "NO_ORDER", "FOLLOW_UP", "CLOSED"].includes(i.outcome)) throw new ValidationError("Choose how the visit went.");
  await prisma.repVisit.update({ where: { id }, data: { status: "DONE", outcome: i.outcome as RepVisitOutcome, note: i.note?.trim().slice(0, 1000) || v.note, checkInAt: v.checkInAt ?? new Date(), checkOutAt: new Date() } });
}

export async function addVisitPhoto(ctx: Ctx, id: string, file: File) {
  const { v } = await ownVisit(ctx, id);
  const s = await salesRepSettings();
  if (v.photoKeys.length >= s.maxPhotos) throw new ValidationError(`At most ${s.maxPhotos} photos per visit.`);
  const stored = await storeUpload(file, "rep-visits");
  if (!stored.mimeType.startsWith("image/")) throw new ValidationError("Use a JPG, PNG or WEBP photo.");
  await prisma.repVisit.update({ where: { id }, data: { photoKeys: { push: stored.key } } });
}

/** A visit photo — for the rep, the supplier's managers and FIRINGI. */
export async function visitPhotoKey(ctx: Ctx, id: string, n: number) {
  const v = await prisma.repVisit.findUnique({ where: { id } });
  if (!v) return null;
  const ok = isStaff(ctx) || (ctx.company.id === v.vendorCompanyId && (can(ctx, "vendor.reps.manage") || (await myRep(ctx))?.id === v.repId));
  return ok ? v.photoKeys[n] ?? null : null;
}

export async function cancelVisit(ctx: Ctx, id: string) {
  const { v } = await ownVisit(ctx, id);
  if (v.status !== "PLANNED") throw new ValidationError("This visit is already closed.");
  await prisma.repVisit.update({ where: { id }, data: { status: "CANCELLED" } });
}

/** Planned visits from earlier days that nobody closed become "missed" (job). */
export async function closeMissedVisits(now = new Date()) {
  const r = await prisma.repVisit.updateMany({ where: { status: "PLANNED", plannedFor: { lt: day(now) } }, data: { status: "MISSED" } });
  return r.count;
}

// ── a customer's card + taking an order ─────────────────────────────────────

async function repCustomer(ctx: Ctx, buyerCompanyId: string) {
  const rep = await requireRep(ctx);
  const asg = await prisma.repAssignment.findUnique({ where: { vendorCompanyId_buyerCompanyId: { vendorCompanyId: ctx.company.id, buyerCompanyId } } });
  if (!asg || asg.repId !== rep.id) throw new NotFoundError("Customer");
  return rep;
}

/** Someone at the customer who can see prices / place orders (the person who ordered last, or another buyer). */
async function buyerCtx(buyerCompanyId: string, perm: "buyer.catalogue.view" | "buyer.orders.place" = "buyer.catalogue.view"): Promise<Ctx | null> {
  const last = await prisma.order.findFirst({ where: { buyerCompanyId }, orderBy: { placedAt: "desc" }, select: { placedByUserId: true } });
  const members = await prisma.membership.findMany({ where: { companyId: buyerCompanyId, status: "ACTIVE" }, orderBy: [{ isOwner: "desc" }, { createdAt: "asc" }], select: { userId: true }, take: 20 });
  for (const uid of [...(last ? [last.placedByUserId] : []), ...members.map((m) => m.userId)]) {
    const c = await loadContext(uid, "salesrep", buyerCompanyId).catch(() => null);
    if (c && c.company.id === buyerCompanyId && c.permissions.has(perm)) return c;
  }
  return null;
}

export async function customerCard(ctx: Ctx, buyerCompanyId: string) {
  const rep = await repCustomer(ctx, buyerCompanyId);
  const locale = await uiLocale(ctx);
  const [facts, addresses, orders, visits, pending, top] = await Promise.all([
    customerFacts(ctx.company.id, [buyerCompanyId]),
    prisma.address.findMany({ where: { companyId: buyerCompanyId, kind: "DELIVERY", isActive: true }, orderBy: { isDefault: "desc" }, select: { id: true, label: true, line1: true, postalCode: true, cityName: true } }),
    prisma.order.findMany({ where: { sellerCompanyId: ctx.company.id, buyerCompanyId }, orderBy: { placedAt: "desc" }, take: 6, select: { id: true, number: true, status: true, placedAt: true, netTotal: true } }),
    prisma.repVisit.findMany({ where: { repId: rep.id, buyerCompanyId }, orderBy: { plannedFor: "desc" }, take: 8 }),
    prisma.repOrder.findMany({ where: { repId: rep.id, buyerCompanyId, status: "PENDING" }, orderBy: { createdAt: "desc" } }),
    prisma.$queryRaw<{ offerId: string; qty: bigint }[]>`
      SELECT l."offerId", sum(coalesce(l."qtyDelivered", l."qtyConfirmed", l."qtyOrdered"))::bigint AS qty FROM "OrderLine" l JOIN "Order" o ON o.id = l."orderId"
      WHERE o."sellerCompanyId" = ${ctx.company.id} AND o."buyerCompanyId" = ${buyerCompanyId} AND o.status <> 'CANCELLED' AND o."placedAt" > now() - interval '180 days'
      GROUP BY l."offerId" ORDER BY qty DESC LIMIT 8`,
  ]);
  const pref = await prisma.repOrderPreference.findUnique({ where: { buyerCompanyId_vendorCompanyId: { buyerCompanyId, vendorCompanyId: ctx.company.id } } });
  const s = await salesRepSettings();
  const offers = await prisma.vendorOffer.findMany({ where: { id: { in: top.map((t) => t.offerId) } }, select: { id: true, packaging: { select: { name: true, variant: { select: { product: { select: { name: true } } } } } } } });
  const on = new Map(offers.map((o) => [o.id, o]));
  return {
    customer: { id: buyerCompanyId, ...facts.get(buyerCompanyId)!, days: daysSince(facts.get(buyerCompanyId)?.lastOrder) },
    autoConfirm: !!pref?.autoConfirm && s.allowAutoConfirm,
    addresses: addresses.map((a) => ({ id: a.id, label: a.label ?? `${a.line1}, ${a.cityName}`, text: `${a.line1}, ${a.postalCode} ${a.cityName}` })),
    orders: orders.map((o) => ({ id: o.id, number: o.number, status: o.status, placedAt: o.placedAt.toISOString(), net: Number(o.netTotal) })),
    visits: visits.map((v) => ({ id: v.id, date: v.plannedFor.toISOString().slice(0, 10), status: v.status, outcome: v.outcome, note: v.note, photos: v.photoKeys.length })),
    pending: pending.map((p) => ({ id: p.id, totalNet: Number(p.totalNet), createdAt: p.createdAt.toISOString(), expiresAt: p.expiresAt.toISOString(), lines: (p.items as { offerId: string; qty: number }[]).length })),
    usual: top.map((t) => ({ offerId: t.offerId, qty: Number(t.qty), name: pickLocalized(on.get(t.offerId)?.packaging.variant.product.name, locale) || "—", packaging: pickLocalized(on.get(t.offerId)?.packaging.name, locale) || "" })),
  };
}

/** The supplier's products at this customer's prices (for taking an order). */
export async function productsForCustomer(ctx: Ctx, buyerCompanyId: string, q?: string | null) {
  await repCustomer(ctx, buyerCompanyId);
  const locale = await uiLocale(ctx);
  const t = (q ?? "").trim();
  const rows = await prisma.vendorOffer.findMany({
    where: {
      vendorCompanyId: ctx.company.id, status: "ACTIVE",
      ...(t ? { OR: [{ vendorSku: { contains: t, mode: "insensitive" } }, { packaging: { variant: { product: { searchText: { contains: t.toLowerCase() } } } } }] } : {}),
    },
    select: { id: true }, take: 40,
  });
  const buyer = await buyerCtx(buyerCompanyId);
  if (!buyer) return [];
  const priced = (await pricedOffers(buyer, rows.map((r) => ({ offerId: r.id, qty: 1 })))).items;
  return priced.filter((p) => p.price).map((p) => ({
    offerId: p.offerId, name: pickLocalized(p.name, locale) || "—", brand: p.brand, packaging: pickLocalized(p.packaging.name, locale) || "", sku: p.vendorSku ?? p.sku,
    unitNet: Number(p.price!.unitPriceNet), available: p.available ?? 0, minQty: p.minOrderQty, step: p.qtyStep,
  }));
}

export type TakeOrderInput = { buyerCompanyId: string; addressId: string; items: { offerId: string; qty: number }[]; note?: string | null; visitId?: string | null };

/** The rep takes an order: it waits for the customer — or is placed now when the customer allows it. */
export async function takeOrder(ctx: Ctx, i: TakeOrderInput) {
  await requireOn();
  const rep = await repCustomer(ctx, i.buyerCompanyId);
  const s = await salesRepSettings();
  const items = i.items.filter((x) => Number.isInteger(x.qty) && x.qty > 0);
  if (!items.length) throw new ValidationError("Add at least one product.");
  if (items.length > 100) throw new ValidationError("At most 100 lines.");
  const addr = await prisma.address.findFirst({ where: { id: i.addressId, companyId: i.buyerCompanyId, kind: "DELIVERY", isActive: true } });
  if (!addr) throw new ValidationError("Choose one of the customer's delivery addresses.");
  const own = await prisma.vendorOffer.count({ where: { id: { in: items.map((x) => x.offerId) }, vendorCompanyId: ctx.company.id, status: "ACTIVE" } });
  if (own !== new Set(items.map((x) => x.offerId)).size) throw new ValidationError("Choose your own active products.");
  const buyer = await buyerCtx(i.buyerCompanyId);
  if (!buyer) throw new AppError("NO_BUYER", "The customer has nobody who can order at the moment.", 409);
  const priced = await pricedOffers(buyer, items);
  if (priced.unavailable.length || priced.items.some((p) => !p.price)) throw new ValidationError("Some products can't be sold to this customer (not visible or no price).");
  const totalNet = priced.items.reduce((a, p) => a.plus(new Decimal(p.price!.unitPriceNet).mul(p.qty)), new Decimal(0));
  const pref = await prisma.repOrderPreference.findUnique({ where: { buyerCompanyId_vendorCompanyId: { buyerCompanyId: i.buyerCompanyId, vendorCompanyId: ctx.company.id } } });
  const auto = !!pref?.autoConfirm && s.allowAutoConfirm;
  const ro = await prisma.repOrder.create({
    data: {
      repId: rep.id, vendorCompanyId: ctx.company.id, buyerCompanyId: i.buyerCompanyId, addressId: addr.id, items: items as unknown as Prisma.InputJsonValue,
      note: i.note?.trim().slice(0, 500) || null, totalNet: totalNet.toFixed(2), auto, expiresAt: new Date(Date.now() + s.confirmHours * 3600_000),
    },
  });
  if (i.visitId) await prisma.repVisit.updateMany({ where: { id: i.visitId, repId: rep.id }, data: { repOrderId: ro.id, outcome: "ORDER" } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "salesrep.order_taken", entityType: "RepOrder", entityId: ro.id, after: { buyer: i.buyerCompanyId, lines: items.length, totalNet: totalNet.toFixed(2), auto } });
  if (auto) {
    const placer = await buyerCtx(i.buyerCompanyId, "buyer.orders.place");
    if (!placer) return finishRepOrder(ro.id, "FAILED", { error: "Nobody at the customer may place orders." });
    return placeRepOrder(ro.id, placer, null);
  }
  const vendor = await prisma.company.findUniqueOrThrow({ where: { id: ctx.company.id }, select: { legalName: true, tradeName: true } });
  await notify("reporder.proposed", [{ companyId: i.buyerCompanyId, link: "/buy/orders/rep-orders" }], { rep: ctx.user.name, supplier: nameOf(vendor), total: Number(totalNet.toFixed(2)), hours: s.confirmHours }, { ref: { type: "RepOrder", id: ro.id } });
  return { id: ro.id, status: "PENDING" as RepOrderStatus, orderNumbers: [] as string[] };
}

async function finishRepOrder(id: string, status: RepOrderStatus, extra: { error?: string; by?: string | null; orderIds?: string[]; orderNumbers?: string[] } = {}) {
  await prisma.repOrder.update({ where: { id }, data: { status, decidedAt: new Date(), decidedById: extra.by ?? null, error: extra.error ?? null, orderIds: extra.orderIds ?? [], orderNumbers: extra.orderNumbers ?? [] } });
  return { id, status, orderNumbers: extra.orderNumbers ?? [], error: extra.error ?? null };
}

/** Place a rep's order through the normal checkout as the customer; the orders carry the rep. */
async function placeRepOrder(id: string, buyer: Ctx, by: string | null) {
  const ro = await prisma.repOrder.findUniqueOrThrow({ where: { id }, include: { rep: true } });
  const repUser = await prisma.user.findUnique({ where: { id: ro.rep.userId }, select: { name: true } });
  const { placeOrder } = await import("@/server/services/orders");
  try {
    const r = await placeOrder(buyer, { deliveryAddressId: ro.addressId, items: ro.items as { offerId: string; qty: number }[], notes: [`Sales rep: ${repUser?.name ?? ""}`, ro.note].filter(Boolean).join(" — "), approved: ro.auto ? undefined : true });
    const placed = "orders" in r && r.orders ? r.orders : "id" in r && r.id ? [{ id: r.id as string, number: (r as { number: string }).number }] : [];
    if (!placed.length) return finishRepOrder(id, "FAILED", { by, error: "The customer's approval rules hold this order — a manager at the customer decides." });
    await prisma.order.updateMany({ where: { id: { in: placed.map((o) => o.id) } }, data: { salesRepId: ro.repId } });
    const res = await finishRepOrder(id, "PLACED", { by, orderIds: placed.map((o) => o.id), orderNumbers: placed.map((o) => o.number) });
    await notify("reporder.placed", [{ companyId: ro.vendorCompanyId, link: "/vendor/reps" }], { numbers: placed.map((o) => o.number).join(", ") }, { ref: { type: "RepOrder", id } });
    return res;
  } catch (e) {
    const msg = e instanceof AppError ? e.message : "The order couldn't be placed.";
    if (!(e instanceof AppError)) console.error("rep order", id, e);
    return finishRepOrder(id, "FAILED", { by, error: msg });
  }
}

export async function cancelRepOrder(ctx: Ctx, id: string) {
  const rep = await requireRep(ctx);
  const ok = await prisma.repOrder.updateMany({ where: { id, repId: rep.id, status: "PENDING" }, data: { status: "CANCELLED", decidedAt: new Date(), decidedById: ctx.user.id } });
  if (ok.count !== 1) throw new ValidationError("This order was already decided.");
}

export async function myRepOrders(ctx: Ctx) {
  const rep = await requireRep(ctx);
  const rows = await prisma.repOrder.findMany({ where: { repId: rep.id }, orderBy: { createdAt: "desc" }, take: 50 });
  const cos = await prisma.company.findMany({ where: { id: { in: rows.map((r) => r.buyerCompanyId) } }, select: { id: true, legalName: true, tradeName: true } });
  const cn = new Map(cos.map((c) => [c.id, nameOf(c)]));
  return rows.map((r) => ({ id: r.id, customer: cn.get(r.buyerCompanyId) ?? "—", buyerCompanyId: r.buyerCompanyId, status: r.status, auto: r.auto, totalNet: Number(r.totalNet), lines: (r.items as unknown[]).length, orderNumbers: r.orderNumbers, orderIds: r.orderIds, error: r.error, createdAt: r.createdAt.toISOString(), expiresAt: r.expiresAt.toISOString() }));
}

// ── the customer ────────────────────────────────────────────────────────────

function requireBuyer(ctx: Ctx, place = false) {
  if (!isBuyer(ctx) || !can(ctx, place ? "buyer.orders.place" : ["buyer.orders.place", "buyer.orders.view"])) throw new ForbiddenError();
}

/** Orders reps took for this customer, waiting for confirmation (priced now, at the customer's prices). */
export async function pendingForMe(ctx: Ctx) {
  requireBuyer(ctx);
  const locale = await uiLocale(ctx);
  const rows = await prisma.repOrder.findMany({ where: { buyerCompanyId: ctx.company.id }, orderBy: { createdAt: "desc" }, take: 30, include: { rep: true } });
  const [users, vendors, addresses] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: rows.map((r) => r.rep.userId) } }, select: { id: true, name: true } }),
    prisma.company.findMany({ where: { id: { in: rows.map((r) => r.vendorCompanyId) } }, select: { id: true, legalName: true, tradeName: true } }),
    prisma.address.findMany({ where: { id: { in: rows.map((r) => r.addressId) } }, select: { id: true, line1: true, cityName: true } }),
  ]);
  const un = new Map(users.map((u) => [u.id, u.name])), vn = new Map(vendors.map((v) => [v.id, nameOf(v)])), an = new Map(addresses.map((a) => [a.id, `${a.line1}, ${a.cityName}`]));
  const out = [];
  for (const r of rows) {
    const items = r.items as { offerId: string; qty: number }[];
    const priced = r.status === "PENDING" ? (await pricedOffers(ctx, items)).items : [];
    out.push({
      id: r.id, status: r.status, auto: r.auto, rep: un.get(r.rep.userId) ?? "—", supplier: vn.get(r.vendorCompanyId) ?? "—", vendorCompanyId: r.vendorCompanyId,
      address: an.get(r.addressId) ?? "", note: r.note, totalNet: Number(r.totalNet), orderNumbers: r.orderNumbers, orderIds: r.orderIds, error: r.error,
      createdAt: r.createdAt.toISOString(), expiresAt: r.expiresAt.toISOString(),
      lines: priced.map((p) => ({ offerId: p.offerId, name: pickLocalized(p.name, locale) || "—", packaging: pickLocalized(p.packaging.name, locale) || "", qty: p.qty, unitNet: p.price ? Number(p.price.unitPriceNet) : null })),
    });
  }
  const s = await salesRepSettings();
  const prefs = await prisma.repOrderPreference.findMany({ where: { buyerCompanyId: ctx.company.id } });
  const myVendors = await prisma.repAssignment.findMany({ where: { buyerCompanyId: ctx.company.id }, select: { vendorCompanyId: true, rep: { select: { userId: true } } } });
  const repUsers = await prisma.user.findMany({ where: { id: { in: myVendors.map((v) => v.rep.userId) } }, select: { id: true, name: true } });
  const vcos = await prisma.company.findMany({ where: { id: { in: myVendors.map((v) => v.vendorCompanyId) } }, select: { id: true, legalName: true, tradeName: true } });
  return {
    allowAutoConfirm: s.allowAutoConfirm,
    items: out,
    suppliers: myVendors.map((v) => ({ vendorCompanyId: v.vendorCompanyId, supplier: nameOf(vcos.find((c) => c.id === v.vendorCompanyId)), rep: repUsers.find((u) => u.id === v.rep.userId)?.name ?? "—", autoConfirm: !!prefs.find((p) => p.vendorCompanyId === v.vendorCompanyId)?.autoConfirm })),
  };
}

export async function decideRepOrder(ctx: Ctx, id: string, accept: boolean) {
  requireBuyer(ctx, true);
  if (accept) await requireOn();
  const ro = await prisma.repOrder.findUnique({ where: { id } });
  if (!ro || ro.buyerCompanyId !== ctx.company.id) throw new NotFoundError("Order");
  if (ro.status !== "PENDING") throw new ValidationError("This order was already decided.");
  if (ro.expiresAt < new Date()) { await finishRepOrder(id, "EXPIRED"); throw new ValidationError("This order has expired — ask the rep for a new one."); }
  const claim = await prisma.repOrder.updateMany({ where: { id, status: "PENDING" }, data: { decidedAt: new Date() } });
  if (claim.count !== 1) throw new ValidationError("This order was already decided.");
  if (!accept) {
    const r = await finishRepOrder(id, "REJECTED", { by: ctx.user.id });
    await notify("reporder.rejected", [{ companyId: ro.vendorCompanyId, link: "/vendor/reps" }], { customer: nameOf(ctx.company) }, { ref: { type: "RepOrder", id } });
    return r;
  }
  return placeRepOrder(id, ctx, ctx.user.id);
}

export async function setAutoConfirm(ctx: Ctx, vendorCompanyId: string, on: boolean) {
  requireBuyer(ctx, true);
  if (on && !(await salesRepSettings()).allowAutoConfirm) throw new AppError("AUTO_OFF", "FIRINGI doesn't allow this at the moment.", 409);
  if (!(await prisma.repAssignment.findUnique({ where: { vendorCompanyId_buyerCompanyId: { vendorCompanyId, buyerCompanyId: ctx.company.id } } }))) throw new NotFoundError("Supplier");
  await prisma.repOrderPreference.upsert({ where: { buyerCompanyId_vendorCompanyId: { buyerCompanyId: ctx.company.id, vendorCompanyId } }, create: { buyerCompanyId: ctx.company.id, vendorCompanyId, autoConfirm: on }, update: { autoConfirm: on } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "salesrep.auto_confirm", entityType: "Company", entityId: vendorCompanyId, after: { on } });
}

/** Unconfirmed orders expire; planned visits from past days become missed (job). */
export async function processSalesReps(now = new Date()) {
  const due = await prisma.repOrder.findMany({ where: { status: "PENDING", expiresAt: { lt: now } }, take: 200 });
  for (const r of due) {
    const ok = await prisma.repOrder.updateMany({ where: { id: r.id, status: "PENDING" }, data: { status: "EXPIRED", decidedAt: now } });
    if (ok.count) await notify("reporder.expired", [{ companyId: r.vendorCompanyId, link: "/vendor/reps" }], { total: Number(r.totalNet) }, { ref: { type: "RepOrder", id: r.id } });
  }
  return { expired: due.length, missedVisits: await closeMissedVisits(now) };
}

/** Does any supplier's rep serve this customer (or has one taken an order for it)? */
export async function servedByReps(buyerCompanyId: string) {
  const [a, o] = await Promise.all([prisma.repAssignment.count({ where: { buyerCompanyId } }), prisma.repOrder.count({ where: { buyerCompanyId } })]);
  return a + o > 0;
}

/** The visit plan of a day (manager): every rep's visits with the customer's place, for the list and the map. */
export async function teamVisits(ctx: Ctx, date?: string | null) {
  requireManager(ctx);
  const d = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00Z`) : day();
  const [reps, visits, asg] = await Promise.all([
    prisma.salesRep.findMany({ where: { vendorCompanyId: ctx.company.id }, orderBy: { createdAt: "asc" } }),
    prisma.repVisit.findMany({ where: { vendorCompanyId: ctx.company.id, plannedFor: d }, orderBy: [{ checkInAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }] }),
    prisma.repAssignment.findMany({ where: { vendorCompanyId: ctx.company.id } }),
  ]);
  const users = await prisma.user.findMany({ where: { id: { in: reps.map((r) => r.userId) } }, select: { id: true, name: true } });
  const buyerIds = [...new Set([...visits.map((v) => v.buyerCompanyId), ...asg.map((a) => a.buyerCompanyId)])];
  const [facts, place] = await Promise.all([customerFacts(ctx.company.id, buyerIds), placesOf(buyerIds)]);
  return {
    date: d.toISOString().slice(0, 10),
    reps: reps.map((r) => ({
      id: r.id, name: users.find((u) => u.id === r.userId)?.name ?? "—", active: r.active,
      customers: asg.filter((a) => a.repId === r.id).map((a) => ({ id: a.buyerCompanyId, name: facts.get(a.buyerCompanyId)?.name ?? "—" })).sort((a, b) => a.name.localeCompare(b.name)),
      visits: visits.filter((v) => v.repId === r.id).map((v) => ({
        id: v.id, buyerCompanyId: v.buyerCompanyId, customer: facts.get(v.buyerCompanyId)?.name ?? "—", city: facts.get(v.buyerCompanyId)?.city ?? null,
        status: v.status, outcome: v.outcome, note: v.note, photos: v.photoKeys.length, checkInAt: v.checkInAt?.toISOString() ?? null, repOrderId: v.repOrderId,
        at: v.latitude != null && v.longitude != null ? { lat: Number(v.latitude), lng: Number(v.longitude) } : place.get(v.buyerCompanyId) ?? null,
      })),
    })),
  };
}

/** The rep of a customer at a supplier (stamped on every new order — any channel). */
export async function repFor(db: Pick<typeof prisma, "repAssignment">, vendorCompanyId: string, buyerCompanyId: string) {
  return (await db.repAssignment.findUnique({ where: { vendorCompanyId_buyerCompanyId: { vendorCompanyId, buyerCompanyId } }, select: { repId: true } }))?.repId ?? null;
}

// ── results / FIRINGI ───────────────────────────────────────────────────────

/** Results CSV for the manager (one row per rep). */
export async function resultsCsv(ctx: Ctx, month?: string | null) {
  const t = await team(ctx, month);
  const head = ["month", "rep", "email", "active", "customers", "visits_planned", "visits_done", "rep_orders", "orders", "delivered_orders", "delivered_net", "commission_pct", "commission", "target", "target_pct"];
  const esc = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [head.join(","), ...t.reps.map((r) => [t.month, r.name, r.email, r.active, r.customers, r.visitsPlanned, r.visitsDone, r.repOrders, r.orders, r.deliveredOrders, r.delivered.toFixed(2), r.commissionPct, r.commission.toFixed(2), r.monthlyTarget ?? "", r.targetPct ?? ""].map(esc).join(","))].join("\n");
}

export async function adminOverview(ctx: Ctx, month?: string | null) {
  if (!isStaff(ctx) || !can(ctx, ["admin.vendors.view", "admin.vendors.approve", "admin.settings.manage"])) throw new ForbiddenError();
  const reps = await prisma.salesRep.findMany({ orderBy: { createdAt: "asc" } });
  const res = await repResults(reps, null, month);
  const vendors = await prisma.company.findMany({ where: { id: { in: [...new Set(reps.map((r) => r.vendorCompanyId))] } }, select: { id: true, legalName: true, tradeName: true } });
  const users = await prisma.user.findMany({ where: { id: { in: reps.map((r) => r.userId) } }, select: { id: true, name: true } });
  const byVendor = new Map<string, { vendor: string; reps: number; active: number; customers: number; visitsDone: number; repOrders: number; delivered: number }>();
  for (const r of reps) {
    const x = byVendor.get(r.vendorCompanyId) ?? { vendor: nameOf(vendors.find((v) => v.id === r.vendorCompanyId)), reps: 0, active: 0, customers: 0, visitsDone: 0, repOrders: 0, delivered: 0 };
    const m = res.rows.get(r.id)!;
    x.reps++; if (r.active) x.active++; x.customers += m.customers; x.visitsDone += m.visitsDone; x.repOrders += m.repOrders; x.delivered += m.delivered;
    byVendor.set(r.vendorCompanyId, x);
  }
  return {
    month: res.month, settings: await salesRepSettings(),
    vendors: [...byVendor.entries()].map(([id, v]) => ({ id, ...v, delivered: Math.round(v.delivered * 100) / 100 })),
    reps: reps.map((r) => ({ id: r.id, name: users.find((u) => u.id === r.userId)?.name ?? "—", vendor: nameOf(vendors.find((v) => v.id === r.vendorCompanyId)), active: r.active, ...res.rows.get(r.id)! })),
  };
}
