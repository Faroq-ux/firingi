/**
 * Multi-site buyers (Phase 27). A customer / wholesaler has branches (shops, restaurants, sites);
 * each delivery address belongs to a branch and every order remembers its branch, the branch's cost
 * centre and the buyer's PO reference. Team members assigned to branches only see, order and approve
 * for those branches; members with no assignment — and people who manage branches — see everything.
 */
import type { Prisma } from "@prisma/client";
import { prisma, type Tx } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";
import { isBusinessType } from "@/lib/business-types";
import type { AddressInput } from "@/server/services/addresses";

export const MANAGE = "buyer.branches.manage" as const;
const isBuyerCo = (ctx: Ctx) => (ctx.company.type === "CUSTOMER" || ctx.company.type === "WHOLESALER") && ctx.company.status === "APPROVED";

const scopeCache = new WeakMap<Ctx, Promise<string[] | null>>();
/** The branches the caller is limited to — null = the whole company. */
export function branchScope(ctx: Ctx): Promise<string[] | null> {
  let p = scopeCache.get(ctx);
  if (!p) {
    p = (async () => {
      if (!isBuyerCo(ctx) || can(ctx, MANAGE)) return null;
      const rows = await prisma.branchMember.findMany({ where: { membershipId: ctx.membership.id, branch: { companyId: ctx.company.id } }, select: { branchId: true } });
      return rows.length ? rows.map((r) => r.branchId) : null;
    })();
    scopeCache.set(ctx, p);
  }
  return p;
}

/** Orders the caller may see (added to the buyer's own-company filter). */
export async function orderScopeWhere(ctx: Ctx): Promise<Prisma.OrderWhereInput> {
  const s = await branchScope(ctx);
  return s ? { branchId: { in: s } } : {};
}

/** Delivery addresses the caller may order to: active, of an active branch (or none), in their branches. */
export async function orderableAddressWhere(ctx: Ctx): Promise<Prisma.AddressWhereInput> {
  const s = await branchScope(ctx);
  return {
    companyId: ctx.company.id, isActive: true, kind: "DELIVERY",
    AND: [{ OR: [{ branchId: null }, { branch: { isActive: true } }] }, ...(s ? [{ branchId: { in: s } }] : [])],
  };
}

export async function canOrderTo(ctx: Ctx, addressId: string) {
  return (await prisma.address.count({ where: { id: addressId, ...(await orderableAddressWhere(ctx)) } })) > 0;
}

/** The branch, its cost centre: stamped on an order at placement. */
export async function branchStamp(tx: Tx, addressId: string | null | undefined) {
  if (!addressId) return { branchId: null, costCentre: null };
  const a = await tx.address.findUnique({ where: { id: addressId }, select: { branch: { select: { id: true, costCentre: true } } } });
  return { branchId: a?.branch?.id ?? null, costCentre: a?.branch?.costCentre ?? null };
}

function requireBuyer(ctx: Ctx) {
  if (!isBuyerCo(ctx) || !can(ctx, ["buyer.orders.view", "buyer.orders.place", MANAGE, "buyer.reports.view"])) throw new ForbiddenError();
}
function requireManager(ctx: Ctx) {
  if (!isBuyerCo(ctx) || !can(ctx, MANAGE)) throw new ForbiddenError();
}

const monthStart = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));

/** Branches the caller can see, with addresses, staff and this month's spend. */
export async function listBranches(ctx: Ctx) {
  requireBuyer(ctx);
  const s = await branchScope(ctx);
  const rows = await prisma.branch.findMany({
    where: { companyId: ctx.company.id, ...(s ? { id: { in: s } } : {}) },
    include: { _count: { select: { addresses: true, members: true } }, manager: { select: { user: { select: { name: true } } } } },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
  });
  const spend = await prisma.order.groupBy({ by: ["branchId"], where: { buyerCompanyId: ctx.company.id, branchId: { in: rows.map((r) => r.id) }, placedAt: { gte: monthStart() }, status: { not: "CANCELLED" } }, _sum: { grandTotal: true }, _count: { _all: true } });
  return rows.map((b) => {
    const sp = spend.find((x) => x.branchId === b.id);
    return {
      id: b.id, name: b.name, code: b.code, category: b.category, costCentre: b.costCentre, isActive: b.isActive, phone: b.phone, manager: b.manager?.user.name ?? null,
      addresses: b._count.addresses, members: b._count.members, monthSpend: sp?._sum.grandTotal?.toString() ?? "0", monthOrders: sp?._count._all ?? 0,
    };
  });
}

