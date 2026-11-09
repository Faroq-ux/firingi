/**
 * Returns after delivery.
 *
 *   buyer requests (lines, quantities, reason, photos) → FIRINGI approves / rejects
 *   → the goods are collected and the supplier (or FIRINGI) confirms receipt
 *   → FIRINGI's credit note to the buyer + a credit statement for the vendor, stock back
 *     on hand (unless damaged), order RETURNED when everything delivered came back.
 * FIRINGI is merchant of record, so FIRINGI decides on returns.
 */
import type { Prisma, ReturnStatus } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { creditInvoice } from "@/server/invoicing/service";
import { applyOrderTransition, notifyOrderChange, restockShipped } from "./orders";
import { storeUpload } from "./storage";
import { writeAudit } from "./audit";
import { notifyCompany } from "./notify";

export const RETURN_WINDOW_DAYS = 30;
const OPEN: ReturnStatus[] = ["REQUESTED", "APPROVED", "RECEIVED", "CREDITED"]; // counts against what can still be returned

const returnInclude = {
  order: { select: { id: true, number: true, status: true, buyerCompanyId: true, sellerCompanyId: true, buyer: { select: { legalName: true, tradeName: true } }, seller: { select: { legalName: true, tradeName: true } } } },
  lines: { include: { orderLine: { select: { id: true, sku: true, productName: true, packagingName: true, qtyDelivered: true, unitListPriceNet: true } } } },
} satisfies Prisma.ReturnRequestInclude;

/** How many of each delivered line can still be returned. */
export async function returnableLines(orderId: string) {
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { lines: true, returns: { where: { status: { in: OPEN } }, include: { lines: true } }, delivery: { select: { completedAt: true } }, statusHistory: { where: { toStatus: "DELIVERED" }, orderBy: { at: "desc" }, take: 1 } },
  });
  const taken = new Map<string, number>();
  for (const r of order.returns) for (const l of r.lines) taken.set(l.orderLineId, (taken.get(l.orderLineId) ?? 0) + l.qty);
  const deliveredAt = order.delivery?.completedAt ?? order.statusHistory[0]?.at ?? null;
  const open = order.status === "DELIVERED" && !!deliveredAt && Date.now() - deliveredAt.getTime() <= RETURN_WINDOW_DAYS * 86400_000;
  return {
    open, deliveredAt,
    lines: order.lines.map((l) => ({ id: l.id, sku: l.sku, productName: l.productName, packagingName: l.packagingName, delivered: l.qtyDelivered ?? 0, returnable: Math.max(0, (l.qtyDelivered ?? 0) - (taken.get(l.id) ?? 0)) })),
  };
}

export async function requestReturn(ctx: Ctx, orderId: string, input: { lines: { orderLineId: string; qty: number }[]; reason: string; photos?: File[] }) {
  const order = await prisma.order.findFirst({ where: { id: orderId, buyerCompanyId: ctx.company.id } });
  if (!order || !can(ctx, "buyer.orders.view")) throw new NotFoundError("Order");
  if (!can(ctx, "buyer.orders.place")) throw new ForbiddenError();
  const r = await returnableLines(orderId);
  if (!r.open) throw new AppError("RETURN_CLOSED", `Returns are possible for ${RETURN_WINDOW_DAYS} days after delivery.`, 409);
  const reason = input.reason.trim();
  if (reason.length < 5) throw new ValidationError("Tell us why you are returning the goods.");
  const wanted = input.lines.filter((l) => l.qty > 0);
  if (!wanted.length) throw new ValidationError("Choose at least one product and quantity to return.");
  for (const w of wanted) {
    const l = r.lines.find((x) => x.id === w.orderLineId);
    if (!l || !Number.isInteger(w.qty) || w.qty > l.returnable) throw new ValidationError("You can't return more than was delivered.");
  }
  const photos = (input.photos ?? []).filter((f) => f && f.size > 0).slice(0, 4);
  const photoKeys: string[] = [];
  for (const p of photos) {
    const s = await storeUpload(p, "returns");
    if (!s.mimeType.startsWith("image/")) throw new ValidationError("Photos must be images (JPG, PNG or WEBP).");
    photoKeys.push(s.key);
  }
  const created = await prisma.$transaction(async (tx) => {
    const rr = await tx.returnRequest.create({ data: { orderId, reason, requestedById: ctx.user.id, photoKeys, lines: { create: wanted.map((w) => ({ orderLineId: w.orderLineId, qty: w.qty })) } } });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "return.requested", entityType: "ReturnRequest", entityId: rr.id, after: { orderId, lines: wanted, reason } }, tx);
    return rr;
  });
  const admin = await prisma.company.findFirst({ where: { type: "ADMIN" }, select: { id: true } });
  if (admin) await notifyCompany(admin.id, { type: "return.requested", title: `Return request — order ${order.number}`, body: reason, link: "/admin/delivery/returns" });
  await notifyCompany(order.sellerCompanyId, { type: "return.requested", title: `Return request — order ${order.number}`, body: reason, link: "/vendor/orders/returns" });
  return created;
}

