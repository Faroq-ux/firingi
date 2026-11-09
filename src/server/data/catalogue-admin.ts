/** Admin catalogue reads (+ tiny shared helpers). */
import type { OfferStatus, Prisma, PriceListScope, ProductStatus, SellerType } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { ForbiddenError, NotFoundError } from "@/server/errors";

/** Which of these products have at least one image (used by catalogue cards). */
export async function productsWithImages(ids: string[]) {
  const rows = await prisma.product.findMany({ where: { id: { in: ids }, NOT: { images: { isEmpty: true } } }, select: { id: true } });
  return new Set(rows.map((r) => r.id));
}

function requireView(ctx: Ctx) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, ["admin.catalogue.view", "admin.catalogue.manage", "admin.catalogue.approve", "admin.vendors.view", "admin.pricing.view"]))
    throw new ForbiddenError();
}

export async function adminProducts(ctx: Ctx, f: { q?: string; status?: ProductStatus; categoryId?: string; page?: number }) {
  requireView(ctx);
  const where: Prisma.ProductWhereInput = {
    ...(f.q ? { searchText: { contains: f.q.toLowerCase() } } : {}),
    ...(f.status ? { status: f.status } : {}),
    ...(f.categoryId ? { categoryId: f.categoryId } : {}),
  };
  const page = Math.max(1, f.page ?? 1);
  const [rows, total] = await Promise.all([
    prisma.product.findMany({
      where,
      include: {
        brand: { select: { name: true } }, category: { select: { name: true, restriction: true } }, taxCategory: { select: { code: true } },
        proposedBy: { select: { legalName: true } },
        variants: { select: { sku: true, _count: { select: { packagings: true } }, packagings: { select: { _count: { select: { offers: true } } } } } },
      },
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * 50,
      take: 50,
    }),
    prisma.product.count({ where }),
  ]);
  return { rows, total, page, pageCount: Math.max(1, Math.ceil(total / 50)) };
}

export async function adminProduct(ctx: Ctx, id: string) {
  requireView(ctx);
  const p = await prisma.product.findUnique({
    where: { id },
    include: {
      brand: true, category: true, proposedBy: { select: { id: true, legalName: true } },
      variants: {
        orderBy: { sku: "asc" },
        include: {
          packagings: {
            orderBy: { unitsPerPack: "asc" },
            include: { offers: { include: { vendor: { select: { id: true, legalName: true, type: true } } } } },
          },
        },
      },
    },
  });
  if (!p) throw new NotFoundError("Product");
  return p;
}

export async function catalogueOptions() {
  const [categories, brands, taxCategories, units] = await Promise.all([
    prisma.category.findMany({ select: { id: true, name: true, depth: true, path: true, restriction: true, isActive: true, defaultTaxCategoryId: true }, orderBy: [{ path: "asc" }] }),
    prisma.brand.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.taxCategory.findMany({ select: { id: true, code: true } }),
    prisma.unitOfMeasure.findMany({ select: { code: true, name: true } }),
  ]);
  return { categories, brands, taxCategories, units };
}

/** Category tree sorted depth-first (path order reflects ids, so we sort by the tree). */
export async function categoryTreeOrdered() {
  const all = await prisma.category.findMany({
    include: { _count: { select: { products: true, children: true } }, defaultTaxCategory: { select: { code: true } } },
  });
  const byParent = new Map<string | null, typeof all>();
  for (const c of all) byParent.set(c.parentId, [...(byParent.get(c.parentId) ?? []), c]);
  for (const list of byParent.values()) list.sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.getTime() - b.createdAt.getTime());
  const out: typeof all = [];
  const walk = (parent: string | null) => { for (const c of byParent.get(parent) ?? []) { out.push(c); walk(c.id); } };
  walk(null);
  return out;
}

export async function adminOffers(ctx: Ctx, f: { sellerType?: SellerType; status?: OfferStatus; q?: string; page?: number }) {
  requireView(ctx);
  const where: Prisma.VendorOfferWhereInput = {
    ...(f.sellerType ? { sellerType: f.sellerType } : {}),
    ...(f.status ? { status: f.status } : {}),
    ...(f.q ? { OR: [{ packaging: { variant: { product: { searchText: { contains: f.q.toLowerCase() } } } } }, { vendor: { legalName: { contains: f.q, mode: "insensitive" } } }] } : {}),
  };
  const page = Math.max(1, f.page ?? 1);
  const [rows, total] = await Promise.all([
    prisma.vendorOffer.findMany({
      where,
      include: {
        vendor: { select: { id: true, legalName: true, type: true, status: true, country: { select: { flag: true } } } },
        packaging: { include: { variant: { include: { product: { select: { id: true, name: true, status: true } } } } } },
        stockLevels: { select: { onHand: true, reserved: true } },
        prices: { where: { priceList: { scope: "BASE" } }, select: { minQty: true, unitPriceNet: true }, orderBy: { minQty: "asc" } },
      },
      orderBy: [{ updatedAt: "desc" }],
      skip: (page - 1) * 50,
      take: 50,
    }),
    prisma.vendorOffer.count({ where }),
  ]);
  return { rows, total, page, pageCount: Math.max(1, Math.ceil(total / 50)) };
}

export async function adminPriceLists(ctx: Ctx, f: { sellerType?: SellerType; scopes?: PriceListScope[] }) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, ["admin.pricing.view", "admin.pricing.manage", "admin.catalogue.view", "admin.customers.view", "admin.vendors.view"])) throw new ForbiddenError();
  return prisma.priceList.findMany({
    where: { ...(f.sellerType ? { vendor: { type: f.sellerType } } : {}), ...(f.scopes ? { scope: { in: f.scopes } } : {}) },
    include: {
      vendor: { select: { id: true, legalName: true, type: true } }, country: { select: { flag: true, code: true } },
      targetGroup: { select: { name: true } }, targetCompany: { select: { id: true, legalName: true } }, _count: { select: { items: true } },
    },
    orderBy: [{ vendor: { legalName: "asc" } }, { scope: "asc" }],
  });
}

export async function adminCustomerGroups(ctx: Ctx) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, ["admin.customers.view", "admin.customers.manage", "admin.pricing.view"])) throw new ForbiddenError();
  return prisma.customerGroup.findMany({
    include: { owner: { select: { legalName: true } }, members: { include: { company: { select: { id: true, legalName: true } } } }, _count: { select: { priceLists: true } } },
    orderBy: [{ owner: { legalName: "asc" } }, { name: "asc" }],
  });
}

export async function adminVariants(ctx: Ctx, q?: string) {
  requireView(ctx);
  return prisma.productVariant.findMany({
    where: q ? { OR: [{ sku: { contains: q.toUpperCase() } }, { gtin: { contains: q } }, { product: { searchText: { contains: q.toLowerCase() } } }] } : {},
    include: { product: { select: { id: true, name: true, status: true } }, packagings: { include: { uom: true } } },
    orderBy: { sku: "asc" },
    take: 300,
  });
}

export async function adminUnits(ctx: Ctx) {
  requireView(ctx);
  return prisma.unitOfMeasure.findMany({ include: { _count: { select: { packagings: true } } }, orderBy: { code: "asc" } });
}

export async function adminBrands(ctx: Ctx) {
  requireView(ctx);
  return prisma.brand.findMany({ include: { _count: { select: { products: true } } }, orderBy: { name: "asc" } });
}
