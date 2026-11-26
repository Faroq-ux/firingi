import "server-only";
/**
 * Customer assortments (Phase 64). Rules in src/lib/assortments.ts; docs in docs/assortments.md.
 *
 *   • The supplier (vendor.pricing.manage) makes lists for all its customers, a customer group, or one customer:
 *     an approved list (only these products), hidden items (not these), or a must-stock list (always carry these).
 *   • The rules live in the catalogue's one visibility filter (`buyerAssortment` → BuyerScope.assortment), so the
 *     shop, cart, checkout, quotes, reps, vans, WhatsApp, the API and FIRINGI's routed orders all follow them.
 *   • Customers see their must-stock products per supplier, which ones they haven't ordered lately, and add the
 *     missing ones to the cart in one go; a weekly reminder tells them (FIRINGI's switch). Reps see the gaps.
 *   • FIRINGI switches assortments on/off, each kind of list, per supplier; sets the gap days and the reminders.
 */
import type { AssortmentMode, AssortmentTarget, Prisma } from "@prisma/client";
import { cache } from "react";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";
import { notify } from "@/server/notify/dispatch";
import { pickLocalized } from "@/i18n/config";
import { mergeAssortmentSettings, mustStockGaps, parseSkus, resolveRules, type AssortmentSettings, type ListRule } from "@/lib/assortments";

const KEY = "assortments.settings";
const isStaff = (ctx: Ctx) => ctx.company.type === "ADMIN";
const isVendor = (ctx: Ctx) => ctx.company.type === "WHOLESALER" || ctx.company.type === "DISTRIBUTOR";
const isBuyer = (ctx: Ctx) => ctx.company.type === "CUSTOMER" || ctx.company.type === "WHOLESALER";
const nameOf = (c: { legalName: string; tradeName: string | null } | null | undefined) => c?.tradeName ?? c?.legalName ?? "—";
async function uiLocale(ctx: Ctx) {
  try { return await (await import("next-intl/server")).getLocale(); } catch { return ctx.user.locale ?? "en"; }
}
const OFFER_SEL = { id: true, vendorSku: true, vendorCompanyId: true, status: true, packaging: { select: { name: true, variant: { select: { sku: true, product: { select: { name: true } } } } } } } as const;

// ── settings ────────────────────────────────────────────────────────────────

export const assortmentSettings = cache(async (): Promise<AssortmentSettings> => {
  const row = await prisma.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: KEY } });
  return mergeAssortmentSettings(row?.value as Partial<AssortmentSettings> | null);
});

async function readSettings() {
  const row = await prisma.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: KEY } });
  return mergeAssortmentSettings(row?.value as Partial<AssortmentSettings> | null);
}

export async function saveAssortmentSettings(ctx: Ctx, input: Partial<AssortmentSettings>) {
  if (!isStaff(ctx) || !can(ctx, "admin.settings.manage")) throw new ForbiddenError();
  const before = await readSettings();
  const v = mergeAssortmentSettings({ ...before, ...input, modes: { ...before.modes, ...(input.modes ?? {}) } });
  const row = await prisma.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: KEY } });
  if (row) await prisma.setting.update({ where: { id: row.id }, data: { value: v as unknown as Prisma.InputJsonValue } });
  else await prisma.setting.create({ data: { scope: "GLOBAL", scopeId: "", key: KEY, value: v as unknown as Prisma.InputJsonValue } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "assortments.settings", entityType: "Setting", entityId: KEY, before: before as never, after: v as never });
  return v;
}

export async function setVendorAssortments(ctx: Ctx, vendorId: string, on: boolean) {
  const s = await readSettings();
  const set = new Set(s.disabledVendors);
  if (on) set.delete(vendorId); else set.add(vendorId);
  return saveAssortmentSettings(ctx, { disabledVendors: [...set] });
}

const vendorOn = (s: AssortmentSettings, vendorId: string) => s.enabled && !s.disabledVendors.includes(vendorId);

// ── the rules for one customer (used by the catalogue's visibility filter) ──

