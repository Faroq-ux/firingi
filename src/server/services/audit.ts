/**
 * Audit log writer. The AuditLog table is append-only (DB trigger).
 * Call it for every important action — inside the same transaction when possible.
 */
import type { Prisma } from "@prisma/client";
import { prisma, type Tx } from "@/server/db";

export type AuditEntry = {
  actorUserId?: string | null;
  actorCompanyId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  meta?: unknown;
  ip?: string | null;
  userAgent?: string | null;
};

const json = (v: unknown) => (v === undefined ? undefined : (JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue));

async function requestInfo(): Promise<{ ip: string | null; userAgent: string | null }> {
  try {
    const { headers } = await import("next/headers");
    const h = await headers();
    return {
      ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null,
      userAgent: h.get("user-agent"),
    };
  } catch {
    return { ip: null, userAgent: null }; // outside a request (seed, tests, jobs)
  }
}

export async function writeAudit(entry: AuditEntry, tx: Tx = prisma) {
  const info = entry.ip !== undefined || entry.userAgent !== undefined ? { ip: entry.ip ?? null, userAgent: entry.userAgent ?? null } : await requestInfo();
  await tx.auditLog.create({
    data: {
      actorUserId: entry.actorUserId ?? null,
      actorCompanyId: entry.actorCompanyId ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      before: json(entry.before),
      after: json(entry.after),
      meta: json(entry.meta),
      ip: info.ip,
      userAgent: info.userAgent,
    },
  });
}
