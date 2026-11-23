/**
 * e2e helper (Phase 63): a van seller at Lisboa Central with the "Van Seller" role ("add"; no van yet, rice stock in the
 * warehouse) and the clean-up ("remove": open vans cancelled, FIRINGI's van settings back to default, the user).
 *   npx tsx --require ./tests/e2e/setup/no-server-only.cjs tests/e2e/setup/vs-setup.ts add|remove
 */
import "dotenv/config";
import { hashPassword } from "better-auth/crypto";
import { prisma } from "@/server/db";

const EMAIL = "van.e2e@lisboacentral.test";

async function main() {
  const lx = await prisma.company.findFirstOrThrow({ where: { memberships: { some: { user: { email: "owner@lisboacentral.test" } } } }, select: { id: true } });
  const kb = await prisma.company.findFirstOrThrow({ where: { memberships: { some: { user: { email: "owner@kebabhouse.test" } } } }, select: { id: true } });
  await prisma.vanLoad.updateMany({ where: { vendorCompanyId: lx.id, status: { in: ["OPEN", "ON_ROAD"] } }, data: { status: "CANCELLED" } });
  await prisma.setting.deleteMany({ where: { key: "vansales.settings" } });
  const old = await prisma.user.findUnique({ where: { email: EMAIL } });
  if (old) {
    await prisma.membership.deleteMany({ where: { userId: old.id } });
    await prisma.user.delete({ where: { id: old.id } }).catch(() => prisma.user.update({ where: { id: old.id }, data: { email: `gone.${Date.now()}@lisboacentral.test` } }));
  }
  if (process.argv[2] === "remove") { console.log(JSON.stringify({ ok: true })); return; }
  const user = await prisma.user.create({ data: { email: EMAIL, name: "Vasco Carrinha", emailVerified: true, locale: "pt-PT" } });
  const password = await hashPassword(process.env.SEED_PASSWORD ?? "Firingi!2026");
  await prisma.account.create({ data: { userId: user.id, accountId: user.id, providerId: "credential", password } });
  const m = await prisma.membership.create({ data: { userId: user.id, companyId: lx.id, jobTitle: "Van seller" } });
  const role = await prisma.role.findFirstOrThrow({ where: { companyId: null, key: "VENDOR_VAN" } });
  await prisma.membershipRole.create({ data: { membershipId: m.id, roleId: role.id } });
  // enough rice in the first warehouse to load the van
  const wh = await prisma.address.findFirstOrThrow({ where: { companyId: lx.id, kind: "WAREHOUSE", isActive: true }, orderBy: { createdAt: "asc" } });
  const rice = await prisma.vendorOffer.findFirstOrThrow({ where: { vendorCompanyId: lx.id, vendorSku: "GRO-ARROZ1", status: "ACTIVE" }, orderBy: { createdAt: "asc" } });
  const lvl = await prisma.stockLevel.findUnique({ where: { offerId_addressId: { offerId: rice.id, addressId: wh.id } } });
  if (!lvl || lvl.onHand - lvl.reserved < 100) {
    const { receive } = await import("@/server/inventory/ledger");
    await prisma.$transaction((tx) => receive(tx, { offerId: rice.id, addressId: wh.id, qty: 200, unitCost: null, source: "OPENING", type: "ADJUSTMENT", note: "e2e van stock" }));
  }
  console.log(JSON.stringify({ userId: user.id, lx: lx.id, kb: kb.id, rice: rice.id, wh: wh.id }));
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
