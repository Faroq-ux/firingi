/**
 * Phase 47 — which tills a person may use. Each shop / warehouse has its own tills and its own people:
 * - the owner uses and manages every till;
 * - a till with people listed is only for them (SELL = cashier, MANAGE = shop manager of that till), and someone
 *   given particular tills uses only those;
 * - a till with nobody listed is open to everyone with the till right — staff limited to some shops (Phase 27)
 *   only in their shops; managers (the company's till-manage right, or the shop's manager) manage it.
 */
import "server-only";
import { prisma, type Tx } from "@/server/db";

export type TillAccess = { all: boolean; sell: Set<string>; manage: Set<string>; companyManage: boolean };

export async function tillAccess(companyId: string, userId: string, db: Tx = prisma): Promise<TillAccess> {
  const m = await db.membership.findFirst({
    where: { companyId, userId, status: "ACTIVE" },
    select: { id: true, isOwner: true, roles: { select: { role: { select: { permissions: { select: { permissionCode: true } } } } } }, branchAssignments: { select: { branchId: true } }, managedBranches: { select: { id: true } } },
  });
  const none: TillAccess = { all: false, sell: new Set(), manage: new Set(), companyManage: false };
  if (!m) return none;
  // a till waiting for (or refused by) FIRINGI's approval can't be used
  const regs = await db.posRegister.findMany({ where: { companyId, approval: "APPROVED" }, select: { id: true, branchId: true, users: { select: { userId: true, role: true } } } });
  if (m.isOwner) { const ids = new Set(regs.map((r) => r.id)); return { all: true, sell: ids, manage: new Set(ids), companyManage: true }; }
  const codes = new Set(m.roles.flatMap((r) => r.role.permissions.map((p) => p.permissionCode)));
  const companyManage = codes.has("company.pos.manage");
  const canSell = companyManage || codes.has("company.pos.sell");
  const myShops = new Set(m.branchAssignments.map((b) => b.branchId));
  const managedShops = new Set(m.managedBranches.map((b) => b.id));
  const out: TillAccess = { all: false, sell: new Set(), manage: new Set(), companyManage };
  // someone given particular tills uses only those
  const given = regs.some((r) => r.users.some((u) => u.userId === userId));
  for (const r of regs) {
    if (r.users.length) {
      const mine = r.users.find((u) => u.userId === userId);
      if (mine && canSell) { out.sell.add(r.id); if (mine.role === "MANAGE") out.manage.add(r.id); }
      continue;
    }
    if (given) continue;
    const inShop = !r.branchId || !myShops.size || myShops.has(r.branchId) || managedShops.has(r.branchId);
    if (canSell && inShop) {
      out.sell.add(r.id);
      if ((companyManage && (!r.branchId || !myShops.size || myShops.has(r.branchId))) || (r.branchId && managedShops.has(r.branchId))) out.manage.add(r.id);
    }
  }
  out.all = regs.length > 0 && out.sell.size === regs.length && out.manage.size === regs.length;
  return out;
}
