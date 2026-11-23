/** Customer assortments (Phase 64) — pure rules shared by the server and the pages. Docs: docs/assortments.md. */

export const ASSORTMENT_MODES = ["ONLY_LISTED", "HIDE_LISTED", "MUST_STOCK"] as const;
export type AssortmentModeKey = (typeof ASSORTMENT_MODES)[number];
export const ASSORTMENT_TARGETS = ["ALL", "GROUP", "CUSTOMER"] as const;
export type AssortmentTargetKey = (typeof ASSORTMENT_TARGETS)[number];

export type AssortmentSettings = {
  enabled: boolean;
  /** which kinds of list suppliers may use */
  modes: Record<AssortmentModeKey, boolean>;
  /** a must-stock product not ordered for this many days is a gap */
  gapDays: number;
  /** remind customers of their gaps (at most once a week) */
  reminders: boolean;
  /** suppliers FIRINGI switched assortments off for (their lists are ignored) */
  disabledVendors: string[];
};

export const DEFAULT_ASSORTMENT_SETTINGS: AssortmentSettings = {
  enabled: true,
  modes: { ONLY_LISTED: true, HIDE_LISTED: true, MUST_STOCK: true },
  gapDays: 30,
  reminders: true,
  disabledVendors: [],
};

export function mergeAssortmentSettings(v: Partial<AssortmentSettings> | null | undefined): AssortmentSettings {
  const d = DEFAULT_ASSORTMENT_SETTINGS;
  if (!v || typeof v !== "object") return { ...d, modes: { ...d.modes }, disabledVendors: [] };
  const m = (v.modes ?? {}) as Partial<Record<AssortmentModeKey, boolean>>;
  const n = Math.round(Number(v.gapDays));
  return {
    enabled: typeof v.enabled === "boolean" ? v.enabled : d.enabled,
    modes: Object.fromEntries(ASSORTMENT_MODES.map((k) => [k, typeof m[k] === "boolean" ? m[k]! : d.modes[k]])) as Record<AssortmentModeKey, boolean>,
    gapDays: Number.isFinite(n) ? Math.min(365, Math.max(7, n)) : d.gapDays,
    reminders: typeof v.reminders === "boolean" ? v.reminders : d.reminders,
    disabledVendors: Array.isArray(v.disabledVendors) ? [...new Set(v.disabledVendors.filter((x): x is string => typeof x === "string" && x.length > 0))].slice(0, 5000) : [],
  };
}

export type ListRule = { vendorId: string; mode: AssortmentModeKey; target: AssortmentTargetKey; items: { offerId: string; mustStock: boolean }[] };

/**
 * The lists that apply to one customer → what it may see:
 *   • a supplier with an approved list (ONLY_LISTED) shows that customer only the products on its approved lists;
 *   • products on a hidden-items list (HIDE_LISTED) aren't shown — unless the customer's own list (approved or
 *     must-stock, made for this customer) has them: the most specific list wins;
 *   • must-stock = MUST_STOCK items + approved-list items marked must-stock (never hidden ones).
 */
export function resolveRules(lists: ListRule[]) {
  const onlyVendors = new Set<string>(), allowed = new Set<string>(), hidden = new Set<string>(), ownList = new Set<string>();
  const must = new Map<string, string>(); // offerId → vendorId
  for (const l of lists) {
    if (l.target === "CUSTOMER" && l.mode !== "HIDE_LISTED") for (const i of l.items) ownList.add(i.offerId);
    if (l.mode === "ONLY_LISTED") { onlyVendors.add(l.vendorId); for (const i of l.items) allowed.add(i.offerId); }
    if (l.mode === "HIDE_LISTED") for (const i of l.items) hidden.add(i.offerId);
  }
  for (const id of ownList) hidden.delete(id);
  for (const l of lists) {
    if (l.mode === "HIDE_LISTED") continue;
    for (const i of l.items) if ((l.mode === "MUST_STOCK" || i.mustStock) && !hidden.has(i.offerId)) must.set(i.offerId, l.vendorId);
  }
  // must-stock products of a supplier with an approved list stay visible even when not on that list
  for (const [id, v] of must) if (onlyVendors.has(v)) allowed.add(id);
  return { onlyVendorIds: [...onlyVendors], allowedOfferIds: [...allowed], hiddenOfferIds: [...hidden], mustStock: must };
}

/** Is this offer visible under the rules (ignoring all other catalogue rules)? */
export function visibleUnder(rules: ReturnType<typeof resolveRules>, offer: { id: string; vendorId: string }) {
  if (rules.hiddenOfferIds.includes(offer.id)) return false;
  if (rules.onlyVendorIds.includes(offer.vendorId)) return rules.allowedOfferIds.includes(offer.id);
  return true;
}

/** Must-stock gaps: never ordered, or not for `gapDays`. Oldest first (never ordered first). */
export function mustStockGaps<T extends { offerId: string }>(items: T[], lastOrdered: Map<string, Date | null>, gapDays: number, now = new Date()) {
  const limit = now.getTime() - gapDays * 86400_000;
  return items
    .map((i) => {
      const last = lastOrdered.get(i.offerId) ?? null;
      return { ...i, lastOrdered: last, days: last ? Math.floor((now.getTime() - last.getTime()) / 86400_000) : null, gap: !last || last.getTime() < limit };
    })
    .sort((a, b) => (a.lastOrdered?.getTime() ?? 0) - (b.lastOrdered?.getTime() ?? 0));
}

/** SKUs pasted by the supplier (comma, semicolon, space or new line separated) → unique, trimmed, upper-cased. */
export function parseSkus(text: string) {
  return [...new Set(text.split(/[\s,;]+/).map((s) => s.trim().toUpperCase()).filter(Boolean))].slice(0, 2000);
}
