/**
 * API v2 operations that combine services:
 *  • suppliers: list own offers; sync price / stock / minimums from their ERP (the same engine as
 *    the file import: preview, big-change check, apply, history in Products › Import & sync);
 *  • buyers: place an order in one call (lines → cart → checkout), with the same checks as the
 *    portal (visibility, minimums, credit, risk, pay-before-shipping).
 */
import { z } from "zod";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { AppError, ForbiddenError, ValidationError } from "@/server/errors";
import { FIELDS, MAX_ROWS, applyImport, importRun, previewImport, templateRows, type Mapping, type Sheet } from "@/server/integrations/catalogue-import";
import { addToCart, cartCount, clearCart } from "@/server/services/cart";
import { placeOrder } from "@/server/services/orders";
import { requireBuyer } from "./v2";

// ── suppliers: offers ──────────────────────────────────────────────────────

export async function listOwnOffers(ctx: Ctx) {
  const { header, rows } = await templateRows(ctx);
  const ids = await prisma.vendorOffer.findMany({
    where: { vendorCompanyId: ctx.company.id, status: { in: ["ACTIVE", "PAUSED", "PENDING_APPROVAL"] } }, orderBy: { createdAt: "asc" }, select: { id: true, status: true },
  });
  return {
    offers: rows.map((r, i) => {
      const o = Object.fromEntries(header.map((h, j) => [h, r[j]])) as Record<string, string>;
      return {
        id: ids[i]?.id ?? null, status: ids[i]?.status ?? null, vendorSku: o.vendor_sku || null, gtin: o.gtin || null, name: o.name,
        priceNet: o.price || null, stock: o.stock === "" ? null : Number(o.stock), warehouse: o.warehouse || null,
        minQty: Number(o.min_qty), qtyStep: Number(o.qty_step), leadDays: Number(o.lead_days),
      };
    }),
  };
}

const numOrStr = z.union([z.number(), z.string().max(40)]);
export const SyncBody = z.object({
  rows: z.array(z.object({
    vendorSku: z.string().max(80).optional(), gtin: z.string().max(20).optional(),
    priceNet: numOrStr.optional(), stock: z.number().int().min(0).optional(), warehouse: z.string().max(120).optional(),
    minQty: z.number().int().min(1).optional(), qtyStep: z.number().int().min(1).optional(), leadDays: z.number().int().min(0).optional(), active: z.boolean().optional(),
  }).strict()).min(1).max(MAX_ROWS),
  dryRun: z.boolean().optional(),
  confirmBigChanges: z.boolean().optional(),
}).strict();

const KEYS: Record<string, (typeof FIELDS)[number]> = { vendorSku: "vendor_sku", gtin: "gtin", priceNet: "price", stock: "stock", warehouse: "warehouse", minQty: "min_qty", qtyStep: "qty_step", leadDays: "lead_days", active: "active" };

/** POST /offers/sync — the ERP sends its current prices / stock; FIRINGI applies what changed. */
export async function syncOffers(ctx: Ctx, input: z.infer<typeof SyncBody>) {
  const used = Object.keys(KEYS).filter((k) => input.rows.some((r) => (r as Record<string, unknown>)[k] !== undefined));
  const sheet: Sheet = {
    headers: used,
    rows: input.rows.map((r) => used.map((k) => { const v = (r as Record<string, unknown>)[k]; return v === undefined ? "" : typeof v === "boolean" ? (v ? "yes" : "no") : String(v); })),
  };
  const mapping: Mapping = Object.fromEntries(used.map((k) => [k, KEYS[k]]));
  const run = await previewImport(ctx, { sheet, mapping, source: "API", fileName: "api" });
  const view = await importRun(ctx, run.id);
  const rows = view.rows.map((r) => ({ index: r.line - 2, status: r.status, offerId: r.offerId, changes: r.changes, errors: r.errors, bigPriceChange: r.big }));
  if (input.dryRun) {
    await prisma.importRun.update({ where: { id: run.id }, data: { status: "CANCELLED" } });
    return { runId: run.id, dryRun: true, summary: view.summary, rows };
  }
  try {
    const result = await applyImport(ctx, run.id, { confirmBig: input.confirmBigChanges });
    return { runId: run.id, applied: result.applied, failed: result.failed, failures: result.failures.map((f) => ({ index: f.line - 2, error: f.error })), summary: view.summary, rows };
  } catch (e) {
    if (e instanceof AppError && e.code === "BIG_CHANGES") {
      await prisma.importRun.update({ where: { id: run.id }, data: { status: "CANCELLED", heldReason: e.message } });
      throw new AppError("BIG_CHANGES", `${e.message} Send again with "confirmBigChanges": true.`, 409);
    }
    throw e;
  }
}

