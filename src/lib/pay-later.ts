/**
 * Pay later (Phase 50) — pure rules: FIRINGI's terms and switches, the fee and who pays it, the payment schedule.
 * PARTNER = a payment gateway's / financing partner's "buy now, pay later" (it pays FIRINGI at once and collects);
 * OWN = FIRINGI's own credit (FIRINGI waits for the buyer's payments).
 */
export type FeePayer = "BUYER" | "FIRINGI" | "SHARED";
export type PayLaterTerm = {
  id: string;
  kind: "DAYS" | "INSTALMENTS";
  /** DAYS: pay the whole amount after this many days */
  days: number;
  /** INSTALMENTS: this many monthly payments (the first one month after the invoice) */
  count: number;
  enabled: boolean;
  /** the fee: % of the order's gross + a fixed amount */
  feePct: number;
  feeFixed: number;
  feePayer: FeePayer;
  /** SHARED: the buyer's share of the fee, % */
  buyerSharePct: number;
};
export type CountryPayLater = { partner: boolean; own: boolean; first: "PARTNER" | "OWN" };
export type PayLaterSettings = {
  enabled: boolean;
  buyers: { CUSTOMER: boolean; WHOLESALER: boolean };
  terms: PayLaterTerm[];
  /** per country (ISO code); a country not listed uses `defaults` */
  countries: Record<string, CountryPayLater>;
  defaults: CountryPayLater;
  /** FIRINGI's own credit: default limit per buyer type (€, gross), smallest order */
  ownLimit: { CUSTOMER: number; WHOLESALER: number };
  minOrder: number;
  /** remind the buyer this many days before an instalment is due */
  remindDays: number;
};

const T = (id: string, kind: PayLaterTerm["kind"], n: number, enabled: boolean, feePct: number): PayLaterTerm =>
  ({ id, kind, days: kind === "DAYS" ? n : 0, count: kind === "INSTALMENTS" ? n : 0, enabled, feePct, feeFixed: 0, feePayer: "BUYER", buyerSharePct: 50 });

export const DEFAULT_PAY_LATER: PayLaterSettings = {
  enabled: true,
  buyers: { CUSTOMER: true, WHOLESALER: true },
  terms: [T("d14", "DAYS", 14, false, 0.5), T("d30", "DAYS", 30, true, 1), T("d45", "DAYS", 45, false, 1.5), T("d60", "DAYS", 60, true, 2), T("d90", "DAYS", 90, true, 3), T("i3", "INSTALMENTS", 3, true, 2.5), T("i6", "INSTALMENTS", 6, false, 4)],
  countries: {},
  defaults: { partner: true, own: true, first: "PARTNER" },
  ownLimit: { CUSTOMER: 2000, WHOLESALER: 10000 },
  minOrder: 50,
  remindDays: 3,
};

export function mergePayLater(v: Partial<PayLaterSettings> | null | undefined): PayLaterSettings {
  const d = DEFAULT_PAY_LATER, x = v ?? {};
  return { ...d, ...x, buyers: { ...d.buyers, ...(x.buyers ?? {}) }, defaults: { ...d.defaults, ...(x.defaults ?? {}) }, ownLimit: { ...d.ownLimit, ...(x.ownLimit ?? {}) }, countries: { ...(x.countries ?? {}) }, terms: x.terms?.length ? x.terms : d.terms };
}

