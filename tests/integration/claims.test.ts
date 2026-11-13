/**
 * Phase 31: quality claims — the customer reports a problem with photos within the window, the
 * supplier gives its side, FIRINGI decides (credit note / replacement / rejection) and who pays:
 * supplier faults go on a credit statement (netted off its payout); a FIRINGI driver can only be
 * charged on deliveries the customer paid a delivery fee for, capped at the per-delivery pay.
 */
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { addToCart, clearCart } from "@/server/services/cart";
import { changeOrderStatus, confirmOrder, placeOrder } from "@/server/services/orders";
import { setStock } from "@/server/services/vendor-catalogue";
import { assignDelivery, completeDelivery, pickUp, startDelivery } from "@/server/services/deliveries";
import { approvalSettings } from "@/server/approvals/gate";
import { decideApproval, saveApprovalSettings } from "@/server/approvals/service";
import { duePayouts } from "@/server/services/payouts";
import { supplierScorecards } from "@/server/services/performance";
import { driverEarnings, periodFrom } from "@/server/services/route-stats";
import { routingSettings } from "@/server/services/routes";
import * as claims from "@/server/claims/service";
import { ctxFor, pngFile } from "../helpers";

const KEBAB = "owner@kebabhouse.test";
const LX_OWNER = "owner@lisboacentral.test";
const OPS = "ops@firingi.test";
const SA = "superadmin@firingi.test";
const FIR_DRIVER = "driver@firingi.test";

afterAll(async () => { await prisma.$disconnect(); });

async function order(sku: string, qty: number, unitsPerPack?: number) {
  const kebab = await ctxFor(KEBAB);
  const lx = await ctxFor(LX_OWNER);
  await clearCart(kebab);
  const offer = await prisma.vendorOffer.findFirstOrThrow({ where: { vendorCompanyId: lx.company.id, status: "ACTIVE", packaging: { variant: { sku }, ...(unitsPerPack ? { unitsPerPack } : {}) } } });
  const wh = await prisma.address.findFirstOrThrow({ where: { companyId: lx.company.id, kind: { in: ["WAREHOUSE", "PICKUP"] } } });
  const cur = await prisma.stockLevel.findUnique({ where: { offerId_addressId: { offerId: offer.id, addressId: wh.id } } });
  await setStock(lx, offer.id, wh.id, Math.max(800, (cur?.reserved ?? 0) + 500));
  await addToCart(kebab, offer.id, qty);
  const addr = await prisma.address.findFirstOrThrow({ where: { companyId: kebab.company.id, kind: "DELIVERY", isActive: true }, orderBy: { isDefault: "desc" } });
  const { id } = await placeOrder(kebab, { deliveryAddressId: addr.id });
  await confirmOrder(lx, id, {});
  const d = await prisma.delivery.findUniqueOrThrow({ where: { orderId: id } });
  return { orderId: id, deliveryId: d.id, mode: d.mode };
}
/** Supplier's own fleet (a large order): the supplier moves it to DELIVERED. */
async function supplierDelivered() {
  const o = await order("FIR-PIZZABOX33", 8);
  const lx = await ctxFor(LX_OWNER);
  for (const s of ["READY_FOR_PICKUP", "DISPATCHED", "OUT_FOR_DELIVERY", "DELIVERED"] as const) await changeOrderStatus(lx, o.orderId, s);
  return o;
}
/** FIRINGI fleet (a small order with a delivery fee), delivered by the FIRINGI driver. */
async function firingiDelivered() {
  const o = await order("FIR-MOZZ2", 5, 1);
  expect(o.mode).toBe("FIRINGI_FLEET");
  const ops = await ctxFor(OPS);
  const driver = await prisma.driver.findFirstOrThrow({ where: { user: { email: FIR_DRIVER } } });
  await prisma.delivery.updateMany({ where: { driverId: driver.id, status: "ASSIGNED", id: { not: o.deliveryId } }, data: { driverId: null, status: "UNASSIGNED", routeId: null } });
  await prisma.driver.update({ where: { id: driver.id }, data: { availability: "AVAILABLE" } });
  await assignDelivery(ops, o.deliveryId, { driverId: driver.id });
  await changeOrderStatus(await ctxFor(LX_OWNER), o.orderId, "READY_FOR_PICKUP");
  const drv = await ctxFor(FIR_DRIVER);
  await pickUp(drv, o.deliveryId);
  await startDelivery(drv, o.deliveryId);
  await completeDelivery(drv, o.deliveryId, { recipientName: "Ahmed Kebab", signature: pngFile("sig.png") });
  return { ...o, driverId: driver.id };
}

