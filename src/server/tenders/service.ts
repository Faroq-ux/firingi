/**
 * Open tenders (Phase 50). A buyer posts what it needs (lines: a catalogue product or a description, quantities, a
 * delivery date, a closing time) — to every eligible supplier or only invited ones. Suppliers send sealed bids per line
 * (they never see each other's bids); the bid is the selling price the buyer pays, FIRINGI's commission comes off what
 * the supplier receives (as with quotes). After the close (or earlier) the buyer awards each line to a bid; each
 * supplier's awarded lines become one order at the bid prices (FIRINGI invoices the buyer as usual; pay later can be
 * chosen). Every part is FIRINGI's switch: the feature, who posts, who bids, approval, invitations, limits, each business.
 */
import "server-only";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";
import { notify } from "@/server/notify/dispatch";
import { activeCommission, nextNumber } from "@/server/services/orders";
import { cleanTenderSettings, groupAward, mergeTenderSettings, rankBids, SUPPLIER_TYPE, type TenderSettings } from "@/lib/tenders";

const KEY = "tenders.settings";
const FEATURE = "TENDERS";
const DAY = 86_400_000;
const nameOf = (c: { tradeName: string | null; legalName: string }) => c.tradeName ?? c.legalName;
const pick = (n: unknown) => (typeof n === "string" ? n : ((n as Record<string, string> | null)?.en ?? Object.values((n as Record<string, string>) ?? {})[0] ?? ""));
const offerSelect = { id: true, packaging: { select: { name: true, variant: { select: { sku: true, productId: true, product: { select: { name: true } } } } } } } as const;
const offerLabel = (o: { packaging: { name: unknown; variant: { sku: string; product: { name: unknown } } } }) => `${pick(o.packaging.variant.product.name)} — ${pick(o.packaging.name)} (${o.packaging.variant.sku})`;

// ── settings & switches ─────────────────────────────────────────────────────

export async function tenderSettings(): Promise<TenderSettings> {
  const row = await prisma.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: KEY } });
  return mergeTenderSettings(row?.value as Partial<TenderSettings> | null);
}

function staff(ctx: Ctx, manage = false) {
  if (ctx.company.type !== "ADMIN") throw new ForbiddenError();
  if (!can(ctx, manage ? ["admin.orders.manage", "admin.settings.manage"] : ["admin.orders.view", "admin.orders.manage", "admin.settings.manage"])) throw new ForbiddenError();
}

export async function saveTenderSettings(ctx: Ctx, input: TenderSettings) {
  staff(ctx, true);
  let v: TenderSettings;
  try { v = cleanTenderSettings(input); } catch (e) { throw new ValidationError((e as Error).message); }
  const before = await tenderSettings();
  const row = await prisma.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: KEY } });
  if (row) await prisma.setting.update({ where: { id: row.id }, data: { value: v } });
  else await prisma.setting.create({ data: { scope: "GLOBAL", scopeId: "", key: KEY, value: v } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "tenders.settings_saved", entityType: "Setting", entityId: KEY, before, after: v });
  return v;
}

export async function companySwitch(companyId: string): Promise<"DEFAULT" | "ON" | "OFF"> {
  const f = await prisma.companyFeature.findUnique({ where: { companyId_key: { companyId, key: FEATURE } } });
  return !f ? "DEFAULT" : f.enabled ? "ON" : "OFF";
}

export async function setCompanySwitch(ctx: Ctx, companyId: string, state: "DEFAULT" | "ON" | "OFF") {
  staff(ctx, true);
  const co = await prisma.company.findUnique({ where: { id: companyId }, select: { type: true } });
  if (!co || co.type === "ADMIN") throw new NotFoundError("Business");
  if (state === "DEFAULT") await prisma.companyFeature.deleteMany({ where: { companyId, key: FEATURE } });
  else await prisma.companyFeature.upsert({ where: { companyId_key: { companyId, key: FEATURE } }, create: { companyId, key: FEATURE, enabled: state === "ON", updatedById: ctx.user.id }, update: { enabled: state === "ON", updatedById: ctx.user.id } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "tenders.company_switch", entityType: "Company", entityId: companyId, after: { state } });
}

