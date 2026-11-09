/**
 * Local name of value-added tax, by country (shown next to prices).
 * Portugal / Spain: IVA. Regions with a different tax (Canary Islands: IGIC) are
 * handled by the tax type of the rate itself.
 */
const LABELS: Record<string, string> = {
  PT: "IVA", ES: "IVA", IT: "IVA", FR: "TVA", BE: "TVA", LU: "TVA", DE: "MwSt.", AT: "USt.", NL: "BTW", PL: "VAT", IE: "VAT", MT: "VAT",
  CZ: "DPH", SK: "DPH", HU: "ÁFA", RO: "TVA", BG: "ДДС", HR: "PDV", SI: "DDV", EL: "ΦΠΑ", GR: "ΦΠΑ", CY: "ΦΠΑ",
  DK: "moms", SE: "moms", FI: "ALV", EE: "KM", LV: "PVN", LT: "PVM",
};

export function taxLabel(countryCode: string, taxType?: string | null): string {
  if (taxType && taxType !== "VAT") return taxType; // e.g. IGIC
  return LABELS[countryCode] ?? "VAT";
}
