/**
 * Goods bought on FIRINGI (Phase 24) — the transaction-level part, used by the order flow and the
 * ledger: when an order is delivered, every lot it was shipped from (with a best-before date) is
 * recorded for the buyer; returns take it off again.
 */
import type { Tx } from "@/server/db";

/** Record the dated lots of a delivered order for its buyer (idempotent). */
export async function recordPurchasedLots(tx: Tx, orderId: string) {
  if (await tx.purchasedLot.findFirst({ where: { orderId }, select: { id: true } })) return 0;
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { buyerCompanyId: true } });
  const moves = await tx.stockMovement.findMany({ where: { orderId, type: { in: ["SHIPMENT", "RETURN"] }, batchId: { not: null } }, include: { batch: true, offer: { select: { packagingUnitId: true } } } });
  const net = new Map<string, { offerId: string; batchId: string; qty: number; lotCode: string | null; expiresOn: Date | null; packagingUnitId: string }>();
  for (const m of moves) {
    const k = `${m.offerId}|${m.batchId}`;
    const cur = net.get(k) ?? { offerId: m.offerId, batchId: m.batchId!, qty: 0, lotCode: m.batch?.lotCode ?? null, expiresOn: m.batch?.expiresOn ?? null, packagingUnitId: m.offer.packagingUnitId };
    cur.qty += m.type === "SHIPMENT" ? m.qty : -m.qty;
    net.set(k, cur);
  }
  let n = 0;
  for (const r of net.values()) {
    if (r.qty <= 0 || !r.expiresOn) continue; // only goods with a best-before date
    await tx.purchasedLot.create({ data: { buyerCompanyId: order.buyerCompanyId, orderId, offerId: r.offerId, packagingUnitId: r.packagingUnitId, sellerBatchId: r.batchId, lotCode: r.lotCode, expiresOn: r.expiresOn, qty: r.qty } });
    n++;
  }
  return n;
}

/** Goods sent back after delivery are no longer the buyer's. */
export async function purchasedReturned(tx: Tx, orderId: string, offerId: string, sellerBatchId: string, qty: number) {
  const lot = await tx.purchasedLot.findFirst({ where: { orderId, offerId, sellerBatchId } });
  if (!lot) return;
  const left = Math.max(0, lot.qty - qty);
  await tx.purchasedLot.update({ where: { id: lot.id }, data: { qty: left, usedQty: Math.min(lot.usedQty, left) } });
}
