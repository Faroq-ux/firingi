/**
 * Phase 49: buying groups — FIRINGI's switches (feature, member / creator types, one company on / off), a business
 * starts a group → FIRINGI approves, invitation by NIF → accept, join request → accept, one group per business when
 * FIRINGI says so, the most members; a supplier's group prices apply to members only (and stop when a member leaves);
 * a rebate deal for the group counts everyone's purchases and shares the bonus by what each bought; a group order
 * round: members add lines, at the close each member's order is placed for the same delivery day; the report;
 * closing the group.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import * as G from "@/server/buying-groups/service";
import * as R from "@/server/rebates/service";
import { priceCheckout } from "@/server/orders/pricing";
import { changeOrderStatus, confirmOrder, placeOrder } from "@/server/services/orders";
import { setStock } from "@/server/services/vendor-catalogue";
import { DEFAULT_GROUP_SETTINGS, type GroupSettings } from "@/lib/buying-groups";
import { periodOf } from "@/lib/rebates";
import { ctxFor, makeApprovedCompany, makeOffers } from "../helpers";

const SA = "superadmin@firingi.test", LX = "owner@lisboacentral.test", KEBAB = "owner@kebabhouse.test";
const DAY = 86_400_000;
let lxId = "", kebabId = "", wh = "", baseList = "", groupId = "";
let b1 = { companyId: "", email: "" }, b2 = { companyId: "", email: "" };
const groups: string[] = [];
const today = () => new Date().toISOString().slice(0, 10);
const afterMonth = () => new Date(periodOf(new Date(), "MONTH").end.getTime() + 5 * DAY);

async function settings(p: Partial<GroupSettings> = {}) { return G.saveGroupSettings(await ctxFor(SA), { ...DEFAULT_GROUP_SETTINGS, ...p }); }
async function offer(price: number) {
  const o = Object.values(await makeOffers(["Grossista Lisboa Central, Lda"]))[0];
  await prisma.priceListItem.create({ data: { priceListId: baseList, offerId: o, minQty: 1, unitPriceNet: price.toFixed(4) } });
  await setStock(await ctxFor(LX), o, wh, 5000);
  return o;
}
async function addr(companyId: string) { return (await prisma.address.findFirstOrThrow({ where: { companyId, kind: "DELIVERY", isActive: true }, orderBy: { isDefault: "desc" } })).id; }
async function buy(email: string, offerId: string, qty: number) {
  const c = await ctxFor(email);
  const placed = await placeOrder(c, { deliveryAddressId: await addr(c.company.id), items: [{ offerId, qty }], approved: true }) as { id: string };
  const lx = await ctxFor(LX), sa = await ctxFor(SA);
  await confirmOrder(lx, placed.id, {});
  for (const s of ["READY_FOR_PICKUP", "DISPATCHED", "OUT_FOR_DELIVERY", "DELIVERED"] as const) await changeOrderStatus(sa, placed.id, s);
  return placed.id;
}
async function unitPrice(email: string, offerId: string) {
  const c = await ctxFor(email);
  const pc = await priceCheckout(c, { items: [{ offerId, qty: 1 }], couponCode: null }, { regionId: null, addressId: await addr(c.company.id) });
  return Number(pc.parts[0].lines[0].calc.unitSalePriceNet);
}
/** A fixture customer with Kebab House's delivery address (so it can order). */
async function customer() {
  const c = await makeApprovedCompany("CUSTOMER");
  const a = await prisma.address.findFirstOrThrow({ where: { companyId: kebabId, kind: "DELIVERY", isActive: true }, orderBy: { isDefault: "desc" } });
  const { id: _id, companyId: _c, createdAt: _ca, updatedAt: _ua, ...rest } = a as typeof a & { createdAt?: Date; updatedAt?: Date };
  await prisma.address.create({ data: { ...(rest as object), companyId: c.companyId, isDefault: true } as never });
  return c;
}

