/**
 * First production start (no demo data): reference data + roles, then FIRINGI's own company and
 * the first super admin — only if no super admin exists yet. Safe to run again.
 *   docker compose -f docker-compose.prod.yml run --rm migrate pnpm tsx prisma/seed/bootstrap.ts
 * Needs ADMIN_EMAIL, ADMIN_NAME, ADMIN_PASSWORD (12+ characters), COMPANY_LEGAL_NAME, COMPANY_TAX_ID;
 * COMPANY_COUNTRY defaults to PT.
 */
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "better-auth/crypto";
import { runSeed } from "./index";

async function main() {
  const db = new PrismaClient();
  try {
    const { refs, roleIds } = await runSeed(db, { demo: false });
    const existing = await db.membership.count({ where: { status: "ACTIVE", company: { type: "ADMIN" }, roles: { some: { role: { key: "SUPER_ADMIN" } } } } });
    if (existing) { console.log(`✔ Reference data synced; ${existing} super admin(s) already exist — nothing else to do.`); return; }
    const need = (k: string) => { const v = process.env[k]?.trim(); if (!v) throw new Error(`Set ${k}`); return v; };
    const email = need("ADMIN_EMAIL").toLowerCase(), name = need("ADMIN_NAME"), pw = need("ADMIN_PASSWORD");
    if (pw.length < 12) throw new Error("ADMIN_PASSWORD must have at least 12 characters");
    const country = (process.env.COMPANY_COUNTRY ?? "PT").toUpperCase();
    const countryId = refs.countryIds[country];
    if (!countryId) throw new Error(`Unknown or non-Schengen country ${country}`);
    const company = await db.company.upsert({
      where: { countryId_taxId: { countryId, taxId: need("COMPANY_TAX_ID") } },
      update: {},
      create: { type: "ADMIN", status: "APPROVED", approvedAt: new Date(), countryId, taxId: need("COMPANY_TAX_ID"), legalName: need("COMPANY_LEGAL_NAME"), tradeName: "FIRINGI", email },
    });
    const user = await db.user.upsert({ where: { email }, update: { name, status: "ACTIVE" }, create: { email, name, emailVerified: true } });
    const password = await hashPassword(pw);
    const acct = await db.account.findFirst({ where: { userId: user.id, providerId: "credential" } });
    if (acct) await db.account.update({ where: { id: acct.id }, data: { password } });
    else await db.account.create({ data: { userId: user.id, accountId: user.id, providerId: "credential", password } });
    const m = await db.membership.upsert({
      where: { userId_companyId: { userId: user.id, companyId: company.id } },
      update: { status: "ACTIVE", isOwner: true },
      create: { userId: user.id, companyId: company.id, isOwner: true },
    });
    await db.membershipRole.upsert({ where: { membershipId_roleId: { membershipId: m.id, roleId: roleIds.SUPER_ADMIN } }, update: {}, create: { membershipId: m.id, roleId: roleIds.SUPER_ADMIN } });
    console.log(`✔ Created FIRINGI (${country}) and super admin ${email}. Sign in, turn on two-factor sign-in, then add your team under Users.`);
  } finally {
    await db.$disconnect();
  }
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; });
