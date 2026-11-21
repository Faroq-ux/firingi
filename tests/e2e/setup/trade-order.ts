/**
 * e2e helper (Phase 57): a Portuguese wholesaler buys rice from the Spanish distributor and FIRINGI delivers it,
 * so a reverse-charge statement (an Intrastat arrival) exists. Prints the order id.
 *   npx tsx --require ./tests/e2e/setup/no-server-only.cjs tests/e2e/setup/trade-order.ts
 */
import "dotenv/config";
import { prisma } from "@/server/db";
import { loadContext } from "@/server/context";
import { addToCart, clearCart } from "@/server/services/cart";
import { changeOrderStatus, placeOrder } from "@/server/services/orders";

async function ctxOfEmail(email: string) {
  const u = await prisma.user.findUniqueOrThrow({ where: { email }, include: { memberships: { where: { status: "ACTIVE" } } } });
  return (await loadContext(u.id, "e2e", u.memberships[0].companyId))!;
}

async function main() {
  const buyer = await ctxOfEmail("purchasing@lisboacentral.test");
  const vendor = await ctxOfEmail("owner@ibericas.test");
  const admin = await ctxOfEmail("superadmin@firingi.test");
  const offer = await prisma.vendorOffer.findFirstOrThrow({ where: { vendor: { legalName: "Distribuciones Ibéricas S.L." }, status: "ACTIVE", packaging: { variant: { sku: "FIR-ARROZ1" } } } });
  await clearCart(buyer);
  await addToCart(buyer, offer.id, 60);
  const addr = await prisma.address.findFirstOrThrow({ where: { companyId: buyer.company.id, kind: "DELIVERY" } });
  const { id } = await placeOrder(buyer, { deliveryAddressId: addr.id });
  await changeOrderStatus(vendor, id, "SUPPLIER_PROCESSING");
  await changeOrderStatus(vendor, id, "READY_FOR_PICKUP");
  for (const s of ["DISPATCHED", "OUT_FOR_DELIVERY", "DELIVERED"] as const) await changeOrderStatus(admin, id, s);
  console.log(id);
}
main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
