/**
 * Vendor price lists (base, customer group, customer-specific / contract, with
 * quantity tiers) and vendor-owned customer groups.
 */
import type { PriceListScope } from "@prisma/client";
import Decimal from "decimal.js";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "./audit";

function requirePricing(ctx: Ctx) {
  if ((ctx.company.type !== "DISTRIBUTOR" && ctx.company.type !== "WHOLESALER") || ctx.company.status !== "APPROVED" || !can(ctx, "vendor.pricing.manage"))
    throw new ForbiddenError();
}

/**
 * Buyers a vendor may target with groups / specific prices: wholesalers target approved
 * customers in their own country; distributors target approved wholesalers (EU).
 */
export async function eligibleBuyers(ctx: Ctx) {
  requirePricing(ctx);
  return prisma.company.findMany({
    where: ctx.company.type === "WHOLESALER"
      ? { type: "CUSTOMER", status: "APPROVED", countryId: ctx.company.countryId }
      : { type: "WHOLESALER", status: "APPROVED", id: { not: ctx.company.id } },
    select: { id: true, legalName: true, tradeName: true, country: { select: { flag: true } } },
    orderBy: { legalName: "asc" },
  });
}

async function assertEligible(ctx: Ctx, companyId: string) {
  if (!(await eligibleBuyers(ctx)).some((b) => b.id === companyId)) throw new ValidationError("This business can't buy from you.");
}

/** The vendor's BASE list (created on first use). */
export async function ensureBaseList(ctx: Ctx) {
  requirePricing(ctx);
  const existing = await prisma.priceList.findFirst({ where: { vendorCompanyId: ctx.company.id, scope: "BASE", countryId: ctx.company.countryId } });
  if (existing) return existing;
  return prisma.priceList.create({ data: { vendorCompanyId: ctx.company.id, name: "Base prices", scope: "BASE", countryId: ctx.company.countryId, currencyCode: "EUR" } });
}

export async function listOwnPriceLists(ctx: Ctx) {
  requirePricing(ctx);
  return prisma.priceList.findMany({
    where: { vendorCompanyId: ctx.company.id },
    include: { targetGroup: { select: { name: true } }, targetCompany: { select: { legalName: true } }, _count: { select: { items: true } } },
    orderBy: [{ scope: "asc" }, { name: "asc" }],
  });
}

export async function savePriceList(
  ctx: Ctx,
  input: { id?: string; name: string; scope: Exclude<PriceListScope, "BASE">; targetGroupId?: string | null; targetCompanyId?: string | null; priority?: number; validFrom?: Date | null; validTo?: Date | null; isActive?: boolean },
) {
  requirePricing(ctx);
  if (input.scope === "CUSTOMER_GROUP") {
    if (!input.targetGroupId || !(await prisma.customerGroup.findFirst({ where: { id: input.targetGroupId, ownerCompanyId: ctx.company.id } }))) throw new ValidationError("Choose one of your customer groups.");
  } else {
    if (!input.targetCompanyId) throw new ValidationError("Choose a customer.");
    await assertEligible(ctx, input.targetCompanyId);
  }
  if (input.validTo && input.validFrom && input.validTo <= input.validFrom) throw new ValidationError("End date must be after start date.");
  const data = {
    name: input.name.trim(), scope: input.scope,
    targetGroupId: input.scope === "CUSTOMER_GROUP" ? input.targetGroupId! : null,
    targetCompanyId: input.scope === "CUSTOMER_GROUP" ? null : input.targetCompanyId!,
    priority: input.priority ?? 0, validFrom: input.validFrom ?? new Date(), validTo: input.validTo ?? null, isActive: input.isActive ?? true,
  };
  if (input.id) {
    const pl = await prisma.priceList.findFirst({ where: { id: input.id, vendorCompanyId: ctx.company.id } });
    if (!pl || pl.scope === "BASE") throw new NotFoundError("Price list");
    await prisma.priceList.update({ where: { id: pl.id }, data });
  }
  const pl = input.id
    ? { id: input.id }
    : await prisma.priceList.create({ data: { ...data, vendorCompanyId: ctx.company.id, countryId: ctx.company.countryId, currencyCode: "EUR" } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: input.id ? "pricelist.updated" : "pricelist.created", entityType: "PriceList", entityId: pl.id, after: data });
  return pl;
}

export async function getOwnPriceList(ctx: Ctx, id: string) {
  requirePricing(ctx);
  const pl = await prisma.priceList.findFirst({
    where: { id, vendorCompanyId: ctx.company.id },
    include: {
      targetGroup: { select: { name: true } }, targetCompany: { select: { legalName: true } },
      items: { include: { offer: { include: { packaging: { include: { variant: { include: { product: { select: { name: true } } } } } } } } }, orderBy: [{ offerId: "asc" }, { minQty: "asc" }] },
    },
  });
  if (!pl) throw new NotFoundError("Price list");
  return pl;
}

