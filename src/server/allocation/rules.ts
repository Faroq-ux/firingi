/**
 * Allocation rules (Super Admin / allocation managers). One GLOBAL Setting row
 * "allocation.rules"; anything missing falls back to DEFAULT_RULES.
 */
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { ForbiddenError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";

const KEY = "allocation.rules";

export type Weights = { distance: number; price: number; priority: number; reliability: number; route: number; sameBuyer: number };
export type AllocationRules = {
  /** Move orders automatically (off = every case waits in the Control Tower). */
  auto: boolean;
  triggers: { declined: boolean; shortfall: boolean; noResponse: boolean };
  /** Hours a supplier has to confirm before the order is moved. */
  responseHours: number;
  /** Furthest a replacement supplier's warehouse may be from the delivery address. */
  maxDistanceKm: number;
  /** Per-country override of maxDistanceKm (countryId → km). */
  countryDistanceKm: Record<string, number>;
  /** FIRINGI's margin on moved goods may not fall below this (% of goods net; negative = FIRINGI may lose). */
  minMarginPercent: number;
  /** Most replacement orders one move may create (items split across suppliers). */
  maxSplitOrders: number;
  /** How many times the same items may be moved (stops ping-pong). */
  maxMoves: number;
  /** Which wholesaler FIRINGI picks first (orders "from FIRINGI" and moves). */
  pickBy: "NEAREST" | "CHEAPEST";
  /**
   * FIRINGI's in-house warehouse: OFF = never used; SMALL_ORDERS = picked first when the goods
   * are below the wholesaler's free-delivery minimum, otherwise only if no wholesaler can;
   * FIRST = always picked first.
   */
  inHouse: "OFF" | "SMALL_ORDERS" | "FIRST";
  /** Hours a buyer has to decide when the wholesaler they chose can't deliver. */
  buyerDecisionHours: number;
  /** A supplier that already delivers within this distance today counts as "on the route". */
  routeMatchKm: number;
  weights: Weights;
};

export const DEFAULT_RULES: AllocationRules = {
  auto: true,
  triggers: { declined: true, shortfall: true, noResponse: true },
  responseHours: 4,
  maxDistanceKm: 50,
  countryDistanceKm: {},
  minMarginPercent: 0,
  maxSplitOrders: 2,
  maxMoves: 2,
  pickBy: "NEAREST",
  inHouse: "SMALL_ORDERS",
  buyerDecisionHours: 48,
  routeMatchKm: 5,
  weights: { distance: 30, price: 25, priority: 15, reliability: 20, route: 5, sameBuyer: 5 },
};

export async function allocationRules(): Promise<AllocationRules> {
  const s = await prisma.setting.findUnique({ where: { scope_scopeId_key: { scope: "GLOBAL", scopeId: "", key: KEY } } });
  const v = (s?.value ?? {}) as Partial<AllocationRules>;
  return {
    ...DEFAULT_RULES, ...v,
    triggers: { ...DEFAULT_RULES.triggers, ...(v.triggers ?? {}) },
    weights: { ...DEFAULT_RULES.weights, ...(v.weights ?? {}) },
    countryDistanceKm: { ...(v.countryDistanceKm ?? {}) },
  };
}

export function distanceLimit(rules: AllocationRules, countryId: string) {
  return rules.countryDistanceKm[countryId] ?? rules.maxDistanceKm;
}

const num = (v: unknown, lo: number, hi: number, label: string, int = true) => {
  const n = Number(v);
  if (!Number.isFinite(n) || (int && !Number.isInteger(n)) || n < lo || n > hi) throw new ValidationError(`${label} must be ${int ? "a whole number " : ""}from ${lo} to ${hi}.`);
  return n;
};

export function assertAllocationManager(ctx: Ctx) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, "admin.allocation.manage")) throw new ForbiddenError();
}

/** Save part of the rules (each page edits its own part). Validated, audited. */
export async function updateAllocationRules(ctx: Ctx, patch: Partial<AllocationRules>) {
  assertAllocationManager(ctx);
  const before = await allocationRules();
  const { flows: _f, crossBorderDistributors: _c, ...clean } = { ...before, ...patch } as AllocationRules & { flows?: unknown; crossBorderDistributors?: unknown };
  void _f; void _c;
  const next: AllocationRules = {
    ...clean,
    triggers: { ...before.triggers, ...(patch.triggers ?? {}) },
    weights: { ...before.weights, ...(patch.weights ?? {}) },
    countryDistanceKm: patch.countryDistanceKm ?? before.countryDistanceKm,
  };
  next.auto = !!next.auto;
  if (next.pickBy !== "NEAREST" && next.pickBy !== "CHEAPEST") throw new ValidationError("Choose nearest or cheapest.");
  if (!["OFF", "SMALL_ORDERS", "FIRST"].includes(next.inHouse)) throw new ValidationError("Choose when the in-house warehouse is used.");
  next.buyerDecisionHours = num(next.buyerDecisionHours, 1, 168, "Buyer decision time (hours)");
  next.responseHours = num(next.responseHours, 1, 72, "Response time (hours)");
  next.maxDistanceKm = num(next.maxDistanceKm, 1, 1000, "Maximum distance (km)");
  next.minMarginPercent = num(next.minMarginPercent, -50, 50, "Minimum margin (%)", false);
  next.maxSplitOrders = num(next.maxSplitOrders, 1, 5, "Replacement orders per move");
  next.maxMoves = num(next.maxMoves, 1, 5, "Moves per order");
  next.routeMatchKm = num(next.routeMatchKm, 0, 100, "Route matching distance (km)", false);
  for (const [k, v] of Object.entries(next.countryDistanceKm)) next.countryDistanceKm[k] = num(v, 1, 1000, "Country distance (km)");
  for (const k of Object.keys(DEFAULT_RULES.weights) as (keyof Weights)[]) next.weights[k] = num(next.weights[k], 0, 100, `Weight "${k}"`);
  if (Object.values(next.weights).every((w) => w === 0)) throw new ValidationError("At least one weight must be above 0.");
  for (const k of Object.keys(next.triggers) as (keyof AllocationRules["triggers"])[]) next.triggers[k] = !!next.triggers[k];
  await prisma.$transaction(async (tx) => {
    await tx.setting.upsert({
      where: { scope_scopeId_key: { scope: "GLOBAL", scopeId: "", key: KEY } },
      update: { value: next, updatedById: ctx.user.id },
      create: { scope: "GLOBAL", scopeId: "", key: KEY, value: next, updatedById: ctx.user.id },
    });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "setting.allocation_rules", entityType: "Setting", entityId: KEY, before, after: next }, tx);
  });
  return next;
}
