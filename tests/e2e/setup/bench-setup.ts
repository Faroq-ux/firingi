/**
 * e2e helper (Phase 70): three Portuguese test restaurants buy what Kebab House bought recently, for less (copies of
 * its three latest orders at 75 %, 85 % and 95 % of the price), the minimum group size goes to 3 and the benchmark is
 * rebuilt ("add"); the clean-up ("remove").
 *   npx tsx --require ./tests/e2e/setup/no-server-only.cjs tests/e2e/setup/bench-setup.ts add|remove
 */
import "dotenv/config";
import { prisma } from "@/server/db";
import { processBenchmark } from "@/server/benchmark/job";

const TAG = "-BM";
const FACTORS = [0.75, 0.85, 0.95];

async function remove() {
  const orders = await prisma.order.findMany({ where: { number: { contains: TAG } }, select: { id: true } });
  await prisma.orderLine.deleteMany({ where: { orderId: { in: orders.map((o) => o.id) } } });
  await prisma.order.deleteMany({ where: { id: { in: orders.map((o) => o.id) } } });
  await prisma.setting.deleteMany({ where: { key: { in: ["benchmark.settings", "benchmark.lastRun"] } } });
  await prisma.priceBenchmark.deleteMany({});
}

async function add() {
  await remove();
  const kb = await prisma.company.findFirstOrThrow({ where: { legalName: "Kebab House Lisboa, Lda" } });
  const buyers = await prisma.company.findMany({ where: { type: "CUSTOMER", status: "APPROVED", countryId: kb.countryId, legalName: { startsWith: "Restaurante E2E" } }, orderBy: { createdAt: "asc" }, take: 3 });
  if (buyers.length < 3) throw new Error("need 3 approved test restaurants");
  const src = await prisma.order.findMany({ where: { buyerCompanyId: kb.id, status: { notIn: ["CANCELLED", "RETURNED"] } }, orderBy: { placedAt: "desc" }, take: 3, include: { lines: true } });
  for (const [k, b] of buyers.entries()) {
    for (const [j, o] of src.entries()) {
      const { id: _i, number, lines, createdAt: _c, updatedAt: _u, ...rest } = o as typeof o & { createdAt?: Date; updatedAt?: Date };
      void _i; void _c; void _u;
      const made = await prisma.order.create({ data: { ...(rest as object), buyerCompanyId: b.id, number: `${number}${TAG}${k}${j}` } as never });
      for (const line of lines) {
        const { id: _l, orderId: _o, createdAt: _lc, updatedAt: _lu, ...lr } = line as typeof line & { createdAt?: Date; updatedAt?: Date };
        void _l; void _o; void _lc; void _lu;
        await prisma.orderLine.create({ data: { ...(lr as object), orderId: made.id, unitSalePriceNet: Number(line.unitSalePriceNet) * FACTORS[k] } as never });
      }
    }
  }
  await prisma.setting.create({ data: { scope: "GLOBAL", key: "benchmark.settings", value: { minBuyers: 3 } } });
  const r = await processBenchmark(new Date(), true);
  console.log(JSON.stringify(r));
}

(process.argv[2] === "remove" ? remove() : add()).then(() => prisma.$disconnect()).catch((e) => { console.error(e); process.exit(1); });
