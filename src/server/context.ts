/**
 * Request context: who is calling, for which company, with which permissions.
 * EVERY data-layer function takes a Ctx — that is how visibility and permission
 * rules are enforced server-side regardless of the UI.
 */
import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import type { AccountStatus, CompanyType } from "@prisma/client";
import { prisma } from "@/server/db";
import { auth } from "@/server/auth/auth";
import { computeEffectivePermissions } from "@/server/rbac/effective";
import type { PermissionCode } from "@/server/rbac/permissions";

export type Ctx = {
  user: { id: string; email: string; name: string; locale: string | null };
  sessionId: string;
  membership: { id: string; isOwner: boolean };
  company: {
    id: string;
    type: CompanyType;
    status: AccountStatus;
    legalName: string;
    tradeName: string | null;
    countryId: string;
    countryCode: string;
  };
  permissions: Set<PermissionCode>;
  /** Region limits (Regional Managers). Empty = unrestricted. */
  scopes: { countryId: string | null; regionId: string | null }[];
  /** All active companies the user belongs to (for the company switcher). */
  memberships: { companyId: string; legalName: string; type: CompanyType; status: AccountStatus }[];
};

/** Load the context for a known user + company. Used by getContext() and by tests. */
export async function loadContext(userId: string, sessionId: string, preferredCompanyId?: string | null): Promise<Ctx | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      memberships: {
        where: { status: "ACTIVE" },
        include: {
          company: { include: { country: { select: { code: true } } } },
          roles: { include: { role: { include: { permissions: { select: { permissionCode: true } } } } } },
          scopes: true,
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!user || user.status !== "ACTIVE" || user.memberships.length === 0) return null;

  const m =
    user.memberships.find((x) => x.companyId === preferredCompanyId) ??
    user.memberships.find((x) => x.company.type === "ADMIN") ??
    user.memberships[0];

  const permissions = computeEffectivePermissions({
    companyType: m.company.type,
    companyStatus: m.company.status,
    membershipStatus: m.status,
    userStatus: user.status,
    isOwner: m.isOwner,
    roles: m.roles.map((r) => ({
      key: r.role.key,
      isSystem: r.role.isSystem,
      permissionCodes: r.role.permissions.map((p) => p.permissionCode),
    })),
  });

  return {
    user: { id: user.id, email: user.email, name: user.name, locale: user.locale },
    sessionId,
    membership: { id: m.id, isOwner: m.isOwner },
    company: {
      id: m.company.id,
      type: m.company.type,
      status: m.company.status,
      legalName: m.company.legalName,
      tradeName: m.company.tradeName,
      countryId: m.company.countryId,
      countryCode: m.company.country.code,
    },
    permissions,
    scopes: m.scopes.map((s) => ({ countryId: s.countryId, regionId: s.regionId })),
    memberships: user.memberships.map((x) => ({
      companyId: x.companyId,
      legalName: x.company.tradeName ?? x.company.legalName,
      type: x.company.type,
      status: x.company.status,
    })),
  };
}

/** Context of the current request (memoised per request). null = not signed in / no access. */
export const getContext = cache(async (): Promise<Ctx | null> => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  const activeCompanyId = (session.session as { activeCompanyId?: string | null }).activeCompanyId;
  return loadContext(session.user.id, session.session.id, activeCompanyId);
});

/** Signed-in user regardless of memberships (for the "no access" page). */
export const getSessionUser = cache(async () => {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user ?? null;
});
