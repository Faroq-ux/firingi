/** Supplier plans (Phase 36) — constants shared by server and client (no server imports). */
export const PLAN_FEATURES = ["INVENTORY", "PLANNING", "WAREHOUSE", "PRICE_INSIGHTS", "ADS", "INTEGRATIONS", "ROUTES", "ASSISTANT"] as const;
export type PlanFeature = (typeof PLAN_FEATURES)[number];

/** FIRINGI's labels (English back office). Suppliers see translated ones (messages: plans.features.*). */
export const PLAN_FEATURE_LABEL: Record<PlanFeature, string> = {
  INVENTORY: "Inventory (lots, expiry, purchase orders, counts, transfers)",
  PLANNING: "Demand planning & restock",
  WAREHOUSE: "Warehouse (pick & pack, shelves, scanner, traceability, recalls)",
  PRICE_INSIGHTS: "Price insights",
  ADS: "Advertising (sponsored products)",
  INTEGRATIONS: "Integrations (import & sync, API, webhooks, exports)",
  ROUTES: "Route planning for own drivers",
  ASSISTANT: "AI assistant",
};

/** Nav feature keys hidden when a plan feature is off (the menu uses these tags). */
export const PLAN_NAV_KEYS: Record<PlanFeature, string[]> = {
  INVENTORY: ["INVENTORY"], PLANNING: ["PLANNING"], WAREHOUSE: ["WAREHOUSE", "PICK_PACK", "SCAN", "BINS", "TRACE"], PRICE_INSIGHTS: ["PRICE_INSIGHTS"],
  ADS: ["ADS"], INTEGRATIONS: ["INTEGRATIONS"], ROUTES: ["ROUTES"], ASSISTANT: ["ASSISTANT"],
};

export const LIMITS = ["products", "users", "warehouses", "drivers"] as const;
export type LimitKind = (typeof LIMITS)[number];

export const EARLY_PAY_MODELS = ["OFF", "PER_DAY", "FLAT"] as const;
export type EarlyPayModel = (typeof EARLY_PAY_MODELS)[number];

export type PlansSettings = {
  /** Plans switched on: until then nothing is limited and no one is invoiced. */
  enabled: boolean;
  trialDays: number;
  trialPlanCode: string;
  defaultPlanCode: string;
  billing: "PAYOUT" | "INVOICE";
  invoiceDueDays: number;
  reminderDays: number[];
  earlyPay: { enabled: boolean; defaultLimit: number; minDaysEarly: number };
};
export const DEFAULT_PLANS_SETTINGS: PlansSettings = {
  enabled: false, trialDays: 60, trialPlanCode: "BUSINESS", defaultPlanCode: "FREE", billing: "PAYOUT", invoiceDueDays: 15, reminderDays: [14, 7, 1],
  earlyPay: { enabled: true, defaultLimit: 5000, minDaysEarly: 3 },
};

/** Fee for paying `amount` `days` early (excl. VAT, 2 decimals). */
export function earlyFee(model: EarlyPayModel, rate: number, amount: number, days: number) {
  if (model === "PER_DAY") return Math.round(amount * (rate / 100) * Math.max(0, days) * 100) / 100;
  if (model === "FLAT") return Math.round(amount * (rate / 100) * 100) / 100;
  return 0;
}
