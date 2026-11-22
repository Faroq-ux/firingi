import "server-only";
/**
 * Wholesaler storefronts (Phase 61). Rules in src/lib/storefront.ts; docs in docs/storefronts.md.
 *
 *   • A wholesaler (or distributor) builds its page: link name, tagline, about text, accent colour, logo, banner,
 *     featured products; FIRINGI approves the first publication (switchable) and can suspend a store.
 *   • /s/<slug> is public: branding, delivery (minimum order, free delivery from, the fee below it), current
 *     promotional offers and clearance deals, products (never prices — those are for signed-in buyers), and
 *     "register / sign in". Businesses registering from the link are linked to the store.
 *   • Signed-in buyers see the same branding, delivery and offers on the supplier's page in the shop.
 */
import type { Prisma, StorefrontStatus } from "@prisma/client";
import Decimal from "decimal.js";
import QRCode from "qrcode";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";
import { notify } from "@/server/notify/dispatch";
import { pickLocalized } from "@/i18n/config";
import { storeUpload } from "@/server/services/storage";
import { deliveryRulesFor } from "@/server/services/cart";
import { ACCENTS, mergeStorefrontSettings, registerPathFor, slugError, slugify, type StorefrontSettings } from "@/lib/storefront";

const KEY = "storefront.settings";
const isStaff = (ctx: Ctx) => ctx.company.type === "ADMIN";
const isSeller = (ctx: Ctx) => ctx.company.type === "WHOLESALER" || ctx.company.type === "DISTRIBUTOR";
const num = (v: { toString(): string } | null | undefined) => (v == null ? null : Number(v.toString()));
const today = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); };
export const baseUrl = () => (process.env.BETTER_AUTH_URL ?? process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

// ── settings ────────────────────────────────────────────────────────────────

export async function storefrontSettings(): Promise<StorefrontSettings> {
  const row = await prisma.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: KEY } });
  return mergeStorefrontSettings(row?.value as Partial<StorefrontSettings> | null);
}

export async function saveStorefrontSettings(ctx: Ctx, input: Partial<StorefrontSettings>) {
  if (!isStaff(ctx) || !can(ctx, "admin.settings.manage")) throw new ForbiddenError();
  const before = await storefrontSettings();
  const v = mergeStorefrontSettings({ ...before, ...input });
  const row = await prisma.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: KEY } });
  if (row) await prisma.setting.update({ where: { id: row.id }, data: { value: v as unknown as Prisma.InputJsonValue } });
  else await prisma.setting.create({ data: { scope: "GLOBAL", scopeId: "", key: KEY, value: v as unknown as Prisma.InputJsonValue } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "storefront.settings", entityType: "Setting", entityId: KEY, before: before as unknown as Prisma.InputJsonValue, after: v as unknown as Prisma.InputJsonValue });
  return v;
}

// ── the supplier's own store ────────────────────────────────────────────────

function requireOwner(ctx: Ctx, manage = true) {
  if (!isSeller(ctx) || ctx.company.status !== "APPROVED") throw new ForbiddenError();
  if (!can(ctx, manage ? ["company.profile.manage", "vendor.products.manage"] : ["company.profile.manage", "vendor.products.manage", "vendor.products.view", "vendor.dashboard.view"])) throw new ForbiddenError();
}

async function uniqueSlug(base: string, companyId: string) {
  let s = base, i = 2;
  while (await prisma.storefront.findFirst({ where: { slug: s, companyId: { not: companyId } }, select: { companyId: true } })) s = `${base.slice(0, 36)}-${i++}`;
  return s;
}

export const storeUrl = (slug: string) => `${baseUrl()}/s/${slug}`;

