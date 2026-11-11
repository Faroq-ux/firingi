/**
 * System health: database, file storage, scheduled jobs, backups, queues, errors, disk and
 * database size, configuration. Used by /api/health (uptime checks), the status page, the
 * System Health page and the alert checks.
 */
import "server-only";
import { statfs } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/server/db";
import { storageHealth } from "@/server/services/storage";
import { checkEnv, strictEnv } from "@/server/env";
import { jobStatus } from "./jobs";
import { errorCount } from "./errors";

export type CheckState = "ok" | "warning" | "critical";
export type Check = { key: string; label: string; state: CheckState; detail: string };

export const VERSION = { version: process.env.npm_package_version ?? "1.0.0", commit: (process.env.GIT_COMMIT ?? "dev").slice(0, 12), startedAt: new Date().toISOString() };

/** Fast liveness: can we talk to the database? (used by /api/health and the container healthcheck) */
export async function liveness() {
  const t0 = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, dbMs: Date.now() - t0 };
  } catch (e) {
    return { ok: false, dbMs: Date.now() - t0, error: e instanceof Error ? e.message.split("\n")[0] : String(e) };
  }
}

async function diskCheck(): Promise<Check> {
  try {
    const dir = process.env.STORAGE_DRIVER === "s3" ? process.cwd() : path.resolve(process.env.STORAGE_DIR ?? "./storage");
    const s = await statfs(dir).catch(() => statfs(process.cwd()));
    const free = (s.bavail * s.bsize) / (s.blocks * s.bsize);
    const freeGb = (s.bavail * s.bsize) / 1024 ** 3;
    return { key: "disk", label: "Disk space", state: free < 0.05 ? "critical" : free < 0.1 ? "warning" : "ok", detail: `${(free * 100).toFixed(0)} % free (${freeGb.toFixed(1)} GB)` };
  } catch (e) {
    return { key: "disk", label: "Disk space", state: "warning", detail: `Couldn't read: ${e instanceof Error ? e.message : String(e)}` };
  }
}

async function dbSizeCheck(): Promise<Check> {
  const [{ bytes }] = await prisma.$queryRaw<{ bytes: bigint }[]>`SELECT pg_database_size(current_database()) AS bytes`;
  const gb = Number(bytes) / 1024 ** 3;
  const warnGb = Number(process.env.DB_SIZE_WARN_GB ?? 20);
  return { key: "db-size", label: "Database size", state: gb > warnGb ? "warning" : "ok", detail: `${gb.toFixed(2)} GB (warning above ${warnGb} GB)` };
}

export async function healthReport(now = new Date()) {
  const live = await liveness();
  if (!live.ok) return { status: "critical" as CheckState, checks: [{ key: "db", label: "Database", state: "critical", detail: live.error ?? "unreachable" } as Check], jobs: [], version: VERSION, at: now.toISOString() };
  const production = strictEnv();
  const [storage, jobs, errors15, errors24, msgFailed, msgStuck, fiscalFailed, fiscalStuck, disk, dbSize, failedMigrations] = await Promise.all([
    storageHealth(), jobStatus(now), errorCount(15, "server"), errorCount(24 * 60),
    prisma.notificationMessage.count({ where: { status: "FAILED", createdAt: { gt: new Date(now.getTime() - 3600_000) } } }),
    prisma.notificationMessage.count({ where: { status: "QUEUED", createdAt: { lt: new Date(now.getTime() - 30 * 60_000) }, OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lt: now } }] } }),
    prisma.invoice.count({ where: { fiscalStatus: "FAILED" } }),
    prisma.invoice.count({ where: { fiscalStatus: "PENDING", issuedAt: { lt: new Date(now.getTime() - 3600_000) } } }),
    diskCheck(), dbSizeCheck(),
    prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM "_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL`.then((r) => r[0]?.n ?? 0).catch(() => 0),
  ]);
  const errorWarn = Number(process.env.ALERT_ERRORS_15MIN ?? 20);
  const checks: Check[] = [
    { key: "db", label: "Database", state: live.dbMs > 1000 ? "warning" : "ok", detail: `answers in ${live.dbMs} ms` },
    { key: "migrations", label: "Database migrations", state: failedMigrations ? "critical" : "ok", detail: failedMigrations ? `${failedMigrations} migration(s) did not finish` : "all applied" },
    { key: "storage", label: "File storage", state: storage.ok ? "ok" : "critical", detail: `${storage.driver}: ${storage.detail}` },
    disk, dbSize,
    { key: "errors", label: "Server errors (15 min)", state: errors15 >= errorWarn * 5 ? "critical" : errors15 >= errorWarn ? "warning" : "ok", detail: `${errors15} in 15 min · ${errors24} in 24 h (incl. browser)` },
    { key: "messages", label: "Message queue", state: msgStuck > 0 || msgFailed >= 10 ? "warning" : "ok", detail: `${msgStuck} waiting > 30 min · ${msgFailed} failed in the last hour` },
    { key: "fiscal", label: "Certified invoicing queue", state: fiscalStuck > 0 ? "critical" : fiscalFailed > 0 ? "warning" : "ok", detail: `${fiscalFailed} refused · ${fiscalStuck} pending > 1 h` },
  ];
  for (const j of jobs) {
    // A job that never ran: outside production it simply isn't scheduled here; in production it
    // only becomes a problem once the app has been up longer than the job's allowed gap.
    const upMin = (now.getTime() - new Date(VERSION.startedAt).getTime()) / 60_000;
    if (j.state === "never" && (!production || upMin < j.staleAfterMin)) continue;
    const state: CheckState = j.state === "ok" ? "ok" : j.state === "last-failed" ? "warning" : j.critical ? "critical" : "warning";
    checks.push({
      key: `job:${j.key}`, label: `Job: ${j.label}`, state,
      detail: j.state === "never" ? `never ran (expected ${j.every})` : j.state === "failing" ? "the last 3 runs failed" : j.state === "stale" ? `no successful run for ${j.ageMin ?? "?"} min (expected ${j.every})` : j.state === "last-failed" ? "the last run failed" : `last OK ${j.ageMin} min ago`,
    });
  }
  for (const f of checkEnv(process.env)) if (f.level === "error" || production) checks.push({ key: `env:${f.key}`, label: `Setting ${f.key}`, state: f.level === "error" ? (production ? "critical" : "warning") : "warning", detail: f.message });
  const status: CheckState = checks.some((c) => c.state === "critical") ? "critical" : checks.some((c) => c.state === "warning") ? "warning" : "ok";
  return { status, checks, jobs, version: VERSION, at: now.toISOString() };
}
