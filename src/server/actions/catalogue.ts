"use server";
/** Catalogue actions (admin + vendor). Services re-check every permission. */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { defineAction, runAction } from "./_action";
import * as admin from "@/server/services/catalogue-admin";
import * as vendor from "@/server/services/vendor-catalogue";
import * as pricing from "@/server/services/pricing";
import { storeUpload } from "@/server/services/storage";
import { prisma } from "@/server/db";
import { can } from "@/server/rbac/guard";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";

const done = <T>(v: T) => { revalidatePath("/", "layout"); return v; };
const l10n = z.object({ en: z.string().trim().min(1, "English name is required").max(200), pt: z.string().trim().max(200).optional().nullable(), es: z.string().trim().max(200).optional().nullable() });
const optId = z.string().optional().nullable().transform((v) => v || null);
const restriction = z.enum(["TOBACCO", "ALCOHOL"]).optional().nullable().transform((v) => v || null);

// ── Admin ──
export const saveCategoryAction = defineAction({
  permission: "admin.catalogue.manage",
  schema: z.object({ id: z.string().optional(), name: l10n, parentId: optId, restriction, defaultTaxCategoryId: optId, isActive: z.boolean().optional() }),
  handler: async (ctx, i) => done(await admin.saveCategory(ctx, i)),
});
export const moveCategoryAction = defineAction({
  permission: "admin.catalogue.manage",
  schema: z.object({ id: z.string(), direction: z.enum(["up", "down"]) }),
  handler: async (ctx, i) => done(await admin.moveCategory(ctx, i.id, i.direction)),
});
export const saveBrandAction = defineAction({
  permission: "admin.catalogue.manage",
  schema: z.object({ id: z.string().optional(), name: z.string().trim().min(1).max(80), isActive: z.boolean().optional() }),
  handler: async (ctx, i) => done({ id: (await admin.saveBrand(ctx, i)).id }),
});
export const saveProductAction = defineAction({
  permission: "admin.catalogue.manage",
  schema: z.object({
    id: z.string().optional(), name: l10n, description: l10n.partial().optional().nullable(), categoryId: z.string().min(1, "Choose a category"), brandId: optId,
    taxCategoryId: z.string().min(1), restriction, hsCode: z.string().trim().max(20).optional().nullable(), originCountryCode: z.string().trim().max(2).optional().nullable(),
  }),
  handler: async (ctx, i) => done(await admin.saveProduct(ctx, { ...i, description: i.description?.en ? (i.description as { en: string }) : null })),
});
export const saveVariantAction = defineAction({
  permission: "admin.catalogue.manage",
  schema: z.object({ id: z.string().optional(), productId: z.string(), sku: z.string().trim().max(40).optional().nullable(), gtin: z.string().trim().max(20).optional().nullable(), attributes: z.record(z.string()).optional().nullable(), isActive: z.boolean().optional() }),
  handler: async (ctx, i) => done(await admin.saveVariant(ctx, i)),
});
export const savePackagingAction = defineAction({
  permission: "admin.catalogue.manage",
  schema: z.object({ id: z.string().optional(), variantId: z.string(), uomCode: z.string(), name: l10n, unitsPerPack: z.coerce.number().int().min(1), gtin: z.string().trim().max(20).optional().nullable(), netWeightKg: z.coerce.number().min(0).optional().nullable(), isActive: z.boolean().optional() }),
  handler: async (ctx, i) => done(await admin.savePackaging(ctx, i)),
});
export const reviewProductAction = defineAction({
  permission: "admin.catalogue.approve",
  schema: z.object({ productId: z.string(), decision: z.enum(["APPROVED", "REJECTED"]), note: z.string().trim().max(500).optional().nullable() }),
  handler: async (ctx, i) => done(await admin.reviewProduct(ctx, i.productId, i.decision, i.note)),
});
export const bulkApproveProductsAction = defineAction({
  permission: "admin.catalogue.approve",
  schema: z.object({ ids: z.array(z.string().min(1).max(40)).min(1).max(200) }),
  handler: async (ctx, i) => {
    let ok = 0;
    for (const id of i.ids) await admin.reviewProduct(ctx, id, "APPROVED", null).then(() => ok++).catch(() => null);
    revalidatePath("/admin/catalogue", "layout");
    return { approved: ok, skipped: i.ids.length - ok };
  },
});
export const reviewOfferAction = defineAction({
  permission: "admin.catalogue.approve",
  schema: z.object({ offerId: z.string(), to: z.enum(["ACTIVE", "REJECTED", "PAUSED"]), note: z.string().trim().max(500).optional().nullable() }),
  handler: async (ctx, i) => done(await admin.reviewOffer(ctx, i.offerId, i.to, i.note)),
});

/** Product image upload (admin, or the proposing vendor while the product is pending). */
export async function uploadProductImageAction(fd: FormData) {
  return runAction(async (ctx) => {
    const productId = String(fd.get("productId"));
    const p = await prisma.product.findUnique({ where: { id: productId } });
    if (!p) throw new NotFoundError("Product");
    const isAdmin = ctx.company.type === "ADMIN" && can(ctx, "admin.catalogue.manage");
    const isProposer = p.proposedByCompanyId === ctx.company.id && p.status === "PENDING_APPROVAL" && can(ctx, "vendor.products.manage");
    if (!isAdmin && !isProposer) throw new ForbiddenError();
    const stored = await storeUpload(fd.get("file") as File, `products/${productId}`);
    if (!stored.mimeType.startsWith("image/")) throw new ForbiddenError("Product images must be JPG, PNG or WEBP.");
    await prisma.product.update({ where: { id: productId }, data: { images: [...p.images, stored.key].slice(-8) } });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "product.image_added", entityType: "Product", entityId: productId });
    return done({ key: stored.key });
  });
}

