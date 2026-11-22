/**
 * e2e helper (Phase 60): Kebab House orders 10 × rice and 1 × olive oil from Lisboa Central, the supplier accepts.
 * Prints JSON { orderId, number, lineId }.
 *   npx tsx --require ./tests/e2e/setup/no-server-only.cjs tests/e2e/setup/sub-order.ts
 */
import "dotenv/config";
import { prisma } from "@/server/db";
import { loadContext } from "@/server/context";
import { addToCart, clearCart } from "@/server/services/cart";
import { confirmOrder, placeOrder } from "@/server/services/orders";
import { setStock } from "@/server/services/vendor-catalogue";

const ctxOf = async (email: string) => {
  const u = await prisma.user.findUniqueOrThrow({ where: { email } });
  return (await loadContext(u.id, "e2e"))!;
};

async function main() {
  const lx = await ctxOf("owner@lisboacentral.test"), kb = await ctxOf("owner@kebabhouse.test");
  const wh = await prisma.address.findFirstOrThrow({ where: { companyId: lx.company.id, kind: { in: ["WAREHOUSE", "PICKUP"] } } });
  const ids: Record<string, string> = {};
  for (const sku of ["GRO-ARROZ1", "GRO-AZEITE75", "GRO-FARINHA25"]) {
    const o = await prisma.vendorOffer.findFirstOrThrow({ where: { vendorCompanyId: lx.company.id, vendorSku: sku, status: "ACTIVE" }, orderBy: { createdAt: "asc" } });
    const cur = await prisma.stockLevel.findUnique({ where: { offerId_addressId: { offerId: o.id, addressId: wh.id } } });
    await setStock(lx, o.id, wh.id, Math.max(500, (cur?.reserved ?? 0) + 300));
    ids[sku] = o.id;
  }
  const addressId = (await prisma.address.findFirstOrThrow({ where: { companyId: kb.company.id, kind: "DELIVERY", isActive: true }, orderBy: { isDefault: "desc" } })).id;
  await clearCart(kb);
  await addToCart(kb, ids["GRO-ARROZ1"], 10);
  await addToCart(kb, ids["GRO-AZEITE75"], 1);
  const placed = await placeOrder(kb, { deliveryAddressId: addressId });
  await confirmOrder(lx, placed.id, {});
  const line = await prisma.orderLine.findFirstOrThrow({ where: { orderId: placed.id, offerId: ids["GRO-ARROZ1"] } });
  console.log(JSON.stringify({ orderId: placed.id, number: placed.number, lineId: line.id, rice: ids["GRO-ARROZ1"], flour: ids["GRO-FARINHA25"] }));
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