/** The lists that apply to a customer (FIRINGI's switches applied). */
async function listsFor(buyerCompanyId: string, s: AssortmentSettings, vendorId?: string): Promise<(ListRule & { id: string; name: string })[]> {
  if (!s.enabled) return [];
  const modes = (Object.entries(s.modes).filter(([, on]) => on).map(([m]) => m)) as AssortmentMode[];
  if (!modes.length) return [];
  const rows = await prisma.assortment.findMany({
    where: {
      active: true, mode: { in: modes }, ...(vendorId ? { vendorCompanyId: vendorId } : s.disabledVendors.length ? { vendorCompanyId: { notIn: s.disabledVendors } } : {}),
      OR: [
        { target: "ALL" },
        { target: "CUSTOMER", targetCompanyId: buyerCompanyId },
        { target: "GROUP", targetGroupId: { in: (await prisma.customerGroupMember.findMany({ where: { companyId: buyerCompanyId }, select: { groupId: true } })).map((g) => g.groupId) } },
      ],
    },
    include: { items: { select: { offerId: true, mustStock: true } } },
  });
  return rows.filter((r) => vendorOn(s, r.vendorCompanyId)).map((r) => ({ id: r.id, name: r.name, vendorId: r.vendorCompanyId, mode: r.mode, target: r.target, items: r.items }));
}

/** What the assortments let this customer see (for BuyerScope). Empty = no rule. */
export const buyerAssortment = cache(async (buyerCompanyId: string) => {
  const s = await assortmentSettings();
  const r = resolveRules(await listsFor(buyerCompanyId, s));
  return { onlyVendorIds: r.onlyVendorIds, allowedOfferIds: r.allowedOfferIds, hiddenOfferIds: r.hiddenOfferIds };
});

// ── the supplier ────────────────────────────────────────────────────────────

function requireManager(ctx: Ctx) {
  if (!isVendor(ctx) || !can(ctx, "vendor.pricing.manage")) throw new ForbiddenError();
}
function requireViewer(ctx: Ctx) {
  if (!isVendor(ctx) || !can(ctx, ["vendor.pricing.manage", "vendor.products.view"])) throw new ForbiddenError();
}

/** The customers a supplier can target: those who ordered from it, its groups' members, and search by name. */
export async function targetOptions(ctx: Ctx, q?: string | null) {
  requireViewer(ctx);
  const groups = await prisma.customerGroup.findMany({ where: { ownerCompanyId: ctx.company.id }, select: { id: true, name: true, _count: { select: { members: true } } }, orderBy: { name: "asc" } });
  const term = q?.trim().slice(0, 60) || "";
  const type = ctx.company.type === "DISTRIBUTOR" ? "WHOLESALER" : "CUSTOMER";
  const ordered = await prisma.order.findMany({ where: { sellerCompanyId: ctx.company.id }, distinct: ["buyerCompanyId"], select: { buyerCompanyId: true }, take: 300 });
  const customers = await prisma.company.findMany({
    where: {
      type, status: "APPROVED",
      ...(term ? { OR: [{ legalName: { contains: term, mode: "insensitive" } }, { tradeName: { contains: term, mode: "insensitive" } }, { taxId: { contains: term } }], ...(type === "CUSTOMER" ? { countryId: ctx.company.countryId } : {}) } : { id: { in: ordered.map((o) => o.buyerCompanyId) } }),
    },
    select: { id: true, legalName: true, tradeName: true, taxId: true }, orderBy: { legalName: "asc" }, take: 30,
  });
  return { groups: groups.map((g) => ({ id: g.id, name: g.name, members: g._count.members })), customers: customers.map((c) => ({ id: c.id, name: nameOf(c), taxId: c.taxId })) };
}

