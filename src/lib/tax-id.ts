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
  if (!vat.startsWith(prefix) || !looksLikeEuVat(vat)) return { ok: false, error: `VAT number must start with ${prefix}.` };
  if (country.code === "PT" && vat !== `PT${taxId}`) return { ok: false, error: "For Portugal the VAT number is PT followed by the NIF." };
  return { ok: true, vat };
}
