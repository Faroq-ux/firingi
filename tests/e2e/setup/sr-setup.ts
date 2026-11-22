/**
 * e2e helper (Phase 62): a field sales rep user at Lisboa Central ("add": user + login + membership, no rep yet; and
 * Kebab House's coordinates for the map) and the clean-up ("remove": reps, assignments, visits, rep orders, the user).
 *   npx tsx --require ./tests/e2e/setup/no-server-only.cjs tests/e2e/setup/sr-setup.ts add|remove
 */
import "dotenv/config";
import { hashPassword } from "better-auth/crypto";
import { prisma } from "@/server/db";

const EMAIL = "rep.e2e@lisboacentral.test";

async function main() {
  const lx = await prisma.company.findFirstOrThrow({ where: { memberships: { some: { user: { email: "owner@lisboacentral.test" } } } }, select: { id: true } });
  const kb = await prisma.company.findFirstOrThrow({ where: { memberships: { some: { user: { email: "owner@kebabhouse.test" } } } }, select: { id: true } });
  await prisma.repOrder.deleteMany({ where: { vendorCompanyId: lx.id } });
  await prisma.repVisit.deleteMany({ where: { vendorCompanyId: lx.id } });
  await prisma.repAssignment.deleteMany({ where: { vendorCompanyId: lx.id } });
  await prisma.repOrderPreference.deleteMany({ where: { vendorCompanyId: lx.id } });
  await prisma.order.updateMany({ where: { sellerCompanyId: lx.id, salesRepId: { not: null } }, data: { salesRepId: null } });
  await prisma.salesRep.deleteMany({ where: { vendorCompanyId: lx.id } });
  await prisma.setting.deleteMany({ where: { key: "salesreps.settings" } });
  const old = await prisma.user.findUnique({ where: { email: EMAIL } });
  if (old) {
    await prisma.membership.deleteMany({ where: { userId: old.id } });
    await prisma.user.delete({ where: { id: old.id } }).catch(() => prisma.user.update({ where: { id: old.id }, data: { email: `gone.${Date.now()}@lisboacentral.test` } }));
  }
  if (process.argv[2] === "remove") { console.log(JSON.stringify({ ok: true })); return; }
  const user = await prisma.user.create({ data: { email: EMAIL, name: "Rita Vendas", emailVerified: true, locale: "pt-PT" } });
  const password = await hashPassword(process.env.SEED_PASSWORD ?? "Firingi!2026");
  await prisma.account.create({ data: { userId: user.id, accountId: user.id, providerId: "credential", password } });
  await prisma.membership.create({ data: { userId: user.id, companyId: lx.id, jobTitle: "Sales rep" } });
  // Kebab House's delivery address gets coordinates (if it has none) so the map can draw the visit
  await prisma.address.updateMany({ where: { companyId: kb.id, kind: "DELIVERY", isActive: true, latitude: null }, data: { latitude: "38.736946", longitude: "-9.142685" } });
  console.log(JSON.stringify({ userId: user.id, lx: lx.id, kb: kb.id }));
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