export function cleanPayLater(i: PayLaterSettings): PayLaterSettings {
  const num = (v: unknown, lo: number, hi: number, label: string) => { const n = Number(v); if (!Number.isFinite(n) || n < lo || n > hi) throw new Error(`${label} must be between ${lo} and ${hi}.`); return n; };
  const model = (c: CountryPayLater): CountryPayLater => ({ partner: !!c?.partner, own: !!c?.own, first: c?.first === "OWN" ? "OWN" : "PARTNER" });
  const ids = new Set<string>();
  const terms = (i.terms ?? []).map((t, k) => {
    const kind = t.kind === "INSTALMENTS" ? "INSTALMENTS" : "DAYS";
    const id = String(t.id || `t${k}`).replace(/[^a-z0-9_-]/gi, "").slice(0, 20) || `t${k}`;
    if (ids.has(id)) throw new Error("Each term needs its own id."); ids.add(id);
    return {
      id, kind, enabled: !!t.enabled,
      days: kind === "DAYS" ? Math.round(num(t.days, 7, 365, "Days")) : 0,
      count: kind === "INSTALMENTS" ? Math.round(num(t.count, 2, 12, "Instalments")) : 0,
      feePct: num(t.feePct ?? 0, 0, 20, "Fee %"), feeFixed: num(t.feeFixed ?? 0, 0, 1000, "Fixed fee"),
      feePayer: (["BUYER", "FIRINGI", "SHARED"] as const).includes(t.feePayer) ? t.feePayer : "BUYER",
      buyerSharePct: num(t.buyerSharePct ?? 50, 0, 100, "Buyer's share"),
    } satisfies PayLaterTerm;
  });
  if (!terms.length) throw new Error("Keep at least one term (it can be switched off).");
  return {
    enabled: !!i.enabled, buyers: { CUSTOMER: !!i.buyers?.CUSTOMER, WHOLESALER: !!i.buyers?.WHOLESALER }, terms,
    countries: Object.fromEntries(Object.entries(i.countries ?? {}).filter(([k]) => /^[A-Z]{2}$/.test(k)).map(([k, c]) => [k, model(c)])),
    defaults: model(i.defaults), ownLimit: { CUSTOMER: num(i.ownLimit?.CUSTOMER, 0, 1e7, "Own credit limit"), WHOLESALER: num(i.ownLimit?.WHOLESALER, 0, 1e7, "Own credit limit") },
    minOrder: num(i.minOrder, 0, 1e6, "Smallest order"), remindDays: Math.round(num(i.remindDays, 0, 30, "Reminder days")),
  };
}

export const countryModels = (s: PayLaterSettings, country: string): CountryPayLater => s.countries[country] ?? s.defaults;

/** Which models to try, in order, for a country. */
export function modelOrder(c: CountryPayLater): ("PARTNER" | "OWN")[] {
  const all = c.first === "OWN" ? (["OWN", "PARTNER"] as const) : (["PARTNER", "OWN"] as const);
  return all.filter((m) => (m === "PARTNER" ? c.partner : c.own));
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** The fee on an order and how it's split between the buyer and FIRINGI. */
export function feeFor(t: Pick<PayLaterTerm, "feePct" | "feeFixed" | "feePayer" | "buyerSharePct">, gross: number) {
  const total = r2(Math.max(0, gross) * (t.feePct / 100) + (gross > 0 ? t.feeFixed : 0));
  const buyer = t.feePayer === "BUYER" ? total : t.feePayer === "FIRINGI" ? 0 : r2(total * (t.buyerSharePct / 100));
  return { total, buyer, firingi: r2(total - buyer) };
}

const addMonths = (d: Date, n: number) => { const x = new Date(d); const day = x.getUTCDate(); x.setUTCDate(1); x.setUTCMonth(x.getUTCMonth() + n); const last = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate(); x.setUTCDate(Math.min(day, last)); return x; };

/** When the buyer pays what: one payment after N days, or monthly instalments (cents spread, the last takes the rest). */
export function schedule(t: Pick<PayLaterTerm, "kind" | "days" | "count">, from: Date, amount: number) {
  if (t.kind === "DAYS") return [{ n: 1, dueAt: new Date(from.getTime() + t.days * 86_400_000), amount: r2(amount) }];
  const cents = Math.round(amount * 100), each = Math.floor(cents / t.count);
  return Array.from({ length: t.count }, (_, k) => ({ n: k + 1, dueAt: addMonths(from, k + 1), amount: (k === t.count - 1 ? cents - each * (t.count - 1) : each) / 100 }));
}

/** Days from the invoice to the last payment (the invoice's due date). */
export const lastDueDays = (t: Pick<PayLaterTerm, "kind" | "days" | "count">, from: Date) => Math.round((schedule(t, from, 1).at(-1)!.dueAt.getTime() - from.getTime()) / 86_400_000);
