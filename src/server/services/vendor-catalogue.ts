/**
 * Vendor side of the catalogue: offers on master products, proposing new products,
 * and stock per warehouse. Every function is scoped to ctx.company (the vendor).
 */
import { setOnHand } from "@/server/inventory/ledger";
import type { Restriction } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import type { PermissionCode } from "@/server/rbac/permissions";
import { writeAudit } from "./audit";
import { assertGtinUsable, newSku, refreshSearchText, validateProductRefs, type L10n } from "./catalogue-admin";

function requireVendor(ctx: Ctx, perm: PermissionCode | PermissionCode[]) {
  if (ctx.company.type !== "DISTRIBUTOR" && ctx.company.type !== "WHOLESALER") throw new ForbiddenError();
  if (ctx.company.status !== "APPROVED" || !can(ctx, perm)) throw new ForbiddenError();
}

/** Setting: do offers on already-approved products need admin approval? (default: no) */
async function offerApprovalRequired() {
  const s = await prisma.setting.findUnique({ where: { scope_scopeId_key: { scope: "GLOBAL", scopeId: "", key: "catalogue.offerApprovalRequired" } } });
  return s?.value === true;
}

/** Approved master products a vendor can attach an offer to. */
export async function searchMasterCatalogue(ctx: Ctx, q: string, page = 1) {
  requireVendor(ctx, ["vendor.products.view", "vendor.products.manage"]);
  const where = { status: "APPROVED" as const, ...(q.trim() ? { searchText: { contains: q.trim().toLowerCase() } } : {}) };
  const rows = await prisma.product.findMany({
    where,
    include: {
      brand: { select: { name: true } },
      category: { select: { name: true } },
      variants: {
        where: { isActive: true },
        include: { packagings: { where: { isActive: true }, include: { offers: { where: { vendorCompanyId: ctx.company.id }, select: { id: true, status: true } } } } },
      },
    },
    orderBy: { updatedAt: "desc" },
    skip: (page - 1) * 30,
    take: 30,
  });
  return rows;
}

export type OfferInput = { vendorSku?: string | null; minOrderQty: number; qtyStep: number; leadTimeDays: number };

function checkOfferInput(i: OfferInput) {
  if (!(i.minOrderQty >= 1 && i.qtyStep >= 1 && i.leadTimeDays >= 0)) throw new ValidationError("Minimum quantity and step must be at least 1.");
}

export async function createOffer(ctx: Ctx, packagingUnitId: string, input: OfferInput) {
  requireVendor(ctx, "vendor.products.manage");
  checkOfferInput(input);
  const pk = await prisma.packagingUnit.findUnique({ where: { id: packagingUnitId }, include: { variant: { include: { product: true } } } });
  if (!pk || !pk.isActive || pk.variant.product.status !== "APPROVED") throw new NotFoundError("Product");
  if (await prisma.vendorOffer.findUnique({ where: { vendorCompanyId_packagingUnitId: { vendorCompanyId: ctx.company.id, packagingUnitId } } }))
    throw new AppError("DUPLICATE", "You already offer this product.", 409);
  const status = (await offerApprovalRequired()) ? "PENDING_APPROVAL" : "ACTIVE";
  const offer = await prisma.vendorOffer.create({
    data: {
      vendorCompanyId: ctx.company.id, sellerType: ctx.company.type as "DISTRIBUTOR", packagingUnitId, countryId: ctx.company.countryId,
      vendorSku: input.vendorSku?.trim() || null, minOrderQty: input.minOrderQty, qtyStep: input.qtyStep, leadTimeDays: input.leadTimeDays, status,
    },
  });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "offer.created", entityType: "VendorOffer", entityId: offer.id, after: { packagingUnitId, status, ...input } });
  return offer;
}

async function ownOffer(ctx: Ctx, offerId: string) {
  const o = await prisma.vendorOffer.findFirst({ where: { id: offerId, vendorCompanyId: ctx.company.id } });
  if (!o) throw new NotFoundError("Offer");
  return o;
}

export async function updateOffer(ctx: Ctx, offerId: string, input: OfferInput) {
  requireVendor(ctx, "vendor.products.manage");
  checkOfferInput(input);
  const o = await ownOffer(ctx, offerId);
  await prisma.vendorOffer.update({ where: { id: o.id }, data: { vendorSku: input.vendorSku?.trim() || null, minOrderQty: input.minOrderQty, qtyStep: input.qtyStep, leadTimeDays: input.leadTimeDays } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "offer.updated", entityType: "VendorOffer", entityId: o.id, before: { minOrderQty: o.minOrderQty, qtyStep: o.qtyStep }, after: input });
}

/** Vendor pauses / resumes selling. Offers rejected or suspended by FIRINGI can't be re-activated here. */
export async function setOwnOfferActive(ctx: Ctx, offerId: string, active: boolean) {
  requireVendor(ctx, "vendor.products.manage");
  const o = await ownOffer(ctx, offerId);
  if (active && o.status !== "PAUSED") throw new AppError("BAD_STATUS", "Only paused offers can be resumed.");
  if (active && o.reviewedById && o.reviewNote) throw new AppError("BAD_STATUS", "This offer was suspended by FIRINGI. Contact support.");
  if (!active && o.status !== "ACTIVE") throw new AppError("BAD_STATUS", "Only active offers can be paused.");
  await prisma.vendorOffer.update({ where: { id: o.id }, data: { status: active ? "ACTIVE" : "PAUSED" } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: active ? "offer.resumed" : "offer.paused", entityType: "VendorOffer", entityId: o.id });
}