/** May this business post tenders (buyers) / bid (suppliers)? */
export async function tenderAccess(co: { id: string; type: string }, s?: TenderSettings) {
  const set = s ?? (await tenderSettings());
  if (!set.enabled) return { post: false, bid: false, why: "OFF" as const };
  const sw = await companySwitch(co.id);
  if (sw === "OFF") return { post: false, bid: false, why: "COMPANY_OFF" as const };
  const on = sw === "ON";
  const post = (co.type === "CUSTOMER" || co.type === "WHOLESALER") && (on || set.buyers[co.type]);
  const bid = (co.type === "WHOLESALER" || co.type === "DISTRIBUTOR") && (on || set.suppliers[co.type]);
  return { post, bid, why: post || bid ? null : ("TYPE_OFF" as const) };
}

/** Suppliers that may bid on a buyer's tenders (by type, country, FIRINGI's switches). */
async function eligibleSuppliers(buyer: { type: string; countryId: string }, s: TenderSettings, only?: string[]) {
  const type = SUPPLIER_TYPE[buyer.type as "CUSTOMER" | "WHOLESALER"];
  const rows = await prisma.company.findMany({
    where: { status: "APPROVED", type, ...(type === "WHOLESALER" ? { countryId: buyer.countryId } : {}), ...(only?.length ? { id: { in: only } } : {}) },
    select: { id: true, legalName: true, tradeName: true, type: true }, orderBy: { legalName: "asc" }, take: 1000,
  });
  const offs = new Set((await prisma.companyFeature.findMany({ where: { key: FEATURE, companyId: { in: rows.map((r) => r.id) } } })).filter((f) => !f.enabled).map((f) => f.companyId));
  const ons = new Set((await prisma.companyFeature.findMany({ where: { key: FEATURE, enabled: true, companyId: { in: rows.map((r) => r.id) } } })).map((f) => f.companyId));
  return rows.filter((r) => !offs.has(r.id) && (s.suppliers[r.type as "WHOLESALER" | "DISTRIBUTOR"] || ons.has(r.id)));
}

function buyerSide(ctx: Ctx) {
  if (ctx.company.type !== "CUSTOMER" && ctx.company.type !== "WHOLESALER") throw new ForbiddenError();
  if (!can(ctx, "buyer.orders.place")) throw new ForbiddenError();
}
function supplierSide(ctx: Ctx) {
  if (ctx.company.type !== "WHOLESALER" && ctx.company.type !== "DISTRIBUTOR") throw new ForbiddenError();
  if (!can(ctx, ["vendor.pricing.manage", "vendor.orders.manage"])) throw new ForbiddenError();
}

// ── buyer ───────────────────────────────────────────────────────────────────

export type TenderInput = {
  title: string; note?: string | null; addressId: string; deliveryDate?: string | null; closesAt: string; invitedIds?: string[];
  lines: { productId?: string | null; description?: string | null; qty: number; unitNote?: string | null; targetUnitNet?: number | null }[];
};

/** Suppliers a buyer may invite (for the tender form). */
export async function invitableSuppliers(ctx: Ctx) {
  buyerSide(ctx);
  const s = await tenderSettings();
  return (await eligibleSuppliers(ctx.company, s)).map((c) => ({ id: c.id, name: nameOf(c) }));
}

/** Catalogue products for tender lines (by name / SKU). */
export async function searchProducts(ctx: Ctx, q: string) {
  buyerSide(ctx);
  const t = q.trim().toLowerCase();
  if (t.length < 2) return [];
  const rows = await prisma.product.findMany({ where: { OR: [{ searchText: { contains: t } }, { variants: { some: { sku: { contains: t, mode: "insensitive" } } } }] }, select: { id: true, name: true }, take: 20 });
  return rows.map((p) => ({ id: p.id, name: pick(p.name) }));
}

