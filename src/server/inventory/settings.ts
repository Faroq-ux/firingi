/**
 * Expiry features per supplier (Phase 24). FIRINGI decides, per supplier, which of the four are on;
 * a supplier without its own row gets FIRINGI's defaults (Setting "inventory.defaults").
 */
import type { Tx } from "@/server/db";

export const FEATURES = ["FEFO", "EXPIRY_ALERTS", "MARKDOWN", "SHOW_EXPIRY"] as const;
/** Switched per supplier on the features pages (expiry alerts have their own page: goods bought on FIRINGI). */
export const SUPPLIER_FEATURES = ["FEFO", "MARKDOWN", "SHOW_EXPIRY"] as const;
export type Feature = (typeof FEATURES)[number];
export type Features = { fefo: boolean; expiryAlerts: boolean; markdown: boolean; showExpiry: boolean };
export const FIELD: Record<Feature, keyof Features> = { FEFO: "fefo", EXPIRY_ALERTS: "expiryAlerts", MARKDOWN: "markdown", SHOW_EXPIRY: "showExpiry" };
export const FEATURE_LABEL: Record<Feature, string> = {
  FEFO: "FEFO picking (first to expire, first out)",
  EXPIRY_ALERTS: "Expiry alerts & write-off list",
  MARKDOWN: "AI markdown suggestions",
  SHOW_EXPIRY: "Show best-before to customers",
};
export const DEFAULTS: Features = { fefo: true, expiryAlerts: true, markdown: false, showExpiry: false };
export const DEFAULTS_KEY = "inventory.defaults";
/** From when a batch counts as "short-dated". */
export const SHORT_DATED_DAYS = 14;

export async function inventoryDefaults(tx: Tx): Promise<Features> {
  const s = await tx.setting.findUnique({ where: { scope_scopeId_key: { scope: "GLOBAL", scopeId: "", key: DEFAULTS_KEY } } });
  return { ...DEFAULTS, ...((s?.value as Partial<Features> | null) ?? {}) };
}

export async function inventorySettings(tx: Tx, companyId: string): Promise<Features & { custom: boolean }> {
  const row = await tx.inventorySettings.findUnique({ where: { companyId } });
  if (row) return { fefo: row.fefo, expiryAlerts: row.expiryAlerts, markdown: row.markdown, showExpiry: row.showExpiry, custom: true };
  return { ...(await inventoryDefaults(tx)), custom: false };
}
