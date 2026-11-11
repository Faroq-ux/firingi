/**
 * Moloni API v1 client (https://www.moloni.pt/dev/).
 *
 * - Auth: OAuth 2 "password" grant for a server integration — GET {base}/v1/grant/ with
 *   client_id, client_secret, username, password → access_token (1 h) + refresh_token (14 days);
 *   refreshed with grant_type=refresh_token before it expires. Tokens live in memory only.
 * - Calls: POST {base}/v1/{endpoint}/?access_token=…&json=true&human_errors=true with a JSON body.
 * - Errors: auth errors are HTTP 400 {error, error_description}; field errors come back as a
 *   list (e.g. ["2 document_set_id"]) or objects with a code / description; {valid: 0} = refused.
 *
 * Credentials come from the server environment (never the database):
 *   MOLONI_CLIENT_ID, MOLONI_CLIENT_SECRET, MOLONI_USERNAME, MOLONI_PASSWORD,
 *   MOLONI_SANDBOX=true  → https://api.moloni.pt/sandbox
 *   MOLONI_SIMULATE=1    → an in-process simulated Moloni (development / demos; documents are
 *                           marked as simulated and are NOT fiscal)
 */
import "server-only";
import { simulatedMoloni } from "./sim";

export type MoloniFetch = (url: string, init: { method: "GET" | "POST"; headers?: Record<string, string>; body?: string }) => Promise<{ status: number; json: () => Promise<unknown> }>;

export class MoloniError extends Error {
  constructor(message: string, readonly kind: "AUTH" | "VALIDATION" | "UNAVAILABLE" | "CONFIG", readonly details: unknown = null) {
    super(message);
  }
  /** Worth trying again later (network / server trouble), as opposed to a refused document. */
  get retryable() { return this.kind === "UNAVAILABLE"; }
}

let fetchOverride: MoloniFetch | null = null;
/** Tests plug in a simulated Moloni here (no network). */
export function setMoloniFetchForTests(f: MoloniFetch | null) { fetchOverride = f; token = null; }

/** The dev/demo simulator (MOLONI_SIMULATE=1) loses its data on restart; saved Moloni ids don't apply. */
export function moloniForgetful() { return !fetchOverride && process.env.MOLONI_SIMULATE === "1"; }

export function moloniMode(): "live" | "sandbox" | "simulated" | "off" {
  if (fetchOverride || process.env.MOLONI_SIMULATE === "1") return "simulated";
  if (!process.env.MOLONI_CLIENT_ID || !process.env.MOLONI_CLIENT_SECRET || !process.env.MOLONI_USERNAME || !process.env.MOLONI_PASSWORD) return "off";
  return process.env.MOLONI_SANDBOX === "true" ? "sandbox" : "live";
}

const base = () => (process.env.MOLONI_SANDBOX === "true" ? "https://api.moloni.pt/sandbox" : "https://api.moloni.pt");
const doFetch: MoloniFetch = async (url, init) => {
  if (fetchOverride) return fetchOverride(url, init);
  if (process.env.MOLONI_SIMULATE === "1") return simulatedMoloni(url, init);
  const res = await fetch(url, { method: init.method, headers: init.headers, body: init.body, signal: AbortSignal.timeout(20_000) });
  return { status: res.status, json: () => res.json() };
};

let token: { access: string; refresh: string; expiresAt: number; refreshUntil: number } | null = null;

