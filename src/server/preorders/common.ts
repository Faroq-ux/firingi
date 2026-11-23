import "server-only";
/** Pre-orders (Phase 71): shared helpers — names, offers, list prices, buyer context, numbers, deposits. */
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { ForbiddenError, ValidationError } from "@/server/errors";
import { can } from "@/server/rbac/guard";
import type { PermissionCode } from "@/server/rbac/permissions";
import { preSettings, sellerOn, buyerOn, type PreSettings } from "./settings";

export const nameOf = (c: { legalName: string; tradeName: string | null } | null | undefined) => (c ? c.tradeName ?? c.legalName : "—");
export const SELLER_MANAGE: PermissionCode[] = ["vendor.promotions.manage", "vendor.pricing.manage"];
export const SELLER_VIEW: PermissionCode[] = [...SELLER_MANAGE, "vendor.orders.view", "vendor.orders.manage"];
export const BUYER_PLACE: PermissionCode[] = ["buyer.orders.place"];
export const BUYER_VIEW: PermissionCode[] = ["buyer.orders.place", "buyer.orders.view"];
export const num = (v: unknown) => Number(v ?? 0);

async function countryCode(countryId: string) {
  return (await prisma.country.findUnique({ where: { id: countryId }, select: { code: true } }))?.code;
}
/** The seller may use this part (and has the permission). */
export async function asSeller(ctx: Ctx, part: "campaigns" | "priceLocks", manage = true): Promise<PreSettings> {
  if (!(ctx.company.type === "DISTRIBUTOR" || ctx.company.type === "WHOLESALER") || !can(ctx, manage ? SELLER_MANAGE : SELLER_VIEW)) throw new ForbiddenError();
  const s = await preSettings();
  if (!sellerOn(s, { id: ctx.company.id, type: ctx.company.type, countryCode: await countryCode(ctx.company.countryId) }, part)) throw new ValidationError("Pre-orders are switched off for your company.");
  return s;
}
export async function asBuyer(ctx: Ctx, part: "campaigns" | "priceLocks", place = true): Promise<PreSettings> {
  if (!(ctx.company.type === "CUSTOMER" || ctx.company.type === "WHOLESALER") || !can(ctx, place ? BUYER_PLACE : BUYER_VIEW)) throw new ForbiddenError();
  const s = await preSettings();
  if (!buyerOn(s, { id: ctx.company.id, type: ctx.company.type, countryCode: await countryCode(ctx.company.countryId) }, part)) throw new ValidationError("Pre-orders are switched off for your company.");
  return s;
}

/** Offers with their product, pack and SKU (any status). */
export async function offerInfo(ids: string[], locale?: string) {
  const rows = ids.length ? await prisma.vendorOffer.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select: { id: true, status: true, vendorCompanyId: true, sellerType: true, countryId: true, vendorSku: true, packaging: { select: { name: true, unitsPerPack: true, variantId: true, variant: { select: { sku: true, product: { select: { name: true } } } } } } },
  }) : [];
  const { nameIn } = await import("@/server/benchmark/service");
  return new Map(rows.map((o) => [o.id, {
    id: o.id, status: o.status, vendorId: o.vendorCompanyId, sellerType: o.sellerType, countryId: o.countryId, variantId: o.packaging.variantId,
    product: nameIn(o.packaging.variant.product.name, locale ?? "en"),
    sku: o.packaging.variant.sku, pack: nameIn(o.packaging.name, locale ?? "en"), unitsPerPack: o.packaging.unitsPerPack,
  }]));
}
/** Today's base list price per pack of each offer. */
export async function listPrices(offerIds: string[]) {
  if (!offerIds.length) return new Map<string, number>();
  const { marketOffers } = await import("@/server/price-intel/service");
  const offers = await marketOffers({ id: { in: [...new Set(offerIds)] } });
  return new Map(offers.map((o) => [o.offerId, o.price]));
}

/** The person who placed it acts for the buyer (falls back to another buyer user who may order). */
export async function buyerCtx(userId: string, companyId: string): Promise<Ctx> {
  const { loadContext } = await import("@/server/context");
  const c = await loadContext(userId, "preorder", companyId);
  if (c && c.company.id === companyId && can(c, "buyer.orders.place")) return c;
  const others = await prisma.membership.findMany({ where: { companyId, status: "ACTIVE" }, select: { userId: true }, take: 20 });
  for (const m of others) {
    const o = await loadContext(m.userId, "preorder", companyId);
    if (o && o.company.id === companyId && can(o, "buyer.orders.place")) return o;
  }
  throw new ValidationError("Nobody at the buyer may place orders.");
}

export async function nextNo(name: string, prefix: string) {
  const { nextNumber } = await import("@/server/services/orders");
  return prisma.$transaction((tx) => nextNumber(tx, name, prefix));
}

/** A deposit payment request (kept as credit, used on the invoices); returns the pay link. */
export async function depositRequest(companyId: string, amount: number, ref: string, createdById: string, hours: number) {
  if (!(amount > 0)) return null;
  const { createRequest } = await import("@/server/payments/service");
  const r = await createRequest({ companyId, source: "PREORDER", deposit: { amount, ref }, createdById, expiresInHours: Math.max(1, Math.min(24 * 60, Math.round(hours))) });
  return r;
}
export async function depositState(requestId: string | null, amount: number) {
  if (!(amount > 0) || !requestId) return { due: amount > 0, paid: false, link: null as string | null, status: null as string | null };
  const r = await prisma.paymentRequest.findUnique({ where: { id: requestId }, select: { status: true, token: true } });
  const paid = r?.status === "PAID";
  return { due: !paid, paid, link: r && !paid && (r.status === "OPEN" || r.status === "PROCESSING") ? `/pay/${r.token}` : null, status: r?.status ?? null };
}
export const days = (n: number) => n * 86400_000;
