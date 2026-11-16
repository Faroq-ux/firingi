/**
 * Phase 37: bank reconciliation — import (CAMT / MT940 / CSV with mapping, duplicates once, balance check),
 * FIRINGI matching (invoice numbers, remembered IBAN, part payments, several invoices, credit, fee within the
 * tolerance, recorded payments, supplier payouts, pay-before-shipping orders), auto-booking per the settings,
 * undo, rules; suppliers and customers in their own books (FIRINGI payouts, payments to FIRINGI, FIRINGI
 * invoices, accounting entries); rights; the simulated bank feed.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import * as S from "@/server/bank/service";
import * as M from "@/server/bank/match";
import { openAmounts, customerCredit } from "@/server/payments/service";
import { simQueue } from "@/server/bank/feed";
import { DEFAULT_BANK_SETTINGS } from "@/lib/bank/settings";
import { ctxFor } from "../helpers";

const SA = "superadmin@firingi.test", FIN = "finance@firingi.test", LX = "owner@lisboacentral.test", KEBAB = "owner@kebabhouse.test";
const DAY = 86_400_000;
const today = () => new Date().toISOString().slice(0, 10);
const tag = `${Date.now() % 1e7}`;
let kebabId = "", lxId = "", legalEntityId = "";
const invoiceIds: string[] = [], viIds: string[] = [];

async function wipe() {
  await prisma.bankMatch.deleteMany({});
  await prisma.bankLine.deleteMany({});
  await prisma.bankStatement.deleteMany({});
  await prisma.bankAccount.deleteMany({});
  await prisma.bankRule.deleteMany({});
  await prisma.bankPayerLink.deleteMany({});
  await prisma.setting.deleteMany({ where: { OR: [{ key: "bank.settings" }, { key: { startsWith: "bank.sim." } }] } });
}
async function invoice(gross: number, n: number) {
  const inv = await prisma.invoice.create({
    data: {
      legalEntityId, docType: "INVOICE", status: "ISSUED", recipientCompanyId: kebabId, issuerSnapshot: {}, recipientSnapshot: {},
      fullNumber: `FT BNK${tag}/${n}`, netTotal: (gross / 1.23).toFixed(2), vatTotal: (gross - gross / 1.23).toFixed(2), grossTotal: gross.toFixed(2),
      issuedAt: new Date(Date.now() - (30 - n) * DAY), dueAt: new Date(Date.now() + n * DAY),
    },
  });
  invoiceIds.push(inv.id);
  return inv;
}
const open = async (id: string) => Number((await openAmounts([id])).get(id) ?? 0);
async function setSettings(p: Partial<typeof DEFAULT_BANK_SETTINGS>) {
  const sa = await ctxFor(SA);
  return S.saveBankSettings(sa, { ...DEFAULT_BANK_SETTINGS, ...p, feed: { ...DEFAULT_BANK_SETTINGS.feed, ...(p.feed ?? {}) } });
}
const file = (name: string, text: string) => ({ name, buf: Buffer.from(text, "utf8") });
const camt = (iban: string, entries: { amt: number; ref: string; name?: string; iban?: string; remit: string; date?: string }[]) => `<?xml version="1.0"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><Stmt><Id>S-${tag}-${Math.random().toString(36).slice(2, 6)}</Id>
<Acct><Id><IBAN>${iban}</IBAN></Id><Ccy>EUR</Ccy></Acct>
${entries.map((e) => `<Ntry><Amt Ccy="EUR">${Math.abs(e.amt).toFixed(2)}</Amt><CdtDbtInd>${e.amt < 0 ? "DBIT" : "CRDT"}</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>${e.date ?? today()}</Dt></BookgDt><AcctSvcrRef>${e.ref}</AcctSvcrRef>
<NtryDtls><TxDtls><RltdPties>${e.amt < 0 ? `<Cdtr><Nm>${e.name ?? ""}</Nm></Cdtr>${e.iban ? `<CdtrAcct><Id><IBAN>${e.iban}</IBAN></Id></CdtrAcct>` : ""}` : `<Dbtr><Nm>${e.name ?? ""}</Nm></Dbtr>${e.iban ? `<DbtrAcct><Id><IBAN>${e.iban}</IBAN></Id></DbtrAcct>` : ""}`}</RltdPties><RmtInf><Ustrd>${e.remit}</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>`).join("\n")}
</Stmt></BkToCstmrStmt></Document>`;

const FIRINGI_IBAN = "PT50000201231234567890154";
const KEBAB_IBAN = "PT50003300004567890123456";
let accId = "";

beforeAll(async () => {
  await wipe();
  kebabId = (await ctxFor(KEBAB)).company.id;
  lxId = (await ctxFor(LX)).company.id;
  legalEntityId = (await prisma.legalEntity.findFirstOrThrow()).id;
});
afterAll(async () => {
  await wipe();
  const pays = await prisma.payment.findMany({ where: { OR: [{ allocations: { some: { vendorInvoiceId: { in: viIds } } } }, { reference: { contains: tag } }], allocations: { none: { invoiceId: { in: invoiceIds } } } }, select: { id: true } });
  await prisma.paymentRequest.deleteMany({ where: { paymentId: { in: pays.map((p) => p.id) } } });
  await prisma.payment.deleteMany({ where: { id: { in: pays.map((p) => p.id) } } });
  await prisma.vendorInvoice.deleteMany({ where: { id: { in: viIds } } });
  // issued invoices can't be deleted (database rule): close what's still open so other tests don't see it
  const left = await openAmounts(invoiceIds);
  const allocs = [...left].filter(([, v]) => v.gt(0)).map(([invoiceId, v]) => ({ invoiceId, amount: v.toFixed(2) }));
  if (allocs.length) await prisma.payment.create({ data: { companyId: kebabId, direction: "INBOUND", method: "OTHER", amount: allocs.reduce((a, x) => a + Number(x.amount), 0).toFixed(2), status: "CONFIRMED", paidAt: new Date(), reference: "test cleanup (bank)", allocations: { create: allocs } } });
  await prisma.$disconnect();
});

describe("accounts and importing", () => {
  it("only finance staff work on FIRINGI's bank; a valid IBAN once per owner", async () => {
    const fin = await ctxFor(FIN);
    await expect(S.saveAccount(fin, { name: "Main", iban: "PT50 1234" })).rejects.toThrow(/valid IBAN/);
    const a = await S.saveAccount(fin, { name: "Millennium main", iban: "PT50 0002 0123 1234 5678 9015 4" });
    accId = a.id;
    expect(a).toMatchObject({ ownerKey: "FIRINGI", iban: FIRINGI_IBAN, companyId: null });
    await expect(S.saveAccount(fin, { name: "Again", iban: FIRINGI_IBAN })).rejects.toThrow(/already/);
    // a customer can't see FIRINGI's accounts, and has its own
    const kb = await ctxFor(KEBAB);
    expect(await S.listAccounts(S.ownerOf(kb))).toHaveLength(0);
    await expect(S.importStatement(kb, accId, file("x.xml", "<x/>"))).rejects.toThrow(/not found/i);
  });

  it("CAMT import: lines once (duplicates on re-import), balance check, wrong account refused", async () => {
    const fin = await ctxFor(FIN);
    const xml = camt(FIRINGI_IBAN, [{ amt: -3.5, ref: `FEE-${tag}`, remit: "COMISSAO MANUTENCAO" }]);
    const r = await S.importStatement(fin, accId, file("s.xml", xml));
    expect(r).toMatchObject({ needsMapping: false, lines: 1, newLines: 1, duplicates: 0, balanceOk: null });
    const again = await S.importStatement(fin, accId, file("s.xml", xml));
    expect(again).toMatchObject({ newLines: 0, duplicates: 1 });
    await expect(S.importStatement(fin, accId, file("o.xml", camt("DE89370400440532013000", [{ amt: 1, ref: "x", remit: "x" }])))).rejects.toThrow(/DE89370400440532013000/);
  });

  it("CSV: the first file asks for the columns (guessed); the mapping is kept for the next file", async () => {
    const fin = await ctxFor(FIN);
    const csv = `Conta;${FIRINGI_IBAN}\n\nData Mov.;Descrição;Débito;Crédito\n${new Date().toLocaleDateString("pt-PT")};JUROS CREDORES ${tag};;0,12\n`;
    const p = await S.importStatement(fin, accId, file("m.csv", csv));
    expect(p.needsMapping).toBe(true);
    if (!p.needsMapping) return;
    expect(p.guess).toMatchObject({ headerRow: 2, date: "Data Mov.", debit: "Débito", credit: "Crédito", decimal: "," });
    const r = await (await import("@/server/bank/service")).importStatement(fin, accId, { token: p.fileToken }, p.guess);
    expect(r).toMatchObject({ needsMapping: false, newLines: 1 });
    const next = await S.importStatement(fin, accId, file("m2.csv", csv.replace(`${tag};;0,12`, `${tag} B;;0,30`)));
    expect(next).toMatchObject({ needsMapping: false, newLines: 1 }); // saved columns used
  });
});

describe("FIRINGI: matching money in and out", () => {
  it("invoice numbers in the transfer: two invoices paid exactly → sure (99); confirmed by a person; IBAN remembered", async () => {
    const fin = await ctxFor(FIN);
    const a = await invoice(100, 1), b = await invoice(50.5, 2);
    await S.importStatement(fin, accId, file("1.xml", camt(FIRINGI_IBAN, [{ amt: 150.5, ref: `R1-${tag}`, name: "Kebab House Lda", iban: KEBAB_IBAN, remit: `Pagamento ${a.fullNumber} e ${b.fullNumber}` }])));
    const line = await prisma.bankLine.findFirstOrThrow({ where: { bankRef: `R1-${tag}` } });
    expect(line.status).toBe("SUGGESTED"); // CONFIRM mode: a person books it
    const sug = line.suggestion as unknown as M.Proposal;
    expect(sug).toMatchObject({ kind: "CUSTOMER_PAYMENT", companyId: kebabId, confidence: 99 });
    expect(sug.items.map((i) => i.amount).sort()).toEqual([100, 50.5].sort());
    await M.confirmMatch(fin, line.id, sug);
    expect([await open(a.id), await open(b.id)]).toEqual([0, 0]);
    expect(await prisma.bankPayerLink.findFirst({ where: { ownerKey: "FIRINGI", iban: KEBAB_IBAN } })).toMatchObject({ companyId: kebabId });
    await expect(M.confirmMatch(fin, line.id, sug)).rejects.toThrow(/already matched/);
  });

  it("the remembered IBAN alone + the oldest invoice's amount; a few cents short → fee within the tolerance", async () => {
    const fin = await ctxFor(FIN);
    const c = await invoice(80, 3);
    await S.importStatement(fin, accId, file("2.xml", camt(FIRINGI_IBAN, [{ amt: 79.4, ref: `R2-${tag}`, name: "KH", iban: KEBAB_IBAN, remit: "transferencia" }])));
    const line = await prisma.bankLine.findFirstOrThrow({ where: { bankRef: `R2-${tag}` } });
    const sug = line.suggestion as unknown as M.Proposal;
    expect(sug).toMatchObject({ kind: "CUSTOMER_PAYMENT", companyId: kebabId, items: [{ id: c.id, amount: 80 }], rest: { amount: -0.6, kind: "FEE" } });
    await M.confirmMatch(fin, line.id, sug);
    expect(await open(c.id)).toBe(0);
    const matches = await prisma.bankMatch.findMany({ where: { lineId: line.id }, orderBy: { amount: "desc" } });
    expect(matches.map((m) => [m.kind, Number(m.amount)])).toEqual([["CUSTOMER_PAYMENT", 80], ["FEE", -0.6]]);
  });

  it("more than open → the rest is the customer's credit; a part payment leaves the invoice open; undo puts it back", async () => {
    const fin = await ctxFor(FIN);
    const d = await invoice(40, 4);
    await S.importStatement(fin, accId, file("3.xml", camt(FIRINGI_IBAN, [
      { amt: 55, ref: `R3-${tag}`, iban: KEBAB_IBAN, remit: `${d.fullNumber}` },
    ])));
    const l3 = await prisma.bankLine.findFirstOrThrow({ where: { bankRef: `R3-${tag}` } });
    const s3 = l3.suggestion as unknown as M.Proposal;
    expect(s3).toMatchObject({ items: [{ id: d.id, amount: 40 }], credit: 15 });
    const creditBefore = (await customerCredit(kebabId)).reduce((x, c) => x + Number(c.free), 0);
    await M.confirmMatch(fin, l3.id, s3);
    expect(await open(d.id)).toBe(0);
    // the 15 € left was used on the customer's other open invoices or stays as credit — never lost
    const pay = await prisma.payment.findFirstOrThrow({ where: { bankMatches: { some: { lineId: l3.id } } }, include: { allocations: true } });
    expect(Number(pay.amount)).toBe(55);
    const usedElsewhere = pay.allocations.filter((x) => x.invoiceId !== d.id).reduce((x, y) => x + Number(y.amount), 0);
    const creditAfter = (await customerCredit(kebabId)).reduce((x, c) => x + Number(c.free), 0);
    expect(Math.round((usedElsewhere + creditAfter - creditBefore) * 100) / 100).toBe(15);
    await M.unmatch(fin, l3.id);
    expect(await open(d.id)).toBe(40);
    expect(await prisma.payment.findUnique({ where: { id: pay.id } })).toBeNull();
    expect((await prisma.bankLine.findUniqueOrThrow({ where: { id: l3.id } })).status).toBe("SUGGESTED");
  });

  it("a payment already recorded (e.g. online) is matched, not recorded twice", async () => {
    const fin = await ctxFor(FIN);
    const p = await prisma.payment.create({ data: { companyId: kebabId, direction: "INBOUND", method: "MULTIBANCO", amount: "61.23", status: "CONFIRMED", paidAt: new Date(), provider: "sim", reference: `MB-${tag}` } });
    await S.importStatement(fin, accId, file("4.xml", camt(FIRINGI_IBAN, [{ amt: 61.23, ref: `R4-${tag}`, name: "SIBS", remit: `MB-${tag}` }])));
    const line = await prisma.bankLine.findFirstOrThrow({ where: { bankRef: `R4-${tag}` } });
    const sug = line.suggestion as unknown as M.Proposal;
    expect(sug).toMatchObject({ kind: "PAYMENT", items: [{ id: p.id, amount: 61.23 }], confidence: 96 });
    const payments = await prisma.payment.count();
    await M.confirmMatch(fin, line.id, sug);
    expect(await prisma.payment.count()).toBe(payments);
  });

  it("a recorded payment for other invoices doesn't compete with a transfer naming an open invoice", async () => {
    const fin = await ctxFor(FIN);
    const x = await invoice(42.42, 9);
    await prisma.payment.create({ data: { companyId: kebabId, direction: "INBOUND", method: "BANK_TRANSFER", amount: "42.42", status: "CONFIRMED", paidAt: new Date(), reference: `OLD-${tag}` } });
    await S.importStatement(fin, accId, file("4b.xml", camt(FIRINGI_IBAN, [{ amt: 42.42, ref: `R4B-${tag}`, name: "Kebab House Lisboa", remit: `${x.fullNumber}` }])));
    const line = await prisma.bankLine.findFirstOrThrow({ where: { bankRef: `R4B-${tag}` } });
    const props = await M.lineProposals(fin, line.id);
    expect(props[0]).toMatchObject({ kind: "CUSTOMER_PAYMENT", items: [{ id: x.id }] });
    expect(props.some((p) => p.kind === "PAYMENT")).toBe(false);
  });

  it("money out: a supplier transfer for its approved invoice → payout recorded, invoice paid", async () => {
    const fin = await ctxFor(FIN);
    const vi = await prisma.vendorInvoice.create({ data: { vendorCompanyId: lxId, externalNumber: `FT LC/${tag}`, issueDate: new Date(), netTotal: "81.30", vatTotal: "18.70", grossTotal: "100.00", fileKey: "test/none.pdf", status: "APPROVED" } });
    viIds.push(vi.id);
    await S.importStatement(fin, accId, file("5.xml", camt(FIRINGI_IBAN, [{ amt: -100, ref: `R5-${tag}`, name: "Lisboa Central", remit: `Pagamento FT LC/${tag}` }])));
    const line = await prisma.bankLine.findFirstOrThrow({ where: { bankRef: `R5-${tag}` } });
    const sug = line.suggestion as unknown as M.Proposal;
    expect(sug).toMatchObject({ kind: "VENDOR_PAYOUT", companyId: lxId, items: [{ id: vi.id, amount: 100 }] });
    await M.confirmMatch(fin, line.id, sug);
    expect((await prisma.vendorInvoice.findUniqueOrThrow({ where: { id: vi.id } })).status).toBe("PAID");
    await M.unmatch(fin, line.id);
    expect((await prisma.vendorInvoice.findUniqueOrThrow({ where: { id: vi.id } })).status).toBe("APPROVED");
  });

  it("AUTO mode books sure lines by itself; rules book bank fees; the rest waits", async () => {
    const fin = await ctxFor(FIN);
    await setSettings({ firingiMode: "AUTO", autoConfidence: 95 });
    await S.saveRule(fin, { name: "Account fees", contains: "COMISSAO", direction: "OUT", kind: "FEE", category: "BANK_FEES" });
    // the fee line imported at the start is now booked by the rule (rules apply to waiting lines)
    expect((await prisma.bankLine.findFirstOrThrow({ where: { bankRef: `FEE-${tag}` } })).status).toBe("MATCHED");
    const e = await invoice(33.33, 5);
    const r = await S.importStatement(fin, accId, file("6.xml", camt(FIRINGI_IBAN, [
      { amt: 33.33, ref: `R6-${tag}`, iban: KEBAB_IBAN, remit: `${e.fullNumber}` },
      { amt: 12.34, ref: `R7-${tag}`, name: "Someone", remit: "?" },
    ])));
    expect(r).toMatchObject({ newLines: 2, autoMatched: 1 });
    expect(await open(e.id)).toBe(0);
    const l6 = await prisma.bankLine.findFirstOrThrow({ where: { bankRef: `R6-${tag}` } });
    expect(l6).toMatchObject({ status: "MATCHED", autoMatched: true });
    expect((await prisma.bankLine.findFirstOrThrow({ where: { bankRef: `R7-${tag}` } })).status).toBe("OPEN");
    await setSettings({ firingiMode: "CONFIRM" });
  });

  it("hand match checks: parts must add up; invoices of another customer refused; ignore + undo", async () => {
    const fin = await ctxFor(FIN);
    const line = await prisma.bankLine.findFirstOrThrow({ where: { bankRef: `R7-${tag}` } });
    const f = await invoice(20, 6);
    await expect(M.confirmMatch(fin, line.id, { kind: "CUSTOMER_PAYMENT", companyId: lxId, items: [{ id: f.id, amount: 12.34 }], confidence: 0, reasons: [] })).rejects.toThrow(/another customer/);
    await expect(M.confirmMatch(fin, line.id, { kind: "CUSTOMER_PAYMENT", companyId: kebabId, items: [{ id: f.id, amount: 10 }], confidence: 0, reasons: [] })).rejects.toThrow(/add up/);
    await M.confirmMatch(fin, line.id, { kind: "CUSTOMER_PAYMENT", companyId: kebabId, items: [{ id: f.id, amount: 12.34 }], confidence: 0, reasons: [] });
    expect(await open(f.id)).toBe(7.66);
    await M.unmatch(fin, line.id);
    await M.ignoreLine(fin, line.id, "test");
    expect((await prisma.bankLine.findUniqueOrThrow({ where: { id: line.id } })).status).toBe("IGNORED");
  });
});

describe("suppliers and customers in their own books", () => {
  it("supplier: FIRINGI's payout arrives in its bank → matched to that payout", async () => {
    const lx = await ctxFor(LX);
    const a = await S.saveAccount(lx, { name: "Conta CGD", iban: "PT50003500001111222233334" });
    const pay = await prisma.payment.create({ data: { companyId: lxId, direction: "OUTBOUND", method: "BANK_TRANSFER", amount: "250.00", status: "CONFIRMED", paidAt: new Date(), reference: `PO-${tag}` } });
    await S.importStatement(lx, a.id, file("v.xml", camt("PT50003500001111222233334", [{ amt: 250, ref: `V1-${tag}`, name: "FIRINGI Lda", remit: `PO-${tag}` }])));
    const line = await prisma.bankLine.findFirstOrThrow({ where: { bankRef: `V1-${tag}` } });
    const sug = line.suggestion as unknown as M.Proposal;
    expect(sug).toMatchObject({ kind: "PAYMENT", items: [{ id: pay.id }] });
    expect(sug.confidence).toBeGreaterThanOrEqual(95);
    await M.confirmMatch(lx, line.id, sug);
    // FIRINGI's own matching still sees this payout as not in FIRINGI's bank yet (separate books)
    const fin = await ctxFor(FIN);
    expect((await M.matchOptions(fin, (await prisma.bankLine.findFirstOrThrow({ where: { bankRef: `R7-${tag}` } })).id, { kind: "PAYMENT" })).length).toBeGreaterThanOrEqual(0);
    // a supplier can't use FIRINGI-only kinds
    await expect(M.confirmMatch(lx, line.id, { kind: "CUSTOMER_PAYMENT", items: [], confidence: 0, reasons: [] })).rejects.toThrow();
  });

  it("customer: its transfer to FIRINGI matched to the FIRINGI invoice (own record); auto-booking when allowed", async () => {
    const kb = await ctxFor(KEBAB);
    const a = await S.saveAccount(kb, { name: "Conta BPI", iban: KEBAB_IBAN });
    const g = await invoice(45, 7);
    await S.importStatement(kb, a.id, file("c.xml", camt(KEBAB_IBAN, [{ amt: -45, ref: `C1-${tag}`, name: "FIRINGI", iban: FIRINGI_IBAN, remit: `${g.fullNumber}` }])));
    const line = await prisma.bankLine.findFirstOrThrow({ where: { bankRef: `C1-${tag}` } });
    const sug = line.suggestion as unknown as M.Proposal;
    expect(sug).toMatchObject({ kind: "FIRINGI_INVOICE", items: [{ id: g.id, amount: 45 }] });
    await M.confirmMatch(kb, line.id, sug);
    expect(await open(g.id)).toBe(45); // the customer's own record doesn't pay FIRINGI's invoice
    // auto-booking for the company's account (FIRINGI allows it by default)
    await prisma.bankAccount.update({ where: { id: a.id }, data: { autoBook: true } });
    const h = await invoice(46, 8);
    const r = await S.importStatement(kb, a.id, file("c2.xml", camt(KEBAB_IBAN, [{ amt: -46, ref: `C2-${tag}`, name: "FIRINGI", remit: `${h.fullNumber}` }])));
    expect(r).toMatchObject({ autoMatched: 0 }); // 90 < 95: still a suggestion
    expect((await prisma.bankLine.findFirstOrThrow({ where: { bankRef: `C2-${tag}` } })).status).toBe("SUGGESTED");
  });
});

describe("bank feed (simulated)", () => {
  it("off until FIRINGI switches it on; link → consent → transactions fetched once", async () => {
    process.env.BANKFEED_SIMULATE = "1";
    const fin = await ctxFor(FIN);
    await expect(S.linkFeed(fin, accId, "SIM_BANK", "/admin/finance/bank")).rejects.toThrow(/isn't switched on/);
    await setSettings({ feed: { enabled: true, provider: "SIMULATED", companiesMayLink: true } });
    const { link } = await S.linkFeed(fin, accId, "SIM_BANK", "/admin/finance/bank");
    expect(link).toContain("/api/bank/feed/callback?account=");
    await simQueue(FIRINGI_IBAN, [{ bookingDate: today(), amount: 9.99, counterparty: "Feed test", remittance: `FEED-${tag}`, bankRef: `F1-${tag}` }], 12345.67);
    const st = await S.feedCallback(accId);
    expect(st.status).toBe("LINKED");
    const acc = await prisma.bankAccount.findUniqueOrThrow({ where: { id: accId } });
    expect(acc).toMatchObject({ feedStatus: "LINKED" });
    expect(Number(acc.balance)).toBe(12345.67);
    expect(await prisma.bankLine.count({ where: { bankRef: `F1-${tag}` } })).toBe(1);
    const again = await S.syncFeed(accId);
    expect(again.newLines).toBe(0);
    await setSettings({});
  });
});