export async function createTender(ctx: Ctx, i: TenderInput) {
  buyerSide(ctx);
  const s = await tenderSettings();
  if (!(await tenderAccess(ctx.company, s)).post) throw new ForbiddenError("Tenders aren't open for your business.");
  const title = i.title?.trim();
  if (!title || title.length > 120) throw new ValidationError("Give the tender a title (up to 120 characters).");
  if (!i.lines?.length) throw new ValidationError("Add at least one line.");
  if (i.lines.length > s.maxLines) throw new ValidationError(`A tender has at most ${s.maxLines} lines.`);
  const closesAt = new Date(i.closesAt);
  const hours = (closesAt.getTime() - Date.now()) / 3_600_000;
  if (!(hours >= s.minHours - 0.05)) throw new ValidationError(`Bidding stays open at least ${s.minHours} hours.`);
  if (hours > s.maxDays * 24) throw new ValidationError(`Bidding stays open at most ${s.maxDays} days.`);
  const deliveryDate = i.deliveryDate ? new Date(`${i.deliveryDate.slice(0, 10)}T00:00:00Z`) : null;
  if (deliveryDate && deliveryDate.getTime() < closesAt.getTime() - DAY) throw new ValidationError("Delivery can't be before bidding closes.");
  const addr = await prisma.address.findFirst({ where: { id: i.addressId, companyId: ctx.company.id, kind: "DELIVERY", isActive: true } });
  if (!addr) throw new ValidationError("Choose one of your delivery addresses.");
  const productIds = i.lines.map((l) => l.productId).filter((x): x is string => !!x);
  const products = new Map((await prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true } })).map((p) => [p.id, pick(p.name)]));
  const lines = i.lines.map((l, k) => {
    const qty = Math.floor(Number(l.qty));
    if (!(qty >= 1 && qty <= 1_000_000)) throw new ValidationError(`Line ${k + 1}: check the quantity.`);
    if (l.productId && !products.has(l.productId)) throw new ValidationError(`Line ${k + 1}: that product isn't in the catalogue.`);
    const description = (l.description?.trim() || (l.productId ? products.get(l.productId) : "") || "").slice(0, 300);
    if (!description) throw new ValidationError(`Line ${k + 1}: choose a product or describe what you need.`);
    const target = s.targetPrices && l.targetUnitNet != null && Number(l.targetUnitNet) > 0 ? Number(l.targetUnitNet) : null;
    return { n: k + 1, productId: l.productId ?? null, description, qty, unitNote: l.unitNote?.trim().slice(0, 60) || null, targetUnitNet: target?.toFixed(4) ?? null };
  });
  let invited: string[] = [];
  if (i.invitedIds?.length) {
    if (!s.invitations) throw new ValidationError("FIRINGI has switched invitations off — tenders go to every eligible supplier.");
    invited = (await eligibleSuppliers(ctx.company, s, i.invitedIds)).map((c) => c.id);
    if (!invited.length) throw new ValidationError("None of the chosen suppliers can bid on your tenders.");
  }
  const status = s.approval === "AUTO" ? "OPEN" : "PENDING";
  const t = await prisma.$transaction(async (tx) => tx.tender.create({
    data: {
      number: await nextNumber(tx, "tender", "TD"), buyerCompanyId: ctx.company.id, countryId: ctx.company.countryId, title, note: i.note?.trim().slice(0, 1000) || null,
      addressId: addr.id, deliveryDate, closesAt, status, invitedIds: invited, createdById: ctx.user.id, lines: { create: lines },
    },
  }));
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "tenders.created", entityType: "Tender", entityId: t.id, after: { status, lines: lines.length, invited: invited.length } });
  if (status === "OPEN") await announce(t.id);
  else {
    const admins = await prisma.company.findMany({ where: { type: "ADMIN" }, select: { id: true } });
    for (const a of admins) await notify("tender.review", [{ companyId: a.id, link: `/admin/orders/tenders/${t.id}` }], { number: t.number, company: nameOf(ctx.company), title }).catch(() => null);
  }
  return t;
}

/** Tell the suppliers that may bid. */
async function announce(tenderId: string) {
  const t = await prisma.tender.findUniqueOrThrow({ where: { id: tenderId }, include: { buyer: { select: { type: true, countryId: true } }, _count: { select: { lines: true } } } });
  const s = await tenderSettings();
  const to = await eligibleSuppliers(t.buyer, s, t.invitedIds.length ? t.invitedIds : undefined);
  for (const c of to.slice(0, 300)) await notify("tender.opened", [{ companyId: c.id, link: `/vendor/orders/tenders/${t.id}` }], { number: t.number, title: t.title, lines: t._count.lines, date: t.closesAt.toISOString().slice(0, 16).replace("T", " ") }).catch(() => null);
}

export async function cancelTender(ctx: Ctx, id: string) {
  buyerSide(ctx);
  const t = await prisma.tender.findFirst({ where: { id, buyerCompanyId: ctx.company.id } });
  if (!t) throw new NotFoundError("Tender");
  if (!["PENDING", "OPEN", "CLOSED"].includes(t.status)) throw new ValidationError("This tender is already finished.");
  await prisma.tender.update({ where: { id }, data: { status: "CANCELLED" } });
  await prisma.tenderBid.updateMany({ where: { tenderId: id, status: "SUBMITTED" }, data: { status: "LOST" } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "tenders.cancelled", entityType: "Tender", entityId: id });
}

