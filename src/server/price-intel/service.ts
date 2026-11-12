/**
 * Price intelligence (Phase 29): settings, the live market (base prices of active offers per
 * product), price history, supplier price-change requests (big increases wait for FIRINGI and are
 * announced to customers before they apply), price alerts and the hourly job. Maths: ./stats.ts.
 */
import Decimal from "decimal.js";
import type { Prisma, PriceList } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";
import { notify } from "@/server/notify/dispatch";
import { pickLocalized } from "@/i18n/config";
import { DEFAULT_SETTINGS, deviationPct, jump, marketStats, needsApproval, stepSeries, type Change, type MarketStats, type PriceSettings } from "./stats";

const KEY = "pricing.intel";
const DAY = 86_400_000;
export const canViewPricing = (ctx: Ctx) => ctx.company.type === "ADMIN" && can(ctx, ["admin.pricing.view", "admin.pricing.manage"]);
export const canManagePricing = (ctx: Ctx) => ctx.company.type === "ADMIN" && can(ctx, "admin.pricing.manage");
export function requireView(ctx: Ctx) { if (!canViewPricing(ctx)) throw new ForbiddenError(); }
export function requireManage(ctx: Ctx) { if (!canManagePricing(ctx)) throw new ForbiddenError(); }
const firingiId = async () => (await prisma.company.findFirstOrThrow({ where: { type: "ADMIN" }, select: { id: true } })).id;
const money = (v: Decimal.Value) => new Decimal(v).toFixed(2);
const nameOf = (n: unknown, locale = "en") => pickLocalized(n as Record<string, string>, locale);

// ── settings ────────────────────────────────────────────────────────────────

export async function priceSettings(): Promise<PriceSettings> {
  const row = await prisma.setting.findUnique({ where: { scope_scopeId_key: { scope: "GLOBAL", scopeId: "", key: KEY } } });
  return { ...DEFAULT_SETTINGS, ...((row?.value as Partial<PriceSettings>) ?? {}) };
}

export async function savePriceSettings(ctx: Ctx, s: PriceSettings) {
  requireManage(ctx);
  const range = (v: number, lo: number, hi: number, what: string) => { if (!Number.isFinite(v) || v < lo || v > hi) throw new ValidationError(`${what} must be between ${lo} and ${hi}.`); };
  range(s.approvalThresholdPct, 0, 100, "Approval threshold"); range(s.noticeDays, 0, 60, "Notice days"); range(s.jumpPct, 1, 200, "Jump %");
  range(s.jumpWindowDays, 1, 60, "Jump window"); range(s.outlierPct, 5, 300, "Market deviation"); range(s.minSuppliers, 2, 10, "Minimum suppliers");
  range(s.notifyBuyersDays, 7, 365, "Customers who bought in");
  const before = await priceSettings();
  const value = { ...DEFAULT_SETTINGS, ...s };
  await prisma.setting.upsert({ where: { scope_scopeId_key: { scope: "GLOBAL", scopeId: "", key: KEY } }, create: { scope: "GLOBAL", key: KEY, value, updatedById: ctx.user.id }, update: { value, updatedById: ctx.user.id } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "pricing.settings_updated", entityType: "Setting", entityId: KEY, before, after: value });
}

// ── the market ──────────────────────────────────────────────────────────────

export type MarketOffer = {
  offerId: string; vendorId: string; vendor: string; flag: string | null; sellerType: "DISTRIBUTOR" | "WHOLESALER"; countryId: string; countryCode: string;
  variantId: string; productId: string; product: unknown; sku: string; categoryId: string; packaging: unknown; unitsPerPack: number; price: number; unitPrice: number; priceListId: string;
};
/** Comparable offers: the same product variant, sold by the same kind of supplier — wholesalers per country, distributors EU-wide. */
export const marketKey = (o: Pick<MarketOffer, "variantId" | "sellerType" | "countryId">) => `${o.variantId}|${o.sellerType}|${o.sellerType === "WHOLESALER" ? o.countryId : "EU"}`;

