/**
 * The buyer's own approval rules (Phase 26). A customer / wholesaler sets rules — an order total
 * (incl. VAT) at or above an amount, or products from some categories — and orders by team
 * members who don't hold `buyer.orders.approve` that match a rule wait for a manager instead of
 * going to FIRINGI. The manager approves (the order is placed for the person who asked, at that
 * moment's prices — or the quote's prices) or rejects with a reason. Recurring orders are approved
 * once, when set up. Managers' own orders, API orders and purchase orders are not held.
 */
import Decimal from "decimal.js";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { loadContext } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";
import { notify } from "@/server/notify/dispatch";
import type { PricedCheckout } from "@/server/orders/pricing";
import type { PlaceOrderInput } from "@/server/services/orders";

export const APPROVE = "buyer.orders.approve" as const;
const isBuyer = (ctx: Ctx) => (ctx.company.type === "CUSTOMER" || ctx.company.type === "WHOLESALER") && ctx.company.status === "APPROVED";
function requireBuyer(ctx: Ctx) {
  if (!isBuyer(ctx) || !can(ctx, ["buyer.orders.place", "buyer.orders.view", APPROVE])) throw new ForbiddenError();
}
function requireApprover(ctx: Ctx) {
  if (!isBuyer(ctx) || !can(ctx, APPROVE)) throw new ForbiddenError();
}

type Rule = { id: string; name: string; minGross: Decimal | null; categoryIds: string[] };
async function activeRules(companyId: string): Promise<Rule[]> {
  const rows = await prisma.buyerApprovalRule.findMany({ where: { companyId, isActive: true } });
  return rows.map((r) => ({ id: r.id, name: r.name, minGross: r.minGross ? new Decimal(r.minGross.toString()) : null, categoryIds: (r.categoryIds as string[]) ?? [] }));
}

/** Which rules a checkout matches (empty = no approval needed). Pure on the inputs. */
export function matchRules(rules: Rule[], gross: Decimal.Value, lineCategoryIds: string[][]) {
  const g = new Decimal(gross);
  return rules
    .filter((r) => (r.minGross && g.gte(r.minGross)) || (r.categoryIds.length > 0 && lineCategoryIds.some((ids) => ids.some((c) => r.categoryIds.includes(c)))))
    .map((r) => r.name);
}

/** Called by placeOrder for people without the approve permission. */
export async function approvalNeeded(ctx: Ctx, pc: PricedCheckout) {
  if (can(ctx, APPROVE)) return [];
  const rules = await activeRules(ctx.company.id);
  if (!rules.length) return [];
  return matchRules(rules, pc.grandTotal, pc.parts.flatMap((p) => p.lines.map((l) => l.item.categoryIds)));
}

export type PlacedOrPending = { id: string; number: string; orders: { id: string; number: string }[]; approval?: { id: string }; payFirst?: boolean };

/** Instead of placing: the checkout waits for a manager. The cart's items move into the request. */
export async function requestApproval(ctx: Ctx, i: { input: PlaceOrderInput; cart: { id: string; couponCode: string | null; items: { offerId: string; qty: number }[] }; gross: Decimal; reasons: string[] }): Promise<PlacedOrPending> {
  const a = await prisma.$transaction(async (tx) => {
    const row = await tx.buyerApproval.create({
      data: {
        companyId: ctx.company.id, requestedById: ctx.user.id, kind: "ORDER", items: i.cart.items.map((x) => ({ offerId: x.offerId, qty: x.qty })),
        couponCode: i.cart.couponCode, deliveryAddressId: i.input.deliveryAddressId, notes: i.input.notes?.trim() || null, requestedDeliveryDate: i.input.requestedDeliveryDate ?? null,
        grossTotal: i.gross.toFixed(2), reasons: i.reasons, quoteId: i.input.source?.type === "QUOTE" ? i.input.source.id : null,
      },
    });
    if (!i.input.items && i.cart.id) {
      await tx.cartItem.deleteMany({ where: { cartId: i.cart.id } });
      await tx.cart.update({ where: { id: i.cart.id }, data: { couponCode: null } });
    }
    return row;
  });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "buyer_approval.requested", entityType: "BuyerApproval", entityId: a.id, after: { gross: i.gross.toFixed(2), reasons: i.reasons } });
  await notify("buyer_approval.pending", [{ companyId: ctx.company.id, link: `/buy/orders/approvals/${a.id}` }], { requester: ctx.user.name, total: i.gross.toNumber() }, { ref: { type: "BuyerApproval", id: a.id } }).catch(() => null);
  return { id: "", number: "", orders: [], approval: { id: a.id } };
}

