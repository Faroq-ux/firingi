/**
 * Phase 47d — the company's economic activity code, as each country calls it: CAE in Portugal, CNAE in Spain,
 * NAF / APE in France, ATECO in Italy, WZ in Germany… (all national versions of the EU's NACE). Wholesale customers
 * give it at registration; suppliers may. Stored without dots or spaces.
 */
export const ACTIVITY_SCHEMES: Record<string, { name: string; pattern: RegExp; example: string }> = {
  PT: { name: "CAE", pattern: /^\d{5}$/, example: "56101" },
  ES: { name: "CNAE", pattern: /^\d{4}$/, example: "5610" },
  FR: { name: "NAF / APE", pattern: /^\d{4}[A-Z]$/, example: "5610A" },
  IT: { name: "ATECO", pattern: /^\d{4,6}$/, example: "561011" },
  DE: { name: "WZ", pattern: /^\d{4,5}$/, example: "56101" },
  AT: { name: "ÖNACE", pattern: /^\d{4,5}$/, example: "56101" },
  BE: { name: "NACE-BEL", pattern: /^\d{4,5}$/, example: "56101" },
  NL: { name: "SBI", pattern: /^\d{4,5}$/, example: "56101" },
  LU: { name: "NACELUX", pattern: /^\d{4,5}$/, example: "56101" },
  PL: { name: "PKD", pattern: /^\d{4}[A-Z]$/, example: "5610A" },
  CZ: { name: "CZ-NACE", pattern: /^\d{4,5}$/, example: "56101" },
  SK: { name: "SK NACE", pattern: /^\d{4,5}$/, example: "56101" },
  DK: { name: "DB07", pattern: /^\d{4,6}$/, example: "561010" },
  SE: { name: "SNI", pattern: /^\d{4,5}$/, example: "56100" },
  NO: { name: "NACE (SN)", pattern: /^\d{4,5}$/, example: "56101" },
  FI: { name: "TOL", pattern: /^\d{4,5}$/, example: "56101" },
  RO: { name: "CAEN", pattern: /^\d{4}$/, example: "5610" },
  HU: { name: "TEÁOR", pattern: /^\d{4}$/, example: "5610" },
  HR: { name: "NKD", pattern: /^\d{4,5}$/, example: "5610" },
  SI: { name: "SKD", pattern: /^\d{4,5}$/, example: "56101" },
  EL: { name: "ΚΑΔ", pattern: /^\d{4,8}$/, example: "56101000" },
  GR: { name: "ΚΑΔ", pattern: /^\d{4,8}$/, example: "56101000" },
  BG: { name: "КИД", pattern: /^\d{4}$/, example: "5610" },
};
const GENERIC = { name: "NACE", pattern: /^\d{4,6}[A-Z]?$/, example: "5610" };

export const activityScheme = (country: string) => ACTIVITY_SCHEMES[country] ?? GENERIC;

/** Normalise ("56.101" → "56101", "56.10a" → "5610A") and check the country's format. */
export function checkActivityCode(raw: string | null | undefined, country: string): { ok: true; value: string } | { ok: false } {
  const v = (raw ?? "").toUpperCase().replace(/[\s.\-]/g, "");
  return activityScheme(country).pattern.test(v) ? { ok: true, value: v } : { ok: false };
}
