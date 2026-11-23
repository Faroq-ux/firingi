/** Consignment stock (Phase 65) — pure rules shared by the server and the pages. Docs: docs/consignment.md. */

/** who places stock with whom: a distributor with a wholesaler, a wholesaler with a shop / restaurant */
export const CONSIGNMENT_CHANNELS = ["DISTRIBUTOR_WHOLESALER", "WHOLESALER_CUSTOMER"] as const;
export type ConsignmentChannel = (typeof CONSIGNMENT_CHANNELS)[number];
export const channelOf = (vendorType: string): ConsignmentChannel => (vendorType === "DISTRIBUTOR" ? "DISTRIBUTOR_WHOLESALER" : "WHOLESALER_CUSTOMER");
/** the kind of company a supplier places consignment stock with */
export const buyerTypeFor = (vendorType: string) => (vendorType === "DISTRIBUTOR" ? "WHOLESALER" : "CUSTOMER");

export type ConsignmentSettings = {
  enabled: boolean;
  /** FIRINGI switches each channel on or off */
  channels: Record<ConsignmentChannel, boolean>;
  /** each new consignment waits for FIRINGI's approval before stock can be sent */
  requireApproval: boolean;
  /** the customer may count its own consignment stock */
  allowCustomerCount: boolean;
  /** a count nobody answered is confirmed (and billed) after this many days */
  autoConfirmDays: number;
  /** alert the supplier when goods at a customer expire within this many days */
  expiryAlertDays: number;
  /** default count interval for new sites (days) */
  defaultCountEveryDays: number;
  /** suppliers FIRINGI switched consignment off for */
  disabledVendors: string[];
};

export const DEFAULT_CONSIGNMENT_SETTINGS: ConsignmentSettings = {
  enabled: true, channels: { DISTRIBUTOR_WHOLESALER: true, WHOLESALER_CUSTOMER: true }, requireApproval: true, allowCustomerCount: true, autoConfirmDays: 3, expiryAlertDays: 14, defaultCountEveryDays: 7, disabledVendors: [],
};

const int = (x: unknown, lo: number, hi: number, def: number) => { const n = Math.round(Number(x)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def; };

export function mergeConsignmentSettings(v: Partial<ConsignmentSettings> | null | undefined): ConsignmentSettings {
  const d = DEFAULT_CONSIGNMENT_SETTINGS;
  if (!v || typeof v !== "object") return { ...d, channels: { ...d.channels }, disabledVendors: [] };
  const ch = (v.channels ?? {}) as Partial<Record<ConsignmentChannel, unknown>>;
  return {
    enabled: typeof v.enabled === "boolean" ? v.enabled : d.enabled,
    channels: Object.fromEntries(CONSIGNMENT_CHANNELS.map((k) => [k, typeof ch[k] === "boolean" ? (ch[k] as boolean) : d.channels[k]])) as Record<ConsignmentChannel, boolean>,
    requireApproval: typeof v.requireApproval === "boolean" ? v.requireApproval : d.requireApproval,
    allowCustomerCount: typeof v.allowCustomerCount === "boolean" ? v.allowCustomerCount : d.allowCustomerCount,
    autoConfirmDays: int(v.autoConfirmDays, 1, 30, d.autoConfirmDays),
    expiryAlertDays: int(v.expiryAlertDays, 1, 90, d.expiryAlertDays),
    defaultCountEveryDays: int(v.defaultCountEveryDays, 1, 90, d.defaultCountEveryDays),
    disabledVendors: Array.isArray(v.disabledVendors) ? [...new Set(v.disabledVendors.filter((x): x is string => typeof x === "string" && x.length > 0))].slice(0, 5000) : [],
  };
}

/** consignment allowed for this supplier: on, its channel on, not switched off for it */
export const consignmentAllowed = (s: ConsignmentSettings, vendor: { id: string; type: string }) =>
  s.enabled && s.channels[channelOf(vendor.type)] && !s.disabledVendors.includes(vendor.id);

export type CLot = { id: string; offerId: string; expiresOn: Date | string | null; qtySent: number; qtyShort: number; qtyUsed: number; qtyReturned: number; received: boolean };

/** On the customer's shelf: received, less used and returned (goods still on the way don't count). */
export const onShelf = (l: CLot) => (l.received ? Math.max(0, l.qtySent - l.qtyShort - l.qtyUsed - l.qtyReturned) : 0);

const time = (d: Date | string | null) => (d ? new Date(d).getTime() : Infinity);

/** Per offer: on the shelf now. */
export function shelfByOffer(lots: CLot[]) {
  const m = new Map<string, number>();
  for (const l of lots) m.set(l.offerId, (m.get(l.offerId) ?? 0) + onShelf(l));
  return m;
}

/**
 * Take `qty` of an offer off the shelf. Used goods: first to expire first (that's what a shop sells first);
 * returned goods: latest to expire first (the freshest go back). Null when there isn't enough.
 */
export function takeLots(lots: CLot[], offerId: string, qty: number, order: "FEFO" | "LATEST" = "FEFO") {
  if (!Number.isInteger(qty) || qty < 0) return null;
  if (qty === 0) return [];
  const usable = lots.filter((l) => l.offerId === offerId && onShelf(l) > 0)
    .sort((a, b) => (order === "FEFO" ? time(a.expiresOn) - time(b.expiresOn) : time(b.expiresOn) - time(a.expiresOn)) || a.id.localeCompare(b.id));
  const out: { lotId: string; qty: number }[] = [];
  let need = qty;
  for (const l of usable) {
    if (!need) break;
    const t = Math.min(need, onShelf(l));
    out.push({ lotId: l.id, qty: t });
    need -= t;
  }
  return need ? null : out;
}

export type CountLine = { offerId: string; expected: number; counted: number; used: number };

/**
 * A count: what is on the shelf now per offer. Used = expected − counted. A count above what is expected is refused
 * (more than was placed — count again); a product not counted counts as 0 left (all used).
 */
export function countLines(expected: Map<string, number>, counted: Record<string, number>): { lines: CountLine[]; error: string | null } {
  const lines: CountLine[] = [];
  for (const [offerId, exp] of expected) {
    if (exp <= 0) continue;
    const raw = counted[offerId];
    const c = raw == null || raw === ("" as unknown) ? 0 : Math.floor(Number(raw));
    if (!Number.isFinite(c) || c < 0) return { lines: [], error: "Counts must be whole numbers, 0 or more." };
    if (c > exp) return { lines: [], error: "A count is higher than what is placed. Count again." };
    lines.push({ offerId, expected: exp, counted: c, used: exp - c });
  }
  return { lines, error: null };
}

/** When the next count is due (null = never counted → due from the site's start). */
export function nextCountDue(lastCountAt: Date | null, createdAt: Date, everyDays: number) {
  return new Date((lastCountAt ?? createdAt).getTime() + everyDays * 86400_000);
}

/** Who must confirm a count: the side that didn't count. */
export const confirmer = (countedByCompanyId: string, site: { vendorCompanyId: string; buyerCompanyId: string }) =>
  countedByCompanyId === site.vendorCompanyId ? site.buyerCompanyId : site.vendorCompanyId;