/** Set (create or replace) the price of one of the vendor's offers at a quantity tier. */
export async function setPrice(ctx: Ctx, priceListId: string, offerId: string, minQty: number, unitPriceNet: string | number) {
  requirePricing(ctx);
  const price = new Decimal(unitPriceNet);
  if (!price.isFinite() || price.lte(0)) throw new ValidationError("Price must be greater than 0.");
  if (!Number.isInteger(minQty) || minQty < 1) throw new ValidationError("Minimum quantity must be a whole number ≥ 1.");
  const pl = await prisma.priceList.findFirst({ where: { id: priceListId, vendorCompanyId: ctx.company.id } });
  if (!pl) throw new NotFoundError("Price list");
  if (!(await prisma.vendorOffer.findFirst({ where: { id: offerId, vendorCompanyId: ctx.company.id } }))) throw new NotFoundError("Offer");
  const before = await prisma.priceListItem.findUnique({ where: { priceListId_offerId_minQty: { priceListId, offerId, minQty } } });
  await prisma.priceListItem.upsert({
    where: { priceListId_offerId_minQty: { priceListId, offerId, minQty } },
    update: { unitPriceNet: price.toFixed(4) },
    create: { priceListId, offerId, minQty, unitPriceNet: price.toFixed(4) },
  });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "price.set", entityType: "PriceList", entityId: priceListId, before: before ? { offerId, minQty, price: before.unitPriceNet.toString() } : null, after: { offerId, minQty, price: price.toFixed(4) } });
}

export async function removePrice(ctx: Ctx, itemId: string) {
  requirePricing(ctx);
  const item = await prisma.priceListItem.findFirst({ where: { id: itemId, priceList: { vendorCompanyId: ctx.company.id } } });
  if (!item) throw new NotFoundError("Price");
  await prisma.priceListItem.delete({ where: { id: itemId } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "price.removed", entityType: "PriceList", entityId: item.priceListId, before: { offerId: item.offerId, minQty: item.minQty, price: item.unitPriceNet.toString() } });
}

// ── Customer groups (vendor-owned) ───────────────────────────────────────────

export async function listOwnGroups(ctx: Ctx) {
  requirePricing(ctx);
  return prisma.customerGroup.findMany({
    where: { ownerCompanyId: ctx.company.id },
    include: { members: { include: { company: { select: { id: true, legalName: true } } } }, _count: { select: { priceLists: true } } },
    orderBy: { name: "asc" },
  });
}

export async function saveGroup(ctx: Ctx, input: { id?: string; name: string; description?: string | null }) {
  requirePricing(ctx);
  if (input.name.trim().length < 2) throw new ValidationError("Name is required.");
  if (input.id && !(await prisma.customerGroup.findFirst({ where: { id: input.id, ownerCompanyId: ctx.company.id } }))) throw new NotFoundError("Group");
  const g = input.id
    ? await prisma.customerGroup.update({ where: { id: input.id }, data: { name: input.name.trim(), description: input.description ?? null } })
    : await prisma.customerGroup.create({ data: { ownerCompanyId: ctx.company.id, name: input.name.trim(), description: input.description ?? null } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: input.id ? "group.updated" : "group.created", entityType: "CustomerGroup", entityId: g.id, after: { name: g.name } });
  return g;
}

export async function setGroupMember(ctx: Ctx, groupId: string, companyId: string, member: boolean) {
  requirePricing(ctx);
  const g = await prisma.customerGroup.findFirst({ where: { id: groupId, ownerCompanyId: ctx.company.id } });
  if (!g) throw new NotFoundError("Group");
  if (member) {
    await assertEligible(ctx, companyId);
    await prisma.customerGroupMember.upsert({ where: { groupId_companyId: { groupId, companyId } }, update: {}, create: { groupId, companyId } });
  } else await prisma.customerGroupMember.deleteMany({ where: { groupId, companyId } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: member ? "group.member_added" : "group.member_removed", entityType: "CustomerGroup", entityId: groupId, after: { companyId } });
}

export async function deleteGroup(ctx: Ctx, groupId: string) {
  requirePricing(ctx);
  const g = await prisma.customerGroup.findFirst({ where: { id: groupId, ownerCompanyId: ctx.company.id }, include: { _count: { select: { priceLists: true } } } });
  if (!g) throw new NotFoundError("Group");
  if (g._count.priceLists) throw new AppError("IN_USE", "This group is used by a price list. Remove the price list first.", 409);
  await prisma.customerGroup.delete({ where: { id: groupId } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "group.deleted", entityType: "CustomerGroup", entityId: groupId, before: { name: g.name } });
}