/** Close bidding now (the buyer has enough bids). */
export async function closeNow(ctx: Ctx, id: string) {
  buyerSide(ctx);
  const t = await prisma.tender.findFirst({ where: { id, buyerCompanyId: ctx.company.id } });
  if (!t) throw new NotFoundError("Tender");
  if (t.status !== "OPEN") throw new ValidationError("Bidding isn't open.");
  await prisma.tender.update({ where: { id }, data: { status: "CLOSED", closesAt: new Date() } });
}

export async function myTenders(ctx: Ctx) {
  if (ctx.company.type !== "CUSTOMER" && ctx.company.type !== "WHOLESALER") throw new ForbiddenError();
  const s = await tenderSettings();
  const access = await tenderAccess(ctx.company, s);
  const rows = await prisma.tender.findMany({ where: { buyerCompanyId: ctx.company.id }, include: { _count: { select: { lines: true, bids: { where: { status: { not: "WITHDRAWN" } } } } } }, orderBy: { createdAt: "desc" }, take: 200 });
  return { settings: s, access, tenders: rows.map((t) => ({ id: t.id, number: t.number, title: t.title, status: t.status, closesAt: t.closesAt, deliveryDate: t.deliveryDate, lines: t._count.lines, bids: t._count.bids, createdAt: t.createdAt })) };
}

/** The buyer's view: every line with the bids on it, cheapest first (selling prices; never commission). */
export async function buyerTender(ctx: Ctx, id: string) {
  if (ctx.company.type !== "ADMIN" && ctx.company.type !== "CUSTOMER" && ctx.company.type !== "WHOLESALER") throw new ForbiddenError();
  if (ctx.company.type === "ADMIN") staff(ctx);
  const t = await prisma.tender.findFirst({
    where: { id, ...(ctx.company.type === "ADMIN" ? {} : { buyerCompanyId: ctx.company.id }) },
    include: { lines: { orderBy: { n: "asc" } }, bids: { where: { status: { not: "WITHDRAWN" } }, include: { supplier: { select: { id: true, legalName: true, tradeName: true } }, lines: { include: { offer: { select: offerSelect } } } } }, buyer: { select: { legalName: true, tradeName: true } } },
  });
  if (!t) throw new NotFoundError("Tender");
  const orders = await prisma.order.findMany({ where: { id: { in: t.lines.map((l) => l.orderId).filter((x): x is string => !!x) } }, select: { id: true, number: true } });
  const invited = t.invitedIds.length ? await prisma.company.findMany({ where: { id: { in: t.invitedIds } }, select: { legalName: true, tradeName: true } }) : [];
  const address = await prisma.address.findUnique({ where: { id: t.addressId }, select: { label: true, line1: true, cityName: true } });
  const lines = t.lines.map((l) => {
    const bids = t.bids.flatMap((b) => b.lines.filter((x) => x.lineId === l.id).map((x) => ({ bidLineId: x.id, supplierId: b.supplierCompanyId, supplier: nameOf(b.supplier), offer: offerLabel(x.offer), unitNet: Number(x.unitNet), total: Math.round(Number(x.unitNet) * l.qty * 100) / 100, note: b.note })));
    return { id: l.id, n: l.n, description: l.description, productId: l.productId, qty: l.qty, unitNote: l.unitNote, targetUnitNet: l.targetUnitNet != null ? Number(l.targetUnitNet) : null, awardedBidLineId: l.awardedBidLineId, order: orders.find((o) => o.id === l.orderId) ?? null, bids: rankBids(bids, l.targetUnitNet != null ? Number(l.targetUnitNet) : null) };
  });
  const s = await tenderSettings();
  return {
    tender: { id: t.id, number: t.number, title: t.title, note: t.note, status: t.status, closesAt: t.closesAt, deliveryDate: t.deliveryDate, reviewNote: t.reviewNote, createdAt: t.createdAt, buyer: nameOf(t.buyer), address, invited: invited.map(nameOf) },
    lines, suppliers: new Set(t.bids.map((b) => b.supplierCompanyId)).size, settings: s,
    canAward: ctx.company.type !== "ADMIN" && (t.status === "OPEN" || t.status === "CLOSED") && lines.some((l) => l.bids.length),
  };
}

/**
 * Award: each line to one of its bids (or none). Each supplier's lines become one order at the bid prices
 * (placed by the buyer, already approved; optional pay later). Bids are WON / LOST; suppliers are told.
 */