export async function myStorefront(ctx: Ctx) {
  requireOwner(ctx, false);
  const [s, settings, company] = await Promise.all([
    prisma.storefront.findUnique({ where: { companyId: ctx.company.id } }),
    storefrontSettings(),
    prisma.company.findUniqueOrThrow({ where: { id: ctx.company.id }, select: { legalName: true, tradeName: true } }),
  ]);
  const slug = s?.slug ?? (await uniqueSlug(slugify(company.tradeName ?? company.legalName), ctx.company.id));
  const url = storeUrl(slug);
  const since = new Date(Date.now() - 30 * 86400_000);
  const [stat, links, orders] = s
    ? await Promise.all([
      prisma.storefrontStat.aggregate({ where: { companyId: ctx.company.id, day: { gte: since } }, _sum: { views: true, signups: true } }),
      prisma.storefrontLink.findMany({ where: { storeCompanyId: ctx.company.id }, orderBy: { createdAt: "desc" }, take: 100 }),
      prisma.order.aggregate({ where: { sellerCompanyId: ctx.company.id, buyerCompanyId: { in: (await prisma.storefrontLink.findMany({ where: { storeCompanyId: ctx.company.id }, select: { buyerCompanyId: true } })).map((l) => l.buyerCompanyId) }, status: { notIn: ["CANCELLED"] } }, _count: { _all: true }, _sum: { netTotal: true } }),
    ])
    : [null, [], null];
  const buyers = links.length ? await prisma.company.findMany({ where: { id: { in: links.map((l) => l.buyerCompanyId) } }, select: { id: true, legalName: true, tradeName: true, status: true } }) : [];
  const bn = new Map(buyers.map((b) => [b.id, b]));
  return {
    settings: { enabled: settings.enabled, requireApproval: settings.requireApproval, publicProducts: settings.publicProducts, maxFeatured: settings.maxFeatured },
    store: {
      exists: !!s, slug, status: (s?.status ?? "DRAFT") as StorefrontStatus, tagline: s?.tagline ?? "", about: s?.about ?? "", accent: s?.accent ?? ACCENTS[0],
      hasLogo: !!s?.logoKey, hasBanner: !!s?.bannerKey, featuredOfferIds: s?.featuredOfferIds ?? [], showProducts: s?.showProducts ?? true,
      reviewNote: s?.reviewNote ?? null, publishedAt: s?.publishedAt?.toISOString() ?? null, updatedAt: s?.updatedAt?.toISOString() ?? null,
    },
    url, qr: await QRCode.toDataURL(url, { margin: 1, width: 360, color: { dark: "#0b1315", light: "#ffffff" } }),
    stats: {
      views30: stat?._sum.views ?? 0, signups30: stat?._sum.signups ?? 0, customers: links.length,
      approved: buyers.filter((b) => b.status === "APPROVED").length, orders: orders?._count._all ?? 0, ordersNet: num(orders?._sum.netTotal) ?? 0,
    },
    customers: links.map((l) => ({ id: l.buyerCompanyId, name: bn.get(l.buyerCompanyId)?.tradeName ?? bn.get(l.buyerCompanyId)?.legalName ?? "—", status: bn.get(l.buyerCompanyId)?.status ?? "PENDING", at: l.createdAt.toISOString() })),
  };
}

export type StorefrontInput = { slug: string; tagline?: string | null; about?: string | null; accent?: string | null; featuredOfferIds?: string[]; showProducts?: boolean };

export async function saveStorefront(ctx: Ctx, i: StorefrontInput) {
  requireOwner(ctx);
  const settings = await storefrontSettings();
  const slug = i.slug.trim().toLowerCase();
  const err = slugError(slug);
  if (err) throw new AppError(`SLUG_${err}`, err === "RESERVED" ? "This link name is reserved — choose another." : "Use 3–40 letters, numbers and dashes for the link name.", 422);
  if (await prisma.storefront.findFirst({ where: { slug, companyId: { not: ctx.company.id } }, select: { companyId: true } })) throw new AppError("SLUG_TAKEN", "Another store already uses this link name.", 409);
  const accent = i.accent && (ACCENTS as readonly string[]).includes(i.accent) ? i.accent : ACCENTS[0];
  const ids = [...new Set(i.featuredOfferIds ?? [])].slice(0, settings.maxFeatured);
  if (ids.length && (await prisma.vendorOffer.count({ where: { id: { in: ids }, vendorCompanyId: ctx.company.id } })) !== ids.length) throw new ValidationError("Choose your own products.");
  const data = {
    slug, tagline: i.tagline?.trim().slice(0, 120) || null, about: i.about?.trim().slice(0, 2000) || null, accent,
    featuredOfferIds: ids, showProducts: i.showProducts ?? true,
  };
  await prisma.storefront.upsert({ where: { companyId: ctx.company.id }, create: { companyId: ctx.company.id, ...data }, update: data });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "storefront.saved", entityType: "Storefront", entityId: ctx.company.id, after: { ...data, about: data.about ? `${data.about.length} chars` : null } });
}