beforeAll(async () => {
  await prisma.setting.deleteMany({ where: { key: { in: ["groups.settings", "rebates.settings"] } } });
  await prisma.companyFeature.deleteMany({ where: { key: { in: ["BUYING_GROUPS", "REBATES"] } } });
  const lx = await ctxFor(LX), kb = await ctxFor(KEBAB);
  lxId = lx.company.id; kebabId = kb.company.id;
  wh = (await prisma.address.findFirstOrThrow({ where: { companyId: lxId, kind: { in: ["WAREHOUSE", "PICKUP"] } } })).id;
  baseList = (await prisma.priceList.findFirstOrThrow({ where: { vendorCompanyId: lxId, scope: "BASE", isActive: true } })).id;
  // Kebab House may be left in groups by other runs
  await prisma.buyingGroupMember.deleteMany({ where: { companyId: kebabId } });
  b1 = await customer(); b2 = await customer();
});
afterAll(async () => {
  await prisma.tradeBonus.deleteMany({ where: { buyingGroupId: { in: groups } } });
  await prisma.priceList.deleteMany({ where: { targetGroup: { buyingGroupId: { in: groups } } } });
  await prisma.customerGroup.deleteMany({ where: { buyingGroupId: { in: groups } } });
  await prisma.buyingGroup.deleteMany({ where: { id: { in: groups } } });
  await prisma.setting.deleteMany({ where: { key: { in: ["groups.settings", "rebates.settings"] } } });
  await prisma.companyFeature.deleteMany({ where: { key: { in: ["BUYING_GROUPS", "REBATES"] } } });
  await prisma.$disconnect();
});