export async function award(ctx: Ctx, id: string, picks: Record<string, string | null>, opts: { payLaterTermId?: string | null; poReference?: string | null } = {}) {
  buyerSide(ctx);
  const s = await tenderSettings();
  const t = await prisma.tender.findFirst({ where: { id, buyerCompanyId: ctx.company.id }, include: { lines: true, bids: { include: { lines: true } } } });
  if (!t) throw new NotFoundError("Tender");
  if (t.status !== "OPEN" && t.status !== "CLOSED") throw new ValidationError("This tender can't be awarded any more.");
  if (opts.payLaterTermId && !s.payLater) throw new ValidationError("Pay later isn't offered for tenders.");
  const chosen: { lineId: string; supplierId: string; bidLineId: string; offerId: string; unitNet: string; qty: number }[] = [];
  for (const l of t.lines) {
    const bl = picks[l.id];
    if (!bl) continue;
    const b = t.bids.find((x) => x.status !== "WITHDRAWN" && x.lines.some((y) => y.id === bl && y.lineId === l.id));
    if (!b) throw new ValidationError(`Line ${l.n}: choose one of its bids.`);
    const line = b.lines.find((y) => y.id === bl)!;
    chosen.push({ lineId: l.id, supplierId: b.supplierCompanyId, bidLineId: bl, offerId: line.offerId, unitNet: line.unitNet.toString(), qty: l.qty });
  }
  if (!chosen.length) throw new ValidationError("Award at least one line.");
  const { placeOrder } = await import("@/server/services/orders");
  const placed: { supplierId: string; orderId: string; number: string }[] = [], failed: { supplierId: string; error: string }[] = [];
  for (const [supplierId, ls] of groupAward(chosen)) {
    try {
      const r = await placeOrder(ctx, {
        deliveryAddressId: t.addressId, requestedDeliveryDate: t.deliveryDate, notes: `Tender ${t.number}: ${t.title}`.slice(0, 500), approved: true, poReference: opts.poReference ?? null,
        items: ls.map((x) => ({ offerId: x.offerId, qty: x.qty })), fixedPrices: new Map(ls.map((x) => [x.offerId, x.unitNet])),
        payLater: opts.payLaterTermId ? { termId: opts.payLaterTermId } : null,
      });
      const orderId = r.orders[0]?.id ?? r.id;
      for (const x of ls) await prisma.tenderLine.update({ where: { id: x.lineId }, data: { awardedBidLineId: x.bidLineId, orderId } });
      placed.push({ supplierId, orderId, number: r.orders[0]?.number ?? r.number });
    } catch (e) { failed.push({ supplierId, error: (e as Error).message }); }
  }
  if (!placed.length) throw new ValidationError(`No order could be placed: ${failed.map((f) => f.error).join(" / ")}`);
  await prisma.tender.update({ where: { id }, data: { status: "AWARDED", awardedAt: new Date(), ...(t.status === "OPEN" ? { closesAt: new Date() } : {}) } });
  const winners = new Set(placed.map((p) => p.supplierId));
  for (const b of t.bids.filter((x) => x.status !== "WITHDRAWN")) {
    const won = winners.has(b.supplierCompanyId);
    await prisma.tenderBid.update({ where: { id: b.id }, data: { status: won ? "WON" : "LOST" } });
    const p = placed.find((x) => x.supplierId === b.supplierCompanyId);
    if (p) await notify("tender.awarded", [{ companyId: b.supplierCompanyId, link: `/vendor/orders/${p.orderId}` }], { number: t.number, title: t.title, lines: chosen.filter((c) => c.supplierId === b.supplierCompanyId).length, order: p.number }).catch(() => null);
    else await notify("tender.lost", [{ companyId: b.supplierCompanyId, link: `/vendor/orders/tenders/${t.id}` }], { number: t.number, title: t.title }).catch(() => null);
  }
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "tenders.awarded", entityType: "Tender", entityId: id, after: { orders: placed.map((p) => p.number), failed } });
  return { placed, failed };
}

// ── supplier ────────────────────────────────────────────────────────────────

const openFor = (co: { id: string; type: string; countryId: string }) => ({
  status: "OPEN" as const, closesAt: { gt: new Date() },
  buyer: { type: co.type === "WHOLESALER" ? ("CUSTOMER" as const) : ("WHOLESALER" as const), ...(co.type === "WHOLESALER" ? { countryId: co.countryId } : {}) },
  OR: [{ invitedIds: { isEmpty: true } }, { invitedIds: { has: co.id } }],
});

