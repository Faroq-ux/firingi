/**
 * CSV / Excel bank exports: every bank has its own columns, so a mapping (saved per bank account)
 * says which column is what. `guessMapping` fills it in from the headers in the usual languages.
 */
import { cleanIban, parseAmount, parseDate, StatementError, type ParsedLine } from "./common";

export type CsvMapping = {
  /** 1-based row holding the column names (banks often put a few lines of account info above). */
  headerRow: number;
  date: string;
  valueDate?: string | null;
  /** one signed amount column … */
  amount?: string | null;
  /** … or money out / money in in two columns */
  debit?: string | null;
  credit?: string | null;
  counterparty?: string | null;
  iban?: string | null;
  /** remittance / description — several columns are joined */
  remittance?: string[];
  reference?: string | null;
  dateOrder: "DMY" | "MDY" | "YMD";
  decimal: "," | ".";
  /** some banks show money out as a positive number in the amount column with a D/C column */
  sign?: string | null;
};

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const WORDS = {
  date: ["data movimento", "data mov", "data lancamento", "booking date", "transaction date", "buchungstag", "buchungsdatum", "boekdatum", "fecha operacion", "fecha", "date", "data", "datum", "bokforingsdag", "dato", "kirjauspaiva", "date operation", "data operazione", "data contabile"],
  valueDate: ["data valor", "value date", "valuta", "wertstellung", "fecha valor", "valutadatum", "date valeur", "data valuta", "rentedato"],
  amount: ["montante", "amount", "betrag", "bedrag", "importe", "belopp", "belob", "beloep", "maara", "montant", "importo", "kwota", "castka", "osszeg", "valor"],
  debit: ["debito", "debit", "soll", "af", "cargo", "uttag", "debet", "addebiti", "addebito", "wyplata"],
  credit: ["credito", "credit", "haben", "bij", "abono", "insattning", "kredit", "accrediti", "accredito", "wplata"],
  counterparty: ["beneficiario", "ordenante", "contraparte", "counterparty", "name", "nome", "payee", "payer", "auftraggeber empfanger", "empfanger", "auftraggeber", "naam tegenrekening", "tegenpartij", "naam", "beneficiaire", "nombre", "mottagare", "modtager", "nimi"],
  iban: ["iban contraparte", "counterparty iban", "iban", "tegenrekening", "kontonummer", "conto"],
  remittance: ["descricao", "description", "descriptivo", "verwendungszweck", "omschrijving", "mededelingen", "concepto", "libelle", "causale", "text", "meddelande", "tekst", "details", "narrative", "memo", "referencia descritiva"],
  reference: ["referencia", "reference", "ref", "kundenreferenz", "referentie", "referencia operacion"],
  sign: ["d c", "debit credit", "soll haben", "af bij", "tipo"],
};

/** Best guess from the headers (empty fields when nothing fits). */
export function guessMapping(rows: string[][]): CsvMapping {
  // the header row is the first one (of the top 15) that names a date and an amount-ish column
  let headerRow = 1;
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const h = rows[i].map(norm);
    const hasDate = h.some((c) => WORDS.date.some((w) => c === w || c.includes(w)));
    const hasAmt = h.some((c) => [...WORDS.amount, ...WORDS.debit, ...WORDS.credit].some((w) => c === w || c.split(" ").includes(w)));
    if (hasDate && hasAmt) { headerRow = i + 1; break; }
  }
  const headers = rows[headerRow - 1] ?? [];
  const used = new Set<string>();
  const find = (words: string[], exact = false) => {
    for (const w of words) for (const h of headers) {
      const n = norm(h);
      if (!used.has(h) && (n === w || (!exact && (n.startsWith(w + " ") || n.endsWith(" " + w) || n.includes(w))))) { used.add(h); return h; }
    }
    return null;
  };
  const valueDate = find(WORDS.valueDate);
  const date = find(WORDS.date) ?? headers[0] ?? "";
  const debit = find(WORDS.debit, true);
  const credit = find(WORDS.credit, true);
  const amount = debit && credit ? null : find(WORDS.amount);
  const iban = find(WORDS.iban);
  const counterparty = find(WORDS.counterparty);
  const reference = find(WORDS.reference);
  const remittance: string[] = [];
  for (let r = find(WORDS.remittance); r; r = find(WORDS.remittance)) remittance.push(r);
  const sign = find(WORDS.sign, true);
  // number style and date order from the data below the header
  const body = rows.slice(headerRow, headerRow + 30);
  const col = (name: string | null) => (name ? headers.indexOf(name) : -1);
  const samples = [amount, debit, credit].map(col).filter((i) => i >= 0).flatMap((i) => body.map((r) => r[i] ?? "")).filter(Boolean);
  const commaDec = samples.filter((s) => /,\d{2}\b/.test(s)).length, dotDec = samples.filter((s) => /\.\d{2}\b/.test(s)).length;
  const dates = body.map((r) => r[col(date)] ?? "").filter(Boolean);
  const dateOrder = dates.some((d) => /^\d{4}/.test(d)) ? "YMD" : dates.some((d) => { const m = d.match(/^(\d{1,2})[./-](\d{1,2})/); return m && +m[2] > 12; }) ? "MDY" : "DMY";
  return { headerRow, date, valueDate, amount, debit, credit, counterparty, iban, remittance, reference, dateOrder, decimal: commaDec >= dotDec && commaDec > 0 ? "," : dotDec > 0 ? "." : ",", sign };
}

