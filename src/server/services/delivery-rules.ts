/**
 * Delivery rules:
 *  • FIRINGI rule per country, optionally per delivery zone (overrides the country) — minimum
 *    order, flat rate, and FIRINGI free delivery from an amount (switch on / off). Customers only.
 *  • Supplier rule — free-delivery minimum by amount or by units; distributors also set the flat
 *    rate they charge below it (they always deliver to wholesalers themselves).
 * Changing a value closes the current rule and starts a new one (history kept).
 */
import Decimal from "decimal.js";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { ForbiddenError, ValidationError } from "@/server/errors";
import { writeAudit } from "./audit";

const money = (v: number | string) => {
  const d = new Decimal(v);
  if (!d.isFinite() || d.lt(0)) throw new ValidationError("Amounts must be 0 or more.");
  return d.toFixed(2);
};

export async function listFiringiRules(ctx: Ctx) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, ["admin.delivery.view", "admin.delivery.manage", "admin.pricing.view"])) throw new ForbiddenError();
  const [current, zoneRules, zones, vendors, history] = await Promise.all([
    prisma.deliveryRule.findMany({ where: { scope: "COUNTRY", validTo: null, isActive: true }, include: { country: true, feeTaxCategory: true } }),
    prisma.deliveryRule.findMany({ where: { scope: "ZONE", validTo: null, isActive: true }, include: { zone: { select: { id: true, name: true } }, country: { select: { code: true, flag: true } } }, orderBy: { zone: { name: "asc" } } }),
    prisma.deliveryZone.findMany({ where: { isActive: true }, select: { id: true, name: true, country: { select: { code: true, flag: true } } }, orderBy: { name: "asc" } }),
    prisma.deliveryRule.findMany({ where: { scope: "VENDOR", validTo: null, isActive: true }, include: { vendor: { select: { id: true, legalName: true, type: true } }, country: { select: { flag: true } } }, orderBy: { vendor: { legalName: "asc" } } }),
    prisma.deliveryRule.findMany({ where: { scope: { in: ["COUNTRY", "ZONE"] }, validTo: { not: null } }, include: { country: true, zone: { select: { name: true } } }, orderBy: { validTo: "desc" }, take: 20 }),
  ]);
  return { current, zoneRules, zones, vendors, history };
}

export type FiringiRuleInput = { countryCode?: string; zoneId?: string; minOrderValue: number | string; feeNet: number | string; freeEnabled: boolean; freeFrom: number | string | null };

/** FIRINGI's rule for a country, or for a delivery zone (overrides the country there). */
export async function setFiringiRule(ctx: Ctx, input: FiringiRuleInput) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, "admin.delivery.manage")) throw new ForbiddenError();
  const zone = input.zoneId ? await prisma.deliveryZone.findUnique({ where: { id: input.zoneId } }) : null;
  if (input.zoneId && !zone) throw new ValidationError("Unknown delivery zone.");
  const country = zone ? await prisma.country.findUniqueOrThrow({ where: { id: zone.countryId } }) : await prisma.country.findUnique({ where: { code: input.countryCode ?? "" } });
  if (!country) throw new ValidationError("Unknown country.");
  if (input.freeEnabled && (input.freeFrom === null || input.freeFrom === "")) throw new ValidationError("Enter the amount from which FIRINGI delivers free.");
  const freeFrom = input.freeFrom === null || input.freeFrom === "" ? null : money(input.freeFrom);
  if (freeFrom && new Decimal(freeFrom).lt(money(input.minOrderValue))) throw new ValidationError("Free delivery must start at or above the minimum order.");
  const standard = await prisma.taxCategory.findUniqueOrThrow({ where: { code: "STANDARD" } });
  const now = new Date();
  const where = zone ? { scope: "ZONE" as const, zoneId: zone.id, validTo: null } : { scope: "COUNTRY" as const, countryId: country.id, validTo: null };
  await prisma.$transaction(async (tx) => {
    const cur = await tx.deliveryRule.findFirst({ where });
    if (cur) await tx.deliveryRule.update({ where: { id: cur.id }, data: { validTo: now } });
    const created = await tx.deliveryRule.create({
      data: {
        scope: zone ? "ZONE" : "COUNTRY", countryId: country.id, zoneId: zone?.id ?? null, priority: zone ? 10 : 0,
        minOrderValue: money(input.minOrderValue), firingiDeliveryFeeNet: money(input.feeNet), firingiFreeEnabled: input.freeEnabled, firingiFreeFrom: freeFrom,
        feeTaxCategoryId: cur?.feeTaxCategoryId ?? standard.id, validFrom: now, updatedById: ctx.user.id,
      },
    });
    await writeAudit({
      actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "delivery.firingi_rule_set", entityType: "DeliveryRule", entityId: created.id,
      before: cur ? { min: cur.minOrderValue?.toString(), fee: cur.firingiDeliveryFeeNet?.toString(), free: cur.firingiFreeEnabled, freeFrom: cur.firingiFreeFrom?.toString() ?? null } : null,
      after: { country: country.code, zone: zone?.name ?? null, min: input.minOrderValue, fee: input.feeNet, free: input.freeEnabled, freeFrom },
    }, tx);
  });
}