/** Base price (1 unit tier) of every active, visible offer — what customers see. */
export async function marketOffers(where: Prisma.VendorOfferWhereInput = {}): Promise<MarketOffer[]> {
  const now = new Date();
  const rows = await prisma.priceListItem.findMany({
    where: {
      minQty: 1,
      priceList: { scope: "BASE", isActive: true, validFrom: { lte: now }, OR: [{ validTo: null }, { validTo: { gt: now } }] },
      offer: { status: "ACTIVE", compliancePausedAt: null, vendor: { status: "APPROVED", compliancePausedAt: null }, ...where },
    },
    select: {
      unitPriceNet: true, priceListId: true,
      offer: { select: { id: true, vendorCompanyId: true, sellerType: true, countryId: true, country: { select: { code: true } }, vendor: { select: { legalName: true, tradeName: true, country: { select: { flag: true } } } },
        packaging: { select: { name: true, unitsPerPack: true, variantId: true, variant: { select: { sku: true, product: { select: { id: true, name: true, categoryId: true } } } } } } } },
    },
  });
  const seen = new Set<string>();
  const out: MarketOffer[] = [];
  for (const r of rows) {
    const o = r.offer;
    if (seen.has(o.id)) continue;
    seen.add(o.id);
    const price = Number(r.unitPriceNet);
    out.push({
      offerId: o.id, vendorId: o.vendorCompanyId, vendor: o.vendor.tradeName ?? o.vendor.legalName, flag: o.vendor.country.flag, sellerType: o.sellerType, countryId: o.countryId, countryCode: o.country.code,
      variantId: o.packaging.variantId, productId: o.packaging.variant.product.id, product: o.packaging.variant.product.name, sku: o.packaging.variant.sku, categoryId: o.packaging.variant.product.categoryId,
      packaging: o.packaging.name, unitsPerPack: o.packaging.unitsPerPack, price, unitPrice: price / Math.max(1, o.packaging.unitsPerPack), priceListId: r.priceListId,
    });
  }
  return out;
}

export function groupMarkets(offers: MarketOffer[]) {
  const by = new Map<string, MarketOffer[]>();
  for (const o of offers) by.set(marketKey(o), [...(by.get(marketKey(o)) ?? []), o]);
  return by;
}
/** Market statistics on per-unit prices; counted by supplier (one supplier with two pack sizes counts once, cheapest). */
export function statsOf(offers: MarketOffer[]): MarketStats | null {
  const best = new Map<string, number>();
  for (const o of offers) best.set(o.vendorId, Math.min(best.get(o.vendorId) ?? Infinity, o.unitPrice));
  return marketStats([...best.values()]);
}

/** Admin: every product sold by two or more suppliers, with its spread. */
export async function priceComparison(ctx: Ctx, f: { q?: string; sellerType?: "DISTRIBUTOR" | "WHOLESALER" } = {}) {
  requireView(ctx);
  const markets = groupMarkets(await marketOffers(f.sellerType ? { sellerType: f.sellerType } : {}));
  const q = f.q?.trim().toLowerCase();
  const out = [];
  for (const [key, offers] of markets) {
    const s = statsOf(offers);
    if (!s || s.n < 2) continue;
    const o = offers[0];
    const label = nameOf(o.product);
    if (q && !label.toLowerCase().includes(q) && !o.sku.toLowerCase().includes(q)) continue;
    const sorted = [...offers].sort((a, b) => a.unitPrice - b.unitPrice);
    out.push({
      key, variantId: o.variantId, product: label, sku: o.sku, sellerType: o.sellerType, market: o.sellerType === "WHOLESALER" ? o.countryCode : "EU", stats: s,
      cheapest: { vendor: sorted[0].vendor, unitPrice: sorted[0].unitPrice }, dearest: { vendor: sorted[sorted.length - 1].vendor, unitPrice: sorted[sorted.length - 1].unitPrice },
      offers: sorted.map((x) => ({ offerId: x.offerId, vendor: x.vendor, flag: x.flag, packaging: nameOf(x.packaging), unitsPerPack: x.unitsPerPack, price: x.price, unitPrice: x.unitPrice, devPct: deviationPct(x.unitPrice, s.median) })),
    });
  }
  return out.sort((a, b) => b.stats.spreadPct - a.stats.spreadPct);
}

