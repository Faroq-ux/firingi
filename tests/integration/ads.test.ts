/**
 * Phase 34: sponsored products — campaigns (per click / per day), FIRINGI approval, serving per placement
 * (search, category, home, cart) with slots, impressions and clicks, repeat clicks, budgets, booked days and
 * slots, switches (global, per placement, per supplier, "order from FIRINGI" countries); billing: monthly ad
 * invoice with VAT (INVOICE), settled against payouts (PAYOUT), prepaid top-ups (PREPAID), reverse charge
 * for a supplier in another EU country.
 */
import Decimal from "decimal.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import * as A from "@/server/ads/service";
import { setCompanyFeature } from "@/server/accounting/features";
import { openAmounts } from "@/server/payments/service";
import { ctxFor } from "../helpers";

const SA = "superadmin@firingi.test", KEBAB = "owner@kebabhouse.test", LX = "owner@lisboacentral.test", CCA = "owner@ccalmada.test", IB = "owner@ibericas.test", LXW = "owner@lisboacentral.test";
const today = () => new Date().toISOString().slice(0, 10);
const inDays = (n: number) => new Date(Date.now() + n * 86400_000).toISOString().slice(0, 10);

async function wipe() {
  await prisma.adCharge.deleteMany({});
  await prisma.adStatDay.deleteMany({});
  await prisma.adCampaign.deleteMany({});
  await prisma.adInvoice.deleteMany({});
  await prisma.adAccount.deleteMany({});
  await prisma.setting.deleteMany({ where: { OR: [{ key: "ads.settings" }, { key: { startsWith: "ads.low:" } }] } });
  await prisma.companyFeature.deleteMany({ where: { key: "ADS" } });
}
beforeAll(wipe);
afterAll(async () => { await wipe(); await prisma.$disconnect(); });

async function offersOf(email: string, sku: RegExp) {
  const c = await ctxFor(email);
  const rows = await prisma.vendorOffer.findMany({ where: { vendorCompanyId: c.company.id, status: "ACTIVE" }, orderBy: { createdAt: "asc" }, include: { packaging: { include: { variant: { include: { product: true } } } } } });
  return rows.filter((r) => sku.test(r.packaging.variant.sku));
}
async function approved(email: string, input: A.CampaignInput) {
  const c = await A.createCampaign(await ctxFor(email), input);
  if (c.status === "PENDING") await A.reviewCampaign(await ctxFor(SA), c.id, "APPROVE");
  return c;
}