/** Remove a zone's own rule: the country rule applies there again. */
export async function removeZoneRule(ctx: Ctx, zoneId: string) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, "admin.delivery.manage")) throw new ForbiddenError();
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const cur = await tx.deliveryRule.findFirst({ where: { scope: "ZONE", zoneId, validTo: null } });
    if (!cur) return;
    await tx.deliveryRule.update({ where: { id: cur.id }, data: { validTo: now } });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "delivery.zone_rule_removed", entityType: "DeliveryRule", entityId: cur.id }, tx);
  });
}

export async function ownVendorMinimum(ctx: Ctx) {
  return prisma.deliveryRule.findFirst({ where: { scope: "VENDOR", vendorCompanyId: ctx.company.id, validTo: null, isActive: true } });
}

export type VendorRuleInput = { kind: "AMOUNT" | "UNITS"; amount?: number | string | null; units?: number | null; flatFeeNet?: number | string | null } | null;

/**
 * Supplier's delivery rule (null removes it): free-delivery minimum by amount or by units.
 * Distributors also set the flat rate they charge below the minimum (blank = no delivery below it).
 */
export async function setVendorMinimum(ctx: Ctx, input: VendorRuleInput) {
  if ((ctx.company.type !== "DISTRIBUTOR" && ctx.company.type !== "WHOLESALER") || !can(ctx, "vendor.service_areas.manage")) throw new ForbiddenError();
  let data: { vendorMinimumKind: "AMOUNT" | "UNITS"; vendorDeliveryMinimum: string | null; vendorMinimumUnits: number | null; vendorFlatFeeNet: string | null; feeTaxCategoryId: string | null } | null = null;
  if (input) {
    const units = input.kind === "UNITS" ? Number(input.units) : null;
    if (input.kind === "UNITS" && (!Number.isInteger(units) || units! < 1)) throw new ValidationError("Enter a whole number of units (1 or more).");
    const amount = input.kind === "AMOUNT" ? (input.amount === null || input.amount === undefined || input.amount === "" ? null : money(input.amount)) : null;
    if (input.kind === "AMOUNT" && amount === null) throw new ValidationError("Enter the minimum amount.");
    const flat = ctx.company.type === "DISTRIBUTOR" && input.flatFeeNet !== null && input.flatFeeNet !== undefined && input.flatFeeNet !== "" ? money(input.flatFeeNet) : null;
    const standard = flat ? await prisma.taxCategory.findUniqueOrThrow({ where: { code: "STANDARD" } }) : null;
    data = { vendorMinimumKind: input.kind, vendorDeliveryMinimum: amount, vendorMinimumUnits: units, vendorFlatFeeNet: flat, feeTaxCategoryId: standard?.id ?? null };
  }
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const cur = await tx.deliveryRule.findFirst({ where: { scope: "VENDOR", vendorCompanyId: ctx.company.id, validTo: null } });
    if (cur) await tx.deliveryRule.update({ where: { id: cur.id }, data: { validTo: now } });
    if (data) await tx.deliveryRule.create({ data: { scope: "VENDOR", vendorCompanyId: ctx.company.id, countryId: ctx.company.countryId, ...data, validFrom: now, updatedById: ctx.user.id } });
    await writeAudit({
      actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "delivery.vendor_minimum_set", entityType: "Company", entityId: ctx.company.id,
      before: cur ? { kind: cur.vendorMinimumKind, amount: cur.vendorDeliveryMinimum?.toString() ?? null, units: cur.vendorMinimumUnits, flat: cur.vendorFlatFeeNet?.toString() ?? null } : null,
      after: data ? { kind: data.vendorMinimumKind, amount: data.vendorDeliveryMinimum, units: data.vendorMinimumUnits, flat: data.vendorFlatFeeNet } : null,
    }, tx);
  });
}
