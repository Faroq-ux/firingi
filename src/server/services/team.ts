/**
 * Team & role management — shared by FIRINGI admin (own staff) and by every vendor /
 * customer company (own employees). A company can only ever touch its own users/roles.
 *
 * Security rules enforced here:
 *  1. Tenant isolation — every query is scoped to ctx.company.id.
 *  2. Grantable set — roles may only contain permissions the company TYPE may hold.
 *  3. No privilege escalation — a non-owner can only grant permissions they hold.
 *  4. Owners cannot be disabled or demoted by other members; you cannot disable yourself.
 */
import type { MembershipStatus } from "@prisma/client";
import { hashPassword } from "better-auth/crypto";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { grantablePermissions, isPermissionCode, type PermissionCode } from "@/server/rbac/permissions";
import { SYSTEM_ROLES, expandRolePermissions } from "@/server/rbac/system-roles";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";

const isAdminCo = (ctx: Ctx) => ctx.company.type === "ADMIN";
const usersManagePerm = (ctx: Ctx): PermissionCode => (isAdminCo(ctx) ? "admin.users.manage" : "team.users.manage");
const rolesManagePerm = (ctx: Ctx): PermissionCode => (isAdminCo(ctx) ? "admin.roles.manage" : "team.roles.manage");
const usersViewPerm = (ctx: Ctx): PermissionCode[] =>
  isAdminCo(ctx) ? ["admin.users.view", "admin.users.manage"] : ["team.users.view", "team.users.manage"];

function assert(ctx: Ctx, perm: PermissionCode | PermissionCode[]) {
  if (!can(ctx, perm)) throw new ForbiddenError();
}

/** Can the actor hand out every permission in `codes`? */
function assertNoEscalation(ctx: Ctx, codes: PermissionCode[]) {
  if (ctx.membership.isOwner) return;
  const missing = codes.filter((c) => !ctx.permissions.has(c));
  if (missing.length)
    throw new ForbiddenError(`You cannot grant permissions you do not have yourself (${missing.slice(0, 3).join(", ")}${missing.length > 3 ? "…" : ""}).`);
}

// ── Roles ────────────────────────────────────────────────────────────────────

export type RoleView = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: PermissionCode[];
  memberCount: number;
};

/** System templates applicable to this company type + the company's own custom roles. */
export async function listRoles(ctx: Ctx): Promise<RoleView[]> {
  assert(ctx, [...usersViewPerm(ctx), rolesManagePerm(ctx)]);
  const grantable = new Set(grantablePermissions(ctx.company.type));
  const roles = await prisma.role.findMany({
    where: {
      OR: [{ companyId: null, isSystem: true, appliesTo: { has: ctx.company.type } }, { companyId: ctx.company.id }],
    },
    include: {
      permissions: { select: { permissionCode: true } },
      _count: { select: { members: { where: { membership: { companyId: ctx.company.id } } } } },
    },
    orderBy: [{ isSystem: "desc" }, { name: "asc" }],
  });
  return roles.map((r) => {
    const sys = r.isSystem ? SYSTEM_ROLES.find((s) => s.key === r.key) : undefined;
    const codes = sys ? expandRolePermissions(sys) : r.permissions.map((p) => p.permissionCode).filter(isPermissionCode);
    return {
      id: r.id,
      key: r.key,
      name: r.name,
      description: r.description,
      isSystem: r.isSystem,
      permissions: codes.filter((c) => grantable.has(c)),
      memberCount: r._count.members,
    };
  });
}