export async function vendorAssortments(ctx: Ctx) {
  requireViewer(ctx);
  const s = await readSettings();
  const rows = await prisma.assortment.findMany({ where: { vendorCompanyId: ctx.company.id }, orderBy: [{ active: "desc" }, { updatedAt: "desc" }], include: { _count: { select: { items: true } }, items: { where: { mustStock: true }, select: { offerId: true } } } });
  const [groups, cos] = await Promise.all([
    prisma.customerGroup.findMany({ where: { id: { in: rows.map((r) => r.targetGroupId).filter((x): x is string => !!x) } }, select: { id: true, name: true, _count: { select: { members: true } } } }),
    prisma.company.findMany({ where: { id: { in: rows.map((r) => r.targetCompanyId).filter((x): x is string => !!x) } }, select: { id: true, legalName: true, tradeName: true } }),
  ]);
  const gn = new Map(groups.map((g) => [g.id, g])), cn = new Map(cos.map((c) => [c.id, nameOf(c)]));
  return {
    on: vendorOn(s, ctx.company.id), modes: s.modes,
    lists: rows.map((r) => ({
      id: r.id, name: r.name, mode: r.mode, target: r.target, active: r.active, items: r._count.items, mustStock: r.mode === "MUST_STOCK" ? r._count.items : r.items.length,
      targetName: r.target === "GROUP" ? gn.get(r.targetGroupId ?? "")?.name ?? "—" : r.target === "CUSTOMER" ? cn.get(r.targetCompanyId ?? "") ?? "—" : null,
      customers: r.target === "GROUP" ? gn.get(r.targetGroupId ?? "")?._count.members ?? 0 : r.target === "CUSTOMER" ? 1 : null,
      modeAllowed: s.modes[r.mode], updatedAt: r.updatedAt.toISOString(),
    })),
  };
}

export type AssortmentInput = { name: string; mode: AssortmentMode; target: AssortmentTarget; targetGroupId?: string | null; targetCompanyId?: string | null; active?: boolean; note?: string | null };

async function checkInput(ctx: Ctx, i: AssortmentInput) {
  const s = await readSettings();
  if (!vendorOn(s, ctx.company.id)) throw new ForbiddenError("Customer assortments are switched off by FIRINGI.");
  if (!s.modes[i.mode]) throw new ValidationError("FIRINGI doesn't allow this kind of list at the moment.");
  const name = i.name.trim().slice(0, 120);
  if (!name) throw new ValidationError("Give the list a name.");
  if (i.target === "GROUP" && !(await prisma.customerGroup.findFirst({ where: { id: i.targetGroupId ?? "", ownerCompanyId: ctx.company.id } }))) throw new ValidationError("Choose one of your customer groups.");
  if (i.target === "CUSTOMER") {
    const c = await prisma.company.findFirst({ where: { id: i.targetCompanyId ?? "", type: ctx.company.type === "DISTRIBUTOR" ? "WHOLESALER" : "CUSTOMER", status: "APPROVED" } });
    if (!c) throw new ValidationError("Choose a customer.");
  }
  return {
    name, mode: i.mode, target: i.target, targetGroupId: i.target === "GROUP" ? i.targetGroupId! : null, targetCompanyId: i.target === "CUSTOMER" ? i.targetCompanyId! : null,
    active: i.active ?? true, note: i.note?.trim().slice(0, 500) || null,
  };
}

export async function createAssortment(ctx: Ctx, i: AssortmentInput) {
  requireManager(ctx);
  const data = await checkInput(ctx, i);
  const a = await prisma.assortment.create({ data: { ...data, vendorCompanyId: ctx.company.id, createdById: ctx.user.id } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "assortment.created", entityType: "Assortment", entityId: a.id, after: data });
  return a;
}

async function own(ctx: Ctx, id: string) {
  const a = await prisma.assortment.findFirst({ where: { id, vendorCompanyId: ctx.company.id } });
  if (!a) throw new NotFoundError("List");
  return a;
}

export async function updateAssortment(ctx: Ctx, id: string, i: AssortmentInput) {
  requireManager(ctx);
  const before = await own(ctx, id);
  const data = await checkInput(ctx, i);
  await prisma.assortment.update({ where: { id }, data });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "assortment.updated", entityType: "Assortment", entityId: id, before: { name: before.name, mode: before.mode, target: before.target, active: before.active }, after: data });
}

export async function deleteAssortment(ctx: Ctx, id: string) {
  requireManager(ctx);
  const a = await own(ctx, id);
  await prisma.assortment.delete({ where: { id: a.id } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "assortment.deleted", entityType: "Assortment", entityId: id, before: { name: a.name, mode: a.mode } });
}

