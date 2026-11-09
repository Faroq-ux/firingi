/**
 * Fiscal invoicing provider adapter.
 *
 * In Portugal, invoices must be issued by AT-certified software (ATCUD, hash chain,
 * QR code). FIRINGI therefore issues through a provider adapter:
 *   • "internal" (this file)  — development / testing. Documents are marked
 *     "NOT A FISCAL DOCUMENT". It still produces ATCUD, hash chain and QR payload in
 *     the AT format so everything downstream (PDF, SAF-T later) is exercised.
 *   • a certified provider (InvoiceXpress, Moloni, Vendus …) — to be connected once
 *     chosen; it implements the same interface and returns its own number / hash.
 */
import { createHash } from "node:crypto";

export type FiscalDoc = {
  docType: "INVOICE" | "INVOICE_RECEIPT" | "CREDIT_NOTE";
  fullNumber: string;
  number: number;
  seriesValidationCode: string | null;
  issuedAt: Date;
  issuerTaxId: string;
  recipientTaxId: string;
  recipientCountry: string;
  netTotal: string;
  vatTotal: string;
  grossTotal: string;
  previousHash: string | null;
};

export type FiscalResult = { provider: string; atcud: string; hash: string; qrPayload: string; externalId: string | null; certified: boolean };

export interface InvoiceProvider {
  issue(doc: FiscalDoc): Promise<FiscalResult>;
}

const SAFT_TYPE = { INVOICE: "FT", INVOICE_RECEIPT: "FR", CREDIT_NOTE: "NC" } as const;

export const internalProvider: InvoiceProvider = {
  async issue(d) {
    const date = d.issuedAt.toISOString().slice(0, 10);
    // Same chaining idea as AT (signature over date;datetime;number;gross;previous) — not RSA-signed here.
    const hash = createHash("sha256").update([date, d.issuedAt.toISOString(), d.fullNumber, d.grossTotal, d.previousHash ?? ""].join(";")).digest("base64");
    const atcud = `${d.seriesValidationCode ?? "0"}-${d.number}`;
    const qr = [
      `A:${d.issuerTaxId}`, `B:${d.recipientTaxId}`, `C:${d.recipientCountry}`, `D:${SAFT_TYPE[d.docType]}`, `E:N`, `F:${date.replace(/-/g, "")}`,
      `G:${d.fullNumber}`, `H:${atcud}`, `I1:PT`, `N:${d.vatTotal}`, `O:${d.grossTotal}`, `Q:${hash[0]}${hash[10]}${hash[20]}${hash[30]}`, `R:0000`,
    ].join("*");
    return { provider: "internal", atcud, hash, qrPayload: qr, externalId: null, certified: false };
  },
};

/** The active provider. Swap here when a certified provider is connected. */
export function invoiceProvider(): InvoiceProvider {
  return internalProvider;
}