export async function saveCustomRole(
  ctx: Ctx,
  input: { id?: string; name: string; description?: string | null; permissions: string[] },
) {
  assert(ctx, rolesManagePerm(ctx));
  const grantable = new Set(grantablePermissions(ctx.company.type));
  const codes = [...new Set(input.permissions)];
  const invalid = codes.filter((c) => !isPermissionCode(c) || !grantable.has(c));
  if (invalid.length) throw new ValidationError(`These permissions are not available to your account type: ${invalid.join(", ")}`);
  const perms = codes as PermissionCode[];
  assertNoEscalation(ctx, perms);

  return prisma.$transaction(async (tx) => {
    let before: unknown = null;
    let roleId = input.id;
    if (roleId) {
      const existing = await tx.role.findFirst({
        where: { id: roleId, companyId: ctx.company.id, isSystem: false },
        include: { permissions: true },
      });
      if (!existing) throw new NotFoundError("Role");
      before = { name: existing.name, permissions: existing.permissions.map((p) => p.permissionCode) };
      await tx.role.update({ where: { id: roleId }, data: { name: input.name, description: input.description ?? null } });
      await tx.rolePermission.deleteMany({ where: { roleId } });
    } else {
      const role = await tx.role.create({
        data: {
          companyId: ctx.company.id,
          key: `custom-${crypto.randomUUID().slice(0, 8)}`,
          name: input.name,
          description: input.description ?? null,
          appliesTo: [ctx.company.type],
          isSystem: false,
          createdById: ctx.user.id,
        },
      });
      roleId = role.id;
    }
    if (perms.length) await tx.rolePermission.createMany({ data: perms.map((c) => ({ roleId: roleId!, permissionCode: c })) });
    await writeAudit(
      {
        actorUserId: ctx.user.id,
        actorCompanyId: ctx.company.id,
        action: input.id ? "role.updated" : "role.created",
        entityType: "Role",
        entityId: roleId,
        before,
        after: { name: input.name, permissions: perms },
      },
      tx,
    );
    return { id: roleId! };
  });
}

export async function deleteCustomRole(ctx: Ctx, roleId: string) {
  assert(ctx, rolesManagePerm(ctx));
  const role = await prisma.role.findFirst({ where: { id: roleId, companyId: ctx.company.id, isSystem: false } });
  if (!role) throw new NotFoundError("Role");
  await prisma.$transaction(async (tx) => {
    await tx.role.delete({ where: { id: roleId } });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "role.deleted", entityType: "Role", entityId: roleId, before: { name: role.name } }, tx);
  });
}

// ── Members ──────────────────────────────────────────────────────────────────

export async function listMembers(ctx: Ctx, opts: { roleKey?: string } = {}) {
  assert(ctx, usersViewPerm(ctx));
  return prisma.membership.findMany({
    where: {
      companyId: ctx.company.id,
      ...(opts.roleKey ? { roles: { some: { role: { key: opts.roleKey } } } } : {}),
    },
    include: {
      user: { select: { id: true, name: true, email: true, status: true, lastLoginAt: true } },
      roles: { include: { role: { select: { id: true, name: true, key: true, isSystem: true } } } },
      scopes: { include: { country: { select: { code: true } }, region: { select: { name: true } } } },
    },
    orderBy: [{ isOwner: "desc" }, { createdAt: "asc" }],
  });
}

/** Resolve role ids → validated roles the actor may assign in this company. */
async function resolveAssignableRoles(ctx: Ctx, roleIds: string[]) {
  const roles = await listRoles(ctx);
  const byId = new Map(roles.map((r) => [r.id, r]));
  const chosen = roleIds.map((id) => byId.get(id));
  if (chosen.some((r) => !r)) throw new ValidationError("One or more roles are not available for this company.");
  const valid = chosen as RoleView[];
  assertNoEscalation(ctx, [...new Set(valid.flatMap((r) => r.permissions))]);
  return valid;
}

