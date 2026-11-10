/** AI Centre constants shared by server code and client components (no server imports here). */
export const AI_MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"] as const;
export type AiModel = (typeof AI_MODELS)[number];
export const AI_MODEL_LABEL: Record<AiModel, string> = { "claude-opus-5-5": "Claude Opus 5.5 (best answers)", "claude-sonnet-5-5": "Claude Sonnet 5.5 (faster, cheaper)", "claude-haiku-5-5": "Claude Haiku 5.5 (fastest, cheapest)" };
export type AiSettings = { model: AiModel; staff: boolean; buyers: boolean; suppliers: boolean; hourlyLimit: number };
export const DEFAULT_AI: AiSettings = { model: "claude-opus-5-5", staff: true, buyers: true, suppliers: true, hourlyLimit: 30 };

export const REC_KINDS = ["REORDER_DUE", "STOCK_OUT", "LOW_COVER", "CHEAPER_SUPPLIER", "MARGIN_GAP", "DELIVERY_RISK", "DEMAND_SURGE"] as const;
export type RecKind = (typeof REC_KINDS)[number];
export const REC_LABEL: Record<RecKind, string> = {
  REORDER_DUE: "Reorder due", STOCK_OUT: "Stock running out", LOW_COVER: "Low stock cover", CHEAPER_SUPPLIER: "Better supplier",
  MARGIN_GAP: "Margin below target", DELIVERY_RISK: "Delivery at risk", DEMAND_SURGE: "Demand rising",
};

export const TOOL_LABEL: Record<string, string> = {
  sales_summary: "Sales summary", breakdown: "Breakdown", demand_forecast: "Demand forecast", stock_outlook: "Stock outlook", reorder_outlook: "Reorder timing",
  supplier_alternatives: "Supplier alternatives", margin_opportunities: "Margin opportunities", delivery_risk: "Delivery risk", supplier_scorecards: "Supplier scorecards",
  find_orders: "Orders", search_catalogue: "Catalogue", open_suggestions: "Suggestions", profit_and_loss: "Profit & loss",
};

/** Why an open order may be late (delivery risk); `n` = hours / products / orders. */
export type RiskReason = { code: "NOT_CONFIRMED" | "DATE_PASSED" | "DUE_SOON" | "LATE_ETA" | "SHORT_STOCK" | "SUPPLIER_DECLINES"; n?: number };
export function reasonText(r: RiskReason): string {
  switch (r.code) {
    case "NOT_CONFIRMED": return `Not confirmed after ${r.n} h`;
    case "DATE_PASSED": return "Requested delivery date has passed";
    case "DUE_SOON": return "Due within 24 h and not dispatched";
    case "LATE_ETA": return "Driver ETA is after the requested day";
    case "SHORT_STOCK": return `${r.n} product${r.n === 1 ? "" : "s"} with less stock than ordered`;
    case "SUPPLIER_DECLINES": return `Supplier declined / missed ${r.n} orders in 60 days`;
  }
}
