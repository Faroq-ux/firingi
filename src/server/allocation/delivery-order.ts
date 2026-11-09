/**
 * Delivery Order: what FIRINGI asks a supplier to deliver — to the customer — and to invoice
 * FIRINGI for, at the supplier's own prices (the customer's prices are never shown).
 */
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { NotFoundError } from "@/server/errors";
import { getOrder } from "@/server/services/orders";

export async function deliveryOrder(ctx: Ctx, orderId: string) {
  const { order, role } = await getOrder(ctx, orderId);
  if (role !== "VENDOR" && role !== "ADMIN") throw new NotFoundError("Order");
  const firingi = await prisma.legalEntity.findFirst({ where: { countryId: order.countryId, isActive: true } });
  const addr = order.deliveryAddress as { label?: string; line1?: string; line2?: string | null; postalCode?: string; city?: string; country?: string; contactName?: string | null; phone?: string | null };
  return {
    number: order.number, placedAt: order.placedAt, status: order.status, routedByFiringi: order.routedByFiringi,
    deliveryMode: order.deliveryMode, requestedDeliveryDate: order.requestedDeliveryDate, notes: order.buyerNotes,
    supplier: { name: order.seller.tradeName ?? order.seller.legalName, legalName: order.seller.legalName },
    customer: { name: order.buyer.tradeName ?? order.buyer.legalName, phone: addr.phone ?? order.buyer.phone, contact: addr.contactName ?? null },
    deliverTo: addr,
    invoiceTo: firingi && { legalName: firingi.legalName, vatNumber: firingi.vatNumber, address: `${firingi.addressLine}, ${firingi.postalCode} ${firingi.city}`, email: firingi.email },
    lines: order.lines.map((l) => ({
      id: l.id, name: l.productName, packaging: l.packagingName, sku: l.sku,
      qty: l.qtyConfirmed ?? l.qtyOrdered, unitNet: l.vendorUnitCostNet.toString(), lineNet: l.vendorLineNet.toString(),
    })),
    totalNet: order.vendorPayableNet.toString(),
    confirmed: order.status !== "PENDING_CONFIRMATION",
  };
}