export async function listReturns(ctx: Ctx, as: "BUYER" | "VENDOR" | "ADMIN", f: { statuses?: ReturnStatus[] } = {}) {
  const where: Prisma.ReturnRequestWhereInput = f.statuses?.length ? { status: { in: f.statuses } } : {};
  if (as === "BUYER") {
    if (!can(ctx, "buyer.orders.view")) throw new ForbiddenError();
    where.order = { buyerCompanyId: ctx.company.id };
  } else if (as === "VENDOR") {
    if (!can(ctx, ["vendor.orders.view", "vendor.orders.manage"])) throw new ForbiddenError();
    where.order = { sellerCompanyId: ctx.company.id };
  } else if (ctx.company.type !== "ADMIN" || !can(ctx, ["admin.orders.view", "admin.orders.manage", "admin.delivery.view"])) throw new ForbiddenError();
  return prisma.returnRequest.findMany({ where, include: returnInclude, orderBy: { createdAt: "desc" }, take: 200 });
}

async function loadReturn(ctx: Ctx, id: string) {
  const r = await prisma.returnRequest.findUnique({ where: { id }, include: returnInclude });
  if (!r) throw new NotFoundError("Return");
  const isAdmin = ctx.company.type === "ADMIN" && can(ctx, ["admin.orders.view", "admin.orders.manage", "admin.delivery.view"]);
  const isBuyer = r.order.buyerCompanyId === ctx.company.id && can(ctx, "buyer.orders.view");
  const isSeller = r.order.sellerCompanyId === ctx.company.id && can(ctx, ["vendor.orders.view", "vendor.orders.manage"]);
  if (!isAdmin && !isBuyer && !isSeller) throw new NotFoundError("Return");
  return { r, isAdmin, isSeller };
}

export async function returnPhotoKey(ctx: Ctx, id: string, n: number) {
  const { r } = await loadReturn(ctx, id);
  const key = r.photoKeys[n];
  if (!key) throw new NotFoundError("File");
  return key;
}

/** FIRINGI approves or rejects a return request. */
export async function reviewReturn(ctx: Ctx, id: string, decision: "APPROVED" | "REJECTED", note?: string | null) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, "admin.orders.manage")) throw new ForbiddenError();
  const { r } = await loadReturn(ctx, id);
  if (r.status !== "REQUESTED") throw new AppError("BAD_TRANSITION", "This return was already decided.", 409);
  if (decision === "REJECTED" && !note?.trim()) throw new ValidationError("Please give a reason.");
  await prisma.$transaction(async (tx) => {
    const res = await tx.returnRequest.updateMany({ where: { id, status: "REQUESTED" }, data: { status: decision, reviewedById: ctx.user.id, reviewNote: note?.trim() || null } });
    if (res.count !== 1) throw new AppError("CONFLICT", "This return was changed by someone else.", 409);
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: `return.${decision.toLowerCase()}`, entityType: "ReturnRequest", entityId: id, after: { note } }, tx);
  });
  const body = decision === "APPROVED" ? "Your return was approved. The goods will be collected." : `Your return was not approved: ${note}`;
  await notifyCompany(r.order.buyerCompanyId, { type: `return.${decision.toLowerCase()}`, title: `Return — order ${r.order.number}`, body, link: `/buy/orders/${r.order.id}` });
  if (decision === "APPROVED")
    await notifyCompany(r.order.sellerCompanyId, { type: "return.approved", title: `Return approved — order ${r.order.number}`, body: "Confirm receipt when the goods are back.", link: "/vendor/orders/returns" });
}