/** Open tenders the supplier may bid on, and its bids. */
export async function supplierTenders(ctx: Ctx) {
  supplierSide(ctx);
  const s = await tenderSettings();
  const access = await tenderAccess(ctx.company, s);
  const open = access.bid ? await prisma.tender.findMany({ where: openFor(ctx.company), include: { buyer: { select: { legalName: true, tradeName: true } }, _count: { select: { lines: true } }, bids: { where: { supplierCompanyId: ctx.company.id }, select: { id: true, status: true } } }, orderBy: { closesAt: "asc" }, take: 200 }) : [];
  const mine = await prisma.tenderBid.findMany({ where: { supplierCompanyId: ctx.company.id }, include: { tender: { select: { id: true, number: true, title: true, status: true, closesAt: true } }, _count: { select: { lines: true } } }, orderBy: { updatedAt: "desc" }, take: 200 });
  return {
    access,
    open: open.map((t) => ({ id: t.id, number: t.number, title: t.title, buyer: nameOf(t.buyer), lines: t._count.lines, closesAt: t.closesAt, deliveryDate: t.deliveryDate, invited: t.invitedIds.includes(ctx.company.id), myBid: t.bids[0]?.status ?? null })),
    bids: mine.map((b) => ({ id: b.id, status: b.status, lines: b._count.lines, tender: b.tender })),
  };
}

/** The supplier's view of one tender: the lines (never other bids), its own bid, its matching offers, what it receives. */
export async function supplierTender(ctx: Ctx, id: string) {
  supplierSide(ctx);
  const t = await prisma.tender.findFirst({
    where: { id, OR: [openFor(ctx.company), { bids: { some: { supplierCompanyId: ctx.company.id } } }] },
    include: { lines: { orderBy: { n: "asc" } }, buyer: { select: { legalName: true, tradeName: true } }, bids: { where: { supplierCompanyId: ctx.company.id }, include: { lines: { include: { offer: { select: offerSelect } } } } } },
  });
  if (!t) throw new NotFoundError("Tender");
  const offers = await prisma.vendorOffer.findMany({ where: { vendorCompanyId: ctx.company.id, status: "ACTIVE" }, select: { ...offerSelect, prices: { where: { minQty: { lte: 1 }, priceList: { scope: "BASE", isActive: true } }, select: { unitPriceNet: true }, take: 1 } }, take: 3000 });
  const all = offers.map((o) => ({ id: o.id, label: offerLabel(o), productId: o.packaging.variant.productId, base: o.prices[0] ? Number(o.prices[0].unitPriceNet) : null })).sort((a, b) => a.label.localeCompare(b.label));
  const commission = await activeCommission(prisma as never, ctx.company.id);
  const bid = t.bids[0] ?? null;
  const address = await prisma.address.findUnique({ where: { id: t.addressId }, select: { cityName: true, postalCode: true } });
  return {
    tender: { id: t.id, number: t.number, title: t.title, note: t.note, status: t.status, closesAt: t.closesAt, deliveryDate: t.deliveryDate, buyer: nameOf(t.buyer), place: address ? `${address.postalCode ?? ""} ${address.cityName ?? ""}`.trim() : "" },
    open: t.status === "OPEN" && t.closesAt > new Date(),
    lines: t.lines.map((l) => {
      const mineLine = bid?.lines.find((x) => x.lineId === l.id);
      return {
        id: l.id, n: l.n, description: l.description, productId: l.productId, qty: l.qty, unitNote: l.unitNote, targetUnitNet: l.targetUnitNet != null ? Number(l.targetUnitNet) : null,
        suggested: l.productId ? all.filter((o) => o.productId === l.productId).map((o) => o.id) : [],
        mine: mineLine ? { offerId: mineLine.offerId, unitNet: Number(mineLine.unitNet), label: offerLabel(mineLine.offer) } : null,
        won: !!mineLine && l.awardedBidLineId === mineLine.id,
      };
    }),
    bid: bid ? { status: bid.status, note: bid.note } : null,
    offers: all,
    commissionPct: commission && commission.type === "PERCENT" ? Number(commission.rate) : null,
  };
}

