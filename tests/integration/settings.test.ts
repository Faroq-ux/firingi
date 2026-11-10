/**
 * Phase 11: marketplace / order / vendor / customer settings, and API keys.
 */
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { addToCart, clearCart } from "@/server/services/cart";
import { changeOrderStatus, getOrder, placeOrder } from "@/server/services/orders";
import { setStock } from "@/server/services/vendor-catalogue";
import { registerCompany } from "@/server/services/registration";
import { DEFAULT_PLATFORM, offerApprovalSetting, platformSettings, updatePlatformSettings } from "@/server/services/platform-settings";
import { createApiKey, listApiKeys, resolveApiKey, revokeApiKey, scopePermissions } from "@/server/services/api-keys";
import { ctxFor } from "../helpers";

const SA = "superadmin@firingi.test";
afterEach(() => prisma.setting.deleteMany({ where: { key: { in: ["platform.settings"] } } }));
afterAll(() => prisma.$disconnect());

async function placeMozz() {
  const kebab = await ctxFor("owner@kebabhouse.test");
  const lx = await ctxFor("owner@lisboacentral.test");
  const offer = await prisma.vendorOffer.findFirstOrThrow({ where: { vendorCompanyId: lx.company.id, packaging: { variant: { sku: "FIR-MOZZ2" }, unitsPerPack: 1 } } });
  const wh = await prisma.address.findFirstOrThrow({ where: { companyId: lx.company.id, kind: { in: ["WAREHOUSE", "PICKUP"] } } });
  await setStock(lx, offer.id, wh.id, 900);
  await clearCart(kebab);
  await addToCart(kebab, offer.id, 10);
  const addr = await prisma.address.findFirstOrThrow({ where: { companyId: kebab.company.id, kind: "DELIVERY", isActive: true } });
  return { kebab, addr };
}

describe("platform settings", () => {
  it("defaults, validation, Super Admin only", async () => {
    expect(await platformSettings()).toEqual(DEFAULT_PLATFORM);
    const sa = await ctxFor(SA);
    await expect(updatePlatformSettings(sa, { supportEmail: "nope" })).rejects.toThrow(/support e-mail/);
    await expect(updatePlatformSettings(sa, { maxRequestedDays: 0 })).rejects.toThrow(/1–180/);
    await expect(updatePlatformSettings(await ctxFor("ops@firingi.test"), { notice: "x" })).rejects.toThrow();
    const before = await offerApprovalSetting();
    await updatePlatformSettings(sa, { notice: "  Maintenance Sunday 22:00  ", offerApprovalRequired: !before });
    expect((await platformSettings()).notice).toBe("Maintenance Sunday 22:00");
    expect(await offerApprovalSetting()).toBe(!before);
    await updatePlatformSettings(sa, { offerApprovalRequired: before });
  });

  it("closed registrations refuse new applications", async () => {
    await updatePlatformSettings(await ctxFor(SA), { registrations: { ...DEFAULT_PLATFORM.registrations, CUSTOMER: false } });
    await expect(registerCompany({ type: "CUSTOMER" } as never)).rejects.toThrow(/paused/);
  });

  it("buyer cancellation can be switched off; requested delivery date is limited", async () => {
    const { kebab, addr } = await placeMozz();
    const far = new Date(Date.now() + 60 * 86400_000);
    await expect(placeOrder(kebab, { deliveryAddressId: addr.id, requestedDeliveryDate: far })).rejects.toThrow(/between today and 30 days/);
    const { id } = await placeOrder(kebab, { deliveryAddressId: addr.id, requestedDeliveryDate: new Date(Date.now() + 5 * 86400_000) });
    expect((await getOrder(kebab, id)).allowed).toContain("CANCELLED");
    await updatePlatformSettings(await ctxFor(SA), { buyerCanCancel: false });
    expect((await getOrder(kebab, id)).allowed).not.toContain("CANCELLED");
    await expect(changeOrderStatus(kebab, id, "CANCELLED", "changed my mind")).rejects.toThrow(/contact FIRINGI/);
    await changeOrderStatus(await ctxFor("ops@firingi.test"), id, "CANCELLED", "on request");
  });
});

describe("API keys", () => {
  it("created for a company user, resolved from the bearer header, scoped, revocable", async () => {
    const sa = await ctxFor(SA);
    const kebab = await ctxFor("owner@kebabhouse.test");
    await expect(createApiKey(sa, { companyId: kebab.company.id, userId: kebab.user.id, name: "POS", scopes: [] })).rejects.toThrow(/scope/);
    await expect(createApiKey(sa, { companyId: sa.company.id, userId: sa.user.id, name: "Internal", scopes: ["orders.read"] })).rejects.toThrow(/supplier or buyer/);
    await expect(createApiKey(await ctxFor("ops@firingi.test"), { companyId: kebab.company.id, userId: kebab.user.id, name: "x", scopes: ["orders.read"] })).rejects.toThrow();
    const { id, key } = await createApiKey(sa, { companyId: kebab.company.id, userId: kebab.user.id, name: "POS", scopes: ["orders.read", "bogus"] });
    expect(key).toMatch(/^fk_live_/);
    const row = await prisma.apiKey.findUniqueOrThrow({ where: { id } });
    expect(row.hash).not.toContain(key.slice(8)); // only the hash is stored
    expect(row.scopes).toEqual(["orders.read"]);
    expect((await resolveApiKey(`Bearer ${key}`))?.id).toBe(id);
    expect(await resolveApiKey(`Bearer ${key}x`)).toBeNull();
    expect(await resolveApiKey("Basic abc")).toBeNull();
    expect([...scopePermissions(["orders.read"])]).toContain("buyer.orders.view");
    expect([...scopePermissions(["catalogue.read"])]).toEqual(["buyer.catalogue.view"]);
    expect((await listApiKeys(sa)).find((k) => k.id === id)?.user?.email).toBe("owner@kebabhouse.test");
    await revokeApiKey(sa, id);
    expect(await resolveApiKey(`Bearer ${key}`)).toBeNull();
    await expect(revokeApiKey(sa, id)).rejects.toThrow();
  });
});