async function grant(params: Record<string, string>) {
  const qs = new URLSearchParams(params).toString();
  let res;
  try {
    res = await doFetch(`${base()}/v1/grant/?${qs}`, { method: "GET", headers: { Accept: "application/json" } });
  } catch (e) {
    throw new MoloniError(`Moloni can't be reached: ${e instanceof Error ? e.message : String(e)}`, "UNAVAILABLE");
  }
  const body = (await res.json().catch(() => null)) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string } | null;
  if (res.status >= 500) throw new MoloniError(`Moloni is unavailable (HTTP ${res.status}).`, "UNAVAILABLE");
  if (!body?.access_token) throw new MoloniError(`Moloni refused the sign-in: ${body?.error_description ?? body?.error ?? `HTTP ${res.status}`}`, "AUTH", body);
  const now = Date.now();
  token = { access: body.access_token, refresh: body.refresh_token ?? "", expiresAt: now + Math.max(60, (body.expires_in ?? 3600) - 120) * 1000, refreshUntil: now + 13 * 86400_000 };
  return token.access;
}

async function accessToken() {
  if (moloniMode() === "off") throw new MoloniError("Moloni is not connected: set MOLONI_CLIENT_ID, MOLONI_CLIENT_SECRET, MOLONI_USERNAME and MOLONI_PASSWORD on the server.", "CONFIG");
  const now = Date.now();
  if (token && now < token.expiresAt) return token.access;
  const id = process.env.MOLONI_CLIENT_ID ?? "sim", secret = process.env.MOLONI_CLIENT_SECRET ?? "sim";
  if (token?.refresh && now < token.refreshUntil) {
    try { return await grant({ grant_type: "refresh_token", client_id: id, client_secret: secret, refresh_token: token.refresh }); } catch (e) {
      if (e instanceof MoloniError && e.kind === "UNAVAILABLE") throw e; // otherwise fall back to signing in again
    }
  }
  return grant({ grant_type: "password", client_id: id, client_secret: secret, username: process.env.MOLONI_USERNAME ?? "sim", password: process.env.MOLONI_PASSWORD ?? "sim" });
}

/** Moloni answers field errors with a list of codes ("2 document_set_id") or objects. */
function errorOf(body: unknown): string | null {
  if (Array.isArray(body) && body.length && body.every((x) => typeof x === "string") && body.every((x) => /^\d+ /.test(x as string))) return (body as string[]).join("; ");
  // human_errors=true: objects made only of error fields (a data list such as tax exemptions also has "code", but a "name" too).
  const ERR_KEYS = new Set(["code", "field", "description", "message", "value"]);
  if (Array.isArray(body) && body.length && body.every((x) => x && typeof x === "object" && ("description" in x || "message" in x) && Object.keys(x).every((k) => ERR_KEYS.has(k))))
    return (body as { code?: string; description?: string; field?: string }[]).map((e) => [e.code, e.field, e.description].filter(Boolean).join(" ")).join("; ");
  if (body && typeof body === "object" && !Array.isArray(body) && "valid" in body && Number((body as { valid: unknown }).valid) === 0) return "Moloni refused the request (valid: 0).";
  return null;
}

export async function moloniCall<T = unknown>(endpoint: string, data: Record<string, unknown> = {}): Promise<T> {
  const at = await accessToken();
  let res;
  try {
    res = await doFetch(`${base()}/v1/${endpoint}/?${new URLSearchParams({ access_token: at, json: "true", human_errors: "true" })}`, {
      method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(data),
    });
  } catch (e) {
    throw new MoloniError(`Moloni can't be reached: ${e instanceof Error ? e.message : String(e)}`, "UNAVAILABLE");
  }
  if (res.status >= 500 || res.status === 429) throw new MoloniError(`Moloni is unavailable (HTTP ${res.status}).`, "UNAVAILABLE");
  const body = await res.json().catch(() => null);
  if (res.status === 400 || res.status === 401) {
    token = null; // a stale token: sign in again next time
    const b = body as { error?: string; error_description?: string } | null;
    throw new MoloniError(`Moloni refused the call ${endpoint}: ${b?.error_description ?? b?.error ?? `HTTP ${res.status}`}`, "AUTH", body);
  }
  const err = errorOf(body);
  if (err) throw new MoloniError(`Moloni refused ${endpoint}: ${err}`, "VALIDATION", body);
  return body as T;
}