export async function assortmentDetail(ctx: Ctx, id: string) {
  requireViewer(ctx);
  const a = await own(ctx, id);
  const locale = await uiLocale(ctx);
  const items = await prisma.assortmentItem.findMany({ where: { assortmentId: id }, orderBy: { addedAt: "asc" } });
  const offers = await prisma.vendorOffer.findMany({ where: { id: { in: items.map((x) => x.offerId) } }, select: OFFER_SEL });
  const on = new Map(offers.map((o) => [o.id, o]));
  const [group, company] = await Promise.all([
    a.targetGroupId ? prisma.customerGroup.findUnique({ where: { id: a.targetGroupId }, select: { name: true, _count: { select: { members: true } } } }) : null,
    a.targetCompanyId ? prisma.company.findUnique({ where: { id: a.targetCompanyId }, select: { legalName: true, tradeName: true } }) : null,
  ]);
  return {
    id: a.id, name: a.name, mode: a.mode, target: a.target, targetGroupId: a.targetGroupId, targetCompanyId: a.targetCompanyId, active: a.active, note: a.note,
    targetName: group?.name ?? (company ? nameOf(company) : null), customers: a.target === "GROUP" ? group?._count.members ?? 0 : a.target === "CUSTOMER" ? 1 : null,
    items: items.map((x) => {
      const o = on.get(x.offerId);
      return { offerId: x.offerId, mustStock: a.mode === "MUST_STOCK" || x.mustStock, name: pickLocalized(o?.packaging.variant.product.name, locale) || "—", packaging: pickLocalized(o?.packaging.name, locale) || "", sku: o?.vendorSku ?? o?.packaging.variant.sku ?? "", active: o?.status === "ACTIVE" };
    }).sort((x, y) => x.name.localeCompare(y.name)),
  };
}

/** Own products to add (active offers), by name or SKU; already listed ones are flagged. */
export async function searchOwnProducts(ctx: Ctx, id: string, q: string) {
  requireManager(ctx);
  await own(ctx, id);
  const locale = await uiLocale(ctx);
  const term = q.trim().slice(0, 60);
  const rows = await prisma.vendorOffer.findMany({
    where: { vendorCompanyId: ctx.company.id, status: "ACTIVE", ...(term ? { OR: [{ vendorSku: { contains: term, mode: "insensitive" } }, { packaging: { variant: { sku: { contains: term, mode: "insensitive" } } } }, { packaging: { variant: { product: { searchText: { contains: term.toLowerCase() } } } } }] } : {}) },
    select: OFFER_SEL, take: 40, orderBy: { createdAt: "asc" },
  });
  const listed = new Set((await prisma.assortmentItem.findMany({ where: { assortmentId: id, offerId: { in: rows.map((r) => r.id) } }, select: { offerId: true } })).map((x) => x.offerId));
  return rows.map((o) => ({ offerId: o.id, name: pickLocalized(o.packaging.variant.product.name, locale) || "—", packaging: pickLocalized(o.packaging.name, locale) || "", sku: o.vendorSku ?? o.packaging.variant.sku, listed: listed.has(o.id) }));
}

/** Add products by id, or by pasted SKUs (the supplier's own SKU or FIRINGI's). Returns what wasn't found. */
export async function addItems(ctx: Ctx, id: string, i: { offerIds?: string[]; skus?: string | null; mustStock?: boolean }) {
  requireManager(ctx);
  const a = await own(ctx, id);
  const skus = i.skus ? parseSkus(i.skus) : [];
  const bySku = skus.length ? await prisma.vendorOffer.findMany({ where: { vendorCompanyId: ctx.company.id, OR: [{ vendorSku: { in: skus, mode: "insensitive" } }, { packaging: { variant: { sku: { in: skus, mode: "insensitive" } } } }] }, select: { id: true, vendorSku: true, packaging: { select: { variant: { select: { sku: true } } } } } }) : [];
  const found = new Set(bySku.flatMap((o) => [o.vendorSku?.toUpperCase(), o.packaging.variant.sku.toUpperCase()].filter(Boolean) as string[]));
  const ids = [...new Set([...(i.offerIds ?? []), ...bySku.map((o) => o.id)])];
  const own2 = await prisma.vendorOffer.findMany({ where: { id: { in: ids }, vendorCompanyId: ctx.company.id }, select: { id: true } });
  if (own2.length !== ids.length) throw new ValidationError("Choose your own products.");
  if (ids.length > 5000) throw new ValidationError("At most 5000 products per list.");
  await prisma.assortmentItem.createMany({ data: ids.map((offerId) => ({ assortmentId: a.id, offerId, mustStock: a.mode === "MUST_STOCK" || !!i.mustStock })), skipDuplicates: true });
  await prisma.assortment.update({ where: { id: a.id }, data: { updatedAt: new Date() } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "assortment.items_added", entityType: "Assortment", entityId: a.id, after: { n: ids.length } });
  return { added: ids.length, notFound: skus.filter((s) => !found.has(s)) };
}

