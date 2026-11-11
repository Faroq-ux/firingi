/**
 * FIRINGI's view of inventory (Phase 24): stock value, expiring and expired stock per supplier
 * (FIRINGI's own warehouse included), and every expiring batch across suppliers. Read-only.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { ForbiddenError } from "@/server/errors";
import { SHORT_DATED_DAYS } from "./settings";

const day = 86_400_000;
const todayUtc = () => { const d = new Date(); return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); };
function requireView(ctx: Ctx) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, ["admin.inventory.view", "admin.inventory.manage"])) throw new ForbiddenError();
}

export async function adminInventoryOverview(ctx: Ctx) {
  requireView(ctx);
  const today = todayUtc(), soon = new Date(today.getTime() + SHORT_DATED_DAYS * day);
  const rows = await prisma.$queryRaw<{ id: string; name: string; type: string; inHouse: boolean; value: Prisma.Decimal | null; units: bigint | null; lines: bigint; noCost: bigint; low: bigint }[]>`
    SELECT c.id, COALESCE(c."tradeName", c."legalName") AS name, c.type::text AS type, c."isInHouse" AS "inHouse",
      SUM(l."onHand" * l."avgCost") AS value, SUM(l."onHand") AS units, COUNT(*) FILTER (WHERE l."onHand" > 0) AS lines,
      COUNT(*) FILTER (WHERE l."onHand" > 0 AND l."avgCost" = 0) AS "noCost",
      COUNT(*) FILTER (WHERE l."reorderPoint" IS NOT NULL AND l."onHand" - l.reserved <= l."reorderPoint") AS low
    FROM "StockLevel" l JOIN "VendorOffer" o ON o.id = l."offerId" JOIN "Company" c ON c.id = o."vendorCompanyId"
    GROUP BY c.id ORDER BY SUM(l."onHand" * l."avgCost") DESC NULLS LAST`;
  const batches = await prisma.$queryRaw<{ companyId: string; expiring: bigint; expired: bigint; expiredValue: Prisma.Decimal | null }[]>`
    SELECT o."vendorCompanyId" AS "companyId",
      COUNT(*) FILTER (WHERE b."expiresOn" >= ${today} AND b."expiresOn" <= ${soon}) AS expiring,
      COUNT(*) FILTER (WHERE b."expiresOn" < ${today}) AS expired,
      SUM(CASE WHEN b."expiresOn" < ${today} THEN b."onHand" * l."avgCost" ELSE 0 END) AS "expiredValue"
    FROM "StockBatch" b JOIN "VendorOffer" o ON o.id = b."offerId"
    LEFT JOIN "StockLevel" l ON l."offerId" = b."offerId" AND l."addressId" = b."addressId"
    WHERE b."writtenOffAt" IS NULL AND b."onHand" > 0 AND b."expiresOn" IS NOT NULL
    GROUP BY o."vendorCompanyId"`;
  const pos = await prisma.purchaseOrder.groupBy({ by: ["ownerCompanyId"], where: { status: { in: ["SENT", "PARTIALLY_RECEIVED"] } }, _count: { _all: true } });
  const out = rows.map((r) => {
    const b = batches.find((x) => x.companyId === r.id);
    return {
      id: r.id, name: r.name, type: r.type, inHouse: r.inHouse, value: (r.value ?? new Prisma.Decimal(0)).toFixed(2), units: Number(r.units ?? 0), lines: Number(r.lines),
      noCost: Number(r.noCost), low: Number(r.low), expiring: Number(b?.expiring ?? 0), expired: Number(b?.expired ?? 0), expiredValue: (b?.expiredValue ?? new Prisma.Decimal(0)).toFixed(2),
      openPos: pos.find((p) => p.ownerCompanyId === r.id)?._count._all ?? 0,
    };
  }).filter((r) => r.lines > 0 || r.openPos > 0);
  const sum = (k: "units" | "expiring" | "expired" | "low") => out.reduce((a, r) => a + r[k], 0);
  return {
    rows: out, total: out.reduce((a, r) => a + Number(r.value), 0).toFixed(2), inHouseValue: out.filter((r) => r.inHouse).reduce((a, r) => a + Number(r.value), 0).toFixed(2),
    units: sum("units"), expiring: sum("expiring"), expired: sum("expired"), low: sum("low"), expiredValue: out.reduce((a, r) => a + Number(r.expiredValue), 0).toFixed(2),
  };
}

export async function adminExpiring(ctx: Ctx, days = 14) {
  requireView(ctx);
  const until = new Date(todayUtc().getTime() + days * day);
  const rows = await prisma.stockBatch.findMany({
    where: { writtenOffAt: null, onHand: { gt: 0 }, expiresOn: { not: null, lte: until } },
    include: { offer: { select: { vendorSku: true, vendor: { select: { legalName: true, tradeName: true, isInHouse: true } }, packaging: { select: { name: true, variant: { select: { product: { select: { name: true } } } } } } } }, address: { select: { label: true } } },
    orderBy: { expiresOn: "asc" }, take: 1000,
  });
  return rows.map((b) => ({
    id: b.id, supplier: b.offer.vendor.tradeName ?? b.offer.vendor.legalName, inHouse: b.offer.vendor.isInHouse, product: b.offer.packaging.variant.product.name, packaging: b.offer.packaging.name, sku: b.offer.vendorSku,
    warehouse: b.address.label, lotCode: b.lotCode, expiresOn: b.expiresOn!, daysLeft: Math.round((b.expiresOn!.getTime() - todayUtc().getTime()) / day), onHand: b.onHand, reserved: b.reserved,
  }));
}
