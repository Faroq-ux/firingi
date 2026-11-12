/**
 * Recurring orders (Phase 26): a standing order placed automatically — every week / every two weeks
 * on a weekday, or monthly on a day (1–28) — for the person who set it up, at that day's prices,
 * through the normal checkout (stock, minimums, credit, risk checks). A reminder goes out the day(s)
 * before with a stock check; the buyer can skip the next one, pause, change or end it. If a run
 * fails (out of stock, below minimum, credit…) the buyer is told and the next date stays.
 * Set up by someone who needs approval for it (the buyer's own rules): a manager approves it once.
 */
import Decimal from "decimal.js";
import type { RecurringFrequency } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { loadContext } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";
import { notify } from "@/server/notify/dispatch";
import { pricedOffers } from "@/server/data/catalogue-buyer";
import { pickLocalized } from "@/i18n/config";

const day = 86_400_000;
const RUN_HOUR = 6; // orders are placed at 06:00 UTC on the day

export type Schedule = { frequency: RecurringFrequency; weekday?: number | null; dayOfMonth?: number | null };

function validate(s: Schedule) {
  if (s.frequency === "MONTHLY") {
    if (!Number.isInteger(s.dayOfMonth) || s.dayOfMonth! < 1 || s.dayOfMonth! > 28) throw new ValidationError("Choose a day of the month between 1 and 28.");
  } else if (!Number.isInteger(s.weekday) || s.weekday! < 1 || s.weekday! > 7) throw new ValidationError("Choose a weekday.");
}

/** The first run after `after` (exclusive). Weekday 1 = Monday … 7 = Sunday. */
export function firstRun(s: Schedule, after: Date) {
  const at = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), RUN_HOUR));
  if (s.frequency === "MONTHLY") {
    let c = new Date(Date.UTC(after.getUTCFullYear(), after.getUTCMonth(), s.dayOfMonth!, RUN_HOUR));
    if (c.getTime() <= after.getTime()) c = new Date(Date.UTC(after.getUTCFullYear(), after.getUTCMonth() + 1, s.dayOfMonth!, RUN_HOUR));
    return c;
  }
  let c = at(after);
  for (let n = 0; n < 8; n++) {
    const wd = ((c.getUTCDay() + 6) % 7) + 1;
    if (wd === s.weekday && c.getTime() > after.getTime()) return c;
    c = new Date(c.getTime() + day);
  }
  return c;
}

/** The run after `run` (the schedule's own rhythm). */
export function nextRun(s: Schedule, run: Date) {
  if (s.frequency === "WEEKLY") return new Date(run.getTime() + 7 * day);
  if (s.frequency === "BIWEEKLY") return new Date(run.getTime() + 14 * day);
  return new Date(Date.UTC(run.getUTCFullYear(), run.getUTCMonth() + 1, s.dayOfMonth!, RUN_HOUR));
}

function requireBuyer(ctx: Ctx, place = false) {
  if ((ctx.company.type !== "CUSTOMER" && ctx.company.type !== "WHOLESALER") || ctx.company.status !== "APPROVED") throw new ForbiddenError();
  if (!can(ctx, place ? "buyer.orders.place" : ["buyer.orders.place", "buyer.orders.view"])) throw new ForbiddenError();
}

async function ownAddress(ctx: Ctx, id: string) {
  const { orderableAddressWhere } = await import("@/server/multisite/branches");
  const a = await prisma.address.findFirst({ where: { id, ...(await orderableAddressWhere(ctx)) }, include: { city: true } });
  if (!a) throw new ValidationError("Choose one of your delivery addresses.");
  return a;
}

function cleanItems(items: { offerId: string; qty: number }[]) {
  if (!items.length) throw new ValidationError("Add at least one product.");
  if (items.length > 100) throw new ValidationError("At most 100 products.");
  const map = new Map<string, number>();
  for (const i of items) {
    if (!Number.isInteger(i.qty) || i.qty <= 0) throw new ValidationError("Quantities must be whole numbers above 0.");
    map.set(i.offerId, (map.get(i.offerId) ?? 0) + i.qty);
  }
  return [...map].map(([offerId, qty]) => ({ offerId, qty }));
}

