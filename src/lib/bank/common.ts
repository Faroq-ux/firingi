/** Shared types and helpers for bank statement parsing (Phase 37). Pure — no server imports. */

export type ParsedLine = {
  bookingDate: string; // YYYY-MM-DD
  valueDate?: string | null;
  amount: number; // + in, − out
  currency?: string | null;
  counterparty?: string | null;
  counterpartyIban?: string | null;
  remittance?: string | null;
  endToEndId?: string | null;
  bankRef?: string | null;
};

export type ParsedStatement = {
  format: "CAMT053" | "MT940" | "CSV" | "XLSX" | "FEED";
  iban?: string | null;
  currency?: string | null;
  bankStatementId?: string | null;
  fromDate?: string | null;
  toDate?: string | null;
  openingBalance?: number | null;
  closingBalance?: number | null;
  lines: ParsedLine[];
};

export class StatementError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

export const cleanIban = (s: string | null | undefined) => (s ? s.replace(/[\s.-]/g, "").toUpperCase() : "");
export const isIban = (s: string) => /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(cleanIban(s));
export const round2 = (n: number) => Math.round(n * 100) / 100;

/** "1.234,56" · "1,234.56" · "-12,50" · "12,50-" · "(12.50)" · "€ 12" → number. `decimal` forces the separator. */
export function parseAmount(raw: string | number | null | undefined, decimal?: "," | "."): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? round2(raw) : null;
  let s = raw.trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/-\s*$/.test(s)) { neg = true; s = s.replace(/-\s*$/, ""); }
  if (/^\s*-/.test(s)) { neg = !neg; s = s.replace(/^\s*-/, ""); }
  if (/^\s*\+/.test(s)) s = s.replace(/^\s*\+/, "");
  s = s.replace(/[^\d.,]/g, "");
  if (!s) return null;
  let dec = decimal;
  if (!dec) {
    const lc = s.lastIndexOf(","), ld = s.lastIndexOf(".");
    if (lc >= 0 && ld >= 0) dec = lc > ld ? "," : ".";
    else if (lc < 0 && ld < 0) dec = ".";
    else {
      // one kind of separator: groups of exactly three digits are thousands ("1.234", "1,234,567"), anything else is the decimal mark
      const sep = lc >= 0 ? "," : ".";
      const thousandsOnly = new RegExp(`^\\d{1,3}(\\${sep}\\d{3})+$`).test(s);
      dec = thousandsOnly ? (sep === "," ? "." : ",") : sep;
    }
  }
  const thousands = dec === "," ? "." : ",";
  s = s.split(thousands).join("");
  if (dec === ",") s = s.replace(",", ".");
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return round2(neg ? -n : n);
}

/** Dates as banks write them → YYYY-MM-DD. `order` breaks DD/MM vs MM/DD ties (default day first). */
export function parseDate(raw: string | null | undefined, order: "DMY" | "MDY" | "YMD" = "DMY"): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{4})[./](\d{1,2})[./](\d{1,2})/);
  if (m) return ymd(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    const [d, mo] = order === "MDY" ? [+m[2], +m[1]] : [+m[1], +m[2]];
    return ymd(y, mo, d);
  }
  return null;
}

/** MT940 / short form YYMMDD → YYYY-MM-DD */
export const yymmdd = (s: string) => ymd(2000 + +s.slice(0, 2), +s.slice(2, 4), +s.slice(4, 6));

function ymd(y: number, m: number, d: number) {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const squash = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/** A stable key for a line: the bank's reference when it has one, otherwise its content (+ its place among identical lines). */
export function dedupeKeys(lines: ParsedLine[]): string[] {
  const seen = new Map<string, number>();
  return lines.map((l) => {
    if (l.bankRef?.trim()) return `ref:${l.bankRef.trim()}`;
    const base = [l.bookingDate, l.amount.toFixed(2), squash(l.counterparty).toLowerCase(), cleanIban(l.counterpartyIban), squash(l.remittance).toLowerCase(), squash(l.endToEndId)].join("|");
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return `h:${hash(base)}#${n}`;
  });
}

/** FNV-1a, 2×32 bit — short and stable (not for security). */
function hash(s: string) {
  let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

/** Which format a file is in (by content first, then by name). */
export function detectFormat(text: string, fileName = ""): "CAMT053" | "MT940" | "CSV" | "XLSX" | null {
  const head = text.slice(0, 4000);
  if (/^PK/.test(head) || /\.xlsx$/i.test(fileName)) return "XLSX";
  if (/<\??xml|<Document/i.test(head) && /BkToCstmrStmt|camt\.05[23]/i.test(text.slice(0, 20000))) return "CAMT053";
  if (/:20:/.test(head) && /:25:/.test(head) && /:6[01][FM]?:/.test(text)) return "MT940";
  if (/\.(sta|mt940|940)$/i.test(fileName)) return "MT940";
  if (/\.(csv|txt)$/i.test(fileName) || /[;,\t]/.test(head.split(/\r?\n/)[0] ?? "")) return "CSV";
  return null;
}
