/**
 * Phase 48: rebates & bonuses — FIRINGI's switches (feature, kinds, limits, one supplier on / off), supplier
 * creates → FIRINGI approves / turns down, customers who are (not) in the audience, purchases counted from
 * FIRINGI's invoices for the deal's products, the buyer's progress, period settlement by credit note (VAT
 * split, supplier credit statement → off the payout, idempotent), free goods taken free on a later order
 * (supplier pays, no commission on them) and given back when that order is cancelled, ending a deal.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import * as R from "@/server/rebates/service";
import { priceCheckout } from "@/server/orders/pricing";
import { changeOrderStatus, confirmOrder, placeOrder } from "@/server/services/orders";
import { setStock } from "@/server/services/vendor-catalogue";
import { TRADE_BONUS_PREFIX } from "@/server/invoicing/service";
import { DEFAULT_REBATE_SETTINGS, periodOf, type RebateSettings } from "@/lib/rebates";
import { ctxFor, makeApprovedCompany, makeOffers } from "../helpers";

const SA = "superadmin@firingi.test", LX = "owner@lisboacentral.test", KEBAB = "owner@kebabhouse.test";
const DAY = 86_400_000;
let lxId = "", kebabId = "", addr = "", wh = "", baseList = "";
const offers: string[] = [];
const today = () => new Date().toISOString().slice(0, 10);
const afterMonth = () => new Date(periodOf(new Date(), "MONTH").end.getTime() + 5 * DAY);

async function offer(price: number) {
  const o = Object.values(await makeOffers(["Grossista Lisboa Central, Lda"]))[0];
  await prisma.priceListItem.create({ data: { priceListId: baseList, offerId: o, minQty: 1, unitPriceNet: price.toFixed(4) } });
  await setStock(await ctxFor(LX), o, wh, 5000);
  offers.push(o);
  return o;
}
async function settings(p: Partial<RebateSettings> = {}) {
  return R.saveRebateSettings(await ctxFor(SA), { ...DEFAULT_REBATE_SETTINGS, ...p });
}
async function buy(offerId: string, qty: number) {
  const kb = await ctxFor(KEBAB);
  const placed = await placeOrder(kb, { deliveryAddressId: addr, items: [{ offerId, qty }], approved: true }) as { id: string };
  return placed.id;
}
async function deliver(id: string) {
  const lx = await ctxFor(LX);
  await confirmOrder(lx, id, {});
  // FIRINGI moves it on (it may be FIRINGI's own delivery for small orders)
  const sa = await ctxFor(SA);
  for (const s of ["READY_FOR_PICKUP", "DISPATCHED", "OUT_FOR_DELIVERY", "DELIVERED"] as const) await changeOrderStatus(sa, id, s);
}
async function running(input: Partial<R.BonusInput> & Pick<R.BonusInput, "kind" | "rules">) {
  const lx = await ctxFor(LX);
  const b = await R.saveBonus(lx, { name: `Test ${input.kind}`, period: "MONTH", validFrom: today(), audience: "ALL", ...input });
  await R.submitBonus(lx, b.id);
  return R.reviewBonus(await ctxFor(SA), b.id, true, null);
}

beforeAll(async () => {
  await prisma.setting.deleteMany({ where: { key: "rebates.settings" } });
  await prisma.companyFeature.deleteMany({ where: { key: "REBATES" } });
  const lx = await ctxFor(LX), kb = await ctxFor(KEBAB);
  lxId = lx.company.id; kebabId = kb.company.id;
  addr = (await prisma.address.findFirstOrThrow({ where: { companyId: kebabId, kind: "DELIVERY", isActive: true }, orderBy: { isDefault: "desc" } })).id;
  wh = (await prisma.address.findFirstOrThrow({ where: { companyId: lxId, kind: { in: ["WAREHOUSE", "PICKUP"] } } })).id;
  baseList = (await prisma.priceList.findFirstOrThrow({ where: { vendorCompanyId: lxId, scope: "BASE", isActive: true } })).id;
});
afterAll(async () => {
  await prisma.tradeBonus.deleteMany({ where: { sellerCompanyId: lxId } }); // settlements, free goods cascade
  await prisma.tradeBonusNudge.deleteMany({});
  await prisma.setting.deleteMany({ where: { key: "rebates.settings" } });
  await prisma.companyFeature.deleteMany({ where: { key: "REBATES" } });
  await prisma.$disconnect();
});

describe("FIRINGI's switches", () => {
  it("defaults; only FIRINGI's pricing / marketing managers change them; limits are checked", async () => {
    const s = await R.rebateSettings();
    expect(s.enabled).toBe(true);
    expect(s.approval).toBe("ALWAYS");
    await expect(R.saveRebateSettings(await ctxFor(LX), DEFAULT_REBATE_SETTINGS)).rejects.toThrow();
    await expect(settings({ maxPct: 99 })).rejects.toThrow(/highest %/i);
    expect((await settings({ maxPct: 10 })).maxPct).toBe(10);
  });

  it("a step above FIRINGI's highest %, a switched-off kind and a switched-off supplier are refused", async () => {
    const lx = await ctxFor(LX);
    await expect(R.saveBonus(lx, { name: "Too much", kind: "VOLUME", period: "MONTH", rules: { tiers: [{ from: 100, pct: 12 }] }, validFrom: today(), audience: "ALL" })).rejects.toThrow(/10 %/);
    await settings({ maxPct: 10, kinds: { ...DEFAULT_REBATE_SETTINGS.kinds, GROWTH: false } });
    await expect(R.saveBonus(lx, { name: "Growth", kind: "GROWTH", period: "QUARTER", rules: { tiers: [{ growthPct: 10, pct: 2 }] }, validFrom: today(), audience: "ALL" })).rejects.toThrow(/switched this kind/);
    await R.setSupplierSwitch(await ctxFor(SA), lxId, "OFF");
    expect(await R.supplierAccess(lxId, "WHOLESALER")).toEqual({ ok: false, why: "SUPPLIER_OFF" });
    await expect(R.saveBonus(lx, { name: "Off", kind: "VOLUME", period: "MONTH", rules: { tiers: [{ from: 100, pct: 2 }] }, validFrom: today(), audience: "ALL" })).rejects.toThrow(/aren't open/);
    // wholesalers switched off by type, but this one switched on by itself
    await settings({ maxPct: 10, creators: { DISTRIBUTOR: true, WHOLESALER: false } });
    await R.setSupplierSwitch(await ctxFor(SA), lxId, "ON");
    expect((await R.supplierAccess(lxId, "WHOLESALER")).ok).toBe(true);
    await R.setSupplierSwitch(await ctxFor(SA), lxId, "DEFAULT");
    expect(await R.supplierAccess(lxId, "WHOLESALER")).toEqual({ ok: false, why: "TYPE_OFF" });
    await settings({ maxPct: 10 });
  });
});

describe("supplier creates, FIRINGI decides", () => {
  it("draft → waiting → turned down (with a reason) → changed → approved", async () => {
    const lx = await ctxFor(LX), sa = await ctxFor(SA);
    const o = await offer(5);
    const b = await R.saveBonus(lx, { name: "Q volume", kind: "VOLUME", period: "QUARTER", rules: { basis: "AMOUNT", retro: true, tiers: [{ from: 500, pct: 2 }] }, validFrom: today(), audience: "ALL", offerIds: [o] });
    expect(b.status).toBe("DRAFT");
    expect((await R.submitBonus(lx, b.id)).status).toBe("PENDING");
    await expect(R.saveBonus(lx, { id: b.id, name: "x", kind: "VOLUME", period: "QUARTER", rules: { tiers: [{ from: 1, pct: 1 }] }, validFrom: today(), audience: "ALL" })).rejects.toThrow(/Only a draft/);
    await expect(R.reviewBonus(sa, b.id, false, "")).rejects.toThrow(/Say why/);
    await expect(R.reviewBonus(lx, b.id, true, null)).rejects.toThrow();
    expect((await R.reviewBonus(sa, b.id, false, "Target too low")).status).toBe("REJECTED");
    await R.saveBonus(lx, { id: b.id, name: "Q volume", kind: "VOLUME", period: "QUARTER", rules: { basis: "AMOUNT", retro: true, tiers: [{ from: 1000, pct: 2 }] }, validFrom: today(), audience: "ALL", offerIds: [o] });
    await R.submitBonus(lx, b.id);
    expect((await R.reviewBonus(sa, b.id, true, null)).status).toBe("APPROVED");
    // a deal on another supplier's goods counts only that supplier's products
    const dist = await makeApprovedCompany("DISTRIBUTOR");
    await expect(R.saveBonus(sa, { name: "x", kind: "VOLUME", period: "MONTH", rules: { tiers: [{ from: 1, pct: 1 }] }, validFrom: today(), audience: "ALL", offerIds: [o], sellerCompanyId: dist.companyId })).rejects.toThrow(/own products/);
    await R.endBonus(lx, b.id);
  });

  it("with approval AUTO a deal within the limits starts by itself", async () => {
    await settings({ maxPct: 10, approval: "AUTO" });
    const lx = await ctxFor(LX);
    const b = await R.saveBonus(lx, { name: "Auto", kind: "MIX", period: "MONTH", rules: { minDistinct: 2, rewardFixed: 20 }, validFrom: today(), audience: "ALL" });
    expect((await R.submitBonus(lx, b.id)).status).toBe("APPROVED");
    await R.endBonus(lx, b.id);
    await settings({ maxPct: 10 });
  });

  it("a deal can't start before the current period", async () => {
    const lx = await ctxFor(LX);
    await expect(R.saveBonus(lx, { name: "Old", kind: "VOLUME", period: "MONTH", rules: { tiers: [{ from: 1, pct: 1 }] }, validFrom: "2020-01-01", audience: "ALL" })).rejects.toThrow(/before the current period/);
  });
});

describe("volume rebate: progress, settlement by credit note", () => {
  let bonusId = "", orderId = "", o = "";
  it("the buyer sees its progress from delivered (invoiced) purchases of the deal's products", async () => {
    o = await offer(10);
    const b = await running({ kind: "VOLUME", rules: { basis: "AMOUNT", retro: true, tiers: [{ from: 100, pct: 5 }, { from: 1000, pct: 8 }] }, offerIds: [o] });
    bonusId = b.id;
    let mine = (await R.myBonuses(await ctxFor(KEBAB))).running.find((x) => x.id === bonusId)!;
    expect(mine.rows[0].stats.amount).toBe(0);
    orderId = await buy(o, 20);
    mine = (await R.myBonuses(await ctxFor(KEBAB))).running.find((x) => x.id === bonusId)!;
    expect(mine.rows[0].stats.amount).toBe(0); // not invoiced yet
    await deliver(orderId);
    mine = (await R.myBonuses(await ctxFor(KEBAB))).running.find((x) => x.id === bonusId)!;
    expect(mine.rows[0].stats).toMatchObject({ amount: 200, units: 20 });
    expect(mine.rows[0].result).toMatchObject({ value: 10, pct: 5, next: { missing: 800, pct: 8 } });
    // the supplier sees the same per customer
    const d = await R.bonusDetail(await ctxFor(LX), bonusId);
    expect(d.current.find((r) => r.companyId === kebabId)?.result.value).toBe(10);
    await expect(R.bonusDetail(await ctxFor(KEBAB), bonusId)).rejects.toThrow();
  });

  it("after the period: a credit note on the period's invoices, VAT split, supplier credit statement; settled once", async () => {
    const before = await prisma.invoice.count({ where: { docType: "CREDIT_NOTE", recipientCompanyId: kebabId } });
    const r = await R.settleBonus(bonusId, afterMonth());
    expect(r.failed).toBe(0);
    const row = await prisma.tradeBonusSettlement.findFirstOrThrow({ where: { bonusId, companyId: kebabId } });
    expect(row).toMatchObject({ status: "SETTLED" });
    expect(Number(row.value)).toBe(10);
    expect(row.creditNoteIds).toHaveLength(1);
    const cn = await prisma.invoice.findUniqueOrThrow({ where: { id: row.creditNoteIds[0] }, include: { lines: true } });
    expect(cn.docType).toBe("CREDIT_NOTE");
    expect(cn.lines.every((l) => l.description.startsWith(TRADE_BONUS_PREFIX))).toBe(true);
    expect(Number(cn.netTotal)).toBeCloseTo(10, 2);
    const inv = await prisma.invoice.findFirstOrThrow({ where: { orderId, docType: "INVOICE" }, include: { lines: { where: { orderLineId: { not: null } } } } });
    const rate = Number(inv.lines[0].taxRate);
    expect(Number(cn.grossTotal)).toBeCloseTo(10 * (1 + rate / 100), 2);
    // the supplier pays: a credit statement for the net comes off its payout
    const st = await prisma.vendorBillingStatement.findFirstOrThrow({ where: { salesInvoiceId: cn.id, isCreditStatement: true } });
    expect(st.vendorCompanyId).toBe(lxId);
    expect(Number(st.expectedNet)).toBeCloseTo(10, 2);
    // again: nothing new
    await R.settleBonus(bonusId, afterMonth());
    expect(await prisma.invoice.count({ where: { docType: "CREDIT_NOTE", recipientCompanyId: kebabId } })).toBe(before + 1);
    expect(await prisma.tradeBonusSettlement.count({ where: { bonusId, companyId: kebabId } })).toBe(1);
    // the buyer's "what you earned"
    const m = await R.myBonuses(await ctxFor(KEBAB));
    expect(m.earned.find((e) => e.id === row.id)?.value).toBe(10);
    // the invoice's goods can still be fully credited later (money-only lines don't count as goods)
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } })).status).not.toBe("CREDITED");
  });

  it("customers outside the audience earn nothing and don't see the deal", async () => {
    const other = await makeApprovedCompany("CUSTOMER");
    const o2 = await offer(10);
    const b = await running({ kind: "VOLUME", rules: { tiers: [{ from: 10, pct: 5 }] }, offerIds: [o2], audience: "COMPANIES", companyIds: [other.companyId] });
    expect((await R.myBonuses(await ctxFor(KEBAB))).running.some((x) => x.id === b.id)).toBe(false);
    const id = await buy(o2, 10);
    await deliver(id);
    await R.settleBonus(b.id, afterMonth());
    expect(await prisma.tradeBonusSettlement.count({ where: { bonusId: b.id, companyId: kebabId } })).toBe(0);
  });
});

describe("free goods", () => {
  let bonusId = "", reward = "";
  it("earned at period end, taken free on a later order (supplier pays, no commission on them), given back on cancel", async () => {
    const o = await offer(4);
    reward = o;
    const b = await running({ kind: "FREE_GOODS", rules: { buyUnits: 10, freeUnits: 2 }, offerIds: [o], rewardOfferId: o });
    bonusId = b.id;
    const id = await buy(o, 25);
    await deliver(id);
    await R.settleBonus(bonusId, afterMonth());
    const g = await prisma.tradeBonusFreeGoods.findFirstOrThrow({ where: { bonusId, companyId: kebabId } });
    expect(g).toMatchObject({ qty: 4, usedQty: 0, offerId: o });
    expect((await R.myBonuses(await ctxFor(KEBAB))).freeGoods.find((x) => x.id === g.id)?.left).toBe(4);

    // the cart: 20 of the product → 4 free (free units don't count toward the delivery minimum)
    const kb = await ctxFor(KEBAB);
    const pc = await priceCheckout(kb, { items: [{ offerId: o, qty: 20 }], couponCode: null }, { regionId: null, addressId: addr, commissionRates: new Map([[lxId, 10]]) });
    const line = pc.parts[0].lines[0];
    expect(line.item.freeGoods).toMatchObject({ qty: 4, vendorQty: 4 });
    expect(Number(line.calc.lineNet)).toBeCloseTo(64, 2); // 16 × 4.00
    expect(Number(line.calc.commissionBase)).toBeCloseTo(64, 2); // commission only on the paid units

    const placed = await placeOrder(kb, { deliveryAddressId: addr, items: [{ offerId: o, qty: 20 }], approved: true }) as { id: string };
    expect((await prisma.tradeBonusFreeGoods.findUniqueOrThrow({ where: { id: g.id } })).usedQty).toBe(4);
    // nothing left for the next cart
    const again = await priceCheckout(kb, { items: [{ offerId: o, qty: 6 }], couponCode: null }, { regionId: null, addressId: addr });
    expect(again.parts[0].lines[0].item.freeGoods ?? null).toBeNull();
    // cancelled → the free units come back
    await changeOrderStatus(await ctxFor(SA), placed.id, "CANCELLED", "Test: cancelled");
    expect((await prisma.tradeBonusFreeGoods.findUniqueOrThrow({ where: { id: g.id } })).usedQty).toBe(0);
  });

  it("expired free goods aren't given", async () => {
    await prisma.tradeBonusFreeGoods.updateMany({ where: { bonusId }, data: { expiresAt: new Date(Date.now() - DAY) } });
    const pc = await priceCheckout(await ctxFor(KEBAB), { items: [{ offerId: reward, qty: 6 }], couponCode: null }, { regionId: null, addressId: addr });
    expect(pc.parts[0].lines[0].item.freeGoods ?? null).toBeNull();
  });
});

describe("ending, FIRINGI's views and the job", () => {
  it("a running deal ends with its current period; FIRINGI's lists and the daily job work", async () => {
    const lx = await ctxFor(LX);
    const b = await running({ kind: "VOLUME", rules: { tiers: [{ from: 100000, pct: 1 }] } });
    const e = await R.endBonus(lx, b.id);
    expect(e.validTo?.getTime()).toBe(periodOf(new Date(), "MONTH").end.getTime());
    const sa = await ctxFor(SA);
    expect((await R.adminBonuses(sa)).some((x) => x.id === b.id)).toBe(true);
    expect((await R.rebatesOverview(sa)).live).toBeGreaterThan(0);
    expect((await R.supplierSwitches(sa)).some((x) => x.id === lxId)).toBe(true);
    const job = await R.runRebatesJob();
    expect(job.failed).toBe(0);
    // switched off: buyers see nothing running
    await settings({ enabled: false });
    expect((await R.myBonuses(await ctxFor(KEBAB))).running).toEqual([]);
    await settings({});
  });
});