/** Estimated total and the buyer's approval rules for a schedule set up by someone without the approve permission. */
async function approvalFor(ctx: Ctx, items: { offerId: string; qty: number }[], addressId: string) {
  const { APPROVE, matchRules } = await import("./approvals");
  if (can(ctx, APPROVE)) return { reasons: [] as string[], gross: new Decimal(0) };
  const rules = await prisma.buyerApprovalRule.findMany({ where: { companyId: ctx.company.id, isActive: true } });
  if (!rules.length) return { reasons: [] as string[], gross: new Decimal(0) };
  const address = await ownAddress(ctx, addressId);
  const { priceCheckout } = await import("@/server/orders/pricing");
  const pc = await priceCheckout(ctx, { items, couponCode: null }, { regionId: address.city?.regionId ?? null, addressId });
  const reasons = matchRules(rules.map((r) => ({ id: r.id, name: r.name, minGross: r.minGross ? new Decimal(r.minGross.toString()) : null, categoryIds: r.categoryIds as string[] })), pc.grandTotal, pc.parts.flatMap((p) => p.lines.map((l) => l.item.categoryIds)));
  return { reasons, gross: pc.grandTotal };
}

export async function createRecurring(ctx: Ctx, i: Schedule & { name: string; items: { offerId: string; qty: number }[]; deliveryAddressId: string; notes?: string | null; remindDaysBefore?: number | null; poReference?: string | null }) {
  requireBuyer(ctx, true);
  const name = i.name.trim();
  if (!name) throw new ValidationError("Give it a name.");
  validate(i);
  const items = cleanItems(i.items);
  await ownAddress(ctx, i.deliveryAddressId);
  const { unavailable } = await pricedOffers(ctx, items);
  if (unavailable.length) throw new ValidationError("Some products are not available to you.");
  const remind = i.remindDaysBefore ?? 1;
  if (!Number.isInteger(remind) || remind < 0 || remind > 7) throw new ValidationError("Reminder: 0–7 days before.");
  const r = await prisma.recurringOrder.create({
    data: {
      buyerCompanyId: ctx.company.id, createdById: ctx.user.id, name, frequency: i.frequency, weekday: i.frequency === "MONTHLY" ? null : i.weekday, dayOfMonth: i.frequency === "MONTHLY" ? i.dayOfMonth : null,
      deliveryAddressId: i.deliveryAddressId, notes: i.notes?.trim() || null, remindDaysBefore: remind, nextRunAt: firstRun(i, new Date()), items: { create: items },
      poReference: i.poReference?.trim().slice(0, 60) || null,
    },
  });
  const ap = await approvalFor(ctx, items, i.deliveryAddressId);
  if (ap.reasons.length) {
    const { requestRecurringApproval } = await import("./approvals");
    await requestRecurringApproval(ctx, { id: r.id, deliveryAddressId: r.deliveryAddressId, items, notes: r.notes }, ap.gross, ap.reasons);
  }
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "recurring.created", entityType: "RecurringOrder", entityId: r.id, after: { name, frequency: i.frequency, items: items.length, approval: ap.reasons } });
  return { id: r.id, pendingApproval: ap.reasons.length > 0 };
}

async function own(ctx: Ctx, id: string) {
  const r = await prisma.recurringOrder.findFirst({ where: { id, buyerCompanyId: ctx.company.id }, include: { items: true } });
  if (!r) throw new NotFoundError("Recurring order");
  return r;
}

