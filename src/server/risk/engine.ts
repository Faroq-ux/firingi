/**
 * Order risk scoring (pure). Each check adds points; the total decides:
 *   score ≥ holdScore → HIGH  → the order is held until FIRINGI reviews it
 *   score ≥ flagScore → MEDIUM → the order goes through, FIRINGI reviews it afterwards
 *   otherwise          → LOW   → recorded only
 * FIRINGI tunes the thresholds and switches checks on/off (Risk › Fraud Detection).
 */

export type RiskRule = "NEW_ACCOUNT_BIG" | "FIRST_ORDER_BIG" | "VELOCITY" | "SPIKE" | "FAR_ADDRESS" | "NEW_ADDRESS" | "NEW_USER" | "COUPON_SHARED" | "CANCEL_HISTORY";
export const RISK_RULES: { rule: RiskRule; label: string; points: number }[] = [
  { rule: "NEW_ACCOUNT_BIG", label: "New account, big order", points: 40 },
  { rule: "FIRST_ORDER_BIG", label: "First order is big", points: 20 },
  { rule: "VELOCITY", label: "Many orders in a short time", points: 30 },
  { rule: "SPIKE", label: "Much bigger than usual", points: 25 },
  { rule: "FAR_ADDRESS", label: "Delivery far from the company", points: 20 },
  { rule: "NEW_ADDRESS", label: "Delivery address added just now", points: 15 },
  { rule: "NEW_USER", label: "Placed by a brand-new user", points: 10 },
  { rule: "COUPON_SHARED", label: "Coupon also used by a look-alike company", points: 35 },
  { rule: "CANCEL_HISTORY", label: "Cancels often", points: 15 },
];

export type RiskSettings = {
  enabled: boolean;
  holdScore: number;
  flagScore: number;
  newAccountDays: number;
  bigOrderAmount: number;
  velocityOrders: number;
  velocityMinutes: number;
  spikeFactor: number;
  farKm: number;
  disabledRules: RiskRule[];
};
export const DEFAULT_RISK: RiskSettings = {
  enabled: true, holdScore: 60, flagScore: 30, newAccountDays: 30, bigOrderAmount: 2000, velocityOrders: 4, velocityMinutes: 60, spikeFactor: 5, farKm: 50, disabledRules: [],
};

export type RiskFacts = {
  /** Gross total of this checkout (all its orders). */
  checkoutGross: number;
  /** Goods (net) of this checkout. */
  checkoutGoods: number;
  accountAgeDays: number;
  priorOrders: number;
  priorAvgGoods: number;
  /** Checkouts by this buyer within the velocity window, before this one. */
  recentCheckouts: number;
  /** Of the last 10 orders. */
  recentCancelled: number;
  addressKm: number | null;
  addressAgeHours: number | null;
  userAgeHours: number;
  userIsOwner: boolean;
  /** Other buying companies that used the same coupon and share a phone / e-mail domain / address. */
  couponLookAlikes: number;
};

export type RiskReason = { rule: RiskRule; points: number; detail: string };
export type RiskResult = { score: number; level: "LOW" | "MEDIUM" | "HIGH"; reasons: RiskReason[] };

const eur = (n: number) => `${n.toFixed(2)} €`;

export function scoreRisk(f: RiskFacts, s: RiskSettings = DEFAULT_RISK): RiskResult {
  const reasons: RiskReason[] = [];
  const on = (r: RiskRule) => !s.disabledRules.includes(r);
  const add = (rule: RiskRule, points: number, detail: string) => { if (on(rule)) reasons.push({ rule, points, detail }); };
  if (f.accountAgeDays < s.newAccountDays && f.checkoutGross >= s.bigOrderAmount)
    add("NEW_ACCOUNT_BIG", f.checkoutGross >= 2 * s.bigOrderAmount ? 60 : 40, `account ${Math.floor(f.accountAgeDays)} days old, order ${eur(f.checkoutGross)} (limit ${eur(s.bigOrderAmount)})`);
  if (f.priorOrders === 0 && f.checkoutGross >= s.bigOrderAmount) add("FIRST_ORDER_BIG", 20, `first order, ${eur(f.checkoutGross)}`);
  if (f.recentCheckouts + 1 >= s.velocityOrders) add("VELOCITY", 30, `${f.recentCheckouts + 1} orders within ${s.velocityMinutes} minutes`);
  if (f.priorOrders >= 3 && f.priorAvgGoods > 0 && f.checkoutGoods > s.spikeFactor * f.priorAvgGoods)
    add("SPIKE", 25, `${eur(f.checkoutGoods)} vs usual ${eur(f.priorAvgGoods)} (×${(f.checkoutGoods / f.priorAvgGoods).toFixed(1)})`);
  if (f.addressKm !== null && f.addressKm > s.farKm) add("FAR_ADDRESS", 20, `${Math.round(f.addressKm)} km from the company`);
  if (f.addressAgeHours !== null && f.addressAgeHours < 24) add("NEW_ADDRESS", 15, `address added ${Math.max(0, Math.round(f.addressAgeHours))} h ago`);
  if (!f.userIsOwner && f.userAgeHours < 24) add("NEW_USER", 10, `user created ${Math.max(0, Math.round(f.userAgeHours))} h ago`);
  if (f.couponLookAlikes > 0) add("COUPON_SHARED", 35, `coupon also used by ${f.couponLookAlikes} look-alike compan${f.couponLookAlikes === 1 ? "y" : "ies"}`);
  if (f.recentCancelled >= 3) add("CANCEL_HISTORY", 15, `${f.recentCancelled} of the last 10 orders cancelled`);
  const score = reasons.reduce((a, r) => a + r.points, 0);
  return { score, level: !s.enabled ? "LOW" : score >= s.holdScore ? "HIGH" : score >= s.flagScore ? "MEDIUM" : "LOW", reasons };
}
