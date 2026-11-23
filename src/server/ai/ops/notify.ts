import "server-only";
/** Phase 67 helpers: tell a group of FIRINGI staff (holders of a right), and load a person's own rights to act with. */
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { computeEffectivePermissions } from "@/server/rbac/effective";
import type { PermissionCode } from "@/server/rbac/permissions";

/** Active FIRINGI staff holding the right (owners and Super Admins included). */
export async function staffWith(perm: string): Promise<string[]> {
  const admin = await prisma.company.findFirst({ where: { type: "ADMIN" }, orderBy: { createdAt: "asc" }, select: { id: true, type: true, status: true } });
  if (!admin) return [];
  const ms = await prisma.membership.findMany({
    where: { companyId: admin.id, status: "ACTIVE", user: { status: "ACTIVE" } },
    include: { user: { select: { status: true } }, roles: { include: { role: { include: { permissions: { select: { permissionCode: true } } } } } } },
  });
  return ms.filter((m) => {
    const perms = computeEffectivePermissions({
      companyType: admin.type, companyStatus: admin.status, membershipStatus: m.status, userStatus: m.user.status, isOwner: m.isOwner, driverStatus: null,
      roles: m.roles.map((r) => ({ key: r.role.key, isSystem: r.role.isSystem, permissionCodes: r.role.permissions.map((p) => p.permissionCode) })),
    });
    return perms.has(perm as PermissionCode);
  }).map((m) => m.userId);
}

/** An in-app (and email / push, as each person chose) message to a staff group. */
export async function notifyStaffGroup(perm: string, title: string, body: string, link: string | null, ref?: { type: string; id: string }) {
  const users = await staffWith(perm);
  if (!users.length) return 0;
  const { notify } = await import("@/server/notify/dispatch");
  const r = await notify("ai.automation", users.map((userId) => ({ userId, link: link ?? undefined })), { title: title.slice(0, 150), body: body.slice(0, 1500) }, ref ? { ref } : {}).catch(() => ({ recipients: 0 }));
  return r.recipients;
}

/** The person's context in FIRINGI's back office (null when they left or lost access). */
export async function staffCtx(userId: string): Promise<Ctx | null> {
  const { loadContext } = await import("@/server/context");
  const admin = await prisma.company.findFirst({ where: { type: "ADMIN" }, orderBy: { createdAt: "asc" }, select: { id: true } });
  const ctx = await loadContext(userId, "ai-automation", admin?.id);
  return ctx && ctx.company.type === "ADMIN" ? ctx : null;
}
