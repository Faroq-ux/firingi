/**
 * Bank matching engine (Phase 37).
 *
 * For each bank line the engine looks for what it is and how sure it is (0–100):
 *   FIRINGI  money in  → a payment already recorded (online / direct debit / by hand), or a customer's
 *                        transfer for its invoices (by invoice numbers, the remembered IBAN, the name, the
 *                        amount) — split over several invoices, part payments, leftover = customer credit,
 *                        a small shortfall within the tolerance = bank fee; a pay-before-shipping order.
 *            money out → a payout already recorded (supplier payouts, early payouts), or a supplier
 *                        transfer for its approved invoices.
 *   supplier money in  → FIRINGI's payouts to it; its own accounting entries (sales)
 *   customer money out → its payments to FIRINGI; FIRINGI invoices (own record); its expenses
 *   all      rules ("contains X" → bank fees / a category) and anything by hand.
 * A line is booked by itself only when the owner allows it (settings) and the match is sure enough
 * and clearly the best; otherwise it waits as a suggestion for a person.
 */
import "server-only";
import Decimal from "decimal.js";
import type { BankLine, BankMatchKind, Prisma } from "@prisma/client";
import { prisma, type Tx } from "@/server/db";
import type { Ctx } from "@/server/context";
import { AppError, NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";
import { cleanIban, round2 } from "@/lib/bank/common";
import { bankSettings, ownerOf, type Owner } from "./service";

const D = (v: Decimal.Value | { toString(): string } | null | undefined) => new Decimal(v == null ? 0 : v.toString());
const DAY = 86_400_000;
const INVOICE_TYPES = ["INVOICE", "INVOICE_RECEIPT"] as const;

export type Item = { id: string; amount: number; label?: string };
export type Proposal = {
  kind: BankMatchKind;
  companyId?: string | null;
  companyName?: string | null;
  /** invoices / vendor invoices / payments / entries, each with the part of the line it takes (always positive) */
  items: Item[];
  /** CUSTOMER_PAYMENT: money left after the invoices → customer credit */
  credit?: number;
  /** CUSTOMER_PAYMENT for a pay-before-shipping order */
  orderId?: string | null;
  orderNumber?: string | null;
  /** the part of the line that isn't the above (signed like the line): bank fee or another category */
  rest?: { amount: number; kind: "FEE" | "OTHER"; category?: string | null } | null;
  /** FEE / OTHER for the whole line */
  category?: string | null;
  label?: string | null;
  ruleId?: string | null;
  confidence: number;
  reasons: Why[];
};
/** A reason, as a key of the "bank.why" texts (translated on the page) and its values. */
export type Why = { k: string; v?: Record<string, string | number> };
const w = (k: string, v?: Why["v"]): Why => ({ k, ...(v ? { v } : {}) });

// ── text helpers ────────────────────────────────────────────────────────────

const norm = (s: string | null | undefined) => ` ${(s ?? "").toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Z0-9]+/g, " ").trim()} `;
const STOP = new Set(["LDA", "SA", "UNIPESSOAL", "GMBH", "BV", "SL", "SAS", "SARL", "SRL", "LTD", "LIMITED", "AB", "AS", "OY", "SPA", "AG", "KG", "CO", "COMPANY", "THE", "DE", "DA", "DO", "DOS", "DAS", "AND", "UND", "ET", "Y", "E", "TRF", "TRANSF", "TRANSFERENCIA", "SEPA", "PAGAMENTO", "PAYMENT", "INV", "FT"]);
const tokens = (s: string | null | undefined) => norm(s).trim().split(" ").filter((t) => t.length > 1 && !STOP.has(t) && !/^\d+$/.test(t));
/** Does this text name the company? Token overlap with the counterparty, or all its words inside the remittance. */
function namesCompany(company: { legalName: string; tradeName?: string | null }, counterparty: string | null, remittance: string) {
  for (const n of [company.legalName, company.tradeName].filter(Boolean) as string[]) {
    const c = tokens(n);
    if (!c.length) continue;
    const p = new Set(tokens(counterparty));
    if (p.size) {
      const hit = c.filter((t) => p.has(t)).length;
      if (hit / Math.min(c.length, p.size) >= 0.67 && hit >= Math.min(2, c.length)) return true;
    }
    if ((c.length >= 2 || c[0].length >= 6) && c.every((t) => remittance.includes(` ${t} `))) return true;
  }
  return false;
}
/** The keys a document number can appear under in a remittance ("FT FIR2026/12" → "FIR2026 12", "FT FIR2026 12"). */
function docKeys(...nums: (string | null | undefined)[]) {
  const out = new Set<string>();
  for (const n of nums) {
    if (!n) continue;
    const k = norm(n).trim();
    if (k.length >= 4) out.add(k);
    const noType = k.replace(/^[A-Z]{1,3} /, "");
    if (noType.length >= 4 && /\d/.test(noType) && noType.includes(" ")) out.add(noType);
  }
  return [...out];
}
const within = (a: Date, b: Date | null | undefined, days: number) => !!b && Math.abs(a.getTime() - b.getTime()) <= days * DAY;
const eq = (a: number, b: number) => Math.abs(a - b) < 0.005;

// ── what the engine knows (loaded once per run) ─────────────────────────────

type Inv = { id: string; number: string; companyId: string; open: number; gross: number; dueAt: Date | null; keys: string[] };
type Pay = { id: string; companyId: string; company: string; direction: "INBOUND" | "OUTBOUND"; amount: number; left: number; paidAt: Date | null; reference: string | null; method: string; provider: string | null; keys: string[]; docs: string[] };
type VInv = { id: string; number: string; companyId: string; open: number; keys: string[]; issueDate: Date };
type Entry = { id: string; kind: "SALE" | "EXPENSE"; date: Date; amount: number; payee: string | null; description: string | null };
type Order = { id: string; number: string; companyId: string; total: number; keys: string[] };
type Co = { id: string; legalName: string; tradeName: string | null; vatNumber: string | null; taxId: string };

type Knowledge = {
  owner: Owner;
  settings: Awaited<ReturnType<typeof bankSettings>>;
  links: Map<string, string | null>;
  rules: { id: string; contains: string; direction: string | null; kind: BankMatchKind; category: string | null; name: string }[];
  companies: Co[];
  invoices: Inv[]; // FIRINGI: open customer invoices · customer: its FIRINGI invoices not yet in its books
  payments: Pay[]; // payments not yet (fully) matched to this owner's bank
  vendorInvoices: VInv[];
  entries: Entry[];
  orders: Order[];
};

async function know(owner: Owner): Promise<Knowledge> {
  const settings = await bankSettings();
  const [linkRows, rules] = await Promise.all([
    prisma.bankPayerLink.findMany({ where: { ownerKey: owner.key } }),
    prisma.bankRule.findMany({ where: { ownerKey: owner.key, active: true } }),
  ]);
  const links = new Map(linkRows.map((l) => [l.iban, l.companyId]));
  const since = new Date(Date.now() - 400 * DAY);
  const reconciled = async (paymentIds: string[]) => {
    const rows = await prisma.bankMatch.groupBy({ by: ["paymentId"], where: { paymentId: { in: paymentIds }, line: { account: { ownerKey: owner.key } } }, _sum: { amount: true } });
    return new Map(rows.map((r) => [r.paymentId!, Math.abs(Number(r._sum.amount ?? 0))]));
  };
  const toPays = async (rows: { id: string; companyId: string; direction: "INBOUND" | "OUTBOUND"; amount: Prisma.Decimal; refundedAmount: Prisma.Decimal; paidAt: Date | null; reference: string | null; method: string; provider: string | null; company: { legalName: string }; allocations: { invoice: { fullNumber: string | null; providerNumber: string | null } | null; vendorInvoice: { externalNumber: string } | null }[] }[]) => {
    const done = await reconciled(rows.map((r) => r.id));
    return rows.map((p) => {
      const amount = Number(p.amount);
      return { id: p.id, companyId: p.companyId, company: p.company.legalName, direction: p.direction, amount, left: round2(amount - (done.get(p.id) ?? 0)), paidAt: p.paidAt, reference: p.reference, method: p.method, provider: p.provider, keys: p.allocations.flatMap((a) => docKeys(a.invoice?.fullNumber, a.invoice?.providerNumber, a.vendorInvoice?.externalNumber)), docs: p.allocations.map((a) => a.invoice?.providerNumber ?? a.invoice?.fullNumber ?? a.vendorInvoice?.externalNumber).filter((x): x is string => !!x) };
    }).filter((p) => p.left > 0.004);
  };
  const paySelect = { id: true, companyId: true, direction: true, amount: true, refundedAmount: true, paidAt: true, reference: true, method: true, provider: true, company: { select: { legalName: true } }, allocations: { select: { invoice: { select: { fullNumber: true, providerNumber: true } }, vendorInvoice: { select: { externalNumber: true } } } } } as const;

  if (owner.side === "FIRINGI") {
    const [companies, invRows, payRows, vinvRows, orderRows] = await Promise.all([
      prisma.company.findMany({ where: { type: { not: "ADMIN" } }, select: { id: true, legalName: true, tradeName: true, vatNumber: true, taxId: true } }),
      prisma.invoice.findMany({ where: { docType: { in: [...INVOICE_TYPES] }, status: { not: "DRAFT" }, issuedAt: { gte: since } }, select: { id: true, fullNumber: true, providerNumber: true, recipientCompanyId: true, grossTotal: true, dueAt: true, creditNotes: { where: { status: { not: "DRAFT" } }, select: { grossTotal: true } }, allocations: { where: { payment: { status: { in: ["CONFIRMED", "REFUNDED"] } } }, select: { amount: true } } } }),
      prisma.payment.findMany({ where: { status: { in: ["CONFIRMED", "REFUNDED"] }, paidAt: { gte: since } }, select: paySelect }),
      prisma.vendorInvoice.findMany({ where: { status: "APPROVED", docType: { not: "CREDIT_NOTE" } }, select: { id: true, externalNumber: true, vendorCompanyId: true, grossTotal: true, issueDate: true, paymentAllocations: { where: { payment: { status: "CONFIRMED" } }, select: { amount: true } } } }),
      prisma.order.findMany({ where: { awaitingPayment: true, status: "ON_HOLD" }, select: { id: true, number: true, buyerCompanyId: true, grandTotal: true } }),
    ]);
    const invoices = invRows.map((i) => {
      const open = round2(Number(i.grossTotal) - i.creditNotes.reduce((a, c) => a + Number(c.grossTotal), 0) - i.allocations.reduce((a, x) => a + Number(x.amount), 0));
      return { id: i.id, number: i.providerNumber ?? i.fullNumber ?? i.id, companyId: i.recipientCompanyId, open, gross: Number(i.grossTotal), dueAt: i.dueAt, keys: docKeys(i.fullNumber, i.providerNumber) };
    }).filter((i) => i.open > 0.004).sort((a, b) => (a.dueAt?.getTime() ?? 0) - (b.dueAt?.getTime() ?? 0));
    const vendorInvoices = vinvRows.map((v) => ({ id: v.id, number: v.externalNumber, companyId: v.vendorCompanyId, open: round2(Number(v.grossTotal) - v.paymentAllocations.reduce((a, x) => a + Number(x.amount), 0)), keys: docKeys(v.externalNumber), issueDate: v.issueDate })).filter((v) => v.open > 0.004).sort((a, b) => a.issueDate.getTime() - b.issueDate.getTime());
    return { owner, settings, links, rules, companies, invoices, payments: await toPays(payRows), vendorInvoices, entries: [], orders: orderRows.map((o) => ({ id: o.id, number: o.number, companyId: o.buyerCompanyId, total: Number(o.grandTotal), keys: docKeys(o.number) })) };
  }

  const cid = owner.companyId!;
  const accountingOn = !!(await prisma.companyFeature.findFirst({ where: { companyId: cid, key: "ACCOUNTING", enabled: true } }).catch(() => null));
  const [payRows, entryRows, matchedEntries, invRows, matchedInv, firingi] = await Promise.all([
    prisma.payment.findMany({ where: { companyId: cid, status: { in: ["CONFIRMED", "REFUNDED"] }, paidAt: { gte: since }, direction: owner.side === "VENDOR" ? "OUTBOUND" : "INBOUND" }, select: paySelect }),
    accountingOn ? prisma.accountingEntry.findMany({ where: { companyId: cid, date: { gte: since } }, select: { id: true, kind: true, date: true, amount: true, payee: true, description: true } }) : Promise.resolve([]),
    prisma.bankMatch.findMany({ where: { accountingEntryId: { not: null }, line: { account: { ownerKey: owner.key } } }, select: { accountingEntryId: true } }),
    owner.side === "BUYER" ? prisma.invoice.findMany({ where: { recipientCompanyId: cid, docType: { in: [...INVOICE_TYPES] }, status: { not: "DRAFT" }, issuedAt: { gte: since } }, select: { id: true, fullNumber: true, providerNumber: true, grossTotal: true, dueAt: true } }) : Promise.resolve([]),
    prisma.bankMatch.findMany({ where: { invoiceId: { not: null }, line: { account: { ownerKey: owner.key } } }, select: { invoiceId: true, amount: true } }),
    Promise.resolve({ id: "FIRINGI", legalName: "FIRINGI", tradeName: null, vatNumber: null, taxId: "" }),
  ]);
  const usedEntries = new Set(matchedEntries.map((m) => m.accountingEntryId));
  const paidInBooks = new Map<string, number>();
  for (const m of matchedInv) paidInBooks.set(m.invoiceId!, (paidInBooks.get(m.invoiceId!) ?? 0) + Math.abs(Number(m.amount)));
  return {
    owner, settings, links, rules, companies: [firingi], payments: await toPays(payRows), vendorInvoices: [], orders: [],
    entries: entryRows.filter((e) => !usedEntries.has(e.id)).map((e) => ({ id: e.id, kind: e.kind, date: e.date, amount: Number(e.amount), payee: e.payee, description: e.description })),
    invoices: invRows.map((i) => ({ id: i.id, number: i.providerNumber ?? i.fullNumber ?? i.id, companyId: cid, gross: Number(i.grossTotal), open: round2(Number(i.grossTotal) - (paidInBooks.get(i.id) ?? 0)), dueAt: i.dueAt, keys: docKeys(i.fullNumber, i.providerNumber) })).filter((i) => i.open > 0.004),
  };
}

// ── proposals for one line ──────────────────────────────────────────────────

/** Spread `amount` over documents in order (oldest first); returns the items and what's left. */
function spread(docs: { id: string; open: number; number: string }[], amount: number) {
  let left = amount;
  const items: Item[] = [];
  for (const d of docs) {
    if (left <= 0.004) break;
    const a = round2(Math.min(d.open, left));
    if (a > 0.004) { items.push({ id: d.id, amount: a, label: d.number }); left = round2(left - a); }
  }
  return { items, left };
}

function tolerance(k: Knowledge, target: number) {
  return Math.min(k.settings.toleranceAmount, (k.settings.tolerancePct / 100) * target);
}

/** Documents of one party, paid by `amount`: exact one, exact all, exact oldest-first prefix, within tolerance, or a part payment. */
function payDocs(k: Knowledge, docs: { id: string; open: number; number: string }[], amount: number, base: number, why: Why): Omit<Proposal, "kind" | "companyId"> | null {
  if (!docs.length) return null;
  const exactOne = docs.filter((d) => eq(d.open, amount));
  if (exactOne.length === 1) return { items: [{ id: exactOne[0].id, amount, label: exactOne[0].number }], confidence: base, reasons: [why, w("exactOne", { doc: exactOne[0].number })] };
  const total = round2(docs.reduce((a, d) => a + d.open, 0));
  if (eq(total, amount)) return { items: docs.map((d) => ({ id: d.id, amount: d.open, label: d.number })), confidence: base - 2, reasons: [why, w("allOpen", { n: docs.length })] };
  let run = 0;
  for (let i = 0; i < docs.length; i++) {
    run = round2(run + docs[i].open);
    if (eq(run, amount)) return { items: docs.slice(0, i + 1).map((d) => ({ id: d.id, amount: d.open, label: d.number })), confidence: base - 5, reasons: [why, w("oldest", { n: i + 1 })] };
  }
  // short by a little (bank charges taken by the payer's bank): close the documents, the gap is a fee
  for (const target of [...exactOne.length ? [] : docs.map((d) => ({ docs: [d], sum: d.open })), { docs, sum: total }]) {
    const gap = round2(target.sum - amount);
    if (gap > 0.004 && gap <= tolerance(k, target.sum)) return { items: target.docs.map((d) => ({ id: d.id, amount: d.open, label: d.number })), rest: { amount: -gap, kind: "FEE" }, confidence: base - 7, reasons: [why, w("shortFee", { amount: gap.toFixed(2) })] };
  }
  const s = spread(docs, amount);
  return { items: s.items, credit: s.left > 0.004 ? s.left : undefined, confidence: base - 30, reasons: [why, w(s.left > 0.004 ? "moreCredit" : "partOldest")] };
}

function ruleFor(k: Knowledge, line: BankLine, text: string): Proposal | null {
  const amount = Number(line.amount);
  for (const r of k.rules) {
    if ((r.direction === "IN" && amount < 0) || (r.direction === "OUT" && amount > 0)) continue;
    if (text.includes(norm(r.contains))) return { kind: r.kind, items: [], category: r.category ?? (r.kind === "FEE" ? "BANK_FEES" : "OTHER"), label: r.name, ruleId: r.id, confidence: 97, reasons: [w("rule", { name: r.name })] };
  }
  return null;
}

export function proposalsFor(k: Knowledge, line: BankLine): Proposal[] {
  const L = Number(line.amount);
  const A = Math.abs(L);
  const inbound = L > 0;
  const text = norm(`${line.remittance ?? ""} ${line.endToEndId ?? ""} ${line.counterparty ?? ""}`);
  const remit = norm(`${line.remittance ?? ""} ${line.endToEndId ?? ""}`);
  const iban = cleanIban(line.counterpartyIban);
  const date = line.bookingDate;
  const W = k.settings.windowDays;
  const out: Proposal[] = [];
  const nameOf = (id: string) => k.companies.find((c) => c.id === id)?.legalName ?? null;

  // 1. payments already recorded (any owner): same amount, close in time
  const dir = k.owner.side === "FIRINGI" ? (inbound ? "INBOUND" : "OUTBOUND") : k.owner.side === "VENDOR" ? (inbound ? "OUTBOUND" : null) : (inbound ? null : "INBOUND");
  if (dir) {
    const pays = k.payments.filter((p) => p.direction === dir && within(date, p.paidAt, W));
    const same = pays.filter((p) => eq(p.left, A));
    const strong = (p: Pay) => (p.reference && remit.includes(norm(p.reference))) || (k.owner.side === "FIRINGI" && (iban && k.links.get(iban) === p.companyId || namesCompany({ legalName: p.company }, line.counterparty, text)));
    // the transfer names documents: a recorded payment for those is sure, one for other open documents isn't it
    const named = (keys: string[]) => keys.some((key) => remit.includes(` ${key} `));
    const namesOpen = k.owner.side === "FIRINGI" && (inbound ? k.invoices : k.vendorInvoices).some((d) => named(d.keys));
    for (const p of same) {
      const own = named(p.keys);
      if (namesOpen && !own) continue;
      const s = strong(p) || own;
      const base = k.owner.side === "FIRINGI" ? (s ? 96 : 84) : (s || /FIRINGI/.test(text) ? 95 : 88);
      out.push({ kind: "PAYMENT", companyId: p.companyId, companyName: p.company, items: [{ id: p.id, amount: A, label: p.docs.join(", ") || p.reference || p.company }], confidence: base - (same.length > 1 && !s ? 20 : 0), reasons: [w(s ? "payRef" : "payAmount"), ...(same.length > 1 && !s ? [w("payMany", { n: same.length })] : [])] });
    }
    // a provider's settlement: several payments of the same day and provider in one bank line
    if (!same.length && k.owner.side === "FIRINGI") {
      const groups = new Map<string, Pay[]>();
      for (const p of pays) if (p.provider || p.method !== "BANK_TRANSFER") {
        const key = `${p.provider ?? p.method}|${p.paidAt?.toISOString().slice(0, 10)}`;
        groups.set(key, [...(groups.get(key) ?? []), p]);
      }
      for (const [key, g] of groups) if (g.length > 1 && eq(round2(g.reduce((a, p) => a + p.left, 0)), A))
        out.push({ kind: "PAYMENT", items: g.map((p) => ({ id: p.id, amount: p.left, label: [p.company, p.docs.join(", ") || p.reference].filter(Boolean).join(" · ") })), confidence: 86, reasons: [w("settlement", { n: g.length, provider: key.split("|")[0], date: key.split("|")[1] })] });
    }
  }

  // 2. FIRINGI: a customer's transfer (new payment) / a supplier transfer (new payout)
  if (k.owner.side === "FIRINGI") {
    const byIban = iban ? k.links.get(iban) : undefined;
    const vat = k.companies.find((c) => (c.vatNumber && remit.includes(norm(c.vatNumber))) || (c.taxId.length >= 8 && remit.includes(` ${c.taxId} `)));
    const named = k.companies.filter((c) => namesCompany(c, line.counterparty, text));
    if (inbound) {
      const refs = k.invoices.filter((i) => i.keys.some((key) => remit.includes(` ${key} `) || text.includes(` ${key} `)));
      // a pay-before-shipping order named in the transfer (or the exact amount of the payer's waiting order)
      const orders = k.orders.filter((o) => o.keys.some((key) => text.includes(` ${key} `)) || ((byIban === o.companyId || named.some((n) => n.id === o.companyId)) && eq(o.total, A)));
      for (const o of orders) if (A >= o.total - tolerance(k, o.total))
        out.push({ kind: "CUSTOMER_PAYMENT", companyId: o.companyId, companyName: nameOf(o.companyId), items: [], orderId: o.id, orderNumber: o.number, credit: A, confidence: o.keys.some((key) => text.includes(` ${key} `)) ? 95 : 85, reasons: [w("order", { number: o.number })] });
      if (refs.length) {
        const byCo = new Map<string, Inv[]>();
        for (const r of refs) byCo.set(r.companyId, [...(byCo.get(r.companyId) ?? []), r]);
        const [cid, docs] = [...byCo].sort((a, b) => b[1].length - a[1].length)[0];
        const sure = byIban === cid || named.some((n) => n.id === cid);
        const total = round2(docs.reduce((a, d) => a + d.open, 0));
        const why = w("invoicesNamed", { docs: docs.map((d) => d.number).join(", ") });
        let p: Omit<Proposal, "kind" | "companyId">;
        if (eq(total, A)) p = { items: docs.map((d) => ({ id: d.id, amount: d.open, label: d.number })), confidence: sure ? 99 : 96, reasons: [why, w("amountMatches")] };
        else if (A > total) p = { items: docs.map((d) => ({ id: d.id, amount: d.open, label: d.number })), credit: round2(A - total), confidence: sure ? 90 : 86, reasons: [why, w("moreThanOpen", { amount: round2(A - total).toFixed(2) })] };
        else {
          const gap = round2(total - A);
          p = gap <= tolerance(k, total)
            ? { items: docs.map((d) => ({ id: d.id, amount: d.open, label: d.number })), rest: { amount: -gap, kind: "FEE" }, confidence: sure ? 94 : 90, reasons: [why, w("shortFee", { amount: gap.toFixed(2) })] }
            : { ...spread(docs, A), confidence: sure ? 86 : 82, reasons: [why, w("partPayment")] };
          if ("left" in p) delete (p as { left?: number }).left;
        }
        out.push({ kind: "CUSTOMER_PAYMENT", companyId: cid, companyName: nameOf(cid), ...p });
      }
      const who = [...new Set([byIban, vat?.id, ...named.map((n) => n.id)].filter((x): x is string => !!x))];
      for (const cid of who) {
        const docs = k.invoices.filter((i) => i.companyId === cid);
        const base = byIban === cid ? 92 : vat?.id === cid ? 88 : 82;
        const why = w(byIban === cid ? "ibanKnown" : vat?.id === cid ? "vatInText" : "nameMatches");
        const p = payDocs(k, docs, A, base, why) ?? { items: [], credit: A, confidence: base - 35, reasons: [why, w("allCredit")] };
        out.push({ kind: "CUSTOMER_PAYMENT", companyId: cid, companyName: nameOf(cid), ...p });
      }
      if (!who.length && !refs.length) {
        const only = k.invoices.filter((i) => eq(i.open, A));
        if (only.length === 1) out.push({ kind: "CUSTOMER_PAYMENT", companyId: only[0].companyId, companyName: nameOf(only[0].companyId), items: [{ id: only[0].id, amount: A, label: only[0].number }], confidence: 55, reasons: [w("onlyAmount", { doc: only[0].number })] });
      }
    } else {
      const refs = k.vendorInvoices.filter((v) => v.keys.some((key) => remit.includes(` ${key} `)));
      const who = [...new Set([iban ? k.links.get(iban) : null, ...refs.map((r) => r.companyId), ...named.map((n) => n.id)].filter((x): x is string => !!x))];
      for (const cid of who) {
        const mine = refs.filter((r) => r.companyId === cid);
        const docs = mine.length ? mine : k.vendorInvoices.filter((v) => v.companyId === cid);
        const why = mine.length ? w("vendorNamed", { docs: mine.map((d) => d.number).join(", ") }) : w(iban && k.links.get(iban) === cid ? "ibanKnown" : "nameMatches");
        const p = payDocs(k, docs, A, mine.length ? 92 : 84, why);
        if (p && !p.credit) out.push({ kind: "VENDOR_PAYOUT", companyId: cid, companyName: nameOf(cid), ...p });
      }
    }
  }

  // 3. own books: FIRINGI invoices (customers) and accounting entries
  if (k.owner.side !== "FIRINGI") {
    if (k.owner.side === "BUYER" && !inbound) {
      const refs = k.invoices.filter((i) => i.keys.some((key) => remit.includes(` ${key} `)));
      if (refs.length) {
        const p = payDocs(k, refs, A, 90, w("firingiNamed", { docs: refs.map((r) => r.number).join(", ") }));
        if (p && !p.credit) out.push({ kind: "FIRINGI_INVOICE", ...p });
      } else if (/FIRINGI/.test(text)) {
        const p = payDocs(k, k.invoices, A, 80, w("toFiringi"));
        if (p && !p.credit) out.push({ kind: "FIRINGI_INVOICE", ...p });
      }
    }
    for (const e of k.entries) {
      if ((e.kind === "SALE") !== inbound || !eq(e.amount, A) || !within(date, e.date, W)) continue;
      const named = e.payee ? namesCompany({ legalName: e.payee }, line.counterparty, text) : false;
      out.push({ kind: "ENTRY", items: [{ id: e.id, amount: A, label: `${e.payee ?? e.description ?? e.kind} ${e.date.toISOString().slice(0, 10)}` }], confidence: named ? 90 : 76, reasons: [w(named ? "entryPayee" : "entryAmount")] });
    }
  }

  // 4. rules
  const best = Math.max(0, ...out.map((p) => p.confidence));
  const rule = best < 90 ? ruleFor(k, line, text) : null;
  if (rule) out.push(rule);
  return out.sort((a, b) => b.confidence - a.confidence);
}

// ── running it ──────────────────────────────────────────────────────────────

/** Suggest (and, where allowed, book) matches for lines that are waiting. */
export async function matchLines(owner: Owner, lineIds?: string[]) {
  const lines = await prisma.bankLine.findMany({ where: { account: { ownerKey: owner.key }, status: { in: ["OPEN", "SUGGESTED"] }, ...(lineIds ? { id: { in: lineIds } } : {}) }, include: { account: { select: { autoBook: true } } }, orderBy: { bookingDate: "asc" } });
  if (!lines.length) return { booked: 0, suggested: 0 };
  let k = await know(owner);
  let booked = 0, suggested = 0;
  for (const line of lines) {
    const props = proposalsFor(k, line);
    const [best, second] = props;
    const clear = best && (!second || best.confidence - second.confidence >= 10 || sameTarget(best, second));
    // a rule is the owner's own standing instruction: it books at once (when nothing better fits)
    const auto = best && clear && (best.ruleId ? true : owner.side === "FIRINGI"
      ? k.settings.firingiMode === "AUTO" && best.confidence >= k.settings.autoConfidence
      : k.settings.companiesMayAuto && line.account.autoBook && best.confidence >= k.settings.companyAutoConfidence);
    if (auto) {
      try {
        await applyMatch(owner, line.id, best, { userId: null, auto: true });
        booked++;
        k = await know(owner); // what's open changed
        continue;
      } catch { /* fall back to a suggestion */ }
    }
    const status = best && best.confidence >= 50 ? "SUGGESTED" : "OPEN";
    if (status === "SUGGESTED") suggested++;
    await prisma.bankLine.update({ where: { id: line.id }, data: { status, suggestion: best ? (best as unknown as Prisma.InputJsonValue) : undefined, confidence: best?.confidence ?? null } });
  }
  return { booked, suggested };
}
const sameTarget = (a: Proposal, b: Proposal) => a.kind === b.kind && a.companyId === b.companyId && a.items.map((i) => i.id).join() === b.items.map((i) => i.id).join();

/** All proposals for one line (the match panel shows them). */
export async function lineProposals(ctx: Ctx, lineId: string) {
  const owner = ownerOf(ctx);
  const line = await prisma.bankLine.findFirst({ where: { id: lineId, account: { ownerKey: owner.key } } });
  if (!line) throw new NotFoundError("Bank line");
  return proposalsFor(await know(owner), line).slice(0, 5);
}

/** What can be picked by hand for a line: open documents / payments / entries of a party. */
export async function matchOptions(ctx: Ctx, lineId: string, f: { kind: BankMatchKind; companyId?: string | null; q?: string | null }) {
  const owner = ownerOf(ctx);
  const line = await prisma.bankLine.findFirst({ where: { id: lineId, account: { ownerKey: owner.key } } });
  if (!line) throw new NotFoundError("Bank line");
  const k = await know(owner);
  const q = norm(f.q ?? "");
  const match = (s: string) => q.trim() === "" || norm(s).includes(q.trim());
  const L = Number(line.amount);
  switch (f.kind) {
    case "CUSTOMER_PAYMENT": return k.invoices.filter((i) => (!f.companyId || i.companyId === f.companyId) && match(`${i.number} ${k.companies.find((c) => c.id === i.companyId)?.legalName}`)).slice(0, 60).map((i) => ({ id: i.id, label: i.number, sub: k.companies.find((c) => c.id === i.companyId)?.legalName ?? "", open: i.open, companyId: i.companyId, date: i.dueAt }));
    case "VENDOR_PAYOUT": return k.vendorInvoices.filter((v) => (!f.companyId || v.companyId === f.companyId) && match(`${v.number} ${k.companies.find((c) => c.id === v.companyId)?.legalName}`)).slice(0, 60).map((v) => ({ id: v.id, label: v.number, sub: k.companies.find((c) => c.id === v.companyId)?.legalName ?? "", open: v.open, companyId: v.companyId, date: v.issueDate }));
    case "PAYMENT": return k.payments.filter((p) => (L > 0 ? (owner.side === "FIRINGI" ? p.direction === "INBOUND" : p.direction === "OUTBOUND") : (owner.side === "FIRINGI" ? p.direction === "OUTBOUND" : p.direction === "INBOUND")) && (!f.companyId || p.companyId === f.companyId) && match(`${p.company} ${p.reference ?? ""} ${p.method}`)).slice(0, 60).map((p) => ({ id: p.id, label: [p.company, p.docs.join(", ") || p.reference].filter(Boolean).join(" · "), sub: p.paidAt?.toISOString().slice(0, 10) ?? "", open: p.left, companyId: p.companyId, date: p.paidAt }));
    case "FIRINGI_INVOICE": return k.invoices.filter((i) => match(i.number)).slice(0, 60).map((i) => ({ id: i.id, label: i.number, sub: i.dueAt?.toISOString().slice(0, 10) ?? "", open: i.open, companyId: null, date: i.dueAt }));
    case "ENTRY": return k.entries.filter((e) => (e.kind === "SALE") === L > 0 && match(`${e.payee ?? ""} ${e.description ?? ""}`)).slice(0, 60).map((e) => ({ id: e.id, label: e.payee ?? e.description ?? e.kind, sub: e.date.toISOString().slice(0, 10), open: e.amount, companyId: null, date: e.date }));
    default: return [];
  }
}

/** Companies to pick from (FIRINGI's match panel). */
export async function matchCompanies(ctx: Ctx, q: string) {
  ownerOf(ctx);
  if (ctx.company.type !== "ADMIN") return [];
  const s = q.trim();
  if (s.length < 2) return [];
  return prisma.company.findMany({ where: { type: { not: "ADMIN" }, OR: [{ legalName: { contains: s, mode: "insensitive" } }, { tradeName: { contains: s, mode: "insensitive" } }, { taxId: { contains: s } }, { vatNumber: { contains: s, mode: "insensitive" } }] }, select: { id: true, legalName: true, type: true }, take: 15 });
}

// ── booking ─────────────────────────────────────────────────────────────────

type Actor = { userId: string | null; auto?: boolean };

/** Book a line as the proposal says (checked again inside a transaction). */
export async function applyMatch(owner: Owner, lineId: string, p: Proposal, actor: Actor) {
  const notices: (() => Promise<unknown>)[] = [];
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "BankLine" WHERE id = ${lineId} FOR UPDATE`;
    const line = await tx.bankLine.findFirst({ where: { id: lineId, account: { ownerKey: owner.key } } });
    if (!line) throw new NotFoundError("Bank line");
    if (line.status === "MATCHED") throw new AppError("ALREADY_MATCHED", "This line is already matched.", 409);
    const L = Number(line.amount);
    const sign = L < 0 ? -1 : 1;
    const items = (p.items ?? []).map((i) => ({ ...i, amount: round2(Math.abs(Number(i.amount))) })).filter((i) => i.amount > 0.004);
    const itemSum = round2(items.reduce((a, i) => a + i.amount, 0));
    const credit = round2(Math.max(0, Number(p.credit ?? 0)));
    const rest = p.rest && Math.abs(Number(p.rest.amount)) > 0.004 ? { ...p.rest, amount: round2(Number(p.rest.amount)) } : null;
    const main = p.kind === "FEE" || p.kind === "OTHER" ? round2(L - (rest?.amount ?? 0)) : round2(sign * (itemSum + credit));
    if (!eq(round2(main + (rest?.amount ?? 0)), L)) throw new ValidationError(`The parts (${round2(main + (rest?.amount ?? 0)).toFixed(2)}) don't add up to the line (${L.toFixed(2)}).`);
    const base = { lineId, createdById: actor.userId, companyId: p.companyId ?? null };
    const when = line.bookingDate;
    const ref = (line.endToEndId ?? line.remittance ?? line.bankRef ?? "").slice(0, 120) || null;
    let learnCompany: string | null = null;

    switch (p.kind) {
      case "CUSTOMER_PAYMENT": {
        if (owner.side !== "FIRINGI" || L <= 0) throw new ValidationError("Only money in can be a customer payment.");
        const cid = p.companyId;
        if (!cid) throw new ValidationError("Choose the customer.");
        const { openAmounts, applyCustomerCredit, releasePaidOrder } = await import("@/server/payments/service");
        const open = await openAmounts(items.map((i) => i.id), tx);
        const invs = await tx.invoice.findMany({ where: { id: { in: items.map((i) => i.id) } }, select: { id: true, recipientCompanyId: true } });
        for (const i of items) {
          if (invs.find((x) => x.id === i.id)?.recipientCompanyId !== cid) throw new ValidationError("An invoice belongs to another customer.");
          if (i.amount > Number(open.get(i.id) ?? 0) + 0.004) throw new ValidationError(`More than what is open on ${i.label ?? "an invoice"} (${Number(open.get(i.id) ?? 0).toFixed(2)}).`);
        }
        const amount = round2(itemSum + credit);
        const pay = await tx.payment.create({ data: { companyId: cid, direction: "INBOUND", method: "BANK_TRANSFER", amount: amount.toFixed(2), reference: ref, status: "CONFIRMED", paidAt: when, recordedById: actor.userId, allocations: { create: items.map((i) => ({ invoiceId: i.id, amount: i.amount.toFixed(2) })) } } });
        if (p.orderId) {
          const o = await tx.order.findFirst({ where: { id: p.orderId, buyerCompanyId: cid } });
          if (!o) throw new NotFoundError("Order");
          await tx.paymentRequest.create({ data: { token: `bank-${pay.id}`, companyId: cid, orderId: o.id, amount: amount.toFixed(2), status: "PAID", source: "ORDER", method: "BANK_TRANSFER", expiresAt: when, paidAt: when, paidAmount: amount.toFixed(2), paymentId: pay.id, createdById: actor.userId } });
          const st = await bankSettings();
          const tol = Math.min(st.toleranceAmount, (st.tolerancePct / 100) * Number(o.grandTotal));
          if (D(amount).gte(D(o.grandTotal).minus(tol + 0.004))) await releasePaidOrder(tx, o.id);
        } else if (credit > 0.004) await applyCustomerCredit(tx, cid);
        await tx.bankMatch.create({ data: { ...base, kind: "CUSTOMER_PAYMENT", amount: amount.toFixed(2), paymentId: pay.id, createdPayment: true } });
        await (await import("@/server/integrations/webhooks")).emitWebhook(tx, cid, "payment.received", { paymentId: pay.id, amount: amount.toFixed(2), method: "BANK_TRANSFER", reference: ref, paidAt: when.toISOString(), documents: items.map((i) => i.id) });
        const docs = items.map((i) => i.label).filter(Boolean).join(", ");
        notices.push(async () => (await import("@/server/notify/dispatch")).notify("payment.received", [{ companyId: cid, link: p.orderId ? `/buy/orders/${p.orderId}` : "/buy/finance/payments" }], { total: `${amount.toFixed(2)} €`, documents: docs || p.orderNumber || "—" }, { ref: { type: "Payment", id: pay.id } }));
        learnCompany = cid;
        break;
      }
      case "VENDOR_PAYOUT": {
        if (owner.side !== "FIRINGI" || L >= 0) throw new ValidationError("Only money out can be a supplier payout.");
        const cid = p.companyId;
        if (!cid) throw new ValidationError("Choose the supplier.");
        const { openVendorInvoices, markVendorInvoicesPaid } = await import("@/server/plans/service");
        const open = await openVendorInvoices(tx, cid);
        for (const i of items) {
          const o = open.find((x) => x.id === i.id);
          if (!o) throw new ValidationError("Only this supplier's approved, unpaid invoices can be paid.");
          if (i.amount > o.open.toNumber() + 0.004) throw new ValidationError(`More than what is open on ${o.number}.`);
        }
        const pay = await tx.payment.create({ data: { companyId: cid, direction: "OUTBOUND", method: "BANK_TRANSFER", amount: itemSum.toFixed(2), reference: ref, status: "CONFIRMED", paidAt: when, recordedById: actor.userId, allocations: { create: items.map((i) => ({ vendorInvoiceId: i.id, amount: i.amount.toFixed(2) })) } } });
        await markVendorInvoicesPaid(tx, items.map((i) => i.id));
        await tx.bankMatch.create({ data: { ...base, kind: "VENDOR_PAYOUT", amount: (-itemSum).toFixed(2), paymentId: pay.id, createdPayment: true } });
        await (await import("@/server/integrations/webhooks")).emitWebhook(tx, cid, "payout.sent", { paymentId: pay.id, amount: itemSum.toFixed(2), method: "BANK_TRANSFER", reference: ref, paidAt: when.toISOString(), documents: items.map((i) => i.id) });
        learnCompany = cid;
        break;
      }
      case "PAYMENT": {
        const pays = await tx.payment.findMany({ where: { id: { in: items.map((i) => i.id) } }, include: { bankMatches: { where: { line: { account: { ownerKey: owner.key } } }, select: { amount: true } } } });
        const wantDir = owner.side === "FIRINGI" ? (L > 0 ? "INBOUND" : "OUTBOUND") : owner.side === "VENDOR" ? "OUTBOUND" : "INBOUND";
        for (const i of items) {
          const pay = pays.find((x) => x.id === i.id);
          if (!pay || pay.direction !== wantDir || (owner.companyId && pay.companyId !== owner.companyId)) throw new ValidationError("That payment can't be matched to this line.");
          const left = Number(pay.amount) - pay.bankMatches.reduce((a, m) => a + Math.abs(Number(m.amount)), 0);
          if (i.amount > left + 0.004) throw new ValidationError("More than what is left of that payment.");
          await tx.bankMatch.create({ data: { ...base, kind: "PAYMENT", amount: (sign * i.amount).toFixed(2), paymentId: pay.id, companyId: pay.companyId } });
        }
        if (pays.length === 1 && owner.side === "FIRINGI") learnCompany = pays[0].companyId;
        break;
      }
      case "FIRINGI_INVOICE": {
        if (owner.side !== "BUYER" || L >= 0) throw new ValidationError("Only a customer's payment out can be matched to FIRINGI invoices.");
        const invs = await tx.invoice.findMany({ where: { id: { in: items.map((i) => i.id) }, recipientCompanyId: owner.companyId! }, select: { id: true } });
        if (invs.length !== items.length) throw new NotFoundError("Invoice");
        for (const i of items) await tx.bankMatch.create({ data: { ...base, kind: "FIRINGI_INVOICE", amount: (-i.amount).toFixed(2), invoiceId: i.id, label: i.label ?? null } });
        break;
      }
      case "ENTRY": {
        if (owner.side === "FIRINGI") throw new ValidationError("FIRINGI has no accounting entries here.");
        const entries = await tx.accountingEntry.findMany({ where: { id: { in: items.map((i) => i.id) }, companyId: owner.companyId! }, select: { id: true } });
        if (entries.length !== items.length) throw new NotFoundError("Entry");
        for (const i of items) await tx.bankMatch.create({ data: { ...base, kind: "ENTRY", amount: (sign * i.amount).toFixed(2), accountingEntryId: i.id, label: i.label ?? null } });
        break;
      }
      case "FEE":
      case "OTHER":
        await tx.bankMatch.create({ data: { ...base, kind: p.kind, amount: main.toFixed(2), category: p.category ?? (p.kind === "FEE" ? "BANK_FEES" : "OTHER"), label: p.label?.slice(0, 120) ?? null } });
        break;
    }
    if (rest) await tx.bankMatch.create({ data: { ...base, companyId: null, kind: rest.kind, amount: rest.amount.toFixed(2), category: rest.category ?? (rest.kind === "FEE" ? "BANK_FEES" : "OTHER"), label: rest.kind === "FEE" ? "Difference (bank charges)" : null } });
    await tx.bankLine.update({ where: { id: line.id }, data: { status: "MATCHED", matchedById: actor.userId, matchedAt: new Date(), autoMatched: !!actor.auto, confidence: p.confidence ?? line.confidence } });
    // remember who this IBAN is
    if (learnCompany && line.counterpartyIban) await tx.bankPayerLink.upsert({ where: { ownerKey_iban: { ownerKey: owner.key, iban: line.counterpartyIban } }, create: { ownerKey: owner.key, iban: line.counterpartyIban, companyId: learnCompany, label: line.counterparty }, update: { companyId: learnCompany } });
    await writeAudit({ actorUserId: actor.userId, actorCompanyId: owner.companyId, action: actor.auto ? "bank.line_auto_matched" : "bank.line_matched", entityType: "BankLine", entityId: line.id, after: { kind: p.kind, company: p.companyId ?? null, items: items.map((i) => `${i.label ?? i.id}:${i.amount}`), credit, rest: rest?.amount ?? null, confidence: p.confidence } }, tx);
    return { lineId: line.id };
  });
  for (const n of notices) await n().catch(() => null);
  if (p.ruleId) await prisma.bankRule.updateMany({ where: { id: p.ruleId, ownerKey: owner.key }, data: { hits: { increment: 1 } } }).catch(() => null);
  return result;
}