export async function submitBid(ctx: Ctx, tenderId: string, i: { note?: string | null; lines: { lineId: string; offerId: string; unitNet: number }[] }) {
  supplierSide(ctx);
  const s = await tenderSettings();
  if (!(await tenderAccess(ctx.company, s)).bid) throw new ForbiddenError("Tenders aren't open for your business.");
  const t = await prisma.tender.findFirst({ where: { id: tenderId, ...openFor(ctx.company) }, include: { lines: true, buyer: { select: { id: true } } } });
  if (!t) throw new ValidationError("This tender isn't open for your bids.");
  const lines = (i.lines ?? []).filter((l) => l.offerId && Number(l.unitNet) > 0);
  if (!lines.length) throw new ValidationError("Bid on at least one line (a product and a price).");
  const offers = new Map((await prisma.vendorOffer.findMany({ where: { id: { in: lines.map((l) => l.offerId) }, vendorCompanyId: ctx.company.id, status: "ACTIVE" }, select: { id: true, packaging: { select: { variant: { select: { productId: true } } } } } })).map((o) => [o.id, o.packaging.variant.productId]));
  const seen = new Set<string>();
  for (const l of lines) {
    const tl = t.lines.find((x) => x.id === l.lineId);
    if (!tl) throw new ValidationError("That line isn't in this tender.");
    if (seen.has(l.lineId)) throw new ValidationError(`Line ${tl.n}: one bid per line.`); seen.add(l.lineId);
    if (!offers.has(l.offerId)) throw new ValidationError(`Line ${tl.n}: choose one of your own active products.`);
    if (tl.productId && offers.get(l.offerId) !== tl.productId) throw new ValidationError(`Line ${tl.n}: the buyer asked for a specific product — bid with your offer of it.`);
    if (!(Number(l.unitNet) > 0 && Number(l.unitNet) < 1e7)) throw new ValidationError(`Line ${tl.n}: check the price.`);
  }
  const existing = await prisma.tenderBid.findUnique({ where: { tenderId_supplierCompanyId: { tenderId, supplierCompanyId: ctx.company.id } } });
  await prisma.$transaction(async (tx) => {
    const bid = existing
      ? await tx.tenderBid.update({ where: { id: existing.id }, data: { status: "SUBMITTED", note: i.note?.trim().slice(0, 1000) || null, createdById: ctx.user.id } })
      : await tx.tenderBid.create({ data: { tenderId, supplierCompanyId: ctx.company.id, note: i.note?.trim().slice(0, 1000) || null, createdById: ctx.user.id } });
    await tx.tenderBidLine.deleteMany({ where: { bidId: bid.id } });
    await tx.tenderBidLine.createMany({ data: lines.map((l) => ({ bidId: bid.id, lineId: l.lineId, offerId: l.offerId, unitNet: Number(l.unitNet).toFixed(4) })) });
  });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: existing ? "tenders.bid_changed" : "tenders.bid", entityType: "Tender", entityId: tenderId, after: { lines: lines.length } });
  if (!existing || existing.status === "WITHDRAWN") {
    const bids = await prisma.tenderBid.count({ where: { tenderId, status: { not: "WITHDRAWN" } } });
    await notify("tender.bid", [{ companyId: t.buyerCompanyId, link: `/buy/orders/tenders/${tenderId}` }], { number: t.number, title: t.title, bids }).catch(() => null);
  }
}

export async function withdrawBid(ctx: Ctx, tenderId: string) {
  supplierSide(ctx);
  const b = await prisma.tenderBid.findUnique({ where: { tenderId_supplierCompanyId: { tenderId, supplierCompanyId: ctx.company.id } }, include: { tender: true } });
  if (!b || b.status !== "SUBMITTED") throw new ValidationError("There's no bid to withdraw.");
  if (b.tender.status !== "OPEN") throw new ValidationError("Bidding is closed — the bid stays.");
  await prisma.tenderBid.update({ where: { id: b.id }, data: { status: "WITHDRAWN" } });
}

// ── FIRINGI ─────────────────────────────────────────────────────────────────

export async function reviewTender(ctx: Ctx, id: string, approve: boolean, note: string | null) {
  staff(ctx, true);
  const t = await prisma.tender.findUnique({ where: { id } });
  if (!t) throw new NotFoundError("Tender");
  if (t.status !== "PENDING") throw new ValidationError("This tender isn't waiting for a decision.");
  if (!approve && !note?.trim()) throw new ValidationError("Say why (the buyer sees it).");
  await prisma.tender.update({ where: { id }, data: { status: approve ? "OPEN" : "REJECTED", reviewNote: note?.trim() || null, reviewedById: ctx.user.id } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: approve ? "tenders.approved" : "tenders.rejected", entityType: "Tender", entityId: id, after: { note } });
  await notify("tender.decided", [{ companyId: t.buyerCompanyId, link: `/buy/orders/tenders/${id}` }], { number: t.number, title: t.title, decision: approve ? "APPROVED" : "REJECTED", reason: note ?? "" }).catch(() => null);
  if (approve) await announce(id);
}

