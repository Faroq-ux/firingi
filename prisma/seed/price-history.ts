/**
 * Demo price history (dev / demo databases only — never the test database): 6 months of earlier
 * base prices for every active offer, so Price Intelligence has timelines to show. Prices drift up
 * a few percent over the months (one in five offers had a cut at some point). Rows are inserted
 * directly with past dates; the current price list is not touched. Runs once (skips offers that
 * already have history before their current price).
 *   pnpm db:demo-prices
 */
import { Prisma, PrismaClient } from "@prisma/client";

const DAY = 86400_000;
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

export async function seedPriceHistory(db: PrismaClient) {
  const items = await db.priceListItem.findMany({
    where: { minQty: 1, priceList: { scope: "BASE" }, offer: { status: "ACTIVE" } },
    select: { offerId: true, priceListId: true, unitPriceNet: true },
  });
  let added = 0;
  for (const [n, it] of items.entries()) {
    const first = await db.priceHistory.findFirst({ where: { offerId: it.offerId, priceListId: it.priceListId, minQty: 1 }, orderBy: { changedAt: "asc" } });
    if (first && first.changedAt.getTime() < Date.now() - 30 * DAY) continue; // already has history
    const r = rng(n * 7919 + 17);
    const now = Number(it.unitPriceNet);
    const steps = [175, 130, 92, 55, 24].filter(() => r() > 0.25);
    let prev: number | null = null;
    const rows: Prisma.PriceHistoryCreateManyInput[] = [];
    steps.forEach((ago, i) => {
      const left = steps.length - i;
      const factor = 1 - left * (0.012 + r() * 0.02) + (r() < 0.2 ? 0.04 : 0);
      const p = Math.max(0.05, Math.round(now * factor * 100) / 100);
      rows.push({ offerId: it.offerId, priceListId: it.priceListId, scope: "BASE", minQty: 1, oldPrice: prev === null ? null : prev.toFixed(4), newPrice: p.toFixed(4), changePct: prev ? (((p - prev) / prev) * 100).toFixed(2) : null, changedAt: new Date(Date.now() - ago * DAY - Math.floor(r() * DAY)) });
      prev = p;
    });
    if (rows.length) { await db.priceHistory.createMany({ data: rows }); added += rows.length; }
  }
  return { offers: items.length, added };
}

if (process.argv[1]?.endsWith("price-history.ts")) {
  const db = new PrismaClient();
  seedPriceHistory(db).then((r) => { console.log(`price history: ${r.added} earlier prices for ${r.offers} offers`); return db.$disconnect(); });
}
