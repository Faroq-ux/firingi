/**
 * API keys for FIRINGI's JSON API. FIRINGI staff issue a key for a company; it acts as one of
 * that company's users, limited to its scopes AND that user's permissions. The key is shown
 * once; only its SHA-256 hash is stored. Send it as "Authorization: Bearer fk_…".
 */
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import type { PermissionCode } from "@/server/rbac/permissions";
import { writeAudit } from "./audit";

export const SCOPES = {
  "catalogue.read": { label: "Read the catalogue (buyers)", perms: ["buyer.catalogue.view"] },
  "orders.read": { label: "Read orders", perms: ["buyer.orders.view", "buyer.orders.place", "vendor.orders.view", "vendor.orders.manage"] },
} as const satisfies Record<string, { label: string; perms: PermissionCode[] }>;
export type Scope = keyof typeof SCOPES;

const hashOf = (key: string) => createHash("sha256").update(key).digest("hex");
const requireManager = (ctx: Ctx) => { if (ctx.company.type !== "ADMIN" || !can(ctx, "admin.settings.manage")) throw new ForbiddenError(); };

export async function createApiKey(ctx: Ctx, input: { companyId: string; userId: string; name: string; scopes: string[] }) {
  requireManager(ctx);
  const name = input.name.trim();
  if (name.length < 2) throw new ValidationError("Give the key a name (e.g. the system that uses it).");
  const scopes = [...new Set(input.scopes)].filter((s): s is Scope => s in SCOPES);
  if (!scopes.length) throw new ValidationError("Choose at least one scope.");
  const m = await prisma.membership.findFirst({ where: { companyId: input.companyId, userId: input.userId, status: "ACTIVE" }, include: { company: { select: { type: true, status: true } } } });
  if (!m || m.company.type === "ADMIN") throw new ValidationError("Choose an active user of a supplier or buyer company.");
  if (m.company.status !== "APPROVED") throw new ValidationError("The company isn't approved.");
  const key = `fk_live_${randomBytes(24).toString("base64url")}`;
  const row = await prisma.apiKey.create({ data: { companyId: input.companyId, userId: input.userId, name, scopes, prefix: key.slice(0, 12), hash: hashOf(key), createdById: ctx.user.id } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "api_key.created", entityType: "ApiKey", entityId: row.id, after: { companyId: input.companyId, name, scopes } });
  return { id: row.id, key }; // shown once
}

export async function revokeApiKey(ctx: Ctx, id: string) {
  requireManager(ctx);
  const r = await prisma.apiKey.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date() } });
  if (!r.count) throw new NotFoundError("Active key");
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "api_key.revoked", entityType: "ApiKey", entityId: id });
}

export async function listApiKeys(ctx: Ctx) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, ["admin.settings.view", "admin.settings.manage"])) throw new ForbiddenError();
  const keys = await prisma.apiKey.findMany({ include: { company: { select: { legalName: true, tradeName: true, type: true } } }, orderBy: { createdAt: "desc" } });
  const users = new Map((await prisma.user.findMany({ where: { id: { in: keys.map((k) => k.userId) } }, select: { id: true, name: true, email: true } })).map((u) => [u.id, u]));
  return keys.map((k) => ({ ...k, user: users.get(k.userId) ?? null }));
}

/** Companies and users a key can be issued for. */
export async function apiKeyTargets(ctx: Ctx) {
  requireManager(ctx);
  return prisma.company.findMany({
    where: { status: "APPROVED", type: { not: "ADMIN" } },
    select: { id: true, legalName: true, tradeName: true, type: true, memberships: { where: { status: "ACTIVE" }, select: { isOwner: true, user: { select: { id: true, name: true, email: true } } } } },
    orderBy: { legalName: "asc" },
  });
}

/** Resolve "Bearer fk_…" → the key (or null). Updates last use at most once a minute. */
export async function resolveApiKey(authorization: string | null) {
  const m = authorization?.match(/^Bearer\s+(fk_live_[A-Za-z0-9_-]{20,})$/);
  if (!m) return null;
  const k = await prisma.apiKey.findUnique({ where: { hash: hashOf(m[1]) } });
  if (!k || k.revokedAt) return null;
  if (!k.lastUsedAt || Date.now() - k.lastUsedAt.getTime() > 60_000) await prisma.apiKey.update({ where: { id: k.id }, data: { lastUsedAt: new Date() } });
  return k;
}

/** Permissions a key may use: the scopes' permissions that the user also has. */
export function scopePermissions(scopes: string[]) {
  return new Set<PermissionCode>(scopes.flatMap((s) => (s in SCOPES ? [...SCOPES[s as Scope].perms] : [])));
}
