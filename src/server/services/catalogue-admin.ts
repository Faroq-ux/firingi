/**
 * FIRINGI catalogue management: category tree, brands, master products (with variants
 * and packaging units), and approval of vendor-proposed products and vendor offers.
 */
import type { OfferStatus, Prisma, Restriction } from "@prisma/client";
import { prisma, type Tx } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "./audit";
import { notifyCompany } from "./notify";

export type L10n = { en: string; pt?: string | null; es?: string | null };
const cleanL10n = (l: L10n) => Object.fromEntries(Object.entries(l).filter(([, v]) => v && String(v).trim()).map(([k, v]) => [k, String(v).trim()]));

function requireCatalogue(ctx: Ctx, perm: "admin.catalogue.manage" | "admin.catalogue.approve") {
  if (ctx.company.type !== "ADMIN" || !can(ctx, perm)) throw new ForbiddenError();
}

const slugify = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "category";

// ── Search text ──────────────────────────────────────────────────────────────

/** Rebuild Product.searchText (names in all languages, brand, SKUs, GTINs). */
export async function refreshSearchText(tx: Tx, productId: string) {
  const p = await tx.product.findUniqueOrThrow({
    where: { id: productId },
    include: { brand: true, variants: { include: { packagings: true } } },
  });
  const parts = [
    ...Object.values((p.name ?? {}) as Record<string, string>),
    p.brand?.name,
    ...p.variants.flatMap((v) => [v.sku, v.gtin, ...v.packagings.map((pk) => pk.gtin)]),
  ].filter(Boolean);
  await tx.product.update({ where: { id: productId }, data: { searchText: parts.join(" ").toLowerCase() } });
}

// ── Categories ───────────────────────────────────────────────────────────────

export async function saveCategory(
  ctx: Ctx,
  input: { id?: string; name: L10n; parentId?: string | null; restriction?: Restriction | null; defaultTaxCategoryId?: string | null; isActive?: boolean },
) {
  requireCatalogue(ctx, "admin.catalogue.manage");
  if (!input.name.en?.trim()) throw new ValidationError("English name is required.");
  return prisma.$transaction(async (tx) => {
    const parent = input.parentId ? await tx.category.findUnique({ where: { id: input.parentId } }) : null;
    if (input.parentId && !parent) throw new NotFoundError("Parent category");
    const name = cleanL10n(input.name);
    if (input.id) {
      const existing = await tx.category.findUnique({ where: { id: input.id } });
      if (!existing) throw new NotFoundError("Category");
      // A category can't move under itself or one of its descendants.
      if (parent && (parent.id === existing.id || parent.path.includes(`/${existing.id}/`))) throw new ValidationError("A category can't be moved under itself.");
      const newPath = `${parent?.path ?? "/"}${existing.id}/`;
      const depthDelta = (parent ? parent.depth + 1 : 0) - existing.depth;
      await tx.category.update({
        where: { id: existing.id },
        data: {
          name, parentId: parent?.id ?? null, path: newPath, depth: existing.depth + depthDelta,
          restriction: input.restriction ?? null, defaultTaxCategoryId: input.defaultTaxCategoryId ?? null, isActive: input.isActive ?? existing.isActive,
        },
      });
      if (newPath !== existing.path) {
        // Re-root the whole subtree (materialized paths + depth).
        await tx.$executeRaw`UPDATE "Category" SET path = ${newPath}::text || substring(path from ${existing.path.length + 1}::int), depth = depth + ${depthDelta}::int
                             WHERE path LIKE ${existing.path + "%"} AND id <> ${existing.id}`;
      }
      await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "category.updated", entityType: "Category", entityId: existing.id, before: { name: existing.name, parentId: existing.parentId, restriction: existing.restriction }, after: { name, parentId: parent?.id ?? null, restriction: input.restriction ?? null } }, tx);
      return { id: existing.id };
    }
    const siblings = await tx.category.count({ where: { parentId: parent?.id ?? null } });
    let slug = slugify(input.name.en);
    if (await tx.category.findUnique({ where: { slug } })) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
    const created = await tx.category.create({
      data: { name, slug, parentId: parent?.id ?? null, path: "", depth: parent ? parent.depth + 1 : 0, sortOrder: siblings, restriction: input.restriction ?? null, defaultTaxCategoryId: input.defaultTaxCategoryId ?? null },
    });
    await tx.category.update({ where: { id: created.id }, data: { path: `${parent?.path ?? "/"}${created.id}/` } });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "category.created", entityType: "Category", entityId: created.id, after: { name, parentId: parent?.id ?? null } }, tx);
    return { id: created.id };
  });
}