export async function removeItem(ctx: Ctx, id: string, offerId: string) {
  requireManager(ctx);
  const a = await own(ctx, id);
  await prisma.assortmentItem.deleteMany({ where: { assortmentId: a.id, offerId } });
  await prisma.assortment.update({ where: { id: a.id }, data: { updatedAt: new Date() } });
}

export async function setMustStock(ctx: Ctx, id: string, offerId: string, on: boolean) {
  requireManager(ctx);
  const a = await own(ctx, id);
  if (a.mode !== "ONLY_LISTED") throw new ValidationError("Must-stock can be set only on an approved list (a must-stock list holds must-stock products only).");
  await prisma.assortmentItem.update({ where: { assortmentId_offerId: { assortmentId: a.id, offerId } }, data: { mustStock: on } });
}

/** How a customer sees this supplier's products under all its lists: visible / hidden counts and the must-stock list. */
export async function previewForCustomer(ctx: Ctx, buyerCompanyId: string) {
  requireViewer(ctx);
  const s = await readSettings();
  const lists = await listsFor(buyerCompanyId, s, ctx.company.id);
  const r = resolveRules(lists);
  const total = await prisma.vendorOffer.count({ where: { vendorCompanyId: ctx.company.id, status: "ACTIVE" } });
  const hidden = await prisma.vendorOffer.count({
    where: { vendorCompanyId: ctx.company.id, status: "ACTIVE", OR: [{ id: { in: r.hiddenOfferIds } }, ...(r.onlyVendorIds.includes(ctx.company.id) ? [{ id: { notIn: r.allowedOfferIds } }] : [])] },
  });
  const c = await prisma.company.findUnique({ where: { id: buyerCompanyId }, select: { legalName: true, tradeName: true } });
  return { customer: nameOf(c), total, visible: total - hidden, hidden, mustStock: [...r.mustStock.keys()].length, lists: lists.map((l) => ({ id: l.id, name: l.name, mode: l.mode, target: l.target })) };
}

// ── must-stock: the customer, the rep ───────────────────────────────────────

/** Last time this customer ordered each offer (not cancelled orders). */
async function lastOrdered(buyerCompanyId: string, offerIds: string[]) {
  if (!offerIds.length) return new Map<string, Date | null>();
  const rows = await prisma.$queryRaw<{ offerId: string; at: Date }[]>`
    SELECT l."offerId", max(o."placedAt") AS at FROM "OrderLine" l JOIN "Order" o ON o.id = l."orderId"
    WHERE o."buyerCompanyId" = ${buyerCompanyId} AND o.status <> 'CANCELLED' AND l."offerId" = ANY(${offerIds}) GROUP BY l."offerId"`;
  return new Map<string, Date | null>(rows.map((r) => [r.offerId, r.at]));
}

/** Must-stock products of one supplier (or all) for a customer, with gaps. */
async function mustStockOf(buyerCompanyId: string, vendorId?: string) {
  const s = await readSettings();
  const r = resolveRules(await listsFor(buyerCompanyId, s, vendorId));
  const ids = [...r.mustStock.keys()];
  const last = await lastOrdered(buyerCompanyId, ids);
  return { s, items: mustStockGaps(ids.map((offerId) => ({ offerId, vendorId: r.mustStock.get(offerId)! })), last, s.gapDays) };
}