export async function adminTenders(ctx: Ctx) {
  staff(ctx);
  const rows = await prisma.tender.findMany({ include: { buyer: { select: { legalName: true, tradeName: true } }, _count: { select: { lines: true, bids: { where: { status: { not: "WITHDRAWN" } } } } } }, orderBy: { createdAt: "desc" }, take: 500 });
  const by = (s: string) => rows.filter((t) => t.status === s).length;
  const awardedOrders = await prisma.tenderLine.findMany({ where: { orderId: { not: null } }, select: { orderId: true }, distinct: ["orderId"] });
  const orderValue = awardedOrders.length ? await prisma.order.aggregate({ where: { id: { in: awardedOrders.map((o) => o.orderId!) } }, _sum: { netTotal: true } }) : null;
  return {
    overview: { pending: by("PENDING"), open: by("OPEN"), closed: by("CLOSED"), awarded: by("AWARDED"), orders: awardedOrders.length, awardedNet: Number(orderValue?._sum.netTotal ?? 0) },
    tenders: rows.map((t) => ({ id: t.id, number: t.number, title: t.title, status: t.status, buyer: nameOf(t.buyer), lines: t._count.lines, bids: t._count.bids, closesAt: t.closesAt, createdAt: t.createdAt })),
  };
}

export async function companySwitches(ctx: Ctx) {
  staff(ctx);
  const f = await prisma.companyFeature.findMany({ where: { key: FEATURE }, include: { company: { select: { id: true, legalName: true, tradeName: true, type: true } } } });
  return f.map((x) => ({ companyId: x.companyId, name: nameOf(x.company), type: x.company.type, state: x.enabled ? ("ON" as const) : ("OFF" as const) }));
}

export async function findBusiness(ctx: Ctx, q: string) {
  if (ctx.company.type !== "ADMIN") throw new ForbiddenError();
  const t = q.trim();
  if (t.length < 2) return [];
  const rows = await prisma.company.findMany({ where: { type: { in: ["CUSTOMER", "WHOLESALER", "DISTRIBUTOR"] }, OR: [{ legalName: { contains: t, mode: "insensitive" } }, { tradeName: { contains: t, mode: "insensitive" } }, { taxId: { contains: t } }] }, select: { id: true, legalName: true, tradeName: true, type: true }, take: 15 });
  return rows.map((c) => ({ id: c.id, name: nameOf(c), type: c.type }));
}

// ── the job ─────────────────────────────────────────────────────────────────

/** Close bidding at the deadline (the buyer is told); end closed tenders not awarded in time. */
export async function runTendersJob(now = new Date()) {
  const s = await tenderSettings();
  const due = await prisma.tender.findMany({ where: { status: "OPEN", closesAt: { lte: now } }, include: { _count: { select: { bids: { where: { status: { not: "WITHDRAWN" } } } } } } });
  for (const t of due) {
    await prisma.tender.update({ where: { id: t.id }, data: { status: "CLOSED" } });
    await notify("tender.closed", [{ companyId: t.buyerCompanyId, link: `/buy/orders/tenders/${t.id}` }], { number: t.number, title: t.title, bids: t._count.bids }).catch(() => null);
  }
  const ended = await prisma.tender.updateMany({ where: { status: "CLOSED", closesAt: { lte: new Date(now.getTime() - s.awardDays * DAY) } }, data: { status: "CANCELLED" } });
  return { closed: due.length, expired: ended.count };
}

/** The buyer's delivery addresses (tender form). */
export async function buyerAddresses(ctx: Ctx) {
  buyerSide(ctx);
  const rows = await prisma.address.findMany({ where: { companyId: ctx.company.id, kind: "DELIVERY", isActive: true }, select: { id: true, label: true, line1: true, cityName: true }, orderBy: { isDefault: "desc" } });
  return rows.map((a) => ({ id: a.id, label: `${a.label ? `${a.label} — ` : ""}${a.line1}${a.cityName ? `, ${a.cityName}` : ""}` }));
}