export async function confirmMatch(ctx: Ctx, lineId: string, p: Proposal) {
  const owner = ownerOf(ctx, true);
  if (owner.side !== "FIRINGI" && (p.kind === "CUSTOMER_PAYMENT" || p.kind === "VENDOR_PAYOUT")) throw new ValidationError("Not available here.");
  if (owner.side === "FIRINGI" && (p.kind === "FIRINGI_INVOICE" || p.kind === "ENTRY")) throw new ValidationError("Not available here.");
  return applyMatch(owner, lineId, p, { userId: ctx.user.id });
}

/** Undo a match: payments it created are removed (their invoices open again). */
export async function unmatch(ctx: Ctx, lineId: string) {
  const owner = ownerOf(ctx, true);
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "BankLine" WHERE id = ${lineId} FOR UPDATE`;
    const line = await tx.bankLine.findFirst({ where: { id: lineId, account: { ownerKey: owner.key } }, include: { matches: { include: { payment: { include: { allocations: true, request: true } } } } } });
    if (!line) throw new NotFoundError("Bank line");
    if (line.status !== "MATCHED" && line.status !== "IGNORED") throw new ValidationError("This line isn't matched.");
    for (const m of line.matches) {
      const pay = m.payment;
      if (!m.createdPayment || !pay) continue;
      if (Number(pay.refundedAmount) > 0) throw new ValidationError("Part of this payment was refunded — it can't be undone here.");
      if (pay.request?.orderId) {
        const o = await tx.order.findUnique({ where: { id: pay.request.orderId }, select: { status: true } });
        if (o && o.status !== "ON_HOLD" && o.status !== "PENDING_CONFIRMATION") throw new ValidationError("The order paid by this transfer is already on its way — it can't be undone.");
        if (o?.status === "PENDING_CONFIRMATION") await tx.order.update({ where: { id: pay.request.orderId }, data: { awaitingPayment: true, status: "ON_HOLD" } });
        await tx.paymentRequest.delete({ where: { id: pay.request.id } });
      }
      const vendorInvoices = pay.allocations.map((a) => a.vendorInvoiceId).filter((x): x is string => !!x);
      await tx.payment.delete({ where: { id: pay.id } });
      if (vendorInvoices.length) await tx.vendorInvoice.updateMany({ where: { id: { in: vendorInvoices }, status: "PAID" }, data: { status: "APPROVED" } });
    }
    await tx.bankMatch.deleteMany({ where: { lineId: line.id } });
    await tx.bankLine.update({ where: { id: line.id }, data: { status: "OPEN", matchedById: null, matchedAt: null, autoMatched: false, note: null } });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "bank.line_unmatched", entityType: "BankLine", entityId: line.id, before: { matches: line.matches.map((m) => ({ kind: m.kind, amount: m.amount.toString(), paymentId: m.paymentId })) } }, tx);
  });
  await matchLines(owner, [lineId]);
}

export async function ignoreLine(ctx: Ctx, lineId: string, note: string | null) {
  const owner = ownerOf(ctx, true);
  const line = await prisma.bankLine.findFirst({ where: { id: lineId, account: { ownerKey: owner.key } } });
  if (!line) throw new NotFoundError("Bank line");
  if (line.status === "MATCHED") throw new ValidationError("Undo the match first.");
  await prisma.bankLine.update({ where: { id: line.id }, data: { status: "IGNORED", note: note?.trim().slice(0, 300) || null, matchedById: ctx.user.id, matchedAt: new Date() } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "bank.line_ignored", entityType: "BankLine", entityId: line.id, after: { note } });
}

/** Re-run suggestions for everything waiting (after new invoices / payments). */
export async function rematchAll(ctx: Ctx) {
  const owner = ownerOf(ctx, true);
  return matchLines(owner);
}

export type { Tx };
