/**
 * Phase 47e — who may buy special goods. Tobacco, alcohol and vaping (and any catalogue category FIRINGI adds) are
 * open to a buying business only when (1) it said at registration that it sells them, and (2) one of its activity
 * codes (main or secondary; CAE in Portugal…) starts with a code FIRINGI allows for them. National codes share the
 * EU NACE digits, so "4726" (tobacco shops) or "5630" (bars) mean the same in every country. FIRINGI may let one
 * company through anyway (an exception). The licence / approval rules (Phase 2 and 43) still apply on top.
 */
export const SPECIAL_KINDS = ["TOBACCO", "ALCOHOL", "VAPING"] as const;
export type SpecialKind = (typeof SPECIAL_KINDS)[number];
/** A rule's target: one of the kinds, or a catalogue category "cat:<id>" (special items). */
export type SpecialTarget = SpecialKind | `cat:${string}`;

export type SpecialRule = { id: string; target: SpecialTarget; label: string; codes: string[]; countries: string[]; mode: "BLOCK" | "WARN"; active: boolean };
export type SpecialSettings = { enabled: boolean; askDeclaration: boolean; noCode: "ALLOW" | "BLOCK"; rules: SpecialRule[] };

/** The NACE classes behind the default rules (FIRINGI edits them). */
export const DEFAULT_SPECIAL_RULES: SpecialRule[] = [
  { id: "tobacco", target: "TOBACCO", label: "Tobacco", mode: "BLOCK", active: true, countries: [],
    codes: ["4635", "4639", "4711", "4719", "4726", "5510", "5610", "5630"] },
  { id: "alcohol", target: "ALCOHOL", label: "Alcoholic drinks", mode: "BLOCK", active: true, countries: [],
    codes: ["4634", "4639", "4711", "4719", "4725", "5510", "5520", "5590", "5610", "5621", "5629", "5630"] },
  { id: "vaping", target: "VAPING", label: "Vaping / e-cigarettes", mode: "BLOCK", active: true, countries: [],
    codes: ["4635", "4639", "4726", "4778"] },
];
export const DEFAULT_SPECIAL_SETTINGS: SpecialSettings = { enabled: true, askDeclaration: true, noCode: "ALLOW", rules: DEFAULT_SPECIAL_RULES };

const norm = (c: string) => c.toUpperCase().replace(/[\s.\-]/g, "");

export function mergeSpecialSettings(raw: unknown): SpecialSettings {
  const v = (raw ?? {}) as Partial<SpecialSettings>;
  const rules = Array.isArray(v.rules) ? v.rules : DEFAULT_SPECIAL_RULES;
  return {
    enabled: v.enabled ?? true,
    askDeclaration: v.askDeclaration ?? true,
    noCode: v.noCode === "BLOCK" ? "BLOCK" : "ALLOW",
    rules: rules
      .filter((r) => r && typeof r.target === "string" && ((SPECIAL_KINDS as readonly string[]).includes(r.target) || /^cat:[\w-]+$/.test(r.target)))
      .map((r, i) => ({
        id: String(r.id || `rule-${i}`).slice(0, 40), target: r.target as SpecialTarget, label: String(r.label ?? r.target).slice(0, 80),
        codes: [...new Set((r.codes ?? []).map(norm).filter((c) => /^[0-9A-Z]{2,8}$/.test(c)))].slice(0, 60),
        countries: [...new Set((r.countries ?? []).map((c) => String(c).toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c)))],
        mode: r.mode === "WARN" ? "WARN" : "BLOCK", active: r.active !== false,
      })),
  };
}

export type SpecialCompany = { country: string; codes: string[]; declared: boolean; sells: string[]; exceptions: string[] };
/** Why a target is closed (or open with a warning) for a company. */
export type SpecialVerdict = { open: boolean; warn: boolean; reason: "OK" | "EXCEPTION" | "NOT_DECLARED" | "NO_CODE" | "CODE" | "OFF" };

/** The rule that applies to a target in a country (a country-specific rule wins over an all-country one). */
export function ruleFor(s: SpecialSettings, target: SpecialTarget, country: string) {
  const rs = s.rules.filter((r) => r.active && r.target === target && (!r.countries.length || r.countries.includes(country)));
  return rs.find((r) => r.countries.length) ?? rs[0] ?? null;
}

export function verdict(s: SpecialSettings, c: SpecialCompany, target: SpecialTarget): SpecialVerdict {
  if (!s.enabled) return { open: true, warn: false, reason: "OFF" };
  if (c.exceptions.includes(target)) return { open: true, warn: false, reason: "EXCEPTION" };
  const isKind = (SPECIAL_KINDS as readonly string[]).includes(target);
  if (isKind && s.askDeclaration && c.declared && !c.sells.includes(target)) return { open: false, warn: false, reason: "NOT_DECLARED" };
  const rule = ruleFor(s, target, c.country);
  if (!rule) return { open: true, warn: false, reason: "OK" };
  const codes = c.codes.map(norm).filter(Boolean);
  if (!codes.length) return s.noCode === "BLOCK" ? { open: rule.mode === "WARN", warn: rule.mode === "WARN", reason: "NO_CODE" } : { open: true, warn: false, reason: "OK" };
  if (codes.some((code) => rule.codes.some((p) => code.startsWith(p)))) return { open: true, warn: false, reason: "OK" };
  return rule.mode === "WARN" ? { open: true, warn: true, reason: "CODE" } : { open: false, warn: false, reason: "CODE" };
}