/** A recurring order set up by someone without the approve permission, matching a rule. */
export async function requestRecurringApproval(ctx: Ctx, r: { id: string; deliveryAddressId: string; items: { offerId: string; qty: number }[]; notes: string | null }, gross: Decimal, reasons: string[]) {
  const a = await prisma.buyerApproval.create({
    data: { companyId: ctx.company.id, requestedById: ctx.user.id, kind: "RECURRING", recurringId: r.id, items: r.items, deliveryAddressId: r.deliveryAddressId, notes: r.notes, grossTotal: gross.toFixed(2), reasons },
  });
  await prisma.recurringOrder.update({ where: { id: r.id }, data: { status: "PENDING_APPROVAL", approvalId: a.id } });
  await notify("buyer_approval.pending", [{ companyId: ctx.company.id, link: `/buy/orders/approvals/${a.id}` }], { requester: ctx.user.name, total: gross.toNumber() }, { ref: { type: "BuyerApproval", id: a.id } }).catch(() => null);
  return a.id;
}

export async function listApprovals(ctx: Ctx) {
  requireBuyer(ctx);
  const mine = !can(ctx, APPROVE);
  const rows = await prisma.buyerApproval.findMany({ where: { companyId: ctx.company.id, ...(mine ? { requestedById: ctx.user.id } : {}) }, orderBy: { createdAt: "desc" }, take: 200 });
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.flatMap((r) => [r.requestedById, r.decidedById].filter((x): x is string => !!x)))] } }, select: { id: true, name: true } });
  const name = (id: string | null) => users.find((u) => u.id === id)?.name ?? null;
  return rows.map((r) => ({
    id: r.id, kind: r.kind, status: r.status, createdAt: r.createdAt, grossTotal: r.grossTotal.toString(), reasons: r.reasons as string[], requestedBy: name(r.requestedById), mineRequest: r.requestedById === ctx.user.id,
    lines: (r.items as { offerId: string; qty: number }[]).length, decidedBy: name(r.decidedById), decidedAt: r.decidedAt, decisionNote: r.decisionNote, orders: r.orders as { id: string; number: string }[], recurringId: r.recurringId, quoteId: r.quoteId,
  }));
}

export async function getApproval(ctx: Ctx, id: string, locale: string) {
  requireBuyer(ctx);
  const r = await prisma.buyerApproval.findFirst({ where: { id, companyId: ctx.company.id, ...(can(ctx, APPROVE) ? {} : { requestedById: ctx.user.id }) } });
  if (!r) throw new NotFoundError("Approval");
  const items = r.items as { offerId: string; qty: number }[];
  const offers = await prisma.vendorOffer.findMany({ where: { id: { in: items.map((x) => x.offerId) } }, select: { id: true, vendorSku: true, vendor: { select: { legalName: true, tradeName: true } }, packaging: { select: { name: true, variant: { select: { product: { select: { name: true } } } } } } } });
  const { pickLocalized } = await import("@/i18n/config");
  const [address, users] = await Promise.all([
    prisma.address.findUnique({ where: { id: r.deliveryAddressId }, select: { label: true, line1: true, cityName: true } }),
    prisma.user.findMany({ where: { id: { in: [r.requestedById, r.decidedById].filter((x): x is string => !!x) } }, select: { id: true, name: true } }),
  ]);
  return {
    ...r, grossTotal: r.grossTotal.toString(), reasons: r.reasons as string[], orders: r.orders as { id: string; number: string }[], address,
    requestedBy: users.find((u) => u.id === r.requestedById)?.name ?? null, decidedBy: users.find((u) => u.id === r.decidedById)?.name ?? null,
    canDecide: r.status === "PENDING" && can(ctx, APPROVE), canCancel: r.status === "PENDING" && r.requestedById === ctx.user.id,
    lines: items.map((x) => {
      const o = offers.find((y) => y.id === x.offerId);
      return { offerId: x.offerId, qty: x.qty, sku: o?.vendorSku ?? null, product: o ? pickLocalized(o.packaging.variant.product.name, locale) : "", packaging: o ? pickLocalized(o.packaging.name, locale) : "", supplier: o ? o.vendor.tradeName ?? o.vendor.legalName : "" };
    }),
  };
}