export async function getBranch(ctx: Ctx, id: string) {
  requireBuyer(ctx);
  const s = await branchScope(ctx);
  if (s && !s.includes(id)) throw new NotFoundError("Branch");
  const b = await prisma.branch.findFirst({
    where: { id, companyId: ctx.company.id },
    include: {
      addresses: { where: { kind: "DELIVERY" }, orderBy: { label: "asc" }, select: { id: true, label: true, line1: true, postalCode: true, cityName: true, isActive: true } },
      members: { include: { membership: { select: { id: true, jobTitle: true, user: { select: { name: true, email: true } } } } } },
      manager: { select: { id: true, user: { select: { name: true } } } },
    },
  });
  if (!b) throw new NotFoundError("Branch");
  const orders = await prisma.order.findMany({ where: { buyerCompanyId: ctx.company.id, branchId: id }, orderBy: { placedAt: "desc" }, take: 10, select: { id: true, number: true, placedAt: true, status: true, grandTotal: true, poReference: true, routedByFiringi: true, seller: { select: { legalName: true, tradeName: true } } } });
  return {
    id: b.id, name: b.name, code: b.code, category: b.category, costCentre: b.costCentre, phone: b.phone, isActive: b.isActive, managerMembershipId: b.managerMembershipId, manager: b.manager?.user.name ?? null,
    addresses: b.addresses, members: b.members.map((m) => ({ membershipId: m.membership.id, name: m.membership.user.name, email: m.membership.user.email, jobTitle: m.membership.jobTitle })),
    orders: orders.map((o) => ({ id: o.id, number: o.number, placedAt: o.placedAt, status: o.status, grandTotal: o.grandTotal.toString(), poReference: o.poReference, supplier: o.routedByFiringi ? "FIRINGI" : o.seller.tradeName ?? o.seller.legalName })),
  };
}

/** Team members (for manager / staff pickers). */
export async function teamOptions(ctx: Ctx) {
  requireManager(ctx);
  const rows = await prisma.membership.findMany({ where: { companyId: ctx.company.id, status: "ACTIVE" }, select: { id: true, user: { select: { name: true, email: true } } }, orderBy: { createdAt: "asc" } });
  return rows.map((m) => ({ id: m.id, label: `${m.user.name} — ${m.user.email}` }));
}

/** Delivery addresses not yet in a branch (to add to one). */
export async function unassignedAddresses(ctx: Ctx) {
  requireManager(ctx);
  return prisma.address.findMany({ where: { companyId: ctx.company.id, kind: "DELIVERY", branchId: null, isActive: true }, select: { id: true, label: true, line1: true, cityName: true }, orderBy: { label: "asc" } });
}

