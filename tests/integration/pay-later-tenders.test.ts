/**
 * Phase 50: pay later + open tenders.
 * Pay later — FIRINGI's switches; checkout options and fees; FIRINGI's own credit (limit, the fee line on the
 * invoice — VAT exempt, the due date, instalments paid / reminded / overdue, overdue blocks new pay later); the
 * gateway partner (approves, pays FIRINGI the invoice through the job; declines → own credit); a cancelled order
 * ends its plan.
 * Tenders — a customer posts; only eligible suppliers see it (sealed: one supplier never sees another's bid); bids
 * per line with the supplier's own offers; the buyer sees ranked selling prices; award per line → one order per
 * supplier at the bid prices; won / lost; the job closes bidding; FIRINGI's switches.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import * as P from "@/server/pay-later/service";
import * as T from "@/server/tenders/service";
import { changeOrderStatus, confirmOrder, placeOrder } from "@/server/services/orders";
import { setStock } from "@/server/services/vendor-catalogue";
import { DEFAULT_PAY_LATER, type PayLaterSettings } from "@/lib/pay-later";
import { DEFAULT_TENDER_SETTINGS, type TenderSettings } from "@/lib/tenders";
import { ctxFor, makeApprovedCompany, makeOffers } from "../helpers";

const SA = "superadmin@firingi.test", LX = "owner@lisboacentral.test", AL = "owner@ccalmada.test", KEBAB = "owner@kebabhouse.test";
const LXN = "Grossista Lisboa Central, Lda", ALN = "Cash & Carry Almada, Lda";
const DAY = 86_400_000;
let lxId = "", alId = "", kebabId = "", offer = "", productId = "", alOffer = "";
const orders: string[] = [], tenders: string[] = [];

async function plSettings(p: Partial<PayLaterSettings> = {}) { return P.savePayLaterSettings(await ctxFor(SA), { ...DEFAULT_PAY_LATER, ...p }); }
async function tSettings(p: Partial<TenderSettings> = {}) { return T.saveTenderSettings(await ctxFor(SA), { ...DEFAULT_TENDER_SETTINGS, ...p }); }
async function addr(companyId: string) { return (await prisma.address.findFirstOrThrow({ where: { companyId, kind: "DELIVERY", isActive: true }, orderBy: { isDefault: "desc" } })).id; }
async function priced(vendorId: string, offerId: string, price: number) {
  const list = await prisma.priceList.findFirstOrThrow({ where: { vendorCompanyId: vendorId, scope: "BASE", isActive: true } });
  await prisma.priceListItem.create({ data: { priceListId: list.id, offerId, minQty: 1, unitPriceNet: price.toFixed(4) } });
  const wh = (await prisma.address.findFirstOrThrow({ where: { companyId: vendorId, kind: { in: ["WAREHOUSE", "PICKUP"] } } })).id;
  await setStock(await ctxFor(vendorId === lxId ? LX : AL), offerId, wh, 5000);
}
async function order(qty: number, termId: string | null) {
  const kb = await ctxFor(KEBAB);
  const r = await placeOrder(kb, { deliveryAddressId: await addr(kebabId), items: [{ offerId: offer, qty }], approved: true, payLater: termId ? { termId } : null });
  orders.push(r.id);
  return r.id;
}
async function deliver(id: string) {
  await confirmOrder(await ctxFor(LX), id, {});
  for (const s of ["READY_FOR_PICKUP", "DISPATCHED", "OUT_FOR_DELIVERY", "DELIVERED"] as const) await changeOrderStatus(await ctxFor(SA), id, s);
  return prisma.invoice.findFirstOrThrow({ where: { orderId: id, docType: "INVOICE" }, include: { lines: true } });
}
async function pay(companyId: string, invoiceId: string, amount: number) {
  const p = await prisma.payment.create({ data: { companyId, direction: "INBOUND", method: "BANK_TRANSFER", amount: amount.toFixed(2), status: "CONFIRMED", paidAt: new Date() } });
  await prisma.paymentAllocation.create({ data: { paymentId: p.id, invoiceId, amount: amount.toFixed(2) } });
}

beforeAll(async () => {
  process.env.PAYLATER_SIMULATE = "1";
  await prisma.setting.deleteMany({ where: { key: { in: ["paylater.settings", "tenders.settings"] } } });
  await prisma.companyFeature.deleteMany({ where: { key: { in: ["PAY_LATER", "TENDERS"] } } });
  lxId = (await ctxFor(LX)).company.id; alId = (await ctxFor(AL)).company.id; kebabId = (await ctxFor(KEBAB)).company.id;
  await prisma.payLaterPlan.deleteMany({ where: { companyId: kebabId } });
  await prisma.payLaterAccount.deleteMany({ where: { companyId: kebabId } });
  const o = await makeOffers([LXN, ALN]);
  offer = o[LXN]; alOffer = o[ALN];
  productId = (await prisma.vendorOffer.findUniqueOrThrow({ where: { id: offer }, select: { packaging: { select: { variant: { select: { productId: true } } } } } })).packaging.variant.productId;
  await priced(lxId, offer, 10); await priced(alId, alOffer, 10);
  await prisma.company.update({ where: { id: kebabId }, data: { creditLimit: null } });
});
afterAll(async () => {
  await prisma.tender.deleteMany({ where: { id: { in: tenders } } });
  await prisma.setting.deleteMany({ where: { key: { in: ["paylater.settings", "tenders.settings"] } } });
  await prisma.companyFeature.deleteMany({ where: { key: { in: ["PAY_LATER", "TENDERS"] } } });
  await prisma.payLaterAccount.deleteMany({ where: { companyId: kebabId } });
  await prisma.$disconnect();
});

describe("pay later — switches and checkout", () => {
  it("FIRINGI's switches: off, type off, one business on / off", async () => {
    const kb = { id: kebabId, type: "CUSTOMER" };
    await plSettings({ enabled: false });
    expect((await P.access(kb)).why).toBe("OFF");
    await plSettings({ buyers: { CUSTOMER: false, WHOLESALER: true } });
    expect((await P.access(kb)).why).toBe("TYPE_OFF");
    await P.setCompanySwitch(await ctxFor(SA), kebabId, "ON");
    expect((await P.access(kb)).ok).toBe(true);
    await P.setCompanySwitch(await ctxFor(SA), kebabId, "OFF");
    expect((await P.access(kb)).why).toBe("COMPANY_OFF");
    await P.setCompanySwitch(await ctxFor(SA), kebabId, "DEFAULT");
    await plSettings();
    expect((await P.access(kb)).ok).toBe(true);
  });

  it("checkout options: the enabled terms with the buyer's fee and schedule; below the smallest order nothing", async () => {
    await plSettings({ countries: { PT: { partner: false, own: true, first: "OWN" } } });
    const o = await P.checkoutOptions(await ctxFor(KEBAB), 500);
    expect(o.available).toBe(true);
    expect(o.terms.map((t) => t.id)).toEqual(["d30", "d60", "d90", "i3"]);
    expect(o.terms.find((t) => t.id === "d60")!.fee).toBe(10); // 2 % of 500, the buyer pays
    expect(o.terms.find((t) => t.id === "i3")!.schedule).toHaveLength(3);
    expect((await P.checkoutOptions(await ctxFor(KEBAB), 20)).why).toBe("MIN_ORDER");
  });
});

describe("pay later — FIRINGI's own credit", () => {
  it("60 days: plan at checkout; the invoice carries the VAT-exempt fee and is due in 60 days", async () => {
    await plSettings({ countries: { PT: { partner: false, own: true, first: "OWN" } }, terms: DEFAULT_PAY_LATER.terms.map((t) => (t.id === "d60" ? { ...t, feePayer: "SHARED", buyerSharePct: 50 } : t)) });
    const id = await order(20, "d60");
    const plan = await prisma.payLaterPlan.findUniqueOrThrow({ where: { orderId: id } });
    expect(plan.model).toBe("OWN");
    const gross = Number(plan.amount);
    expect(Number(plan.buyerFee)).toBeCloseTo(Math.round(gross * 0.02 * 50) / 100, 2);
    expect(Number(plan.firingiFee) + Number(plan.buyerFee)).toBeCloseTo(Math.round(gross * 2) / 100, 2);
    const inv = await deliver(id);
    const fee = inv.lines.find((l) => l.description.startsWith("Taxa de pagamento a prazo"));
    expect(Number(fee!.lineNet)).toBe(Number(plan.buyerFee));
    expect(Number(fee!.taxRate)).toBe(0);
    const days = Math.round((inv.dueAt!.getTime() - inv.issuedAt!.getTime()) / DAY);
    expect(days).toBe(60);
    const after = await prisma.payLaterPlan.findUniqueOrThrow({ where: { orderId: id }, include: { instalments: true } });
    expect(after.status).toBe("INVOICED");
    expect(after.instalments).toHaveLength(1);
    expect(Number(after.instalments[0].amount)).toBe(Number(inv.grossTotal));
  });

  it("the own-credit limit counts what is still owed", async () => {
    await P.setOwnLimit(await ctxFor(SA), kebabId, 50);
    await expect(P.preparePayLater(await ctxFor(KEBAB), "d30", 300)).rejects.toThrow(/credit limit/);
    await P.setOwnLimit(await ctxFor(SA), kebabId, null);
  });

  it("3 instalments: paid in order; a late one → overdue (told), and no new pay later until paid", async () => {
    const id = await order(30, "i3");
    const inv = await deliver(id);
    const plan = await prisma.payLaterPlan.findUniqueOrThrow({ where: { orderId: id }, include: { instalments: { orderBy: { n: "asc" } } } });
    expect(plan.instalments).toHaveLength(3);
    expect(plan.instalments.reduce((a, i) => a + Number(i.amount), 0)).toBeCloseTo(Number(inv.grossTotal), 2);
    await pay(kebabId, inv.id, Number(plan.instalments[0].amount));
    await prisma.payLaterInstalment.update({ where: { id: plan.instalments[1].id }, data: { dueAt: new Date(Date.now() - 3 * DAY) } });
    const job = await P.runPayLaterJob();
    expect(job.overdue).toBeGreaterThanOrEqual(1);
    const now = await prisma.payLaterPlan.findUniqueOrThrow({ where: { orderId: id }, include: { instalments: { orderBy: { n: "asc" } } } });
    expect(now.instalments[0].paidAt).not.toBeNull();
    expect(now.instalments[1].overdueAt).not.toBeNull();
    expect(now.status).toBe("OVERDUE");
    expect((await P.access({ id: kebabId, type: "CUSTOMER" })).why).toBe("OVERDUE");
    // paid in full → the plan is paid, pay later is back
    await pay(kebabId, inv.id, Number(plan.instalments[1].amount) + Number(plan.instalments[2].amount));
    await P.runPayLaterJob();
    expect((await prisma.payLaterPlan.findUniqueOrThrow({ where: { orderId: id } })).status).toBe("PAID");
    expect((await P.access({ id: kebabId, type: "CUSTOMER" })).ok).toBe(true);
  });
});

describe("pay later — the gateway partner", () => {
  it("approves first; the job has the partner pay FIRINGI the invoice", async () => {
    await plSettings({ countries: { PT: { partner: true, own: true, first: "PARTNER" } } });
    const id = await order(15, "d30");
    const plan = await prisma.payLaterPlan.findUniqueOrThrow({ where: { orderId: id } });
    expect(plan.model).toBe("PARTNER");
    expect(plan.partnerRef).toMatch(/^SIM-/);
    const inv = await deliver(id);
    await P.runPayLaterJob();
    expect((await prisma.payLaterPlan.findUniqueOrThrow({ where: { orderId: id } })).status).toBe("PAID");
    const { openAmounts } = await import("@/server/payments/service");
    expect((await openAmounts([inv.id])).get(inv.id)!.toNumber()).toBe(0);
  });

  it("the partner declines → FIRINGI's own credit is used", async () => {
    process.env.PAYLATER_SIM_LIMIT = "50";
    const id = await order(20, "d30");
    expect((await prisma.payLaterPlan.findUniqueOrThrow({ where: { orderId: id } })).model).toBe("OWN");
    expect((await prisma.payLaterAccount.findUniqueOrThrow({ where: { companyId: kebabId } })).partnerStatus).toBe("DECLINED");
    delete process.env.PAYLATER_SIM_LIMIT;
  });

  it("a cancelled order ends its plan", async () => {
    const id = await order(5, "d30");
    await changeOrderStatus(await ctxFor(SA), id, "CANCELLED", "Test: buyer changed its mind");
    await P.runPayLaterJob();
    expect((await prisma.payLaterPlan.findUniqueOrThrow({ where: { orderId: id } })).status).toBe("CANCELLED");
  });
});

describe("open tenders", () => {
  let tid = "";
  it("a customer posts; checks the closing time; only eligible suppliers see it", async () => {
    await tSettings();
    const kb = await ctxFor(KEBAB);
    const base = { title: "Refrigerantes para dezembro", addressId: await addr(kebabId), deliveryDate: new Date(Date.now() + 7 * DAY).toISOString().slice(0, 10), lines: [{ productId, qty: 40, targetUnitNet: 9.5 }, { description: "Água 1,5 L sem gás", qty: 100 }] };
    await expect(T.createTender(kb, { ...base, closesAt: new Date(Date.now() + 3600_000).toISOString() })).rejects.toThrow(/at least 24 hours/);
    const t = await T.createTender(kb, { ...base, closesAt: new Date(Date.now() + 2 * DAY).toISOString() });
    tenders.push(t.id); tid = t.id;
    expect(t.status).toBe("OPEN");
    expect((await T.supplierTenders(await ctxFor(LX))).open.some((x) => x.id === tid)).toBe(true);
    expect((await T.supplierTenders(await ctxFor(AL))).open.some((x) => x.id === tid)).toBe(true);
    const dist = await makeApprovedCompany("DISTRIBUTOR");
    expect((await T.supplierTenders(await ctxFor(dist.email))).open.some((x) => x.id === tid)).toBe(false); // customers buy from wholesalers
  });

  it("sealed bids per line with the supplier's own offer of the product; ranked for the buyer", async () => {
    const t = await T.supplierTender(await ctxFor(LX), tid);
    const [l1] = t.lines;
    expect(l1.suggested).toContain(offer);
    await expect(T.submitBid(await ctxFor(LX), tid, { lines: [{ lineId: l1.id, offerId: alOffer, unitNet: 9 }] })).rejects.toThrow(/own active products/);
    await T.submitBid(await ctxFor(LX), tid, { lines: [{ lineId: l1.id, offerId: offer, unitNet: 9.2 }] });
    await T.submitBid(await ctxFor(AL), tid, { note: "Entrega em 48 h", lines: [{ lineId: l1.id, offerId: alOffer, unitNet: 8.9 }] });
    // sealed: a supplier sees its own bid only
    const lxView = await T.supplierTender(await ctxFor(LX), tid);
    expect(JSON.stringify(lxView)).not.toContain("8.9");
    const b = await T.buyerTender(await ctxFor(KEBAB), tid);
    expect(b.lines[0].bids.map((x) => x.unitNet)).toEqual([8.9, 9.2]);
    expect(b.lines[0].bids[0]).toMatchObject({ rank: 1, belowTarget: 0.6 });
    expect(b.lines[1].bids).toEqual([]);
    expect(JSON.stringify(b)).not.toMatch(/commission/i);
  });

  it("award per line → one order per supplier at the bid price; won / lost", async () => {
    const b = await T.buyerTender(await ctxFor(KEBAB), tid);
    const cheapest = b.lines[0].bids[0].bidLineId;
    const r = await T.award(await ctxFor(KEBAB), tid, { [b.lines[0].id]: cheapest, [b.lines[1].id]: null });
    expect(r.placed).toHaveLength(1);
    const o = await prisma.order.findUniqueOrThrow({ where: { id: r.placed[0].orderId }, include: { lines: true } });
    expect(o.sellerCompanyId).toBe(alId);
    expect(Number(o.lines[0].unitSalePriceNet)).toBe(8.9);
    expect(o.lines[0].qtyOrdered).toBe(40);
    const bids = await prisma.tenderBid.findMany({ where: { tenderId: tid } });
    expect(Object.fromEntries(bids.map((x) => [x.supplierCompanyId, x.status]))).toEqual({ [alId]: "WON", [lxId]: "LOST" });
    expect((await prisma.tender.findUniqueOrThrow({ where: { id: tid } })).status).toBe("AWARDED");
    await expect(T.award(await ctxFor(KEBAB), tid, {})).rejects.toThrow(/can't be awarded/);
  });

  it("the job closes bidding at the deadline; approval and FIRINGI's switches", async () => {
    await tSettings({ approval: "ALWAYS" });
    const kb = await ctxFor(KEBAB);
    const t = await T.createTender(kb, { title: "Fecho", addressId: await addr(kebabId), closesAt: new Date(Date.now() + 2 * DAY).toISOString(), lines: [{ productId, qty: 5 }] });
    tenders.push(t.id);
    expect(t.status).toBe("PENDING");
    expect((await T.supplierTenders(await ctxFor(LX))).open.some((x) => x.id === t.id)).toBe(false);
    await T.reviewTender(await ctxFor(SA), t.id, true, null);
    await prisma.tender.update({ where: { id: t.id }, data: { closesAt: new Date(Date.now() - 60_000) } });
    expect((await T.runTendersJob()).closed).toBeGreaterThanOrEqual(1);
    expect((await prisma.tender.findUniqueOrThrow({ where: { id: t.id } })).status).toBe("CLOSED");
    await tSettings({ suppliers: { WHOLESALER: false, DISTRIBUTOR: true } });
    expect((await T.tenderAccess({ id: lxId, type: "WHOLESALER" })).bid).toBe(false);
    await T.setCompanySwitch(await ctxFor(SA), lxId, "ON");
    expect((await T.tenderAccess({ id: lxId, type: "WHOLESALER" })).bid).toBe(true);
    await T.setCompanySwitch(await ctxFor(SA), lxId, "DEFAULT");
  });
});