export async function updateRecurring(ctx: Ctx, id: string, i: Partial<Schedule> & { name?: string; items?: { offerId: string; qty: number }[]; deliveryAddressId?: string; notes?: string | null; remindDaysBefore?: number; poReference?: string | null }) {
  requireBuyer(ctx, true);
  const r = await own(ctx, id);
  if (r.status === "ENDED") throw new ValidationError("This recurring order has ended.");
  const s: Schedule = { frequency: i.frequency ?? r.frequency, weekday: i.weekday !== undefined ? i.weekday : r.weekday, dayOfMonth: i.dayOfMonth !== undefined ? i.dayOfMonth : r.dayOfMonth };
  validate(s);
  if (i.deliveryAddressId) await ownAddress(ctx, i.deliveryAddressId);
  const items = i.items ? cleanItems(i.items) : null;
  if (items) {
    const { unavailable } = await pricedOffers(ctx, items);
    if (unavailable.length) throw new ValidationError("Some products are not available to you.");
  }
  const scheduleChanged = s.frequency !== r.frequency || s.weekday !== r.weekday || s.dayOfMonth !== r.dayOfMonth;
  await prisma.$transaction(async (tx) => {
    await tx.recurringOrder.update({
      where: { id }, data: {
        ...(i.name?.trim() ? { name: i.name.trim() } : {}), frequency: s.frequency, weekday: s.frequency === "MONTHLY" ? null : s.weekday, dayOfMonth: s.frequency === "MONTHLY" ? s.dayOfMonth : null,
        ...(i.deliveryAddressId ? { deliveryAddressId: i.deliveryAddressId } : {}), ...(i.notes !== undefined ? { notes: i.notes?.trim() || null } : {}),
        ...(i.remindDaysBefore !== undefined ? { remindDaysBefore: Math.max(0, Math.min(7, i.remindDaysBefore)) } : {}),
        ...(i.poReference !== undefined ? { poReference: i.poReference?.trim().slice(0, 60) || null } : {}),
        ...(scheduleChanged ? { nextRunAt: firstRun(s, new Date()), reminderSentFor: null } : {}),
      },
    });
    if (items) {
      await tx.recurringOrderItem.deleteMany({ where: { recurringId: id } });
      await tx.recurringOrderItem.createMany({ data: items.map((x) => ({ ...x, recurringId: id })) });
    }
  });
  // bigger or different goods by someone who needs approval → approved again
  if (items && r.status === "ACTIVE") {
    const ap = await approvalFor(ctx, items, i.deliveryAddressId ?? r.deliveryAddressId);
    if (ap.reasons.length) {
      const { requestRecurringApproval } = await import("./approvals");
      await requestRecurringApproval(ctx, { id, deliveryAddressId: i.deliveryAddressId ?? r.deliveryAddressId, items, notes: r.notes }, ap.gross, ap.reasons);
    }
  }
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "recurring.updated", entityType: "RecurringOrder", entityId: id, after: { ...i, items: items?.length } });
}

export async function setRecurringState(ctx: Ctx, id: string, action: "PAUSE" | "RESUME" | "END" | "SKIP_NEXT" | "UNSKIP") {
  requireBuyer(ctx, true);
  const r = await own(ctx, id);
  if (r.status === "ENDED") throw new ValidationError("This recurring order has ended.");
  if (r.status === "PENDING_APPROVAL" && action !== "END") throw new ValidationError("Waiting for your manager's approval.");
  const data =
    action === "PAUSE" ? { status: "PAUSED" as const }
    : action === "RESUME" ? { status: "ACTIVE" as const, nextRunAt: r.nextRunAt.getTime() > Date.now() ? r.nextRunAt : firstRun(r, new Date()), reminderSentFor: null }
    : action === "END" ? { status: "ENDED" as const }
    : { skipNext: action === "SKIP_NEXT" };
  await prisma.recurringOrder.update({ where: { id }, data });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: `recurring.${action.toLowerCase()}`, entityType: "RecurringOrder", entityId: id });
}

export async function listRecurring(ctx: Ctx) {
  requireBuyer(ctx);
  const rows = await prisma.recurringOrder.findMany({ where: { buyerCompanyId: ctx.company.id }, include: { items: true }, orderBy: [{ status: "asc" }, { nextRunAt: "asc" }] });
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.createdById))] } }, select: { id: true, name: true } });
  return rows.map((r) => ({
    id: r.id, name: r.name, status: r.status, frequency: r.frequency, weekday: r.weekday, dayOfMonth: r.dayOfMonth, nextRunAt: r.nextRunAt, skipNext: r.skipNext, items: r.items.length,
    units: r.items.reduce((a, x) => a + x.qty, 0), lastRunAt: r.lastRunAt, lastResult: r.lastResult, lastError: r.lastError, runs: r.runs, createdBy: users.find((u) => u.id === r.createdById)?.name ?? null,
  }));
}