export async function myMustStock(ctx: Ctx) {
  if (!isBuyer(ctx) || !can(ctx, ["buyer.orders.place", "buyer.orders.view"])) throw new ForbiddenError();
  const { s, items } = await mustStockOf(ctx.company.id);
  const locale = await uiLocale(ctx);
  // only what the customer can actually buy now (visible, priced)
  const { pricedOffers } = await import("@/server/data/catalogue-buyer");
  const priced = items.length ? (await pricedOffers(ctx, items.map((i) => ({ offerId: i.offerId, qty: 1 })))).items : [];
  const pm = new Map(priced.map((p) => [p.offerId, p]));
  const vendors = await prisma.company.findMany({ where: { id: { in: [...new Set(items.map((i) => i.vendorId))] } }, select: { id: true, legalName: true, tradeName: true } });
  const vn = new Map(vendors.map((v) => [v.id, nameOf(v)]));
  const groups = new Map<string, { vendorId: string; supplier: string; items: { offerId: string; name: string; packaging: string; unitNet: number | null; minQty: number; lastOrdered: string | null; days: number | null; gap: boolean; available: boolean }[] }>();
  for (const i of items) {
    const p = pm.get(i.offerId);
    const g = groups.get(i.vendorId) ?? { vendorId: i.vendorId, supplier: vn.get(i.vendorId) ?? "—", items: [] };
    g.items.push({ offerId: i.offerId, name: p ? pickLocalized(p.name, locale) || "—" : "—", packaging: p ? pickLocalized(p.packaging.name, locale) || "" : "", unitNet: p?.price ? Number(p.price.unitPriceNet) : null, minQty: Math.max(1, p?.minOrderQty ?? 1), lastOrdered: i.lastOrdered?.toISOString() ?? null, days: i.days, gap: i.gap, available: !!p?.price });
    groups.set(i.vendorId, g);
  }
  return { on: s.enabled, gapDays: s.gapDays, suppliers: [...groups.values()].map((g) => ({ ...g, items: g.items.filter((x) => x.name !== "—" || x.available), gaps: g.items.filter((x) => x.gap && x.available).length })).filter((g) => g.items.length).sort((a, b) => a.supplier.localeCompare(b.supplier)) };
}

/** Put the missing must-stock products (of one supplier, or all) in the cart at their minimum quantity. */
export async function addGapsToCart(ctx: Ctx, vendorId?: string | null) {
  const m = await myMustStock(ctx);
  const { addToCart } = await import("@/server/services/cart");
  let added = 0;
  const failed: string[] = [];
  for (const g of m.suppliers) {
    if (vendorId && g.vendorId !== vendorId) continue;
    for (const i of g.items) {
      if (!i.gap || !i.available) continue;
      try { await addToCart(ctx, i.offerId, i.minQty); added++; } catch { failed.push(i.name); }
    }
  }
  return { added, failed };
}

/** For the supplier's rep: the customer's must-stock gaps with this supplier. */
export async function mustStockGapsFor(vendorId: string, buyerCompanyId: string, locale: string) {
  const { items } = await mustStockOf(buyerCompanyId, vendorId);
  const gaps = items.filter((i) => i.gap);
  const offers = await prisma.vendorOffer.findMany({ where: { id: { in: gaps.map((g) => g.offerId) }, status: "ACTIVE" }, select: OFFER_SEL });
  const on = new Map(offers.map((o) => [o.id, o]));
  return gaps.filter((g) => on.has(g.offerId)).map((g) => {
    const o = on.get(g.offerId)!;
    return { offerId: g.offerId, name: pickLocalized(o.packaging.variant.product.name, locale) || "—", packaging: pickLocalized(o.packaging.name, locale) || "", days: g.days };
  });
}

export async function hasMustStock(buyerCompanyId: string) {
  const s = await assortmentSettings();
  if (!s.enabled || (!s.modes.MUST_STOCK && !s.modes.ONLY_LISTED)) return false;
  return resolveRules(await listsFor(buyerCompanyId, s)).mustStock.size > 0;
}

// ── FIRINGI ─────────────────────────────────────────────────────────────────

