/**
 * Context, approval gating, tenant isolation and RBAC management (team service).
 */
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { homeFor, portalsFor } from "@/server/rbac/guard";
import * as team from "@/server/services/team";
import { ctxFor } from "../helpers";

afterAll(() => prisma.$disconnect());

describe("approval gating (checklist: new accounts cannot buy/sell until approved)", () => {
  it("pending wholesaler owner has no buy/sell permission and is sent to the application page", async () => {
    const ctx = await ctxFor("owner@portonorte.test");
    expect(ctx.company.status).toBe("PENDING");
    expect(ctx.permissions.has("buyer.orders.place")).toBe(false);
    expect(ctx.permissions.has("vendor.products.manage")).toBe(false);
    expect(portalsFor(ctx)).toEqual([]);
    expect(homeFor(ctx)).toBe("/application-status");
  });

  it("under-review customer cannot order", async () => {
    const ctx = await ctxFor("owner@pizzariabella.test");
    expect(ctx.permissions.has("buyer.orders.place")).toBe(false);
  });

  it("approved accounts land in the right portal", async () => {
    expect(homeFor(await ctxFor("owner@kebabhouse.test"))).toBe("/buy");
    expect(homeFor(await ctxFor("owner@atlantico.test"))).toBe("/vendor");
    expect(homeFor(await ctxFor("superadmin@firingi.test"))).toBe("/admin");
    const whs = await ctxFor("owner@lisboacentral.test");
    expect(portalsFor(whs)).toEqual(["vendor", "buy"]);
  });

  it("customer can never enter the vendor or admin portal", async () => {
    const ctx = await ctxFor("owner@kebabhouse.test");
    expect(portalsFor(ctx)).toEqual(["buy"]);
  });

  it("suspending a company removes all access immediately", async () => {
    const id = (await prisma.company.findFirstOrThrow({ where: { legalName: "Distribuciones Ibéricas S.L." } })).id;
    await prisma.company.update({ where: { id }, data: { status: "SUSPENDED" } });
    const ctx = await ctxFor("owner@ibericas.test");
    expect(ctx.permissions.size).toBe(0);
    await prisma.company.update({ where: { id }, data: { status: "APPROVED" } });
  });
});

describe("limited vendor employee (checklist: blocked pages and actions)", () => {
  it("warehouse employee has stock/orders but not pricing, users or buying", async () => {
    const ctx = await ctxFor("warehouse@lisboacentral.test");
    expect(ctx.permissions.has("vendor.stock.manage")).toBe(true);
    expect(ctx.permissions.has("vendor.pricing.manage")).toBe(false);
    expect(ctx.permissions.has("team.users.view")).toBe(false);
    expect(portalsFor(ctx)).toEqual(["vendor"]); // no Buy portal
  });

  it("warehouse employee cannot list or create users (server-side check)", async () => {
    const ctx = await ctxFor("warehouse@lisboacentral.test");
    await expect(team.listMembers(ctx)).rejects.toThrow(/permission/);
    await expect(
      team.createMember(ctx, { name: "X", email: "x@x.test", password: "Password123!", roleIds: [] }),
    ).rejects.toThrow(/permission/);
  });

  it("customer purchaser cannot manage roles", async () => {
    const ctx = await ctxFor("buyer@kebabhouse.test");
    await expect(team.saveCustomRole(ctx, { name: "Hack", permissions: ["buyer.orders.place"] })).rejects.toThrow(/permission/);
  });
});

