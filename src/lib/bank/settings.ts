/** Bank reconciliation settings (FIRINGI decides) — shared by server and pages. */
export type BankSettings = {
  /** FIRINGI's own bank: AUTO = book matches at or above `autoConfidence` without a person; CONFIRM = always a person. */
  firingiMode: "AUTO" | "CONFIRM";
  autoConfidence: number;
  /** Suppliers and customers may switch on auto-booking for their own bank (at or above `companyAutoConfidence`). */
  companiesMayAuto: boolean;
  companyAutoConfidence: number;
  /** A payment short by at most this much (and this percent) closes the invoices; the gap is booked as a bank fee. */
  toleranceAmount: number;
  tolerancePct: number;
  /** How many days apart a bank line and a recorded payment / entry may be. */
  windowDays: number;
  feed: {
    enabled: boolean;
    provider: "SIMULATED" | "GOCARDLESS";
    /** suppliers and customers may link their own bank */
    companiesMayLink: boolean;
  };
};

export const DEFAULT_BANK_SETTINGS: BankSettings = {
  firingiMode: "CONFIRM",
  autoConfidence: 95,
  companiesMayAuto: true,
  companyAutoConfidence: 95,
  toleranceAmount: 2,
  tolerancePct: 1,
  windowDays: 14,
  feed: { enabled: false, provider: "SIMULATED", companiesMayLink: true },
};

/** Categories for lines that aren't payments (FIRINGI's and the companies' own books). */
export const BANK_CATEGORIES = ["BANK_FEES", "TAXES_FEES", "SALARIES", "SOCIAL_SECURITY", "RENT", "UTILITIES", "INSURANCE", "LOAN", "OWN_TRANSFER", "CARD_SETTLEMENT", "REFUND", "OTHER"] as const;
export type BankCategory = (typeof BANK_CATEGORIES)[number];
export const BANK_CATEGORY_LABEL: Record<BankCategory, string> = {
  BANK_FEES: "Bank fees", TAXES_FEES: "Taxes & fees", SALARIES: "Salaries", SOCIAL_SECURITY: "Social security", RENT: "Rent",
  UTILITIES: "Utilities", INSURANCE: "Insurance", LOAN: "Loan", OWN_TRANSFER: "Transfer between own accounts",
  CARD_SETTLEMENT: "Card / payment provider settlement", REFUND: "Refund", OTHER: "Other",
};