describe("customer claims", () => {
  it("window, photos, quantities; supplier answers; privacy of prices", async () => {
    const kebab = await ctxFor(KEBAB);
    const lx = await ctxFor(LX_OWNER);
    const o = await order("FIR-PIZZABOX33", 8);
    await expect(claims.createClaim(kebab, o.orderId, { reason: "DAMAGED", description: "Crushed", preferredOutcome: "CREDIT", lines: [] })).rejects.toThrow(/after delivery/);
    for (const s of ["READY_FOR_PICKUP", "DISPATCHED", "OUT_FOR_DELIVERY", "DELIVERED"] as const) await changeOrderStatus(lx, o.orderId, s);

    const c = await claims.claimableOrder(kebab, o.orderId);
    expect(c.open).toBe(true);
    const line = c.lines[0];
    expect(line.claimable).toBe(8);
    await expect(claims.createClaim(kebab, o.orderId, { reason: "DAMAGED", description: "3 boxes crushed", preferredOutcome: "CREDIT", lines: [{ orderLineId: line.id, qty: 3 }] })).rejects.toThrow(/photo/);
    await expect(claims.createClaim(kebab, o.orderId, { reason: "MISSING", description: "Too many", preferredOutcome: "CREDIT", lines: [{ orderLineId: line.id, qty: 9 }] })).rejects.toThrow(/more than was delivered/);
    await expect(claims.createClaim(lx, o.orderId, { reason: "MISSING", description: "Not mine", preferredOutcome: "CREDIT", lines: [{ orderLineId: line.id, qty: 1 }] })).rejects.toThrow();
    const cl = await claims.createClaim(kebab, o.orderId, { reason: "DAMAGED", description: "3 boxes crushed", preferredOutcome: "CREDIT", lines: [{ orderLineId: line.id, qty: 3 }], photos: [pngFile("crushed.png")] });
    expect(cl.number).toMatch(/^CL-\d{4}-\d{6}$/);
    expect((await claims.claimableOrder(kebab, o.orderId)).lines[0].claimable).toBe(5);

    // The customer sees what it paid, never the supplier's cost; the supplier sees its cost, never the sale price.
    const asBuyer = await claims.claimDetail(kebab, cl.id);
    expect(asBuyer.lines[0].unitGross).toBeGreaterThan(0);
    expect(asBuyer.lines[0].unitCost).toBeNull();
    expect(asBuyer.delivery).toBeNull();
    const asSeller = await claims.claimDetail(lx, cl.id);
    expect(asSeller.lines[0].unitGross).toBeNull();
    expect(asSeller.lines[0].unitCost).toBeGreaterThan(0);
    expect(asSeller.invoice).toBeNull();

    await expect(claims.respondAsSupplier(lx, cl.id, { response: "DISPUTED", comment: "" })).rejects.toThrow(/Explain/);
    await claims.respondAsSupplier(lx, cl.id, { response: "ACCEPTED", comment: "Sorry — packed badly." });
    await claims.addClaimMessage(kebab, cl.id, { body: "Photos attached above." });
    const ops = await ctxFor(OPS);
    await claims.addClaimMessage(ops, cl.id, { body: "Checking the packing photos.", internal: true });
    expect((await claims.claimDetail(kebab, cl.id)).messages.some((m) => m.internal)).toBe(false);
    expect((await claims.claimDetail(ops, cl.id)).messages.some((m) => m.internal)).toBe(true);
    expect((await claims.listClaims(lx, "VENDOR")).some((x) => x.id === cl.id && x.credit === null)).toBe(true);

    // Only FIRINGI decides.
    await expect(claims.decideClaim(lx, cl.id, { decision: "APPROVE", fault: "SUPPLIER", lines: [] })).rejects.toThrow();
    await claims.withdrawClaim(kebab, cl.id);
    expect((await claims.claimableOrder(kebab, o.orderId)).lines[0].claimable).toBe(8);
  });

  it("supplier at fault: credit note, credit statement, charge-back netted off the payout, scorecard", async () => {
    const kebab = await ctxFor(KEBAB);
    const lx = await ctxFor(LX_OWNER);
    const ops = await ctxFor(OPS);
    const o = await supplierDelivered();
    const line = (await claims.claimableOrder(kebab, o.orderId)).lines[0];
    const cl = await claims.createClaim(kebab, o.orderId, { reason: "DAMAGED", description: "Two boxes wet", preferredOutcome: "CREDIT", lines: [{ orderLineId: line.id, qty: 3 }], photos: [pngFile()] });
    const l = (await claims.claimDetail(ops, cl.id)).lines[0];
    expect((await claims.claimDetail(ops, cl.id)).delivery!.driverChargeback.why).toBe("SUPPLIER_FLEET");

    await expect(claims.decideClaim(ops, cl.id, { decision: "APPROVE", fault: "DRIVER", lines: [{ lineId: l.id, approvedQty: 2 }] })).rejects.toThrow(/own fleet/);
    await expect(claims.decideClaim(ops, cl.id, { decision: "APPROVE", outcome: "REPLACEMENT", fault: "FIRINGI", lines: [{ lineId: l.id, approvedQty: 2 }] })).rejects.toThrow(/only when the supplier is at fault/);
    await expect(claims.decideClaim(ops, cl.id, { decision: "APPROVE", fault: "SUPPLIER", lines: [{ lineId: l.id, approvedQty: 4 }] })).rejects.toThrow(/claimed quantity/);
    await expect(claims.decideClaim(ops, cl.id, { decision: "REJECT", fault: "CUSTOMER", note: "" })).rejects.toThrow(/reason/);

    const r = await claims.decideClaim(ops, cl.id, { decision: "APPROVE", outcome: "CREDIT", fault: "SUPPLIER", lines: [{ lineId: l.id, approvedQty: 2 }], note: "Wet boxes confirmed." });
    expect(r.creditNote).toBeTruthy();
    const after = await prisma.qualityClaim.findUniqueOrThrow({ where: { id: cl.id }, include: { chargebacks: true } });
    expect(after.status).toBe("APPROVED");
    const cn = await prisma.invoice.findUniqueOrThrow({ where: { id: after.creditNoteId! }, include: { lines: true } });
    expect(Number(after.creditGross)).toBe(Number(cn.grossTotal)); // the claim shows exactly what the credit note says
    expect(Math.abs(Number(after.creditGross) - l.unitGross! * 2)).toBeLessThanOrEqual(0.02);
    expect(cn.docType).toBe("CREDIT_NOTE");
    expect(Number(cn.lines[0].qty)).toBe(2);
    const st = await prisma.vendorBillingStatement.findFirstOrThrow({ where: { salesInvoiceId: cn.id, isCreditStatement: true } });
    expect(after.chargebacks).toHaveLength(1);
    expect(after.chargebacks[0]).toMatchObject({ target: "SUPPLIER", status: "OPEN", statementId: st.id });
    expect(Number(after.chargebacks[0].amount)).toBeCloseTo(Number(st.expectedGross), 2);
    expect(Number(st.expectedNet)).toBeCloseTo(l.unitCost! * 2, 1); // the supplier credits its cost, not the sale price

    // The supplier sees the decision and its charge-back — not the customer's credit amount.
    const seen = await claims.claimDetail(lx, cl.id);
    expect(seen.decision!.credit).toBeNull();
    expect(seen.chargebacks).toHaveLength(1);
    expect((await claims.claimDetail(kebab, cl.id)).chargebacks).toHaveLength(0);
    expect((await claims.claimableOrder(kebab, o.orderId)).lines[0].claimable).toBe(6); // 8 − 2 approved

    // Dispute → FIRINGI upholds; the payouts list nets it off.
    const cbId = after.chargebacks[0].id;
    await expect(claims.disputeChargeback(kebab, cbId, "Not ours")).rejects.toThrow();
    await claims.disputeChargeback(lx, cbId, "The driver dropped the pallet.");
    expect((await prisma.vendorBillingStatement.findUniqueOrThrow({ where: { id: st.id } })).status).toBe("DISPUTED");
    await claims.resolveChargeback(ops, cbId, { action: "UPHOLD", note: "Packing photos show wet boxes before loading." });
    expect((await prisma.vendorBillingStatement.findUniqueOrThrow({ where: { id: st.id } })).status).toBe("OPEN");
    const pay = await duePayouts(await ctxFor(SA));
    expect(pay.totals.claimDeductions).toBeGreaterThan(0);
    expect((await claims.listChargebacks(lx, "VENDOR")).some((x) => x.id === cbId && x.status === "OPEN")).toBe(true);

    // Settles when the supplier's credit note is matched.
    await prisma.vendorBillingStatement.update({ where: { id: st.id }, data: { status: "MATCHED" } });
    expect(await claims.syncChargebacks()).toBeGreaterThanOrEqual(1);
    expect((await prisma.claimChargeback.findUniqueOrThrow({ where: { id: cbId } })).status).toBe("DEDUCTED");

    const year = { from: new Date(Date.now() - 365 * 86400_000), to: new Date() };
    const sc = (await supplierScorecards(await ctxFor(SA), "ALL", year)).find((s) => s.id === lx.company.id)!;
    expect(sc.claims).toBeGreaterThanOrEqual(1);
    expect(sc.claimRate).toBeGreaterThan(0);
    await expect(claims.decideClaim(ops, cl.id, { decision: "REJECT", fault: "CUSTOMER", note: "Too late now" })).rejects.toThrow(/already decided/);
  });

  it("replacement: the supplier delivers again, no credit; waiving a charge-back closes the statement", async () => {
    const kebab = await ctxFor(KEBAB);
    const lx = await ctxFor(LX_OWNER);
    const ops = await ctxFor(OPS);
    const o = await supplierDelivered();
    const line = (await claims.claimableOrder(kebab, o.orderId)).lines[0];
    const cl = await claims.createClaim(kebab, o.orderId, { reason: "WRONG_PRODUCT", description: "Got 28cm boxes", preferredOutcome: "REPLACEMENT", lines: [{ orderLineId: line.id, qty: 2 }], photos: [pngFile()] });
    const l = (await claims.claimDetail(ops, cl.id)).lines[0];
    const r = await claims.decideClaim(ops, cl.id, { decision: "APPROVE", outcome: "REPLACEMENT", fault: "SUPPLIER", lines: [{ lineId: l.id, approvedQty: 2 }] });
    expect(r.creditNote).toBeNull();
    expect((await claims.claimDetail(kebab, cl.id)).can.replace).toBe(false);
    expect((await claims.claimDetail(lx, cl.id)).can.replace).toBe(true);
    await claims.markReplacementDone(lx, cl.id);
    expect((await prisma.qualityClaim.findUniqueOrThrow({ where: { id: cl.id } })).replacementDoneAt).not.toBeNull();
    await expect(claims.markReplacementDone(lx, cl.id)).rejects.toThrow(/No replacement/);

    // A second claim, credited, then the charge-back waived → FIRINGI carries it, statement closed.
    const cl2 = await claims.createClaim(kebab, o.orderId, { reason: "MISSING", description: "One box short", preferredOutcome: "CREDIT", lines: [{ orderLineId: line.id, qty: 1 }] });
    const l2 = (await claims.claimDetail(ops, cl2.id)).lines[0];
    await claims.decideClaim(ops, cl2.id, { decision: "APPROVE", outcome: "CREDIT", fault: "SUPPLIER", lines: [{ lineId: l2.id, approvedQty: 1 }] });
    const cb = await prisma.claimChargeback.findFirstOrThrow({ where: { claimId: cl2.id } });
    await expect(claims.resolveChargeback(ops, cb.id, { action: "WAIVE", note: "" })).rejects.toThrow(/why/);
    await claims.resolveChargeback(ops, cb.id, { action: "WAIVE", note: "Goodwill — first incident." });
    expect((await prisma.claimChargeback.findUniqueOrThrow({ where: { id: cb.id } })).status).toBe("WAIVED");
    expect((await prisma.vendorBillingStatement.findUniqueOrThrow({ where: { id: cb.statementId! } })).status).toBe("CLOSED");
  });

  it("FIRINGI driver at fault: FIRINGI credits, the driver is charged only on fee-paid deliveries, capped at the pay", async () => {
    const kebab = await ctxFor(KEBAB);
    const ops = await ctxFor(OPS);
    const { pay } = await routingSettings();
    const o = await firingiDelivered();
    const line = (await claims.claimableOrder(kebab, o.orderId)).lines[0];
    const cl = await claims.createClaim(kebab, o.orderId, { reason: "TEMPERATURE", description: "Arrived warm", preferredOutcome: "CREDIT", lines: [{ orderLineId: line.id, qty: 2 }], photos: [pngFile()] });
    const d = await claims.claimDetail(ops, cl.id);
    expect(d.delivery!.driverChargeback).toMatchObject({ eligible: true, cap: pay.perDelivery });
    const l = d.lines[0];
    await expect(claims.decideClaim(ops, cl.id, { decision: "APPROVE", fault: "DRIVER", lines: [{ lineId: l.id, approvedQty: 2 }], driverAmount: pay.perDelivery + 1 })).rejects.toThrow(/driver's pay/);
    await claims.decideClaim(ops, cl.id, { decision: "APPROVE", fault: "DRIVER", lines: [{ lineId: l.id, approvedQty: 2 }], creditDeliveryFee: true, driverAmount: pay.perDelivery });
    const after = await prisma.qualityClaim.findUniqueOrThrow({ where: { id: cl.id }, include: { chargebacks: true } });
    expect(Math.abs(Number(after.creditGross) - (l.unitGross! * 2 + d.invoice!.fee!))).toBeLessThanOrEqual(0.02);
    expect(after.chargebacks).toHaveLength(1);
    expect(after.chargebacks[0]).toMatchObject({ target: "DRIVER", driverId: o.driverId });
    // FIRINGI carries the goods credit: no credit statement for the supplier.
    expect(await prisma.vendorBillingStatement.count({ where: { salesInvoiceId: after.creditNoteId!, isCreditStatement: true } })).toBe(0);
    const earn = (await driverEarnings(ops, periodFrom({}))).rows.find((r) => r.id === o.driverId)!;
    expect(earn.deductions).toBeGreaterThanOrEqual(pay.perDelivery);
    expect(earn.total).toBeCloseTo(earn.gross - earn.deductions, 2);
    expect(earn.feePaid).toBeLessThanOrEqual(earn.delivered);
    await claims.resolveChargeback(ops, after.chargebacks[0].id, { action: "DEDUCTED", note: "Pay run November" });
    expect((await prisma.claimChargeback.findUniqueOrThrow({ where: { id: after.chargebacks[0].id } })).status).toBe("DEDUCTED");

    // Free delivery (no fee paid) → the driver earned no per-delivery pay → no charge-back.
    const o2 = await firingiDelivered();
    await prisma.order.update({ where: { id: o2.orderId }, data: { deliveryFeeNet: 0 } });
    const line2 = (await claims.claimableOrder(kebab, o2.orderId)).lines[0];
    const cl2 = await claims.createClaim(kebab, o2.orderId, { reason: "MISSING", description: "One short", preferredOutcome: "CREDIT", lines: [{ orderLineId: line2.id, qty: 1 }] });
    const d2 = await claims.claimDetail(ops, cl2.id);
    expect(d2.delivery!.driverChargeback).toMatchObject({ eligible: false, cap: 0, why: "FREE_DELIVERY" });
    await expect(claims.decideClaim(ops, cl2.id, { decision: "APPROVE", fault: "DRIVER", lines: [{ lineId: d2.lines[0].id, approvedQty: 1 }], driverAmount: 1 })).rejects.toThrow(/no delivery fee/);
    await claims.decideClaim(ops, cl2.id, { decision: "APPROVE", fault: "DRIVER", lines: [{ lineId: d2.lines[0].id, approvedQty: 1 }] });
    expect(await prisma.claimChargeback.count({ where: { claimId: cl2.id } })).toBe(0);
  });

  it("big credits need a second person (four-eyes)", async () => {
    const kebab = await ctxFor(KEBAB);
    const ops = await ctxFor(OPS);
    const sa = await ctxFor(SA);
    const o = await supplierDelivered();
    const line = (await claims.claimableOrder(kebab, o.orderId)).lines[0];
    const cl = await claims.createClaim(kebab, o.orderId, { reason: "QUALITY", description: "Boxes too thin", preferredOutcome: "CREDIT", lines: [{ orderLineId: line.id, qty: 4 }], photos: [pngFile()] });
    const l = (await claims.claimDetail(ops, cl.id)).lines[0];
    const before = await approvalSettings();
    try {
      await saveApprovalSettings(sa, { enabled: true, creditNoteAbove: 1 });
      await expect(claims.decideClaim(ops, cl.id, { decision: "APPROVE", fault: "SUPPLIER", lines: [{ lineId: l.id, approvedQty: 4 }] })).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
      expect((await prisma.qualityClaim.findUniqueOrThrow({ where: { id: cl.id } })).status).toBe("OPEN");
      const req = await prisma.approvalRequest.findFirstOrThrow({ where: { kind: "CLAIM", status: "PENDING" }, orderBy: { requestedAt: "desc" } });
      await expect(decideApproval(ops, req.id, true, null)).rejects.toThrow(/second person/);
      await decideApproval(sa, req.id, true, null);
      const after = await prisma.qualityClaim.findUniqueOrThrow({ where: { id: cl.id } });
      expect(after.status).toBe("APPROVED");
      expect(after.creditNoteId).toBeTruthy();
    } finally { await saveApprovalSettings(sa, before); }
  });
});

describe("quality scores & alerts", () => {
  it("lot alerts, the daily job, settings and the supplier's own view", async () => {
    const sa = await ctxFor(SA);
    const lx = await ctxFor(LX_OWNER);
    const before = await claims.claimSettings();
    try {
      await expect(claims.saveClaimSettings(lx, { lotClaims: 1 })).rejects.toThrow();
      await expect(claims.saveClaimSettings(sa, { windowHours: 0 })).rejects.toThrow(/between/);
      await claims.saveClaimSettings(sa, { supplierRatePct: 0.1, minDeliveries: 1, driverClaims: 1 });
      const job = await claims.runClaimsJob();
      expect(job.alerts).toBeGreaterThanOrEqual(1);
      const open = await prisma.qualityAlert.findMany({ where: { status: "OPEN" } });
      const sup = open.find((a) => a.key === `SUPPLIER:${lx.company.id}`);
      expect(sup).toBeTruthy();
      expect(open.some((a) => a.kind === "DRIVER")).toBe(true);
      // Again → no duplicate open alert per key.
      await claims.runClaimsJob();
      expect(await prisma.qualityAlert.count({ where: { key: sup!.key, status: "OPEN" } })).toBe(1);
      const ov = await claims.qualityOverview(sa);
      expect(ov.suppliers.find((s) => s.id === lx.company.id)!.upheld).toBeGreaterThanOrEqual(1);
      expect(ov.byReason.reduce((a, r) => a + r.count, 0)).toBeGreaterThan(0);
      const mine = await claims.myQuality(lx);
      expect(mine.upheld).toBeGreaterThanOrEqual(1);
      expect(mine.alerts.some((a) => a.kind === "SUPPLIER_RATE")).toBe(true);
      await expect(claims.acknowledgeAlert(lx, sup!.id)).rejects.toThrow();
      await claims.acknowledgeAlert(sa, sup!.id);
      await claims.runClaimsJob();
      expect(await prisma.qualityAlert.count({ where: { key: sup!.key, status: "OPEN" } })).toBe(0); // not again within 30 days
    } finally {
      await prisma.setting.upsert({ where: { scope_scopeId_key: { scope: "GLOBAL", scopeId: "", key: "claims.settings" } }, update: { value: before }, create: { scope: "GLOBAL", key: "claims.settings", value: before } });
    }
  });
});