export async function uploadStorefrontImage(ctx: Ctx, kind: "logo" | "banner", file: File) {
  requireOwner(ctx);
  const s = await prisma.storefront.findUnique({ where: { companyId: ctx.company.id } });
  if (!s) throw new ValidationError("Save your store first.");
  const stored = await storeUpload(file, "storefront");
  if (!stored.mimeType.startsWith("image/")) throw new ValidationError("Use a JPG, PNG or WEBP picture.");
  await prisma.storefront.update({ where: { companyId: ctx.company.id }, data: kind === "logo" ? { logoKey: stored.key } : { bannerKey: stored.key } });
}

export async function removeStorefrontImage(ctx: Ctx, kind: "logo" | "banner") {
  requireOwner(ctx);
  await prisma.storefront.update({ where: { companyId: ctx.company.id }, data: kind === "logo" ? { logoKey: null } : { bannerKey: null } });
}

/** Publish (or ask FIRINGI to approve the first publication). */
export async function publishStorefront(ctx: Ctx) {
  requireOwner(ctx);
  const settings = await storefrontSettings();
  if (!settings.enabled) throw new AppError("STOREFRONTS_OFF", "Storefronts are switched off by FIRINGI.", 409);
  const s = await prisma.storefront.findUnique({ where: { companyId: ctx.company.id } });
  if (!s) throw new ValidationError("Save your store first.");
  if (s.status === "SUSPENDED") throw new AppError("SUSPENDED", "FIRINGI has suspended your store. Contact FIRINGI support.", 409);
  if (s.status === "PUBLISHED" || s.status === "PENDING") return s.status;
  const approve = settings.requireApproval && !s.publishedAt;
  const status: StorefrontStatus = approve ? "PENDING" : "PUBLISHED";
  await prisma.storefront.update({ where: { companyId: ctx.company.id }, data: { status, submittedAt: new Date(), ...(approve ? {} : { publishedAt: s.publishedAt ?? new Date() }) } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: approve ? "storefront.submitted" : "storefront.published", entityType: "Storefront", entityId: ctx.company.id });
  if (approve) {
    const admin = await prisma.company.findFirstOrThrow({ where: { type: "ADMIN" }, select: { id: true } });
    await notify("storefront.review", [{ companyId: admin.id, link: "/admin/vendors/storefronts" }], { company: ctx.company.tradeName ?? ctx.company.legalName, slug: s.slug }, { ref: { type: "Storefront", id: ctx.company.id } });
  }
  return status;
}

export async function unpublishStorefront(ctx: Ctx) {
  requireOwner(ctx);
  const s = await prisma.storefront.findUnique({ where: { companyId: ctx.company.id } });
  if (!s || s.status === "SUSPENDED") throw new ValidationError("Nothing to take offline.");
  await prisma.storefront.update({ where: { companyId: ctx.company.id }, data: { status: "DRAFT" } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "storefront.unpublished", entityType: "Storefront", entityId: ctx.company.id });
}