export async function getRecurring(ctx: Ctx, id: string, locale: string) {
  requireBuyer(ctx);
  const r = await own(ctx, id);
  const { items: priced } = await pricedOffers(ctx, r.items.map((x) => ({ offerId: x.offerId, qty: x.qty })));
  const offers = await prisma.vendorOffer.findMany({ where: { id: { in: r.items.map((x) => x.offerId) } }, select: { id: true, vendorSku: true, vendor: { select: { legalName: true, tradeName: true } }, packaging: { select: { name: true, variant: { select: { product: { select: { name: true } } } } } } } });
  const creator = await prisma.user.findUnique({ where: { id: r.createdById }, select: { name: true } });
  return {
    ...r, lastOrders: r.lastOrders as { id: string; number: string }[], createdBy: creator?.name ?? null,
    lines: r.items.map((x) => {
      const o = offers.find((y) => y.id === x.offerId);
      const p = priced.find((y) => y.offerId === x.offerId);
      return {
        offerId: x.offerId, qty: x.qty, sku: o?.vendorSku ?? null, product: o ? pickLocalized(o.packaging.variant.product.name, locale) : "", packaging: o ? pickLocalized(o.packaging.name, locale) : "",
        supplier: o ? o.vendor.tradeName ?? o.vendor.legalName : "", unitNet: p?.price?.unitPriceNet ?? null, available: p ? p.available : 0, ok: !!p?.price && (p?.available ?? 0) >= x.qty,
      };
    }),
  };
}

/** Place it now (outside the schedule; the next date stays). */
export async function orderRecurringNow(ctx: Ctx, id: string) {
  requireBuyer(ctx, true);
  const r = await own(ctx, id);
  if (r.status !== "ACTIVE" && r.status !== "PAUSED") throw new ValidationError("This recurring order can't be placed now.");
  const { placeOrder } = await import("@/server/services/orders");
  const placed = await placeOrder(ctx, { deliveryAddressId: r.deliveryAddressId, notes: [r.name, r.notes].filter(Boolean).join(" — "), items: r.items.map((x) => ({ offerId: x.offerId, qty: x.qty })), source: { type: "RECURRING", id }, poReference: r.poReference });
  if (!placed.approval) await prisma.recurringOrder.update({ where: { id }, data: { lastRunAt: new Date(), lastResult: "PLACED", lastError: null, lastOrders: placed.orders, runs: { increment: 1 } } });
  return placed;
}