/** Approve (the order is placed now, for the person who asked) or reject with a reason. */
export async function decideApproval(ctx: Ctx, id: string, approve: boolean, note?: string | null) {
  requireApprover(ctx);
  const r = await prisma.buyerApproval.findFirst({ where: { id, companyId: ctx.company.id } });
  if (!r) throw new NotFoundError("Approval");
  if (r.status !== "PENDING") throw new ValidationError("This request was already decided.");
  if (!approve && !note?.trim()) throw new ValidationError("Please give a reason.");
  let orders: { id: string; number: string }[] = [];
  if (approve) {
    if (r.kind === "RECURRING" && r.recurringId) {
      await prisma.recurringOrder.update({ where: { id: r.recurringId }, data: { status: "ACTIVE" } });
    } else {
      // placed for the requester (their name on the order); if they left the team, for the manager
      const reqCtx = (await loadContext(r.requestedById, "buyer-approval", ctx.company.id).catch(() => null)) ?? ctx;
      const actor = can(reqCtx, "buyer.orders.place") ? reqCtx : ctx;
      const items = r.items as { offerId: string; qty: number }[];
      if (r.quoteId) {
        const { acceptQuoteApproved } = await import("./quotes");
        orders = await acceptQuoteApproved(actor, r.quoteId, { deliveryAddressId: r.deliveryAddressId, notes: r.notes, requestedDeliveryDate: r.requestedDeliveryDate });
      } else {
        const { placeOrder } = await import("@/server/services/orders");
        const placed = await placeOrder(actor, { deliveryAddressId: r.deliveryAddressId, notes: r.notes, requestedDeliveryDate: r.requestedDeliveryDate, items, couponCode: r.couponCode, approved: true, source: { type: "APPROVAL", id: r.id } });
        orders = placed.orders;
      }
    }
  } else if (r.kind === "RECURRING" && r.recurringId) {
    await prisma.recurringOrder.update({ where: { id: r.recurringId }, data: { status: "PAUSED" } });
  }
  await prisma.buyerApproval.update({ where: { id }, data: { status: approve ? "APPROVED" : "REJECTED", decidedById: ctx.user.id, decidedAt: new Date(), decisionNote: note?.trim() || null, orders } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: approve ? "buyer_approval.approved" : "buyer_approval.rejected", entityType: "BuyerApproval", entityId: id, after: { note, orders } });
  const link = orders[0] ? `/buy/orders/${orders[0].id}` : `/buy/orders/approvals/${id}`;
  if (approve) await notify("buyer_approval.approved", [{ userId: r.requestedById, link }], { orders: orders.map((o) => o.number).join(", ") }, { ref: { type: "BuyerApproval", id } }).catch(() => null);
  else await notify("buyer_approval.rejected", [{ userId: r.requestedById, link }], { reason: note?.trim() ?? "" }, { ref: { type: "BuyerApproval", id } }).catch(() => null);
  return { orders };
}

