/**
 * Tax-ID helpers. Portugal (NIF) validation is exact (check digit); other EU countries
 * get a format check here and authoritative validation through VIES (Phase 2).
 */

/** Portuguese NIF: 9 digits, mod-11 check digit, valid leading digits. */
export function isValidPtNif(raw: string): boolean {
  const nif = raw.replace(/\s/g, "");
  if (!/^\d{9}$/.test(nif)) return false;
  if (!/^(1|2|3|5|6|8|9)/.test(nif) && !/^(45|70|71|72|74|75|77|79|90|91|98|99)/.test(nif)) return false;
  return ptCheckDigit(nif.slice(0, 8)) === Number(nif[8]);
}

export function ptCheckDigit(first8: string): number {
  const sum = first8.split("").reduce((acc, d, i) => acc + Number(d) * (9 - i), 0);
  const r = 11 - (sum % 11);
  return r >= 10 ? 0 : r;
}

/** Build a valid NIF from an 8-digit base (used by seeds / tests). */
export function makePtNif(first8: string): string {
  return first8 + ptCheckDigit(first8);
}

/** Basic EU VAT-number format check: country prefix + 2-13 alphanumerics. */
export function looksLikeEuVat(vat: string): boolean {
  return /^(AT|BE|BG|CY|CZ|DE|DK|EE|EL|ES|FI|FR|HR|HU|IE|IT|LT|LU|LV|MT|NL|PL|PT|RO|SE|SI|SK)[0-9A-Z+*]{2,13}$/.test(
    vat.replace(/[\s.-]/g, "").toUpperCase(),
  );
}

/** VAT-number formats of the non-EU Schengen countries (not in VIES). */
const NON_EU_VAT: Record<string, RegExp> = {
  NO: /^NO\d{9}(MVA)?$/, // organisasjonsnummer + MVA
  CHE: /^CHE\d{9}(MWST|TVA|IVA)?$/, // UID + VAT suffix
  IS: /^IS\d{5,6}$/, // VSK-númer
  LI: /^LI\d{5,9}$/,
};

/**
 * Validate a company's VAT number against its country of registration.
 * Returns the normalised VAT number or an error message.
 *  - must carry the country's VAT prefix (GR uses "EL");
 *  - Portugal: the VAT number is "PT" + NIF, so it must match the company's NIF.
 */
export function checkCompanyVat(raw: string | null | undefined, country: { code: string; vatPrefix: string | null }, taxId: string):
  { ok: true; vat: string } | { ok: false; error: string } {
  const prefix = country.vatPrefix ?? country.code;
  const vat = (raw ?? "").replace(/[\s.-]/g, "").toUpperCase();
  if (!vat) return { ok: false, error: "VAT number is required." };
  const nonEu = NON_EU_VAT[prefix];
  if (!vat.startsWith(prefix) || !(nonEu ? nonEu.test(vat) : looksLikeEuVat(vat))) return { ok: false, error: `VAT number must start with ${prefix}.` };
  if (country.code === "PT" && vat !== `PT${taxId}`) return { ok: false, error: "For Portugal the VAT number is PT followed by the NIF." };
  return { ok: true, vat };
}

/**
 * Portuguese NIFs starting with 1, 2 or 3 belong to individuals. A business using one
 * is a sole trader (empresário em nome individual) — allowed, but flagged for reviewers
 * so they confirm the business activity (FIRINGI is B2B only, no private consumers).
 */
export function isIndividualPtNif(nif: string) {
  return /^[123]/.test(nif.replace(/\D/g, ""));
}

/** Portugal's "final consumer" NIF — the same as no number on a receipt. */
export const PT_FINAL_CONSUMER = "999999990";

const RECEIPT_PREFIX = /^(AT|BE|BG|CY|CZ|DE|DK|EE|EL|ES|FI|FR|HR|HU|IE|IT|LT|LU|LV|MT|NL|PL|PT|RO|SE|SI|SK|XI|CHE|NO|IS|LI)/;

/**
 * The customer's tax number on a till receipt (only when the customer asks). A Portuguese NIF is checked digit by
 * digit; a number with an EU / Schengen VAT prefix is accepted for that country; others get a light format check so a
 * typo is caught without refusing a valid foreign number. Returns the number normalised (no spaces or dots).
 */
export function checkTaxId(raw: string, country: string): { ok: true; value: string } | { ok: false; reason: "format" | "checksum" } {
  const v = raw.toUpperCase().replace(/[\s.\-/]/g, "");
  if (!v) return { ok: false, reason: "format" };
  const prefix = v.match(RECEIPT_PREFIX)?.[1];
  const cc = prefix ?? (country === "GR" ? "EL" : country);
  const body = prefix ? v.slice(prefix.length) : v;
  if (cc === "PT") return /^\d{9}$/.test(body) ? (isValidPtNif(body) ? { ok: true, value: prefix ? v : body } : { ok: false, reason: "checksum" }) : { ok: false, reason: "format" };
  if (cc === "ES") return /^[0-9A-Z]\d{7}[0-9A-Z]$/.test(body) ? { ok: true, value: v } : { ok: false, reason: "format" };
  return /^[0-9A-Z]{4,15}$/.test(body) && /\d/.test(body) ? { ok: true, value: v } : { ok: false, reason: "format" };
}