/**
 * Goods are back with the supplier: stock returns (unless `restock` is false — e.g. damaged),
 * FIRINGI credits the buyer, the vendor gets a credit statement. Supplier or FIRINGI confirms.
 */
export async function receiveReturn(ctx: Ctx, id: string, input: { restock: boolean }) {
  const { r, isAdmin, isSeller } = await loadReturn(ctx, id);
  if (!(isAdmin && can(ctx, "admin.orders.manage")) && !(isSeller && can(ctx, "vendor.orders.manage"))) throw new ForbiddenError();
  if (r.status !== "APPROVED") throw new AppError("BAD_TRANSITION", "Only an approved return can be received.", 409);
  const invoice = await prisma.invoice.findFirst({ where: { orderId: r.order.id, docType: { in: ["INVOICE", "INVOICE_RECEIPT"] } }, include: { lines: true } });
  if (!invoice) throw new AppError("NO_INVOICE", "This order has no invoice to credit.", 409);
  const creditLines = r.lines.map((l) => {
    const il = invoice.lines.find((x) => x.orderLineId === l.orderLineId);
    if (!il) throw new AppError("NO_INVOICE_LINE", "An invoice line for this product is missing.", 409);
    return { invoiceLineId: il.id, qty: l.qty };
  });
  let orderReturned = false;
  await prisma.$transaction(async (tx) => {
    const res = await tx.returnRequest.updateMany({ where: { id, status: "APPROVED" }, data: { status: "RECEIVED", receivedAt: new Date(), receivedById: ctx.user.id, restock: input.restock } });
    if (res.count !== 1) throw new AppError("CONFLICT", "This return was changed by someone else.", 409);
    if (input.restock) {
      const lines = await tx.orderLine.findMany({ where: { id: { in: r.lines.map((l) => l.orderLineId) } }, select: { id: true, offerId: true } });
      const byOffer = new Map<string, number>();
      for (const l of r.lines) {
        const offerId = lines.find((x) => x.id === l.orderLineId)!.offerId;
        byOffer.set(offerId, (byOffer.get(offerId) ?? 0) + l.qty);
      }
      await restockShipped(tx, r.order.id, byOffer);
    }
    const cn = await creditInvoice(tx, invoice.id, { lines: creditLines, reason: `Return: ${r.reason}`, actorUserId: ctx.user.id });
    await tx.returnRequest.update({ where: { id }, data: { status: "CREDITED", creditNoteId: cn.id } });
    // Everything delivered has come back → order RETURNED.
    const order = await tx.order.findUniqueOrThrow({ where: { id: r.order.id }, include: { lines: true, returns: { where: { status: "CREDITED" }, include: { lines: true } } } });
    const back = new Map<string, number>();
    for (const rr of order.returns) for (const l of rr.lines) back.set(l.orderLineId, (back.get(l.orderLineId) ?? 0) + l.qty);
    if (order.status === "DELIVERED" && order.lines.every((l) => (back.get(l.id) ?? 0) >= (l.qtyDelivered ?? 0))) {
      await applyOrderTransition(tx, order, "RETURNED", { reason: "All goods returned and credited", userId: ctx.user.id, companyId: ctx.company.id });
      orderReturned = true;
    }
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "return.received", entityType: "ReturnRequest", entityId: id, after: { restock: input.restock, creditNoteId: cn.id } }, tx);
  });
  await notifyCompany(r.order.buyerCompanyId, { type: "return.credited", title: `Return — order ${r.order.number}`, body: "We received the goods. Your credit note is available under Invoices.", link: "/buy/finance/invoices" });
  if (orderReturned) await notifyOrderChange(r.order, "RETURNED", "All goods returned and credited", "SYSTEM");
}
