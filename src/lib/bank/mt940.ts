/** SWIFT MT940 statements (also the German / Dutch / Nordic variants of the :86: field). */
import { cleanIban, isIban, parseAmount, round2, StatementError, yymmdd, type ParsedLine, type ParsedStatement } from "./common";

/** Split "{4:\n:20:…\n:61:…\n-}" into [tag, value] pairs; continuation lines belong to the tag above. */
function fields(block: string): [string, string][] {
  const out: [string, string][] = [];
  for (const raw of block.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, "");
    const m = line.match(/^:(\d{2}[A-Z]?):(.*)$/);
    if (m) out.push([m[1], m[2]]);
    else if (out.length && line !== "-" && !/^-?\}/.test(line) && !/^\{\d:/.test(line)) out[out.length - 1][1] += "\n" + line;
  }
  return out;
}

/** :60F:/:62F: "C261116EUR1234,56" */
function bal(v: string) {
  const m = v.replace(/\n/g, "").match(/^([CD])(\d{6})([A-Z]{3})([\d,.]+)/);
  if (!m) return null;
  const n = parseAmount(m[4], ",") ?? 0;
  return { amount: m[1] === "D" ? -n : n, date: yymmdd(m[2]), currency: m[3] };
}

/** :86: — structured (?20…?29 remittance, ?32/?33 name, ?31 IBAN; or /NAME/…/REMI/…/IBAN/) or free text. */
function info(v: string) {
  const s = v.replace(/\n/g, "");
  if (/\?\d{2}/.test(s)) {
    const parts = new Map<string, string>();
    for (const m of s.matchAll(/\?(\d{2})([^?]*)/g)) parts.set(m[1], (parts.get(m[1]) ?? "") + m[2]);
    const remit = ["20", "21", "22", "23", "24", "25", "26", "27", "28", "29", "60", "61", "62", "63"].map((k) => parts.get(k) ?? "").join("").replace(/^(EREF|SVWZ|KREF|MREF)\+/g, "").trim();
    return { name: ((parts.get("32") ?? "") + (parts.get("33") ?? "")).trim() || null, iban: parts.get("31")?.trim() || null, remittance: remit.replace(/(EREF|SVWZ|KREF|MREF|ABWA|ABWE)\+/g, " ").replace(/\s+/g, " ").trim() || null };
  }
  if (/\/(NAME|REMI|IBAN|ORDP|BENM)\//.test(s)) {
    const get = (k: string) => s.match(new RegExp(`/${k}/(.*?)(?=/[A-Z]{4}/|$)`))?.[1]?.trim() || null;
    const ordp = get("ORDP") ?? get("BENM");
    return { name: get("NAME") ?? (ordp ? ordp.replace(/\/.*/, "").trim() : null), iban: get("IBAN") ?? get("ACCW"), remittance: get("REMI")?.replace(/^\/?USTD\/\/?/, "") ?? null };
  }
  // free text: an IBAN anywhere in it is the counterparty's
  const ib = s.match(/\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/)?.[0] ?? null;
  return { name: null, iban: ib && isIban(ib) ? ib : null, remittance: s.trim() || null };
}

export function parseMt940(text: string): ParsedStatement[] {
  const src = text.replace(/^\uFEFF/, "");
  // Statements start at :20:
  const blocks = src.split(/(?=^:20:)/m).filter((b) => /^:20:/m.test(b));
  if (!blocks.length) throw new StatementError("BAD_FILE", "No MT940 statement found (no :20: field).");
  return blocks.map((b) => {
    const f = fields(b);
    const get = (t: string) => f.find(([k]) => k === t)?.[1];
    const acct = (get("25") ?? "").trim();
    const ibanPart = acct.split("/").map((p) => cleanIban(p)).find((p) => isIban(p)) ?? null;
    const opening = bal(get("60F") ?? get("60M") ?? "");
    const closing = bal(get("62F") ?? get("62M") ?? "");
    const lines: ParsedLine[] = [];
    for (let i = 0; i < f.length; i++) {
      if (f[i][0] !== "61") continue;
      const [first, ...rest] = f[i][1].split("\n");
      // YYMMDD [MMDD] (R)C|D [funds code] amount N|F|S + 3 type chars, customer ref [//bank ref]
      const m = first.match(/^(\d{6})(\d{4})?(R?[CD])([A-Z])?([\d,]+)([NSF][A-Z0-9]{3})([^/]*)(?:\/\/(.*))?$/);
      if (!m) continue;
      const value = yymmdd(m[1])!;
      let booking = value;
      if (m[2]) { // booking date MMDD in the value date's year (or the next year around New Year)
        const y = +m[1].slice(0, 2) + 2000;
        const mm = +m[2].slice(0, 2), vm = +m[1].slice(2, 4);
        const yr = mm === 1 && vm === 12 ? y + 1 : mm === 12 && vm === 1 ? y - 1 : y;
        booking = `${yr}-${m[2].slice(0, 2)}-${m[2].slice(2, 4)}`;
      }
      const amt = parseAmount(m[5], ",") ?? 0;
      const debit = m[3] === "D" || m[3] === "RC";
      const next = f[i + 1]?.[0] === "86" ? info(f[i + 1][1]) : { name: null, iban: null, remittance: null };
      const custRef = m[7].trim();
      const bankRef = (m[8] ?? "").trim() || null;
      const extra = rest.join(" ").trim();
      lines.push({
        bookingDate: booking, valueDate: value, amount: round2(debit ? -amt : amt), currency: opening?.currency ?? null,
        counterparty: next.name, counterpartyIban: next.iban ? cleanIban(next.iban) : null,
        remittance: [next.remittance, extra].filter(Boolean).join(" ") || null,
        endToEndId: custRef && custRef !== "NONREF" ? custRef : null,
        bankRef,
      });
    }
    return {
      format: "MT940" as const, iban: ibanPart, currency: opening?.currency ?? closing?.currency ?? null,
      bankStatementId: [get("20")?.trim(), get("28C")?.trim()].filter(Boolean).join(" / ") || null,
      fromDate: opening?.date ?? lines[0]?.bookingDate ?? null, toDate: closing?.date ?? lines.at(-1)?.bookingDate ?? null,
      openingBalance: opening?.amount ?? null, closingBalance: closing?.amount ?? null, lines,
    };
  });
}
