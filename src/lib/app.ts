/**
 * Installable phone app (Phase 39) — settings and the pure check an offline order goes through
 * when it reaches the server: what changed since the phone saved its prices and stock.
 */
export const APP_PORTALS = ["buy", "vendor", "driver", "admin"] as const;
export type AppPortal = (typeof APP_PORTALS)[number];

export type AppSettings = {
  /** Which portals can be installed and used offline. */
  portals: Record<AppPortal, boolean>;
  /** Offered automatically ("Install FIRINGI" card); people can still install from the browser menu. */
  installPrompt: boolean;
  offlineOrders: {
    /** ASK: the buyer confirms any change; AUTO: placed by itself when prices moved at most maxChangePct (else asked). */
    mode: "ASK" | "AUTO";
    maxChangePct: number;
  };
  /** How much is kept on the phone. */
  snapshot: { products: number; orders: number; invoices: number; documents: number };
  /** Minutes between refreshes of the saved data while online. */
  refreshMinutes: number;
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
  portals: { buy: true, vendor: true, driver: true, admin: true },
  installPrompt: true,
  offlineOrders: { mode: "ASK", maxChangePct: 2 },
  snapshot: { products: 200, orders: 20, invoices: 10, documents: 5 },
  refreshMinutes: 15,
};

export function mergeAppSettings(v: Partial<AppSettings> | null | undefined): AppSettings {
  const d = DEFAULT_APP_SETTINGS;
  const x = v ?? {};
  return { ...d, ...x, portals: { ...d.portals, ...(x.portals ?? {}) }, offlineOrders: { ...d.offlineOrders, ...(x.offlineOrders ?? {}) }, snapshot: { ...d.snapshot, ...(x.snapshot ?? {}) } };
}

export type OfflineLine = { offerId: string; qty: number; seenUnitNet: number; name?: string };
export type CurrentOffer = { offerId: string; name: string; unitNet: number | null; available: number; minQty: number; step: number };
export type OrderCheck = {
  /** Lines that can be ordered now (qty kept), with today's price. */
  ok: { offerId: string; qty: number; unitNet: number }[];
  /** Price differences (net, per unit). pct = change in % of what the buyer saw. */
  changes: { offerId: string; name: string; was: number; now: number; pct: number }[];
  /** Not sold to this buyer any more, no price, or not enough stock (available shown). */
  unavailable: { offerId: string; name: string; qty: number; available: number; why: "GONE" | "NO_PRICE" | "STOCK" | "QTY" }[];
  maxPct: number;
};

/** Compare what the buyer saw offline with today's offers (pure — tested in tests/unit/app.test.ts). */
export function checkOfflineOrder(lines: OfflineLine[], current: CurrentOffer[]): OrderCheck {
  const byId = new Map(current.map((c) => [c.offerId, c]));
  const out: OrderCheck = { ok: [], changes: [], unavailable: [], maxPct: 0 };
  for (const l of lines) {
    const c = byId.get(l.offerId);
    const name = l.name || c?.name || l.offerId; // the name the buyer saw (their language)
    if (!c) { out.unavailable.push({ offerId: l.offerId, name, qty: l.qty, available: 0, why: "GONE" }); continue; }
    if (c.unitNet == null) { out.unavailable.push({ offerId: l.offerId, name, qty: l.qty, available: c.available, why: "NO_PRICE" }); continue; }
    if (l.qty < c.minQty || (c.step > 1 && (l.qty - c.minQty) % c.step !== 0)) { out.unavailable.push({ offerId: l.offerId, name, qty: l.qty, available: c.available, why: "QTY" }); continue; }
    if (c.available < l.qty) { out.unavailable.push({ offerId: l.offerId, name, qty: l.qty, available: Math.max(0, c.available), why: "STOCK" }); continue; }
    out.ok.push({ offerId: l.offerId, qty: l.qty, unitNet: c.unitNet });
    if (Math.abs(c.unitNet - l.seenUnitNet) >= 0.005) {
      const pct = l.seenUnitNet > 0 ? ((c.unitNet - l.seenUnitNet) / l.seenUnitNet) * 100 : 100;
      out.changes.push({ offerId: l.offerId, name, was: l.seenUnitNet, now: c.unitNet, pct: Math.round(pct * 10) / 10 });
      out.maxPct = Math.max(out.maxPct, Math.abs(pct));
    }
  }
  return out;
}

/**
 * Decide what happens to an offline order (admin chooses the mode): place it, or ask the buyer.
 * Unavailable lines always go back to the buyer; `accept` = the buyer already saw and accepted the changes.
 */
export function offlineDecision(check: OrderCheck, s: AppSettings["offlineOrders"], accept: boolean): "PLACE" | "ASK" | "NOTHING" {
  if (!check.ok.length) return accept ? "NOTHING" : "ASK";
  if (accept) return "PLACE";
  if (check.unavailable.length) return "ASK";
  if (!check.changes.length) return "PLACE";
  if (s.mode === "AUTO" && check.maxPct <= s.maxChangePct + 1e-9) return "PLACE";
  return "ASK";
}

/** Offline action kinds (queued on the phone, carried out once on the server). */
export const OFFLINE_KINDS = ["order.place", "delivery.step", "delivery.complete", "delivery.fail", "pick.scan", "pick.confirm", "pick.short"] as const;
export type OfflineKind = (typeof OFFLINE_KINDS)[number];
export const KIND_PORTAL: Record<OfflineKind, AppPortal> = {
  "order.place": "buy", "delivery.step": "driver", "delivery.complete": "driver", "delivery.fail": "driver", "pick.scan": "vendor", "pick.confirm": "vendor", "pick.short": "vendor",
};
