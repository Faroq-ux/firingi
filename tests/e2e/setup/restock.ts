/**
 * Keeps the shared e2e database usable across many runs: a suite that stops half-way leaves its orders
 * open, and their reservations pile up until checkout says "Only 0 available". Before a suite, every
 * active offer whose free stock (on hand − reserved) is under MIN gets goods in through the stock
 * ledger (an ADJUSTMENT receipt, like a stock count) so free stock is back to TARGET — only stock that
 * orders hold or have shipped; seed offers that start out of stock or low stay as they are.
 * Also frees the demo FIRINGI driver from a delivery tests/e2e/app.mjs left open when it stopped half-way
 * (its fleet takes one open delivery per driver).
 *   npx tsx --require ./tests/e2e/setup/no-server-only.cjs tests/e2e/setup/restock.ts
 */
import "dotenv/config";
import { prisma } from "@/server/db";
import { setOnHand } from "@/server/inventory/ledger";

const MIN = 120, TARGET = 300;

async function main() {
  const levels = await prisma.stockLevel.findMany({ where: { offer: { status: "ACTIVE" } }, select: { offerId: true, addressId: true, onHand: true, reserved: true } });
  let topped = 0;
  for (const l of levels) {
    if (l.onHand - l.reserved >= MIN) continue;
    const used = l.reserved > 0 || (await prisma.stockMovement.count({ where: { offerId: l.offerId, addressId: l.addressId, type: "SHIPMENT" } })) > 0;
    if (!used) continue;
    await prisma.$transaction((tx) => setOnHand(tx, { offerId: l.offerId, addressId: l.addressId, onHand: l.reserved + TARGET, note: "e2e restock" }), { timeout: 30_000 });
    topped++;
  }
  const freed = await prisma.delivery.updateMany({
    where: { status: { in: ["ASSIGNED", "PICKED_UP", "OUT_FOR_DELIVERY"] }, order: { buyerNotes: "e2e app" } },
    data: { driverId: null, status: "UNASSIGNED", routeId: null },
  });
  console.log(JSON.stringify({ levels: levels.length, topped, freed: freed.count }));
}

main().then(() => prisma.$disconnect(), async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