/** The supplier's own active products (to choose featured ones). */
export async function ownProducts(ctx: Ctx, locale: string) {
  requireOwner(ctx, false);
  const rows = await prisma.vendorOffer.findMany({
    where: { vendorCompanyId: ctx.company.id, status: "ACTIVE" }, take: 1000,
    select: { id: true, vendorSku: true, packaging: { select: { name: true, variant: { select: { sku: true, product: { select: { name: true } } } } } } },
  });
  return rows
    .map((r) => ({ id: r.id, name: pickLocalized(r.packaging.variant.product.name, locale) || "—", packaging: pickLocalized(r.packaging.name, locale) || "", sku: r.vendorSku ?? r.packaging.variant.sku }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ── FIRINGI ─────────────────────────────────────────────────────────────────

export async function adminStorefronts(ctx: Ctx) {
  if (!isStaff(ctx) || !can(ctx, ["admin.vendors.view", "admin.vendors.approve", "admin.settings.manage"])) throw new ForbiddenError();
  const since = new Date(Date.now() - 30 * 86400_000);
  const [rows, stats, links] = await Promise.all([
    prisma.storefront.findMany({ orderBy: [{ status: "asc" }, { updatedAt: "desc" }] }),
    prisma.storefrontStat.groupBy({ by: ["companyId"], where: { day: { gte: since } }, _sum: { views: true, signups: true } }),
    prisma.storefrontLink.groupBy({ by: ["storeCompanyId"], _count: { _all: true } }),
  ]);
  const cos = await prisma.company.findMany({ where: { id: { in: rows.map((r) => r.companyId) } }, select: { id: true, legalName: true, tradeName: true, type: true, country: { select: { code: true } } } });
  const cn = new Map(cos.map((c) => [c.id, c]));
  const st = new Map(stats.map((s) => [s.companyId, s._sum]));
  const ln = new Map(links.map((l) => [l.storeCompanyId, l._count._all]));
  return {
    settings: await storefrontSettings(),
    items: rows.map((r) => ({
      companyId: r.companyId, name: cn.get(r.companyId)?.tradeName ?? cn.get(r.companyId)?.legalName ?? "—", type: cn.get(r.companyId)?.type ?? "WHOLESALER", country: cn.get(r.companyId)?.country.code ?? "",
      slug: r.slug, status: r.status, tagline: r.tagline, hasLogo: !!r.logoKey, hasBanner: !!r.bannerKey, featured: r.featuredOfferIds.length,
      views30: st.get(r.companyId)?.views ?? 0, signups30: st.get(r.companyId)?.signups ?? 0, customers: ln.get(r.companyId) ?? 0,
      submittedAt: r.submittedAt?.toISOString() ?? null, publishedAt: r.publishedAt?.toISOString() ?? null, reviewNote: r.reviewNote,
    })),
  };
}

/** Approve / refuse a store waiting for its first publication, suspend or re-open a store. */
export async function decideStorefront(ctx: Ctx, companyId: string, action: "APPROVE" | "REJECT" | "SUSPEND" | "RESTORE", note?: string | null) {
  if (!isStaff(ctx) || !can(ctx, ["admin.vendors.approve", "admin.settings.manage"])) throw new ForbiddenError();
  const s = await prisma.storefront.findUnique({ where: { companyId } });
  if (!s) throw new NotFoundError("Store");
  const reason = note?.trim().slice(0, 500) || null;
  if ((action === "REJECT" || action === "SUSPEND") && !reason) throw new ValidationError("Please give a reason.");
  const ok: Record<typeof action, StorefrontStatus[]> = { APPROVE: ["PENDING"], REJECT: ["PENDING"], SUSPEND: ["PUBLISHED", "PENDING", "DRAFT"], RESTORE: ["SUSPENDED"] };
  if (!ok[action].includes(s.status)) throw new ValidationError("This store can't be changed that way now.");
  const status: StorefrontStatus = action === "APPROVE" || (action === "RESTORE" && s.publishedAt) ? "PUBLISHED" : action === "SUSPEND" ? "SUSPENDED" : "DRAFT";
  await prisma.storefront.update({ where: { companyId }, data: { status, reviewNote: reason, reviewedById: ctx.user.id, reviewedAt: new Date(), ...(status === "PUBLISHED" && !s.publishedAt ? { publishedAt: new Date() } : {}) } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: `storefront.${action.toLowerCase()}`, entityType: "Storefront", entityId: companyId, after: { status, reason } });
  await notify("storefront.decided", [{ companyId, link: "/vendor/company/storefront" }], { status: status === "PUBLISHED" ? "published" : status === "SUSPENDED" ? "suspended" : "not approved", note: reason ?? "" }, { ref: { type: "Storefront", id: companyId } });
  return status;
}

// ── what a store shows (public page and the shop) ───────────────────────────

/** Delivery terms for the store's own country, from the same rules checkout uses (amounts net, excl. VAT). */
async function deliveryTerms(store: { id: string; type: string; countryId: string }) {
  const { firingi, vendor } = await deliveryRulesFor(store.countryId, store.id);
  const vAmount = vendor?.vendorMinimumKind !== "UNITS" ? num(vendor?.vendorDeliveryMinimum) : null;
  const vUnits = vendor?.vendorMinimumKind === "UNITS" ? vendor.vendorMinimumUnits : null;
  if (store.type === "DISTRIBUTOR") {
    // the distributor delivers every order: free from its minimum, its flat rate below it (no flat rate → minimum)
    const flat = num(vendor?.vendorFlatFeeNet);
    return { minOrder: flat == null ? vAmount : null, minUnits: flat == null ? vUnits : null, freeFrom: vAmount, freeFromUnits: vUnits, feeBelow: flat, firingiFreeFrom: null as number | null };
  }
  const firingiFree = firingi?.firingiFreeEnabled ? num(firingi.firingiFreeFrom) : null;
  return { minOrder: num(firingi?.minOrderValue) ?? null, minUnits: null as number | null, freeFrom: vAmount, freeFromUnits: vUnits, feeBelow: num(firingi?.firingiDeliveryFeeNet), firingiFreeFrom: firingiFree };
}

/** The store's own promotional offers everyone may see (automatic, not limited to chosen customers) + live deals. */
async function storeOffers(store: { id: string; countryId: string }, locale: string) {
  const now = new Date();
  const promos = await prisma.promotion.findMany({
    where: {
      ownerType: "VENDOR", ownerCompanyId: store.id, status: "ACTIVE", code: null, showInOffers: true, validFrom: { lte: now },
      AND: [{ OR: [{ validTo: null }, { validTo: { gt: now } }] }, { OR: [{ countryId: null }, { countryId: store.countryId }] }],
      targets: { none: { OR: [{ customerGroupId: { not: null } }, { buyerCompanyId: { not: null } }, { crmSegmentId: { not: null } }] } },
    },
    include: { targets: true }, orderBy: [{ priority: "desc" }, { validFrom: "desc" }], take: 12,
  });
  const offerIds = promos.flatMap((p) => p.targets.map((t) => t.offerId).filter((x): x is string => !!x));
  const productIds = promos.flatMap((p) => p.targets.map((t) => t.productId).filter((x): x is string => !!x));
  const [offers, products, deals] = await Promise.all([
    prisma.vendorOffer.findMany({ where: { id: { in: offerIds } }, select: { id: true, packaging: { select: { variant: { select: { product: { select: { name: true } } } } } } } }),
    prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true } }),
    prisma.clearanceDeal.findMany({
      where: { vendorCompanyId: store.id, status: "APPROVED", startsAt: { lte: now }, endsAt: { gt: now } }, orderBy: { endsAt: "asc" }, take: 8,
      select: { id: true, kind: true, title: true, endsAt: true, bestBefore: true, offer: { select: { packaging: { select: { variant: { select: { product: { select: { name: true } } } } } } } } },
    }),
  ]);
  const on = new Map(offers.map((o) => [o.id, pickLocalized(o.packaging.variant.product.name, locale)]));
  const pn = new Map(products.map((p) => [p.id, pickLocalized(p.name, locale)]));
  return {
    promotions: promos.map((p) => ({
      id: p.id, kind: p.kind, value: Number(p.value), name: pickLocalized(p.name, locale) || "", description: p.description ? pickLocalized(p.description, locale) : "",
      minQty: p.minQty, minOrderValue: num(p.minOrderValue), buyQty: p.buyQty, freeQty: p.freeQty, firstOrderOnly: p.firstOrderOnly,
      validTo: p.validTo?.toISOString() ?? null,
      products: [...new Set(p.targets.flatMap((t) => [t.offerId ? on.get(t.offerId) : null, t.productId ? pn.get(t.productId) : null]).filter((x): x is string => !!x))].slice(0, 4),
      wholeRange: p.targets.every((t) => !t.offerId && !t.productId && !t.categoryId),
    })),
    deals: deals.map((d) => ({ id: d.id, kind: d.kind, title: d.title, product: pickLocalized(d.offer.packaging.variant.product.name, locale) || "", endsAt: d.endsAt.toISOString(), bestBefore: d.bestBefore?.toISOString().slice(0, 10) ?? null })),
  };
}

