/**
 * Pure permission resolution — no DB access, fully unit-tested.
 *
 * Effective permissions = (permissions of all assigned roles)
 *                         ∩ (permissions the company type may ever hold)
 *                         ∩ (permissions allowed by the company's approval status)
 */
import type { AccountStatus, CompanyType, MembershipStatus, UserStatus } from "@prisma/client";
import { AUDIENCES_BY_COMPANY_TYPE, PERMISSIONS, grantablePermissions, isPermissionCode, type PermissionCode } from "./permissions";
import { SYSTEM_ROLES, expandRolePermissions } from "./system-roles";

export type RoleInput = { key: string; isSystem: boolean; permissionCodes: string[] };

export type EffectiveInput = {
  companyType: CompanyType;
  companyStatus: AccountStatus;
  membershipStatus: MembershipStatus;
  userStatus: UserStatus;
  isOwner: boolean;
  roles: RoleInput[];
};

/**
 * Until admin approves a company, its users may only complete onboarding
 * (profile, documents, addresses). They cannot buy, sell or manage a team.
 */
export const ONBOARDING_PERMISSIONS: PermissionCode[] = [
  "company.profile.manage",
  "company.documents.manage",
  "company.addresses.manage",
];

export function computeEffectivePermissions(input: EffectiveInput): Set<PermissionCode> {
  if (input.userStatus !== "ACTIVE" || input.membershipStatus !== "ACTIVE") return new Set();

  const grantable = new Set(grantablePermissions(input.companyType));
  const granted = new Set<PermissionCode>();

  if (input.isOwner) {
    // Owners hold everything their company type allows except driver duties.
    for (const c of grantable) if (PERMISSIONS[c].audience !== "DRIVER") granted.add(c);
  }

  for (const role of input.roles) {
    // System roles are resolved from code so they always reflect the current catalogue.
    const sys = role.isSystem ? SYSTEM_ROLES.find((r) => r.key === role.key) : undefined;
    const codes = sys ? expandRolePermissions(sys) : role.permissionCodes.filter(isPermissionCode);
    for (const c of codes) if (grantable.has(c)) granted.add(c);
  }

  if (input.companyStatus !== "APPROVED") {
    // SUSPENDED / REJECTED companies get nothing; PENDING / UNDER_REVIEW get onboarding only.
    if (input.companyStatus === "SUSPENDED" || input.companyStatus === "REJECTED") return new Set();
    const onboarding = new Set<PermissionCode>();
    for (const c of ONBOARDING_PERMISSIONS) if (grantable.has(c) && (granted.has(c) || input.isOwner)) onboarding.add(c);
    return onboarding;
  }
  return granted;
}

export function hasAudience(perms: Set<PermissionCode>, audience: keyof typeof AUDIENCES_BY_COMPANY_TYPE | string) {
  for (const c of perms) if (PERMISSIONS[c].audience === audience) return true;
  return false;
}
