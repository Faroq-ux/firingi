/**
 * Order lists (Phase 26): saved shopping lists ("Weekly kitchen") — shared with the buyer's team or
 * private — made from the cart, from a past order or by hand; one click puts a whole list in the cart
 * (products no longer available are skipped and counted), or turns it into a recurring order.
 */
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";
import { pricedOffers } from "@/server/data/catalogue-buyer";
import { pickLocalized } from "@/i18n/config";

function requireBuyer(ctx: Ctx) {
  if ((ctx.company.type !== "CUSTOMER" && ctx.company.type !== "WHOLESALER") || ctx.company.status !== "APPROVED" || !can(ctx, ["buyer.orders.place", "buyer.orders.view"])) throw new ForbiddenError();
}
const visible = (ctx: Ctx) => ({ companyId: ctx.company.id, OR: [{ shared: true }, { createdById: ctx.user.id }] });

async function editable(ctx: Ctx, id: string) {
  const l = await prisma.orderList.findFirst({ where: { id, ...visible(ctx) } });
  if (!l) throw new NotFoundError("List");
  // a shared list can be changed by anyone who orders; a private one only by its owner
  if (l.createdById !== ctx.user.id && !can(ctx, "buyer.orders.place")) throw new ForbiddenError();
  return l;
}

export async function myLists(ctx: Ctx) {
  requireBuyer(ctx);
  const rows = await prisma.orderList.findMany({ where: visible(ctx), include: { items: true }, orderBy: { updatedAt: "desc" } });
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.createdById))] } }, select: { id: true, name: true } });
  return rows.map((l) => ({ id: l.id, name: l.name, shared: l.shared, items: l.items.length, units: l.items.reduce((a, i) => a + i.qty, 0), updatedAt: l.updatedAt, createdBy: users.find((u) => u.id === l.createdById)?.name ?? null, mine: l.createdById === ctx.user.id }));
}

export async function getList(ctx: Ctx, id: string, locale: string) {
  requireBuyer(ctx);
  const l = await prisma.orderList.findFirst({ where: { id, ...visible(ctx) }, include: { items: { orderBy: { addedAt: "asc" } } } });
  if (!l) throw new NotFoundError("List");
  const { items: priced } = await pricedOffers(ctx, l.items.map((i) => ({ offerId: i.offerId, qty: i.qty })));
  const offers = await prisma.vendorOffer.findMany({ where: { id: { in: l.items.map((i) => i.offerId) } }, select: { id: true, vendorSku: true, vendor: { select: { legalName: true, tradeName: true } }, packaging: { select: { name: true, variant: { select: { product: { select: { name: true } } } } } } } });
  return {
    id: l.id, name: l.name, shared: l.shared, mine: l.createdById === ctx.user.id, updatedAt: l.updatedAt,
    lines: l.items.map((i) => {
      const o = offers.find((x) => x.id === i.offerId);
      const p = priced.find((x) => x.offerId === i.offerId);
      return {
        offerId: i.offerId, qty: i.qty, sku: o?.vendorSku ?? null, product: o ? pickLocalized(o.packaging.variant.product.name, locale) : "", packaging: o ? pickLocalized(o.packaging.name, locale) : "",
        supplier: o ? o.vendor.tradeName ?? o.vendor.legalName : "", unitNet: p?.price?.unitPriceNet ?? null, available: !!p?.price,
      };
    }),
  };
}

export async function createList(ctx: Ctx, i: { name: string; shared?: boolean; from?: "CART" | "ORDER" | null; orderId?: string | null; items?: { offerId: string; qty: number }[] }) {
  requireBuyer(ctx);
  const name = i.name.trim();
  if (!name) throw new ValidationError("Give the list a name.");
  let items = i.items ?? [];
  if (i.from === "CART") {
    const cart = await prisma.cart.findUnique({ where: { buyerCompanyId_userId: { buyerCompanyId: ctx.company.id, userId: ctx.user.id } }, include: { items: true } });
    items = (cart?.items ?? []).map((x) => ({ offerId: x.offerId, qty: x.qty }));
    if (!items.length) throw new ValidationError("Your cart is empty.");
  } else if (i.from === "ORDER") {
    const o = await prisma.order.findFirst({ where: { id: i.orderId ?? "", buyerCompanyId: ctx.company.id }, include: { lines: true } });
    if (!o) throw new NotFoundError("Order");
    items = o.lines.map((l) => ({ offerId: l.offerId, qty: l.qtyOrdered }));
  }
  const merged = new Map<string, number>();
  for (const x of items) {
    if (!Number.isInteger(x.qty) || x.qty <= 0) throw new ValidationError("Quantities must be whole numbers above 0.");
    merged.set(x.offerId, (merged.get(x.offerId) ?? 0) + x.qty);
  }
  if (merged.size > 200) throw new ValidationError("At most 200 products in a list.");
  const l = await prisma.orderList.create({ data: { companyId: ctx.company.id, createdById: ctx.user.id, name, shared: i.shared ?? true, items: { create: [...merged].map(([offerId, qty]) => ({ offerId, qty })) } } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "order_list.created", entityType: "OrderList", entityId: l.id, after: { name, items: merged.size, from: i.from ?? null } });
  return l.id;
}

export async function updateList(ctx: Ctx, id: string, i: { name?: string; shared?: boolean }) {
  requireBuyer(ctx);
  const l = await editable(ctx, id);
  if (i.shared !== undefined && l.createdById !== ctx.user.id) throw new ForbiddenError("Only the person who made the list can change who sees it.");
  await prisma.orderList.update({ where: { id }, data: { ...(i.name?.trim() ? { name: i.name.trim() } : {}), ...(i.shared !== undefined ? { shared: i.shared } : {}) } });
}

/** Set a product's quantity on the list (0 removes it). */
export async function setListItem(ctx: Ctx, id: string, offerId: string, qty: number) {
  requireBuyer(ctx);
  await editable(ctx, id);
  if (!Number.isInteger(qty) || qty < 0 || qty > 1_000_000) throw new ValidationError("Quantity must be a whole number ≥ 0.");
  if (qty === 0) await prisma.orderListItem.deleteMany({ where: { listId: id, offerId } });
  else {
    const { unavailable } = await pricedOffers(ctx, [{ offerId, qty }]);
    if (unavailable.length) throw new ValidationError("This product is not available to you.");
    await prisma.orderListItem.upsert({ where: { listId_offerId: { listId: id, offerId } }, update: { qty }, create: { listId: id, offerId, qty } });
  }
  await prisma.orderList.update({ where: { id }, data: { updatedAt: new Date() } });
}

export async function deleteList(ctx: Ctx, id: string) {
  requireBuyer(ctx);
  const l = await editable(ctx, id);
  if (l.createdById !== ctx.user.id && !can(ctx, "buyer.orders.approve")) throw new ForbiddenError("Only the person who made the list (or a manager) can delete it.");
  await prisma.orderList.delete({ where: { id } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "order_list.deleted", entityType: "OrderList", entityId: id });
}

/** Put the whole list in the cart (adds to what is there). */
export async function listToCart(ctx: Ctx, id: string) {
  requireBuyer(ctx);
  if (!can(ctx, "buyer.orders.place")) throw new ForbiddenError();
  const l = await prisma.orderList.findFirst({ where: { id, ...visible(ctx) }, include: { items: true } });
  if (!l) throw new NotFoundError("List");
  const { addToCart } = await import("@/server/services/cart");
  let added = 0, skipped = 0;
  for (const i of l.items) {
    try { await addToCart(ctx, i.offerId, i.qty); added++; } catch { skipped++; }
  }
  return { added, skipped };
}