/** Admin: price timeline of a product (one line per supplier, per-unit base price). */
export async function productHistory(ctx: Ctx, variantId: string, months = 6) {
  requireView(ctx);
  const variant = await prisma.productVariant.findUnique({ where: { id: variantId }, select: { id: true, sku: true, product: { select: { name: true } } } });
  if (!variant) throw new NotFoundError("Product");
  const offers = await prisma.vendorOffer.findMany({
    where: { packaging: { variantId } },
    select: { id: true, sellerType: true, countryId: true, status: true, vendor: { select: { id: true, legalName: true, tradeName: true, country: { select: { flag: true } } } }, packaging: { select: { name: true, unitsPerPack: true } } },
  });
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, now.getUTCDate()));
  const hist = await prisma.priceHistory.findMany({ where: { offerId: { in: offers.map((o) => o.id) }, scope: "BASE", minQty: 1 }, orderBy: { changedAt: "asc" } });
  const series = offers.map((o) => {
    const log: Change[] = hist.filter((h) => h.offerId === o.id).map((h) => ({ changedAt: h.changedAt, newPrice: h.newPrice === null ? null : Number(h.newPrice) }));
    return {
      offerId: o.id, vendor: `${o.vendor.tradeName ?? o.vendor.legalName}${o.packaging.unitsPerPack > 1 ? ` (${o.packaging.unitsPerPack}×)` : ""}`, flag: o.vendor.country.flag, sellerType: o.sellerType, active: o.status === "ACTIVE",
      points: stepSeries(log, from, now, o.packaging.unitsPerPack),
      changes: hist.filter((h) => h.offerId === o.id && h.changedAt >= from).map((h) => ({ at: h.changedAt, old: h.oldPrice === null ? null : Number(h.oldPrice), new: h.newPrice === null ? null : Number(h.newPrice), pct: h.changePct === null ? null : Number(h.changePct), unitsPerPack: o.packaging.unitsPerPack })),
    };
  }).filter((s) => s.points.some((p) => p.v !== null));
  return { variantId, product: nameOf(variant.product.name), sku: variant.sku, from, now, series };
}

/** Admin: recent price changes everywhere (base and customer prices). */
export async function recentChanges(ctx: Ctx, days = 30) {
  requireView(ctx);
  const since = new Date(Date.now() - days * DAY);
  const rows = await prisma.priceHistory.findMany({ where: { changedAt: { gte: since }, oldPrice: { not: null } }, orderBy: { changedAt: "desc" }, take: 500 });
  const offers = await prisma.vendorOffer.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.offerId))] } }, select: { id: true, vendor: { select: { id: true, legalName: true, tradeName: true } }, packaging: { select: { name: true, unitsPerPack: true, variantId: true, variant: { select: { sku: true, product: { select: { name: true } } } } } } } });
  const by = new Map(offers.map((o) => [o.id, o]));
  return rows.filter((r) => by.has(r.offerId)).map((r) => {
    const o = by.get(r.offerId)!;
    return { id: r.id, at: r.changedAt, scope: r.scope, minQty: r.minQty, old: r.oldPrice === null ? null : Number(r.oldPrice), new: r.newPrice === null ? null : Number(r.newPrice), pct: r.changePct === null ? null : Number(r.changePct),
      offerId: o.id, vendorId: o.vendor.id, vendor: o.vendor.tradeName ?? o.vendor.legalName, product: nameOf(o.packaging.variant.product.name), packaging: nameOf(o.packaging.name), sku: o.packaging.variant.sku, variantId: o.packaging.variantId };
  });
}

// ── change requests ─────────────────────────────────────────────────────────

/**
 * Called by setPrice before it writes: a big increase on an existing price is held as a request for
 * FIRINGI (returns its id) instead of being applied. Any other change cancels an open request for
 * the same price (the supplier changed their mind).
 */