// ── buyers: place an order ─────────────────────────────────────────────────

export const PlaceBody = z.object({
  lines: z.array(z.object({ offerId: z.string().min(1).max(40), qty: z.number().int().min(1).max(100_000) }).strict()).min(1).max(200),
  deliveryAddressId: z.string().max(40).optional(),
  requestedDeliveryDate: z.string().date().optional(),
  notes: z.string().max(1000).optional(),
}).strict();

export async function placeOrderViaApi(ctx: Ctx, input: z.infer<typeof PlaceBody>) {
  requireBuyer(ctx);
  if (!can(ctx, "buyer.orders.place")) throw new ForbiddenError();
  // The key's user has a cart in the portal: don't mix it into this order.
  if ((await cartCount(ctx)) > 0) throw new AppError("CART_NOT_EMPTY", "This user has products in their cart in the FIRINGI portal. Empty it (or use a key of another user) and try again.", 409);
  const address = input.deliveryAddressId
    ? await prisma.address.findFirst({ where: { id: input.deliveryAddressId, companyId: ctx.company.id, kind: "DELIVERY", isActive: true } })
    : await prisma.address.findFirst({ where: { companyId: ctx.company.id, kind: "DELIVERY", isActive: true }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] });
  if (!address) throw new ValidationError(input.deliveryAddressId ? "Unknown delivery address." : "Add a delivery address first.");
  try {
    for (const [i, l] of input.lines.entries()) {
      try {
        await addToCart(ctx, l.offerId, l.qty);
      } catch (e) {
        if (e instanceof AppError) throw new AppError(e.code, `Line ${i + 1}: ${e.message}`, e.status, { ...(e.details ?? {}), line: String(i + 1) });
        throw e;
      }
    }
    const r = await placeOrder(ctx, { deliveryAddressId: address.id, notes: input.notes ?? null, requestedDeliveryDate: input.requestedDeliveryDate ? new Date(input.requestedDeliveryDate) : null });
    const placed = await prisma.order.findMany({ where: { id: { in: r.orders.map((o) => o.id) } }, select: { id: true, number: true, status: true, grandTotal: true, awaitingPayment: true } });
    return { created: true, orders: placed.map((o) => ({ id: o.id, number: o.number, status: o.status, totalGross: o.grandTotal.toFixed(2), awaitingPayment: o.awaitingPayment })) };
  } catch (e) {
    await clearCart(ctx).catch(() => null);
    throw e;
  }
}

/** Delivery addresses (for placing orders). */
export async function deliveryAddresses(ctx: Ctx) {
  requireBuyer(ctx);
  const rows = await prisma.address.findMany({ where: { companyId: ctx.company.id, kind: "DELIVERY", isActive: true }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] });
  return rows.map((a) => ({ id: a.id, label: a.label, line1: a.line1, line2: a.line2, postalCode: a.postalCode, city: a.cityName, isDefault: a.isDefault }));
}

// ── buyers: catalogue ──────────────────────────────────────────────────────

type CatalogueItem = Awaited<ReturnType<typeof import("@/server/data/catalogue-buyer").browseCatalogue>>["items"][number];
const loc = (n: Record<string, string> | null | undefined, lang: string) => (n ? (n[lang] ?? n.en ?? n.pt ?? Object.values(n)[0] ?? "") : "");

/** What a buyer's system needs to order — never who funds a promotion. */
export function presentCatalogueItem(i: CatalogueItem, lang: string) {
  return {
    offerId: i.offerId, name: loc(i.name, lang), brand: i.brand, category: loc(i.category.name, lang), sku: i.sku, gtin: i.gtin, unitGtin: i.unitGtin,
    packaging: { name: loc(i.packaging.name, lang), unitsPerPack: i.packaging.unitsPerPack, uom: i.packaging.uom },
    supplier: i.vendor.name, minQty: i.minOrderQty, qtyStep: i.qtyStep, leadDays: i.leadTimeDays, available: i.available, vatRate: i.vatRate,
    price: i.price ? {
      unitNet: i.price.unitPriceNet, unitGross: i.price.unitPriceGross, listUnitNet: i.price.listUnitNet, perUnitNet: i.price.perUnitNet,
      promotions: i.price.promotions.map((p) => ({ name: p.name, perUnitNet: p.perUnit })), tiers: i.price.tiers,
    } : null,
  };
}