// ── Vendor ──
const offerFields = { vendorSku: z.string().trim().max(40).optional().nullable(), minOrderQty: z.coerce.number().int().min(1), qtyStep: z.coerce.number().int().min(1), leadTimeDays: z.coerce.number().int().min(0).max(60) };

export const createOfferAction = defineAction({
  permission: "vendor.products.manage",
  schema: z.object({ packagingUnitId: z.string(), basePrice: z.coerce.number().positive().optional(), ...offerFields }),
  handler: async (ctx, { packagingUnitId, basePrice, ...o }) => {
    const offer = await vendor.createOffer(ctx, packagingUnitId, o);
    if (basePrice && can(ctx, "vendor.pricing.manage")) await pricing.setPrice(ctx, (await pricing.ensureBaseList(ctx)).id, offer.id, 1, basePrice);
    return done({ id: offer.id });
  },
});
export const updateOfferAction = defineAction({
  permission: "vendor.products.manage",
  schema: z.object({ offerId: z.string(), ...offerFields }),
  handler: async (ctx, { offerId, ...o }) => done(await vendor.updateOffer(ctx, offerId, o)),
});
export const setOfferActiveAction = defineAction({
  permission: "vendor.products.manage",
  schema: z.object({ offerId: z.string(), active: z.boolean() }),
  handler: async (ctx, i) => done(await vendor.setOwnOfferActive(ctx, i.offerId, i.active)),
});
export const proposeProductAction = defineAction({
  permission: "vendor.products.manage",
  schema: z.object({
    name: l10n, categoryId: z.string().min(1, "Choose a category"), brandId: optId, taxCategoryId: z.string().min(1), restriction, gtin: z.string().trim().max(20).optional().nullable(),
    packaging: z.object({ uomCode: z.string(), name: l10n, unitsPerPack: z.coerce.number().int().min(1), gtin: z.string().trim().max(20).optional().nullable() }),
    offer: z.object(offerFields), basePrice: z.coerce.number().positive().optional(),
  }),
  handler: async (ctx, { basePrice, ...i }) => {
    const r = await vendor.proposeProduct(ctx, i);
    if (basePrice && can(ctx, "vendor.pricing.manage")) await pricing.setPrice(ctx, (await pricing.ensureBaseList(ctx)).id, r.offerId, 1, basePrice);
    return done(r);
  },
});
export const setStockAction = defineAction({
  permission: "vendor.stock.manage",
  schema: z.object({ offerId: z.string(), addressId: z.string(), onHand: z.coerce.number().int().min(0), note: z.string().max(200).optional().nullable() }),
  handler: async (ctx, i) => done(await vendor.setStock(ctx, i.offerId, i.addressId, i.onHand, i.note)),
});
export const setBasePriceAction = defineAction({
  permission: "vendor.pricing.manage",
  schema: z.object({ offerId: z.string(), price: z.coerce.number().positive() }),
  handler: async (ctx, i) => done(await pricing.setPrice(ctx, (await pricing.ensureBaseList(ctx)).id, i.offerId, 1, i.price)),
});
export const setPriceAction = defineAction({
  permission: "vendor.pricing.manage",
  schema: z.object({ priceListId: z.string(), offerId: z.string(), minQty: z.coerce.number().int().min(1), price: z.coerce.number().positive() }),
  handler: async (ctx, i) => done(await pricing.setPrice(ctx, i.priceListId, i.offerId, i.minQty, i.price)),
});
export const removePriceAction = defineAction({
  permission: "vendor.pricing.manage",
  schema: z.object({ itemId: z.string() }),
  handler: async (ctx, i) => done(await pricing.removePrice(ctx, i.itemId)),
});
export const savePriceListAction = defineAction({
  permission: "vendor.pricing.manage",
  schema: z.object({
    id: z.string().optional(), name: z.string().trim().min(2).max(80), scope: z.enum(["CUSTOMER_GROUP", "CUSTOMER", "CONTRACT"]),
    targetGroupId: optId, targetCompanyId: optId, priority: z.coerce.number().int().min(0).max(100).optional(),
    validFrom: z.string().optional().nullable(), validTo: z.string().optional().nullable(), isActive: z.boolean().optional(),
    currencyCode: z.string().length(3).optional().nullable(),
  }),
  handler: async (ctx, i) => done({ id: (await pricing.savePriceList(ctx, { ...i, validFrom: i.validFrom ? new Date(i.validFrom) : null, validTo: i.validTo ? new Date(i.validTo) : null })).id }),
});
/** Phase 45: move a price list to another currency (prices converted at today's reference rates). */
export const convertPriceListCurrencyAction = defineAction({
  permission: "vendor.pricing.manage",
  schema: z.object({ id: z.string(), code: z.string().length(3) }),
  handler: async (ctx, i) => done(await pricing.convertPriceListCurrency(ctx, i.id, i.code)),
});
export const saveGroupAction = defineAction({
  permission: "vendor.pricing.manage",
  schema: z.object({ id: z.string().optional(), name: z.string().trim().min(2).max(80), description: z.string().trim().max(300).optional().nullable() }),
  handler: async (ctx, i) => done({ id: (await pricing.saveGroup(ctx, i)).id }),
});
export const setGroupMemberAction = defineAction({
  permission: "vendor.pricing.manage",
  schema: z.object({ groupId: z.string(), companyId: z.string(), member: z.boolean() }),
  handler: async (ctx, i) => done(await pricing.setGroupMember(ctx, i.groupId, i.companyId, i.member)),
});
export const deleteGroupAction = defineAction({
  permission: "vendor.pricing.manage",
  schema: z.object({ groupId: z.string() }),
  handler: async (ctx, i) => done(await pricing.deleteGroup(ctx, i.groupId)),
});
