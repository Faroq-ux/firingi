import { describe, expect, it } from "vitest";
import { computeEffectivePermissions, ONBOARDING_PERMISSIONS } from "@/server/rbac/effective";
import { ALL_PERMISSION_CODES, PERMISSIONS, grantablePermissions } from "@/server/rbac/permissions";
import { SYSTEM_ROLES, expandRolePermissions } from "@/server/rbac/system-roles";

const base = { membershipStatus: "ACTIVE", userStatus: "ACTIVE", isOwner: false } as const;
const sys = (key: string) => ({ key, isSystem: true, permissionCodes: [] });

describe("permission catalogue", () => {
  it("every system role only references existing permissions allowed for its company types", () => {
    for (const role of SYSTEM_ROLES) {
      for (const code of expandRolePermissions(role)) {
        expect(ALL_PERMISSION_CODES).toContain(code);
        expect(role.appliesTo.some((t) => grantablePermissions(t).includes(code))).toBe(true);
      }
    }
  });

  it("customers can never hold vendor or admin permissions", () => {
    const g = grantablePermissions("CUSTOMER");
    expect(g.some((c) => ["VENDOR", "ADMIN", "DRIVER"].includes(PERMISSIONS[c].audience))).toBe(false);
  });
});

describe("computeEffectivePermissions", () => {
  it("SUPER_ADMIN gets every admin permission", () => {
    const p = computeEffectivePermissions({ ...base, companyType: "ADMIN", companyStatus: "APPROVED", roles: [sys("SUPER_ADMIN")] });
    for (const c of ALL_PERMISSION_CODES.filter((c) => PERMISSIONS[c].audience === "ADMIN")) expect(p.has(c)).toBe(true);
  });

  it("a custom role cannot smuggle in permissions outside the company type", () => {
    const p = computeEffectivePermissions({
      ...base, companyType: "CUSTOMER", companyStatus: "APPROVED",
      roles: [{ key: "custom-x", isSystem: false, permissionCodes: ["admin.users.manage", "vendor.products.manage", "buyer.orders.place"] }],
    });
    expect([...p]).toEqual(["buyer.orders.place"]);
  });

  it("COMPANY_ADMIN of a wholesaler holds both sell and buy permissions", () => {
    const p = computeEffectivePermissions({ ...base, companyType: "WHOLESALER", companyStatus: "APPROVED", roles: [sys("COMPANY_ADMIN")] });
    expect(p.has("vendor.orders.manage")).toBe(true);
    expect(p.has("buyer.orders.place")).toBe(true);
  });

  it("pending company: owner gets onboarding permissions only — no buying or selling", () => {
    const p = computeEffectivePermissions({ ...base, isOwner: true, companyType: "WHOLESALER", companyStatus: "PENDING", roles: [sys("COMPANY_ADMIN")] });
    expect([...p].sort()).toEqual([...ONBOARDING_PERMISSIONS].sort());
    expect(p.has("buyer.orders.place")).toBe(false);
    expect(p.has("vendor.products.manage")).toBe(false);
  });

  it("suspended / rejected company and disabled user get nothing", () => {
    for (const companyStatus of ["SUSPENDED", "REJECTED"] as const)
      expect(computeEffectivePermissions({ ...base, isOwner: true, companyType: "CUSTOMER", companyStatus, roles: [sys("COMPANY_ADMIN")] }).size).toBe(0);
    expect(
      computeEffectivePermissions({ ...base, userStatus: "DISABLED", companyType: "ADMIN", companyStatus: "APPROVED", roles: [sys("SUPER_ADMIN")] }).size,
    ).toBe(0);
    expect(
      computeEffectivePermissions({ ...base, membershipStatus: "DISABLED", companyType: "ADMIN", companyStatus: "APPROVED", roles: [sys("SUPER_ADMIN")] }).size,
    ).toBe(0);
  });

  it("limited vendor employee (warehouse) cannot manage pricing or users", () => {
    const p = computeEffectivePermissions({ ...base, companyType: "WHOLESALER", companyStatus: "APPROVED", roles: [sys("VENDOR_WAREHOUSE")] });
    expect(p.has("vendor.stock.manage")).toBe(true);
    expect(p.has("vendor.pricing.manage")).toBe(false);
    expect(p.has("team.users.manage")).toBe(false);
    expect(p.has("buyer.orders.place")).toBe(false);
  });
});