export async function catalogueForApi(ctx: Ctx, f: { q?: string; categoryId?: string; page?: number; lang?: string }) {
  const { browseCatalogue } = await import("@/server/data/catalogue-buyer");
  const r = await browseCatalogue(ctx, { q: f.q, categoryId: f.categoryId, page: f.page });
  const lang = f.lang || "en";
  return { items: r.items.map((i) => presentCatalogueItem(i as CatalogueItem, lang)), total: r.total, page: r.page, pageCount: r.pageCount };
}

// ── invoices ───────────────────────────────────────────────────────────────

export async function invoicesForApi(ctx: Ctx, side: "BUYER" | "VENDOR") {
  const finance = await import("@/server/services/finance");
  if (side === "BUYER") {
    const rows = await finance.listSalesInvoices(ctx, { as: "BUYER" });
    return {
      invoices: rows.map((r) => ({
        id: r.id, number: r.providerNumber ?? r.fullNumber, type: r.docType, issuedAt: r.issuedAt?.toISOString() ?? null, dueAt: r.dueAt?.toISOString() ?? null,
        orderId: r.order?.id ?? null, orderNumber: r.order?.number ?? null, currency: r.currencyCode, net: r.netTotal.toFixed(2), vat: r.vatTotal.toFixed(2), gross: r.grossTotal.toFixed(2),
        paid: r.paid, open: r.open, overdue: r.overdue, pdf: `/api/v2/invoices/${r.id}/pdf`,
      })),
    };
  }
  const rows = await finance.listStatements(ctx, "VENDOR");
  return { statements: rows };
}

// ── me, orders ─────────────────────────────────────────────────────────────

export async function whoAmI(ctx: Ctx) {
  const keyId = ctx.sessionId.startsWith("api:") ? ctx.sessionId.slice(4) : null;
  const key = keyId ? await prisma.apiKey.findUnique({ where: { id: keyId }, select: { name: true, scopes: true, prefix: true, createdAt: true } }) : null;
  return {
    company: { id: ctx.company.id, name: ctx.company.tradeName ?? ctx.company.legalName, type: ctx.company.type, country: ctx.company.countryCode },
    user: { id: ctx.user.id, name: ctx.user.name },
    key: key ? { name: key.name, prefix: key.prefix, scopes: key.scopes, createdAt: key.createdAt.toISOString() } : null,
  };
}

const STATUSES = ["NEW", "ON_HOLD", "PENDING_CONFIRMATION", "SUPPLIER_PROCESSING", "READY_FOR_PICKUP", "DISPATCHED", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED", "RETURNED", "EXCEPTION"] as const;

export async function ordersForApi(ctx: Ctx, side: "BUYER" | "VENDOR", f: { since: string | null; status: string | null; page: number }) {
  const { listOrders } = await import("@/server/services/orders");
  const { presentOrder } = await import("./v2");
  const since = f.since ? new Date(f.since) : undefined;
  if (since && Number.isNaN(since.getTime())) throw new ValidationError("since must be an ISO date (e.g. 2026-11-01T00:00:00Z).");
  const statuses = f.status ? f.status.split(",").map((s) => s.trim().toUpperCase()) : undefined;
  if (statuses?.some((s) => !(STATUSES as readonly string[]).includes(s))) throw new ValidationError(`status must be one of ${STATUSES.join(", ")}.`);
  const r = await listOrders(ctx, side, { since, statuses: statuses as (typeof STATUSES)[number][] | undefined, page: f.page });
  return { orders: r.rows.map((o) => presentOrder(o as Parameters<typeof presentOrder>[0], side)), total: r.total, page: r.page, pageCount: r.pageCount };
}

export const ConfirmBody = z.object({ quantities: z.record(z.string(), z.number().int().min(0)).optional() }).strict();
export async function confirmViaApi(ctx: Ctx, id: string, input: z.infer<typeof ConfirmBody>) {
  const { confirmOrder } = await import("@/server/services/orders");
  const { orderForApi } = await import("./v2");
  await confirmOrder(ctx, id, input.quantities ?? {});
  return orderForApi(ctx, id);
}

export const StatusBody = z.object({ status: z.enum(STATUSES), reason: z.string().max(500).optional() }).strict();
export async function statusViaApi(ctx: Ctx, id: string, input: z.infer<typeof StatusBody>) {
  const { changeOrderStatus } = await import("@/server/services/orders");
  const { orderForApi } = await import("./v2");
  await changeOrderStatus(ctx, id, input.status, input.reason ?? null);
  return orderForApi(ctx, id);
}