/** Move a category one step up / down among its siblings. */
export async function moveCategory(ctx: Ctx, id: string, direction: "up" | "down") {
  requireCatalogue(ctx, "admin.catalogue.manage");
  await prisma.$transaction(async (tx) => {
    const c = await tx.category.findUnique({ where: { id } });
    if (!c) throw new NotFoundError("Category");
    const siblings = await tx.category.findMany({ where: { parentId: c.parentId }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
    const i = siblings.findIndex((s) => s.id === id);
    const j = direction === "up" ? i - 1 : i + 1;
    if (j < 0 || j >= siblings.length) return;
    [siblings[i], siblings[j]] = [siblings[j], siblings[i]];
    for (const [idx, s] of siblings.entries()) if (s.sortOrder !== idx) await tx.category.update({ where: { id: s.id }, data: { sortOrder: idx } });
  });
}

export async function listCategoryTree() {
  return prisma.category.findMany({
    include: { _count: { select: { products: true } }, defaultTaxCategory: { select: { code: true } } },
    orderBy: [{ depth: "asc" }, { sortOrder: "asc" }],
  });
}

// ── Brands ───────────────────────────────────────────────────────────────────

export async function saveBrand(ctx: Ctx, input: { id?: string; name: string; isActive?: boolean }) {
  requireCatalogue(ctx, "admin.catalogue.manage");
  const name = input.name.trim();
  if (name.length < 1) throw new ValidationError("Name is required.");
  const clash = await prisma.brand.findFirst({ where: { name: { equals: name, mode: "insensitive" }, NOT: input.id ? { id: input.id } : undefined } });
  if (clash) throw new AppError("DUPLICATE", "A brand with this name already exists.", 409);
  const b = input.id
    ? await prisma.brand.update({ where: { id: input.id }, data: { name, isActive: input.isActive ?? true } })
    : await prisma.brand.create({ data: { name } });
  if (input.id) {
    // Brand name is part of product search text.
    const products = await prisma.product.findMany({ where: { brandId: b.id }, select: { id: true } });
    for (const p of products) await refreshSearchText(prisma, p.id);
  }
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: input.id ? "brand.updated" : "brand.created", entityType: "Brand", entityId: b.id, after: { name } });
  return b;
}

// ── Products, variants, packaging ────────────────────────────────────────────

export type ProductInput = {
  id?: string; name: L10n; description?: L10n | null; categoryId: string; brandId?: string | null; taxCategoryId: string;
  restriction?: Restriction | null; hsCode?: string | null; originCountryCode?: string | null;
};

export async function validateProductRefs(tx: Tx, i: Pick<ProductInput, "categoryId" | "brandId" | "taxCategoryId">) {
  const [cat, tax, brand] = await Promise.all([
    tx.category.findUnique({ where: { id: i.categoryId } }),
    tx.taxCategory.findUnique({ where: { id: i.taxCategoryId } }),
    i.brandId ? tx.brand.findUnique({ where: { id: i.brandId } }) : Promise.resolve(null),
  ]);
  if (!cat) throw new ValidationError("Choose a category.");
  if (!tax) throw new ValidationError("Choose a tax category.");
  if (i.brandId && !brand) throw new ValidationError("Unknown brand.");
}

export async function saveProduct(ctx: Ctx, input: ProductInput) {
  requireCatalogue(ctx, "admin.catalogue.manage");
  if (!input.name.en?.trim()) throw new ValidationError("English name is required.");
  return prisma.$transaction(async (tx) => {
    await validateProductRefs(tx, input);
    const data = {
      name: cleanL10n(input.name), description: input.description ? cleanL10n(input.description) : undefined, categoryId: input.categoryId,
      brandId: input.brandId || null, taxCategoryId: input.taxCategoryId, restriction: input.restriction ?? null,
      hsCode: input.hsCode?.trim() || null, originCountryCode: input.originCountryCode?.trim().toUpperCase() || null,
    };
    const p = input.id
      ? await tx.product.update({ where: { id: input.id }, data })
      : await tx.product.create({ data: { ...data, status: "APPROVED", approvedById: ctx.user.id, approvedAt: new Date() } });
    await refreshSearchText(tx, p.id);
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: input.id ? "product.updated" : "product.created", entityType: "Product", entityId: p.id, after: data }, tx);
    return { id: p.id };
  });
}

export const newSku = () => `FIR-${Math.random().toString(36).slice(2, 6).toUpperCase()}${Date.now().toString(36).slice(-4).toUpperCase()}`;

export async function saveVariant(ctx: Ctx, input: { id?: string; productId: string; sku?: string | null; gtin?: string | null; attributes?: Record<string, string> | null; isActive?: boolean }) {
  requireCatalogue(ctx, "admin.catalogue.manage");
  const sku = input.sku?.trim().toUpperCase() || (input.id ? undefined : newSku());
  if (sku && (await prisma.productVariant.findFirst({ where: { sku, NOT: input.id ? { id: input.id } : undefined } })))
    throw new AppError("DUPLICATE", `SKU ${sku} is already used.`, 409);
  return prisma.$transaction(async (tx) => {
    const data = { gtin: input.gtin?.trim() || null, attributes: (input.attributes ?? undefined) as Prisma.InputJsonValue | undefined, ...(sku ? { sku } : {}), ...(input.isActive !== undefined ? { isActive: input.isActive } : {}) };
    const v = input.id
      ? await tx.productVariant.update({ where: { id: input.id }, data })
      : await tx.productVariant.create({ data: { ...data, sku: sku!, productId: input.productId } });
    await refreshSearchText(tx, v.productId);
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: input.id ? "variant.updated" : "variant.created", entityType: "ProductVariant", entityId: v.id, after: data }, tx);
    return { id: v.id };
  });
}