describe("advertising", () => {
  it("settings: FIRINGI only; placements validated", async () => {
    await expect(A.saveAdsSettings(await ctxFor(LX), { enabled: false })).rejects.toThrow();
    const sa = await ctxFor(SA);
    await expect(A.saveAdsSettings(sa, { placements: { ...A.ADS_DEFAULTS.placements, SEARCH: { enabled: true, slots: 0, minCpc: 0.3, dailyPrice: 5 } } })).rejects.toThrow(/slots/);
    const s = await A.saveAdsSettings(sa, { placements: { ...A.ADS_DEFAULTS.placements, SEARCH: { enabled: true, slots: 2, minCpc: 0.4, dailyPrice: 6 } } });
    expect(s.placements.SEARCH.minCpc).toBe(0.4);
    expect(s.placements.HOME.slots).toBe(A.ADS_DEFAULTS.placements.HOME.slots);
  });

  it("a per-click campaign: checks, approval, shows in search, clicks charged once per buyer, budget ends it", async () => {
    const [mozz] = await offersOf(LX, /MOZZ/);
    const other = (await prisma.vendorOffer.findFirstOrThrow({ where: { vendorCompanyId: (await ctxFor(CCA)).company.id, status: "ACTIVE" } })).id;
    const lx = await ctxFor(LX);
    const base: A.CampaignInput = { name: "Mozzarella no topo", placement: "SEARCH", pricing: "CPC", offerIds: [mozz.id], keywords: ["queijo"], cpcBid: 0.5, dailyBudget: 1.2, totalBudget: 2, startsOn: today() };
    await expect(A.createCampaign(await ctxFor(KEBAB), base)).rejects.toThrow();
    await expect(A.createCampaign(lx, { ...base, offerIds: [other] })).rejects.toThrow(/own products/);
    await expect(A.createCampaign(lx, { ...base, cpcBid: 0.2 })).rejects.toThrow(/at least 0.40/);
    await expect(A.createCampaign(lx, { ...base, dailyBudget: 0.3 })).rejects.toThrow(/Daily budget/);
    await expect(A.createCampaign(lx, { ...base, startsOn: inDays(-2) })).rejects.toThrow(/past/);
    const c = await A.createCampaign(lx, base);
    expect(c.status).toBe("PENDING");
    const kebab = await ctxFor(KEBAB);
    expect(await A.sponsoredFor(kebab, "SEARCH", { q: "mozzarella" })).toHaveLength(0); // not approved yet
    await expect(A.reviewCampaign(await ctxFor(SA), c.id, "REJECT", "")).rejects.toThrow(/why/);
    await A.reviewCampaign(await ctxFor(SA), c.id, "APPROVE");
    // shows for a matching search and for its keyword; not for an unrelated one
    const hit = await A.sponsoredFor(kebab, "SEARCH", { q: "mozzarella" });
    expect(hit.map((h) => h.item.offerId)).toEqual([mozz.id]);
    expect(hit[0].href).toBe(`/api/ads/click?c=${c.id}&o=${mozz.id}`);
    expect((await A.sponsoredFor(kebab, "SEARCH", { q: "queijo fresco" })).length).toBe(1);
    expect(await A.sponsoredFor(kebab, "SEARCH", { q: "detergente" })).toHaveLength(0);
    expect(await A.sponsoredFor(lx, "SEARCH", { q: "mozzarella" })).toHaveLength(0); // suppliers don't see ads
    expect((await prisma.adStatDay.findFirstOrThrow({ where: { campaignId: c.id } })).impressions).toBe(2);
    // clicks: 0.50 charged, the same buyer again within the window → counted, not charged
    expect((await A.recordClick(kebab, c.id, mozz.id)).charged).toBe("0.50");
    expect((await A.recordClick(kebab, c.id, mozz.id)).charged).toBe("0.00");
    const other1 = await ctxFor("owner@minimercadosol.test");
    expect((await A.recordClick(other1, c.id, mozz.id)).charged).toBe("0.50");
    // daily budget 1.20: a third click would pass it → not shown any more today
    expect(await A.sponsoredFor(kebab, "SEARCH", { q: "mozzarella" })).toHaveLength(0);
    const st = await prisma.adStatDay.findFirstOrThrow({ where: { campaignId: c.id } });
    expect([st.clicks, st.cost.toString()]).toEqual([3, "1"]);
    // a bigger daily budget: shows again; the total budget (2 €) then ends the campaign
    await A.updateCampaign(lx, c.id, { dailyBudget: 5 });
    const pizza = await ctxFor("owner@pizzariabella.test");
    expect((await A.recordClick(pizza, c.id, mozz.id)).charged).toBe("0.50");
    await prisma.adCharge.updateMany({ where: { campaignId: c.id }, data: { createdAt: new Date(Date.now() - 3600_000) } }); // outside the repeat window
    expect((await A.recordClick(kebab, c.id, mozz.id)).charged).toBe("0.50");
    const after = await prisma.adCampaign.findUniqueOrThrow({ where: { id: c.id } });
    expect([after.status, after.pausedReason]).toEqual(["ENDED", "BUDGET"]);
    expect(await prisma.notificationMessage.count({ where: { eventKey: "ads.stopped" } })).toBeGreaterThan(0);
    // more total budget → runs again
    await A.updateCampaign(lx, c.id, { totalBudget: 50 });
    expect((await prisma.adCampaign.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("ACTIVE");
    // supplier pauses it → gone
    await A.updateCampaign(lx, c.id, { action: "PAUSE" });
    expect(await A.sponsoredFor(kebab, "SEARCH", { q: "mozzarella" })).toHaveLength(0);
    await A.updateCampaign(lx, c.id, { action: "END" });
  });

  it("per-day bookings: slots, the day is paid when it shows and by the job; DAILY before CPC", async () => {
    const offers = await offersOf(LX, /.*/);
    const cca = await offersOf(CCA, /.*/);
    const sa = await ctxFor(SA);
    await A.saveAdsSettings(sa, { placements: { ...(await A.adsSettings()).placements, HOME: { enabled: true, slots: 2, minCpc: 0.2, dailyPrice: 8 } } });
    const d1 = await approved(LX, { name: "Destaque semana", placement: "HOME", pricing: "DAILY", offerIds: [offers[0].id], startsOn: today(), endsOn: inDays(6) });
    expect(d1.dailyPrice?.toString()).toBe("8");
    await approved(CCA, { name: "Almada destaque", placement: "HOME", pricing: "DAILY", offerIds: [cca[0].id], startsOn: today(), endsOn: inDays(3) });
    await expect(A.createCampaign(await ctxFor(LX), { name: "Mais um", placement: "HOME", pricing: "DAILY", offerIds: [offers[1].id], startsOn: inDays(2), endsOn: inDays(4) })).rejects.toThrow(/fully booked/);
    await expect(A.createCampaign(await ctxFor(LX), { name: "Sem fim", placement: "HOME", pricing: "DAILY", offerIds: [offers[1].id], startsOn: today() })).rejects.toThrow(/end date/);
    const cpc = await approved(LX, { name: "Clique home", placement: "HOME", pricing: "CPC", offerIds: [offers[2].id], cpcBid: 2, dailyBudget: 10, startsOn: today() });
    const home = await A.sponsoredFor(await ctxFor(KEBAB), "HOME");
    expect(home).toHaveLength(2); // 2 slots: both bookings, the higher bid waits
    expect(home.map((h) => h.campaignId)).not.toContain(cpc.id);
    const day = await prisma.adCharge.findMany({ where: { campaignId: d1.id, kind: "DAY" } });
    expect(day.map((x) => x.amount.toString())).toEqual(["8"]);
    await A.sponsoredFor(await ctxFor(KEBAB), "HOME");
    await A.runAdsJob();
    expect(await prisma.adCharge.count({ where: { campaignId: d1.id, kind: "DAY" } })).toBe(1); // once per day
    // clicks on a booking are counted but not charged
    expect((await A.recordClick(await ctxFor(KEBAB), d1.id, offers[0].id)).charged).toBe("0.00");
    await prisma.adCampaign.updateMany({ where: { placement: "HOME" }, data: { status: "ENDED" } });
  });

  it("category and cart placements target related products; switches turn ads off", async () => {
    const kebab = await ctxFor(KEBAB);
    const offers = await offersOf(LX, /.*/);
    const o = offers[0];
    const catId = o.packaging.variant.product.categoryId;
    const cat = await approved(LX, { name: "Categoria", placement: "CATEGORY", pricing: "CPC", offerIds: [o.id], cpcBid: 0.5, dailyBudget: 5, startsOn: today() });
    expect((await A.sponsoredFor(kebab, "CATEGORY", { categoryId: catId })).map((s) => s.item.offerId)).toEqual([o.id]);
    const otherCat = await prisma.category.findFirstOrThrow({ where: { id: { not: catId }, parentId: null, isActive: true } });
    if (otherCat.id !== catId && !(await prisma.category.findFirst({ where: { id: catId, parentId: otherCat.id } }))) expect(await A.sponsoredFor(kebab, "CATEGORY", { categoryId: otherCat.id })).toHaveLength(0);
    // cart: a product of the same category as something in the cart, never one already in it
    const sameCat = offers.find((x) => x.id !== o.id && x.packaging.variant.product.categoryId === catId);
    const cart = await approved(LX, { name: "Carrinho", placement: "CART", pricing: "CPC", offerIds: [o.id], cpcBid: 0.5, dailyBudget: 5, startsOn: today() });
    if (sameCat) expect((await A.sponsoredFor(kebab, "CART", { cartOfferIds: [sameCat.id] })).map((s) => s.item.offerId)).toEqual([o.id]);
    expect(await A.sponsoredFor(kebab, "CART", { cartOfferIds: [o.id] })).toHaveLength(0);
    // placement switched off
    const sa = await ctxFor(SA);
    const s = await A.adsSettings();
    await A.saveAdsSettings(sa, { placements: { ...s.placements, CATEGORY: { ...s.placements.CATEGORY, enabled: false } } });
    expect(await A.sponsoredFor(kebab, "CATEGORY", { categoryId: catId })).toHaveLength(0);
    await expect(A.createCampaign(await ctxFor(LX), { name: "Outra", placement: "CATEGORY", pricing: "CPC", offerIds: [o.id], cpcBid: 0.5, dailyBudget: 5, startsOn: today() })).rejects.toThrow(/switched this placement off/);
    await A.saveAdsSettings(sa, { placements: { ...s.placements, CATEGORY: { ...s.placements.CATEGORY, enabled: true } } });
    // supplier switched off by FIRINGI
    await setCompanyFeature(sa, o.vendorCompanyId, "ADS", false);
    expect(await A.sponsoredFor(kebab, "CATEGORY", { categoryId: catId })).toHaveLength(0);
    await expect(A.myAds(await ctxFor(LX))).rejects.toThrow();
    await setCompanyFeature(sa, o.vendorCompanyId, "ADS", true);
    // everything off
    await A.saveAdsSettings(sa, { enabled: false });
    expect(await A.sponsoredFor(kebab, "CATEGORY", { categoryId: catId })).toHaveLength(0);
    await A.saveAdsSettings(sa, { enabled: true });
    expect(await A.sponsoredFor(kebab, "CATEGORY", { categoryId: catId })).toHaveLength(1);
    // "order from FIRINGI" country: suppliers aren't shown, so no ads
    const pt = await prisma.country.findUniqueOrThrow({ where: { code: "PT" } });
    await prisma.country.update({ where: { id: pt.id }, data: { customerOrderMode: "FIRINGI" } });
    try {
      const { orderingMode } = await import("@/server/allocation/mode");
      void orderingMode;
      expect(await A.sponsoredFor(await ctxFor(KEBAB), "CATEGORY", { categoryId: catId })).toHaveLength(0);
    } finally {
      await prisma.country.update({ where: { id: pt.id }, data: { customerOrderMode: "CHOOSE_SUPPLIER" } });
    }
    await prisma.adCampaign.updateMany({ where: { id: { in: [cat.id, cart.id] } }, data: { status: "ENDED" } });
  });

  it("monthly ad invoice with VAT (INVOICE); billing method set by FIRINGI only", async () => {
    const lx = await ctxFor(LX), sa = await ctxFor(SA);
    await expect(A.setAdBilling(lx, lx.company.id, "PREPAID")).rejects.toThrow();
    await A.setAdBilling(sa, lx.company.id, "INVOICE");
    const res = (await A.invoiceAdCharges({ upTo: new Date(Date.now() + 86400_000), companyId: lx.company.id })).find((r) => r.companyId === lx.company.id)!;
    expect(res).toBeTruthy();
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: res.invoiceId }, include: { lines: true } });
    const net = (await prisma.adCharge.aggregate({ where: { invoiceId: inv.id }, _sum: { amount: true } }))._sum.amount!;
    expect(inv.netTotal.toString()).toBe(new Decimal(net.toString()).toFixed(2).replace(/\.?0+$/, "") || "0");
    expect(inv.lines.every((l) => l.taxRate.toString() === "23")).toBe(true);
    expect(inv.lines[0].description).toMatch(/^Publicidade FIRINGI — /);
    expect(inv.orderId).toBeNull();
    expect(inv.recipientCompanyId).toBe(lx.company.id);
    expect(await prisma.adCharge.count({ where: { companyId: lx.company.id, invoiceId: null, prepaid: false } })).toBe(0);
    expect((await openAmounts([inv.id])).get(inv.id)?.toString()).toBe(inv.grossTotal.toString());
    // nothing new → nothing invoiced again
    expect((await A.invoiceAdCharges({ upTo: new Date(Date.now() + 86400_000), companyId: lx.company.id }))).toHaveLength(0);
    const bill = await A.myAdBilling(lx);
    expect(bill.invoices[0].number).toBe(inv.fullNumber);
  });

  it("PAYOUT: the ad invoice is settled against what FIRINGI owes the supplier", async () => {
    const cca = await ctxFor(CCA), sa = await ctxFor(SA);
    await A.setAdBilling(sa, cca.company.id, "PAYOUT");
    const vi = await prisma.vendorInvoice.create({ data: { vendorCompanyId: cca.company.id, externalNumber: `FT-ADS-${Date.now()}`, issueDate: new Date(), netTotal: 81.3, vatTotal: 18.7, grossTotal: 100, fileKey: "test/none.pdf", status: "APPROVED" } });
    const [o] = await offersOf(CCA, /.*/);
    const c = await approved(CCA, { name: "Almada pesquisa", placement: "SEARCH", pricing: "CPC", offerIds: [o.id], keywords: [o.packaging.variant.product.searchText.split(" ")[0]], cpcBid: 10, dailyBudget: 50, startsOn: today() });
    for (const e of [KEBAB, "owner@minimercadosol.test"]) await A.recordClick(await ctxFor(e), c.id, o.id);
    const net = new Decimal((await prisma.adCharge.aggregate({ where: { companyId: cca.company.id, invoiceId: null, prepaid: false }, _sum: { amount: true } }))._sum.amount!.toString());
    expect(net.gte(20)).toBe(true); // 2 × 10 € clicks (+ its booked home-page day from the earlier test)
    const res = (await A.invoiceAdCharges({ upTo: new Date(Date.now() + 86400_000), companyId: cca.company.id }))[0];
    const gross = net.mul(1.23).toDecimalPlaces(2);
    expect(new Decimal(res.gross).toFixed(2)).toBe(gross.toFixed(2)); // + 23 % VAT
    expect(res.netted).toBe(gross.toFixed(2));
    expect((await openAmounts([res.invoiceId])).get(res.invoiceId)?.toString()).toBe("0");
    const outbound = await prisma.paymentAllocation.aggregate({ where: { vendorInvoiceId: vi.id, payment: { status: "CONFIRMED", method: "OTHER" } }, _sum: { amount: true } });
    expect(new Decimal(outbound._sum.amount!.toString()).toFixed(2)).toBe(gross.toFixed(2));
    const pays = await prisma.payment.findMany({ where: { companyId: cca.company.id, reference: { startsWith: "Compensação" } } });
    expect(pays.map((p) => p.direction).sort()).toEqual(["INBOUND", "OUTBOUND"]);
    await A.updateCampaign(cca, c.id, { action: "END" });
  });

  it("PREPAID: a top-up is invoiced and paid, clicks come off the balance, no balance → no ads", async () => {
    const lx = await ctxFor(LX), sa = await ctxFor(SA);
    await A.setAdBilling(sa, lx.company.id, "PREPAID");
    const [o] = await offersOf(LX, /MOZZ/);
    const c = await approved(LX, { name: "Pré-pago", placement: "SEARCH", pricing: "CPC", offerIds: [o.id], cpcBid: 0.5, dailyBudget: 20, startsOn: today() });
    const kebab = await ctxFor(KEBAB);
    expect(await A.sponsoredFor(kebab, "SEARCH", { q: "mozzarella" })).toHaveLength(0); // no balance
    await expect(A.recordTopUp(await ctxFor("sales@firingi.test"), lx.company.id, { gross: 1.23, method: "BANK_TRANSFER" })).rejects.toThrow();
    const top = await A.recordTopUp(sa, lx.company.id, { gross: 1.23, method: "BANK_TRANSFER", reference: "TRF 123" });
    expect([top.net, top.gross]).toEqual(["1.00", "1.23"]);
    const fr = await prisma.invoice.findFirstOrThrow({ where: { fullNumber: top.number } });
    expect(fr.docType).toBe("INVOICE_RECEIPT");
    expect((await openAmounts([fr.id])).get(fr.id)?.toString()).toBe("0");
    expect((await prisma.adAccount.findUniqueOrThrow({ where: { companyId: lx.company.id } })).balance.toString()).toBe("1");
    expect(await A.sponsoredFor(kebab, "SEARCH", { q: "mozzarella" })).toHaveLength(1);
    expect((await A.recordClick(kebab, c.id, o.id)).charged).toBe("0.50");
    expect((await A.recordClick(await ctxFor("owner@minimercadosol.test"), c.id, o.id)).charged).toBe("0.50");
    expect((await prisma.adAccount.findUniqueOrThrow({ where: { companyId: lx.company.id } })).balance.toString()).toBe("0");
    expect(await prisma.adCharge.count({ where: { campaignId: c.id, prepaid: true } })).toBe(2);
    expect(await A.sponsoredFor(kebab, "SEARCH", { q: "mozzarella" })).toHaveLength(0);
    // prepaid clicks are never on a monthly invoice
    expect(await A.invoiceAdCharges({ upTo: new Date(Date.now() + 86400_000), companyId: lx.company.id })).toHaveLength(0);
    await A.updateCampaign(lx, c.id, { action: "END" });
  });

  it("a supplier in another EU country is invoiced under the reverse charge (0 % VAT)", async () => {
    const ib = await ctxFor(IB), sa = await ctxFor(SA);
    const [o] = await offersOf(IB, /.*/);
    const c = await approved(IB, { name: "Ibéricas", placement: "SEARCH", pricing: "CPC", offerIds: [o.id], keywords: ["ibericas"], cpcBid: 1, dailyBudget: 10, startsOn: today() });
    const lxw = await ctxFor(LXW); // a wholesaler buying from distributors
    await A.recordClick(lxw, c.id, o.id);
    await A.setAdBilling(sa, ib.company.id, "INVOICE");
    const res = (await A.invoiceAdCharges({ upTo: new Date(Date.now() + 86400_000), companyId: ib.company.id }))[0];
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: res.invoiceId } });
    expect(inv.taxRegime).toBe("INTRA_EU_REVERSE_CHARGE");
    expect([inv.vatTotal.toString(), inv.grossTotal.toString()]).toEqual(["0", "1"]);
    expect((inv.recipientSnapshot as { note?: string }).note).toMatch(/reverse charge/);
  });

  it("reports: supplier sees own campaigns only; FIRINGI sees overview, advertisers and ad invoices", async () => {
    const lx = await ctxFor(LX);
    const mine = await A.myAds(lx);
    expect(mine.rows.length).toBeGreaterThan(0);
    expect(mine.rows.every((r) => r.vendorCompanyId === lx.company.id)).toBe(true);
    const other = await prisma.adCampaign.findFirstOrThrow({ where: { vendorCompanyId: { not: lx.company.id } } });
    await expect(A.campaignDetail(lx, other.id)).rejects.toThrow();
    const sa = await ctxFor(SA);
    const ov = await A.adsOverview(sa);
    expect(Number(ov.revenueMonth)).toBeGreaterThan(0);
    const adv = await A.listAdvertisers(sa);
    expect(adv.find((a) => a.id === lx.company.id)?.billing).toBe("PREPAID");
    expect((await A.listAdInvoices(sa)).length).toBeGreaterThanOrEqual(3);
    await expect(A.adsOverview(lx)).rejects.toThrow();
  });
});
