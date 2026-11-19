/** Turn page search params into engine filters, and fill gaps in time series. */
import type { Ctx } from "@/server/context";
import { analyticsScope, grainFor, periodFrom, type Audience, type Basis, type Filters, type Row } from "./engine";
import { currencySettings, reportFx, viewerFx } from "@/server/currency/service";
import type { Fmt } from "@/lib/analytics-format";

export type SearchParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export type Query = { filters: Filters; preset: string; grain: "day" | "week" | "month"; params: Record<string, string>; money: Fmt; currency: string; switchable: boolean };

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
  // Phase 45: money in the viewer's currency (customers / suppliers at each order's locked rate); FIRINGI: EUR or the switch
  const fx = audience === "ADMIN" ? await reportFx(one(sp.ccy)) : await viewerFx(ctx, audience === "VENDOR" ? "SUPPLIER" : "BUYER");
  if (fx.code !== "EUR") filters.fx = { code: fx.code, rate: Number(audience === "BUYER" ? fx.rate : fx.mid), col: audience === "ADMIN" ? undefined : audience === "VENDOR" ? "vendorRate" : "eurRate" };
  const params: Record<string, string> = {};
  for (const k of ["period", "from", "to", "basis", "country", "type", "category", "ccy"]) { const v = one(sp[k]); if (v) params[k] = v; }
  const switchable = audience === "ADMIN" && (await currencySettings()).reportSwitch;
  return { filters, preset, grain: grainFor(from, to), params, money: fx.code === "EUR" ? "money" : (`money:${fx.code}` as Fmt), currency: fx.code, switchable };
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