export async function adminOverview(ctx: Ctx) {
  if (!isStaff(ctx) || !can(ctx, ["admin.vendors.view", "admin.settings.manage"])) throw new ForbiddenError();
  const s = await readSettings();
  const rows = await prisma.assortment.groupBy({ by: ["vendorCompanyId", "mode"], _count: { _all: true } });
  const actives = await prisma.assortment.groupBy({ by: ["vendorCompanyId"], where: { active: true }, _count: { _all: true } });
  const items = await prisma.assortmentItem.groupBy({ by: ["assortmentId"], _count: { _all: true } });
  const ids = [...new Set([...rows.map((r) => r.vendorCompanyId), ...s.disabledVendors])];
  const cos = await prisma.company.findMany({ where: { id: { in: ids } }, select: { id: true, legalName: true, tradeName: true } });
  const cn = new Map(cos.map((c) => [c.id, nameOf(c)]));
  const act = new Map(actives.map((a) => [a.vendorCompanyId, a._count._all]));
  const per = new Map<string, Record<string, number>>();
  for (const r of rows) per.set(r.vendorCompanyId, { ...(per.get(r.vendorCompanyId) ?? {}), [r.mode]: r._count._all });
  const reminders = await prisma.mustStockReminder.count({ where: { sentAt: { gte: new Date(Date.now() - 30 * 86400_000) } } });
  return {
    settings: s,
    kpis: { suppliers: per.size, lists: rows.reduce((a, r) => a + r._count._all, 0), items: items.reduce((a, r) => a + r._count._all, 0), reminders30: reminders },
    suppliers: [...per.entries()].map(([id, m]) => ({ id, name: cn.get(id) ?? "—", only: m.ONLY_LISTED ?? 0, hide: m.HIDE_LISTED ?? 0, must: m.MUST_STOCK ?? 0, active: act.get(id) ?? 0, on: !s.disabledVendors.includes(id) })).sort((a, b) => a.name.localeCompare(b.name)),
    disabled: s.disabledVendors.map((id) => ({ id, name: cn.get(id) ?? id })),
  };
}

export async function searchVendors(ctx: Ctx, q: string) {
  if (!isStaff(ctx)) throw new ForbiddenError();
  const term = q.trim().slice(0, 60);
  if (term.length < 2) return [];
  const rows = await prisma.company.findMany({ where: { AND: [await (await import("@/server/services/admin-search")).adminCompanyWhere(ctx)], type: { in: ["WHOLESALER", "DISTRIBUTOR"] }, OR: [{ legalName: { contains: term, mode: "insensitive" } }, { tradeName: { contains: term, mode: "insensitive" } }] }, select: { id: true, legalName: true, tradeName: true }, take: 10 });
  return rows.map((r) => ({ id: r.id, name: nameOf(r) }));
}

// ── weekly reminder ─────────────────────────────────────────────────────────

/** Customers with must-stock gaps hear about them at most once a week (FIRINGI's switch). */
export async function processAssortments(now = new Date()) {
  const s = await readSettings();
  if (!s.enabled || !s.reminders) return { reminded: 0 };
  // customers any must-stock list could reach: targeted directly, via a group, or (ALL lists) customers of that supplier
  const lists = await prisma.assortment.findMany({ where: { active: true, OR: [{ mode: "MUST_STOCK" }, { mode: "ONLY_LISTED", items: { some: { mustStock: true } } }], vendorCompanyId: { notIn: s.disabledVendors } }, select: { vendorCompanyId: true, target: true, targetCompanyId: true, targetGroupId: true } });
  const buyers = new Set<string>();
  for (const l of lists) {
    if (l.target === "CUSTOMER" && l.targetCompanyId) buyers.add(l.targetCompanyId);
    if (l.target === "GROUP" && l.targetGroupId) for (const m of await prisma.customerGroupMember.findMany({ where: { groupId: l.targetGroupId }, select: { companyId: true } })) buyers.add(m.companyId);
    if (l.target === "ALL") for (const o of await prisma.order.findMany({ where: { sellerCompanyId: l.vendorCompanyId, placedAt: { gte: new Date(now.getTime() - 365 * 86400_000) } }, distinct: ["buyerCompanyId"], select: { buyerCompanyId: true } })) buyers.add(o.buyerCompanyId);
  }
  let reminded = 0;
  const weekAgo = new Date(now.getTime() - 7 * 86400_000);
  for (const b of buyers) {
    const r = await prisma.mustStockReminder.findUnique({ where: { buyerCompanyId: b } });
    if (r && r.sentAt > weekAgo) continue;
    const { items } = await mustStockOf(b);
    const gaps = items.filter((i) => i.gap);
    if (!gaps.length) continue;
    await notify("assortment.gaps", [{ companyId: b, link: "/buy/orders/must-stock" }], { n: gaps.length, days: s.gapDays }, { ref: { type: "Company", id: b } }).catch(() => null);
    await prisma.mustStockReminder.upsert({ where: { buyerCompanyId: b }, create: { buyerCompanyId: b, sentAt: now }, update: { sentAt: now } });
    reminded++;
  }
  return { reminded };
}
