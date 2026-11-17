/**
 * Test data for tests/e2e/app.mjs (Phase 39), against the dev database the e2e server uses:
 *   npx tsx --require ./tests/e2e/setup/no-server-only.cjs tests/e2e/setup/app-setup.ts
 * Prints JSON: a FIRINGI-fleet delivery assigned to the FIRINGI driver (ready for pickup) and an open
 * pick list at Lisboa Central with the order's lines.
 */
import "dotenv/config";
import { prisma } from "@/server/db";
import { addToCart, clearCart } from "@/server/services/cart";
import { changeOrderStatus, confirmOrder, placeOrder } from "@/server/services/orders";
import { setStock } from "@/server/services/vendor-catalogue";
import { assignDelivery } from "@/server/services/deliveries";
import { setWarehouseFeature } from "@/server/warehouse/features";
import { createPickList } from "@/server/warehouse/picking";
import { ctxFor } from "../../helpers";

const KEBAB = "owner@kebabhouse.test", LX = "owner@lisboacentral.test", OPS = "ops@firingi.test", SA = "superadmin@firingi.test", FIR_DRIVER = "driver@firingi.test";

async function order(sku: string, qty: number, unitsPerPack?: number) {
  const kebab = await ctxFor(KEBAB);
  const lx = await ctxFor(LX);
  await clearCart(kebab);
  const offer = await prisma.vendorOffer.findFirstOrThrow({ where: { vendorCompanyId: lx.company.id, status: "ACTIVE", packaging: { variant: { sku }, ...(unitsPerPack ? { unitsPerPack } : {}) } } });
  const wh = await prisma.address.findFirstOrThrow({ where: { companyId: lx.company.id, kind: { in: ["WAREHOUSE", "PICKUP"] } } });
  const cur = await prisma.stockLevel.findUnique({ where: { offerId_addressId: { offerId: offer.id, addressId: wh.id } } });
  await setStock(lx, offer.id, wh.id, Math.max(800, (cur?.reserved ?? 0) + 500));
  await addToCart(kebab, offer.id, qty);
  const addr = await prisma.address.findFirstOrThrow({ where: { companyId: kebab.company.id, kind: "DELIVERY", isActive: true }, orderBy: { isDefault: "desc" } });
  const { id } = await placeOrder(kebab, { deliveryAddressId: addr.id, notes: "e2e app" });
  await confirmOrder(lx, id, {});
  return { id, wh: wh.id };
}

async function main() {
  const sa = await ctxFor(SA);
  const lx = await ctxFor(LX);
  // 1. a delivery for the FIRINGI driver
  const d1 = await order("FIR-MOZZ2", 5, 1);
  const del = await prisma.delivery.findUniqueOrThrow({ where: { orderId: d1.id } });
  const driver = await prisma.driver.findFirstOrThrow({ where: { user: { email: FIR_DRIVER } } });
  await prisma.delivery.updateMany({ where: { driverId: driver.id, status: { in: ["ASSIGNED", "PICKED_UP", "OUT_FOR_DELIVERY"] }, id: { not: del.id } }, data: { driverId: null, status: "UNASSIGNED", routeId: null } });
  await prisma.driver.update({ where: { id: driver.id }, data: { availability: "AVAILABLE" } });
  if (del.mode === "FIRINGI_FLEET") {
    await assignDelivery(await ctxFor(OPS), del.id, { driverId: driver.id });
    await changeOrderStatus(lx, d1.id, "READY_FOR_PICKUP");
  }
  // 2. an open pick list at Lisboa Central
  await setWarehouseFeature(sa, lx.company.id, "PICK_PACK", true);
  const d2 = await order("FIR-MOZZ2", 6, 1);
  await prisma.pickList.updateMany({ where: { companyId: lx.company.id, status: "OPEN" }, data: { status: "CANCELLED" } }).catch(() => null);
  const pickListId = await createPickList(lx, { addressId: d2.wh, orderIds: [d2.id] });
  const lines = await prisma.pickLine.findMany({ where: { pickListId }, select: { id: true, qty: true } });
  const number = (await prisma.order.findUniqueOrThrow({ where: { id: d1.id }, select: { number: true } })).number;
  console.log(JSON.stringify({ deliveryId: del.id, mode: del.mode, orderNumber: number, pickListId, lines }));
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