type Viewer = Ctx | null;

/** The public page's data, or null (not published / switched off). The owner and FIRINGI may preview. */
export async function publicStorefront(slug: string, viewer: Viewer, locale: string) {
  const settings = await storefrontSettings();
  const s = await prisma.storefront.findUnique({ where: { slug: slug.toLowerCase() } });
  if (!s) return null;
  const preview = !!viewer && (viewer.company.id === s.companyId || (isStaff(viewer) && can(viewer, ["admin.vendors.view", "admin.vendors.approve"])));
  if ((!settings.enabled || s.status !== "PUBLISHED") && !preview) return null;
  const co = await prisma.company.findUniqueOrThrow({
    where: { id: s.companyId },
    select: { id: true, type: true, status: true, legalName: true, tradeName: true, countryId: true, country: { select: { code: true, flag: true, name: true } }, addresses: { where: { kind: "HEAD_OFFICE" }, select: { cityName: true }, take: 1 } },
  });
  if (co.status !== "APPROVED" && !preview) return null;
  const offerWhere: Prisma.VendorOfferWhereInput = { vendorCompanyId: co.id, status: "ACTIVE", compliancePausedAt: null, packaging: { variant: { product: { status: "APPROVED" } } } };
  const showProducts = s.showProducts && (settings.publicProducts || !!viewer);
  const [count, categories, featured, others, delivery, offers] = await Promise.all([
    prisma.vendorOffer.count({ where: offerWhere }),
    prisma.$queryRaw<{ id: string; name: unknown; n: bigint }[]>`
      SELECT c.id, c.name, count(*) AS n FROM "VendorOffer" o
      JOIN "PackagingUnit" pu ON pu.id = o."packagingUnitId" JOIN "ProductVariant" v ON v.id = pu."variantId"
      JOIN "Product" p ON p.id = v."productId" JOIN "Category" c ON c.id = p."categoryId"
      WHERE o."vendorCompanyId" = ${co.id} AND o.status = 'ACTIVE' AND o."compliancePausedAt" IS NULL AND p.status = 'APPROVED'
      GROUP BY c.id, c.name ORDER BY n DESC LIMIT 12`,
    showProducts && s.featuredOfferIds.length ? prisma.vendorOffer.findMany({ where: { ...offerWhere, id: { in: s.featuredOfferIds } }, select: productSelect }) : Promise.resolve([]),
    showProducts ? prisma.vendorOffer.findMany({ where: { ...offerWhere, id: { notIn: s.featuredOfferIds } }, select: productSelect, take: 24, orderBy: { createdAt: "asc" } }) : Promise.resolve([]),
    deliveryTerms({ id: co.id, type: co.type, countryId: co.countryId }),
    storeOffers({ id: co.id, countryId: co.countryId }, locale),
  ]);
  const order = new Map(s.featuredOfferIds.map((id, i) => [id, i]));
  const present = (o: (typeof others)[number], isFeatured: boolean) => ({
    offerId: o.id, productId: o.packaging.variant.product.id, featured: isFeatured, hasImage: o.packaging.variant.product.images.length > 0,
    name: pickLocalized(o.packaging.variant.product.name, locale) || "—", packaging: pickLocalized(o.packaging.name, locale) || "", brand: o.packaging.variant.product.brand?.name ?? null,
  });
  const name = co.tradeName ?? co.legalName;
  return {
    preview: preview && s.status !== "PUBLISHED", status: s.status,
    store: { companyId: co.id, slug: s.slug, name, type: co.type, tagline: s.tagline, about: s.about, accent: s.accent ?? ACCENTS[0], hasLogo: !!s.logoKey, hasBanner: !!s.bannerKey, city: co.addresses[0]?.cityName ?? null, country: { code: co.country.code, flag: co.country.flag, name: pickLocalized(co.country.name, locale) } },
    productCount: count, showProducts,
    categories: categories.map((c) => ({ id: c.id, name: pickLocalized(c.name, locale) || "", count: Number(c.n) })),
    products: [...featured.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)).map((o) => present(o, true)), ...others.map((o) => present(o, false))].slice(0, 24),
    delivery, offers,
    registerPath: `/register/${registerPathFor(co.type)}?store=${encodeURIComponent(s.slug)}`,
    viewerIsBuyer: !!viewer && (viewer.company.type === "CUSTOMER" || viewer.company.type === "WHOLESALER") && viewer.company.id !== co.id,
  };
}

