/**
 * Phase 45: multi-currency — a Polish customer (PLN, FX margin 1.5 %) buys from a Polish wholesaler pricing in PLN
 * (fixed local price, used exactly) and one item priced in EUR (converted at the customer rate). The rate is locked
 * on the order; the invoice, the payment request, the bank match and the supplier statement / invoice / payout are
 * in złoty; EUR stays FIRINGI's books with the realised exchange difference booked (FxEntry, P&L, accounting
 * export). Also: the ECB feed (simulated), manual overrides, alerts, the switches, masks, reports and price lists.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { prisma } from "@/server/db";
import { changeOrderStatus, confirmOrder, getOrder, placeOrder } from "@/server/services/orders";
import { addToCart, clearCart, cartView } from "@/server/services/cart";
import { browseCatalogue } from "@/server/data/catalogue-buyer";
import * as C from "@/server/currency/service";
import { buyerPayInvoices, openAmounts, startPayment } from "@/server/payments/service";
import { simMultibancoPaid } from "@/server/payments/sim-actions";
import { recordPayment, reviewVendorInvoice, submitVendorInvoice } from "@/server/services/finance";
import { convertPriceListCurrency, listCurrencies } from "@/server/services/pricing";
import { accountingPreview, accountMap, collectDocuments, toEntries } from "@/server/integrations/accounting";
import { computePnl } from "@/server/services/profit";
import { kpis } from "@/server/analytics/engine";
import { readQuery } from "@/server/analytics/params";
import * as Bank from "@/server/bank/service";
import * as M from "@/server/bank/match";
import { DEFAULT_CURRENCY_SETTINGS, customerRate, type CurrencySettings } from "@/lib/currency";
import { ctxFor } from "../helpers";

const SA = "superadmin@firingi.test", FIN = "finance@firingi.test", KK = "owner@kebabkrakow.test", HK = "owner@hurtownia.test";
const D = (v: unknown) => new Decimal(String(v));
let savedSettings: unknown = null, savedEnv: string | undefined, savedPolicy: unknown = null;
const placed: string[] = [];
let orderId = "", invoiceId = "";

const settings = async (patch: Partial<CurrencySettings> = {}) => C.saveCurrencySettings(await ctxFor(SA), {
  ...DEFAULT_CURRENCY_SETTINGS, enabled: true, countries: { ...DEFAULT_CURRENCY_SETTINGS.countries, PL: true, SE: true },
  margins: { ...DEFAULT_CURRENCY_SETTINGS.margins, PLN: 1.5, SEK: 1.5 }, ...patch,
});
const offerOf = async (sku: string) => {
  const hk = await ctxFor(HK);
  return prisma.vendorOffer.findFirstOrThrow({ where: { vendorCompanyId: hk.company.id, status: "ACTIVE", packaging: { variant: { sku } } } });
};
async function placePl(items: [string, number][]) {
  const kk = await ctxFor(KK);
  await clearCart(kk);
  for (const [sku, qty] of items) await addToCart(kk, (await offerOf(sku)).id, qty);
  const addr = await prisma.address.findFirstOrThrow({ where: { companyId: kk.company.id, kind: "DELIVERY", isActive: true } });
  const r = await placeOrder(kk, { deliveryAddressId: addr.id });
  const id = "orders" in r ? r.orders[0].id : (r as { id: string }).id;
  placed.push(id);
  return id;
}
async function deliver(id: string) {
  const hk = await ctxFor(HK);
  await confirmOrder(hk, id, {});
  for (const st of ["READY_FOR_PICKUP", "DISPATCHED", "OUT_FOR_DELIVERY", "DELIVERED"] as const) {
    const o = await prisma.order.findUniqueOrThrow({ where: { id } });
    if (o.status !== "DELIVERED") await changeOrderStatus(hk, id, st).catch(async () => changeOrderStatus(await ctxFor(SA), id, st));
  }
  await new Promise((r) => setTimeout(r, 200));
  return prisma.invoice.findFirstOrThrow({ where: { orderId: id, docType: "INVOICE" } });
}
const setMid = async (code: string, rate: number) => {
  const today = new Date(new Date().toISOString().slice(0, 10));
  await prisma.exchangeRate.upsert({ where: { baseCode_quoteCode_date: { baseCode: "EUR", quoteCode: code, date: today } }, update: { rate, source: "ECB", feedRate: null }, create: { baseCode: "EUR", quoteCode: code, rate, date: today, source: "ECB" } });
  C.clearFxCache();
};

beforeAll(async () => {
  savedSettings = (await prisma.setting.findFirst({ where: { key: "currency.settings" } }))?.value ?? null;
  savedEnv = process.env.PAYMENTS_SIMULATE;
  process.env.PAYMENTS_SIMULATE = "1";
  const { paymentPolicy, setPaymentPolicy } = await import("@/server/services/payments");
  savedPolicy = await paymentPolicy();
  const p = savedPolicy as Awaited<ReturnType<typeof paymentPolicy>>;
  await setPaymentPolicy(await ctxFor(SA), { ...p, methods: { ...p.methods, MULTIBANCO: true } });
  await setMid("PLN", 4.25);
  await settings();
  const kk = await ctxFor(KK);
  await prisma.company.update({ where: { id: kk.company.id }, data: { creditLimit: null, paymentTermsDays: 30, payBeforeShipping: false } });
});
afterAll(async () => {
  const sa = await ctxFor(SA);
  for (const id of placed) await changeOrderStatus(sa, id, "CANCELLED", "test clean-up").catch(() => null);
  await prisma.setting.deleteMany({ where: { key: "currency.settings" } });
  if (savedSettings) await prisma.setting.create({ data: { scope: "GLOBAL", scopeId: "", key: "currency.settings", value: savedSettings as never } });
  const { setPaymentPolicy } = await import("@/server/services/payments");
  if (savedPolicy) await setPaymentPolicy(sa, savedPolicy as never).catch(() => null);
  await setMid("PLN", 4.25);
  process.env.PAYMENTS_SIMULATE = savedEnv;
  C.clearFxCache();
  await prisma.$disconnect();
});

describe("who sees which currency", () => {
  it("a Polish customer: PLN at reference × (1 + 1.5 %); the Polish supplier: PLN at reference; FIRINGI and Portugal: EUR", async () => {
    const fx = await C.viewerFx(await ctxFor(KK));
    expect(fx).toMatchObject({ code: "PLN", mid: "4.25", marginPct: 1.5, showEur: true });
    expect(Number(fx.rate)).toBeCloseTo(4.25 * 1.015, 6);
    expect((await C.viewerFx(await ctxFor(HK), "SUPPLIER"))).toMatchObject({ code: "PLN", rate: "4.25", marginPct: 0 });
    expect((await C.viewerFx(await ctxFor(SA))).code).toBe("EUR");
    expect((await C.viewerFx(await ctxFor("owner@kebabhouse.test"))).code).toBe("EUR");
  });

  it("the catalogue: a PLN price list is used exactly; an EUR price is converted at the customer rate", async () => {
    const kk = await ctxFor(KK);
    const { items } = await browseCatalogue(kk, { q: "Coca-Cola" });
    const cola = items.find((i) => i.sku === "FIR-COLA33")!;
    expect(cola.price!.local).toMatchObject({ code: "PLN", unitPriceNet: "55.00" });
    expect(cola.price!.fixedLocal).toMatchObject({ code: "PLN" });
    expect(Number(cola.price!.unitPriceNet)).toBeCloseTo(55 / 4.25, 2); // EUR at the reference rate (no margin)
    const oil = (await browseCatalogue(kk, { q: "azeite" })).items.find((i) => i.sku === "FIR-AZEITE75")!;
    expect(oil.price!.fixedLocal).toBeNull();
    expect(oil.price!.local!.unitPriceNet).toBe(D(31.5).mul(customerRate(4.25, 1.5)).toDecimalPlaces(2).toFixed(2));
  });

  it("the cart preview totals convert at today's customer rate", async () => {
    const kk = await ctxFor(KK);
    await clearCart(kk);
    await addToCart(kk, (await offerOf("FIR-COLA33")).id, 2);
    const v = await cartView(kk);
    expect(Number(v.totalGross)).toBeGreaterThan(0);
    const lc = "local" in v ? v.local! : null;
    expect(lc).toMatchObject({ code: "PLN", shownNet: "110" }); // 2 × 55 zł fixed — not EUR × the customer rate
    expect(Number(lc!.gross)).toBeCloseTo(Number(lc!.net) + Number(lc!.vat), 2);
    await clearCart(kk);
  });
});

describe("an order in złoty, its invoice, payment and the supplier side", () => {
  it("placing locks the currency and the rates; the fixed local price stays exact; local totals add up", async () => {
    orderId = await placePl([["FIR-COLA33", 4], ["FIR-AZEITE75", 2]]);
    const o = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
    expect(o).toMatchObject({ currencyCode: "PLN", vendorCurrencyCode: "PLN" });
    expect(Number(o.midRate)).toBe(4.25);
    expect(Number(o.eurRate)).toBeCloseTo(4.25 * 1.015, 6);
    expect(Number(o.vendorRate)).toBe(4.25);
    const cola = o.lines.find((l) => l.sku === "FIR-COLA33")!;
    expect(Number(cola.unitPriceLocal)).toBe(55);
    expect(Number(cola.lineNetLocal)).toBe(220);
    const oil = o.lines.find((l) => l.sku === "FIR-AZEITE75")!;
    expect(Number(oil.unitPriceLocal)).toBeCloseTo(31.5 * Number(o.eurRate), 3);
    expect(D(o.netTotalLocal).plus(D(o.vatTotalLocal)).toFixed(2)).toBe(D(o.grandTotalLocal).toFixed(2));
    // the rate moves afterwards: the order keeps its rate
    await setMid("PLN", 4.4);
    expect(Number((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).eurRate)).toBeCloseTo(4.25 * 1.015, 6);
  });

  it("buyers don't see the reference rate / FX margin; suppliers don't see the customer's rate", async () => {
    const asBuyer = (await getOrder(await ctxFor(KK), orderId)).order as Record<string, unknown>;
    expect(asBuyer.eurRate).toBeDefined();
    expect(asBuyer.midRate).toBeUndefined();
    expect(asBuyer.fxMarginPct).toBeUndefined();
    expect(asBuyer.vendorRate).toBeUndefined();
    const asVendor = (await getOrder(await ctxFor(HK), orderId)).order as Record<string, unknown>;
    expect(asVendor.eurRate).toBeUndefined();
    expect(asVendor.grandTotalLocal).toBeUndefined();
    expect(asVendor.vendorRate).toBeDefined();
  });

  it("delivered → invoice and supplier statement in złoty (the order's locked rates)", async () => {
    const inv = await deliver(orderId);
    invoiceId = inv.id;
    const o = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(inv.currencyCode).toBe("PLN");
    expect(Number(inv.grossTotalLocal)).toBeCloseTo(Number(o.grandTotalLocal), 2);
    expect(Number(inv.midRate)).toBe(4.25);
    const lines = await prisma.invoiceLine.findMany({ where: { invoiceId } });
    expect(lines.every((l) => l.lineNetLocal != null)).toBe(true);
    const st = await prisma.vendorBillingStatement.findFirstOrThrow({ where: { orderId, isCreditStatement: false } });
    expect(st.currencyCode).toBe("PLN");
    expect(Number(st.rate)).toBe(4.25);
    expect(Number(st.expectedNetLocal)).toBeCloseTo(Number(st.expectedNet) * 4.25, 1);
  });

  it("paying online: charged in złoty; booked at the invoice's rate; the difference at today's rate is an exchange gain", async () => {
    const kk = await ctxFor(KK);
    await prisma.paymentRequest.updateMany({ where: { companyId: kk.company.id, status: { in: ["OPEN", "PROCESSING"] } }, data: { status: "CANCELLED" } });
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    const req = await buyerPayInvoices(kk, [invoiceId]);
    expect(req.currencyCode).toBe("PLN");
    expect(Number(req.amountLocal)).toBeCloseTo(Number(inv.grossTotalLocal), 2);
    await startPayment(req.id, "MULTIBANCO", { via: "portal" });
    await simMultibancoPaid(req.id);
    const r = await prisma.paymentRequest.findUniqueOrThrow({ where: { id: req.id }, include: { payment: { include: { allocations: true } } } });
    expect(r.status).toBe("PAID");
    expect(r.payment!.currencyCode).toBe("PLN");
    expect(Number(r.payment!.amountLocal)).toBeCloseTo(Number(inv.grossTotalLocal), 2);
    expect(Number(r.payment!.allocations[0].amount)).toBeCloseTo(Number(inv.grossTotal), 2); // clears the invoice in EUR
    expect((await openAmounts([invoiceId])).get(invoiceId)!.toNumber()).toBe(0);
    const fx = await prisma.fxEntry.findMany({ where: { paymentId: r.payment!.id } });
    expect(fx).toHaveLength(1);
    // money worth local / 4.40 today against local / (invoice ratio) booked → złoty weaker → a loss
    const expected = D(inv.grossTotalLocal).div(4.4).minus(D(inv.grossTotalLocal).div(D(inv.grossTotalLocal).div(D(inv.grossTotal)))).toDecimalPlaces(2);
    expect(Number(fx[0].gainLossEur)).toBeCloseTo(expected.toNumber(), 1);
    expect(Number(fx[0].gainLossEur)).toBeLessThan(0);
  });

  it("the supplier invoices FIRINGI in złoty; FIRINGI pays in złoty and books the exchange difference", async () => {
    const hk = await ctxFor(HK), fin = await ctxFor(FIN);
    const st = await prisma.vendorBillingStatement.findFirstOrThrow({ where: { orderId, isCreditStatement: false } });
    const file = new File([Buffer.from("%PDF-1.4 test")], "fv.pdf", { type: "application/pdf" });
    const vi = await submitVendorInvoice(hk, { statementIds: [st.id], docType: "INVOICE", externalNumber: `FV/${Date.now()}`, issueDate: new Date(), netTotal: String(st.expectedNetLocal), vatTotal: String(st.expectedVatLocal), file });
    expect(vi).toMatchObject({ status: "MATCHED", currencyCode: "PLN" });
    expect(Number(vi.grossTotal)).toBeCloseTo(Number(st.expectedGross), 2); // EUR = the statement's EUR
    await reviewVendorInvoice(fin, vi.id, "APPROVED", null);
    await setMid("PLN", 4.1);
    const pay = await recordPayment(fin, { direction: "OUTBOUND", companyId: hk.company.id, method: "BANK_TRANSFER", amount: Number(vi.grossTotal), paidAt: new Date(), allocations: [{ documentId: vi.id, amount: Number(vi.grossTotal) }] });
    const p = await prisma.payment.findUniqueOrThrow({ where: { id: pay.id } });
    expect(p.currencyCode).toBe("PLN");
    expect(Number(p.amountLocal)).toBeCloseTo(Number(vi.grossTotalLocal), 2);
    const fx = await prisma.fxEntry.findFirstOrThrow({ where: { paymentId: pay.id } });
    expect(fx.kind).toBe("PAYABLE");
    expect(Number(fx.gainLossEur)).toBeLessThan(0); // złoty stronger (4.25 → 4.10): paying it costs more EUR
  });

  it("accounting export: balanced, with the currency kept and the FX to its own accounts; P&L has the FX line", async () => {
    const fin = await ctxFor(FIN);
    const d = new Date().toISOString().slice(0, 10);
    const prev = await accountingPreview(fin, { from: d, to: d, journals: ["SALES", "RECEIPTS", "PAYOUTS"] });
    expect(prev.balanced).toBe(true);
    const from = new Date(`${d}T00:00:00Z`), to = new Date(from.getTime() + 86400_000);
    const docs = await collectDocuments(["SALES", "RECEIPTS", "PAYOUTS"], from, to);
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    const doc = docs.find((x) => x.number === (inv.providerNumber ?? inv.fullNumber));
    expect(doc).toMatchObject({ currency: "PLN" });
    expect(Number(doc!.amountLocal)).toBeCloseTo(Number(inv.grossTotalLocal), 2);
    const entries = toEntries(docs, await accountMap());
    expect(entries.some((e) => e.account === "6863")).toBe(true); // exchange losses
    const dr = entries.reduce((a, e) => a.plus(e.debit), new Decimal(0)), cr = entries.reduce((a, e) => a.plus(e.credit), new Decimal(0));
    expect(dr.minus(cr).abs().toNumber()).toBeLessThan(0.01);
    const pnl = await computePnl({ months: 1 });
    expect(pnl.total.fx).toBeLessThan(0);
  });

  it("reports: the customer's report in złoty at each order's rate; FIRINGI's switch", async () => {
    const kk = await ctxFor(KK);
    const q = await readQuery(kk, "BUYER", { period: "7d" });
    expect(q.money).toBe("money:PLN");
    const k = await kpis(q.filters);
    const o = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(k.gross).toBeGreaterThanOrEqual(Number(o.grandTotal) * Number(o.eurRate) - 0.05);
    const sa = await ctxFor(SA);
    const q2 = await readQuery(sa, "ADMIN", { period: "7d", ccy: "SEK" });
    expect(q2.money).toBe("money:SEK");
    expect(q2.filters.fx).toMatchObject({ code: "SEK" });
  });
});

describe("bank reconciliation in złoty", () => {
  it("a PLN bank line meets only PLN invoices, in złoty, and books the payment with its FX", async () => {
    const fin = await ctxFor(FIN);
    await setMid("PLN", 4.25);
    const id2 = await placePl([["FIR-COLA33", 5]]);
    const inv = await deliver(id2);
    const iban = "PL61109010140000071219812874";
    const acc = (await prisma.bankAccount.findFirst({ where: { ownerKey: "FIRINGI", iban } })) ?? (await Bank.saveAccount(fin, { name: "mBank PLN", iban, currencyCode: "PLN" }));
    const tag = Math.random().toString(36).slice(2, 7);
    const local = Number(inv.grossTotalLocal).toFixed(2);
    const xml = `<?xml version="1.0"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><Stmt><Id>S-${tag}</Id><Acct><Id><IBAN>${iban}</IBAN></Id><Ccy>PLN</Ccy></Acct>
<Ntry><Amt Ccy="PLN">${local}</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>${new Date().toISOString().slice(0, 10)}</Dt></BookgDt><AcctSvcrRef>PLN-${tag}</AcctSvcrRef>
<NtryDtls><TxDtls><RltdPties><Dbtr><Nm>Kebab Krakow</Nm></Dbtr></RltdPties><RmtInf><Ustrd>Zaplata ${inv.fullNumber}</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry></Stmt></BkToCstmrStmt></Document>`;
    await Bank.importStatement(fin, acc.id, { name: "pln.xml", buf: Buffer.from(xml, "utf8") });
    const line = await prisma.bankLine.findFirstOrThrow({ where: { bankRef: `PLN-${tag}` } });
    expect(line.currencyCode).toBe("PLN");
    const sug = (line.suggestion ?? (await M.lineProposals(fin, line.id))[0]) as unknown as M.Proposal;
    expect(sug).toMatchObject({ kind: "CUSTOMER_PAYMENT" });
    expect(sug.items[0]).toMatchObject({ id: inv.id, amount: Number(local) });
    await M.confirmMatch(fin, line.id, sug);
    expect((await openAmounts([inv.id])).get(inv.id)!.toNumber()).toBe(0);
    const pay = await prisma.payment.findFirstOrThrow({ where: { allocations: { some: { invoiceId: inv.id } } } });
    expect(pay).toMatchObject({ currencyCode: "PLN" });
    expect(Number(pay.amountLocal)).toBe(Number(local));
  });
});

describe("rates: the feed, overrides, alerts and the switches", () => {
  it("the ECB feed (simulated) stores today's rates; a rate set by hand wins and the feed's is kept beside it", async () => {
    const sa = await ctxFor(SA);
    await C.overrideRate(sa, { code: "SEK", rate: 11.5, note: "test" });
    const r = await C.runFxJob({ force: true });
    expect(r.fetched).toBe(true);
    const today = new Date(new Date().toISOString().slice(0, 10));
    const sek = await prisma.exchangeRate.findUniqueOrThrow({ where: { baseCode_quoteCode_date: { baseCode: "EUR", quoteCode: "SEK", date: today } } });
    expect(sek).toMatchObject({ source: "MANUAL" });
    expect(Number(sek.rate)).toBe(11.5);
    expect(sek.feedRate).not.toBeNull();
    await C.clearOverride(sa, sek.id);
    expect((await prisma.exchangeRate.findUniqueOrThrow({ where: { id: sek.id } })).source).toBe("ECB");
  });

  it("alerts: a big move, a feed that fails, a stale rate — once a day each", async () => {
    await prisma.fxEvent.deleteMany({});
    await setMid("PLN", 4.25);
    const today = new Date(new Date().toISOString().slice(0, 10));
    // yesterday much lower → today's feed value is a big move
    const y = new Date(today.getTime() - 86400_000);
    await prisma.exchangeRate.upsert({ where: { baseCode_quoteCode_date: { baseCode: "EUR", quoteCode: "PLN", date: y } }, update: { rate: 3.9 }, create: { baseCode: "EUR", quoteCode: "PLN", date: y, rate: 3.9, source: "ECB" } });
    C.clearFxCache();
    await C.runFxJob({ force: true });
    expect(await prisma.fxEvent.count({ where: { kind: "MOVE", currencyCode: "PLN" } })).toBe(1);
    process.env.FX_SIMULATE_FAIL = "1";
    try { await C.runFxJob({ force: true }); await C.runFxJob({ force: true }); } finally { delete process.env.FX_SIMULATE_FAIL; }
    expect(await prisma.fxEvent.count({ where: { kind: "FEED_FAILED" } })).toBe(1);
    expect(await C.openFxAlerts()).toBeGreaterThanOrEqual(2);
    await C.ackFxEvent(await ctxFor(SA), "ALL");
    expect(await C.openFxAlerts()).toBe(0);
  });

  it("switching a country off (or everything off) puts its customers back on EUR", async () => {
    await settings({ countries: { ...DEFAULT_CURRENCY_SETTINGS.countries, PL: false, SE: true } });
    expect((await C.viewerFx(await ctxFor(KK))).code).toBe("EUR");
    const cola = (await browseCatalogue(await ctxFor(KK), { q: "Coca-Cola" })).items.find((i) => i.sku === "FIR-COLA33")!;
    expect(cola.price!.local).toBeNull();
    await settings({ enabled: false });
    expect((await C.viewerFx(await ctxFor(KK))).code).toBe("EUR");
    await settings();
    expect((await C.viewerFx(await ctxFor(KK))).code).toBe("PLN");
  });

  it("suppliers: price lists in EUR, their own currency or an enabled local one; converting a list at today's rate", async () => {
    const hk = await ctxFor(HK);
    const cur = await listCurrencies(hk);
    expect(cur.own).toBe("PLN");
    expect(cur.allowed).toEqual(expect.arrayContaining(["EUR", "PLN", "SEK"]));
    const eurList = await prisma.priceList.findFirstOrThrow({ where: { vendorCompanyId: hk.company.id, currencyCode: "EUR" }, include: { items: true } });
    const before = Number(eurList.items[0].unitPriceNet);
    const mid = Number(await C.midRate("PLN"));
    await convertPriceListCurrency(hk, eurList.id, "PLN");
    const after = await prisma.priceListItem.findUniqueOrThrow({ where: { id: eurList.items[0].id } });
    expect(Number(after.unitPriceNet)).toBeCloseTo(before * mid, 2);
    await convertPriceListCurrency(hk, eurList.id, "EUR");
    expect(Number((await prisma.priceListItem.findUniqueOrThrow({ where: { id: eurList.items[0].id } })).unitPriceNet)).toBeCloseTo(before, 2);
  });
});
