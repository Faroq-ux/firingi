/**
 * Phase 39 — scan to reorder: a product's barcode (EAN / GTIN on the shelf) or the supplier's code →
 * the offer this buyer orders (the one bought before, else the only one), at the usual quantity, in the cart.
 */
import "server-only";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { pickLocalized } from "@/i18n/config";
import { ForbiddenError } from "@/server/errors";
import { can } from "@/server/rbac/guard";

export type ScanResult =
  | { status: "ADDED"; offerId: string; name: string; packaging: string; supplier: string; qty: number; total: number; unitNet: number }
  | { status: "CHOOSE"; code: string; options: { offerId: string; name: string; packaging: string; supplier: string; unitNet: number | null; qty: number; boughtBefore: boolean }[] }
  | { status: "NOT_FOUND"; code: string };

export async function scanToCart(ctx: Ctx, raw: string, locale: string): Promise<ScanResult> {
  if (!can(ctx, "buyer.orders.place")) throw new ForbiddenError();
  const code = raw.trim().replace(/[\s-]/g, "");
  if (!code) return { status: "NOT_FOUND", code: raw };
  const { searchAcrossSuppliers } = await import("@/server/data/catalogue-buyer");
  const { items } = await searchAcrossSuppliers(ctx, code);
  const exact = items.filter((i) => i.price && (i.gtin === code || i.unitGtin === code || i.sku?.toLowerCase() === code.toLowerCase()));
  if (!exact.length) return { status: "NOT_FOUND", code };
  const last = await prisma.orderLine.findMany({
    where: { offerId: { in: exact.map((i) => i.offerId) }, order: { buyerCompanyId: ctx.company.id } },
    orderBy: { order: { placedAt: "desc" } }, distinct: ["offerId"], select: { offerId: true, qtyOrdered: true },
  });
  const lastQty = new Map(last.map((l) => [l.offerId, l.qtyOrdered]));
  const usual = (i: (typeof exact)[number]) => Math.max(i.minOrderQty, lastQty.get(i.offerId) ?? i.minOrderQty);
  const bought = exact.filter((i) => lastQty.has(i.offerId));
  const pick = bought[0] ?? (exact.length === 1 ? exact[0] : null);
  if (!pick) {
    return {
      status: "CHOOSE", code,
      options: exact.slice(0, 8).map((i) => ({ offerId: i.offerId, name: pickLocalized(i.name, locale), packaging: pickLocalized(i.packaging.name, locale), supplier: i.vendor.name, unitNet: i.price ? Number(i.price.unitPriceNet) : null, qty: usual(i), boughtBefore: false })),
    };
  }
  const { addToCart } = await import("@/server/services/cart");
  const qty = usual(pick);
  await addToCart(ctx, pick.offerId, qty);
  const inCart = await prisma.cartItem.findFirst({ where: { cart: { buyerCompanyId: ctx.company.id, userId: ctx.user.id }, offerId: pick.offerId }, select: { qty: true } })
    ?? await prisma.cartItem.findFirst({ where: { cart: { buyerCompanyId: ctx.company.id }, offerId: pick.offerId }, select: { qty: true } });
  return { status: "ADDED", offerId: pick.offerId, name: pickLocalized(pick.name, locale), packaging: pickLocalized(pick.packaging.name, locale), supplier: pick.vendor.name, qty, total: inCart?.qty ?? qty, unitNet: Number(pick.price!.unitPriceNet) };
}