describe("team management", () => {
  it("company owner creates an employee with a custom role; the employee gets exactly those permissions", async () => {
    const owner = await ctxFor("owner@kebabhouse.test");
    const role = await team.saveCustomRole(owner, { name: "Invoices only", permissions: ["buyer.invoices.view", "buyer.dashboard.view"] });
    const { userId } = await team.createMember(owner, {
      name: "Ana Contas", email: `ana.${Date.now()}@kebabhouse.test`, password: "Password123!", roleIds: [role.id],
    });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const emp = await ctxFor(user.email);
    expect([...emp.permissions].sort()).toEqual(["buyer.dashboard.view", "buyer.invoices.view"]);
    // Audit trail written.
    expect(await prisma.auditLog.count({ where: { action: "member.created", actorUserId: owner.user.id } })).toBeGreaterThan(0);
  });

  it("roles cannot include permissions outside the company type", async () => {
    const owner = await ctxFor("owner@kebabhouse.test");
    await expect(team.saveCustomRole(owner, { name: "Bad", permissions: ["vendor.products.manage"] })).rejects.toThrow(/not available/);
  });

  it("a company cannot touch another company's users (tenant isolation)", async () => {
    const kebabOwner = await ctxFor("owner@kebabhouse.test");
    const foreign = await prisma.membership.findFirstOrThrow({ where: { user: { email: "warehouse@lisboacentral.test" } } });
    await expect(team.setMemberStatus(kebabOwner, foreign.id, "DISABLED")).rejects.toThrow(/not found/);
    await expect(team.setMemberRoles(kebabOwner, foreign.id, [])).rejects.toThrow(/not found/);
    const roles = await team.listRoles(await ctxFor("owner@lisboacentral.test"));
    const lxCustom = await team.saveCustomRole(await ctxFor("owner@lisboacentral.test"), { name: "LX only", permissions: ["vendor.orders.view"] });
    expect(roles.length).toBeGreaterThan(0);
    await expect(team.deleteCustomRole(kebabOwner, lxCustom.id)).rejects.toThrow(/not found/);
  });

  it("no privilege escalation: an admin with users.manage but not finance cannot grant FINANCE", async () => {
    const superAdmin = await ctxFor("superadmin@firingi.test");
    const roles = await team.listRoles(superAdmin);
    const id = (k: string) => roles.find((r) => r.key === k)!.id;
    // A user-manager role without finance permissions.
    const mgr = await team.saveCustomRole(superAdmin, { name: "User manager", permissions: ["admin.users.view", "admin.users.manage"] });
    const { membershipId: mgrMembership } = await team.createMember(superAdmin, {
      name: "Uma Manager", email: `uma.${Date.now()}@firingi.test`, password: "Password123!", roleIds: [mgr.id],
    });
    const m = await prisma.membership.findUniqueOrThrow({ where: { id: mgrMembership }, include: { user: true } });
    const mgrCtx = await ctxFor(m.user.email);
    await expect(
      team.createMember(mgrCtx, { name: "Fin", email: `fin.${Date.now()}@firingi.test`, password: "Password123!", roleIds: [id("FINANCE")] }),
    ).rejects.toThrow(/cannot grant/);
    // …but can create someone with a subset of their own permissions.
    await team.createMember(mgrCtx, { name: "Sub", email: `sub.${Date.now()}@firingi.test`, password: "Password123!", roleIds: [mgr.id] });
  });

  it("owners cannot be disabled and users cannot disable themselves", async () => {
    const superAdmin = await ctxFor("superadmin@firingi.test");
    await expect(team.setMemberStatus(superAdmin, superAdmin.membership.id, "DISABLED")).rejects.toThrow(/own access/);
    const kebabOwner = await ctxFor("owner@kebabhouse.test");
    await expect(team.setMemberStatus(kebabOwner, kebabOwner.membership.id, "DISABLED")).rejects.toThrow();
  });

  it("disabling an employee removes their access immediately", async () => {
    const owner = await ctxFor("owner@kebabhouse.test");
    const m = await prisma.membership.findFirstOrThrow({ where: { user: { email: "buyer@kebabhouse.test" } } });
    await team.setMemberStatus(owner, m.id, "DISABLED");
    const u = await prisma.user.findUniqueOrThrow({ where: { email: "buyer@kebabhouse.test" } });
    const { loadContext } = await import("@/server/context");
    expect(await loadContext(u.id, "s", null)).toBeNull();
    await team.setMemberStatus(owner, m.id, "ACTIVE");
  });

  it("regional manager is scoped to the assigned regions", async () => {
    const rm = await ctxFor("rm.lisboa@firingi.test");
    expect(rm.scopes.length).toBe(2);
    expect(rm.permissions.has("admin.finance.view")).toBe(false);
  });
});
