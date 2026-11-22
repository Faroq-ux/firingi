/**
 * Substitutions (Phase 60) — pure rules, shared by the server and the pages. Docs: docs/substitutions.md.
 *
 * A customer's rule: NEVER (no replacements), ASK (each proposal waits for the customer) or AUTO (accepted at
 * once when it costs at most `maxPricePct` % more than the missing units and, if asked, is the same brand —
 * otherwise it is asked). A rule for one product overrides the general rule. FIRINGI sets the defaults and
 * can switch automatic acceptance off (AUTO then asks).
 */
export type SubstitutionModeT = "ASK" | "AUTO" | "NEVER";
export const SUB_MODES: SubstitutionModeT[] = ["ASK", "AUTO", "NEVER"];

export type SubstitutionSettings = {
  enabled: boolean;
  /** customers may let replacements be accepted automatically */
  allowAuto: boolean;
  /** how long a customer has to answer a proposal */
  responseMinutes: number;
  /** for customers who haven't chosen */
  defaultMode: SubstitutionModeT;
  defaultMaxPricePct: number;
  defaultAcceptOnTimeout: boolean;
  /** suppliers may offer "same price" (they pay the difference) */
  allowPriceMatch: boolean;
};

export const DEFAULT_SUBSTITUTION_SETTINGS: SubstitutionSettings = {
  enabled: true, allowAuto: true, responseMinutes: 120, defaultMode: "ASK", defaultMaxPricePct: 10, defaultAcceptOnTimeout: false, allowPriceMatch: true,
};

const clampInt = (v: unknown, lo: number, hi: number, d: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};

export function mergeSubstitutionSettings(v: Partial<SubstitutionSettings> | null | undefined): SubstitutionSettings {
  const d = DEFAULT_SUBSTITUTION_SETTINGS;
  if (!v || typeof v !== "object") return { ...d };
  return {
    enabled: v.enabled ?? d.enabled,
    allowAuto: v.allowAuto ?? d.allowAuto,
    responseMinutes: clampInt(v.responseMinutes, 5, 24 * 60, d.responseMinutes),
    defaultMode: SUB_MODES.includes(v.defaultMode as SubstitutionModeT) ? (v.defaultMode as SubstitutionModeT) : d.defaultMode,
    defaultMaxPricePct: clampInt(v.defaultMaxPricePct, 0, 100, d.defaultMaxPricePct),
    defaultAcceptOnTimeout: v.defaultAcceptOnTimeout ?? d.defaultAcceptOnTimeout,
    allowPriceMatch: v.allowPriceMatch ?? d.allowPriceMatch,
  };
}

export type CustomerRule = { mode: SubstitutionModeT; maxPricePct: number; sameBrandOnly: boolean; acceptOnTimeout: boolean };

/** The rule that applies to one product for one customer. */
export function effectiveRule(
  s: SubstitutionSettings,
  pref: { mode: SubstitutionModeT; maxPricePct: number; sameBrandOnly: boolean; acceptOnTimeout: boolean } | null,
  productMode: SubstitutionModeT | null,
): CustomerRule {
  const base: CustomerRule = pref
    ? { ...pref }
    : { mode: s.defaultMode, maxPricePct: s.defaultMaxPricePct, sameBrandOnly: false, acceptOnTimeout: s.defaultAcceptOnTimeout };
  const mode = productMode ?? base.mode;
  return { ...base, mode: mode === "AUTO" && !s.allowAuto ? "ASK" : mode };
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10000) / 10000;

/**
 * What the replacement costs compared with the missing units, in % (+ more, − less):
 * (qty × unit price) vs (missing units × their unit price).
 */
export function priceDiffPct(original: { unitNet: number; qty: number }, sub: { unitNet: number; qty: number }) {
  const was = original.unitNet * original.qty;
  const now = sub.unitNet * sub.qty;
  if (was <= 0) return now > 0 ? 100 : 0;
  return r2(((now - was) / was) * 100);
}

/** "Same price": the replacement's unit price so that it costs no more than the missing units. */
export function matchedUnitPrice(original: { unitNet: number; qty: number }, sub: { unitNet: number; qty: number }) {
  if (sub.qty <= 0) return sub.unitNet;
  const cap = Math.floor(((original.unitNet * original.qty) / sub.qty) * 10000) / 10000;
  return r4(Math.min(sub.unitNet, cap));
}

export type Verdict = "BLOCKED" | "AUTO" | "ASK";

/** What happens with a proposal under the customer's rule. */
export function verdict(rule: CustomerRule, p: { diffPct: number; sameBrand: boolean }): Verdict {
  if (rule.mode === "NEVER") return "BLOCKED";
  if (rule.mode === "ASK") return "ASK";
  if (p.diffPct > rule.maxPricePct) return "ASK";
  if (rule.sameBrandOnly && !p.sameBrand) return "ASK";
  return "AUTO";
}

/** Units of a line that are short and not yet replaced or being proposed. */
export function freeShort(l: { qtyOrdered: number; qtyConfirmed: number | null; substitutedQty: number }, pending: number) {
  return Math.max(0, l.qtyOrdered - (l.qtyConfirmed ?? l.qtyOrdered) - l.substitutedQty - pending);
}