export async function createMember(
  ctx: Ctx,
  input: { name: string; email: string; password: string; jobTitle?: string | null; roleIds: string[]; regionIds?: string[] },
) {
  assert(ctx, usersManagePerm(ctx));
  const roles = await resolveAssignableRoles(ctx, input.roleIds);
  const email = input.email.trim().toLowerCase();
  if (await prisma.user.findUnique({ where: { email } }))
    throw new AppError("EMAIL_TAKEN", "A user with this e-mail already exists.", 409);

  const passwordHash = await hashPassword(input.password);
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { email, name: input.name, emailVerified: false } });
    await tx.account.create({ data: { userId: user.id, accountId: user.id, providerId: "credential", password: passwordHash } });
    const membership = await tx.membership.create({
      data: {
        userId: user.id,
        companyId: ctx.company.id,
        jobTitle: input.jobTitle ?? null,
        createdById: ctx.user.id,
        roles: { create: roles.map((r) => ({ roleId: r.id, assignedById: ctx.user.id })) },
      },
    });
    if (isAdminCo(ctx) && input.regionIds?.length) {
      const regions = await tx.region.findMany({ where: { id: { in: input.regionIds } } });
      await tx.membershipScope.createMany({
        data: regions.map((r) => ({ membershipId: membership.id, countryId: r.countryId, regionId: r.id })),
      });
    }
    await writeAudit(
      {
        actorUserId: ctx.user.id,
        actorCompanyId: ctx.company.id,
        action: "member.created",
        entityType: "Membership",
        entityId: membership.id,
        after: { email, roles: roles.map((r) => r.key) },
      },
      tx,
    );
    return { userId: user.id, membershipId: membership.id };
  });
}

async function loadOwnMembership(ctx: Ctx, membershipId: string) {
  const m = await prisma.membership.findFirst({
    where: { id: membershipId, companyId: ctx.company.id },
    include: { roles: { include: { role: true } }, user: { select: { email: true } } },
  });
  if (!m) throw new NotFoundError("User");
  return m;
}

export async function setMemberRoles(ctx: Ctx, membershipId: string, roleIds: string[]) {
  assert(ctx, usersManagePerm(ctx));
  const m = await loadOwnMembership(ctx, membershipId);
  if (m.isOwner && !ctx.membership.isOwner) throw new ForbiddenError("Only an owner can change another owner's roles.");
  if (m.id === ctx.membership.id && !ctx.membership.isOwner) throw new ForbiddenError("You cannot change your own roles.");
  const roles = await resolveAssignableRoles(ctx, roleIds);
  // Also may not REMOVE roles that grant permissions the actor lacks (would be a covert downgrade by a junior user).
  const currentRoles = await resolveRemovableCheck(ctx, m.roles.map((r) => r.roleId), roleIds);
  await prisma.$transaction(async (tx) => {
    await tx.membershipRole.deleteMany({ where: { membershipId } });
    if (roles.length)
      await tx.membershipRole.createMany({ data: roles.map((r) => ({ membershipId, roleId: r.id, assignedById: ctx.user.id })) });
    await writeAudit(
      {
        actorUserId: ctx.user.id,
        actorCompanyId: ctx.company.id,
        action: "member.roles_changed",
        entityType: "Membership",
        entityId: membershipId,
        before: { roles: currentRoles },
        after: { roles: roles.map((r) => r.key) },
      },
      tx,
    );
  });
}

async function resolveRemovableCheck(ctx: Ctx, currentIds: string[], nextIds: string[]) {
  const roles = await listRoles(ctx);
  const byId = new Map(roles.map((r) => [r.id, r]));
  const removed = currentIds.filter((id) => !nextIds.includes(id)).map((id) => byId.get(id)).filter(Boolean) as RoleView[];
  assertNoEscalation(ctx, [...new Set(removed.flatMap((r) => r.permissions))]);
  return currentIds.map((id) => byId.get(id)?.key ?? id);
}

export async function setMemberStatus(ctx: Ctx, membershipId: string, status: MembershipStatus) {
  assert(ctx, usersManagePerm(ctx));
  const m = await loadOwnMembership(ctx, membershipId);
  if (m.id === ctx.membership.id) throw new ForbiddenError("You cannot disable your own access.");
  if (m.isOwner) throw new ForbiddenError("The company owner cannot be disabled.");
  await prisma.$transaction(async (tx) => {
    await tx.membership.update({ where: { id: membershipId }, data: { status } });
    await writeAudit(
      {
        actorUserId: ctx.user.id,
        actorCompanyId: ctx.company.id,
        action: status === "DISABLED" ? "member.disabled" : "member.enabled",
        entityType: "Membership",
        entityId: membershipId,
        before: { status: m.status },
        after: { status },
        meta: { email: m.user.email },
      },
      tx,
    );
  });
}
