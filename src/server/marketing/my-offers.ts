/**
 * "My offers" — what a business customer can get right now: FIRINGI's offers and coupons meant
 * for it (everyone, its group, its company, a CRM segment it's in, first order) and those of
 * the suppliers it can buy from. Coupons it already used up are left out. In "order from
 * FIRINGI" countries only FIRINGI's own offers count (FIRINGI picks the suppliers).
 */
import Decimal from "decimal.js";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { ForbiddenError } from "@/server/errors";
import { orderingMode } from "@/server/allocation/mode";
import { visibleVendorIds } from "@/server/data/catalogue-buyer";
import { loadActivePromotions, promoForBuyer, usage } from "@/server/services/promotions";
import { buyerPromoContext } from "./offers";

export type MyOffer = {
  id: string; name: Record<string, string>; description: Record<string, string> | null; kind: string; value: string; buyQty: number | null; freeQty: number | null;
  minQty: number | null; minOrderValue: string | null; code: string | null; firstOrderOnly: boolean; validTo: Date | null; supplier: { id: string; name: string } | null;
  usesLeft: number | null; target: { categoryId?: string; vendorId?: string; productName?: Record<string, string> } | null;
};

export async function myOffers(ctx: Ctx): Promise<MyOffer[]> {
  if ((ctx.company.type !== "CUSTOMER" && ctx.company.type !== "WHOLESALER") || !can(ctx, ["buyer.catalogue.view", "buyer.orders.place"])) throw new ForbiddenError();
  const [promos, routed, vendors] = await Promise.all([loadActivePromotions(ctx.company.countryId), orderingMode(ctx).then((m) => m === "FIRINGI"), visibleVendorIds(ctx)]);
  const buyer = await buyerPromoContext(ctx.company.id, promos);
  const visible = new Set(vendors);
  const shown = promos.filter((p) => {
    if (!p.showInOffers) return false;
    if (!promoForBuyer(p, { ...buyer, couponId: p.id })) return false;
    if (p.ownerType === "VENDOR") return !routed && !!p.ownerCompanyId && visible.has(p.ownerCompanyId);
    // FIRINGI offers co-paid by suppliers: only where one of those suppliers is visible.
    if (new Decimal(p.firingiFundPct.toString()).lt(100)) return !routed && p.acceptances.some((a) => visible.has(a.vendorCompanyId));
    return true;
  });
  const mine = await usage(shown.filter((p) => p.maxPerCustomer != null).map((p) => p.id), ctx.company.id);
  const owners = await prisma.company.findMany({ where: { id: { in: shown.map((p) => p.ownerCompanyId).filter((x): x is string => !!x) } }, select: { id: true, legalName: true, tradeName: true } });
  const productIds = shown.flatMap((p) => p.targets.map((t) => t.productId).filter((x): x is string => !!x));
  const offerIds = shown.flatMap((p) => p.targets.map((t) => t.offerId).filter((x): x is string => !!x));
  const [products, offers] = await Promise.all([
    prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true } }),
    prisma.vendorOffer.findMany({ where: { id: { in: offerIds } }, select: { id: true, packaging: { select: { variant: { select: { product: { select: { name: true } } } } } } } }),
  ]);
  const out: MyOffer[] = [];
  for (const p of shown) {
    const used = mine.get(p.id)?.count ?? 0;
    const usesLeft = p.maxPerCustomer != null ? p.maxPerCustomer - used : null;
    if (usesLeft !== null && usesLeft <= 0) continue;
    const owner = owners.find((o) => o.id === p.ownerCompanyId);
    const t = p.targets.find((x) => x.offerId || x.productId || x.categoryId || x.vendorCompanyId);
    const productName = t?.productId ? products.find((x) => x.id === t.productId)?.name : t?.offerId ? offers.find((x) => x.id === t.offerId)?.packaging.variant.product.name : undefined;
    out.push({
      id: p.id, name: p.name as Record<string, string>, description: (p.description ?? null) as Record<string, string> | null, kind: p.kind, value: p.value.toString(),
      buyQty: p.buyQty, freeQty: p.freeQty, minQty: p.minQty, minOrderValue: p.minOrderValue?.toString() ?? null, code: p.code, firstOrderOnly: p.firstOrderOnly, validTo: p.validTo,
      supplier: owner ? { id: owner.id, name: owner.tradeName ?? owner.legalName } : null, usesLeft,
      target: t ? { categoryId: t.categoryId ?? undefined, vendorId: t.vendorCompanyId ?? (p.ownerType === "VENDOR" ? p.ownerCompanyId ?? undefined : undefined), productName: (productName ?? undefined) as Record<string, string> | undefined }
        : p.ownerType === "VENDOR" ? { vendorId: p.ownerCompanyId ?? undefined } : null,
    });
  }
  // Coupons and the soonest-ending first.
  return out.sort((a, b) => Number(!!b.code) - Number(!!a.code) || (a.validTo?.getTime() ?? Infinity) - (b.validTo?.getTime() ?? Infinity));
}
