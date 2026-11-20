/**
 * Phase 55 — rewards shop: pure rules (settings, who may redeem what, stock, goals, partner code lists, voucher
 * value checks). No database; unit-tested.
 */

export const REWARD_KINDS = ["VOUCHER", "FREE_DELIVERY", "SUPPLIER_PRODUCT", "GIFT", "PARTNER"] as const;
export const REWARD_BUYER_TYPES = ["CUSTOMER", "WHOLESALER"] as const;
export const REWARD_SUPPLIER_TYPES = ["DISTRIBUTOR", "WHOLESALER"] as const;
export const REWARD_TIERS = ["BRONZE", "SILVER", "GOLD"] as const;

export type RewardKindT = (typeof REWARD_KINDS)[number];
export type RewardBuyerType = (typeof REWARD_BUYER_TYPES)[number];
export type RewardSupplierType = (typeof REWARD_SUPPLIER_TYPES)[number];
export type RewardTier = (typeof REWARD_TIERS)[number];

export type RewardsSettings = {
  enabled: boolean;
  /** Which kinds of reward are in the shop. */
  kinds: Record<RewardKindT, boolean>;
  /** Buyer types that may redeem. */
  buyerTypes: Record<RewardBuyerType, boolean>;
  /** Supplier types that may offer their own products as rewards. */
  supplierTypes: Record<RewardSupplierType, boolean>;
  /** Supplier rewards wait for FIRINGI's approval before they are in the shop. */
  supplierApproval: boolean;
  /** Fewest / most points a supplier may ask for its product. */
  supplierMinPoints: number;
  supplierMaxPoints: number;
  /** A supplier product must be ordered within this many days, or it expires (points back). */
  handoverDays: number;
  /** Default days a voucher / free delivery coupon is valid. */
  voucherDays: number;
  /** Points back for vouchers and free deliveries that expire unused. */
  refundExpired: boolean;
  /** Buyers may cancel an unused voucher, or a gift / supplier product not yet on its way (points back). */
  buyerCancel: boolean;
  /** Tell the buyer this many days before a voucher expires. */
  reminderDays: number;
  /** Tell FIRINGI / the supplier when stock falls to this. */
  lowStock: number;
  /** At most this many points per business per calendar month in the shop (0 = no limit). */
  monthlyLimit: number;
};

export const DEFAULT_REWARDS_SETTINGS: RewardsSettings = {
  enabled: true,
  kinds: { VOUCHER: true, FREE_DELIVERY: true, SUPPLIER_PRODUCT: true, GIFT: true, PARTNER: true },
  buyerTypes: { CUSTOMER: true, WHOLESALER: true },
  supplierTypes: { DISTRIBUTOR: true, WHOLESALER: true },
  supplierApproval: true,
  supplierMinPoints: 100,
  supplierMaxPoints: 100_000,
  handoverDays: 90,
  voucherDays: 60,
  refundExpired: true,
  buyerCancel: true,
  reminderDays: 7,
  lowStock: 5,
  monthlyLimit: 0,
};

const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const flags = <K extends string>(keys: readonly K[], v: unknown, d: Record<K, boolean>) =>
  Object.fromEntries(keys.map((k) => [k, bool((v as Record<string, unknown> | null)?.[k], d[k])])) as Record<K, boolean>;

export function mergeRewardsSettings(v: Partial<RewardsSettings> | null | undefined): RewardsSettings {
  const d = DEFAULT_REWARDS_SETTINGS, x = (v ?? {}) as Partial<RewardsSettings>;
  return {
    enabled: bool(x.enabled, d.enabled),
    kinds: flags(REWARD_KINDS, x.kinds, d.kinds), buyerTypes: flags(REWARD_BUYER_TYPES, x.buyerTypes, d.buyerTypes), supplierTypes: flags(REWARD_SUPPLIER_TYPES, x.supplierTypes, d.supplierTypes),
    supplierApproval: bool(x.supplierApproval, d.supplierApproval),
    supplierMinPoints: num(x.supplierMinPoints, d.supplierMinPoints), supplierMaxPoints: num(x.supplierMaxPoints, d.supplierMaxPoints),
    handoverDays: num(x.handoverDays, d.handoverDays), voucherDays: num(x.voucherDays, d.voucherDays),
    refundExpired: bool(x.refundExpired, d.refundExpired), buyerCancel: bool(x.buyerCancel, d.buyerCancel),
    reminderDays: num(x.reminderDays, d.reminderDays), lowStock: num(x.lowStock, d.lowStock), monthlyLimit: num(x.monthlyLimit, d.monthlyLimit),
  };
}

export function cleanRewardsSettings(v: RewardsSettings): RewardsSettings {
  const s = mergeRewardsSettings(v);
  const range = (n: number, lo: number, hi: number, label: string) => { if (!Number.isInteger(n) || n < lo || n > hi) throw new Error(`${label}: ${lo} to ${hi}.`); };
  range(s.supplierMinPoints, 1, 1_000_000, "Supplier rewards: fewest points");
  range(s.supplierMaxPoints, 1, 1_000_000, "Supplier rewards: most points");
  if (s.supplierMaxPoints < s.supplierMinPoints) throw new Error("Supplier rewards: the most points must be at least the fewest.");
  range(s.handoverDays, 7, 365, "Days to order a supplier product");
  range(s.voucherDays, 1, 365, "Days a voucher is valid");
  range(s.reminderDays, 1, 30, "Voucher reminder (days before)");
  range(s.lowStock, 0, 1000, "Low stock alert");
  range(s.monthlyLimit, 0, 10_000_000, "Monthly points limit");
  return s;
}