/** The requester withdraws: the items go back into their cart (orders only). */
export async function cancelApproval(ctx: Ctx, id: string) {
  requireBuyer(ctx);
  const r = await prisma.buyerApproval.findFirst({ where: { id, companyId: ctx.company.id, requestedById: ctx.user.id } });
  if (!r) throw new NotFoundError("Approval");
  if (r.status !== "PENDING") throw new ValidationError("This request was already decided.");
  await prisma.buyerApproval.update({ where: { id }, data: { status: "CANCELLED", decidedAt: new Date(), decidedById: ctx.user.id } });
  if (r.kind === "ORDER" && !r.quoteId) {
    const { addToCart } = await import("@/server/services/cart");
    for (const x of r.items as { offerId: string; qty: number }[]) await addToCart(ctx, x.offerId, x.qty).catch(() => null);
  }
  if (r.kind === "RECURRING" && r.recurringId) await prisma.recurringOrder.update({ where: { id: r.recurringId }, data: { status: "PAUSED" } });
}

export async function pendingApprovalCount(ctx: Ctx) {
  if (!isBuyer(ctx) || !can(ctx, APPROVE)) return 0;
  return prisma.buyerApproval.count({ where: { companyId: ctx.company.id, status: "PENDING" } });
}

// ───────────────────────────── rules ─────────────────────────────

export async function listRules(ctx: Ctx, locale: string) {
  requireBuyer(ctx);
  const rows = await prisma.buyerApprovalRule.findMany({ where: { companyId: ctx.company.id }, orderBy: { createdAt: "asc" } });
  const cats = await prisma.category.findMany({ where: { id: { in: rows.flatMap((r) => r.categoryIds as string[]) } }, select: { id: true, name: true } });
  const { pickLocalized } = await import("@/i18n/config");
  return rows.map((r) => ({ id: r.id, name: r.name, minGross: r.minGross?.toString() ?? null, isActive: r.isActive, categories: (r.categoryIds as string[]).map((id) => ({ id, name: pickLocalized(cats.find((c) => c.id === id)?.name, locale) })) }));
}

export async function saveRule(ctx: Ctx, i: { id?: string | null; name: string; minGross?: number | null; categoryIds?: string[]; isActive?: boolean }) {
  requireApprover(ctx);
  const name = i.name.trim();
  if (!name) throw new ValidationError("Give the rule a name.");
  const categoryIds = [...new Set(i.categoryIds ?? [])];
  if ((i.minGross == null || i.minGross <= 0) && !categoryIds.length) throw new ValidationError("Set an amount, categories, or both.");
  if (categoryIds.length && (await prisma.category.count({ where: { id: { in: categoryIds } } })) !== categoryIds.length) throw new ValidationError("Unknown category.");
  const data = { name, minGross: i.minGross && i.minGross > 0 ? new Decimal(i.minGross).toFixed(2) : null, categoryIds, isActive: i.isActive ?? true };
  const row = i.id
    ? await prisma.buyerApprovalRule.update({ where: { id: (await prisma.buyerApprovalRule.findFirstOrThrow({ where: { id: i.id, companyId: ctx.company.id } })).id }, data })
    : await prisma.buyerApprovalRule.create({ data: { ...data, companyId: ctx.company.id, createdById: ctx.user.id } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "buyer_approval.rule_saved", entityType: "BuyerApprovalRule", entityId: row.id, after: data });
  return row.id;
}

export async function deleteRule(ctx: Ctx, id: string) {
  requireApprover(ctx);
  const n = await prisma.buyerApprovalRule.deleteMany({ where: { id, companyId: ctx.company.id } });
  if (!n.count) throw new NotFoundError("Rule");
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "buyer_approval.rule_deleted", entityType: "BuyerApprovalRule", entityId: id });
}

/** Top-level categories (and one level below) for the rule form. */
export async function ruleCategoryOptions(locale: string) {
  const { pickLocalized } = await import("@/i18n/config");
  const cats = await prisma.category.findMany({ where: { isActive: true }, select: { id: true, name: true, path: true }, orderBy: { path: "asc" } });
  return cats.filter((c) => c.path.split("/").filter(Boolean).length <= 2).map((c) => ({ id: c.id, label: `${c.path.split("/").filter(Boolean).length === 2 ? "— " : ""}${pickLocalized(c.name, locale)}` }));
}