export type ShopAddress = Omit<AddressInput, "id" | "kind" | "label" | "isDefault"> & { label?: string | null };
export type BranchInput = { name: string; code?: string | null; category?: string | null; costCentre?: string | null; phone?: string | null; managerMembershipId?: string | null; address?: ShopAddress | null };
export async function saveBranch(ctx: Ctx, id: string | null, i: BranchInput) {
  requireManager(ctx);
  const name = i.name.trim();
  if (!name) throw new ValidationError("Give the branch a name.");
  if (i.managerMembershipId && !(await prisma.membership.count({ where: { id: i.managerMembershipId, companyId: ctx.company.id, status: "ACTIVE" } }))) throw new ValidationError("Choose a manager from your team.");
  if (await prisma.branch.count({ where: { companyId: ctx.company.id, name: { equals: name, mode: "insensitive" }, ...(id ? { id: { not: id } } : {}) } })) throw new ValidationError("You already have a branch with that name.");
  if (i.category && !isBusinessType(i.category)) throw new ValidationError("Choose a shop category.");
  const data = { name, code: i.code?.trim() || null, category: i.category || null, costCentre: i.costCentre?.trim() || null, phone: i.phone?.trim() || null, managerMembershipId: i.managerMembershipId || null };
  let row;
  if (id) {
    if (!(await prisma.branch.count({ where: { id, companyId: ctx.company.id } }))) throw new NotFoundError("Branch");
    row = await prisma.branch.update({ where: { id }, data });
  } else row = await prisma.branch.create({ data: { ...data, companyId: ctx.company.id } });
  // the shop's address: created with it (a delivery address of the company, in this shop)
  if (i.address) await addShopAddress(ctx, row.id, i.address, name);
  // the manager works at the branch
  if (data.managerMembershipId) await prisma.branchMember.upsert({ where: { branchId_membershipId: { branchId: row.id, membershipId: data.managerMembershipId } }, update: {}, create: { branchId: row.id, membershipId: data.managerMembershipId } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: id ? "branch.updated" : "branch.created", entityType: "Branch", entityId: row.id, after: data });
  return row.id;
}

/** A new delivery address for a shop (same company — the shop's own address). */
export async function addShopAddress(ctx: Ctx, branchId: string, a: ShopAddress, fallbackLabel?: string) {
  requireManager(ctx);
  const b = await prisma.branch.findFirst({ where: { id: branchId, companyId: ctx.company.id }, select: { name: true } });
  if (!b) throw new NotFoundError("Branch");
  if (!a.line1?.trim() || !a.postalCode?.trim() || !a.cityName?.trim()) throw new ValidationError("Enter the shop's street, postal code and city.");
  const { saveAddress } = await import("@/server/services/addresses");
  // after registration a shop's new address waits for FIRINGI's approval (it joins the shop once approved)
  const row = await saveAddress(ctx, { ...a, kind: "DELIVERY", label: a.label?.trim() || fallbackLabel || b.name }, { branchId });
  return row.id;
}

export async function setBranchActive(ctx: Ctx, id: string, active: boolean) {
  requireManager(ctx);
  const r = await prisma.branch.updateMany({ where: { id, companyId: ctx.company.id }, data: { isActive: active } });
  if (!r.count) throw new NotFoundError("Branch");
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: active ? "branch.reactivated" : "branch.deactivated", entityType: "Branch", entityId: id });
}

/** Delete a branch that never ordered (otherwise: deactivate it, its history stays). */
export async function deleteBranch(ctx: Ctx, id: string) {
  requireManager(ctx);
  const b = await prisma.branch.findFirst({ where: { id, companyId: ctx.company.id }, include: { _count: { select: { orders: true, entries: true } } } });
  if (!b) throw new NotFoundError("Branch");
  if (b._count.orders || b._count.entries) throw new AppError("BRANCH_IN_USE", "This branch has orders or accounting entries — deactivate it instead.", 409);
  await prisma.branch.delete({ where: { id } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "branch.deleted", entityType: "Branch", entityId: id, before: { name: b.name } });
}

/** Put a delivery address in a branch (or take it out). Orders already placed keep their branch. */
export async function setAddressBranch(ctx: Ctx, addressId: string, branchId: string | null) {
  requireManager(ctx);
  const a = await prisma.address.findFirst({ where: { id: addressId, companyId: ctx.company.id, kind: "DELIVERY" } });
  if (!a) throw new NotFoundError("Address");
  if (branchId && !(await prisma.branch.count({ where: { id: branchId, companyId: ctx.company.id } }))) throw new NotFoundError("Branch");
  await prisma.address.update({ where: { id: addressId }, data: { branchId } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "address.branch_set", entityType: "Address", entityId: addressId, before: { branchId: a.branchId }, after: { branchId } });
}

