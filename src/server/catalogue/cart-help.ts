import "server-only";
/**
 * Buying from several wholesalers (server side of src/lib/cart-help.ts):
 *  - supplier minimums — where each supplier in the buyer's cart stands, suppliers in the cart / usual ones first in
 *    results, badges, and "what you usually buy from this supplier" to reach its minimum;
 *  - supplier names — the wholesaler's name or "FIRINGI <area>" for buyers, as FIRINGI decides.
 * Settings: "cartHelp.settings" and "supplierNames.settings" (GLOBAL).
 */
import type { Prisma } from "@prisma/client";
import Decimal from "decimal.js";
import { cache } from "react";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import type { PermissionCode } from "@/server/rbac/permissions";
import { ForbiddenError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";
import { orderingMode } from "@/server/allocation/mode";
import { firingiInput, vendorInput } from "@/server/orders/delivery-rule";
import {
  areaLabels, cartHelpOn, mergeCartHelp, mergeSupplierNames, nameModeFor, standing,
  type CartHelpSettings, type NameMode, type Standing, type SupplierNameSettings,
} from "@/lib/cart-help";

const HELP_KEY = "cartHelp.settings";
const NAMES_KEY = "supplierNames.settings";
export const CH_MANAGE: PermissionCode[] = ["admin.settings.manage", "admin.catalogue.manage"];
export const CH_VIEW: PermissionCode[] = ["admin.settings.manage", "admin.catalogue.manage", "admin.catalogue.view"];

async function read(key: string) {
  return (await prisma.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key } }))?.value ?? null;
}
async function write(ctx: Ctx, key: string, before: unknown, next: unknown) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, CH_MANAGE)) throw new ForbiddenError();
  await prisma.setting.upsert({
    where: { scope_scopeId_key: { scope: "GLOBAL", scopeId: "", key } },
    update: { value: next as Prisma.InputJsonValue, updatedById: ctx.user.id },
    create: { scope: "GLOBAL", key, value: next as Prisma.InputJsonValue, updatedById: ctx.user.id },
  });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: key, entityType: "Setting", entityId: key, before: before as Prisma.InputJsonValue, after: next as Prisma.InputJsonValue });
}

export const cartHelpSettings = cache(async (): Promise<CartHelpSettings> => mergeCartHelp((await read(HELP_KEY)) as Partial<CartHelpSettings> | null));
export async function saveCartHelpSettings(ctx: Ctx, input: Partial<CartHelpSettings>) {
  const before = await cartHelpSettings();
  const next = mergeCartHelp({ ...before, ...input });
  await write(ctx, HELP_KEY, before, next);
  return next;
}

export const supplierNameSettings = cache(async (): Promise<SupplierNameSettings> => mergeSupplierNames((await read(NAMES_KEY)) as Partial<SupplierNameSettings> | null));
export async function saveSupplierNameSettings(ctx: Ctx, input: Partial<SupplierNameSettings>) {
  const before = await supplierNameSettings();
  const next = mergeSupplierNames({ ...before, ...input, companies: input.companies ?? before.companies, countries: input.countries ?? before.countries });
  await write(ctx, NAMES_KEY, before, next);
  return next;
}
export async function setCompanyNameMode(ctx: Ctx, companyId: string, value: NameMode | null) {
  const s = await supplierNameSettings();
  const companies = { ...s.companies };
  if (value) companies[companyId] = value; else delete companies[companyId];
  return saveSupplierNameSettings(ctx, { companies });
}

// ── supplier names ──────────────────────────────────────────────────────────

/** Every supplier's "FIRINGI <area>" label (city of its warehouse, else pickup point, else head office). */
export const supplierAreas = cache(async () => {
  const rows = await prisma.company.findMany({
    where: { type: { in: ["DISTRIBUTOR", "WHOLESALER"] } },
    select: {
      id: true, createdAt: true,
      addresses: { where: { isActive: true, kind: { in: ["WAREHOUSE", "PICKUP", "HEAD_OFFICE"] } }, select: { kind: true, cityName: true, city: { select: { name: true } } } },
    },
  });
  const order = ["WAREHOUSE", "PICKUP", "HEAD_OFFICE"];
  return areaLabels(rows.map((r) => {
    const a = [...r.addresses].sort((x, y) => order.indexOf(x.kind) - order.indexOf(y.kind))[0];
    const cityName = a?.cityName?.trim() || (a?.city?.name as Record<string, string> | string | undefined);
    return { id: r.id, createdAt: r.createdAt, city: typeof cityName === "string" ? cityName : cityName?.en ?? Object.values(cityName ?? {})[0] ?? null };
  }));
});

/** The name this buyer sees for a supplier: its own, or "FIRINGI <area>". Non-buyers always see the name. */
export const supplierNamer = cache(async (ctx: Pick<Ctx, "company">) => {
  const buyer = ctx.company;
  if (buyer.type !== "CUSTOMER" && buyer.type !== "WHOLESALER") return (_id: string, name: string) => name;
  const [s, areas] = await Promise.all([supplierNameSettings(), supplierAreas()]);
  const anyArea = s.customers === "AREA" || s.wholesalers === "AREA" || Object.values(s.countries).includes("AREA") || Object.values(s.companies).includes("AREA");
  if (!anyArea) return (_id: string, name: string) => name;
  return (id: string, name: string) => (id && id !== buyer.id && nameModeFor(s, buyer, id) === "AREA" ? areas.get(id) ?? "FIRINGI" : name);
});

