/** Sync the permission catalogue and system role templates from code. Idempotent. */
import type { PrismaClient } from "@prisma/client";
import { ALL_PERMISSION_CODES, PERMISSIONS } from "../../src/server/rbac/permissions";
import { SYSTEM_ROLES, expandRolePermissions } from "../../src/server/rbac/system-roles";

export async function seedRbac(db: PrismaClient) {
  for (const code of ALL_PERMISSION_CODES) {
    const p = PERMISSIONS[code];
    await db.permission.upsert({
      where: { code },
      update: { audience: p.audience, module: p.module, description: p.description },
      create: { code, audience: p.audience, module: p.module, description: p.description },
    });
  }
  // Remove permissions that no longer exist in code (cascades to role grants).
  await db.permission.deleteMany({ where: { code: { notIn: ALL_PERMISSION_CODES } } });

  const roleIds: Record<string, string> = {};
  for (const def of SYSTEM_ROLES) {
    const existing = await db.role.findFirst({ where: { companyId: null, key: def.key } });
    const data = { name: def.name, description: def.description, appliesTo: def.appliesTo, isSystem: true };
    const role = existing
      ? await db.role.update({ where: { id: existing.id }, data })
      : await db.role.create({ data: { ...data, key: def.key, companyId: null } });
    roleIds[def.key] = role.id;
    // Keep DB grants in sync with code (used for display; effective permissions are computed from code).
    await db.rolePermission.deleteMany({ where: { roleId: role.id } });
    await db.rolePermission.createMany({ data: expandRolePermissions(def).map((c) => ({ roleId: role.id, permissionCode: c })) });
  }
  return { roleIds };
}
