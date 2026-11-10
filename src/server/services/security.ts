/**
 * Security policy and sessions.
 *   • Two-factor login (authenticator app, via better-auth) can be required for FIRINGI staff
 *     and for company owners. Users who must use it are sent to their Security page first.
 *   • Maximum session length: older sessions are rejected (sign in again).
 *   • Everyone sees and ends their own sessions; Super Admin can sign a user out everywhere.
 */
import { cache } from "react";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "./audit";

const KEY = "security.policy";
export type SecurityPolicy = { requireTwoFactorStaff: boolean; requireTwoFactorOwners: boolean; maxSessionHours: number };
export const DEFAULT_SECURITY: SecurityPolicy = { requireTwoFactorStaff: false, requireTwoFactorOwners: false, maxSessionHours: 12 };

export const securityPolicy = cache(async (): Promise<SecurityPolicy> => {
  const s = await prisma.setting.findUnique({ where: { scope_scopeId_key: { scope: "GLOBAL", scopeId: "", key: KEY } } });
  return { ...DEFAULT_SECURITY, ...((s?.value as Partial<SecurityPolicy>) ?? {}) };
});

export async function setSecurityPolicy(ctx: Ctx, input: SecurityPolicy) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, "admin.settings.manage")) throw new ForbiddenError();
  const h = Number(input.maxSessionHours);
  if (!Number.isInteger(h) || h < 1 || h > 168) throw new ValidationError("Session length must be 1–168 hours.");
  // Don't lock yourself out: turn it on for yourself first.
  if (input.requireTwoFactorStaff && !ctx.user.twoFactor) throw new ValidationError("Turn on two-factor login for yourself first (your Security page), then require it for staff.");
  const value: SecurityPolicy = { requireTwoFactorStaff: !!input.requireTwoFactorStaff, requireTwoFactorOwners: !!input.requireTwoFactorOwners, maxSessionHours: h };
  const before = await securityPolicy();
  await prisma.setting.upsert({
    where: { scope_scopeId_key: { scope: "GLOBAL", scopeId: "", key: KEY } },
    update: { value, updatedById: ctx.user.id }, create: { scope: "GLOBAL", scopeId: "", key: KEY, value, updatedById: ctx.user.id },
  });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "setting.security_policy", entityType: "Setting", entityId: KEY, before, after: value });
}

/** Must this user turn on two-factor login before using the app? (Drivers excluded: phone app.) */
export async function mustSetUpTwoFactor(ctx: Ctx) {
  if (ctx.user.twoFactor) return false;
  const p = await securityPolicy();
  if (p.requireTwoFactorStaff && ctx.company.type === "ADMIN" && !(ctx.driver && ctx.permissions.size > 0 && [...ctx.permissions].every((x) => x.startsWith("driver.")))) return true;
  return p.requireTwoFactorOwners && ctx.company.type !== "ADMIN" && ctx.membership.isOwner;
}

/** Is this session older than the policy allows? */
export async function sessionTooOld(createdAt: Date) {
  const p = await securityPolicy();
  return Date.now() - createdAt.getTime() > p.maxSessionHours * 3600_000;
}

function device(ua: string | null) {
  if (!ua) return "Unknown device";
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "Other";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  return `${browser} · ${os}`;
}

export async function mySessions(ctx: Ctx) {
  const rows = await prisma.session.findMany({ where: { userId: ctx.user.id, expiresAt: { gt: new Date() } }, orderBy: { updatedAt: "desc" } });
  return rows.map((s) => ({ id: s.id, device: device(s.userAgent), ip: s.ipAddress, createdAt: s.createdAt, lastActive: s.updatedAt, current: s.id === ctx.sessionId }));
}

export async function endSession(ctx: Ctx, sessionId: string) {
  const s = await prisma.session.findFirst({ where: { id: sessionId, userId: ctx.user.id } });
  if (!s) throw new NotFoundError("Session");
  if (s.id === ctx.sessionId) throw new ValidationError("Use Sign out to end this session.");
  await prisma.session.delete({ where: { id: s.id } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "auth.session_ended", entityType: "User", entityId: ctx.user.id, after: { sessionId } });
}

export async function endOtherSessions(ctx: Ctx) {
  const r = await prisma.session.deleteMany({ where: { userId: ctx.user.id, id: { not: ctx.sessionId } } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "auth.sessions_ended", entityType: "User", entityId: ctx.user.id, after: { count: r.count } });
  return r.count;
}

/** FIRINGI staff and company owners with their two-factor status (Security settings page). */
export async function securityOverview(ctx: Ctx) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, ["admin.settings.view", "admin.settings.manage"])) throw new ForbiddenError();
  const now = new Date();
  const users = await prisma.user.findMany({
    where: { status: "ACTIVE", memberships: { some: { status: "ACTIVE", OR: [{ company: { type: "ADMIN" } }, { isOwner: true }] } } },
    select: {
      id: true, name: true, email: true, twoFactorEnabled: true, lastLoginAt: true,
      driver: { select: { id: true } },
      memberships: { where: { status: "ACTIVE" }, select: { isOwner: true, company: { select: { type: true, legalName: true, tradeName: true } } } },
      _count: { select: { sessions: { where: { expiresAt: { gt: now } } } } },
    },
    orderBy: { name: "asc" },
  });
  return users.map((u) => {
    const staff = u.memberships.some((m) => m.company.type === "ADMIN");
    return {
      id: u.id, name: u.name, email: u.email, twoFactor: !!u.twoFactorEnabled, lastLoginAt: u.lastLoginAt, sessions: u._count.sessions, driver: !!u.driver,
      group: staff ? "FIRINGI staff" : "Company owner",
      companies: u.memberships.map((m) => m.company.tradeName ?? m.company.legalName).join(", "),
    };
  });
}

/** Super Admin: end every session of a user (lost phone, leaver …). */
export async function signOutEverywhere(ctx: Ctx, userId: string) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, ["admin.settings.manage", "admin.users.manage"])) throw new ForbiddenError();
  const r = await prisma.session.deleteMany({ where: { userId, ...(userId === ctx.user.id ? { id: { not: ctx.sessionId } } : {}) } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "auth.signed_out_everywhere", entityType: "User", entityId: userId, after: { count: r.count } });
  return r.count;
}

/** Super Admin: turn off a user's two-factor login (lost phone and backup codes). */
export async function resetTwoFactor(ctx: Ctx, userId: string) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, "admin.settings.manage")) throw new ForbiddenError();
  if (userId === ctx.user.id) throw new ValidationError("You can't reset your own two-factor login.");
  await prisma.$transaction([
    prisma.twoFactor.deleteMany({ where: { userId } }),
    prisma.user.update({ where: { id: userId }, data: { twoFactorEnabled: false } }),
    prisma.session.deleteMany({ where: { userId } }),
  ]);
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "auth.two_factor_reset", entityType: "User", entityId: userId });
}
