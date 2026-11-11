/**
 * API keys for FIRINGI's JSON API. A company creates its own keys (portal › Integrations — the key
 * acts as the person who created it) or FIRINGI staff issue one for a company user. Either way it
 * is limited to its scopes AND that user's current permissions. The key is shown once; only its
 * SHA-256 hash is stored. Send it as "Authorization: Bearer fk_live_…".
 */
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import type { PermissionCode } from "@/server/rbac/permissions";
import { writeAudit } from "./audit";

export const SCOPES = {
  "catalogue.read": { label: "Read the catalogue (buyers)", for: "BUYER", perms: ["buyer.catalogue.view"] },
  "orders.read": { label: "Read orders", for: "BOTH", perms: ["buyer.orders.view", "buyer.orders.place", "vendor.orders.view", "vendor.orders.manage"] },
  "orders.write": { label: "Place orders (buyers) · confirm and update orders (suppliers)", for: "BOTH", perms: ["buyer.orders.place", "buyer.orders.view", "buyer.catalogue.view", "vendor.orders.view", "vendor.orders.manage"] },
  "offers.write": { label: "Read and update own offers: price, stock, minimums (suppliers)", for: "SUPPLIER", perms: ["vendor.products.view", "vendor.products.manage", "vendor.pricing.manage", "vendor.stock.manage"] },
  "invoices.read": { label: "Read invoices and statements", for: "BOTH", perms: ["buyer.invoices.view", "buyer.payments.view", "vendor.invoices.view", "vendor.payments.view"] },
} as const satisfies Record<string, { label: string; for: "BUYER" | "SUPPLIER" | "BOTH"; perms: PermissionCode[] }>;
export type Scope = keyof typeof SCOPES;

/** Scopes a company of this type may use. */
export function scopesFor(type: string): Scope[] {
  const supplier = type === "DISTRIBUTOR" || type === "WHOLESALER", buyer = type === "CUSTOMER" || type === "WHOLESALER";
  return (Object.keys(SCOPES) as Scope[]).filter((s) => { const f = SCOPES[s].for; return f === "BOTH" || (f === "SUPPLIER" && supplier) || (f === "BUYER" && buyer); });
}

const hashOf = (key: string) => createHash("sha256").update(key).digest("hex");
const requireManager = (ctx: Ctx) => { if (ctx.company.type !== "ADMIN" || !can(ctx, "admin.settings.manage")) throw new ForbiddenError(); };

export async function createApiKey(ctx: Ctx, input: { companyId: string; userId: string; name: string; scopes: string[] }) {
  requireManager(ctx);
  const name = input.name.trim();
  if (name.length < 2) throw new ValidationError("Give the key a name (e.g. the system that uses it).");
  const m = await prisma.membership.findFirst({ where: { companyId: input.companyId, userId: input.userId, status: "ACTIVE" }, include: { company: { select: { type: true, status: true } } } });
  if (!m || m.company.type === "ADMIN") throw new ValidationError("Choose an active user of a supplier or buyer company.");
  const scopes = [...new Set(input.scopes)].filter((s): s is Scope => scopesFor(m.company.type).includes(s as Scope));
  if (!scopes.length) throw new ValidationError("Choose at least one scope.");
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

// ── self-service (company portal › Integrations) ──────────────────────────

const MAX_OWN_KEYS = 10;
function requireOwn(ctx: Ctx) {
  if (ctx.company.type === "ADMIN" || ctx.company.status !== "APPROVED" || !can(ctx, "company.integrations.manage")) throw new ForbiddenError();
}

/** A key for the company's own system; it acts as the person creating it. */
export async function createOwnApiKey(ctx: Ctx, input: { name: string; scopes: string[] }) {
  requireOwn(ctx);
  const name = input.name.trim();
  if (name.length < 2 || name.length > 80) throw new ValidationError("Give the key a name (e.g. the system that uses it).");
  const scopes = [...new Set(input.scopes)].filter((s): s is Scope => scopesFor(ctx.company.type).includes(s as Scope));
  if (!scopes.length) throw new ValidationError("Choose at least one permission.");
  if ((await prisma.apiKey.count({ where: { companyId: ctx.company.id, revokedAt: null } })) >= MAX_OWN_KEYS) throw new ValidationError(`At most ${MAX_OWN_KEYS} active keys — revoke one you no longer use.`);
  const key = `fk_live_${randomBytes(24).toString("base64url")}`;
  const row = await prisma.apiKey.create({ data: { companyId: ctx.company.id, userId: ctx.user.id, name, scopes, prefix: key.slice(0, 12), hash: hashOf(key), createdById: ctx.user.id, selfService: true } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "api_key.created", entityType: "ApiKey", entityId: row.id, after: { name, scopes, selfService: true } });
  return { id: row.id, key }; // shown once
}

export async function revokeOwnApiKey(ctx: Ctx, id: string) {
  requireOwn(ctx);
  const r = await prisma.apiKey.updateMany({ where: { id, companyId: ctx.company.id, revokedAt: null }, data: { revokedAt: new Date() } });
  if (!r.count) throw new NotFoundError("Active key");
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "api_key.revoked", entityType: "ApiKey", entityId: id });
}

/** The company's keys with their use in the last 7 days and the latest calls. */
export async function listOwnApiKeys(ctx: Ctx) {
  requireOwn(ctx);
  const keys = await prisma.apiKey.findMany({ where: { companyId: ctx.company.id }, orderBy: [{ revokedAt: { sort: "desc", nulls: "first" } }, { createdAt: "desc" }], omit: { hash: true } });
  const since = new Date(Date.now() - 7 * 86400_000);
  const ids = keys.map((k) => k.id);
  const [counts, errors, recent] = await Promise.all([
    prisma.apiCallLog.groupBy({ by: ["apiKeyId"], where: { apiKeyId: { in: ids }, at: { gte: since } }, _count: true }),
    prisma.apiCallLog.groupBy({ by: ["apiKeyId"], where: { apiKeyId: { in: ids }, at: { gte: since }, status: { gte: 400 } }, _count: true }),
    prisma.apiCallLog.findMany({ where: { apiKeyId: { in: ids } }, orderBy: { at: "desc" }, take: 30 }),
  ]);
  const users = new Map((await prisma.user.findMany({ where: { id: { in: keys.map((k) => k.userId) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const c = new Map(counts.map((x) => [x.apiKeyId, x._count])), e = new Map(errors.map((x) => [x.apiKeyId, x._count]));
  return {
    keys: keys.map((k) => ({ ...k, actsAs: users.get(k.userId) ?? "?", calls7d: c.get(k.id) ?? 0, errors7d: e.get(k.id) ?? 0 })),
    recent: recent.map((r) => ({ ...r, keyName: keys.find((k) => k.id === r.apiKeyId)?.name ?? "?" })),
    scopes: scopesFor(ctx.company.type).map((s) => ({ key: s, label: SCOPES[s].label })),
  };
}
