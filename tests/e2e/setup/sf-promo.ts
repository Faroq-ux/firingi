/**
 * e2e helper (Phase 61): Lisboa Central's public offers for the storefront test — "add" creates a 10 % offer on one
 * product, a buy-6-get-1 and free delivery from 150 €; "remove" deletes them. Prints JSON { ids }.
 *   npx tsx --require ./tests/e2e/setup/no-server-only.cjs tests/e2e/setup/sf-promo.ts add|remove
 */
import "dotenv/config";
import { prisma } from "@/server/db";

async function main() {
  const lx = await prisma.company.findFirstOrThrow({ where: { memberships: { some: { user: { email: "owner@lisboacentral.test" } } } }, select: { id: true } });
  await prisma.promotion.deleteMany({ where: { ownerCompanyId: lx.id, name: { path: ["en"], string_starts_with: "E2E storefront" } } });
  if (process.argv[2] === "remove") { console.log(JSON.stringify({ ids: [] })); return; }
  const offers = await prisma.vendorOffer.findMany({ where: { vendorCompanyId: lx.id, status: "ACTIVE" }, orderBy: { createdAt: "asc" }, take: 3, select: { id: true } });
  const since = new Date(Date.now() - 86400_000), until = new Date(Date.now() + 14 * 86400_000);
  const base = { ownerType: "VENDOR" as const, ownerCompanyId: lx.id, status: "ACTIVE" as const, validFrom: since, validTo: until };
  const a = await prisma.promotion.create({ data: { ...base, name: { en: "E2E storefront — weekly special", pt: "Especial da semana" }, kind: "PERCENT", value: 10, targets: { create: [{ offerId: offers[0].id }] } } });
  const b = await prisma.promotion.create({ data: { ...base, name: { en: "E2E storefront — buy 6 get 1", pt: "Leve 7, pague 6" }, kind: "BUY_X_GET_Y", value: 1, buyQty: 6, freeQty: 1, targets: { create: [{ offerId: offers[1].id }] } } });
  const c = await prisma.promotion.create({ data: { ...base, name: { en: "E2E storefront — free delivery", pt: "Entrega grátis" }, kind: "FREE_DELIVERY", value: 1, minOrderValue: 150, targets: { create: [{ vendorCompanyId: lx.id }] } } });
  console.log(JSON.stringify({ ids: [a.id, b.id, c.id], offers: offers.map((o) => o.id) }));
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
