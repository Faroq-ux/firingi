/** Warehouse PDFs (Phase 25): shelf labels, lot labels, packing slip, box labels — only the company's own. */
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { NotFoundError, ValidationError } from "@/server/errors";
import { requireInventory } from "@/server/inventory/service";
import { pickLocalized } from "@/i18n/config";
import { SEE } from "./bins";

const cname = (c: { legalName: string; tradeName: string | null }) => c.tradeName ?? c.legalName;
const me = (ctx: Ctx) => prisma.company.findUniqueOrThrow({ where: { id: ctx.company.id }, select: { legalName: true, tradeName: true } });

export async function binLabelsPdf(ctx: Ctx, ids: string[]) {
  requireInventory(ctx, [...SEE]);
  if (!ids.length || ids.length > 400) throw new ValidationError("Choose 1–400 shelves.");
  const bins = await prisma.bin.findMany({ where: { id: { in: ids }, companyId: ctx.company.id }, include: { address: { select: { label: true } } }, orderBy: [{ sortOrder: "asc" }, { code: "asc" }] });
  if (!bins.length) throw new NotFoundError("Shelf");
  const company = cname(await me(ctx));
  const { renderBinLabels } = await import("@/server/pdf/warehouse");
  return renderBinLabels(bins.map((b) => ({ id: b.id, code: b.code, zone: b.zone, warehouse: b.address.label, company })));
}

export async function lotLabelsPdf(ctx: Ctx, ids: string[], locale: string) {
  requireInventory(ctx, [...SEE]);
  if (!ids.length || ids.length > 400) throw new ValidationError("Choose 1–400 lots.");
  const rows = await prisma.stockBatch.findMany({
    where: { id: { in: ids }, offer: { vendorCompanyId: ctx.company.id } },
    include: { bin: { select: { code: true } }, offer: { select: { vendorSku: true, packaging: { select: { name: true, gtin: true, variant: { select: { gtin: true, product: { select: { name: true } } } } } } } } },
  });
  if (!rows.length) throw new NotFoundError("Lot");
  const company = cname(await me(ctx));
  const { renderLotLabels } = await import("@/server/pdf/warehouse");
  return renderLotLabels(rows.map((b) => ({
    id: b.id, product: pickLocalized(b.offer.packaging.variant.product.name, locale), packaging: pickLocalized(b.offer.packaging.name, locale), sku: b.offer.vendorSku,
    gtin: b.offer.packaging.gtin ?? b.offer.packaging.variant.gtin, lotCode: b.lotCode, expiresOn: b.expiresOn, bin: b.bin?.code ?? null, company,
  })));
}

async function slipData(ctx: Ctx, pickListId: string, orderId: string, locale: string) {
  requireInventory(ctx, [...SEE]);
  const plo = await prisma.pickListOrder.findFirst({
    where: { pickListId, orderId, pickList: { companyId: ctx.company.id } },
    include: { pickList: { include: { address: { select: { label: true } } } }, order: { select: { number: true, deliveryAddress: true, requestedDeliveryDate: true, buyer: { select: { legalName: true, tradeName: true } } } } },
  });
  if (!plo) throw new NotFoundError("Order");
  const lines = await prisma.pickLine.findMany({ where: { pickListId, orderId, NOT: { shortReason: "RECALLED" } }, orderBy: [{ sortKey: "asc" }] });
  const offers = await prisma.vendorOffer.findMany({ where: { id: { in: lines.map((l) => l.offerId) } }, select: { id: true, vendorSku: true, packaging: { select: { name: true, variant: { select: { product: { select: { name: true } } } } } } } });
  const a = plo.order.deliveryAddress as Record<string, string | null>;
  return {
    orderNumber: plo.order.number, date: plo.packedAt ?? new Date(), pickList: plo.pickList.number, boxes: Math.max(1, plo.boxes), supplier: cname(await me(ctx)), warehouse: plo.pickList.address.label,
    buyer: cname(plo.order.buyer), address: [a.label, a.line1, a.line2, [a.postalCode, a.city].filter(Boolean).join(" "), a.country].filter((x): x is string => !!x), requestedDeliveryDate: plo.order.requestedDeliveryDate,
    lines: lines.filter((l) => l.pickedQty > 0 || l.shortReason).map((l) => {
      const o = offers.find((x) => x.id === l.offerId);
      return { product: o ? pickLocalized(o.packaging.variant.product.name, locale) : "", packaging: o ? pickLocalized(o.packaging.name, locale) : "", sku: o?.vendorSku ?? null, lotCode: l.lotCode, expiresOn: l.expiresOn, qty: l.pickedQty, short: l.shortReason ? Math.max(0, l.qty - l.pickedQty - l.coveredQty) : 0 };
    }),
  };
}

export async function packingSlipPdf(ctx: Ctx, pickListId: string, orderId: string, locale: string) {
  const d = await slipData(ctx, pickListId, orderId, locale);
  const { renderPackingSlip } = await import("@/server/pdf/warehouse");
  return { number: d.orderNumber, pdf: await renderPackingSlip(d) };
}

export async function boxLabelsPdf(ctx: Ctx, pickListId: string, orderId: string, locale: string) {
  const d = await slipData(ctx, pickListId, orderId, locale);
  const { renderBoxLabels } = await import("@/server/pdf/warehouse");
  return { number: d.orderNumber, pdf: await renderBoxLabels(d) };
}