const productSelect = {
  id: true, packaging: { select: { name: true, variant: { select: { product: { select: { id: true, name: true, images: true, brand: { select: { name: true } } } } } } } },
} satisfies Prisma.VendorOfferSelect;

/** A visit to the public page (one per page view; owners and FIRINGI previews aren't counted). */
export async function countView(companyId: string) {
  const day = today();
  await prisma.storefrontStat.upsert({ where: { companyId_day: { companyId, day } }, create: { companyId, day, views: 1 }, update: { views: { increment: 1 } } }).catch(() => null);
}

/** Pictures on the public page: logo, banner, and the first picture of a product the store sells. */
export async function storefrontImageKey(slug: string, kind: string, viewer: Viewer) {
  const s = await prisma.storefront.findUnique({ where: { slug: slug.toLowerCase() } });
  if (!s) return null;
  const settings = await storefrontSettings();
  const preview = !!viewer && (viewer.company.id === s.companyId || isStaff(viewer));
  if ((!settings.enabled || s.status !== "PUBLISHED") && !preview) return null;
  if (kind === "logo") return s.logoKey;
  if (kind === "banner") return s.bannerKey;
  if (kind.startsWith("p-")) {
    const productId = kind.slice(2);
    const sells = await prisma.vendorOffer.count({ where: { vendorCompanyId: s.companyId, status: "ACTIVE", packaging: { variant: { productId, product: { status: "APPROVED" } } } } });
    if (!sells) return null;
    return (await prisma.product.findUnique({ where: { id: productId }, select: { images: true } }))?.images[0] ?? null;
  }
  return null;
}

