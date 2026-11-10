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
  // Company-wide permissions (profile, team, support) open the vendor / buy portals only for
  // people who neither sell nor buy (e.g. an office manager); otherwise a warehouse employee
  // of a wholesaler would get the buying portal just for being able to ask for help.
  const audiences = new Set<string>([...ctx.permissions].map((c) => PERMISSIONS[c].audience));
  const tradeOnly = audiences.has("VENDOR") || audiences.has("BUYER");
  return (Object.keys(PORTAL_RULES) as Portal[]).filter((p) => {
    const rule = PORTAL_RULES[p];
    if (!rule.types.includes(ctx.company.type)) return false;
    if (ctx.company.status !== "APPROVED") return false;
    if (audiences.has(rule.audience)) return true;
    return !tradeOnly && audiences.has("COMPANY") && (p === "vendor" || p === "buy");
  });
}

/** Where to send a user after login / when they hit "/". */
export function homeFor(ctx: Ctx): string {
  if (ctx.company.status !== "APPROVED") return "/application-status";
  const portals = portalsFor(ctx);
  // An applicant driver with nothing else to do waits on the application page.
  if (portals.length === 0 && ctx.driver && ctx.driver.status !== "APPROVED") return "/application-status";
  if (portals.length === 0) return "/forbidden";
  return `/${portals[0]}`;
}

// ── Page helpers (redirect instead of throwing) ─────────────────────────────

export async function pageContext(): Promise<Ctx> {
  const ctx = await getContext();
  if (!ctx) redirect("/login");
  return ctx;
}

export async function pagePortal(portal: Portal, opts: { securitySetup?: boolean } = {}): Promise<Ctx> {
  const ctx = await pageContext();
  if (portal !== "admin" && ctx.company.status !== "APPROVED") redirect("/application-status");
  if (!portalsFor(ctx).includes(portal)) redirect("/forbidden");
  // Two-factor login required by the security policy: set it up before anything else.
  if (!opts.securitySetup && portal !== "driver") {
    const { mustSetUpTwoFactor } = await import("@/server/services/security");
    if (await mustSetUpTwoFactor(ctx)) redirect(`/${portal}/me/security?required=1`);
  }
  return ctx;
}

export function pagePermission(ctx: Ctx, perm: PermissionCode | PermissionCode[]) {
  if (!can(ctx, perm)) redirect("/forbidden");
}
