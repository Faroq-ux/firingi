/**
 * Seed entry point:  pnpm db:seed
 * Reference data + RBAC are always synced; demo accounts are skipped when
 * SEED_DEMO=false (e.g. production).
 */
import { PrismaClient } from "@prisma/client";
import { seedReference } from "./reference";
import { seedRbac } from "./rbac";
import { seedDemo } from "./demo";
import { seedCatalogue } from "./catalogue";

export async function runSeed(db: PrismaClient, opts: { demo?: boolean } = {}) {
  const refs = await seedReference(db);
  const { roleIds } = await seedRbac(db);
  const demo = opts.demo === false ? null : await seedDemo(db, refs, roleIds);
  if (opts.demo !== false) await seedCatalogue(db);
  return { refs, roleIds, demo };
}

// Run only when executed directly (not when imported by tests).
if (process.argv[1]?.includes("prisma/seed")) {
  const db = new PrismaClient();
  const t0 = Date.now();
  runSeed(db, { demo: process.env.SEED_DEMO !== "false" })
    .then(async () => {
      const [countries, perms, roles, companies, users] = await Promise.all([
        db.country.count(), db.permission.count(), db.role.count(), db.company.count(), db.user.count(),
      ]);
      console.log(`✔ Seed done in ${Date.now() - t0} ms — ${countries} countries, ${perms} permissions, ${roles} roles, ${companies} companies, ${users} users`);
    })
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => db.$disconnect());
}
