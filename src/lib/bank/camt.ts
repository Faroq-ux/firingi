/** ISO 20022 CAMT.053 (bank to customer statement) — versions 02 to 08 — and CAMT.052 reports. */
import { all, findAll, parseXml, pick, txt, type XNode } from "./xml";
import { cleanIban, parseDate, round2, StatementError, type ParsedLine, type ParsedStatement } from "./common";

const num = (s: string) => { const n = Number(s.trim()); return Number.isFinite(n) ? round2(n) : 0; };
const date = (n: XNode | undefined) => parseDate(txt(n, "Dt") || txt(n, "DtTm"));
const signed = (amt: string, ind: string) => (ind === "DBIT" ? -num(amt) : num(amt));
const partyName = (p: XNode | undefined) => txt(p, "Nm") || txt(p, "Pty/Nm") || "";
const joinU = (n: XNode | undefined) => (n ? findAll(n, "Ustrd").map((u) => u.text.trim()).filter(Boolean).join(" ") : "");

function balance(stmt: XNode, codes: string[]) {
  for (const b of all(stmt, "Bal")) {
    const code = txt(b, "Tp/CdOrPrtry/Cd") || txt(b, "Tp/CdOrPrtry/Prtry");
    if (codes.includes(code)) return { amount: signed(txt(b, "Amt"), txt(b, "CdtDbtInd")), date: date(pick(b, "Dt")) };
  }
  return null;
}

/** One statement per account in the file. */
export function parseCamt(xml: string): ParsedStatement[] {
  let root: XNode;
  try { root = parseXml(xml); } catch { throw new StatementError("BAD_FILE", "The file isn't valid XML."); }
  const stmts = [...findAll(root, "Stmt"), ...findAll(root, "Rpt")];
  if (!stmts.length) throw new StatementError("BAD_FILE", "No statement found in this CAMT file.");
  return stmts.map((s) => {
    const iban = cleanIban(txt(s, "Acct/Id/IBAN")) || null;
    const currency = txt(s, "Acct/Ccy") || null;
    const lines: ParsedLine[] = [];
    for (const e of all(s, "Ntry")) {
      if ((txt(e, "Sts") || txt(e, "Sts/Cd")) === "PDNG") continue; // pending: not booked yet
      const ind = txt(e, "CdtDbtInd");
      const sign = ind === "DBIT" ? -1 : 1; // the indicator is the effect on the balance (reversals included)
      const bookingDate = date(pick(e, "BookgDt")) ?? date(pick(e, "ValDt"));
      if (!bookingDate) continue;
      const valueDate = date(pick(e, "ValDt"));
      const entryRef = txt(e, "AcctSvcrRef") || null;
      const ccy = pick(e, "Amt")?.attrs.Ccy ?? currency;
      const txs = findAll(e, "TxDtls");
      const entryInfo = txt(e, "AddtlNtryInf");
      const one = (t: XNode | undefined, amount: number, ref: string | null): ParsedLine => {
        const parties = pick(t, "RltdPties");
        const cpty = sign > 0 ? pick(parties, "Dbtr") : pick(parties, "Cdtr");
        const cptyAcct = sign > 0 ? pick(parties, "DbtrAcct") : pick(parties, "CdtrAcct");
        const strdRef = t ? findAll(pick(t, "RmtInf"), "Ref").map((r) => r.text.trim()).filter(Boolean).join(" ") : "";
        const remit = [joinU(pick(t, "RmtInf")), strdRef, txt(t, "AddtlTxInf")].filter(Boolean).join(" ") || entryInfo;
        const e2e = txt(t, "Refs/EndToEndId");
        return {
          bookingDate, valueDate, amount, currency: ccy,
          counterparty: partyName(cpty) || null,
          counterpartyIban: cleanIban(txt(cptyAcct, "Id/IBAN")) || null,
          remittance: remit || null,
          endToEndId: e2e && e2e !== "NOTPROVIDED" ? e2e : null,
          bankRef: ref,
        };
      };
      const entryAmount = sign * num(txt(e, "Amt"));
      // A batch entry with several transactions that each carry an amount becomes one line per transaction.
      const txAmounts = txs.map((t) => txt(t, "AmtDtls/TxAmt/Amt") || txt(t, "Amt"));
      if (txs.length > 1 && txAmounts.every((a) => a !== "")) {
        txs.forEach((t, k) => {
          const ref = txt(t, "Refs/AcctSvcrRef") || (entryRef ? `${entryRef}/${k + 1}` : null);
          lines.push(one(t, sign * num(txAmounts[k]), ref));
        });
      } else lines.push(one(txs[0], entryAmount, entryRef || txt(txs[0], "Refs/AcctSvcrRef") || null));
    }
    const opening = balance(s, ["OPBD", "PRCD"]);
    const closing = balance(s, ["CLBD"]);
    const from = parseDate(txt(s, "FrToDt/FrDtTm") || txt(s, "FrToDt/FrDt")) ?? opening?.date ?? lines[0]?.bookingDate ?? null;
    const to = parseDate(txt(s, "FrToDt/ToDtTm") || txt(s, "FrToDt/ToDt")) ?? closing?.date ?? lines.at(-1)?.bookingDate ?? null;
    return {
      format: "CAMT053" as const, iban, currency, bankStatementId: txt(s, "Id") || txt(s, "ElctrncSeqNb") || null,
      fromDate: from, toDate: to, openingBalance: opening?.amount ?? null, closingBalance: closing?.amount ?? null, lines,
    };
  });
}
