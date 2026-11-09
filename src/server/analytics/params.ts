/** Turn page search params into engine filters, and fill gaps in time series. */
import type { Ctx } from "@/server/context";
import { analyticsScope, grainFor, periodFrom, type Audience, type Basis, type Filters, type Row } from "./engine";

export type SearchParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export type Query = { filters: Filters; preset: string; grain: "day" | "week" | "month"; params: Record<string, string> };

export async function readQuery(ctx: Ctx, audience: Audience, sp: SearchParams, defaults: { basis?: Basis } = {}): Promise<Query> {
  const { from, to, preset } = periodFrom(one(sp.period), one(sp.from), one(sp.to));
  const basis: Basis = one(sp.basis) === "delivered" ? "delivered" : one(sp.basis) === "placed" ? "placed" : (defaults.basis ?? "placed");
  const scope = await analyticsScope(ctx, audience);
  const type = one(sp.type);
  const filters: Filters = {
    from, to, basis,
    countryId: audience === "ADMIN" ? one(sp.country) ?? null : null,
    sellerType: audience === "ADMIN" && (type === "WHOLESALER" || type === "DISTRIBUTOR") ? type : null,
    categoryId: one(sp.category) ?? null,
    ...scope, // fixed scope always wins over user input
  };
  const params: Record<string, string> = {};
  for (const k of ["period", "from", "to", "basis", "country", "type", "category"]) { const v = one(sp[k]); if (v) params[k] = v; }
  return { filters, preset, grain: grainFor(from, to), params };
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** Every period start between from and to (UTC), as YYYY-MM-DD. Weeks start on Monday. */
export function periodKeys(from: Date, to: Date, grain: "day" | "week" | "month"): string[] {
  const out: string[] = [];
  let d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), grain === "month" ? 1 : from.getUTCDate()));
  if (grain === "week") d = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86400_000);
  while (d < to) {
    out.push(isoDay(d));
    d = grain === "month" ? new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)) : new Date(d.getTime() + (grain === "week" ? 7 : 1) * 86400_000);
  }
  return out;
}

/** Rows keyed by a time dimension → one value array per metric, zero-filled. */
export function fillSeries(rows: Row[], dim: "day" | "week" | "month", from: Date, to: Date, metrics: string[]) {
  const points = periodKeys(from, to, dim);
  const at = new Map(rows.map((r) => [String(r.keys[dim]).slice(0, 10), r.values]));
  return { points, values: Object.fromEntries(metrics.map((m) => [m, points.map((p) => at.get(p)?.[m] ?? 0)])) as Record<string, number[]> };
}

export const qs = (params: Record<string, string>, extra: Record<string, string | undefined> = {}) => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...params, ...extra })) if (v) u.set(k, v);
  const s = u.toString();
  return s ? `?${s}` : "";
};