/** Items carrying `vendor: { id, name }` with the names this buyer sees. */
export async function withSupplierNames<T extends { vendor: { id: string; name: string } }>(ctx: Pick<Ctx, "company">, items: T[]): Promise<T[]> {
  const name = await supplierNamer(ctx);
  return items.map((i) => {
    const n = name(i.vendor.id, i.vendor.name);
    return n === i.vendor.name ? i : { ...i, vendor: { ...i.vendor, name: n } };
  });
}

/** For text (notifications): a supplier's real name in `text` replaced by what this buyer sees. */
export async function maskSupplierText(buyer: { id: string; type: string; countryCode: string }, text: string) {
  if (buyer.type !== "CUSTOMER" && buyer.type !== "WHOLESALER") return text;
  const s = await supplierNameSettings();
  const anyArea = s.customers === "AREA" || s.wholesalers === "AREA" || Object.values(s.countries).includes("AREA") || Object.values(s.companies).includes("AREA");
  if (!anyArea || !text) return text;
  const [areas, cos] = await Promise.all([supplierAreas(), prisma.company.findMany({ where: { type: { in: ["DISTRIBUTOR", "WHOLESALER"] }, id: { not: buyer.id } }, select: { id: true, legalName: true, tradeName: true } })]);
  let out = text;
  for (const c of cos) {
    if (nameModeFor(s, buyer, c.id) !== "AREA") continue;
    for (const n of [c.tradeName, c.legalName]) if (n && out.includes(n)) out = out.split(n).join(areas.get(c.id) ?? "FIRINGI");
  }
  return out;
}

// ── supplier minimums ───────────────────────────────────────────────────────

/** Is the help on for this buyer? (choosing suppliers themselves; FIRINGI mode has one seller) */
export async function cartHelpFor(ctx: Ctx) {
  if (ctx.company.type !== "CUSTOMER" && ctx.company.type !== "WHOLESALER") return null;
  if ((await orderingMode(ctx)) === "FIRINGI") return null;
  const s = await cartHelpSettings();
  return cartHelpOn(s, ctx.company.countryCode) ? s : null;
}

async function defaultAddressId(ctx: Ctx) {
  return (await prisma.address.findFirst({ where: { companyId: ctx.company.id, isActive: true, kind: { in: ["DELIVERY", "HEAD_OFFICE"] } }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }], select: { id: true } }))?.id ?? null;
}

/** The delivery rules that set each supplier's minimum for this buyer (one query for all suppliers). */
async function rulesFor(ctx: Ctx, vendorIds: string[]) {
  const { deliveryRulesFor } = await import("@/server/services/cart");
  const base = await deliveryRulesFor(ctx.company.countryId, "", await defaultAddressId(ctx));
  const now = new Date();
  const vendors = vendorIds.length ? await prisma.deliveryRule.findMany({
    where: { isActive: true, validFrom: { lte: now }, OR: [{ validTo: null }, { validTo: { gt: now } }], scope: "VENDOR", vendorCompanyId: { in: vendorIds } },
    orderBy: [{ priority: "desc" }, { validFrom: "desc" }],
  }) : [];
  const byVendor = new Map<string, (typeof vendors)[number]>();
  for (const r of vendors) if (r.vendorCompanyId && !byVendor.has(r.vendorCompanyId)) byVendor.set(r.vendorCompanyId, r);
  return { firingi: firingiInput(base.firingi), vendor: (id: string) => vendorInput(byVendor.get(id) ?? null) };
}

/** Where every given supplier stands for this buyer with what is in the cart (goods excl. VAT, units). */
export async function supplierStandings(ctx: Ctx, vendorIds: string[], cart: Map<string, { goodsNet: Decimal.Value; units: number }>) {
  const ids = [...new Set([...vendorIds, ...cart.keys()])].filter(Boolean);
  const rules = await rulesFor(ctx, ids);
  const wholesaler = ctx.company.type === "WHOLESALER";
  return new Map<string, Standing & { inCart: boolean }>(ids.map((id) => {
    const c = cart.get(id);
    return [id, { ...standing({ wholesaler, goodsNet: c?.goodsNet ?? 0, units: c?.units ?? 0, firingi: rules.firingi, vendor: rules.vendor(id) }), inCart: !!c }];
  }));
}

