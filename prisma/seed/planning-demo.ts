/**
 * Demo data for demand planning (dev / demo databases only — never the test database).
 * Distribuidora Atlântico's Armazém Maia gets realistic stock on four products so Planning has
 * something to suggest, three outside suppliers with past purchase orders (so lead times are
 * measured), a short-dated mozzarella lot (expiry risk), the supplier's own winter kebab promotion
 * (a demand event) and the kebab's planning choices. Runs once (skips when the suppliers exist).
 *   pnpm db:demo-planning
 */
import { Prisma, PrismaClient } from "@prisma/client";
import { receive, setOnHand } from "../../src/server/inventory/ledger";

const DAY = 86_400_000;
const day0 = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); };

export async function seedPlanningDemo(db: PrismaClient) {
  const co = await db.company.findFirst({ where: { legalName: "Distribuidora Atlântico, Lda" }, select: { id: true } });
  if (!co) return console.log("Distribuidora Atlântico not found — run the main seed first.");
  if (await db.purchaseSupplier.findFirst({ where: { ownerCompanyId: co.id, name: "Frigoríficos do Norte, Lda" } })) return console.log("planning demo already loaded");
  const owner = await db.user.findFirstOrThrow({ where: { email: "owner@atlantico.test" }, select: { id: true } });
  const wh = await db.address.findFirstOrThrow({ where: { companyId: co.id, kind: "WAREHOUSE", label: "Armazém Maia" }, select: { id: true } });
  const offer = async (sku: string) => (await db.vendorOffer.findFirstOrThrow({ where: { vendorCompanyId: co.id, vendorSku: sku }, select: { id: true } })).id;
  const [kebab, flour, rice, box, mozz] = await Promise.all(["DIS-KEBAB10", "DIS-FARINHA25", "DIS-ARROZ1", "DIS-PIZZABOX33", "DIS-MOZZ2"].map(offer));

  // outside suppliers: stated lead time vs. what really happened
  const mk = (name: string, leadTimeDays: number, vat: string) => db.purchaseSupplier.create({ data: { ownerCompanyId: co.id, name, leadTimeDays, vatNumber: vat, email: `encomendas@${name.split(" ")[0].toLowerCase().normalize("NFD").replace(/[^a-z]/g, "")}.example`, phone: "+351 220 000 000" } });
  const frio = await mk("Frigoríficos do Norte, Lda", 5, "PT509000011");
  const moagem = await mk("Moagem Ribeiro, S.A.", 4, "PT509000029");
  const arroz = await mk("Arrozeira do Vale, Lda", 10, "PT509000037");
  const now = day0();
  let n = (await db.purchaseOrder.count()) + 1;
  const pastPo = async (supplierId: string, offerId: string, qty: number, cost: number, sentDaysAgo: number, tookDays: number, promisedDays: number) => {
    const sentAt = new Date(now.getTime() - sentDaysAgo * DAY + 9 * 3600_000);
    const receivedAt = new Date(sentAt.getTime() + tookDays * DAY);
    await db.purchaseOrder.create({
      data: {
        ownerCompanyId: co.id, number: `PO-DEMO-${String(n++).padStart(5, "0")}`, supplierId, addressId: wh.id, status: "RECEIVED", sentAt, receivedAt,
        expectedOn: new Date(sentAt.getTime() + promisedDays * DAY), createdById: owner.id, createdAt: sentAt, notes: "Demo history",
        lines: { create: [{ offerId, description: "Demo", qty, receivedQty: qty, unitCost: new Prisma.Decimal(cost) }] },
        receipts: { create: [{ at: receivedAt, byUserId: owner.id, note: "Demo history" }] },
      },
    });
  };
  // the cold-chain supplier promises 5 days but takes 6–9: measured lead time ≈ 7, half on time
  for (const [ago, took] of [[70, 6], [56, 9], [42, 5], [28, 7], [14, 8]] as const) await pastPo(frio.id, kebab, 120, 41, ago, took, 5);
  for (const [ago, took] of [[63, 4], [35, 3], [21, 4]] as const) await pastPo(moagem.id, flour, 40, 12.1, ago, took, 4);
  for (const [ago, took] of [[60, 11], [30, 12]] as const) await pastPo(arroz.id, rice, 60, 6.4, ago, took, 10);

  // stock as it would be in a real warehouse (the main seed starts every product at 1000)
  await db.$transaction(async (tx) => {
    for (const [offerId, qty] of [[kebab, 30], [flour, 0], [rice, 16], [box, 22]] as const) await setOnHand(tx, { offerId, addressId: wh.id, onHand: qty, byUserId: owner.id, note: "Demo: realistic stock for planning" });
    // a short-dated mozzarella lot that won't sell in time
    await receive(tx, { offerId: mozz, addressId: wh.id, qty: 40, unitCost: 52, lotCode: "MZ-2611-DEMO", expiresOn: new Date(now.getTime() + 6 * DAY), source: "RECEIPT", type: "RECEIPT", byUserId: owner.id, note: "Demo: short-dated lot" });
  }, { timeout: 60_000 });

  // how the kebab is bought, and the supplier's own promotion
  await db.planningItem.upsert({
    where: { offerId_addressId: { offerId: kebab, addressId: wh.id } },
    create: { offerId: kebab, addressId: wh.id, supplierId: frio.id, unitCost: 41, minOrderQty: 20, packMultiple: 10, note: "Pallet of 10 cones", updatedById: owner.id },
    update: {},
  });
  await db.planningItem.upsert({ where: { offerId_addressId: { offerId: flour, addressId: wh.id } }, create: { offerId: flour, addressId: wh.id, supplierId: moagem.id, unitCost: 12.1, minOrderQty: 20, updatedById: owner.id }, update: {} });
  await db.planningItem.upsert({ where: { offerId_addressId: { offerId: rice, addressId: wh.id } }, create: { offerId: rice, addressId: wh.id, supplierId: arroz.id, unitCost: 6.4, packMultiple: 12, updatedById: owner.id }, update: {} });
  await db.planningEvent.create({ data: { companyId: co.id, name: "Campanha kebab de inverno", startsOn: now, endsOn: new Date(now.getTime() + 20 * DAY), upliftPct: 30, offerIds: [kebab], createdById: owner.id } });
  console.log("planning demo loaded for Distribuidora Atlântico (Armazém Maia)");
}

if (require.main === module) {
  const db = new PrismaClient();
  seedPlanningDemo(db).then(() => db.$disconnect()).catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1); });
}
