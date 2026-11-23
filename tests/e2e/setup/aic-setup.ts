/**
 * e2e helper (Phase 66): a FIRINGI route for tomorrow whose 6 pickup stops are in a zig-zag order (so the AI Centre
 * finds a shorter order), on deliveries made for 6 existing orders ("add"); the clean-up ("remove").
 *   npx tsx --require ./tests/e2e/setup/no-server-only.cjs tests/e2e/setup/aic-setup.ts add|remove
 */
import "dotenv/config";
import { prisma } from "@/server/db";

const NUMBER = "RT-AIC-E2E";
const PTS = [[38.70, -9.14], [38.78, -9.10], [38.71, -9.15], [38.77, -9.09], [38.72, -9.13], [38.76, -9.11]];

async function remove() {
  const r = await prisma.route.findUnique({ where: { number: NUMBER }, include: { stops: { select: { deliveryId: true } } } });
  if (r) {
    await prisma.route.delete({ where: { id: r.id } });
    await prisma.delivery.deleteMany({ where: { id: { in: r.stops.map((s) => s.deliveryId) }, notes: "aic-e2e" } }).catch(() => null);
  }
  await prisma.delivery.deleteMany({ where: { notes: "aic-e2e" } }).catch(() => null);
  await prisma.aiRecommendation.deleteMany({ where: { kind: { in: ["ROUTE_SAVING", "ROUTE_MERGE"] } } });
  await prisma.setting.deleteMany({ where: { key: "ai.centre" } });
}

async function add() {
  await remove();
  const admin = await prisma.company.findFirstOrThrow({ where: { type: "ADMIN" }, orderBy: { createdAt: "asc" } });
  const orders = await prisma.order.findMany({ where: { delivery: null }, select: { id: true }, take: 6 });
  if (orders.length < 6) throw new Error("need 6 orders without a delivery");
  const dels: { id: string }[] = [];
  for (const o of orders) dels.push(await prisma.delivery.create({ data: { orderId: o.id, mode: "FIRINGI_FLEET", executingCompanyId: admin.id, notes: "aic-e2e" } }));
  const d = new Date(), day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1));
  const r = await prisma.route.create({
    data: {
      number: NUMBER, executingCompanyId: admin.id, date: day, status: "PLANNED", plannedStartAt: new Date(day.getTime() + 8 * 3600_000), startLat: 38.73, startLng: -9.14,
      stops: { create: PTS.map((p, i) => ({ deliveryId: dels[i].id, kind: "PICKUP", sequence: i + 1, label: `Stop ${i + 1}`, address: "Lisboa", lat: p[0], lng: p[1] })) },
    },
  });
  // make the next page load refresh the suggestions
  await prisma.aiActivity.deleteMany({ where: { kind: "REFRESH", at: { gt: new Date(Date.now() - 2 * 3600_000) } } });
  console.log(r.id);
}

(process.argv[2] === "remove" ? remove() : add()).then(() => prisma.$disconnect()).catch((e) => { console.error(e); process.exit(1); });
