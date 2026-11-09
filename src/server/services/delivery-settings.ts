/**
 * Multi-order delivery: may one driver carry several orders at once?
 *   • Super Admin (admin.settings.manage) sets the platform policy:
 *       – on/off and the maximum for FIRINGI's own fleet,
 *       – whether vendors may use it at all, and the highest maximum a vendor may choose.
 *   • A vendor switches it on/off for its own fleet (within FIRINGI's policy).
 * Off = a driver holds one open delivery at a time. Enforced when a driver is assigned.
 */
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { AppError, ForbiddenError, ValidationError } from "@/server/errors";
import { ACTIVE_DELIVERY } from "@/server/delivery/state";
import { writeAudit } from "./audit";

const KEY = "delivery.multiOrder";

export type MultiOrderPolicy = { firingiFleet: boolean; firingiMax: number; vendorsMayUse: boolean; vendorMaxCap: number };
export type VendorMultiOrder = { enabled: boolean; max: number };

export const DEFAULT_POLICY: MultiOrderPolicy = { firingiFleet: false, firingiMax: 10, vendorsMayUse: true, vendorMaxCap: 10 };
const DEFAULT_VENDOR: VendorMultiOrder = { enabled: false, max: 5 };

const clampInt = (v: unknown, lo: number, hi: number, label: string) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < lo || n > hi) throw new ValidationError(`${label} must be a whole number from ${lo} to ${hi}.`);
  return n;
};

export async function multiOrderPolicy(): Promise<MultiOrderPolicy> {
  const s = await prisma.setting.findUnique({ where: { scope_scopeId_key: { scope: "GLOBAL", scopeId: "", key: KEY } } });
  return { ...DEFAULT_POLICY, ...((s?.value as Partial<MultiOrderPolicy>) ?? {}) };
}

export async function vendorMultiOrder(companyId: string): Promise<VendorMultiOrder> {
  const s = await prisma.setting.findUnique({ where: { scope_scopeId_key: { scope: "COMPANY", scopeId: companyId, key: KEY } } });
  return { ...DEFAULT_VENDOR, ...((s?.value as Partial<VendorMultiOrder>) ?? {}) };
}

/** Super Admin: platform policy. */
export async function setMultiOrderPolicy(ctx: Ctx, input: MultiOrderPolicy) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, "admin.settings.manage")) throw new ForbiddenError();
  const before = await multiOrderPolicy();
  const value: MultiOrderPolicy = {
    firingiFleet: !!input.firingiFleet,
    firingiMax: clampInt(input.firingiMax, 2, 50, "Orders per FIRINGI driver"),
    vendorsMayUse: !!input.vendorsMayUse,
    vendorMaxCap: clampInt(input.vendorMaxCap, 2, 50, "Highest vendor maximum"),
  };
  await prisma.$transaction(async (tx) => {
    await tx.setting.upsert({
      where: { scope_scopeId_key: { scope: "GLOBAL", scopeId: "", key: KEY } },
      update: { value, updatedById: ctx.user.id },
      create: { scope: "GLOBAL", scopeId: "", key: KEY, value, updatedById: ctx.user.id },
    });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "setting.multi_order_policy", entityType: "Setting", entityId: KEY, before, after: value }, tx);
  });
}

/** Vendor: own fleet. */
export async function setVendorMultiOrder(ctx: Ctx, input: VendorMultiOrder) {
  if ((ctx.company.type !== "DISTRIBUTOR" && ctx.company.type !== "WHOLESALER") || !can(ctx, ["vendor.drivers.manage", "vendor.service_areas.manage"])) throw new ForbiddenError();
  const policy = await multiOrderPolicy();
  if (input.enabled && !policy.vendorsMayUse) throw new AppError("MULTI_ORDER_OFF", "FIRINGI has switched off multi-order delivery for vendors.", 409);
  const before = await vendorMultiOrder(ctx.company.id);
  const value: VendorMultiOrder = { enabled: !!input.enabled, max: input.enabled ? clampInt(input.max, 2, policy.vendorMaxCap, "Orders per driver") : before.max };
  await prisma.$transaction(async (tx) => {
    await tx.setting.upsert({
      where: { scope_scopeId_key: { scope: "COMPANY", scopeId: ctx.company.id, key: KEY } },
      update: { value, updatedById: ctx.user.id },
      create: { scope: "COMPANY", scopeId: ctx.company.id, key: KEY, value, updatedById: ctx.user.id },
    });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "setting.multi_order_vendor", entityType: "Company", entityId: ctx.company.id, before, after: value }, tx);
  });
}

/** How many open deliveries one driver of this fleet may hold (1 = multi-order off). */
export async function ordersPerDriver(executorCompanyId: string, executorIsFiringi: boolean): Promise<number> {
  const policy = await multiOrderPolicy();
  if (executorIsFiringi) return policy.firingiFleet ? policy.firingiMax : 1;
  if (!policy.vendorsMayUse) return 1;
  const v = await vendorMultiOrder(executorCompanyId);
  return v.enabled ? Math.min(v.max, policy.vendorMaxCap) : 1;
}

/** Throws if giving this driver one more delivery would exceed the fleet's limit. */
export async function assertDriverCapacity(driverId: string, executorCompanyId: string, executorIsFiringi: boolean, exceptDeliveryId: string) {
  const limit = await ordersPerDriver(executorCompanyId, executorIsFiringi);
  const open = await prisma.delivery.count({ where: { driverId, status: { in: ACTIVE_DELIVERY }, id: { not: exceptDeliveryId } } });
  if (open + 1 > limit)
    throw new AppError(
      "DRIVER_FULL",
      limit === 1
        ? "This driver already has an open delivery. Multi-order delivery is switched off for this fleet."
        : `This driver already has ${open} open deliveries (maximum ${limit}).`,
      409,
    );
}