/** The job (every 15 minutes): reminders, then the orders that are due. */
export async function runRecurringOrders(now = new Date()) {
  const out = { reminders: 0, placed: 0, skipped: 0, failed: 0 };
  // 1. reminders (with a stock check)
  const soon = await prisma.recurringOrder.findMany({ where: { status: "ACTIVE", nextRunAt: { gt: now, lte: new Date(now.getTime() + 7 * day) } }, include: { items: true } });
  for (const r of soon) {
    if (r.remindDaysBefore === 0 || r.skipNext) continue;
    if (r.reminderSentFor && r.reminderSentFor.getTime() === r.nextRunAt.getTime()) continue;
    if (r.nextRunAt.getTime() - r.remindDaysBefore * day > now.getTime()) continue;
    const ctx = await loadContext(r.createdById, "recurring", r.buyerCompanyId).catch(() => null);
    let problems = 0;
    if (ctx) {
      const { items, unavailable } = await pricedOffers(ctx, r.items.map((x) => ({ offerId: x.offerId, qty: x.qty })));
      problems = unavailable.length + items.filter((i) => !i.price || i.available < i.qty).length;
    }
    await notify("recurring.reminder", [{ userId: r.createdById, link: `/buy/orders/recurring/${r.id}` }], { name: r.name, date: r.nextRunAt.toISOString().slice(0, 10), problems }, { ref: { type: "RecurringOrder", id: r.id } }).catch(() => null);
    await prisma.recurringOrder.update({ where: { id: r.id }, data: { reminderSentFor: r.nextRunAt } });
    out.reminders++;
  }
  // 2. due orders
  const due = await prisma.recurringOrder.findMany({ where: { status: "ACTIVE", nextRunAt: { lte: now } }, include: { items: true }, take: 200 });
  for (const r of due) {
    // claim it first: two jobs never place the same run
    const next = nextRun(r, r.nextRunAt.getTime() < now.getTime() - 30 * day ? firstRun(r, now) : r.nextRunAt);
    const claimed = await prisma.recurringOrder.updateMany({ where: { id: r.id, nextRunAt: r.nextRunAt, status: "ACTIVE" }, data: { nextRunAt: next.getTime() > now.getTime() ? next : firstRun(r, now), reminderSentFor: null } });
    if (!claimed.count) continue;
    if (r.skipNext) {
      await prisma.recurringOrder.update({ where: { id: r.id }, data: { skipNext: false, lastRunAt: now, lastResult: "SKIPPED", lastError: null } });
      out.skipped++;
      continue;
    }
    const ctx = await loadContext(r.createdById, "recurring", r.buyerCompanyId).catch(() => null);
    try {
      if (!ctx || ctx.company.id !== r.buyerCompanyId || !can(ctx, "buyer.orders.place")) {
        await prisma.recurringOrder.update({ where: { id: r.id }, data: { status: "PAUSED" } });
        throw new AppError("NO_PERSON", "The person who set it up can no longer order for the company — it was paused.", 409);
      }
      const { placeOrder } = await import("@/server/services/orders");
      const placed = await placeOrder(ctx, { deliveryAddressId: r.deliveryAddressId, notes: [r.name, r.notes].filter(Boolean).join(" — "), items: r.items.map((x) => ({ offerId: x.offerId, qty: x.qty })), approved: true, source: { type: "RECURRING", id: r.id }, poReference: r.poReference });
      await prisma.recurringOrder.update({ where: { id: r.id }, data: { lastRunAt: now, lastResult: "PLACED", lastError: null, lastOrders: placed.orders, runs: { increment: 1 } } });
      await notify("recurring.placed", [{ userId: r.createdById, link: `/buy/orders/${placed.orders[0]?.id ?? ""}` }], { name: r.name, orders: placed.orders.map((o) => o.number).join(", ") }, { ref: { type: "RecurringOrder", id: r.id } }).catch(() => null);
      out.placed++;
    } catch (e) {
      const msg = e instanceof AppError ? e.message : "Something went wrong.";
      if (!(e instanceof AppError)) console.error(e);
      await prisma.recurringOrder.update({ where: { id: r.id }, data: { lastRunAt: now, lastResult: "FAILED", lastError: msg.slice(0, 300), runs: { increment: 1 } } });
      await notify("recurring.failed", [{ userId: r.createdById, link: `/buy/orders/recurring/${r.id}` }], { name: r.name, reason: msg }, { ref: { type: "RecurringOrder", id: r.id } }).catch(() => null);
      out.failed++;
    }
  }
  return out;
}

/** FIRINGI: every recurring order (English back office). */
export async function adminRecurring(ctx: Ctx) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, ["admin.orders.view", "admin.orders.manage"])) throw new ForbiddenError();
  const rows = await prisma.recurringOrder.findMany({ include: { buyer: { select: { legalName: true, tradeName: true } }, items: true }, orderBy: [{ status: "asc" }, { nextRunAt: "asc" }], take: 500 });
  return rows.map((r) => ({ id: r.id, name: r.name, buyer: r.buyer.tradeName ?? r.buyer.legalName, status: r.status, frequency: r.frequency, weekday: r.weekday, dayOfMonth: r.dayOfMonth, nextRunAt: r.nextRunAt, items: r.items.length, runs: r.runs, lastResult: r.lastResult, lastError: r.lastError, lastRunAt: r.lastRunAt }));
}
