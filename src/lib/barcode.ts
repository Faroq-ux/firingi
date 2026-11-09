/**
 * Barcodes (GTIN-8 / UPC-A 12 / EAN-13 / GTIN-14) with mod-10 check digit.
 * Used to validate input and to recognise a barcode typed or scanned into search.
 */
export function gtinCheckDigit(body: string): number {
  // Weights 3,1,3,1… from the right of the body (excluding the check digit).
  const sum = body.split("").reverse().reduce((acc, d, i) => acc + Number(d) * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10;
}

export function isValidGtin(code: string): boolean {
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(code)) return false;
  return gtinCheckDigit(code.slice(0, -1)) === Number(code.at(-1));
}

/** Normalise user input; returns the digits if it looks like a barcode, else null. */
export function asBarcode(input: string): string | null {
  const digits = input.replace(/[\s-]/g, "");
  return /^\d{8,14}$/.test(digits) ? digits : null;
}

/** Build a valid EAN-13 from a 12-digit body (seeds / tests). */
export const makeEan13 = (body12: string) => body12 + gtinCheckDigit(body12);
