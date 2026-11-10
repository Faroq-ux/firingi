/**
 * Demo buying history (dev / demo databases only — never the test database): 16 weeks of
 * delivered orders so the AI Centre has patterns to learn from. Kebab House buys from Lisboa
 * Central every week and from C&C Almada every ~10 days (that one has stopped: overdue);
 * the wholesalers buy from the distributors. Some products grow, some fade.
 * Orders are marked "Demo history" and are not invoiced (no effect on balances or credit).
 *   pnpm db:demo-history
 */
import { Prisma, PrismaClient, type OrderFlow } from "@prisma/client";

const MARK = "Demo history";
const DAY = 86400_000;

/** Deterministic pseudo-random numbers (same history on every run). */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

type Pattern = { buyer: string; seller: string; everyDays: number; stopDaysAgo: number; products: number; seed: number };
const PATTERNS: Pattern[] = [
  { buyer: "Kebab House Lisboa, Lda", seller: "Grossista Lisboa Central, Lda", everyDays: 7, stopDaysAgo: 3, products: 6, seed: 11 },
  { buyer: "Kebab House Lisboa, Lda", seller: "Cash & Carry Almada, Lda", everyDays: 10, stopDaysAgo: 24, products: 3, seed: 12 },
  { buyer: "Grossista Lisboa Central, Lda", seller: "Distribuidora Atlântico, Lda", everyDays: 7, stopDaysAgo: 2, products: 8, seed: 13 },
  { buyer: "Cash & Carry Almada, Lda", seller: "Distribuidora Atlântico, Lda", everyDays: 7, stopDaysAgo: 19, products: 4, seed: 14 },
  { buyer: "Grossista Lisboa Central, Lda", seller: "Distribuciones Ibéricas S.L.", everyDays: 14, stopDaysAgo: 6, products: 2, seed: 15 },
];

