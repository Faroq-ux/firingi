/**
 * Authorization guards. Use the `require*` variants in server actions / data layer
 * (they throw), and the `page*` variants in pages / layouts (they redirect).
 */
import "server-only";
import { redirect } from "next/navigation";
import type { CompanyType } from "@prisma/client";
import { getContext, type Ctx } from "@/server/context";
import { ForbiddenError, UnauthenticatedError } from "@/server/errors";
import { PERMISSIONS, type PermissionCode } from "./permissions";

export type Portal = "admin" | "vendor" | "buy" | "driver";

/** True if the context holds the permission (or ANY of the permissions when given an array). */
export function can(ctx: Ctx, perm: PermissionCode | PermissionCode[]): boolean {
  const list = Array.isArray(perm) ? perm : [perm];
  return list.some((p) => ctx.permissions.has(p));
}

export function requirePermission(ctx: Ctx, perm: PermissionCode | PermissionCode[]) {
  if (!can(ctx, perm)) throw new ForbiddenError();
}

export function requireCompanyType(ctx: Ctx, ...types: CompanyType[]) {
  if (!types.includes(ctx.company.type)) throw new ForbiddenError();
}

/** Buy/sell actions require an APPROVED company (also enforced via permissions). */
export function requireApproved(ctx: Ctx) {
  if (ctx.company.status !== "APPROVED") throw new ForbiddenError("Your account is awaiting approval by FIRINGI.");
}

export async function requireContext(): Promise<Ctx> {
  const ctx = await getContext();
  if (!ctx) throw new UnauthenticatedError();
  return ctx;
}

const PORTAL_RULES: Record<Portal, { types: CompanyType[]; audience: string }> = {
  admin: { types: ["ADMIN"], audience: "ADMIN" },
  vendor: { types: ["DISTRIBUTOR", "WHOLESALER"], audience: "VENDOR" },
  buy: { types: ["CUSTOMER", "WHOLESALER"], audience: "BUYER" },
  driver: { types: ["ADMIN", "DISTRIBUTOR", "WHOLESALER"], audience: "DRIVER" },
};

/** Which portals this context may enter. Team pages (COMPANY audience) live inside vendor/buy. */
export function portalsFor(ctx: Ctx): Portal[] {
  return (Object.keys(PORTAL_RULES) as Portal[]).filter((p) => {
    const rule = PORTAL_RULES[p];
    if (!rule.types.includes(ctx.company.type)) return false;
    if (ctx.company.status !== "APPROVED") return false;
    for (const c of ctx.permissions) {
      const a = PERMISSIONS[c].audience;
      if (a === rule.audience || (a === "COMPANY" && (p === "vendor" || p === "buy"))) return true;
    }
    return false;
  });
}

/** Where to send a user after login / when they hit "/". */
export function homeFor(ctx: Ctx): string {
  if (ctx.company.status !== "APPROVED") return "/application-status";
  const portals = portalsFor(ctx);
  if (portals.length === 0) return "/forbidden";
  return `/${portals[0]}`;
}

// ── Page helpers (redirect instead of throwing) ─────────────────────────────

export async function pageContext(): Promise<Ctx> {
  const ctx = await getContext();
  if (!ctx) redirect("/login");
  return ctx;
}

export async function pagePortal(portal: Portal): Promise<Ctx> {
  const ctx = await pageContext();
  if (portal !== "admin" && ctx.company.status !== "APPROVED") redirect("/application-status");
  if (!portalsFor(ctx).includes(portal)) redirect("/forbidden");
  return ctx;
}

export function pagePermission(ctx: Ctx, perm: PermissionCode | PermissionCode[]) {
  if (!can(ctx, perm)) redirect("/forbidden");
}
