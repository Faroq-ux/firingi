/**
 * Phase 16: risk checks at checkout — hold high risk (the supplier doesn't see it), flag
 * medium, FIRINGI releases / cancels / reviews; settings.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { addToCart, clearCart } from "@/server/services/cart";
import { changeOrderStatus, getOrder, listOrders, placeOrder } from "@/server/services/orders";
import { setStock } from "@/server/services/vendor-catalogue";
import { decideHeld, listAssessments, reviewAssessment, riskOverview, riskSettings, saveRiskSettings } from "@/server/risk/service";
import { ctxFor } from "../helpers";

const SA = "superadmin@firingi.test", KEBAB = "owner@kebabhouse.test", LX = "owner@lisboacentral.test";
let original: Awaited<ReturnType<typeof riskSettings>>;

async function order(qty: number) {
  const k = await ctxFor(KEBAB), lx = await ctxFor(LX);
  const offer = await prisma.vendorOffer.findFirstOrThrow({ where: { vendorCompanyId: lx.company.id, status: "ACTIVE", packaging: { variant: { sku: "FIR-MOZZ2" }, unitsPerPack: 1 } } });
  const wh = await prisma.address.findFirstOrThrow({ where: { companyId: lx.company.id, kind: { in: ["WAREHOUSE", "PICKUP"] } } });
  await setStock(lx, offer.id, wh.id, 5000);
  await clearCart(k);
  await addToCart(k, offer.id, qty);
  const addr = await prisma.address.findFirstOrThrow({ where: { companyId: k.company.id, kind: "DELIVERY", isActive: true }, orderBy: { isDefault: "desc" } });
  return placeOrder(k, { deliveryAddressId: addr.id });
}

beforeAll(async () => { original = await riskSettings(); });
afterAll(async () => { await saveRiskSettings(await ctxFor(SA), original); await prisma.$disconnect(); });

describe("risk at checkout", () => {
  it("only risk managers change the settings; thresholds must make sense", async () => {
    await expect(saveRiskSettings(await ctxFor("sales@firingi.test"), { holdScore: 10 })).rejects.toThrow();
    await expect(saveRiskSettings(await ctxFor(SA), { holdScore: 20, flagScore: 40 })).rejects.toThrow(/review score/);
  });

  it("a high-risk order is held: the supplier doesn't see it until FIRINGI releases it", async () => {
    const sa = await ctxFor(SA), lx = await ctxFor(LX), k = await ctxFor(KEBAB);
    // Make Kebab House count as a new account and 50 € a big order → NEW_ACCOUNT_BIG (60 points) → HIGH.
    await saveRiskSettings(sa, { ...original, enabled: true, newAccountDays: 100000, bigOrderAmount: 50, holdScore: 60, flagScore: 30, disabledRules: ["VELOCITY", "SPIKE", "FAR_ADDRESS", "NEW_ADDRESS", "NEW_USER", "CANCEL_HISTORY", "FIRST_ORDER_BIG"] });
    const r = await order(20);
    const o = await prisma.order.findUniqueOrThrow({ where: { id: r.id }, include: { risk: true } });
    expect(o.status).toBe("ON_HOLD");
    expect(o.risk).toMatchObject({ level: "HIGH", held: true, review: "OPEN" });
    expect((o.risk!.reasons as { rule: string }[]).map((x) => x.rule)).toContain("NEW_ACCOUNT_BIG");
    // supplier can't see it; buyer can
    await expect(getOrder(lx, r.id)).rejects.toThrow(/not found/i);
    expect((await listOrders(lx, "VENDOR")).rows.some((x) => x.id === r.id)).toBe(false);
    expect((await getOrder(k, r.id)).order.status).toBe("ON_HOLD");
    expect(await prisma.notification.count({ where: { type: "order.held", user: { email: KEBAB } } })).toBeGreaterThan(0);
    expect((await listAssessments(sa)).some((a) => a.orderId === r.id)).toBe(true);
    // stock stays reserved while held
    expect(await prisma.stockMovement.count({ where: { orderId: r.id } })).toBeGreaterThan(0);

    await expect(decideHeld(await ctxFor("sales@firingi.test"), r.id, "RELEASE", null)).rejects.toThrow();
    await expect(decideHeld(sa, r.id, "CANCEL", "")).rejects.toThrow(/reason/);
    await decideHeld(sa, r.id, "RELEASE", "Called the customer");
    const after = await prisma.order.findUniqueOrThrow({ where: { id: r.id }, include: { risk: true } });
    expect(after.status).toBe("PENDING_CONFIRMATION");
    expect(after.risk!.review).toBe("CLEARED");
    expect((await getOrder(lx, r.id)).order.id).toBe(r.id);
    await expect(decideHeld(sa, r.id, "RELEASE", null)).rejects.toThrow(/isn't on hold/);
  });

  it("the buyer may cancel a held order; FIRINGI cancelling it marks it fraud", async () => {
    const sa = await ctxFor(SA), k = await ctxFor(KEBAB);
    const a = await order(20);
    await changeOrderStatus(k, a.id, "CANCELLED", "Changed my mind");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("CANCELLED");
    const b = await order(20);
    await decideHeld(sa, b.id, "CANCEL", "Fake account");
    expect(await prisma.riskAssessment.findUniqueOrThrow({ where: { orderId: b.id } })).toMatchObject({ review: "FRAUD", note: "Fake account" });
  });

  it("medium risk goes through and waits for a review; low risk is just recorded", async () => {
    const sa = await ctxFor(SA);
    await saveRiskSettings(sa, { ...original, enabled: true, newAccountDays: 100000, bigOrderAmount: 50, holdScore: 100, flagScore: 30, disabledRules: ["VELOCITY", "SPIKE", "FAR_ADDRESS", "NEW_ADDRESS", "NEW_USER", "CANCEL_HISTORY", "FIRST_ORDER_BIG"] });
    const r = await order(20);
    const o = await prisma.order.findUniqueOrThrow({ where: { id: r.id }, include: { risk: true } });
    expect(o.status).toBe("PENDING_CONFIRMATION");
    expect(o.risk).toMatchObject({ level: "MEDIUM", held: false });
    await expect(reviewAssessment(sa, o.risk!.id, "FRAUD", "")).rejects.toThrow(/Note/);
    await reviewAssessment(sa, o.risk!.id, "CLEARED", null);
    expect((await prisma.riskAssessment.findUniqueOrThrow({ where: { id: o.risk!.id } })).review).toBe("CLEARED");

    await saveRiskSettings(sa, { ...original, enabled: false });
    const r2 = await order(20);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: r2.id }, include: { risk: true } })).risk).toBeNull();
    const ov = await riskOverview(sa);
    expect(ov.checks).toBeGreaterThan(0);
    expect(ov.byRule.find((x) => x.rule === "NEW_ACCOUNT_BIG")!.count).toBeGreaterThan(0);
  });
});
