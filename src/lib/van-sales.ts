/** Van sales (Phase 63) — pure rules shared by the server, the phone app and the pages. Docs: docs/van-sales.md. */

export const VAN_METHODS = ["CASH", "CARD", "MB_WAY", "ON_ACCOUNT"] as const;
export type VanMethod = (typeof VAN_METHODS)[number];

export type VanSalesSettings = {
  enabled: boolean;
  /** payment methods the seller may take */
  methods: Record<VanMethod, boolean>;
  /** largest cash payment for one sale (€); 0 = no limit */
  maxCashPerSale: number;
  /** the customer signs on the phone for every sale */
  requireSignature: boolean;
  /** the seller may take empties back at a sale */
  allowEmpties: boolean;
  /** sales may be made without signal and sent later */
  allowOffline: boolean;
  /** cash difference at the end of the day (€) above which FIRINGI and the supplier are told */
  varianceAlert: number;
  /** a van still out after this many hours is flagged */
  maxRoundHours: number;
  /** suppliers FIRINGI switched van sales off for */
  disabledVendors: string[];
};

export const DEFAULT_VAN_SALES_SETTINGS: VanSalesSettings = {
  enabled: true,
  methods: { CASH: true, CARD: true, MB_WAY: true, ON_ACCOUNT: true },
  maxCashPerSale: 1000,
  requireSignature: true,
  allowEmpties: true,
  allowOffline: true,
  varianceAlert: 5,
  maxRoundHours: 16,
  disabledVendors: [],
};

const num = (x: unknown, lo: number, hi: number, def: number) => {
  const n = Number(x);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n * 100) / 100)) : def;
};

export function mergeVanSalesSettings(v: Partial<VanSalesSettings> | null | undefined): VanSalesSettings {
  const d = DEFAULT_VAN_SALES_SETTINGS;
  if (!v || typeof v !== "object") return { ...d, methods: { ...d.methods }, disabledVendors: [] };
  const m = (v.methods ?? {}) as Partial<Record<VanMethod, boolean>>;
  const methods = Object.fromEntries(VAN_METHODS.map((k) => [k, typeof m[k] === "boolean" ? m[k]! : d.methods[k]])) as Record<VanMethod, boolean>;
  return {
    enabled: typeof v.enabled === "boolean" ? v.enabled : d.enabled,
    methods,
    maxCashPerSale: num(v.maxCashPerSale, 0, 100_000, d.maxCashPerSale),
    requireSignature: typeof v.requireSignature === "boolean" ? v.requireSignature : d.requireSignature,
    allowEmpties: typeof v.allowEmpties === "boolean" ? v.allowEmpties : d.allowEmpties,
    allowOffline: typeof v.allowOffline === "boolean" ? v.allowOffline : d.allowOffline,
    varianceAlert: num(v.varianceAlert, 0, 10_000, d.varianceAlert),
    maxRoundHours: Math.round(num(v.maxRoundHours, 1, 72, d.maxRoundHours)),
    disabledVendors: Array.isArray(v.disabledVendors) ? [...new Set(v.disabledVendors.filter((x): x is string => typeof x === "string" && x.length > 0))].slice(0, 5000) : [],
  };
}

export type LotRow = { id: string; offerId: string; expiresOn: Date | string | null; qtyLoaded: number; qtySold: number; qtyBack: number; qtyLost: number; blocked?: boolean };

/** What is still on the van for a lot. */
export const lotLeft = (l: Pick<LotRow, "qtyLoaded" | "qtySold" | "qtyBack" | "qtyLost">) => Math.max(0, l.qtyLoaded - l.qtySold - l.qtyBack - l.qtyLost);

const time = (d: Date | string | null) => (d ? new Date(d).getTime() : Infinity);

/**
 * Take `qty` of an offer from the van's lots, first to expire first (no date last). Blocked (recalled) lots
 * and lots past their date are never sold. Returns null when there isn't enough.
 */
export function takeFromLots(lots: LotRow[], offerId: string, qty: number, today = new Date()): { lotId: string; qty: number }[] | null {
  if (!Number.isInteger(qty) || qty <= 0) return null;
  const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const usable = lots
    .filter((l) => l.offerId === offerId && !l.blocked && lotLeft(l) > 0 && time(l.expiresOn) >= start)
    .sort((a, b) => time(a.expiresOn) - time(b.expiresOn) || a.id.localeCompare(b.id));
  const out: { lotId: string; qty: number }[] = [];
  let need = qty;
  for (const l of usable) {
    if (!need) break;
    const t = Math.min(need, lotLeft(l));
    out.push({ lotId: l.id, qty: t });
    need -= t;
  }
  return need ? null : out;
}

/** Sellable units left per offer (not blocked, not past the date). */
export function sellable(lots: LotRow[], today = new Date()) {
  const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const m = new Map<string, number>();
  for (const l of lots) if (!l.blocked && time(l.expiresOn) >= start) m.set(l.offerId, (m.get(l.offerId) ?? 0) + lotLeft(l));
  return m;
}

/**
 * At the end of the day: the seller counts what comes back per offer. Units back are spread over the lots
 * still on the van, latest-to-expire first (those are the ones left after selling first-to-expire first);
 * the rest of each lot is missing.
 */
export function splitReturn(lots: LotRow[], counted: Record<string, number>) {
  const res = new Map<string, { back: number; lost: number }>();
  const byOffer = new Map<string, LotRow[]>();
  for (const l of lots) byOffer.set(l.offerId, [...(byOffer.get(l.offerId) ?? []), l]);
  for (const [offerId, ls] of byOffer) {
    const left = ls.reduce((a, l) => a + lotLeft(l), 0);
    let back = Math.max(0, Math.min(left, Math.floor(Number(counted[offerId] ?? 0)) || 0));
    for (const l of [...ls].sort((a, b) => time(b.expiresOn) - time(a.expiresOn) || b.id.localeCompare(a.id))) {
      const here = lotLeft(l);
      const b = Math.min(back, here);
      back -= b;
      res.set(l.id, { back: b, lost: here - b });
    }
  }
  return res;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Cash counted against expected: positive = more cash than sales, negative = cash missing. */
export const cashVariance = (expected: number, counted: number) => r2(counted - expected);

/** Change to give back for a cash sale (never negative). */
export const changeDue = (total: number, given: number) => Math.max(0, r2(given - total));

/** Estimated gross for a sale on the phone (offline): Σ qty × net × (1 + vat%). The invoice is exact. */
export function estimateGross(lines: { qty: number; unitNet: number; vatPct: number }[]) {
  const net = r2(lines.reduce((a, l) => a + l.qty * l.unitNet, 0));
  const vat = r2(lines.reduce((a, l) => a + r2(l.qty * l.unitNet * (l.vatPct / 100)), 0));
  return { net, vat, gross: r2(net + vat) };
}
