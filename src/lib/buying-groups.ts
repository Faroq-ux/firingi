/**
 * Buying groups (Phase 49) — pure rules: FIRINGI's switches and how a pooled bonus is shared between members.
 * Members are businesses (wholesale customers, and wholesalers buying from distributors).
 */
export const GROUP_FEATURES = ["pooledRebates", "groupPrices", "reports", "groupOrders"] as const;
export type GroupFeature = (typeof GROUP_FEATURES)[number];

export type GroupSettings = {
  enabled: boolean;
  /** which business types may join groups */
  members: { CUSTOMER: boolean; WHOLESALER: boolean };
  /** which business types may start groups */
  creators: { CUSTOMER: boolean; WHOLESALER: boolean };
  /** ALWAYS = FIRINGI checks every new group; AUTO = groups start at once */
  approval: "ALWAYS" | "AUTO";
  features: Record<GroupFeature, boolean>;
  /** businesses may find open groups and ask to join */
  joinRequests: boolean;
  /** a business may belong to more than one group */
  multipleGroups: boolean;
  maxMembers: number;
  /** a group order round may stay open at most this many days */
  roundMaxDays: number;
};

export const DEFAULT_GROUP_SETTINGS: GroupSettings = {
  enabled: true,
  members: { CUSTOMER: true, WHOLESALER: true },
  creators: { CUSTOMER: true, WHOLESALER: true },
  approval: "ALWAYS",
  features: { pooledRebates: true, groupPrices: true, reports: true, groupOrders: true },
  joinRequests: true,
  multipleGroups: true,
  maxMembers: 50,
  roundMaxDays: 14,
};

export function mergeGroupSettings(v: Partial<GroupSettings> | null | undefined): GroupSettings {
  const d = DEFAULT_GROUP_SETTINGS, x = v ?? {};
  return { ...d, ...x, members: { ...d.members, ...(x.members ?? {}) }, creators: { ...d.creators, ...(x.creators ?? {}) }, features: { ...d.features, ...(x.features ?? {}) } };
}

export function cleanGroupSettings(i: GroupSettings): GroupSettings {
  const n = (x: unknown, lo: number, hi: number, label: string) => { const v = Math.round(Number(x)); if (!Number.isFinite(v) || v < lo || v > hi) throw new Error(`${label} must be between ${lo} and ${hi}.`); return v; };
  return {
    enabled: !!i.enabled,
    members: { CUSTOMER: !!i.members?.CUSTOMER, WHOLESALER: !!i.members?.WHOLESALER },
    creators: { CUSTOMER: !!i.creators?.CUSTOMER, WHOLESALER: !!i.creators?.WHOLESALER },
    approval: i.approval === "AUTO" ? "AUTO" : "ALWAYS",
    features: Object.fromEntries(GROUP_FEATURES.map((f) => [f, !!i.features?.[f]])) as Record<GroupFeature, boolean>,
    joinRequests: !!i.joinRequests,
    multipleGroups: !!i.multipleGroups,
    maxMembers: n(i.maxMembers, 2, 1000, "Members per group"),
    roundMaxDays: n(i.roundMaxDays, 1, 60, "Days a group order stays open"),
  };
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Share money by weights (each member's purchases), to the cent; the shares add up exactly. */
export function shareMoney(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, w) => a + Math.max(0, w), 0);
  if (total <= 0 || sum <= 0) return weights.map(() => 0);
  const cents = Math.round(total * 100);
  const raw = weights.map((w) => (Math.max(0, w) / sum) * cents);
  const base = raw.map(Math.floor);
  let left = cents - base.reduce((a, b) => a + b, 0);
  // the cents left go to the largest remainders
  const order = raw.map((v, i) => ({ i, rem: v - Math.floor(v) })).sort((a, b) => b.rem - a.rem || a.i - b.i);
  for (const o of order) { if (left <= 0) break; if (weights[o.i] > 0) { base[o.i]++; left--; } }
  return base.map((c) => r2(c / 100));
}

/** Share whole units by weights (largest remainder); the shares add up exactly. */
export function shareUnits(units: number, weights: number[]): number[] {
  const sum = weights.reduce((a, w) => a + Math.max(0, w), 0);
  if (units <= 0 || sum <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (Math.max(0, w) / sum) * units);
  const base = raw.map(Math.floor);
  let left = units - base.reduce((a, b) => a + b, 0);
  const order = raw.map((v, i) => ({ i, rem: v - Math.floor(v) })).sort((a, b) => b.rem - a.rem || a.i - b.i);
  for (const o of order) { if (left <= 0) break; if (weights[o.i] > 0) { base[o.i]++; left--; } }
  return base;
}