/** Lines from the rows with a mapping. Rows that don't hold a date and an amount (totals, notes) are skipped. */
export function linesFromRows(rows: string[][], m: CsvMapping): { lines: ParsedLine[]; skipped: number } {
  const headers = rows[m.headerRow - 1];
  if (!headers) throw new StatementError("NO_HEADER", "The header row isn't in the file.");
  const idx = (name?: string | null) => (name ? headers.findIndex((h) => h.trim() === name.trim()) : -1);
  const iDate = idx(m.date);
  if (iDate < 0) throw new StatementError("NO_DATE", `The date column "${m.date}" isn't in the file.`);
  const iAmt = idx(m.amount), iDeb = idx(m.debit), iCred = idx(m.credit);
  if (iAmt < 0 && iDeb < 0 && iCred < 0) throw new StatementError("NO_AMOUNT", "Choose the amount column (or the money out / money in columns).");
  const iVal = idx(m.valueDate), iName = idx(m.counterparty), iIban = idx(m.iban), iRef = idx(m.reference), iSign = idx(m.sign);
  const iRem = (m.remittance ?? []).map(idx).filter((i) => i >= 0);
  const lines: ParsedLine[] = [];
  let skipped = 0;
  for (const r of rows.slice(m.headerRow)) {
    const date = parseDate(r[iDate], m.dateOrder);
    let amount: number | null = null;
    if (iAmt >= 0) {
      amount = parseAmount(r[iAmt], m.decimal);
      if (amount != null && iSign >= 0) {
        const s = norm(r[iSign] ?? "");
        if (/^(d|debit|debito|soll|af|s|db)$/.test(s)) amount = -Math.abs(amount);
        else if (/^(c|credit|credito|haben|bij|h|cr)$/.test(s)) amount = Math.abs(amount);
      }
    } else {
      const d = iDeb >= 0 ? parseAmount(r[iDeb], m.decimal) : null;
      const c = iCred >= 0 ? parseAmount(r[iCred], m.decimal) : null;
      if (d || c) amount = (c ? Math.abs(c) : 0) - (d ? Math.abs(d) : 0);
    }
    if (!date || amount == null || amount === 0) { skipped++; continue; }
    const remittance = iRem.map((i) => (r[i] ?? "").trim()).filter(Boolean).join(" ");
    lines.push({
      bookingDate: date, valueDate: iVal >= 0 ? parseDate(r[iVal], m.dateOrder) : null, amount,
      counterparty: iName >= 0 ? (r[iName] ?? "").trim() || null : null,
      counterpartyIban: iIban >= 0 ? cleanIban(r[iIban]) || null : null,
      remittance: remittance || null,
      // a bank "reference" column isn't always unique, so it identifies the line together with the rest (not alone)
      endToEndId: iRef >= 0 ? (r[iRef] ?? "").trim() || null : null,
    });
  }
  return { lines, skipped };
}
