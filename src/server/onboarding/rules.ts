/**
 * Onboarding rules — pure functions, no DB. Changing a requirement here changes
 * registration, the applicant's checklist and the admin approval check together.
 */
import type { AccountStatus, AddressKind, CompanyType, DocumentType, LegalForm, ReviewStatus } from "@prisma/client";

/**
 * Phase 28: no document has to be uploaded to submit or to be approved — the VAT number (and the
 * addresses, VIES for distributors, commission for suppliers) is what's required. On top of that,
 * FIRINGI asks supplier COMPANIES for their permanent registry certificate code and CUSTOMERS for one
 * recent invoice from their own till (POS); admin can approve without them ("approve anyway").
 */
export const REQUIRED_DOCUMENTS: Record<Exclude<CompanyType, "ADMIN">, DocumentType[]> = { DISTRIBUTOR: [], WHOLESALER: [], CUSTOMER: [] };

/** Documents each account type may upload. */
export const UPLOADABLE_DOCUMENTS: Record<Exclude<CompanyType, "ADMIN">, DocumentType[]> = {
  DISTRIBUTOR: ["BUSINESS_REGISTRATION", "TAX_ID_CERTIFICATE", "TRADE_LICENCE", "CONTRACT", "OTHER"],
  WHOLESALER: ["BUSINESS_REGISTRATION", "TAX_ID_CERTIFICATE", "TRADE_LICENCE", "CONTRACT", "OTHER"],
  CUSTOMER: ["POS_INVOICE", "BUSINESS_REGISTRATION", "TAX_ID_CERTIFICATE", "TRADE_LICENCE", "CONTRACT", "OTHER"],
};

/** A POS invoice counts when it is at most this many days old at upload. */
export const POS_INVOICE_MAX_AGE_DAYS = 90;

/** PT certidão permanente access code: 0000-0000-0000. Other countries: their registry number. */
export function normaliseCertificateCode(code: string, countryCode: string): { ok: true; code: string } | { ok: false } {
  const raw = code.trim().toUpperCase();
  if (countryCode === "PT") {
    const d = raw.replace(/[^0-9]/g, "");
    return d.length === 12 && /^[0-9-\s]+$/.test(raw) ? { ok: true, code: `${d.slice(0, 4)}-${d.slice(4, 8)}-${d.slice(8)}` } : { ok: false };
  }
  return /^[A-Z0-9][A-Z0-9 ./-]{2,39}$/.test(raw) ? { ok: true, code: raw } : { ok: false };
}

/** Does this account need the registry certificate code? Suppliers that are companies (not sole traders). */
export const needsCertificateCode = (type: CompanyType, legalForm: LegalForm) => isVendorType(type) && legalForm === "COMPANY";

export const REQUIRED_DRIVER_DOCUMENTS: DocumentType[] = ["ID_DOCUMENT", "DRIVING_LICENCE"];

/** Address kinds each account type may hold. Wholesalers sell AND buy, so they get both sets. */
export const ADDRESS_KINDS: Record<Exclude<CompanyType, "ADMIN">, AddressKind[]> = {
  DISTRIBUTOR: ["HEAD_OFFICE", "BILLING", "WAREHOUSE", "PICKUP"],
  WHOLESALER: ["HEAD_OFFICE", "BILLING", "WAREHOUSE", "PICKUP", "DELIVERY"],
  CUSTOMER: ["HEAD_OFFICE", "BILLING", "DELIVERY"],
};

/** At least one address of EACH group is required; any kind inside a group satisfies it. */
export const REQUIRED_ADDRESS_GROUPS: Record<Exclude<CompanyType, "ADMIN">, AddressKind[][]> = {
  DISTRIBUTOR: [["HEAD_OFFICE"], ["WAREHOUSE", "PICKUP"]],
  WHOLESALER: [["HEAD_OFFICE"], ["WAREHOUSE", "PICKUP"]],
  CUSTOMER: [["HEAD_OFFICE"], ["DELIVERY"]],
};

/**
 * Must an address of this kind be in the company's own country?
 * Wholesalers and customers operate domestically only; a distributor may keep
 * warehouses / pickup points anywhere in the EU (cross-border sales).
 */
export function addressMustBeDomestic(type: CompanyType, kind: AddressKind) {
  if (type === "DISTRIBUTOR") return kind === "HEAD_OFFICE" || kind === "BILLING";
  return true;
}