describe("FIRINGI's switches", () => {
  it("defaults; customers can't start groups when switched off by type, unless their company is switched on", async () => {
    expect((await G.groupSettings()).approval).toBe("ALWAYS");
    await expect(G.saveGroupSettings(await ctxFor(KEBAB), DEFAULT_GROUP_SETTINGS)).rejects.toThrow();
    await settings({ creators: { CUSTOMER: false, WHOLESALER: true } });
    await expect(G.createGroup(await ctxFor(KEBAB), { name: "Nope" })).rejects.toThrow(/can't start/);
    await G.setCompanySwitch(await ctxFor(SA), kebabId, "ON");
    expect((await G.groupAccess({ id: kebabId, type: "CUSTOMER" })).create).toBe(true);
    await G.setCompanySwitch(await ctxFor(SA), kebabId, "OFF");
    expect((await G.groupAccess({ id: kebabId, type: "CUSTOMER" })).member).toBe(false);
    await G.setCompanySwitch(await ctxFor(SA), kebabId, "DEFAULT");
    await settings();
  });
});

describe("starting a group and its members", () => {
  it("a business starts a group; FIRINGI turns down (with a reason) or approves", async () => {
    const kb = await ctxFor(KEBAB), sa = await ctxFor(SA);
    const g = await G.createGroup(kb, { name: "Restaurantes do Bairro", description: "Compras juntas", open: true });
    groups.push(g.id); groupId = g.id;
    expect(g.status).toBe("PENDING");
    await expect(G.inviteMember(kb, g.id, "X")).rejects.toThrow(/approved/);
    await expect(G.reviewGroup(sa, g.id, false, "")).rejects.toThrow(/Say why/);
    await expect(G.reviewGroup(kb, g.id, true, null)).rejects.toThrow();
    expect((await G.reviewGroup(sa, g.id, true, null)).status).toBe("APPROVED");
  });

  it("invitation by NIF → accepted; a join request → accepted; other businesses don't see the group's details", async () => {
    const kb = await ctxFor(KEBAB);
    const tax1 = (await prisma.company.findUniqueOrThrow({ where: { id: b1.companyId } })).taxId;
    await expect(G.inviteMember(kb, groupId, "000000000")).rejects.toThrow(/No business/);
    expect((await G.inviteMember(kb, groupId, tax1)).company).toMatch(/Fixture/);
    const c1 = await ctxFor(b1.email);
    expect((await G.myGroups(c1)).groups.find((x) => x.id === groupId)?.myStatus).toBe("INVITED");
    await G.respondInvite(c1, groupId, true);
    const c2 = await ctxFor(b2.email);
    expect((await G.openGroups(c2)).some((x) => x.id === groupId)).toBe(true);
    await G.requestJoin(c2, groupId, "Somos vizinhos");
    await expect(G.groupDetail(await ctxFor(LX), groupId)).rejects.toThrow();
    await expect(G.decideRequest(c1, groupId, b2.companyId, true)).rejects.toThrow(/admins/);
    await G.decideRequest(kb, groupId, b2.companyId, true);
    const d = await G.groupDetail(kb, groupId);
    expect(d.members.filter((m) => m.status === "ACTIVE").map((m) => m.companyId).sort()).toEqual([kebabId, b1.companyId, b2.companyId].sort());
  });

  it("one group per business and the most members, when FIRINGI says so", async () => {
    await settings({ multipleGroups: false });
    await expect(G.createGroup(await ctxFor(b1.email), { name: "Second" })).rejects.toThrow(/one buying group/);
    await settings({ maxMembers: 3 });
    const extra = await customer();
    const tax = (await prisma.company.findUniqueOrThrow({ where: { id: extra.companyId } })).taxId;
    await expect(G.inviteMember(await ctxFor(KEBAB), groupId, tax)).rejects.toThrow(/at most 3/);
    await settings();
  });
});

describe("group prices from a supplier", () => {
  let o = "";
  it("members pay the group price, others the base price; leaving ends it", async () => {
    o = await offer(10);
    const outsider = await customer();
    expect(await unitPrice(b1.email, o)).toBeCloseTo(10, 2);
    await G.setGroupPrices(await ctxFor(LX), groupId, { pct: 10 });
    expect(await unitPrice(b1.email, o)).toBeCloseTo(9, 2);
    expect(await unitPrice(KEBAB, o)).toBeCloseTo(9, 2);
    expect(await unitPrice(outsider.email, o)).toBeCloseTo(10, 2);
    expect((await G.supplierGroups(await ctxFor(LX))).groups.find((g) => g.id === groupId)?.priceList).toBeTruthy();
    // b2 leaves → base price again; comes back via a new invitation
    await G.leaveGroup(await ctxFor(b2.email), groupId);
    expect(await unitPrice(b2.email, o)).toBeCloseTo(10, 2);
    const tax2 = (await prisma.company.findUniqueOrThrow({ where: { id: b2.companyId } })).taxId;
    await G.inviteMember(await ctxFor(KEBAB), groupId, tax2);
    await G.respondInvite(await ctxFor(b2.email), groupId, true);
    expect(await unitPrice(b2.email, o)).toBeCloseTo(9, 2);
    await G.stopGroupPrices(await ctxFor(LX), groupId);
    expect(await unitPrice(b1.email, o)).toBeCloseTo(10, 2);
  });
});

describe("a rebate deal for the group", () => {
  it("everyone's purchases count together; the bonus is shared by what each bought", async () => {
    const o = await offer(10);
    const lx = await ctxFor(LX);
    const b = await R.saveBonus(lx, { name: "Bairro volume", kind: "VOLUME", period: "MONTH", rules: { basis: "AMOUNT", retro: true, tiers: [{ from: 300, pct: 5 }] }, validFrom: today(), audience: "BUYING_GROUP", buyingGroupId: groupId, offerIds: [o] });
    await R.submitBonus(lx, b.id);
    await R.reviewBonus(await ctxFor(SA), b.id, true, null);
    await buy(KEBAB, o, 20); // 200
    await buy(b1.email, o, 15); // 150 → group 350 ≥ 300
    const mine = (await R.myBonuses(await ctxFor(b1.email))).running.find((x) => x.id === b.id)!;
    expect(mine.group?.stats.amount).toBe(350);
    expect(mine.rows[0].result.value).toBe(7.5); // 5 % of 350 = 17.50 → 150 / 350
    // b2 bought nothing: sees the group's progress, earns nothing yet
    const none = (await R.myBonuses(await ctxFor(b2.email))).running.find((x) => x.id === b.id)!;
    expect(none.rows[0].result.value).toBe(0);
    expect(none.group?.stats.amount).toBe(350);
    await R.settleBonus(b.id, afterMonth());
    const rows = await prisma.tradeBonusSettlement.findMany({ where: { bonusId: b.id, companyId: { not: "" } } });
    expect(Object.fromEntries(rows.map((r) => [r.companyId, Number(r.value)]))).toEqual({ [kebabId]: 10, [b1.companyId]: 7.5 });
    expect(rows.every((r) => r.creditNoteIds.length === 1)).toBe(true);
  });
});

describe("group orders", () => {
  it("members add lines; at the close each member's order is placed for the same day", async () => {
    const o = await offer(10);
    const kb = await ctxFor(KEBAB);
    await expect(G.openRound(await ctxFor(b1.email), groupId, { sellerCompanyId: lxId, title: "x", closesAt: new Date(Date.now() + 3600_000).toISOString(), deliveryDate: today() })).rejects.toThrow(/admins/);
    await expect(G.openRound(kb, groupId, { sellerCompanyId: lxId, title: "Too long", closesAt: new Date(Date.now() + 40 * DAY).toISOString(), deliveryDate: new Date(Date.now() + 41 * DAY).toISOString().slice(0, 10) })).rejects.toThrow(/at most 14 days/);
    const due = new Date(Date.now() + 2 * DAY).toISOString().slice(0, 10);
    const r = await G.openRound(kb, groupId, { sellerCompanyId: lxId, title: "Sexta-feira", closesAt: new Date(Date.now() + 3600_000).toISOString(), deliveryDate: due });
    await G.setRoundLine(kb, r.id, { offerId: o, qty: 10 });
    await G.setRoundLine(await ctxFor(b1.email), r.id, { offerId: o, qty: 8 });
    await G.setRoundLine(await ctxFor(b2.email), r.id, { offerId: o, qty: 6 });
    await G.setRoundLine(await ctxFor(b2.email), r.id, { offerId: o, qty: 0 }); // changed their mind
    const other = Object.values(await makeOffers(["Grossista Lisboa Central, Lda"]))[0];
    await expect(G.setRoundLine(await ctxFor(LX), r.id, { offerId: o, qty: 1 })).rejects.toThrow();
    const d = await G.roundDetail(kb, r.id);
    expect(d.totals[0]).toMatchObject({ qty: 18, members: 2 });
    expect(d.memberCount).toBe(2);
    void other;
    // a wholesaler member buys from distributors, not from Lisboa Central: it can't add to this round
    const w = await makeApprovedCompany("WHOLESALER");
    await prisma.buyingGroupMember.create({ data: { groupId, companyId: w.companyId, status: "ACTIVE", joinedAt: new Date() } });
    await expect(G.setRoundLine(await ctxFor(w.email), r.id, { offerId: o, qty: 2 })).rejects.toThrow(/doesn't sell to your type/);
    expect((await G.roundDetail(await ctxFor(w.email), r.id)).canBuy).toBe(false);
    expect(d.canBuy).toBe(true);
    await prisma.buyingGroupMember.delete({ where: { groupId_companyId: { groupId, companyId: w.companyId } } });
    const res = await G.placeRound(r.id, kb);
    expect(res).toEqual({ placed: 2, failed: 0 });
    const orders = await prisma.order.findMany({ where: { groupRoundId: r.id } });
    expect(orders.map((x) => x.buyerCompanyId).sort()).toEqual([kebabId, b1.companyId].sort());
    expect(orders.every((x) => x.requestedDeliveryDate?.toISOString().slice(0, 10) === due)).toBe(true);
    expect((await prisma.groupOrderRound.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("PLACED");
    await expect(G.setRoundLine(kb, r.id, { offerId: o, qty: 3 })).rejects.toThrow(/closed/);
    expect(await G.placeRound(r.id)).toEqual({ placed: 0, failed: 0 }); // once
  });

  it("the job places rounds that have closed", async () => {
    const o = await offer(10);
    const kb = await ctxFor(KEBAB);
    const r = await G.openRound(kb, groupId, { sellerCompanyId: lxId, title: "Job", closesAt: new Date(Date.now() + 60_000).toISOString(), deliveryDate: new Date(Date.now() + DAY).toISOString().slice(0, 10) });
    await G.setRoundLine(kb, r.id, { offerId: o, qty: 7 });
    const job = await G.runGroupsJob(new Date(Date.now() + 120_000));
    expect(job.placed).toBeGreaterThanOrEqual(1);
    expect(await prisma.order.count({ where: { groupRoundId: r.id } })).toBe(1);
  });
});

describe("report and closing", () => {
  it("the group admin sees every member; a member sees its share and the total", async () => {
    const admin = await G.groupReport(await ctxFor(KEBAB), groupId, "MONTH");
    expect(admin.total).toBeGreaterThan(0);
    expect(admin.byMember.length).toBe(3);
    const member = await G.groupReport(await ctxFor(b1.email), groupId, "MONTH");
    expect(member.byMember).toEqual([]);
    expect(member.me.net).toBeGreaterThan(0);
    expect(member.total).toBe(admin.total);
  });

  it("closing a group stops its prices and open rounds", async () => {
    const kb = await ctxFor(KEBAB);
    await G.setGroupPrices(await ctxFor(LX), groupId, { pct: 5 });
    const r = await G.openRound(kb, groupId, { sellerCompanyId: lxId, title: "Open", closesAt: new Date(Date.now() + 3600_000).toISOString(), deliveryDate: new Date(Date.now() + DAY).toISOString().slice(0, 10) });
    await G.closeGroup(kb, groupId);
    expect((await prisma.groupOrderRound.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("CANCELLED");
    expect(await prisma.priceList.count({ where: { isActive: true, targetGroup: { buyingGroupId: groupId } } })).toBe(0);
    await expect(G.inviteMember(kb, groupId, "123")).rejects.toThrow(/closed/);
  });
});