export async function holdForApproval(ctx: Ctx, pl: PriceList, offerId: string, minQty: number, oldPrice: Decimal | null, newPrice: Decimal, reason?: string | null): Promise<string | null> {
  const s = await priceSettings();
  const open = await prisma.priceChangeRequest.findMany({ where: { priceListId: pl.id, offerId, minQty, status: { in: ["PENDING", "APPROVED"] } } });
  if (open.length) await prisma.priceChangeRequest.updateMany({ where: { id: { in: open.map((o) => o.id) } }, data: { status: "CANCELLED", decisionNote: "Replaced by a newer price from the supplier" } });
  if (!needsApproval(oldPrice === null ? null : oldPrice.toNumber(), newPrice.toNumber(), s.approvalThresholdPct)) return null;
  const pct = deviationPct(newPrice.toNumber(), oldPrice!.toNumber());
  const r = await prisma.priceChangeRequest.create({
    data: { vendorCompanyId: ctx.company.id, offerId, priceListId: pl.id, minQty, oldPrice: oldPrice!.toFixed(4), newPrice: newPrice.toFixed(4), changePct: pct.toFixed(2), reason: reason?.trim() || null, createdById: ctx.user.id },
  });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "pricing.change_requested", entityType: "PriceChangeRequest", entityId: r.id, after: { offerId, minQty, old: oldPrice!.toFixed(4), new: newPrice.toFixed(4), pct } });
  const offer = await prisma.vendorOffer.findUniqueOrThrow({ where: { id: offerId }, select: { packaging: { select: { variant: { select: { product: { select: { name: true } } } } } } } });
  await notify("price.change_requested", [{ companyId: await firingiId(), link: "/admin/pricing/intelligence/requests" }],
    { vendor: ctx.company.tradeName ?? ctx.company.legalName, product: nameOf(offer.packaging.variant.product.name), old: money(oldPrice!), new: money(newPrice), pct }, { ref: { type: "PriceChangeRequest", id: r.id } }).catch(() => null);
  return r.id;
}

const reqInclude = {
  vendor: { select: { id: true, legalName: true, tradeName: true, country: { select: { flag: true } } } },
  priceList: { select: { name: true, scope: true, targetCompany: { select: { legalName: true } }, targetGroup: { select: { name: true } } } },
  offer: { select: { id: true, packaging: { select: { name: true, unitsPerPack: true, variantId: true, variant: { select: { sku: true, product: { select: { name: true } } } } } } } },
} satisfies Prisma.PriceChangeRequestInclude;

export async function listRequests(ctx: Ctx, status?: "PENDING" | "APPROVED" | "ALL") {
  requireView(ctx);
  const rows = await prisma.priceChangeRequest.findMany({ where: status && status !== "ALL" ? { status } : {}, include: reqInclude, orderBy: [{ status: "asc" }, { createdAt: "desc" }], take: 300 });
  const offers = await marketOffers({ id: { in: rows.map((r) => r.offerId) } }).then(async (own) => {
    const all = await marketOffers({ packaging: { variantId: { in: [...new Set(own.map((o) => o.variantId))] } } });
    return { own, markets: groupMarkets(all) };
  });
  return rows.map((r) => {
    const o = offers.own.find((x) => x.offerId === r.offerId);
    const s = o ? statsOf(offers.markets.get(marketKey(o)) ?? []) : null;
    const per = r.offer.packaging.unitsPerPack;
    return { ...r, product: nameOf(r.offer.packaging.variant.product.name), packaging: nameOf(r.offer.packaging.name), sku: r.offer.packaging.variant.sku, market: s && s.n >= 2 ? { median: s.median * per, n: s.n, newVsMedian: deviationPct(Number(r.newPrice) / per, s.median) } : null };
  });
}