/** Status transitions. Applicants may only submit; everything else is an admin decision. */
export const ADMIN_TRANSITIONS: Record<AccountStatus, AccountStatus[]> = {
  PENDING: ["UNDER_REVIEW", "REJECTED"],
  UNDER_REVIEW: ["APPROVED", "REJECTED", "PENDING"], // PENDING = "request changes"
  APPROVED: ["SUSPENDED"],
  SUSPENDED: ["APPROVED"], // reactivate
  REJECTED: ["PENDING"], // reopen the application
};

export const isVendorType = (t: CompanyType) => t === "DISTRIBUTOR" || t === "WHOLESALER";

export type ReadinessInput = {
  type: Exclude<CompanyType, "ADMIN">;
  legalForm: LegalForm;
  documents: { type: DocumentType; status: ReviewStatus }[];
  addresses: { kind: AddressKind; isActive: boolean }[];
  vatNumber: string | null;
  certificateCode: string | null;
  viesValid: boolean;
  hasCommission: boolean;
};

/** `waivable`: admin may approve without it (with a note). Everything else blocks approval. */
export type Missing = { code: string; detail?: string; waivable?: boolean };

/** What is still missing before the applicant can SUBMIT: addresses and the VAT number. */
export function missingForSubmission(i: ReadinessInput): Missing[] {
  const out: Missing[] = [];
  for (const group of REQUIRED_ADDRESS_GROUPS[i.type])
    if (!i.addresses.some((a) => a.isActive && group.includes(a.kind))) out.push({ code: "ADDRESS_MISSING", detail: group.join("|") });
  // Every business account needs the VAT number of its country of registration.
  if (!i.vatNumber) out.push({ code: "VAT_NUMBER_MISSING" });
  return out;
}

/** Asked for at submission too, but they don't block it — FIRINGI can approve without them. */
export function missingRecommended(i: ReadinessInput): Missing[] {
  const out: Missing[] = [];
  if (needsCertificateCode(i.type, i.legalForm) && !i.certificateCode) out.push({ code: "CERTIFICATE_CODE_MISSING", waivable: true });
  if (i.type === "CUSTOMER") {
    const pos = i.documents.filter((d) => d.type === "POS_INVOICE" && d.status !== "REJECTED" && d.status !== "EXPIRED" && d.status !== "REVOKED");
    if (!pos.length) out.push({ code: "POS_INVOICE_MISSING", waivable: true });
  }
  return out;
}

/** What is still missing before admin can APPROVE. Waivable items can be overridden ("approve anyway"). */
export function missingForApproval(i: ReadinessInput): Missing[] {
  const out = missingForSubmission(i);
  // Distributors sell across EU borders → their VAT number must be confirmed in VIES.
  if (i.type === "DISTRIBUTOR" && i.vatNumber && !i.viesValid) out.push({ code: "VIES_NOT_VALID" });
  // There is no default commission: a vendor cannot go live until admin sets a rate.
  if (isVendorType(i.type) && !i.hasCommission) out.push({ code: "COMMISSION_MISSING" });
  for (const m of missingRecommended(i)) out.push(m);
  if (i.type === "CUSTOMER" && !out.some((m) => m.code === "POS_INVOICE_MISSING") && !i.documents.some((d) => d.type === "POS_INVOICE" && d.status === "APPROVED"))
    out.push({ code: "POS_INVOICE_NOT_APPROVED", waivable: true });
  return out;
}

export const blocking = (m: Missing[]) => m.filter((x) => !x.waivable);
export const waivable = (m: Missing[]) => m.filter((x) => x.waivable);

/** Human-readable text for a Missing item (English; UI may translate by code). */
export function describeMissing(m: Missing): string {
  const doc = (t?: string) => (t ?? "").replace(/_/g, " ").toLowerCase();
  switch (m.code) {
    case "DOCUMENT_MISSING": return `Upload: ${doc(m.detail)}`;
    case "DOCUMENT_NOT_APPROVED": return `Document not approved yet: ${doc(m.detail)}`;
    case "ADDRESS_MISSING": return `Add an address: ${(m.detail ?? "").split("|").map(doc).join(" or ")}`;
    case "VAT_NUMBER_MISSING": return "VAT number (country of registration) is required";
    case "VIES_NOT_VALID": return "VAT number not yet confirmed in EU VIES";
    case "COMMISSION_MISSING": return "Commission rate not set";
    case "CERTIFICATE_CODE_MISSING": return "Permanent certificate code (company registry) not given";
    case "POS_INVOICE_MISSING": return "No recent invoice from the customer's POS uploaded";
    case "POS_INVOICE_NOT_APPROVED": return "POS invoice not approved yet";
    default: return m.code;
  }
}

/** Upload limits. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const ALLOWED_MIME = ["application/pdf", "image/jpeg", "image/png", "image/webp"] as const;
