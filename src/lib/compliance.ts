/** Phase 28 — client-safe helpers for supplier compliance. */
export const BUILTIN_CERT_KEYS = ["HACCP", "FOOD_ESTABLISHMENT", "ORGANIC", "ISO_22000", "IFS_BRCGS", "HALAL", "LIABILITY_INSURANCE", "TAX_CLEARANCE", "SOCIAL_SECURITY_CLEARANCE"] as const;
export const isBuiltinCert = (key: string) => (BUILTIN_CERT_KEYS as readonly string[]).includes(key);

export const CERT_STATES = ["VALID", "EXPIRING", "WAIVED", "GRACE", "EXPIRED", "PENDING", "REJECTED", "MISSING"] as const;
export type CertStateKey = (typeof CERT_STATES)[number];
/** Badge tone per state (the Badge component's variants). */
export const STATE_TONE: Record<CertStateKey, "success" | "warning" | "destructive" | "secondary" | "outline"> = {
  VALID: "success", EXPIRING: "warning", WAIVED: "secondary", GRACE: "warning", EXPIRED: "destructive", PENDING: "outline", REJECTED: "destructive", MISSING: "destructive",
};
export const COVERED_STATES: CertStateKey[] = ["VALID", "EXPIRING", "WAIVED", "GRACE"];

/** Certificate-type form defaults (admin). */
export type TypeDraft = {
  id: string | null; name: string; description: string | null; appliesTo: ("DISTRIBUTOR" | "WHOLESALER")[]; countryIds: string[]; categoryIds: string[];
  required: boolean; needsNumber: boolean; hasExpiry: boolean; recheckMonths: number | null; graceDays: number; badgeEnabled: boolean; publicDownload: boolean; isActive: boolean;
};
export const EMPTY_TYPE: TypeDraft = { id: null, name: "", description: "", appliesTo: ["DISTRIBUTOR", "WHOLESALER"], countryIds: [], categoryIds: [], required: false, needsNumber: true, hasExpiry: true, recheckMonths: null, graceDays: 0, badgeEnabled: false, publicDownload: false, isActive: true };

