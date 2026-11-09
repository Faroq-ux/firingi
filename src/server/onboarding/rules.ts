/**
 * Onboarding rules — pure functions, no DB. Changing a requirement here changes
 * registration, the applicant's checklist and the admin approval check together.
 */
import type { AccountStatus, AddressKind, CompanyType, DocumentType, ReviewStatus } from "@prisma/client";

/** Documents an applicant must upload before submitting (and admin must approve before activation). */
export const REQUIRED_DOCUMENTS: Record<Exclude<CompanyType, "ADMIN">, DocumentType[]> = {
  DISTRIBUTOR: ["BUSINESS_REGISTRATION", "TAX_ID_CERTIFICATE"],
  WHOLESALER: ["BUSINESS_REGISTRATION", "TAX_ID_CERTIFICATE", "TRADE_LICENCE"],
  CUSTOMER: ["BUSINESS_REGISTRATION", "TAX_ID_CERTIFICATE"],
};

export const REQUIRED_DRIVER_DOCUMENTS: DocumentType[] = ["ID_DOCUMENT", "DRIVING_LICENCE"];

/** Optional documents a company may also upload. */
export const OPTIONAL_DOCUMENTS: DocumentType[] = ["TRADE_LICENCE", "CONTRACT", "OTHER"];

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
  documents: { type: DocumentType; status: ReviewStatus }[];
  addresses: { kind: AddressKind; isActive: boolean }[];
  vatNumber: string | null;
  viesValid: boolean;
  hasCommission: boolean;
};

export type Missing = { code: string; detail?: string };

/** What is still missing before the applicant can SUBMIT (documents only need to be uploaded). */
export function missingForSubmission(i: ReadinessInput): Missing[] {
  const out: Missing[] = [];
  for (const t of REQUIRED_DOCUMENTS[i.type])
    if (!i.documents.some((d) => d.type === t && d.status !== "REJECTED" && d.status !== "EXPIRED"))
      out.push({ code: "DOCUMENT_MISSING", detail: t });
  for (const group of REQUIRED_ADDRESS_GROUPS[i.type])
    if (!i.addresses.some((a) => a.isActive && group.includes(a.kind))) out.push({ code: "ADDRESS_MISSING", detail: group.join("|") });
  if (i.type === "DISTRIBUTOR" && !i.vatNumber) out.push({ code: "VAT_NUMBER_MISSING" });
  return out;
}

/** What is still missing before admin can APPROVE (documents must be approved, VAT checked, commission set). */
export function missingForApproval(i: ReadinessInput): Missing[] {
  const out = missingForSubmission(i).filter((m) => m.code !== "DOCUMENT_MISSING");
  for (const t of REQUIRED_DOCUMENTS[i.type])
    if (!i.documents.some((d) => d.type === t && d.status === "APPROVED")) out.push({ code: "DOCUMENT_NOT_APPROVED", detail: t });
  // Distributors sell across EU borders → their VAT number must be confirmed in VIES.
  if (i.type === "DISTRIBUTOR" && i.vatNumber && !i.viesValid) out.push({ code: "VIES_NOT_VALID" });
  // There is no default commission: a vendor cannot go live until admin sets a rate.
  if (isVendorType(i.type) && !i.hasCommission) out.push({ code: "COMMISSION_MISSING" });
  return out;
}

/** Human-readable text for a Missing item (English; UI may translate by code). */
export function describeMissing(m: Missing): string {
  const doc = (t?: string) => (t ?? "").replace(/_/g, " ").toLowerCase();
  switch (m.code) {
    case "DOCUMENT_MISSING": return `Upload: ${doc(m.detail)}`;
    case "DOCUMENT_NOT_APPROVED": return `Document not approved yet: ${doc(m.detail)}`;
    case "ADDRESS_MISSING": return `Add an address: ${(m.detail ?? "").split("|").map(doc).join(" or ")}`;
    case "VAT_NUMBER_MISSING": return "EU VAT number is required for distributors";
    case "VIES_NOT_VALID": return "VAT number not yet confirmed in EU VIES";
    case "COMMISSION_MISSING": return "Commission rate not set";
    default: return m.code;
  }
}

/** Upload limits. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const ALLOWED_MIME = ["application/pdf", "image/jpeg", "image/png", "image/webp"] as const;