export async function setBranchMember(ctx: Ctx, branchId: string, membershipId: string, on: boolean) {
  requireManager(ctx);
  if (!(await prisma.branch.count({ where: { id: branchId, companyId: ctx.company.id } }))) throw new NotFoundError("Branch");
  if (!(await prisma.membership.count({ where: { id: membershipId, companyId: ctx.company.id } }))) throw new NotFoundError("Team member");
  if (on) await prisma.branchMember.upsert({ where: { branchId_membershipId: { branchId, membershipId } }, update: {}, create: { branchId, membershipId } });
  else await prisma.branchMember.deleteMany({ where: { branchId, membershipId } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: on ? "branch.member_added" : "branch.member_removed", entityType: "Branch", entityId: branchId, after: { membershipId } });
}

/** Company ordering setting: a PO reference is required at checkout. */
export async function setPoRequired(ctx: Ctx, required: boolean) {
  requireManager(ctx);
  await prisma.company.update({ where: { id: ctx.company.id }, data: { requirePoReference: required } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "company.po_required", entityType: "Company", entityId: ctx.company.id, after: { required } });
}

export async function orderingSettings(ctx: Ctx) {
  const c = await prisma.company.findUniqueOrThrow({ where: { id: ctx.company.id }, select: { requirePoReference: true } });
  return { requirePoReference: c.requirePoReference };
}

/** Branches as select options for the caller (filters, accounting). */
export async function branchOptions(ctx: Ctx, includeInactive = false) {
  if (!isBuyerCo(ctx)) return [];
  const s = await branchScope(ctx);
  const rows = await prisma.branch.findMany({ where: { companyId: ctx.company.id, ...(includeInactive ? {} : { isActive: true }), ...(s ? { id: { in: s } } : {}) }, select: { id: true, name: true, code: true }, orderBy: { name: "asc" } });
  return rows.map((b) => ({ id: b.id, label: b.code ? `${b.name} (${b.code})` : b.name }));
}

/** FIRINGI: every customer's shops with category and this month's orders (English back office). */
export async function adminShops(ctx: Ctx) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, ["admin.customers.view", "admin.customers.approve"])) throw new ForbiddenError();
  const { scopeWhere } = await import("@/server/services/admin-access");
  const rows = await prisma.branch.findMany({
    where: { company: scopeWhere(ctx) },
    include: { company: { select: { id: true, legalName: true, tradeName: true, type: true, businessType: true } }, addresses: { where: { isActive: true }, select: { cityName: true, line1: true }, take: 1 }, _count: { select: { addresses: true, members: true } } },
    orderBy: [{ company: { legalName: "asc" } }, { name: "asc" }],
  });
  const spend = await prisma.order.groupBy({ by: ["branchId"], where: { branchId: { in: rows.map((r) => r.id) }, placedAt: { gte: monthStart() }, status: { not: "CANCELLED" } }, _sum: { grandTotal: true }, _count: { _all: true } });
  return rows.map((b) => {
    const s = spend.find((x) => x.branchId === b.id);
    return {
      id: b.id, name: b.name, code: b.code, category: b.category, isActive: b.isActive, companyId: b.company.id, company: b.company.tradeName ?? b.company.legalName, companyType: b.company.type, businessType: b.company.businessType,
      city: b.addresses[0]?.cityName ?? null, address: b.addresses[0]?.line1 ?? null, addresses: b._count.addresses, staff: b._count.members, monthOrders: s?._count._all ?? 0, monthSpend: s?._sum.grandTotal?.toString() ?? "0",
    };
  });
}

/** Cities of the company's country (shop address picker) and its country code. */
export async function shopCities(ctx: Ctx) {
  const c = await prisma.country.findUniqueOrThrow({ where: { id: ctx.company.countryId }, select: { code: true, cities: { where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } } } });
  return { countryCode: c.code, cities: c.cities };
}
