"use server";
/** B2B buying (Phase 26): quotes, the buyer's approvals, recurring orders, order lists. */
import { z } from "zod";
import { defineAction } from "./_action";
import { acceptQuote, answerQuote, declineQuote, rejectQuote, requestQuotes } from "@/server/buying/quotes";
import { cancelApproval, decideApproval, deleteRule, saveRule } from "@/server/buying/approvals";
import { createRecurring, orderRecurringNow, setRecurringState, updateRecurring } from "@/server/buying/recurring";
import { createList, deleteList, listToCart, setListItem, updateList } from "@/server/buying/lists";

const id = z.string().min(1).max(40);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const date = (s?: string | null) => (s ? new Date(`${s}T00:00:00Z`) : null);
const qty = z.number().int().min(1).max(1_000_000);
const items = z.array(z.object({ offerId: id, qty })).min(1).max(200);
const BUY = "buyer.orders.place" as const;
const SEE = ["buyer.orders.place", "buyer.orders.view"] as const;
const SELL = ["vendor.pricing.manage", "vendor.orders.manage"] as const;

// ── quotes ──
export const requestQuoteAction = defineAction({
  permission: BUY, schema: z.object({ note: z.string().max(1000).nullable().optional(), neededBy: isoDate.nullable().optional() }),
  handler: async (ctx, i) => requestQuotes(ctx, { note: i.note, neededBy: date(i.neededBy) }),
});
export const acceptQuoteAction = defineAction({
  permission: BUY, schema: z.object({ id, deliveryAddressId: id, notes: z.string().max(500).nullable().optional(), requestedDeliveryDate: isoDate.nullable().optional() }),
  handler: async (ctx, i) => acceptQuote(ctx, i.id, { deliveryAddressId: i.deliveryAddressId, notes: i.notes, requestedDeliveryDate: date(i.requestedDeliveryDate) }),
});
export const rejectQuoteAction = defineAction({
  permission: [...SEE], schema: z.object({ id, reason: z.string().max(500).nullable().optional() }),
  handler: async (ctx, i) => { await rejectQuote(ctx, i.id, i.reason); return true; },
});
export const answerQuoteAction = defineAction({
  permission: [...SELL], schema: z.object({ id, validUntil: isoDate, note: z.string().max(1000).nullable().optional(), lines: z.array(z.object({ lineId: id, unitNet: z.number().positive().max(1_000_000) })).min(1).max(100) }),
  handler: async (ctx, i) => { await answerQuote(ctx, i.id, { lines: i.lines, validUntil: date(i.validUntil)!, note: i.note }); return true; },
});
export const declineQuoteAction = defineAction({
  permission: [...SELL], schema: z.object({ id, reason: z.string().min(1).max(500) }),
  handler: async (ctx, i) => { await declineQuote(ctx, i.id, i.reason); return true; },
});

// ── approvals ──
export const decideApprovalAction = defineAction({
  permission: "buyer.orders.approve", schema: z.object({ id, approve: z.boolean(), note: z.string().max(500).nullable().optional() }),
  handler: async (ctx, i) => decideApproval(ctx, i.id, i.approve, i.note),
});
export const cancelApprovalAction = defineAction({
  permission: [...SEE], schema: z.object({ id }),
  handler: async (ctx, i) => { await cancelApproval(ctx, i.id); return true; },
});
export const saveApprovalRuleAction = defineAction({
  permission: "buyer.orders.approve", schema: z.object({ id: id.nullable().optional(), name: z.string().min(1).max(80), minGross: z.number().min(0).max(10_000_000).nullable().optional(), categoryIds: z.array(id).max(50).optional(), isActive: z.boolean().optional() }),
  handler: async (ctx, i) => saveRule(ctx, i),
});
export const deleteApprovalRuleAction = defineAction({
  permission: "buyer.orders.approve", schema: z.object({ id }),
  handler: async (ctx, i) => { await deleteRule(ctx, i.id); return true; },
});

// ── recurring orders ──
const schedule = { frequency: z.enum(["WEEKLY", "BIWEEKLY", "MONTHLY"]), weekday: z.number().int().min(1).max(7).nullable().optional(), dayOfMonth: z.number().int().min(1).max(28).nullable().optional() };
export const createRecurringAction = defineAction({
  permission: BUY,
  schema: z.object({ name: z.string().min(1).max(80), ...schedule, deliveryAddressId: id, notes: z.string().max(500).nullable().optional(), remindDaysBefore: z.number().int().min(0).max(7).optional(), listId: id.nullable().optional(), items: items.optional() }),
  handler: async (ctx, i) => {
    let lines = i.items;
    if (!lines && i.listId) {
      const { getList } = await import("@/server/buying/lists");
      lines = (await getList(ctx, i.listId, "en")).lines.map((l) => ({ offerId: l.offerId, qty: l.qty }));
    }
    if (!lines) {
      const { prisma } = await import("@/server/db");
      const cart = await prisma.cart.findUnique({ where: { buyerCompanyId_userId: { buyerCompanyId: ctx.company.id, userId: ctx.user.id } }, include: { items: true } });
      lines = (cart?.items ?? []).map((x) => ({ offerId: x.offerId, qty: x.qty }));
    }
    return createRecurring(ctx, { ...i, items: lines });
  },
});
export const updateRecurringAction = defineAction({
  permission: BUY,
  schema: z.object({ id, name: z.string().min(1).max(80).optional(), frequency: schedule.frequency.optional(), weekday: schedule.weekday, dayOfMonth: schedule.dayOfMonth, deliveryAddressId: id.optional(), notes: z.string().max(500).nullable().optional(), remindDaysBefore: z.number().int().min(0).max(7).optional(), items: items.optional() }),
  handler: async (ctx, i) => { const { id: rid, ...rest } = i; await updateRecurring(ctx, rid, rest); return true; },
});
export const recurringStateAction = defineAction({
  permission: BUY, schema: z.object({ id, action: z.enum(["PAUSE", "RESUME", "END", "SKIP_NEXT", "UNSKIP"]) }),
  handler: async (ctx, i) => { await setRecurringState(ctx, i.id, i.action); return true; },
});
export const orderRecurringNowAction = defineAction({
  permission: BUY, schema: z.object({ id }),
  handler: async (ctx, i) => orderRecurringNow(ctx, i.id),
});

// ── order lists ──
export const createListAction = defineAction({
  permission: [...SEE], schema: z.object({ name: z.string().min(1).max(80), shared: z.boolean().optional(), from: z.enum(["CART", "ORDER"]).nullable().optional(), orderId: id.nullable().optional(), items: items.optional() }),
  handler: async (ctx, i) => createList(ctx, i),
});
export const updateListAction = defineAction({
  permission: [...SEE], schema: z.object({ id, name: z.string().min(1).max(80).optional(), shared: z.boolean().optional() }),
  handler: async (ctx, i) => { await updateList(ctx, i.id, i); return true; },
});
export const setListItemAction = defineAction({
  permission: [...SEE], schema: z.object({ id, offerId: id, qty: z.number().int().min(0).max(1_000_000) }),
  handler: async (ctx, i) => { await setListItem(ctx, i.id, i.offerId, i.qty); return true; },
});
export const deleteListAction = defineAction({
  permission: [...SEE], schema: z.object({ id }),
  handler: async (ctx, i) => { await deleteList(ctx, i.id); return true; },
});
export const listToCartAction = defineAction({
  permission: BUY, schema: z.object({ id }),
  handler: async (ctx, i) => listToCart(ctx, i.id),
});
