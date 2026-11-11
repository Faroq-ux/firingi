/**
 * FIRINGI's own error log: server errors (instrumentation onRequestError) and browser errors
 * (/api/client-errors). Throttled so an error storm can't flood the database; grouped by a
 * fingerprint (same message + place). Sentry gets them too when SENTRY_DSN is set.
 */
import "server-only";
import { createHash } from "node:crypto";
import { prisma } from "@/server/db";

let windowStart = 0, inWindow = 0;
const recent = new Map<string, number>();
const MAX_PER_MINUTE = 60;

export function fingerprintOf(source: string, message: string, stack?: string | null) {
  const firstFrame = (stack ?? "").split("\n").find((l) => /\bat\b/.test(l))?.replace(/:\d+:\d+\)?$/, "").trim() ?? "";
  return createHash("sha1").update(`${source}|${message.split("\n")[0].slice(0, 300)}|${firstFrame}`).digest("hex").slice(0, 16);
}

/** Store an error (best effort — never throws). Returns false when throttled. */
export async function recordError(e: { source: "server" | "browser"; message: string; stack?: string | null; path?: string | null; digest?: string | null; userAgent?: string | null }) {
  try {
    const now = Date.now();
    if (now - windowStart > 60_000) { windowStart = now; inWindow = 0; }
    if (++inWindow > MAX_PER_MINUTE) return false;
    const fingerprint = fingerprintOf(e.source, e.message, e.stack);
    const seen = recent.get(fingerprint);
    if (seen && now - seen < 5_000) return false; // the same error in a burst: keep one
    recent.set(fingerprint, now);
    if (recent.size > 500) recent.clear();
    await prisma.errorEvent.create({
      data: {
        source: e.source, message: e.message.slice(0, 1000), stack: e.stack?.slice(0, 6000) ?? null, path: e.path?.slice(0, 500) ?? null,
        digest: e.digest?.slice(0, 100) ?? null, fingerprint, userAgent: e.userAgent?.slice(0, 300) ?? null,
      },
    });
    return true;
  } catch {
    return false;
  }
}

/** Grouped errors of the last `hours` for the System Health page. */
export async function errorGroups(hours = 24) {
  const since = new Date(Date.now() - hours * 3600_000);
  const rows = await prisma.$queryRaw<{ fingerprint: string; source: string; message: string; path: string | null; n: number; last: Date }[]>`
    SELECT fingerprint, max(source) AS source, max(message) AS message, max(path) AS path, count(*)::int AS n, max(at) AS last
    FROM "ErrorEvent" WHERE at > ${since} GROUP BY fingerprint ORDER BY max(at) DESC LIMIT 50`;
  return rows;
}

export async function errorCount(minutes: number, source?: "server" | "browser") {
  return prisma.errorEvent.count({ where: { at: { gt: new Date(Date.now() - minutes * 60_000) }, ...(source ? { source } : {}) } });
}
