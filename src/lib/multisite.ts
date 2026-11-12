/** Shared display helpers for shops and accounting (Phase 27). */
export const BUDGET_ACTION_TONE: Record<string, "default" | "secondary" | "destructive" | "outline" | "success" | "warning"> = { APPROVAL: "warning", BLOCK: "destructive", WARN: "secondary" };
export const pctTone = (pct: number) => (pct > 100 ? "destructive" : pct >= 80 ? "warning" : "success") as "destructive" | "warning" | "success";
