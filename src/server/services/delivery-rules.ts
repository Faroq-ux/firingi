/**
 * Delivery minimums:
 *  • FIRINGI rule per country — minimum order for FIRINGI delivery + fee (admin).
 *  • Vendor delivery minimum — from this value the vendor delivers itself (vendor).
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
  const [current, vendors, history] = await Promise.all([
    prisma.deliveryRule.findMany({ where: { scope: "COUNTRY", validTo: null, isActive: true }, include: { country: true, feeTaxCategory: true } }),
    prisma.deliveryRule.findMany({ where: { scope: "VENDOR", validTo: null, isActive: true }, include: { vendor: { select: { id: true, legalName: true, type: true } }, country: { select: { flag: true } } }, orderBy: { vendor: { legalName: "asc" } } }),
    prisma.deliveryRule.findMany({ where: { scope: "COUNTRY", validTo: { not: null } }, include: { country: true }, orderBy: { validTo: "desc" }, take: 20 }),
  ]);
  return { current, vendors, history };
}

export async function setFiringiRule(ctx: Ctx, input: { countryCode: string; minOrderValue: number | string; feeNet: number | string }) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, "admin.delivery.manage")) throw new ForbiddenError();
  const country = await prisma.country.findUnique({ where: { code: input.countryCode } });
  if (!country) throw new ValidationError("Unknown country.");
  const standard = await prisma.taxCategory.findUniqueOrThrow({ where: { code: "STANDARD" } });
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const cur = await tx.deliveryRule.findFirst({ where: { scope: "COUNTRY", countryId: country.id, validTo: null } });
    if (cur) await tx.deliveryRule.update({ where: { id: cur.id }, data: { validTo: now } });
    const created = await tx.deliveryRule.create({
      data: { scope: "COUNTRY", countryId: country.id, minOrderValue: money(input.minOrderValue), firingiDeliveryFeeNet: money(input.feeNet), feeTaxCategoryId: cur?.feeTaxCategoryId ?? standard.id, validFrom: now, updatedById: ctx.user.id },
    });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "delivery.firingi_rule_set", entityType: "DeliveryRule", entityId: created.id, before: cur ? { min: cur.minOrderValue?.toString(), fee: cur.firingiDeliveryFeeNet?.toString() } : null, after: { country: country.code, min: input.minOrderValue, fee: input.feeNet } }, tx);
  });
}

export async function ownVendorMinimum(ctx: Ctx) {
  return prisma.deliveryRule.findFirst({ where: { scope: "VENDOR", vendorCompanyId: ctx.company.id, validTo: null, isActive: true } });
}

/** Vendor sets (or removes, with null) the order value from which it delivers itself. */
export async function setVendorMinimum(ctx: Ctx, amount: number | string | null) {
  if ((ctx.company.type !== "DISTRIBUTOR" && ctx.company.type !== "WHOLESALER") || !can(ctx, "vendor.service_areas.manage")) throw new ForbiddenError();
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const cur = await tx.deliveryRule.findFirst({ where: { scope: "VENDOR", vendorCompanyId: ctx.company.id, validTo: null } });
    if (cur) await tx.deliveryRule.update({ where: { id: cur.id }, data: { validTo: now } });
    if (amount !== null)
      await tx.deliveryRule.create({ data: { scope: "VENDOR", vendorCompanyId: ctx.company.id, countryId: ctx.company.countryId, vendorDeliveryMinimum: money(amount), validFrom: now, updatedById: ctx.user.id } });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "delivery.vendor_minimum_set", entityType: "Company", entityId: ctx.company.id, before: { amount: cur?.vendorDeliveryMinimum?.toString() ?? null }, after: { amount } }, tx);
  });
}