/** Vendor proposes a brand-new product (product + variant + packaging + its own offer), pending FIRINGI approval. */
export async function proposeProduct(
  ctx: Ctx,
  input: {
    name: L10n; description?: L10n | null; categoryId: string; brandId?: string | null; taxCategoryId: string; restriction?: Restriction | null;
    gtin?: string | null; attributes?: Record<string, string> | null;
    packaging: { uomCode: string; name: L10n; unitsPerPack: number; gtin?: string | null };
    offer: OfferInput;
  },
) {
  requireVendor(ctx, "vendor.products.manage");
  if (!input.name.en?.trim()) throw new ValidationError("English name is required.");
  checkOfferInput(input.offer);
  return prisma.$transaction(async (tx) => {
    await validateProductRefs(tx, input);
    if (!(await tx.unitOfMeasure.findUnique({ where: { code: input.packaging.uomCode } }))) throw new ValidationError("Unknown unit.");
    const unitGtin = await assertGtinUsable(tx, input.gtin);
    const packGtin = await assertGtinUsable(tx, input.packaging.gtin);
    if (unitGtin && unitGtin === packGtin && input.packaging.unitsPerPack > 1) throw new ValidationError("The case barcode must differ from the unit barcode.");
    const product = await tx.product.create({
      data: {
        name: Object.fromEntries(Object.entries(input.name).filter(([, v]) => v)), description: input.description ?? undefined,
        categoryId: input.categoryId, brandId: input.brandId || null, taxCategoryId: input.taxCategoryId, restriction: input.restriction ?? null,
        status: "PENDING_APPROVAL", proposedByCompanyId: ctx.company.id,
        variants: {
          create: {
            sku: newSku(), gtin: unitGtin, attributes: input.attributes ?? undefined,
            packagings: { create: { uomCode: input.packaging.uomCode, name: Object.fromEntries(Object.entries(input.packaging.name).filter(([, v]) => v)), unitsPerPack: input.packaging.unitsPerPack, gtin: packGtin } },
          },
        },
      },
      include: { variants: { include: { packagings: true } } },
    });
    await refreshSearchText(tx, product.id);
    const offer = await tx.vendorOffer.create({
      data: {
        vendorCompanyId: ctx.company.id, sellerType: ctx.company.type as "DISTRIBUTOR", packagingUnitId: product.variants[0].packagings[0].id,
        countryId: ctx.company.countryId, status: "PENDING_APPROVAL", vendorSku: input.offer.vendorSku?.trim() || null,
        minOrderQty: input.offer.minOrderQty, qtyStep: input.offer.qtyStep, leadTimeDays: input.offer.leadTimeDays,
      },
    });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "product.proposed", entityType: "Product", entityId: product.id, after: { name: input.name, categoryId: input.categoryId } }, tx);
    return { productId: product.id, offerId: offer.id };
  });
}

export async function listOwnOffers(ctx: Ctx, opts: { q?: string } = {}) {
  requireVendor(ctx, ["vendor.products.view", "vendor.products.manage", "vendor.stock.manage", "vendor.pricing.manage"]);
  return prisma.vendorOffer.findMany({
    where: {
      vendorCompanyId: ctx.company.id,
      status: { not: "ARCHIVED" },
      ...(opts.q ? { packaging: { variant: { product: { searchText: { contains: opts.q.toLowerCase() } } } } } : {}),
    },
    include: {
      packaging: { include: { uom: true, variant: { include: { product: { include: { brand: { select: { name: true } }, category: { select: { name: true } } } } } } } },
      stockLevels: { select: { onHand: true, reserved: true, addressId: true } },
      prices: { where: { priceList: { scope: "BASE", isActive: true } }, select: { minQty: true, unitPriceNet: true, priceListId: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

/** Stock locations = the vendor's active warehouse and pickup addresses. */
export async function stockLocations(ctx: Ctx) {
  return prisma.address.findMany({ where: { companyId: ctx.company.id, isActive: true, kind: { in: ["WAREHOUSE", "PICKUP"] } }, orderBy: [{ kind: "asc" }, { label: "asc" }] });
}

/** Set the physical on-hand quantity for an offer at a location (recorded as an adjustment). */
export async function setStock(ctx: Ctx, offerId: string, addressId: string, onHand: number, note?: string | null) {
  requireVendor(ctx, "vendor.stock.manage");
  if (!Number.isInteger(onHand) || onHand < 0) throw new ValidationError("Stock must be a whole number ≥ 0.");
  const o = await ownOffer(ctx, offerId);
  const addr = await prisma.address.findFirst({ where: { id: addressId, companyId: ctx.company.id, isActive: true, kind: { in: ["WAREHOUSE", "PICKUP"] } } });
  if (!addr) throw new ValidationError("Choose one of your warehouse or pickup addresses.");
  await prisma.$transaction(async (tx) => {
    await setOnHand(tx, { offerId: o.id, addressId, onHand, byUserId: ctx.user.id, note: note ?? null });
  });}