/** `statusHistory: false` (tests) leaves out the append-only status rows so the orders can be removed again. */
export async function seedDemoHistory(db: PrismaClient, now = new Date(), opts: { statusHistory?: boolean } = {}) {
  let created = 0, skipped = 0;
  for (const p of PATTERNS) {
    const [buyer, seller] = await Promise.all([
      db.company.findFirst({ where: { legalName: p.buyer }, include: { addresses: { where: { isActive: true, kind: { in: ["DELIVERY", "WAREHOUSE", "PICKUP"] } }, orderBy: [{ kind: "desc" }, { isDefault: "desc" }], take: 1 }, memberships: { where: { isOwner: true }, take: 1 } } }),
      db.company.findFirst({ where: { legalName: p.seller }, include: { addresses: { where: { kind: "WAREHOUSE" }, take: 1 } } }),
    ]);
    if (!buyer || !seller || !buyer.addresses[0] || !buyer.memberships[0]) continue;
    if (await db.order.count({ where: { buyerNotes: MARK, buyerCompanyId: buyer.id, sellerCompanyId: seller.id } })) { skipped++; continue; }
    const offers = await db.vendorOffer.findMany({
      where: { vendorCompanyId: seller.id, status: "ACTIVE", ...(seller.type === "DISTRIBUTOR" ? {} : { countryId: buyer.countryId }) },
      include: { prices: { where: { priceList: { scope: "BASE", isActive: true } }, orderBy: { minQty: "asc" }, take: 1 }, packaging: { include: { variant: { include: { product: true } } } } },
      orderBy: { createdAt: "asc" }, take: p.products,
    });
    const priced = offers.filter((o) => o.prices[0]);
    if (!priced.length) continue;
    const rule = await db.commissionRule.findFirst({ where: { vendorCompanyId: seller.id, type: "PERCENT", validFrom: { lte: now }, OR: [{ validTo: null }, { validTo: { gt: now } }] }, orderBy: { validFrom: "desc" } });
    const rate = rule ? Number(rule.rate) : 10;
    const taxes = new Map<string, number>();
    for (const o of priced) {
      const tc = o.packaging.variant.product.taxCategoryId;
      if (taxes.has(tc)) continue;
      const t = await db.taxRate.findFirst({ where: { countryId: buyer.countryId, taxCategoryId: tc, regionId: null, validFrom: { lte: now } }, orderBy: { validFrom: "desc" } });
      taxes.set(tc, t ? Number(t.rate) : 23);
    }
    const a = buyer.addresses[0];
    const address = { id: a.id, label: a.label, line1: a.line1, line2: a.line2, postalCode: a.postalCode, city: a.cityName, country: "PT", latitude: a.latitude?.toString() ?? null, longitude: a.longitude?.toString() ?? null, contactName: a.contactName, phone: a.phone, regionId: null };
    const flow: OrderFlow = buyer.type === "CUSTOMER" ? "CUSTOMER_FROM_WHOLESALER" : "WHOLESALER_FROM_DISTRIBUTOR";
    const rand = rng(p.seed);
    // Per product: base weekly quantity and a trend (some grow, some fade).
    const shape = priced.map((_, i) => ({ base: 4 + Math.round(rand() * 12), growth: [0.06, 0, -0.04, 0.03, 0, 0.1, -0.02, 0][i % 8] }));
    const first = now.getTime() - 112 * DAY;
    for (let t = first; t <= now.getTime() - p.stopDaysAgo * DAY; t += (p.everyDays + Math.round((rand() - 0.5) * 2)) * DAY) {
      const placedAt = new Date(t + 9 * 3600_000);
      const weeks = (t - first) / (7 * DAY);
      const lines = priced.map((o, i) => {
        const s = shape[i];
        const qty = Math.max(1, Math.round(s.base * (p.everyDays / 7) * Math.pow(1 + s.growth, weeks) * (0.85 + rand() * 0.3)));
        const unit = new Prisma.Decimal(o.prices[0].unitPriceNet);
        const lineNet = unit.mul(qty).toDecimalPlaces(2);
        const tax = taxes.get(o.packaging.variant.product.taxCategoryId)!;
        const lineVat = lineNet.mul(tax).div(100).toDecimalPlaces(2);
        const commission = lineNet.mul(rate).div(100).toDecimalPlaces(2);
        return {
          offerId: o.id, productName: o.packaging.variant.product.name as Prisma.InputJsonValue, sku: o.packaging.variant.sku, packagingName: o.packaging.name as Prisma.InputJsonValue,
          qtyOrdered: qty, qtyConfirmed: qty, qtyDelivered: qty, unitListPriceNet: unit, unitSalePriceNet: unit, taxRate: new Prisma.Decimal(tax), lineNet, lineVat,
          commissionRuleId: rule?.id ?? null, commissionType: "PERCENT" as const, commissionRate: new Prisma.Decimal(rate), commissionBase: lineNet, commissionAmount: commission,
          vendorUnitCostNet: unit.mul(100 - rate).div(100).toDecimalPlaces(4), vendorLineNet: lineNet.minus(commission),
        };
      }).filter((_, i) => i < 2 || rand() > 0.25); // the main products every time, the others most times
      const net = lines.reduce((s, l) => s.plus(l.lineNet), new Prisma.Decimal(0));
      const vat = lines.reduce((s, l) => s.plus(l.lineVat), new Prisma.Decimal(0));
      const comm = lines.reduce((s, l) => s.plus(l.commissionAmount), new Prisma.Decimal(0));
      await db.$transaction(async (tx) => {
        const [{ n }] = await tx.$queryRaw<{ n: number }[]>`
          INSERT INTO "Sequence" (name, year, "nextValue") VALUES ('order', ${now.getFullYear()}, 2)
          ON CONFLICT (name, year) DO UPDATE SET "nextValue" = "Sequence"."nextValue" + 1 RETURNING "nextValue" - 1 AS n`;
        await tx.order.create({
          data: {
            number: `FO-${now.getFullYear()}-${String(n).padStart(6, "0")}`, flow, buyerCompanyId: buyer.id, sellerCompanyId: seller.id, placedByUserId: buyer.memberships[0].userId,
            countryId: buyer.countryId, status: "DELIVERED", deliveryMode: "VENDOR_FLEET", deliveryAddress: address, sourceAddressId: seller.addresses[0]?.id ?? null,
            requestedDeliveryDate: new Date(placedAt.getTime() + DAY), buyerNotes: MARK, placedAt,
            listNet: net, netTotal: net, vatTotal: vat, grandTotal: net.plus(vat), commissionTotal: comm, vendorPayableNet: net.minus(comm), firingiMarginNet: comm,
            lines: { create: lines },
            statusHistory: opts.statusHistory === false ? undefined : { create: [{ toStatus: "NEW", at: placedAt }, { fromStatus: "NEW", toStatus: "SUPPLIER_PROCESSING", at: new Date(placedAt.getTime() + 2 * 3600_000) }, { fromStatus: "SUPPLIER_PROCESSING", toStatus: "DELIVERED", at: new Date(placedAt.getTime() + DAY) }] },
          },
        });
      });
      created++;
    }
  }
  return { created, skipped };
}

if (process.argv[1]?.includes("prisma/seed/history")) {
  const db = new PrismaClient();
  const url = process.env.DATABASE_URL ?? "";
  if (/test/.test(new URL(url || "postgresql://x/x").pathname)) { console.error("Not for the test database."); process.exit(1); }
  seedDemoHistory(db)
    .then((r) => console.log(`✔ ${r.created} history orders created${r.skipped ? ` (${r.skipped} supplier pairs already had history)` : ""}`))
    .catch((e) => { console.error(e); process.exitCode = 1; })
    .finally(() => db.$disconnect());
}