export async function savePackaging(ctx: Ctx, input: { id?: string; variantId: string; uomCode: string; name: L10n; unitsPerPack: number; gtin?: string | null; netWeightKg?: number | null; isActive?: boolean }) {
  requireCatalogue(ctx, "admin.catalogue.manage");
  if (!(input.unitsPerPack >= 1)) throw new ValidationError("Units per pack must be at least 1.");
  return prisma.$transaction(async (tx) => {
    if (!(await tx.unitOfMeasure.findUnique({ where: { code: input.uomCode } }))) throw new ValidationError("Unknown unit.");
    const data = { uomCode: input.uomCode, name: cleanL10n(input.name), unitsPerPack: input.unitsPerPack, gtin: input.gtin?.trim() || null, netWeightKg: input.netWeightKg ?? null, ...(input.isActive !== undefined ? { isActive: input.isActive } : {}) };
    const pk = input.id
      ? await tx.packagingUnit.update({ where: { id: input.id }, data })
      : await tx.packagingUnit.create({ data: { ...data, variantId: input.variantId } });
    const v = await tx.productVariant.findUniqueOrThrow({ where: { id: pk.variantId } });
    await refreshSearchText(tx, v.productId);
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: input.id ? "packaging.updated" : "packaging.created", entityType: "PackagingUnit", entityId: pk.id, after: data }, tx);
    return { id: pk.id };
  });
}

// ── Approvals ────────────────────────────────────────────────────────────────

/** Approve / reject a vendor-proposed product. Its pending offers follow the decision. */
export async function reviewProduct(ctx: Ctx, productId: string, decision: "APPROVED" | "REJECTED", note?: string | null) {
  requireCatalogue(ctx, "admin.catalogue.approve");
  const p = await prisma.product.findUnique({ where: { id: productId } });
  if (!p) throw new NotFoundError("Product");
  if (p.status !== "PENDING_APPROVAL") throw new AppError("BAD_STATUS", "This product is not waiting for approval.");
  if (decision === "REJECTED" && !note?.trim()) throw new ValidationError("Please give a reason for the vendor.");
  await prisma.$transaction(async (tx) => {
    await tx.product.update({
      where: { id: productId },
      data: { status: decision, reviewNote: note?.trim() || null, ...(decision === "APPROVED" ? { approvedById: ctx.user.id, approvedAt: new Date() } : {}) },
    });
    await tx.vendorOffer.updateMany({
      where: { status: "PENDING_APPROVAL", packaging: { variant: { productId } } },
      data: { status: decision === "APPROVED" ? "ACTIVE" : "REJECTED", reviewNote: note?.trim() || null, reviewedById: ctx.user.id, reviewedAt: new Date() },
    });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: `product.${decision.toLowerCase()}`, entityType: "Product", entityId: productId, before: { status: p.status }, after: { status: decision, note } }, tx);
  });
  if (p.proposedByCompanyId) {
    const name = ((p.name as Record<string, string>).en ?? "product");
    await notifyCompany(p.proposedByCompanyId, {
      type: `product.${decision.toLowerCase()}`,
      title: decision === "APPROVED" ? "Product approved" : "Product not approved",
      body: decision === "APPROVED" ? `"${name}" is approved and your offer is now live.` : `"${name}" was not approved: ${note}`,
      link: "/vendor/products/catalogue",
    });
  }
}

/** Approve, reject or suspend a vendor offer. */
export async function reviewOffer(ctx: Ctx, offerId: string, to: Extract<OfferStatus, "ACTIVE" | "REJECTED" | "PAUSED">, note?: string | null) {
  requireCatalogue(ctx, "admin.catalogue.approve");
  const o = await prisma.vendorOffer.findUnique({ where: { id: offerId }, include: { packaging: { include: { variant: { include: { product: true } } } } } });
  if (!o) throw new NotFoundError("Offer");
  if (to === "ACTIVE" && o.packaging.variant.product.status !== "APPROVED") throw new ValidationError("Approve the product first.");
  if (to !== "ACTIVE" && !note?.trim()) throw new ValidationError("Please give a reason for the vendor.");
  await prisma.$transaction(async (tx) => {
    await tx.vendorOffer.update({ where: { id: offerId }, data: { status: to, reviewNote: note?.trim() || null, reviewedById: ctx.user.id, reviewedAt: new Date() } });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: `offer.admin_${to.toLowerCase()}`, entityType: "VendorOffer", entityId: offerId, before: { status: o.status }, after: { status: to, note } }, tx);
  });
  if (to !== "ACTIVE")
    await notifyCompany(o.vendorCompanyId, { type: "offer.review", title: to === "REJECTED" ? "Offer not approved" : "Offer suspended by FIRINGI", body: `${(o.packaging.variant.product.name as Record<string, string>).en}: ${note}`, link: "/vendor/products/catalogue" });
}
