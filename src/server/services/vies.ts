/**
 * EU VIES VAT-number validation (official REST API). Network errors are reported as
 * ERROR (not INVALID) so an outage never rejects a legitimate vendor.
 */
export type ViesResult = {
  result: "VALID" | "INVALID" | "ERROR";
  registeredName?: string | null;
  registeredAddress?: string | null;
  consultationRef?: string | null;
  error?: string;
};

/** Split "PT501964843" → { countryCode: "PT", number: "501964843" } (Greece uses EL). */
export function splitVat(vat: string): { countryCode: string; number: string } | null {
  const clean = vat.replace(/[\s.-]/g, "").toUpperCase();
  const m = /^([A-Z]{2})([0-9A-Z+*]{2,13})$/.exec(clean);
  return m ? { countryCode: m[1], number: m[2] } : null;
}

export async function checkVies(vat: string, fetchImpl: typeof fetch = fetch): Promise<ViesResult> {
  const parts = splitVat(vat);
  if (!parts) return { result: "INVALID", error: "Not a valid EU VAT number format" };
  const url = process.env.VIES_URL ?? "https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number";
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ countryCode: parts.countryCode, vatNumber: parts.number }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return { result: "ERROR", error: `VIES responded ${res.status}` };
    const body = (await res.json()) as { valid?: boolean; name?: string; address?: string; requestIdentifier?: string; userError?: string };
    if (body.userError && body.userError !== "VALID" && body.userError !== "INVALID") return { result: "ERROR", error: body.userError };
    const clean = (s?: string) => (s && s !== "---" ? s.trim() : null);
    return {
      result: body.valid ? "VALID" : "INVALID",
      registeredName: clean(body.name),
      registeredAddress: clean(body.address),
      consultationRef: body.requestIdentifier || null,
    };
  } catch (e) {
    return { result: "ERROR", error: e instanceof Error ? e.message : String(e) };
  }
}
