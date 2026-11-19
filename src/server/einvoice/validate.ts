/**
 * Phase 46 — checks before an e-invoice goes out: the EN 16931 core business rules (BR-…, BR-CO-…) that
 * FIRINGI's data can break, plus each network's own rules (Peppol, XRechnung, KSeF, SDI, Verifactu).
 * Errors stop the document (finance fixes the data and validates again); warnings are shown.
 */
import Decimal from "decimal.js";
import { PEPPOL_ID, type EFormat } from "@/lib/einvoice";
import type { EDoc } from "./types";

export type Finding = { code: string; severity: "error" | "warning"; message: string; field?: string };

const D = (v: string | number) => new Decimal(v || 0);
const near = (a: Decimal, b: Decimal, tol = 0.01) => a.minus(b).abs().lte(tol);

export function validateEDoc(d: EDoc, format: EFormat): Finding[] {
  const out: Finding[] = [];
  const err = (code: string, message: string, field?: string) => out.push({ code, severity: "error", message, field });
  const warn = (code: string, message: string, field?: string) => out.push({ code, severity: "warning", message, field });

  // ── EN 16931 core ──
  if (!d.number) err("BR-02", "The document has no number.", "number");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.issueDate)) err("BR-03", "The issue date is missing or not a date.", "issueDate");
  if (!/^[A-Z]{3}$/.test(d.currency)) err("BR-05", "The currency code is missing.", "currency");
  if (!d.seller.name) err("BR-06", "The seller's name is missing.", "seller.name");
  if (!d.buyer.name) err("BR-07", "The buyer's name is missing.", "buyer.name");
  if (!d.seller.countryCode) err("BR-09", "The seller's country is missing.", "seller.countryCode");
  if (!d.buyer.countryCode) err("BR-11", "The buyer's country is missing.", "buyer.countryCode");
  if (!d.seller.city || !d.seller.street) warn("BR-08", "The seller's postal address is incomplete.", "seller.address");
  if (!d.buyer.city || !d.buyer.street) warn("BR-10", "The buyer's postal address is incomplete.", "buyer.address");
  if (!d.lines.length) err("BR-16", "The document has no lines.", "lines");
  if ((d.typeCode === "381" || d.typeCode === "261") && !d.preceding) warn("BR-55", "The credit note does not name the invoice it corrects.", "preceding");

  const lineSum = d.lines.reduce((a, l) => a.plus(l.net), D(0));
  if (!near(lineSum, D(d.totals.lineNet))) err("BR-CO-10", `The lines add up to ${lineSum.toFixed(2)}, the document says ${D(d.totals.lineNet).toFixed(2)}.`, "totals.lineNet");
  const vatSum = d.taxes.reduce((a, t) => a.plus(t.vat), D(0));
  if (!near(vatSum, D(d.totals.vat))) err("BR-CO-14", `The VAT breakdown adds up to ${vatSum.toFixed(2)}, the VAT total is ${D(d.totals.vat).toFixed(2)}.`, "totals.vat");
  const baseSum = d.taxes.reduce((a, t) => a.plus(t.base), D(0));
  if (!near(baseSum, D(d.totals.net))) err("BR-CO-13", `The VAT bases add up to ${baseSum.toFixed(2)}, the net total is ${D(d.totals.net).toFixed(2)}.`, "totals.net");
  if (!near(D(d.totals.net).plus(d.totals.vat), D(d.totals.gross))) err("BR-CO-15", "Net + VAT is not the total.", "totals.gross");
  if (!near(D(d.totals.gross).minus(d.totals.paid), D(d.totals.payable))) err("BR-CO-16", "Total − paid is not the amount due.", "totals.payable");
  for (const t of d.taxes) {
    if (t.category === "S" && D(t.rate).lte(0)) err("BR-S-05", `Standard-rated VAT must have a rate above 0 % (${t.rate} %).`, "taxes");
    if (t.category === "S" && !near(D(t.base).mul(t.rate).div(100), D(t.vat), 0.05 * Math.max(1, d.lines.length))) warn("BR-CO-17", `VAT at ${D(t.rate).toString()} % of ${D(t.base).toFixed(2)} differs from ${D(t.vat).toFixed(2)} by more than rounding.`, "taxes");
    if (["AE", "K", "E", "Z"].includes(t.category) && !D(t.vat).isZero()) err(`BR-${t.category}-09`, `VAT category ${t.category} must have 0 VAT.`, "taxes");
    if (t.category === "AE" && (!d.seller.vatId || !d.buyer.vatId)) err("BR-AE-02", "Reverse charge: both the seller's and the buyer's VAT number are required.", "buyer.vatId");
    if (t.category === "K" && (!d.seller.vatId || !d.buyer.vatId)) err("BR-IC-02", "Intra-EU supply: both VAT numbers are required.", "buyer.vatId");
    if (["AE", "E", "K"].includes(t.category) && !t.exemptionCode && !t.exemptionText) err(`BR-${t.category}-10`, `VAT category ${t.category} needs an exemption reason.`, "taxes");
  }
  if (d.taxes.some((t) => t.category === "S") && !d.seller.vatId && !d.seller.taxId) err("BR-S-02", "The seller's VAT number is required for VAT-charged documents.", "seller.vatId");
  for (const l of d.lines) {
    if (!l.name) err("BR-25", `Line ${l.id} has no name.`, `lines.${l.id}`);
    if (D(l.qty).isZero()) warn("BR-22", `Line ${l.id} has no quantity.`, `lines.${l.id}`);
  }

  // ── network rules ──
  switch (format) {
    case "PEPPOL_BIS3":
    case "XRECHNUNG":
      if (!d.buyer.peppolId) err("PEPPOL-EN16931-R010", "The buyer has no Peppol id (where the document is delivered). Add it in the customer's e-invoice settings.", "buyer.peppolId");
      else if (!PEPPOL_ID.test(d.buyer.peppolId)) err("PEPPOL-EN16931-R010", `The buyer's Peppol id "${d.buyer.peppolId}" is not "scheme:identifier".`, "buyer.peppolId");
      if (!d.seller.peppolId) err("PEPPOL-EN16931-R020", "FIRINGI's company has no Peppol id. Add it on the FIRINGI company (legal entity).", "seller.peppolId");
      if (format === "XRECHNUNG") {
        if (!d.buyerReference) err("BR-DE-15", "XRechnung needs the buyer reference (Leitweg-ID). Add it in the customer's e-invoice settings.", "buyerReference");
        if (!d.seller.phone) err("BR-DE-6", "XRechnung needs the seller's phone number.", "seller.phone");
        if (!d.seller.email) err("BR-DE-7", "XRechnung needs the seller's e-mail.", "seller.email");
        if (!d.payment) err("BR-DE-1", "XRechnung needs payment instructions.", "payment");
      }
      break;
    case "FACTURX":
      if (!d.buyer.email) warn("FX-01", "The buyer has no e-mail to receive the Factur-X PDF.", "buyer.email");
      break;
    case "KSEF_FA3": {
      const sNip = (d.extra.ksefSellerNip ?? d.seller.taxId ?? "").replace(/^PL/i, "").replace(/\D/g, "");
      if (sNip.length !== 10) err("KSEF-NIP-1", "KSeF needs FIRINGI's 10-digit NIP.", "seller.taxId");
      if (d.buyer.countryCode === "PL") {
        const bNip = (d.extra.ksefBuyerNip ?? d.buyer.taxId ?? d.buyer.vatId ?? "").replace(/^PL/i, "").replace(/\D/g, "");
        if (bNip.length !== 10) err("KSEF-NIP-2", "KSeF needs the Polish buyer's 10-digit NIP.", "buyer.taxId");
      }
      if (d.seller.countryCode !== "PL") err("KSEF-01", "KSeF is only for documents issued by FIRINGI's Polish company.", "seller.countryCode");
      break;
    }
    case "FATTURAPA":
      if (d.seller.countryCode !== "IT") err("SDI-01", "SDI is only for documents issued by FIRINGI's Italian company.", "seller.countryCode");
      if (d.buyer.countryCode === "IT" && !d.extra.sdiCode && !d.extra.pec) err("SDI-02", "An Italian buyer needs its SDI recipient code (7 characters) or PEC e-mail.", "buyer.sdiCode");
      if (d.extra.sdiCode && !/^[A-Z0-9]{7}$/i.test(d.extra.sdiCode)) err("SDI-03", `"${d.extra.sdiCode}" is not a 7-character SDI code.`, "buyer.sdiCode");
      if (!d.buyer.vatId && !d.buyer.taxId) err("SDI-04", "The buyer needs a VAT number or codice fiscale.", "buyer.vatId");
      break;
    case "VERIFACTU":
      if (d.seller.countryCode !== "ES") err("VF-01", "Verifactu is only for documents issued by FIRINGI's Spanish company.", "seller.countryCode");
      if (d.buyer.countryCode === "ES" && !(d.buyer.taxId ?? d.buyer.vatId)) err("VF-02", "A Spanish buyer needs its NIF.", "buyer.taxId");
      break;
  }
  return out;
}

export const hasErrors = (f: Finding[], blockOnWarnings = false) => f.some((x) => x.severity === "error" || (blockOnWarnings && x.severity === "warning"));
