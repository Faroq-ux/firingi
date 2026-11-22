/** International dialling codes of the countries FIRINGI serves (Schengen area), and phone-number helpers. */
export const DIAL_CODES: Record<string, string> = {
  PT: "+351", ES: "+34", FR: "+33", BE: "+32", NL: "+31", LU: "+352", DE: "+49", AT: "+43", CH: "+41", LI: "+423",
  IT: "+39", MT: "+356", SI: "+386", HR: "+385", HU: "+36", SK: "+421", CZ: "+420", PL: "+48", DK: "+45", SE: "+46",
  NO: "+47", FI: "+358", IS: "+354", EE: "+372", LV: "+371", LT: "+370", GR: "+30", BG: "+359", RO: "+40",
};

/** The dialling code of a country ("+351"); Portugal's when unknown. */
export const dialCodeOf = (countryCode: string | null | undefined) => DIAL_CODES[(countryCode ?? "").toUpperCase()] ?? "+351";

/** Every code once, sorted by number (for the code picker). */
export const ALL_DIAL_CODES = [...new Set(Object.values(DIAL_CODES))].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));

/**
 * A number with its international code: "+…" and "00…" stay international; a national number gets the country's code
 * (its trunk 0 dropped, except in Italy where the 0 is part of the number). Spaces kept as typed; empty stays empty.
 */
export function withDialCode(raw: string | null | undefined, countryCode: string | null | undefined): string {
  const v = (raw ?? "").trim();
  if (!v) return "";
  if (v.startsWith("+")) return v;
  if (v.startsWith("00")) return `+${v.slice(2).trimStart()}`;
  const cc = (countryCode ?? "").toUpperCase();
  const national = cc === "IT" ? v : v.replace(/^0(?=\d)/, "");
  return `${dialCodeOf(cc)} ${national}`;
}

/** Splits "+351 912 345 678" into the code and the rest (null code when the number has none of ours). */
export function splitDialCode(v: string | null | undefined): { code: string | null; rest: string } {
  const s = (v ?? "").trim();
  const code = ALL_DIAL_CODES.filter((c) => s.startsWith(c)).sort((a, b) => b.length - a.length)[0] ?? null;
  return code ? { code, rest: s.slice(code.length).trim() } : { code: null, rest: s };
}
