/** Choice lists for the inventory screens (own products and warehouses), labelled in the user's language. */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { pickLocalized } from "@/i18n/config";
import { requireInventory, warehouses } from "./service";

export const offerLabel = (product: Prisma.JsonValue, packaging: Prisma.JsonValue, sku: string | null, locale: string) =>
  `${pickLocalized(product as never, locale)} · ${pickLocalized(packaging as never, locale)}${sku ? ` · ${sku}` : ""}`;

export async function offerOptions(ctx: Ctx, locale: string) {
  requireInventory(ctx);
  const offers = await prisma.vendorOffer.findMany({
    where: { vendorCompanyId: ctx.company.id, status: { not: "ARCHIVED" } },
    select: { id: true, vendorSku: true, packaging: { select: { name: true, variant: { select: { product: { select: { name: true } } } } } } },
  });
  return offers.map((o) => ({ id: o.id, label: offerLabel(o.packaging.variant.product.name, o.packaging.name, o.vendorSku, locale) })).sort((a, b) => a.label.localeCompare(b.label, locale));
}

export async function warehouseOptions(ctx: Ctx) {
  return (await warehouses(ctx)).map((w) => ({ id: w.id, label: w.label }));
}

export async function deliveryAddressOptions(ctx: Ctx) {
  const rows = await prisma.address.findMany({ where: { companyId: ctx.company.id, kind: "DELIVERY", isActive: true }, orderBy: [{ isDefault: "desc" }, { label: "asc" }], select: { id: true, label: true, cityName: true } });
  return rows.map((r) => ({ id: r.id, label: `${r.label} · ${r.cityName}` }));
}
