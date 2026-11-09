import { describe, expect, it } from "vitest";
import { ADMIN_NAV } from "@/config/nav/admin";
import { BUY_NAV, VENDOR_NAV } from "@/config/nav/portals";
import { allItems, findNavItem, resolveNav } from "@/config/nav/resolve";
import { ALL_PERMISSION_CODES, type PermissionCode } from "@/server/rbac/permissions";
import { isValidPtNif, makePtNif } from "@/lib/tax-id";

describe("admin sidebar", () => {
  it("has all 20 sections", () => {
    expect(ADMIN_NAV).toHaveLength(20);
  });
  it("vendors section has Distributors, Wholesalers and Vendor Management groups with all sub-pages", () => {
    const vendors = ADMIN_NAV.find((s) => s.key === "vendors")!;
    expect(vendors.groups!.map((g) => g.items.length)).toEqual([10, 10, 9]);
  });
  it("every item has a unique key, a known permission and an admin URL", () => {
    const items = allItems(ADMIN_NAV);
    expect(new Set(items.map((i) => i.key)).size).toBe(items.length);
    for (const i of items) {
      expect(i.href.startsWith("/admin/")).toBe(true);
      expect(i.permission.length).toBeGreaterThan(0);
      i.permission.forEach((p) => expect(ALL_PERMISSION_CODES).toContain(p));
    }
  });
  it("hides sections the user has no permission for", () => {
    const support = new Set<PermissionCode>(["admin.dashboard.view", "admin.orders.view"]);
    const nav = resolveNav(ADMIN_NAV, support, "en");
    expect(nav.map((s) => s.key)).toEqual(["dashboard", "orders"]);
    expect(nav[1].items.find((i) => i.key.endsWith("/split"))).toBeUndefined(); // needs admin.orders.manage
  });
  it("resolves Portuguese labels with English fallback", () => {
    const nav = resolveNav(ADMIN_NAV, new Set(["admin.dashboard.view"]), "pt-PT");
    expect(nav[0].label).toBe("Painel");
    expect(nav[0].items[0].label).toBe("Visão Geral Executiva");
  });
  it("finds placeholder items by URL", () => {
    expect(findNavItem("admin", "/admin/ai/demand-forecasting")?.item.phase).toBe("LATER");
    expect(findNavItem("admin", "/admin/does-not-exist")).toBeNull();
  });
  it("vendor and buyer portals expose team pages", () => {
    expect(allItems(VENDOR_NAV).some((i) => i.href === "/vendor/company/users" && i.live)).toBe(true);
    expect(allItems(BUY_NAV).some((i) => i.href === "/buy/company/roles" && i.live)).toBe(true);
  });
});

describe("Portuguese NIF", () => {
  it("validates check digits", () => {
    expect(makePtNif("50196484")).toBe("501964843");
    expect(isValidPtNif("501964843")).toBe(true);
    expect(isValidPtNif("501964846")).toBe(false);
    expect(isValidPtNif(makePtNif("51012345"))).toBe(true);
    expect(isValidPtNif("12345")).toBe(false);
  });
});