/** Customers to tell about a price change: who bought it lately / keep it in a list or recurring order; group / contract lists → their customers. */
async function buyersOf(pl: { scope: string; targetCompanyId: string | null; targetGroupId: string | null }, offerId: string, days: number) {
  if (pl.scope === "CUSTOMER" || pl.scope === "CONTRACT") return pl.targetCompanyId ? [pl.targetCompanyId] : [];
  if (pl.scope === "CUSTOMER_GROUP") return (await prisma.customerGroupMember.findMany({ where: { groupId: pl.targetGroupId ?? "" }, select: { companyId: true } })).map((m) => m.companyId);
  const since = new Date(Date.now() - days * DAY);
  const [orders, lists, recurring] = await Promise.all([
    prisma.order.findMany({ where: { placedAt: { gte: since }, status: { not: "CANCELLED" }, lines: { some: { offerId } } }, select: { buyerCompanyId: true }, distinct: ["buyerCompanyId"] }),
    prisma.orderListItem.findMany({ where: { offerId }, select: { list: { select: { companyId: true } } } }),
    prisma.recurringOrderItem.findMany({ where: { offerId, recurring: { status: "ACTIVE" } }, select: { recurring: { select: { buyerCompanyId: true } } } }).catch(() => [] as { recurring: { buyerCompanyId: string } }[]),
  ]);
  return [...new Set([...orders.map((o) => o.buyerCompanyId), ...lists.map((l) => l.list.companyId), ...recurring.map((r) => r.recurring.buyerCompanyId)])];
}