/** For the supplier's page in the shop (signed-in buyers): branding + delivery + offers when the store is published. */
export async function shopBranding(vendorId: string, locale: string) {
  const settings = await storefrontSettings();
  if (!settings.enabled) return null;
  const s = await prisma.storefront.findUnique({ where: { companyId: vendorId } });
  const co = await prisma.company.findUnique({ where: { id: vendorId }, select: { id: true, type: true, countryId: true } });
  if (!co) return null;
  const [delivery, offers] = await Promise.all([deliveryTerms(co), storeOffers(co, locale)]);
  const published = s?.status === "PUBLISHED";
  return {
    published, slug: published ? s!.slug : null, tagline: published ? s!.tagline : null, about: published ? s!.about : null, accent: (published && s!.accent) || ACCENTS[0],
    hasLogo: published && !!s!.logoKey, hasBanner: published && !!s!.bannerKey, delivery, offers,
  };
}

// ── registrations from a store's link ───────────────────────────────────────

/** A business registered from /s/<slug>: linked to that store (once), counted, the store is told. */
export async function attachStorefrontSignup(buyerCompanyId: string, slug: string | null | undefined) {
  if (!slug) return false;
  const s = await prisma.storefront.findUnique({ where: { slug: slug.trim().toLowerCase() }, select: { companyId: true, status: true } });
  if (!s || s.status !== "PUBLISHED") return false;
  const [buyer, store] = await Promise.all([
    prisma.company.findUnique({ where: { id: buyerCompanyId }, select: { type: true, legalName: true, tradeName: true } }),
    prisma.company.findUnique({ where: { id: s.companyId }, select: { type: true } }),
  ]);
  if (!buyer || !store || registerPathFor(store.type) !== buyer.type.toLowerCase()) return false;
  if (await prisma.storefrontLink.findUnique({ where: { buyerCompanyId } })) return false;
  const day = today();
  await prisma.$transaction([
    prisma.storefrontLink.create({ data: { buyerCompanyId, storeCompanyId: s.companyId } }),
    prisma.storefrontStat.upsert({ where: { companyId_day: { companyId: s.companyId, day } }, create: { companyId: s.companyId, day, signups: 1 }, update: { signups: { increment: 1 } } }),
  ]);
  await notify("storefront.signup", [{ companyId: s.companyId, link: "/vendor/company/storefront" }], { company: buyer.tradeName ?? buyer.legalName }, { ref: { type: "Storefront", id: s.companyId } });
  return true;
}

/** Buyer: the store it joined from (shown in the shop as "your wholesaler"). */
export async function myHomeStore(ctx: Ctx) {
  if (ctx.company.type !== "CUSTOMER" && ctx.company.type !== "WHOLESALER") return null;
  const l = await prisma.storefrontLink.findUnique({ where: { buyerCompanyId: ctx.company.id }, include: { storefront: { select: { slug: true, status: true, tagline: true, logoKey: true, accent: true } } } });
  if (!l || l.storefront.status !== "PUBLISHED") return null;
  const co = await prisma.company.findUnique({ where: { id: l.storeCompanyId }, select: { legalName: true, tradeName: true } });
  return { companyId: l.storeCompanyId, name: co?.tradeName ?? co?.legalName ?? "", slug: l.storefront.slug, tagline: l.storefront.tagline, hasLogo: !!l.storefront.logoKey, accent: l.storefront.accent ?? ACCENTS[0] };
}

export const _test = { deliveryTerms, storeOffers, D: Decimal };
