/**
 * Rebuilds the dedicated TEST database once per run: wipes its schema, applies all
 * migrations (incl. integrity triggers) and loads reference data + RBAC + demo accounts.
 * Refuses to run unless the URL's database name contains "test".
 */
import "dotenv/config";
import { execSync } from "node:child_process";

export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/firingi_test";
  const dbName = new URL(url).pathname.slice(1);
  if (!dbName.includes("test")) throw new Error(`Refusing to wipe "${dbName}": TEST_DATABASE_URL must point to a *test* database`);

  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient({ datasourceUrl: url });
  await db.$executeRawUnsafe("DROP SCHEMA IF EXISTS public CASCADE");
  await db.$executeRawUnsafe("CREATE SCHEMA public");
  execSync("npx prisma migrate deploy", { stdio: "ignore", env: { ...process.env, DATABASE_URL: url } });

  process.env.DATABASE_URL = url;
  const { runSeed } = await import("../prisma/seed/index");
  await runSeed(db);
  // Tests place and cancel many orders within minutes; FIRINGI's risk checks would (rightly) start
  // holding them. They are off in the test database — the risk tests switch them on themselves.
  await db.setting.create({ data: { scope: "GLOBAL", key: "risk.rules", value: { enabled: false } } });
  await db.$disconnect();
}
