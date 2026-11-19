/**
 * e2e helper: the supplier confirms an order and it goes all the way to DELIVERED (FIRINGI moves what the
 * supplier may not), so its invoice exists.   npx tsx --require ./tests/e2e/setup/no-server-only.cjs tests/e2e/setup/deliver.ts <orderId>
 */
import "dotenv/config";
import { prisma } from "@/server/db";
import { loadContext } from "@/server/context";
import { changeOrderStatus, confirmOrder } from "@/server/services/orders";

async function ctxOf(companyId: string) {
  const m = await prisma.membership.findFirstOrThrow({ where: { companyId, isOwner: true } });
  return (await loadContext(m.userId, "e2e", companyId))!;
}

async function main() {
  const id = process.argv[2];
  const o = await prisma.order.findUniqueOrThrow({ where: { id } });
  const vendor = await ctxOf(o.sellerCompanyId);
  const admin = await ctxOf((await prisma.company.findFirstOrThrow({ where: { type: "ADMIN" } })).id);
  if (o.status === "PENDING_CONFIRMATION") await confirmOrder(vendor, id, {});
  for (const st of ["READY_FOR_PICKUP", "DISPATCHED", "OUT_FOR_DELIVERY", "DELIVERED"] as const) {
    const cur = await prisma.order.findUniqueOrThrow({ where: { id } });
    if (cur.status === "DELIVERED") break;
    await changeOrderStatus(vendor, id, st).catch(() => changeOrderStatus(admin, id, st));
  }
  const inv = await prisma.invoice.findFirst({ where: { orderId: id, docType: "INVOICE" } });
  console.log(inv?.id ?? "");
}
main().finally(() => prisma.$disconnect());
