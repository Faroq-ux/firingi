import { describe, expect, it } from "vitest";
import { ADMIN_NAV } from "@/config/nav/admin";
import { BUY_NAV, VENDOR_NAV } from "@/config/nav/portals";
import { allItems, findNavItem, resolveNav } from "@/config/nav/resolve";
import { ALL_PERMISSION_CODES, type PermissionCode } from "@/server/rbac/permissions";
import { checkCompanyVat, isValidPtNif, makePtNif } from "@/lib/tax-id";

describe("admin sidebar", () => {
  it("has all 22 sections (Inventory & Warehouses added in Phase 24, Till (POS) in Phase 47)", () => {
    expect(ADMIN_NAV).toHaveLength(22);
  });
  it("vendors section has Distributors, Wholesalers, Vendor Management (Plans + Early Payouts, Phase 36; Address Approvals, Phase 47d) and Supplier Compliance (Phase 28) groups", () => {
    const vendors = ADMIN_NAV.find((s) => s.key === "vendors")!;
    expect(vendors.groups!.map((g) => g.items.length)).toEqual([10, 10, 12, 5]);
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
    // Order lists also appear under Vendors / Customers for people with order access.
    expect(nav.map((s) => s.key)).toEqual(["dashboard", "orders", "vendors", "customers", "delivery"]);
    // …and returns + cold chain (order-related) under Delivery — nothing else from Delivery.
    expect(nav.find((s) => s.key === "delivery")!.items.map((i) => i.key)).toEqual(["/admin/delivery/returns", "/admin/delivery/cold-chain"]);
    expect(nav.find((s) => s.key === "vendors")!.groups.flatMap((g) => g.items).every((i) => i.key.endsWith("/orders"))).toBe(true);
    expect(nav[1].items.find((i) => i.key.endsWith("/split"))).toBeTruthy(); // order split is read-only: order viewers see it
  });
  it("resolves Portuguese labels with English fallback", () => {
    const nav = resolveNav(ADMIN_NAV, new Set(["admin.dashboard.view"]), "pt-PT");
    expect(nav[0].label).toBe("Painel");
    expect(nav[0].items[0].label).toBe("Visão Geral Executiva");
  });
  it("finds items by URL; every admin page is live", () => {
    expect(findNavItem("admin", "/admin/ai/demand-forecasting")?.item.phase).toBe("P17");
    expect(findNavItem("admin", "/admin/does-not-exist")).toBeNull();
    expect(allItems(ADMIN_NAV).filter((i) => !i.live).map((i) => i.href)).toEqual([]);
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

describe("company VAT number", () => {
  const PT = { code: "PT", vatPrefix: "PT" }, GR = { code: "GR", vatPrefix: "EL" };
  it("Portugal: PT + NIF", () => {
    expect(checkCompanyVat("pt 501 964 843", PT, "501964843")).toEqual({ ok: true, vat: "PT501964843" });
    expect(checkCompanyVat("PT999999990", PT, "501964843").ok).toBe(false);
    expect(checkCompanyVat("", PT, "501964843").ok).toBe(false);
  });
  it("uses the country's VAT prefix (Greece = EL)", () => {
    expect(checkCompanyVat("EL123456789", GR, "123456789").ok).toBe(true);
    expect(checkCompanyVat("GR123456789", GR, "123456789").ok).toBe(false);
  });
  it("accepts the non-EU Schengen formats (Norway, Switzerland)", () => {
    expect(checkCompanyVat("NO 923 609 016 MVA", { code: "NO", vatPrefix: "NO" }, "923609016")).toEqual({ ok: true, vat: "NO923609016MVA" });
    expect(checkCompanyVat("CHE-116.281.710 MWST", { code: "CH", vatPrefix: "CHE" }, "CHE116281710")).toEqual({ ok: true, vat: "CHE116281710MWST" });
    expect(checkCompanyVat("CHE12345", { code: "CH", vatPrefix: "CHE" }, "x").ok).toBe(false);
  });
});

describe("B2B only", () => {
  it("flags Portuguese individual NIFs (sole traders) for review", async () => {
    const { isIndividualPtNif } = await import("@/lib/tax-id");
    expect(isIndividualPtNif("215444448")).toBe(true);
    expect(isIndividualPtNif("515444448")).toBe(false);
  });
});