// ── who may redeem ──────────────────────────────────────────────────────────

export const tierRank = (t: string | null | undefined) => Math.max(0, REWARD_TIERS.indexOf((t ?? "BRONZE") as RewardTier));

export type RewardLite = {
  kind: RewardKindT; status: string; points: number; stock: number | null; perBuyerLimit: number | null; minTier: string | null;
  buyerTypes: string[]; countryCodes: string[]; validFrom: Date; validTo: Date | null;
};
export type BuyerLite = { type: string; countryCode: string; tier: string; balance: number; spentThisMonth: number };

/** Why a buyer can't redeem (first reason only), or null when it can. */
export type Blocked = "KIND_OFF" | "NOT_ACTIVE" | "NOT_YET" | "ENDED" | "TYPE" | "COUNTRY" | "TIER" | "LIMIT" | "SOLD_OUT" | "MONTHLY" | "POINTS";

export function blockedReason(r: RewardLite, b: BuyerLite, opts: { settings: RewardsSettings; usedByBuyer: number; now?: Date }): Blocked | null {
  const now = opts.now ?? new Date();
  if (!opts.settings.kinds[r.kind]) return "KIND_OFF";
  if (r.status !== "ACTIVE") return "NOT_ACTIVE";
  if (r.validFrom > now) return "NOT_YET";
  if (r.validTo && r.validTo <= now) return "ENDED";
  if (r.buyerTypes.length && !r.buyerTypes.includes(b.type)) return "TYPE";
  if (r.countryCodes.length && !r.countryCodes.includes(b.countryCode)) return "COUNTRY";
  if (r.minTier && tierRank(b.tier) < tierRank(r.minTier)) return "TIER";
  if (r.perBuyerLimit != null && opts.usedByBuyer >= r.perBuyerLimit) return "LIMIT";
  if (r.stock != null && r.stock <= 0) return "SOLD_OUT";
  if (opts.settings.monthlyLimit > 0 && b.spentThisMonth + r.points > opts.settings.monthlyLimit) return "MONTHLY";
  if (b.balance < r.points) return "POINTS";
  return null;
}

/** Progress towards the reward the business is saving for. */
export function goalProgress(balance: number, points: number) {
  if (points <= 0) return { pct: 100, missing: 0 };
  return { pct: Math.min(100, Math.floor((Math.max(0, balance) / points) * 100)), missing: Math.max(0, points - balance) };
}

// ── vouchers ────────────────────────────────────────────────────────────────

/** What the points would be worth as a checkout discount — FIRINGI's hint when a voucher costs too few points. */
export function voucherCheck(points: number, amount: number, pointValue: number) {
  const worth = Math.round(points * pointValue * 100) / 100;
  return { worth, generous: amount > worth, ratio: worth > 0 ? Math.round((amount / worth) * 100) / 100 : null };
}

/** A coupon code made for one redemption: RW- and 8 letters / digits without look-alikes. */
export function rewardCode(random: () => number = Math.random) {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 8; i++) s += abc[Math.floor(random() * abc.length) % abc.length];
  return `RW-${s}`;
}

/** Where a voucher stands: used on a live order, still open, or expired. */
export function voucherState(v: { expiresAt: Date | null; usedOnLiveOrder: boolean }, now = new Date()): "USED" | "ISSUED" | "EXPIRED" {
  if (v.usedOnLiveOrder) return "USED";
  if (v.expiresAt && v.expiresAt <= now) return "EXPIRED";
  return "ISSUED";
}

// ── partner codes ───────────────────────────────────────────────────────────

/** Codes pasted one per line (or separated by commas / semicolons): trimmed, de-duplicated, 3–64 characters. */
export function parseCodes(text: string) {
  const seen = new Set<string>();
  const codes: string[] = [], bad: string[] = [];
  for (const raw of text.split(/[\r\n,;\t]+/)) {
    const c = raw.trim();
    if (!c) continue;
    if (c.length < 3 || c.length > 64 || /\s/.test(c)) { bad.push(c); continue; }
    if (seen.has(c)) continue;
    seen.add(c);
    codes.push(c);
  }
  return { codes, bad };
}

// ── statuses ────────────────────────────────────────────────────────────────

/** Statuses where the buyer may still cancel (when FIRINGI allows it). */
export function buyerMayCancel(kind: RewardKindT, status: string, usedQty = 0) {
  if (kind === "VOUCHER" || kind === "FREE_DELIVERY") return status === "ISSUED";
  if (kind === "SUPPLIER_PRODUCT") return status === "PENDING" && usedQty === 0;
  if (kind === "GIFT") return status === "PENDING";
  return false; // a partner code is shown at once
}

/** Statuses that are finished (no more changes). */
export const FINAL_STATUSES = ["DELIVERED", "USED", "CANCELLED", "EXPIRED"] as const;
export const isFinal = (s: string) => (FINAL_STATUSES as readonly string[]).includes(s);
