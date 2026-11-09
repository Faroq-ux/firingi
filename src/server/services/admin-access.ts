/**
 * Which FIRINGI staff may see / decide on which applicant, including Regional Manager
 * scoping (country / region of the company's head office).
 */
import type { CompanyType, Prisma } from "@prisma/client";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { ForbiddenError } from "@/server/errors";
import type { PermissionCode } from "@/server/rbac/permissions";

export function requireAdmin(ctx: Ctx) {
  if (ctx.company.type !== "ADMIN") throw new ForbiddenError();
}

const VIEW: Record<Exclude<CompanyType, "ADMIN">, PermissionCode[]> = {
  DISTRIBUTOR: ["admin.vendors.view", "admin.vendors.approve", "admin.risk.view"],
  WHOLESALER: ["admin.vendors.view", "admin.vendors.approve", "admin.risk.view"],
  CUSTOMER: ["admin.customers.view", "admin.customers.approve", "admin.risk.view"],
};
const DECIDE: Record<Exclude<CompanyType, "ADMIN">, PermissionCode[]> = {
  DISTRIBUTOR: ["admin.vendors.approve"],
  WHOLESALER: ["admin.vendors.approve"],
  CUSTOMER: ["admin.customers.approve"],
};

export const canViewType = (ctx: Ctx, t: CompanyType) => t !== "ADMIN" && can(ctx, VIEW[t]);
export const canDecideType = (ctx: Ctx, t: CompanyType) => t !== "ADMIN" && can(ctx, DECIDE[t]);
/** Document review: the approver of that company type, or Risk & Compliance managers. */
export const canReviewDocsOf = (ctx: Ctx, t: CompanyType) => canDecideType(ctx, t) || (t !== "ADMIN" && can(ctx, "admin.risk.manage"));

/** Company types this admin may view at all. */
export function viewableTypes(ctx: Ctx): CompanyType[] {
  return (["DISTRIBUTOR", "WHOLESALER", "CUSTOMER"] as const).filter((t) => canViewType(ctx, t));
}

/** Prisma filter limiting companies to the admin's regional scope (no scopes = everything). */
export function scopeWhere(ctx: Ctx): Prisma.CompanyWhereInput {
  if (ctx.scopes.length === 0) return {};
  return {
    OR: ctx.scopes.map((s) =>
      s.regionId
        ? { addresses: { some: { kind: "HEAD_OFFICE" as const, isActive: true, city: { regionId: s.regionId } } } }
        : { countryId: s.countryId ?? "__none__" },
    ),
  };
}