export async function approveRequest(ctx: Ctx, id: string, i: { effectiveAt?: string | null; note?: string | null } = {}) {
  requireManage(ctx);
  const r = await prisma.priceChangeRequest.findUnique({ where: { id }, include: { ...reqInclude, priceList: true } });
  if (!r) throw new NotFoundError("Price change");
  if (r.status !== "PENDING") throw new AppError("BAD_STATUS", "Only waiting price changes can be approved.");
  const s = await priceSettings();
  const earliest = new Date(Date.now() + s.noticeDays * DAY);
  let effectiveAt = earliest;
  if (i.effectiveAt) {
    const d = new Date(`${i.effectiveAt.slice(0, 10)}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) throw new ValidationError("Invalid date.");
    if (d.getTime() < earliest.getTime() - DAY) throw new ValidationError(`Customers must be told at least ${s.noticeDays} days ahead.`);
    effectiveAt = d > earliest ? d : earliest;
  }
  const buyers = s.noticeDays > 0 ? await buyersOf(r.priceList, r.offerId, s.notifyBuyersDays) : [];
  await prisma.priceChangeRequest.update({ where: { id }, data: { status: "APPROVED", effectiveAt, decidedById: ctx.user.id, decidedAt: new Date(), decisionNote: i.note?.trim() || null, noticeSent: buyers.length } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "pricing.change_approved", entityType: "PriceChangeRequest", entityId: id, after: { effectiveAt, note: i.note ?? null, customersTold: buyers.length } });
  const product = nameOf(r.offer.packaging.variant.product.name);
  const vendor = r.vendor.tradeName ?? r.vendor.legalName;
  const date = effectiveAt.toISOString().slice(0, 10);
  await notify("price.change_approved", [{ companyId: r.vendorCompanyId, link: "/vendor/products/price-insights" }], { product, new: money(r.newPrice), date }, { ref: { type: "PriceChangeRequest", id } }).catch(() => null);
  if (buyers.length) await notify("price.increase_notice", buyers.map((companyId) => ({ companyId, link: "/buy/catalogue/price-changes" })), { product, supplier: vendor, old: money(r.oldPrice), new: money(r.newPrice), date }, { ref: { type: "PriceChangeRequest", id } }).catch(() => null);
  if (effectiveAt.getTime() <= Date.now()) await applyRequest(id);
  return { effectiveAt, customersTold: buyers.length };
}

export async function rejectRequest(ctx: Ctx, id: string, note: string) {
  requireManage(ctx);
  if (!note?.trim()) throw new ValidationError("Say why — the supplier sees it.");
  const r = await prisma.priceChangeRequest.findUnique({ where: { id }, include: reqInclude });
  if (!r) throw new NotFoundError("Price change");
  if (r.status !== "PENDING" && r.status !== "APPROVED") throw new AppError("BAD_STATUS", "This price change is already closed.");
  await prisma.priceChangeRequest.update({ where: { id }, data: { status: "REJECTED", decidedById: ctx.user.id, decidedAt: new Date(), decisionNote: note.trim() } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "pricing.change_rejected", entityType: "PriceChangeRequest", entityId: id, after: { note } });
  await notify("price.change_rejected", [{ companyId: r.vendorCompanyId, link: "/vendor/products/price-insights" }], { product: nameOf(r.offer.packaging.variant.product.name), reason: note.trim() }, { ref: { type: "PriceChangeRequest", id } }).catch(() => null);
}

/** The supplier withdraws a price change that hasn't applied yet. */
export async function cancelRequest(ctx: Ctx, id: string) {
  if (!can(ctx, "vendor.pricing.manage")) throw new ForbiddenError();
  const r = await prisma.priceChangeRequest.updateMany({ where: { id, vendorCompanyId: ctx.company.id, status: { in: ["PENDING", "APPROVED"] } }, data: { status: "CANCELLED", decisionNote: "Withdrawn by the supplier" } });
  if (!r.count) throw new NotFoundError("Price change");
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "pricing.change_cancelled", entityType: "PriceChangeRequest", entityId: id });
}

async function applyRequest(id: string) {
  const r = await prisma.priceChangeRequest.findUnique({ where: { id } });
  if (!r || r.status !== "APPROVED") return false;
  await prisma.$transaction([
    prisma.priceListItem.upsert({ where: { priceListId_offerId_minQty: { priceListId: r.priceListId, offerId: r.offerId, minQty: r.minQty } }, update: { unitPriceNet: r.newPrice }, create: { priceListId: r.priceListId, offerId: r.offerId, minQty: r.minQty, unitPriceNet: r.newPrice } }),
    prisma.priceChangeRequest.update({ where: { id }, data: { status: "APPLIED", appliedAt: new Date() } }),
  ]);
  await writeAudit({ actorUserId: null, actorCompanyId: null, action: "pricing.change_applied", entityType: "PriceChangeRequest", entityId: id, after: { offerId: r.offerId, new: r.newPrice.toString() } });
  return true;
}

export async function applyDueRequests(now = new Date()) {
  const due = await prisma.priceChangeRequest.findMany({ where: { status: "APPROVED", effectiveAt: { lte: now } }, select: { id: true } });
  let applied = 0;
  for (const d of due) if (await applyRequest(d.id)) applied++;
  return applied;
}

// ── alerts ──────────────────────────────────────────────────────────────────

/** Find price jumps and prices far from the market; resolve alerts whose condition went away. */
export async function detectAlerts(now = new Date()) {
  const s = await priceSettings();
  const offers = await marketOffers();
  const markets = groupMarkets(offers);
  const found = new Map<string, { kind: "JUMP" | "ABOVE_MARKET" | "BELOW_MARKET"; o: MarketOffer; reference: number; dev: number }>();
  for (const list of markets.values()) {
    const st = statsOf(list);
    if (!st || st.n < s.minSuppliers) continue;
    for (const o of list) {
      const dev = deviationPct(o.unitPrice, st.median);
      if (dev >= s.outlierPct) found.set(`${o.offerId}|ABOVE_MARKET`, { kind: "ABOVE_MARKET", o, reference: st.median, dev });
      else if (dev <= -s.outlierPct) found.set(`${o.offerId}|BELOW_MARKET`, { kind: "BELOW_MARKET", o, reference: st.median, dev });
    }
  }
  const since = new Date(now.getTime() - (s.jumpWindowDays + 400) * DAY);
  const hist = await prisma.priceHistory.findMany({ where: { offerId: { in: offers.map((o) => o.offerId) }, scope: "BASE", minQty: 1, changedAt: { gte: since } }, orderBy: { changedAt: "asc" } });
  const byOffer = new Map<string, Change[]>();
  for (const h of hist) byOffer.set(h.offerId, [...(byOffer.get(h.offerId) ?? []), { changedAt: h.changedAt, newPrice: h.newPrice === null ? null : Number(h.newPrice) }]);
  for (const o of offers) {
    const j = jump(byOffer.get(o.offerId) ?? [], now, s.jumpWindowDays, s.jumpPct);
    if (j) found.set(`${o.offerId}|JUMP`, { kind: "JUMP", o, reference: j.from / o.unitsPerPack, dev: j.pct });
  }
  const open = await prisma.priceAlert.findMany({ where: { status: { in: ["OPEN", "ACKNOWLEDGED"] } } });
  let created = 0, resolved = 0;
  for (const a of open) {
    const f = found.get(`${a.offerId}|${a.kind}`);
    if (!f) { await prisma.priceAlert.update({ where: { id: a.id }, data: { status: "RESOLVED", resolvedAt: now } }); resolved++; continue; }
    await prisma.priceAlert.update({ where: { id: a.id }, data: { lastSeenAt: now, unitPrice: f.o.unitPrice.toFixed(4), reference: f.reference.toFixed(4), deviationPct: f.dev.toFixed(2) } });
    found.delete(`${a.offerId}|${a.kind}`);
  }
  for (const f of found.values()) {
    // a dismissed alert stays dismissed while the price is the same
    const dismissed = await prisma.priceAlert.findFirst({ where: { offerId: f.o.offerId, kind: f.kind, status: "DISMISSED", unitPrice: f.o.unitPrice.toFixed(4) } });
    if (dismissed) continue;
    await prisma.priceAlert.create({ data: { kind: f.kind, offerId: f.o.offerId, vendorCompanyId: f.o.vendorId, unitPrice: f.o.unitPrice.toFixed(4), reference: f.reference.toFixed(4), deviationPct: f.dev.toFixed(2), firstSeenAt: now, lastSeenAt: now } });
    created++;
  }
  if (created) await notify("price.alerts", [{ companyId: await firingiId(), link: "/admin/pricing/intelligence/alerts" }], { count: created }).catch(() => null);
  return { created, resolved };
}

export async function listAlerts(ctx: Ctx, status: "OPEN" | "ALL" = "OPEN") {
  requireView(ctx);
  const rows = await prisma.priceAlert.findMany({
    where: status === "OPEN" ? { status: { in: ["OPEN", "ACKNOWLEDGED"] } } : {},
    include: { vendor: { select: { id: true, legalName: true, tradeName: true } }, offer: { select: { packaging: { select: { name: true, unitsPerPack: true, variantId: true, variant: { select: { sku: true, product: { select: { name: true } } } } } } } } },
    orderBy: [{ status: "asc" }, { lastSeenAt: "desc" }], take: 300,
  });
  return rows.map((a) => ({ ...a, product: nameOf(a.offer.packaging.variant.product.name), sku: a.offer.packaging.variant.sku, variantId: a.offer.packaging.variantId, packaging: nameOf(a.offer.packaging.name), unitsPerPack: a.offer.packaging.unitsPerPack, vendorName: a.vendor.tradeName ?? a.vendor.legalName }));
}

export async function handleAlert(ctx: Ctx, id: string, to: "ACKNOWLEDGED" | "DISMISSED", note?: string | null) {
  requireManage(ctx);
  const r = await prisma.priceAlert.updateMany({ where: { id, status: { in: ["OPEN", "ACKNOWLEDGED"] } }, data: { status: to, handledById: ctx.user.id, handledAt: new Date(), note: note?.trim() || null } });
  if (!r.count) throw new NotFoundError("Alert");
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: `pricing.alert_${to.toLowerCase()}`, entityType: "PriceAlert", entityId: id, after: { note: note ?? null } });
}

/** Ask the supplier to look at a price (alert or suggestion). */
export async function askSupplierToReview(ctx: Ctx, offerId: string, message?: string | null) {
  requireManage(ctx);
  const o = (await marketOffers({ id: offerId }))[0];
  if (!o) throw new NotFoundError("Offer");
  const st = statsOf(groupMarkets(await marketOffers({ packaging: { variantId: o.variantId } })).get(marketKey(o)) ?? []);
  const vsMarket = st ? deviationPct(o.unitPrice, st.median) : 0;
  await notify("price.review_requested", [{ companyId: o.vendorId, link: "/vendor/products/price-insights" }], { product: nameOf(o.product), pct: vsMarket, message: message?.trim() ?? "" }).catch(() => null);
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "pricing.review_requested", entityType: "VendorOffer", entityId: offerId, after: { vsMarket, message: message ?? null } });
  return { vsMarket };
}

/** Hourly job: apply approved changes that are due, then look for alerts. */
export async function runPricingJob(now = new Date()) {
  const applied = await applyDueRequests(now);
  const alerts = await detectAlerts(now);
  return { applied, ...alerts };
}