/** What is in this buyer's cart, per supplier (goods excl. VAT at today's price, units). */
export async function cartBySupplier(ctx: Ctx) {
  const cart = await prisma.cart.findUnique({ where: { buyerCompanyId_userId: { buyerCompanyId: ctx.company.id, userId: ctx.user.id } }, select: { routed: true, items: { select: { offerId: true, qty: true } } } });
  const out = new Map<string, { goodsNet: Decimal; units: number }>();
  if (!cart || cart.routed || !cart.items.length) return out;
  const { pricedOffers } = await import("@/server/data/catalogue-buyer");
  const { items } = await pricedOffers(ctx, cart.items);
  for (const i of items) {
    const cur = out.get(i.vendorCompanyId) ?? { goodsNet: new Decimal(0), units: 0 };
    out.set(i.vendorCompanyId, { goodsNet: cur.goodsNet.plus(new Decimal(i.price?.unitPriceNet ?? 0).mul(i.qty)), units: cur.units + i.qty });
  }
  return out;
}

/** The suppliers this buyer ordered from most in the last 180 days. */
export async function usualSuppliers(ctx: Ctx) {
  const since = new Date(Date.now() - 180 * 86_400_000);
  const g = await prisma.order.groupBy({ by: ["sellerCompanyId"], where: { buyerCompanyId: ctx.company.id, placedAt: { gte: since }, routedByFiringi: false, status: { not: "CANCELLED" } }, _count: { _all: true }, orderBy: { _count: { sellerCompanyId: "desc" } }, take: 10 });
  return g.map((x) => x.sellerCompanyId);
}

/** For results (search, scan): the help to show, or null when off. */
export async function resultsHelp(ctx: Ctx, vendorIds: string[]) {
  const s = await cartHelpFor(ctx);
  if (!s || (!s.cartFirst && !s.badges)) return null;
  const [cart, usual] = await Promise.all([cartBySupplier(ctx), s.cartFirst ? usualSuppliers(ctx) : Promise.resolve([] as string[])]);
  const stand = s.badges ? await supplierStandings(ctx, vendorIds, cart) : new Map<string, Standing & { inCart: boolean }>();
  return { settings: s, inCart: new Set(cart.keys()), usual, standing: stand };
}

/**
 * In the cart: for a supplier below its minimum, what this buyer usually orders from it (last 180 days, most often
 * first) that isn't in the cart — still sold and visible, priced, with the quantity last ordered (≥ the minimum).
 */
export async function topUpSuggestions(ctx: Ctx, vendorId: string, inCartOfferIds: string[], limit = 4) {
  const since = new Date(Date.now() - 180 * 86_400_000);
  const lines = await prisma.orderLine.findMany({
    where: { order: { buyerCompanyId: ctx.company.id, sellerCompanyId: vendorId, placedAt: { gte: since }, status: { not: "CANCELLED" } }, offerId: { notIn: inCartOfferIds } },
    select: { offerId: true, qtyOrdered: true, order: { select: { placedAt: true } } },
    orderBy: { order: { placedAt: "desc" } }, take: 400,
  });
  const stats = new Map<string, { n: number; lastQty: number }>();
  for (const l of lines) {
    const s = stats.get(l.offerId);
    stats.set(l.offerId, s ? { ...s, n: s.n + 1 } : { n: 1, lastQty: Number(l.qtyOrdered) });
  }
  const ids = [...stats.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, limit * 3).map(([id]) => id);
  if (!ids.length) return [];
  const { presentOffers } = await import("@/server/data/catalogue-buyer");
  const items = (await presentOffers(ctx, ids)).filter((i) => i.price && i.vendor.id === vendorId);
  const rank = new Map(ids.map((id, k) => [id, k]));
  return items.sort((a, b) => rank.get(a.offerId)! - rank.get(b.offerId)!).slice(0, limit).map((i) => {
    const last = stats.get(i.offerId)!.lastQty;
    const step = Math.max(1, i.qtyStep ?? 1), min = Math.max(1, i.minOrderQty ?? 1);
    const qty = Math.max(min, Math.ceil((last - min) / step) * step + min);
    return { item: i, qty, times: stats.get(i.offerId)!.n };
  });
}

export type { Standing };

/** FIRINGI's page: settings, Schengen countries, and every supplier with its "FIRINGI <area>" label and override. */
export async function cartHelpAdmin(ctx: Ctx) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, CH_VIEW)) throw new ForbiddenError();
  const [help, names, areas, countries, suppliers] = await Promise.all([
    cartHelpSettings(), supplierNameSettings(), supplierAreas(),
    prisma.country.findMany({ where: { isActive: true, isSchengen: true }, select: { code: true, name: true }, orderBy: { code: "asc" } }),
    prisma.company.findMany({ where: { type: { in: ["DISTRIBUTOR", "WHOLESALER"] }, status: "APPROVED" }, select: { id: true, legalName: true, tradeName: true, type: true, country: { select: { code: true } } }, orderBy: { legalName: "asc" }, take: 500 }),
  ]);
  const L = (n: unknown) => (n as Record<string, string>)?.en ?? String(n ?? "");
  return {
    help, names, manage: can(ctx, CH_MANAGE),
    countries: countries.map((c) => ({ code: c.code, name: L(c.name) })),
    suppliers: suppliers.map((s) => ({ id: s.id, name: s.tradeName ?? s.legalName, type: s.type, country: s.country?.code ?? "", area: areas.get(s.id) ?? "FIRINGI", state: (names.companies[s.id] ?? "DEFAULT") as "DEFAULT" | NameMode })),
  };
}
