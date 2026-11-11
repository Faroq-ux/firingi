/**
 * Demo inventory (Phase 24): costs, lots with best-before dates (a couple short-dated, one expired),
 * reorder points, outside suppliers and purchase orders — so Inventory shows real numbers.
 * Idempotent: skipped once demo lots ("L24-…") exist. Keeps Σ batches = stock level.
 */
import { Prisma, type PrismaClient } from "@prisma/client";

const NO_EXPIRY = /^(GRO|DIS|FIR)-(CIG|PIZZABOX)/; // tobacco and packaging don't expire

export async function seedInventory(db: PrismaClient, now = new Date()) {
  if (await db.stockBatch.findFirst({ where: { lotCode: { startsWith: "L24-" } } })) return;
  const d = (n: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + n));
  const levels = await db.stockLevel.findMany({
    where: { onHand: { gt: 0 }, offer: { vendor: { type: { in: ["DISTRIBUTOR", "WHOLESALER"] }, status: "APPROVED" } } },
    include: { offer: { select: { id: true, vendorSku: true, vendorCompanyId: true, packaging: { select: { unitsPerPack: true } }, prices: { where: { minQty: 1, priceList: { scope: "BASE", isActive: true } }, select: { unitPriceNet: true }, take: 1 } } } },
    orderBy: { id: "asc" },
  });
  let i = 0;
  for (const l of levels) {
    i++;
    const price = l.offer.prices[0]?.unitPriceNet;
    const cost = price ? new Prisma.Decimal(price.toString()).mul(0.78).toDecimalPlaces(4) : new Prisma.Decimal(1);
    const sku = l.offer.vendorSku ?? "";
    const dated = !NO_EXPIRY.test(sku);
    await db.stockLevel.update({ where: { id: l.id }, data: { avgCost: cost } });
    // one batch for everything first (fresh databases have none; migrated ones have an opening batch)
    await db.stockBatch.deleteMany({ where: { offerId: l.offerId, addressId: l.addressId, reserved: 0 } });
    const left = await db.stockBatch.aggregate({ where: { offerId: l.offerId, addressId: l.addressId }, _sum: { onHand: true, reserved: true } });
    const restOnHand = l.onHand - (left._sum.onHand ?? 0);
    const restReserved = Math.max(0, l.reserved - (left._sum.reserved ?? 0));
    if (restOnHand <= 0) continue;
    const free = restOnHand - restReserved;
    const lots: { code: string; qty: number; reserved: number; days: number | null }[] = [];
    let short = 0, expired = 0;
    if (sku === "GRO-MOZZ2" && l.offer.packaging.unitsPerPack === 1) short = Math.min(30, free);
    if (sku === "GRO-KEBAB10") short = Math.min(20, free);
    if (sku === "GRO-RUMCAKE") expired = Math.min(4, free);
    const second = dated ? Math.floor((free - short - expired) * 0.35) : 0;
    const main = restOnHand - second - short - expired;
    lots.push({ code: "A", qty: main, reserved: restReserved, days: dated ? 150 + (i % 60) : null });
    if (second > 0) lots.push({ code: "B", qty: second, reserved: 0, days: 35 + (i % 20) });
    if (short > 0) lots.push({ code: "S", qty: short, reserved: 0, days: sku === "GRO-MOZZ2" ? 6 : 12 });
    if (expired > 0) lots.push({ code: "X", qty: expired, reserved: 0, days: -3 });
    for (const lot of lots) {
      await db.stockBatch.create({
        data: {
          offerId: l.offerId, addressId: l.addressId, lotCode: dated ? `L24-${sku || "LOT"}-${lot.code}` : null, expiresOn: lot.days === null ? null : d(lot.days),
          onHand: lot.qty, reserved: Math.min(lot.reserved, lot.qty), unitCost: cost, source: "OPENING", receivedAt: d(lot.code === "A" ? -40 : lot.code === "B" ? -12 : -20),
        },
      });
    }
  }

  // Lisboa Central: reorder points, its own suppliers, purchase orders
  const lx = await db.company.findFirst({ where: { email: "owner@lisboacentral.test" } }) ?? await db.company.findFirst({ where: { tradeName: "Lisboa Central" } });
  const inHouse = await db.company.findFirst({ where: { isInHouse: true } });
  const owner = lx ? await db.membership.findFirst({ where: { companyId: lx.id, isOwner: true } }) : null;
  if (lx && owner) {
    const wh = await db.address.findFirst({ where: { companyId: lx.id, kind: "WAREHOUSE" } });
    const offer = (sku: string, units = 1) => db.vendorOffer.findFirst({ where: { vendorCompanyId: lx.id, vendorSku: sku, packaging: { unitsPerPack: units } } });
    const mozz = await offer("GRO-MOZZ2"), azeite = await offer("GRO-AZEITE75"), kebab = await offer("GRO-KEBAB10");
    if (wh && mozz) await db.stockLevel.updateMany({ where: { offerId: mozz.id, addressId: wh.id }, data: { reorderPoint: 200, reorderQty: 500 } });
    if (wh && azeite) await db.stockLevel.updateMany({ where: { offerId: azeite.id, addressId: wh.id }, data: { reorderPoint: 1200, reorderQty: 600 } });
    if (wh && kebab) await db.stockLevel.updateMany({ where: { offerId: kebab.id, addressId: wh.id }, data: { reorderPoint: 80, reorderQty: 200 } });
    const dairy = await db.purchaseSupplier.upsert({
      where: { ownerCompanyId_name: { ownerCompanyId: lx.id, name: "Lacticínios do Vale, Lda" } }, update: {},
      create: { ownerCompanyId: lx.id, name: "Lacticínios do Vale, Lda", vatNumber: "PT509876543", email: "encomendas@lacticinios-vale.test", phone: "+351 249 000 111", address: "Zona Industrial, 2000-000 Santarém", leadTimeDays: 2 },
    });
    await db.purchaseSupplier.upsert({
      where: { ownerCompanyId_name: { ownerCompanyId: lx.id, name: "Distribuidora Ibérica de Bebidas" } }, update: {},
      create: { ownerCompanyId: lx.id, name: "Distribuidora Ibérica de Bebidas", vatNumber: "ESB12345678", email: "pedidos@iberica-bebidas.test", leadTimeDays: 5 },
    });
    if (wh && mozz && !(await db.purchaseOrder.findFirst({ where: { ownerCompanyId: lx.id } }))) {
      const year = now.getFullYear();
      const n = await db.$queryRaw<{ n: number }[]>`INSERT INTO "Sequence" (name, year, "nextValue") VALUES ('purchase-order', ${year}, 2)
        ON CONFLICT (name, year) DO UPDATE SET "nextValue" = "Sequence"."nextValue" + 1 RETURNING "nextValue" - 1 AS n`;
      const cost = (await db.stockLevel.findFirst({ where: { offerId: mozz.id, addressId: wh.id } }))?.avgCost ?? new Prisma.Decimal(8);
      await db.purchaseOrder.create({
        data: {
          ownerCompanyId: lx.id, number: `PO-${year}-${String(n[0].n).padStart(6, "0")}`, supplierId: dairy.id, addressId: wh.id, status: "SENT", expectedOn: d(3), sentAt: d(-1), createdById: owner.userId,
          notes: "Entrega de manhã, por favor.", lines: { create: [{ offerId: mozz.id, description: "Mozzarella bloco 2kg · Bloco 2kg · GRO-MOZZ2", qty: 500, unitCost: cost }] },
        },
      });
    }
  }
  if (inHouse) {
    await db.purchaseSupplier.upsert({
      where: { ownerCompanyId_name: { ownerCompanyId: inHouse.id, name: "Central de Compras Ibérica" } }, update: {},
      create: { ownerCompanyId: inHouse.id, name: "Central de Compras Ibérica", email: "compras@central-iberica.test", leadTimeDays: 3 },
    });
  }
}
