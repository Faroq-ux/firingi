/**
 * Rebates & bonuses (Phase 48). A supplier (distributor / wholesaler) — or FIRINGI on its own money — rewards
 * its customers for what they buy over a period:
 *   VOLUME      money back once the period's purchases pass a target (tiers)
 *   FREE_GOODS  buy X units → Y units of a product free on a later order
 *   GROWTH      a % when the customer buys more than in the same period a year before
 *   MIX         buy N different products of a set → a fixed amount and / or a %
 *
 * Suppliers create deals and FIRINGI approves them (or, with approval AUTO, deals within the limits start by
 * themselves). Purchases count FIRINGI's invoices for the supplier's goods (net of VAT) minus credit notes
 * (returns, claims) in the period, per customer or per shop. A few days after a period ends the daily job
 * settles it: FIRINGI issues the customer credit notes on the period's invoices (FIRINGI invoices every
 * buyer); a supplier-funded bonus also gets a supplier credit statement, so it comes off the supplier's
 * payout. Free goods become an allowance the customer takes on a later order (100 % off those units).
 * Every switch is FIRINGI's (Admin › Pricing › Rebates & Bonuses), one supplier can be switched on / off.
 */
import "server-only";
import Decimal from "decimal.js";
import { Prisma, type TradeBonus, type TradeBonusAudience, type TradeBonusKind, type TradeBonusPeriod } from "@prisma/client";
import { prisma, type Tx } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";
import { notify } from "@/server/notify/dispatch";
import {
  cleanRebateSettings, cleanRules, endedPeriods, evaluate, limitProblem, mergeRebateSettings, periodOf, previousYear, spread,
  type RebatePeriod, type RebateRules, type RebateSettings, type Result, type Stats,
} from "@/lib/rebates";

const KEY = "rebates.settings";
const FEATURE = "REBATES";
const DAY = 86_400_000;
export const FREE_GOODS_PROMOTION_ID = "trade-bonus-goods";
const isVendor = (t: string) => t === "DISTRIBUTOR" || t === "WHOLESALER";
const isBuyerType = (t: string) => t === "CUSTOMER" || t === "WHOLESALER";
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const D = (v: Decimal.Value) => new Decimal(v);
const name = (c: { tradeName: string | null; legalName: string }) => c.tradeName ?? c.legalName;
const pickName = (n: unknown) => (typeof n === "string" ? n : ((n as Record<string, string> | null)?.en ?? Object.values((n as Record<string, string>) ?? {})[0] ?? ""));

// ── settings & switches ─────────────────────────────────────────────────────

export async function rebateSettings(): Promise<RebateSettings> {
  const row = await prisma.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: KEY } });
  return mergeRebateSettings(row?.value as Partial<RebateSettings> | null);
}

function staff(ctx: Ctx, manage = false) {
  if (ctx.company.type !== "ADMIN") throw new ForbiddenError();
  const perms = manage ? ["admin.pricing.manage", "admin.marketing.manage", "admin.settings.manage"] as const : ["admin.pricing.view", "admin.pricing.manage", "admin.marketing.manage", "admin.settings.manage", "admin.vendors.view", "admin.finance.view"] as const;
  if (!can(ctx, [...perms])) throw new ForbiddenError();
}

export async function saveRebateSettings(ctx: Ctx, input: RebateSettings) {
  staff(ctx, true);
  let v: RebateSettings;
  try { v = cleanRebateSettings(input); } catch (e) { throw new ValidationError((e as Error).message); }
  const before = await rebateSettings();
  const row = await prisma.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: KEY } });
  if (row) await prisma.setting.update({ where: { id: row.id }, data: { value: v } });
  else await prisma.setting.create({ data: { scope: "GLOBAL", scopeId: "", key: KEY, value: v } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "rebates.settings_saved", entityType: "Setting", entityId: KEY, before, after: v });
  return v;
}

/** One supplier's switch: DEFAULT follows "which suppliers may create deals"; ON / OFF override it. */
export async function supplierSwitch(companyId: string): Promise<"DEFAULT" | "ON" | "OFF"> {
  const f = await prisma.companyFeature.findUnique({ where: { companyId_key: { companyId, key: FEATURE } } });
  return !f ? "DEFAULT" : f.enabled ? "ON" : "OFF";
}

export async function setSupplierSwitch(ctx: Ctx, companyId: string, state: "DEFAULT" | "ON" | "OFF") {
  staff(ctx, true);
  const co = await prisma.company.findUnique({ where: { id: companyId }, select: { type: true } });
  if (!co || !isVendor(co.type)) throw new NotFoundError("Supplier");
  if (state === "DEFAULT") await prisma.companyFeature.deleteMany({ where: { companyId, key: FEATURE } });
  else await prisma.companyFeature.upsert({ where: { companyId_key: { companyId, key: FEATURE } }, create: { companyId, key: FEATURE, enabled: state === "ON", updatedById: ctx.user.id }, update: { enabled: state === "ON", updatedById: ctx.user.id } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "rebates.supplier_switch", entityType: "Company", entityId: companyId, after: { state } });
}

/** May this supplier run rebate deals now? (with the reason when not) */
export async function supplierAccess(companyId: string, type: string, s?: RebateSettings): Promise<{ ok: boolean; why: "OFF" | "SUPPLIER_OFF" | "TYPE_OFF" | null }> {
  const set = s ?? (await rebateSettings());
  if (!set.enabled) return { ok: false, why: "OFF" };
  const sw = await supplierSwitch(companyId);
  if (sw === "OFF") return { ok: false, why: "SUPPLIER_OFF" };
  if (sw === "ON") return { ok: true, why: null };
  return (set.creators as Record<string, boolean>)[type] ? { ok: true, why: null } : { ok: false, why: "TYPE_OFF" };
}

// ── creating & editing deals ────────────────────────────────────────────────

export type BonusInput = {
  id?: string | null;
  /** FIRINGI only: whose goods (FIRINGI-funded deal) */
  sellerCompanyId?: string | null;
  name: string; description?: string | null;
  kind: TradeBonusKind; period: TradeBonusPeriod; rules: unknown;
  validFrom: string; validTo?: string | null;
  audience: TradeBonusAudience; segmentId?: string | null; groupId?: string | null; companyIds?: string[];
  /** Phase 49: a buying group (pooled targets) */
  buyingGroupId?: string | null;
  countries?: string[]; perShop?: boolean;
  offerIds?: string[]; categoryIds?: string[]; brandIds?: string[];
  rewardOfferId?: string | null; freeGoodsDays?: number | null;
};

function assertSupplier(ctx: Ctx, manage = true) {
  if (!isVendor(ctx.company.type)) throw new ForbiddenError();
  if (!can(ctx, manage ? ["vendor.promotions.manage", "vendor.pricing.manage"] : ["vendor.promotions.manage", "vendor.pricing.manage", "vendor.reports.view"])) throw new ForbiddenError();
}

const dateOnly = (s: string, label: string) => {
  const d = new Date(`${s.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new ValidationError(`${label}: give a date.`);
  return d;
};

async function cleanInput(sellerId: string, input: BonusInput, s: RebateSettings) {
  const nm = input.name?.trim();
  if (!nm || nm.length > 120) throw new ValidationError("Give the deal a name (up to 120 characters).");
  if (!s.kinds[input.kind]) throw new ValidationError("FIRINGI has switched this kind of deal off.");
  if (!s.periods[input.period]) throw new ValidationError("FIRINGI has switched this period off.");
  if (!s.audiences[input.audience]) throw new ValidationError("FIRINGI has switched this choice of customers off.");
  let rules: RebateRules;
  try { rules = cleanRules({ ...(input.rules as object), kind: input.kind }); } catch (e) { throw new ValidationError((e as Error).message); }
  const lim = limitProblem(rules, s);
  if (lim) throw new ValidationError(lim);
  const validFrom = dateOnly(input.validFrom, "Starts");
  const validTo = input.validTo ? new Date(dateOnly(input.validTo, "Ends").getTime() + DAY) : null; // the end day counts (stored exclusive)
  // a deal may start at the beginning of the running period, not earlier
  if (validFrom < periodOf(new Date(), input.period).start) throw new ValidationError("A deal can't start before the current period.");
  if (validTo && validTo <= validFrom) throw new ValidationError("The deal must end after it starts.");
  const countries = [...new Set((input.countries ?? []).map((c) => c.trim().toUpperCase()).filter(Boolean))];
  if (countries.length && !s.audiences.COUNTRY) throw new ValidationError("FIRINGI has switched off choosing countries.");
  if (input.perShop && !s.audiences.PER_SHOP) throw new ValidationError("FIRINGI has switched off counting each shop on its own.");
  const companyIds = [...new Set(input.companyIds ?? [])];
  if (input.audience === "COMPANIES" && !companyIds.length) throw new ValidationError("Choose at least one customer.");
  if (input.audience === "COMPANIES" && (await prisma.company.count({ where: { id: { in: companyIds }, type: { in: ["CUSTOMER", "WHOLESALER"] } } })) !== companyIds.length) throw new ValidationError("Some of those customers can't be chosen.");
  if (input.audience === "GROUP") {
    const g = input.groupId ? await prisma.customerGroup.findUnique({ where: { id: input.groupId } }) : null;
    if (!g || (g.ownerCompanyId && g.ownerCompanyId !== sellerId)) throw new ValidationError("Choose one of your customer groups.");
  }
  if (input.audience === "SEGMENT" && !(input.segmentId && (await prisma.crmSegment.count({ where: { id: input.segmentId } })))) throw new ValidationError("Choose a segment.");
  if (input.audience === "BUYING_GROUP") {
    const { groupSettings } = await import("@/server/buying-groups/service");
    const gs = await groupSettings();
    if (!gs.enabled || !gs.features.pooledRebates) throw new ValidationError("FIRINGI has switched off deals for buying groups.");
    if (!(input.buyingGroupId && (await prisma.buyingGroup.count({ where: { id: input.buyingGroupId, status: "APPROVED" } })))) throw new ValidationError("Choose a buying group.");
  }
  const offerIds = [...new Set(input.offerIds ?? [])];
  if (offerIds.length && (await prisma.vendorOffer.count({ where: { id: { in: offerIds }, vendorCompanyId: sellerId } })) !== offerIds.length) throw new ValidationError("Only your own products can be in a deal.");
  let rewardOfferId: string | null = null;
  if (input.kind === "FREE_GOODS") {
    if (!input.rewardOfferId) throw new ValidationError("Choose the product given free.");
    const o = await prisma.vendorOffer.findFirst({ where: { id: input.rewardOfferId, vendorCompanyId: sellerId } });
    if (!o) throw new ValidationError("The free product must be one of your own products.");
    rewardOfferId = o.id;
  }
  const days = input.freeGoodsDays == null ? s.freeGoodsDays : Math.round(Number(input.freeGoodsDays));
  if (!(days >= 7 && days <= 365)) throw new ValidationError("Days to take the free goods: 7 to 365.");
  return {
    name: nm, description: input.description?.trim() || null, kind: input.kind, period: input.period, rules: rules as unknown as Prisma.InputJsonValue,
    validFrom, validTo, audience: input.audience,
    segmentId: input.audience === "SEGMENT" ? input.segmentId! : null, groupId: input.audience === "GROUP" ? input.groupId! : null, companyIds: input.audience === "COMPANIES" ? companyIds : [],
    buyingGroupId: input.audience === "BUYING_GROUP" ? input.buyingGroupId! : null,
    // a buying group's purchases count together (never per shop)
    countries, perShop: input.audience === "BUYING_GROUP" ? false : !!input.perShop, offerIds, categoryIds: [...new Set(input.categoryIds ?? [])], brandIds: [...new Set(input.brandIds ?? [])],
    rewardOfferId, freeGoodsDays: days,
  };
}

/** Save a draft (new, or a draft / rejected one). FIRINGI saves FIRINGI-funded deals on a supplier's goods. */
export async function saveBonus(ctx: Ctx, input: BonusInput) {
  const s = await rebateSettings();
  const admin = ctx.company.type === "ADMIN";
  if (admin) { staff(ctx, true); if (!s.firingiFunded) throw new ValidationError("FIRINGI-funded deals are switched off."); }
  else {
    assertSupplier(ctx);
    const a = await supplierAccess(ctx.company.id, ctx.company.type, s);
    if (!a.ok) throw new ForbiddenError("Rebate deals aren't open for your company. Please contact FIRINGI.");
  }
  const sellerId = admin ? input.sellerCompanyId ?? "" : ctx.company.id;
  if (admin) {
    const co = await prisma.company.findUnique({ where: { id: sellerId }, select: { type: true } });
    if (!co || !isVendor(co.type)) throw new ValidationError("Choose the supplier whose goods count.");
  }
  const data = await cleanInput(sellerId, input, s);
  if (input.id) {
    const cur = await prisma.tradeBonus.findUnique({ where: { id: input.id } });
    if (!cur || (!admin && cur.sellerCompanyId !== ctx.company.id) || (admin && cur.fundedBy !== "FIRINGI")) throw new NotFoundError("Deal");
    if (!["DRAFT", "REJECTED"].includes(cur.status)) throw new ValidationError("Only a draft (or a refused deal) can be changed.");
    const u = await prisma.tradeBonus.update({ where: { id: cur.id }, data: { ...data, status: "DRAFT" } });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "rebates.updated", entityType: "TradeBonus", entityId: u.id, after: { name: u.name } });
    return u;
  }
  const c = await prisma.tradeBonus.create({ data: { ...data, sellerCompanyId: sellerId, fundedBy: admin ? "FIRINGI" : "SUPPLIER", createdById: ctx.user.id } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "rebates.created", entityType: "TradeBonus", entityId: c.id, after: { name: c.name, kind: c.kind } });
  return c;
}

/** Send a draft to FIRINGI (or start it: FIRINGI's own deals, and AUTO approval within the limits). */
export async function submitBonus(ctx: Ctx, id: string) {
  const admin = ctx.company.type === "ADMIN";
  if (admin) staff(ctx, true); else assertSupplier(ctx);
  const b = await prisma.tradeBonus.findUnique({ where: { id }, include: { seller: { select: { legalName: true, tradeName: true } } } });
  if (!b || (!admin && b.sellerCompanyId !== ctx.company.id) || (admin && b.fundedBy !== "FIRINGI")) throw new NotFoundError("Deal");
  if (!["DRAFT", "REJECTED"].includes(b.status)) throw new ValidationError("This deal has already been sent.");
  const s = await rebateSettings();
  const lim = limitProblem(b.rules as RebateRules, s);
  if (lim) throw new ValidationError(lim);
  const auto = admin || s.approval === "AUTO";
  const u = await prisma.tradeBonus.update({ where: { id }, data: auto ? { status: "APPROVED", reviewedAt: new Date(), reviewedById: admin ? ctx.user.id : null, reviewNote: admin ? null : "Started by itself (within FIRINGI's limits)" } : { status: "PENDING", reviewNote: null } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: auto ? "rebates.started" : "rebates.submitted", entityType: "TradeBonus", entityId: id });
  if (auto) await announce(u).catch(() => null);
  else {
    const adminCo = await prisma.company.findFirst({ where: { type: "ADMIN" }, select: { id: true } });
    if (adminCo) await notify("rebate.review", [{ companyId: adminCo.id, link: "/admin/pricing/rebates" }], { company: name(b.seller), name: b.name }).catch(() => null);
  }
  return u;
}

/** FIRINGI's decision on a supplier's deal. */
export async function reviewBonus(ctx: Ctx, id: string, approve: boolean, note: string | null) {
  staff(ctx, true);
  const b = await prisma.tradeBonus.findUnique({ where: { id } });
  if (!b) throw new NotFoundError("Deal");
  if (b.status !== "PENDING") throw new ValidationError("This deal isn't waiting for a decision.");
  if (!approve && !note?.trim()) throw new ValidationError("Say why (the supplier sees it).");
  if (approve) { const lim = limitProblem(b.rules as RebateRules, await rebateSettings()); if (lim) throw new ValidationError(lim); }
  const u = await prisma.tradeBonus.update({ where: { id }, data: { status: approve ? "APPROVED" : "REJECTED", reviewNote: note?.trim() || null, reviewedById: ctx.user.id, reviewedAt: new Date() } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: approve ? "rebates.approved" : "rebates.rejected", entityType: "TradeBonus", entityId: id, after: { note } });
  await notify(approve ? "rebate.approved" : "rebate.rejected", [{ companyId: b.sellerCompanyId, link: `/vendor/products/rebates/${b.id}` }], { name: b.name, reason: note ?? "" }).catch(() => null);
  if (approve) await announce(u).catch(() => null);
  return u;
}

/**
 * Stop a deal. A draft / waiting deal is cancelled; a running deal ends with its current period — customers
 * keep what they are building this period (it is settled as usual). FIRINGI can stop any deal.
 */
export async function endBonus(ctx: Ctx, id: string) {
  const admin = ctx.company.type === "ADMIN";
  if (admin) staff(ctx, true); else assertSupplier(ctx);
  const b = await prisma.tradeBonus.findUnique({ where: { id } });
  if (!b || (!admin && b.sellerCompanyId !== ctx.company.id)) throw new NotFoundError("Deal");
  let u: TradeBonus;
  if (["DRAFT", "PENDING", "REJECTED"].includes(b.status)) u = await prisma.tradeBonus.update({ where: { id }, data: { status: "CANCELLED" } });
  else if (b.status === "APPROVED") {
    const now = new Date();
    const end = b.validFrom > now ? b.validFrom : periodOf(now, b.period as RebatePeriod).end;
    u = await prisma.tradeBonus.update({ where: { id }, data: b.validFrom > now ? { status: "CANCELLED" } : { validTo: b.validTo && b.validTo < end ? b.validTo : end } });
  } else throw new ValidationError("This deal has already finished.");
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "rebates.ended", entityType: "TradeBonus", entityId: id, after: { status: u.status, validTo: u.validTo } });
  return u;
}

// ── who a deal is for ───────────────────────────────────────────────────────

/** null = every buyer (subject to buyer types and countries); else the set of company ids. */
async function audienceIds(b: TradeBonus): Promise<Set<string> | null> {
  if (b.audience === "ALL") return null;
  if (b.audience === "COMPANIES") return new Set(b.companyIds);
  if (b.audience === "BUYING_GROUP") return new Set((await prisma.buyingGroupMember.findMany({ where: { groupId: b.buyingGroupId ?? "", status: "ACTIVE" }, select: { companyId: true } })).map((m) => m.companyId));
  if (b.audience === "GROUP") return new Set((await prisma.customerGroupMember.findMany({ where: { groupId: b.groupId ?? "" }, select: { companyId: true } })).map((m) => m.companyId));
  const { audienceCompanies } = await import("@/server/marketing/campaigns");
  return new Set((await audienceCompanies({ segmentId: b.segmentId ?? "" } as Parameters<typeof audienceCompanies>[0]).catch(() => [])).map((c) => c.id));
}

/** Filter companies to the ones a deal is for (buyer types allowed by FIRINGI, audience, countries). */
async function forBonus(b: TradeBonus, companyIds: string[], s: RebateSettings) {
  if (!companyIds.length) return new Set<string>();
  const aud = await audienceIds(b);
  const rows = await prisma.company.findMany({ where: { id: { in: companyIds } }, select: { id: true, type: true, country: { select: { code: true } } } });
  return new Set(rows.filter((c) => isBuyerType(c.type) && (s.buyers as Record<string, boolean>)[c.type] && (!aud || aud.has(c.id)) && (!b.countries.length || b.countries.includes(c.country.code))).map((c) => c.id));
}

// ── purchases ───────────────────────────────────────────────────────────────

async function expandCategories(ids: string[]) {
  if (!ids.length) return [];
  const cats = await prisma.category.findMany({ select: { id: true, parentId: true } });
  const out = new Set(ids);
  for (let grew = true; grew;) { grew = false; for (const c of cats) if (c.parentId && out.has(c.parentId) && !out.has(c.id)) { out.add(c.id); grew = true; } }
  return [...out];
}

type Row = { companyId: string; branchId: string; offerId: string; amount: number; units: number };

/**
 * What customers bought of the deal's goods in [start, end): FIRINGI's invoices minus credit notes, net of
 * VAT, excluding excise and money-only credit notes (loyalty, bonuses). Per customer, shop and product.
 */
export async function purchaseRows(b: Pick<TradeBonus, "sellerCompanyId" | "offerIds" | "categoryIds" | "brandIds">, start: Date, end: Date, companyIds?: string[]): Promise<Row[]> {
  const { EXCISE_PREFIX } = await import("@/server/invoicing/service");
  const cats = await expandCategories(b.categoryIds);
  const any = b.offerIds.length || cats.length || b.brandIds.length;
  const scope = any ? Prisma.sql`AND (${Prisma.join([
    b.offerIds.length ? Prisma.sql`ol."offerId" = ANY(${b.offerIds})` : Prisma.sql`FALSE`,
    cats.length ? Prisma.sql`p."categoryId" = ANY(${cats})` : Prisma.sql`FALSE`,
    b.brandIds.length ? Prisma.sql`p."brandId" = ANY(${b.brandIds})` : Prisma.sql`FALSE`,
  ], " OR ")})` : Prisma.empty;
  const who = companyIds ? Prisma.sql`AND i."recipientCompanyId" = ANY(${companyIds})` : Prisma.empty;
  const rows = await prisma.$queryRaw<{ companyId: string; branchId: string | null; offerId: string; amount: Prisma.Decimal; units: Prisma.Decimal }[]>`
    SELECT i."recipientCompanyId" AS "companyId", o."branchId" AS "branchId", ol."offerId" AS "offerId",
      SUM(CASE WHEN i."docType" = 'CREDIT_NOTE' THEN -il."lineNet" ELSE il."lineNet" END) AS amount,
      SUM(CASE WHEN i."docType" = 'CREDIT_NOTE' THEN -il.qty ELSE il.qty END) AS units
    FROM "InvoiceLine" il
    JOIN "Invoice" i ON i.id = il."invoiceId"
    JOIN "OrderLine" ol ON ol.id = il."orderLineId"
    JOIN "Order" o ON o.id = ol."orderId"
    JOIN "VendorOffer" vo ON vo.id = ol."offerId"
    JOIN "PackagingUnit" pu ON pu.id = vo."packagingUnitId"
    JOIN "ProductVariant" pv ON pv.id = pu."variantId"
    JOIN "Product" p ON p.id = pv."productId"
    WHERE o."sellerCompanyId" = ${b.sellerCompanyId} AND i.status <> 'DRAFT'
      AND COALESCE(i."issuedAt", i."createdAt") >= ${start} AND COALESCE(i."issuedAt", i."createdAt") < ${end}
      AND il.description NOT LIKE ${EXCISE_PREFIX + "%"}
      ${who} ${scope}
    GROUP BY 1, 2, 3`;
  return rows.map((r) => ({ companyId: r.companyId, branchId: r.branchId ?? "", offerId: r.offerId, amount: Number(r.amount), units: Number(r.units) }));
}

/** Stats per customer (or per customer + shop) from rows. */
function statsOf(rows: Row[], perShop: boolean) {
  const m = new Map<string, { companyId: string; branchId: string; amount: number; units: number; per: Record<string, number> }>();
  for (const r of rows) {
    const k = perShop ? `${r.companyId}|${r.branchId}` : r.companyId;
    const x = m.get(k) ?? { companyId: r.companyId, branchId: perShop ? r.branchId : "", amount: 0, units: 0, per: {} };
    x.amount += r.amount; x.units += r.units; x.per[r.offerId] = (x.per[r.offerId] ?? 0) + r.units;
    m.set(k, x);
  }
  return m;
}

/** Results of a deal for one period: every customer (or shop) that bought, with what it earns. */
export async function periodResults(b: TradeBonus, period: { start: Date; end: Date }, s: RebateSettings, companyIds?: string[]) {
  if (b.audience === "BUYING_GROUP") return pooledResults(b, period, s, companyIds);
  const rows = await purchaseRows(b, period.start, period.end, companyIds);
  const prev = b.kind === "GROWTH" ? statsOf(await purchaseRows(b, previousYear(period).start, previousYear(period).end, companyIds), b.perShop) : null;
  const cur = statsOf(rows, b.perShop);
  const ok = await forBonus(b, [...new Set([...cur.values()].map((x) => x.companyId))], s);
  const rules = b.rules as RebateRules;
  const out: { companyId: string; branchId: string; stats: Stats; result: Result }[] = [];
  for (const [k, x] of cur) {
    if (!ok.has(x.companyId)) continue;
    const per = Object.fromEntries(Object.entries(x.per).filter(([, u]) => u > 0));
    const stats: Stats = { amount: r2(x.amount), units: Math.round(x.units * 1000) / 1000, previousAmount: r2(prev?.get(k)?.amount ?? 0), distinct: Object.keys(per).length, perProductUnits: per };
    out.push({ companyId: x.companyId, branchId: x.branchId, stats, result: evaluate(rules, stats) });
  }
  return out;
}

/**
 * Phase 49 — a buying group's deal: the members' purchases count together (members during the period); the group's
 * bonus is shared by what each member bought (amount; units for free goods). `companyIds` only narrows what is returned.
 */
async function pooledResults(b: TradeBonus, period: { start: Date; end: Date }, s: RebateSettings, only?: string[]) {
  const { membersDuring } = await import("@/server/buying-groups/service");
  const { shareMoney, shareUnits } = await import("@/lib/buying-groups");
  const all = await membersDuring(b.buyingGroupId ?? "", period.start, period.end);
  const members = [...(await forBonus({ ...b, audience: "ALL" } as TradeBonus, all, s))];
  if (!members.length) return [];
  const cur = statsOf(await purchaseRows(b, period.start, period.end, members), false);
  const prev = b.kind === "GROWTH" ? statsOf(await purchaseRows(b, previousYear(period).start, previousYear(period).end, members), false) : null;
  const per: Record<string, number> = {};
  let amount = 0, units = 0, previous = 0;
  for (const x of cur.values()) { amount += x.amount; units += x.units; for (const [o, u] of Object.entries(x.per)) per[o] = (per[o] ?? 0) + u; }
  for (const x of prev?.values() ?? []) previous += x.amount;
  const perPos = Object.fromEntries(Object.entries(per).filter(([, u]) => u > 0));
  const group: Stats = { amount: r2(amount), units: Math.round(units * 1000) / 1000, previousAmount: r2(previous), distinct: Object.keys(perPos).length, perProductUnits: perPos };
  const result = evaluate(b.rules as RebateRules, group);
  const buyers = members.filter((id) => cur.has(id));
  const weights = buyers.map((id) => (b.kind === "FREE_GOODS" ? cur.get(id)!.units : cur.get(id)!.amount));
  const money = shareMoney(result.value, weights), free = shareUnits(result.freeUnits, weights);
  return buyers.map((id, i) => {
    const x = cur.get(id)!;
    const own = Object.fromEntries(Object.entries(x.per).filter(([, u]) => u > 0));
    const stats: Stats = { amount: r2(x.amount), units: Math.round(x.units * 1000) / 1000, previousAmount: r2(prev?.get(id)?.amount ?? 0), distinct: Object.keys(own).length, perProductUnits: own };
    return { companyId: id, branchId: "", stats, result: { ...result, value: money[i], freeUnits: free[i] }, group };
  }).filter((r) => !only || only.includes(r.companyId));
}

// ── settling a period ───────────────────────────────────────────────────────

/** Invoices of the period carrying the deal's goods for one customer (/ shop), with what is still creditable. */
async function creditableInvoices(tx: Tx, b: TradeBonus, companyId: string, branchId: string, period: { start: Date; end: Date }, eligibleOfferIds: Set<string> | null) {
  const { REBATE_PREFIX, TRADE_BONUS_PREFIX, EXCISE_PREFIX } = await import("@/server/invoicing/service");
  const invs = await tx.invoice.findMany({
    where: {
      recipientCompanyId: companyId, docType: { in: ["INVOICE", "INVOICE_RECEIPT"] }, status: { in: ["ISSUED", "PARTIALLY_CREDITED"] },
      OR: [{ issuedAt: { gte: period.start, lt: period.end } }, { issuedAt: null, createdAt: { gte: period.start, lt: period.end } }],
      order: { sellerCompanyId: b.sellerCompanyId, ...(b.perShop ? { branchId: branchId || null } : {}) },
    },
    include: { lines: { include: { orderLine: { select: { offerId: true } } } }, creditNotes: { include: { lines: true } } },
    orderBy: { issuedAt: "asc" },
  });
  return invs.map((inv) => {
    const goods = inv.lines.filter((l) => l.orderLine && !l.description.startsWith(EXCISE_PREFIX) && (!eligibleOfferIds || eligibleOfferIds.has(l.orderLine.offerId)));
    const goodsIds = new Set(goods.map((l) => l.orderLineId));
    let net = goods.reduce((a, l) => a + Number(l.lineNet), 0);
    let gross = goods.reduce((a, l) => a + Number(l.lineNet) + Number(l.lineVat), 0);
    for (const cn of inv.creditNotes) for (const l of cn.lines) {
      if (l.orderLineId && goodsIds.has(l.orderLineId) && !l.description.startsWith(EXCISE_PREFIX)) { net -= Number(l.lineNet); gross -= Number(l.lineNet) + Number(l.lineVat); }
      else if (l.description.startsWith(REBATE_PREFIX) || l.description.startsWith(TRADE_BONUS_PREFIX)) gross -= Number(l.lineNet) + Number(l.lineVat); // money already given back on it
    }
    return { id: inv.id, orderId: inv.orderId, lineIds: goods.map((l) => l.id), net: Math.max(0, r2(net)), gross: Math.max(0, r2(gross)) };
  }).filter((x) => x.net > 0 && x.gross > 0);
}

/** A supplier-funded bonus: the supplier gives the money back to FIRINGI (credit statement → off its payout). */
async function supplierCreditStatement(tx: Tx, cnId: string, invoiceId: string, b: TradeBonus, actorUserId: string | null) {
  const cn = await tx.invoice.findUniqueOrThrow({ where: { id: cnId }, include: { lines: true } });
  const inv = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { order: { include: { seller: { select: { countryId: true } } } } } });
  if (!inv.order) return null;
  const domestic = inv.taxRegime === "DOMESTIC" && inv.order.seller.countryId === inv.order.countryId;
  const stLines = cn.lines.map((l) => {
    const rate = domestic ? D(l.taxRate.toString()) : D(0);
    const net = D(l.lineNet.toString());
    return { orderLineId: null, sku: "BONUS", description: `${l.description} — ${b.name}`, qty: 1, unitCostNet: net.toFixed(4), lineNet: net.toFixed(2), taxRate: rate.toFixed(3), vat: net.mul(rate).div(100).toDecimalPlaces(2).toFixed(2) };
  });
  const n = stLines.reduce((a, l) => a.plus(l.lineNet), D(0));
  const v = stLines.reduce((a, l) => a.plus(l.vat), D(0));
  const year = new Date().getFullYear();
  const seq = await tx.$queryRaw<{ n: number }[]>`INSERT INTO "Sequence" (name, year, "nextValue") VALUES ('statement', ${year}, 2)
    ON CONFLICT (name, year) DO UPDATE SET "nextValue" = "Sequence"."nextValue" + 1 RETURNING "nextValue" - 1 AS n`;
  const orig = await tx.vendorBillingStatement.findFirst({ where: { orderId: inv.orderId!, isCreditStatement: false } });
  const st = await tx.vendorBillingStatement.create({
    data: {
      number: `VBS-${year}-${String(seq[0].n).padStart(6, "0")}`, vendorCompanyId: b.sellerCompanyId, orderId: inv.orderId!, salesInvoiceId: cn.id, isCreditStatement: true,
      taxRegime: orig?.taxRegime ?? "DOMESTIC", expectedNet: n.toFixed(2), expectedVat: v.toFixed(2), expectedGross: n.plus(v).toFixed(2), commissionTotal: 0, lines: stLines,
      ...(await (await import("@/server/currency/documents")).statementLocal(tx, inv.orderId!, { net: n, vat: v, gross: n.plus(v) })),
    },
  });
  await (await import("@/server/einvoice/service")).selfBillStatement(tx, st.id, actorUserId);
  return st.id;
}

const PERIOD_DONE = ""; // a settlement row with companyId "" marks a whole period as processed

/** Settle one customer's (/ shop's) period: credit notes or free goods. Idempotent (one row per key). */
async function settleOne(b: TradeBonus, period: { key: string; start: Date; end: Date }, r: { companyId: string; branchId: string; stats: Stats; result: Result }, s: RebateSettings) {
  const where = { bonusId_companyId_branchId_periodKey: { bonusId: b.id, companyId: r.companyId, branchId: r.branchId, periodKey: period.key } };
  const existing = await prisma.tradeBonusSettlement.findUnique({ where });
  if (existing && existing.status !== "FAILED") return existing;
  if (existing) await prisma.tradeBonusSettlement.delete({ where });
  const base = { bonusId: b.id, companyId: r.companyId, branchId: r.branchId, periodKey: period.key, periodStart: period.start, periodEnd: period.end, amount: r.stats.amount.toFixed(2), units: r.stats.units.toFixed(3), pct: r.result.pct.toFixed(3) };
  const actor = b.reviewedById ?? b.createdById;
  try {
    return await prisma.$transaction(async (tx) => {
      if (b.kind === "FREE_GOODS") {
        const free = r.result.freeUnits;
        if (free > 0 && b.rewardOfferId)
          await tx.tradeBonusFreeGoods.create({ data: { bonusId: b.id, companyId: r.companyId, branchId: r.branchId, offerId: b.rewardOfferId, qty: free, periodKey: period.key, expiresAt: new Date(Date.now() + b.freeGoodsDays * DAY) } });
        return tx.tradeBonusSettlement.create({ data: { ...base, value: "0", freeUnits: free, status: free > 0 ? "SETTLED" : "NOTHING" } });
      }
      const want = r.result.value;
      if (want <= 0) return tx.tradeBonusSettlement.create({ data: { ...base, value: "0", status: "NOTHING" } });
      const offers = b.offerIds.length || b.categoryIds.length || b.brandIds.length ? new Set((await purchaseRows(b, period.start, period.end, [r.companyId])).map((x) => x.offerId)) : null;
      const invs = await creditableInvoices(tx, b, r.companyId, r.branchId, period, offers);
      const room = invs.reduce((a, x) => a + x.net, 0);
      const value = r2(Math.min(want, room)); // never more than what can still be credited
      if (value <= 0) return tx.tradeBonusSettlement.create({ data: { ...base, value: "0", status: "NOTHING", error: "No invoice left to credit" } });
      const { rebateCreditNote, TRADE_BONUS_PREFIX } = await import("@/server/invoicing/service");
      const shares = spread(value, invs.map((x) => x.net));
      const cnIds: string[] = [];
      for (let i = 0; i < invs.length; i++) {
        if (shares[i] <= 0) continue;
        const inv = invs[i];
        const gross = Math.min(inv.gross, r2(shares[i] * (inv.gross / inv.net)));
        const cn = await rebateCreditNote(tx, inv.id, { gross: D(gross), description: TRADE_BONUS_PREFIX, reason: `${b.name} — ${period.key}`, actorUserId: actor, lineIds: inv.lineIds });
        cnIds.push(cn.id);
        if (b.fundedBy === "SUPPLIER") await supplierCreditStatement(tx, cn.id, inv.id, b, actor);
      }
      return tx.tradeBonusSettlement.create({ data: { ...base, value: value.toFixed(2), creditNoteIds: cnIds, status: "SETTLED", ...(value < want ? { error: `Capped at what could still be credited (${want.toFixed(2)} earned)` } : {}) } });
    }, { timeout: 60_000 });
  } catch (e) {
    return prisma.tradeBonusSettlement.create({ data: { ...base, value: "0", status: "FAILED", error: (e as Error).message.slice(0, 500) } });
  } finally { void s; }
}

/** Settle every ended period of a deal (after the settle delay). Returns what happened. */
export async function settleBonus(bonusId: string, now = new Date()) {
  const s = await rebateSettings();
  const b = await prisma.tradeBonus.findUniqueOrThrow({ where: { id: bonusId }, include: { seller: { select: { legalName: true, tradeName: true } } } });
  const cutoff = new Date(now.getTime() - s.settleDelayDays * DAY);
  const periods = endedPeriods(b.period as RebatePeriod, b.validFrom, b.validTo, cutoff);
  const out = { periods: 0, settled: 0, value: 0, freeUnits: 0, failed: 0 };
  for (const p of periods) {
    if (await prisma.tradeBonusSettlement.findUnique({ where: { bonusId_companyId_branchId_periodKey: { bonusId: b.id, companyId: PERIOD_DONE, branchId: "", periodKey: p.key } } })) continue;
    // a deal that starts / ends inside a period only counts its own days
    const span = { key: p.key, start: b.validFrom > p.start ? b.validFrom : p.start, end: b.validTo && b.validTo < p.end ? b.validTo : p.end };
    const results = await periodResults(b, span, s);
    let failed = 0, value = 0, free = 0, earners = 0;
    for (const r of results) {
      const row = await settleOne(b, span, r, s);
      if (row.status === "FAILED") failed++;
      if (row.status === "SETTLED") {
        earners++; value += Number(row.value); free += row.freeUnits;
        await tellBuyer(b, row).catch(() => null);
      }
    }
    out.periods++; out.failed += failed; out.settled += earners; out.value += value; out.freeUnits += free;
    if (!failed) {
      await prisma.tradeBonusSettlement.create({ data: { bonusId: b.id, companyId: PERIOD_DONE, branchId: "", periodKey: p.key, periodStart: span.start, periodEnd: span.end, amount: "0", units: "0", value: value.toFixed(2), freeUnits: free, status: "DONE" } });
      if (earners) await notify("rebate.settled", [{ companyId: b.sellerCompanyId, link: `/vendor/products/rebates/${b.id}` }], { name: b.name, period: p.key, total: r2(value), customers: earners }).catch(() => null);
    }
  }
  // finished: every period settled and the deal is over
  if (b.validTo && b.validTo <= cutoff && b.status === "APPROVED") {
    const all = endedPeriods(b.period as RebatePeriod, b.validFrom, b.validTo, cutoff).map((p) => p.key);
    const done = await prisma.tradeBonusSettlement.count({ where: { bonusId: b.id, companyId: PERIOD_DONE, periodKey: { in: all } } });
    if (done === all.length) await prisma.tradeBonus.update({ where: { id: b.id }, data: { status: "ENDED" } });
  }
  return out;
}

async function tellBuyer(b: TradeBonus & { seller: { legalName: string; tradeName: string | null } }, row: { companyId: string; value: Prisma.Decimal; freeUnits: number; periodKey: string }) {
  if (row.freeUnits > 0) {
    const g = await prisma.tradeBonusFreeGoods.findFirst({ where: { bonusId: b.id, companyId: row.companyId, periodKey: row.periodKey }, orderBy: { createdAt: "desc" } });
    const offer = g ? await prisma.vendorOffer.findUnique({ where: { id: g.offerId }, select: { packaging: { select: { name: true, variant: { select: { product: { select: { name: true } } } } } } } }) : null;
    await notify("rebate.free_goods", [{ companyId: row.companyId, link: "/buy/rewards/bonuses" }], { name: b.name, supplier: name(b.seller), qty: row.freeUnits, product: offer ? pickName(offer.packaging.variant.product.name) : "", date: g?.expiresAt.toISOString().slice(0, 10) ?? "" });
  } else await notify("rebate.earned", [{ companyId: row.companyId, link: "/buy/rewards/bonuses" }], { name: b.name, supplier: name(b.seller), amount: Number(row.value), period: row.periodKey });
}

/** New deal running: tell its customers who bought from the supplier in the last year (at most 500). */
async function announce(b: TradeBonus) {
  if (b.validTo && b.validTo <= new Date()) return;
  const s = await rebateSettings();
  const since = new Date(Date.now() - 365 * DAY);
  // a buying group's deal goes to all its members; otherwise to the supplier's customers of the last year
  const candidates = b.audience === "BUYING_GROUP"
    ? (await prisma.buyingGroupMember.findMany({ where: { groupId: b.buyingGroupId ?? "", status: "ACTIVE" }, select: { companyId: true } })).map((m) => m.companyId)
    : (await prisma.order.findMany({ where: { sellerCompanyId: b.sellerCompanyId, placedAt: { gte: since }, status: { notIn: ["CANCELLED"] } }, select: { buyerCompanyId: true }, distinct: ["buyerCompanyId"], take: 2000 })).map((x) => x.buyerCompanyId);
  const ok = [...(await forBonus(b, candidates, s))].slice(0, 500);
  const seller = await prisma.company.findUniqueOrThrow({ where: { id: b.sellerCompanyId }, select: { legalName: true, tradeName: true } });
  for (const id of ok) await notify("rebate.available", [{ companyId: id, link: "/buy/rewards/bonuses" }], { name: b.name, supplier: name(seller) }).catch(() => null);
}

/** "You're close": customers with ≥ 70 % of the way to the next step in the last days of a period (once a period). */
async function nudge(b: TradeBonus, s: RebateSettings, now: Date) {
  const p = periodOf(now, b.period as RebatePeriod);
  if (p.end.getTime() - now.getTime() > s.nudgeDays * DAY) return 0;
  const span = { start: b.validFrom > p.start ? b.validFrom : p.start, end: now };
  const seller = await prisma.company.findUniqueOrThrow({ where: { id: b.sellerCompanyId }, select: { legalName: true, tradeName: true } });
  let sent = 0;
  for (const r of await periodResults(b, span, s)) {
    const n = r.result.next;
    if (!n || r.result.progress < 70 || n.missing <= 0) continue;
    const key = { bonusId: b.id, companyId: r.companyId, branchId: r.branchId, periodKey: p.key };
    const done = await prisma.tradeBonusNudge.createMany({ data: [key], skipDuplicates: true });
    if (!done.count) continue;
    const missing = n.unit === "AMOUNT" ? `${n.missing.toFixed(2)} €` : String(Math.ceil(n.missing));
    await notify("rebate.close", [{ companyId: r.companyId, link: "/buy/rewards/bonuses" }], { name: b.name, supplier: name(seller), missing }).catch(() => null);
    sent++;
  }
  return sent;
}

/** Daily job: settle ended periods, end finished deals, remind customers close to a step. */
export async function runRebatesJob(now = new Date()) {
  const s = await rebateSettings();
  const out = { deals: 0, periods: 0, settled: 0, value: 0, freeUnits: 0, failed: 0, nudged: 0 };
  // settle even when the feature has been switched off since: customers keep what they earned
  const deals = await prisma.tradeBonus.findMany({ where: { status: "APPROVED", validFrom: { lt: now } }, select: { id: true } });
  for (const d of deals) {
    const r = await settleBonus(d.id, now);
    out.deals++; out.periods += r.periods; out.settled += r.settled; out.value = r2(out.value + r.value); out.freeUnits += r.freeUnits; out.failed += r.failed;
  }
  if (s.enabled && s.nudge) {
    const live = await prisma.tradeBonus.findMany({ where: { status: "APPROVED", validFrom: { lte: now }, OR: [{ validTo: null }, { validTo: { gt: now } }], kind: { not: "GROWTH" } } });
    for (const b of live) out.nudged += await nudge(b, s, now).catch(() => 0);
  }
  return out;
}

// ── free goods at checkout ──────────────────────────────────────────────────

export type FreeGrant = { id: string; qty: number; funder: "SUPPLIER" | "FIRINGI" };

/** Free units a customer can take now, per product (oldest expiry first). */
export async function freeGoodsFor(companyId: string, offerIds: string[]): Promise<Map<string, FreeGrant[]>> {
  const out = new Map<string, FreeGrant[]>();
  if (!offerIds.length) return out;
  const rows = await prisma.tradeBonusFreeGoods.findMany({ where: { companyId, offerId: { in: offerIds }, expiresAt: { gt: new Date() } }, include: { bonus: { select: { fundedBy: true } } }, orderBy: { expiresAt: "asc" } });
  for (const r of rows) {
    const left = r.qty - r.usedQty;
    if (left <= 0) continue;
    out.set(r.offerId, [...(out.get(r.offerId) ?? []), { id: r.id, qty: left, funder: r.bonus.fundedBy === "FIRINGI" ? "FIRINGI" : "SUPPLIER" }]);
  }
  return out;
}

let promoReady = false;
/** The system promotion that carries free goods on orders, invoices and promotion reports (never applied by itself). */
export async function ensureFreeGoodsPromotion() {
  if (promoReady) return;
  await prisma.promotion.upsert({
    where: { id: FREE_GOODS_PROMOTION_ID }, update: {},
    create: {
      id: FREE_GOODS_PROMOTION_ID, ownerType: "ADMIN", name: { en: "Free goods (bonus)", pt: "Mercadoria grátis (bónus)", es: "Mercancía gratis (bonificación)" }, kind: "ORDER_AMOUNT", value: 0.01,
      firingiFundPct: 0, vendorFundPct: 100, validFrom: new Date(0), status: "PAUSED", showInOffers: false,
      description: { en: "Free goods earned with a rebate & bonus deal (Phase 48). Managed in Pricing › Rebates & Bonuses." },
    },
  });
  promoReady = true;
}

/** An order took free units: use them up (refused if they were used meanwhile — nothing is placed then). */
export async function consumeFreeGoods(tx: Tx, orderId: string, grants: { id: string; qty: number }[]) {
  for (const g of grants) {
    if (g.qty <= 0) continue;
    const row = await tx.tradeBonusFreeGoods.findUnique({ where: { id: g.id } });
    if (!row || row.qty - row.usedQty < g.qty || row.expiresAt <= new Date()) throw new ValidationError("Your free goods changed meanwhile — please check your cart again.");
    const uses = [...((row.uses as { orderId: string; qty: number; at: string }[]) ?? []), { orderId, qty: g.qty, at: new Date().toISOString() }];
    const n = await tx.tradeBonusFreeGoods.updateMany({ where: { id: g.id, usedQty: row.usedQty }, data: { usedQty: row.usedQty + g.qty, uses } });
    if (!n.count) throw new ValidationError("Your free goods changed meanwhile — please check your cart again.");
  }
}

/** A cancelled order gives its free units back (a little longer to take them if they had expired). */
export async function restoreFreeGoods(orderId: string) {
  const rows = await prisma.tradeBonusFreeGoods.findMany({ where: { uses: { array_contains: [{ orderId }] } } });
  for (const r of rows) {
    const uses = (r.uses as { orderId: string; qty: number; at: string; restored?: boolean }[]) ?? [];
    const back = uses.filter((u) => u.orderId === orderId && !u.restored).reduce((a, u) => a + u.qty, 0);
    if (!back) continue;
    await prisma.tradeBonusFreeGoods.update({
      where: { id: r.id },
      data: { usedQty: Math.max(0, r.usedQty - back), uses: uses.map((u) => (u.orderId === orderId ? { ...u, restored: true } : u)), ...(r.expiresAt < new Date(Date.now() + 7 * DAY) ? { expiresAt: new Date(Date.now() + 7 * DAY) } : {}) },
    });
  }
}

// ── reading: supplier ───────────────────────────────────────────────────────

export async function ownBonuses(ctx: Ctx) {
  assertSupplier(ctx, false);
  const [rows, s] = await Promise.all([prisma.tradeBonus.findMany({ where: { sellerCompanyId: ctx.company.id }, orderBy: { createdAt: "desc" } }), rebateSettings()]);
  const access = await supplierAccess(ctx.company.id, ctx.company.type, s);
  const sums = await prisma.tradeBonusSettlement.groupBy({ by: ["bonusId"], where: { bonusId: { in: rows.map((r) => r.id) }, status: "SETTLED" }, _sum: { value: true, freeUnits: true }, _count: true });
  const by = new Map(sums.map((x) => [x.bonusId, x]));
  return { access, settings: s, rows: rows.map((r) => ({ ...r, paid: Number(by.get(r.id)?._sum.value ?? 0), freeGiven: by.get(r.id)?._sum.freeUnits ?? 0, earners: by.get(r.id)?._count ?? 0 })) };
}

/** One deal with its live period (per customer) and settled periods. Supplier: own deals; FIRINGI: all. */
export async function bonusDetail(ctx: Ctx, id: string) {
  const admin = ctx.company.type === "ADMIN";
  if (admin) staff(ctx); else assertSupplier(ctx, false);
  const b = await prisma.tradeBonus.findUnique({ where: { id }, include: { seller: { select: { legalName: true, tradeName: true } } } });
  if (!b || (!admin && b.sellerCompanyId !== ctx.company.id)) throw new NotFoundError("Deal");
  const s = await rebateSettings();
  const now = new Date();
  const p = periodOf(now, b.period as RebatePeriod);
  const live = b.status === "APPROVED" && b.validFrom <= now && (!b.validTo || b.validTo > now);
  const current = live ? await periodResults(b, { start: b.validFrom > p.start ? b.validFrom : p.start, end: now }, s) : [];
  const settlements = await prisma.tradeBonusSettlement.findMany({ where: { bonusId: b.id, companyId: { not: PERIOD_DONE } }, orderBy: [{ periodStart: "desc" }, { value: "desc" }], take: 500 });
  const ids = [...new Set([...current.map((r) => r.companyId), ...settlements.map((x) => x.companyId)])];
  const branchIds = [...new Set([...current.map((r) => r.branchId), ...settlements.map((x) => x.branchId)].filter(Boolean))];
  const [cos, branches, offers] = await Promise.all([
    prisma.company.findMany({ where: { id: { in: ids } }, select: { id: true, legalName: true, tradeName: true } }),
    prisma.branch.findMany({ where: { id: { in: branchIds } }, select: { id: true, name: true } }),
    offerLabels([...b.offerIds, ...(b.rewardOfferId ? [b.rewardOfferId] : [])]),
  ]);
  const coName = new Map(cos.map((c) => [c.id, name(c)]));
  const brName = new Map(branches.map((x) => [x.id, x.name]));
  return {
    bonus: b, live, period: { key: p.key, start: p.start, end: p.end }, offers,
    current: current.map((r) => ({ ...r, company: coName.get(r.companyId) ?? "?", branch: brName.get(r.branchId) ?? null })).sort((a, c) => c.stats.amount - a.stats.amount),
    settlements: settlements.map((x) => ({ ...x, company: coName.get(x.companyId) ?? "?", branch: brName.get(x.branchId) ?? null })),
  };
}

async function offerLabels(ids: string[]) {
  if (!ids.length) return new Map<string, string>();
  const rows = await prisma.vendorOffer.findMany({ where: { id: { in: ids } }, select: { id: true, packaging: { select: { name: true, variant: { select: { product: { select: { name: true } } } } } } } });
  return new Map(rows.map((o) => [o.id, `${pickName(o.packaging.variant.product.name)} — ${pickName(o.packaging.name)}`]));
}

/** Choices for the supplier's form: its offers, its customer groups, FIRINGI's segments, categories, brands. */
export async function formOptions(ctx: Ctx, sellerId?: string) {
  const admin = ctx.company.type === "ADMIN";
  if (admin) staff(ctx); else assertSupplier(ctx, false);
  const seller = admin ? sellerId ?? null : ctx.company.id;
  const [offers, groups, segments, categories, brands, countries, suppliers] = await Promise.all([
    seller ? prisma.vendorOffer.findMany({ where: { vendorCompanyId: seller, status: "ACTIVE" }, select: { id: true, packaging: { select: { name: true, variant: { select: { sku: true, product: { select: { name: true, brandId: true, categoryId: true } } } } } } }, take: 2000 }) : Promise.resolve([]),
    prisma.customerGroup.findMany({ where: { buyingGroupId: null, OR: [{ ownerCompanyId: seller ?? undefined }, { ownerCompanyId: null }] }, select: { id: true, name: true, ownerCompanyId: true }, orderBy: { name: "asc" } }),
    prisma.crmSegment.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.category.findMany({ select: { id: true, name: true, depth: true, path: true }, orderBy: { path: "asc" } }),
    prisma.brand.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.country.findMany({ where: { isActive: true, isSchengen: true }, select: { code: true, name: true, flag: true }, orderBy: { code: "asc" } }), // Schengen only
    admin ? prisma.company.findMany({ where: { type: { in: ["DISTRIBUTOR", "WHOLESALER"] }, status: "APPROVED" }, select: { id: true, legalName: true, tradeName: true }, orderBy: { legalName: "asc" } }) : Promise.resolve([]),
  ]);
  return {
    offers: offers.map((o) => ({ id: o.id, label: `${pickName(o.packaging.variant.product.name)} — ${pickName(o.packaging.name)}`, sku: o.packaging.variant.sku })).sort((a, c) => a.label.localeCompare(c.label)),
    groups: groups.map((g) => ({ id: g.id, name: g.name, own: !!g.ownerCompanyId })), segments,
    categories: categories.map((c) => ({ id: c.id, name: pickName(c.name), depth: c.depth })),
    brands, countries: countries.map((c) => ({ code: c.code, name: pickName(c.name), flag: c.flag })),
    suppliers: suppliers.map((x) => ({ id: x.id, name: name(x) })),
    // Phase 49: approved buying groups (their members' purchases count together); not the supplier's own customer groups for group prices
    buyingGroups: (await prisma.buyingGroup.findMany({ where: { status: "APPROVED" }, select: { id: true, name: true, country: { select: { code: true } }, _count: { select: { members: { where: { status: "ACTIVE" } } } } }, orderBy: { name: "asc" }, take: 500 })).map((g) => ({ id: g.id, name: `${g.name} (${g.country.code}, ${g._count.members})` })),
  };
}

/** Customers a supplier can pick by name (its own buyers first). */
export async function searchCustomers(ctx: Ctx, q: string) {
  const admin = ctx.company.type === "ADMIN";
  if (admin) staff(ctx); else assertSupplier(ctx, false);
  const term = q.trim();
  if (term.length < 2) return [];
  const rows = await prisma.company.findMany({
    where: { ...(admin ? { AND: [await (await import("@/server/services/admin-search")).adminCompanyWhere(ctx)] } : {}), type: { in: ["CUSTOMER", "WHOLESALER"] }, status: "APPROVED", OR: [{ legalName: { contains: term, mode: "insensitive" } }, { tradeName: { contains: term, mode: "insensitive" } }, { taxId: { contains: term } }] },
    select: { id: true, legalName: true, tradeName: true, country: { select: { code: true } } }, take: 20,
  });
  return rows.map((c) => ({ id: c.id, name: name(c), country: c.country.code }));
}

// ── reading: FIRINGI ────────────────────────────────────────────────────────

export async function adminBonuses(ctx: Ctx, f: { status?: string | null } = {}) {
  staff(ctx);
  const rows = await prisma.tradeBonus.findMany({ where: f.status ? { status: f.status as TradeBonus["status"] } : {}, include: { seller: { select: { legalName: true, tradeName: true } } }, orderBy: [{ status: "asc" }, { createdAt: "desc" }], take: 500 });
  const sums = await prisma.tradeBonusSettlement.groupBy({ by: ["bonusId"], where: { bonusId: { in: rows.map((r) => r.id) }, status: "SETTLED" }, _sum: { value: true, freeUnits: true }, _count: true });
  const by = new Map(sums.map((x) => [x.bonusId, x]));
  return rows.map((r) => ({ ...r, supplier: name(r.seller), paid: Number(by.get(r.id)?._sum.value ?? 0), freeGiven: by.get(r.id)?._sum.freeUnits ?? 0, earners: by.get(r.id)?._count ?? 0 }));
}

export async function rebatesOverview(ctx: Ctx) {
  staff(ctx);
  const now = new Date();
  const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const [pending, live, paid, funded, failed, free] = await Promise.all([
    prisma.tradeBonus.count({ where: { status: "PENDING" } }),
    prisma.tradeBonus.count({ where: { status: "APPROVED", validFrom: { lte: now }, OR: [{ validTo: null }, { validTo: { gt: now } }] } }),
    prisma.tradeBonusSettlement.aggregate({ where: { status: "SETTLED", createdAt: { gte: yearStart } }, _sum: { value: true } }),
    prisma.tradeBonusSettlement.aggregate({ where: { status: "SETTLED", createdAt: { gte: yearStart }, bonus: { fundedBy: "FIRINGI" } }, _sum: { value: true } }),
    prisma.tradeBonusSettlement.count({ where: { status: "FAILED" } }),
    prisma.tradeBonusFreeGoods.aggregate({ where: { createdAt: { gte: yearStart } }, _sum: { qty: true, usedQty: true } }),
  ]);
  return { pending, live, paidYear: Number(paid._sum.value ?? 0), firingiYear: Number(funded._sum.value ?? 0), failed, freeGiven: free._sum.qty ?? 0, freeTaken: free._sum.usedQty ?? 0 };
}

export async function supplierSwitches(ctx: Ctx) {
  staff(ctx);
  const [cos, feats, counts] = await Promise.all([
    prisma.company.findMany({ where: { type: { in: ["DISTRIBUTOR", "WHOLESALER"] }, status: { in: ["APPROVED", "SUSPENDED"] } }, select: { id: true, legalName: true, tradeName: true, type: true }, orderBy: { legalName: "asc" } }),
    prisma.companyFeature.findMany({ where: { key: FEATURE } }),
    prisma.tradeBonus.groupBy({ by: ["sellerCompanyId"], _count: true }),
  ]);
  const f = new Map(feats.map((x) => [x.companyId, x.enabled ? "ON" : "OFF"]));
  const c = new Map(counts.map((x) => [x.sellerCompanyId, x._count]));
  return cos.map((x) => ({ id: x.id, name: name(x), type: x.type, state: (f.get(x.id) ?? "DEFAULT") as "DEFAULT" | "ON" | "OFF", deals: c.get(x.id) ?? 0 }));
}

/** Retry failed settlements now (FIRINGI). */
export async function retryFailed(ctx: Ctx) {
  staff(ctx, true);
  const ids = await prisma.tradeBonusSettlement.findMany({ where: { status: "FAILED" }, select: { bonusId: true }, distinct: ["bonusId"] });
  let n = 0;
  for (const x of ids) n += (await settleBonus(x.bonusId)).settled;
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "rebates.retry", entityType: "TradeBonus", entityId: "*", after: { settled: n } });
  return n;
}

// ── reading: buyer ──────────────────────────────────────────────────────────

/** The buyer's bonuses: running deals with progress this period, what it earned, free goods to take. */
export async function myBonuses(ctx: Ctx) {
  if (!isBuyerType(ctx.company.type) || !can(ctx, ["buyer.orders.view", "buyer.orders.place", "buyer.invoices.view"])) throw new ForbiddenError();
  const s = await rebateSettings();
  const now = new Date();
  const liveRows = s.enabled && (s.buyers as Record<string, boolean>)[ctx.company.type]
    ? await prisma.tradeBonus.findMany({ where: { status: "APPROVED", validFrom: { lte: new Date(now.getTime() + 30 * DAY) }, OR: [{ validTo: null }, { validTo: { gt: now } }] }, include: { seller: { select: { legalName: true, tradeName: true } } }, orderBy: { validFrom: "asc" } })
    : [];
  const mine: typeof liveRows = [];
  for (const b of liveRows) if ((await forBonus(b, [ctx.company.id], s)).has(ctx.company.id)) mine.push(b);
  const { branchScope } = await import("@/server/multisite/branches");
  const scope = await branchScope(ctx);
  const running = [];
  for (const b of mine) {
    const p = periodOf(now, b.period as RebatePeriod);
    const started = b.validFrom <= now;
    const rules = b.rules as RebateRules;
    const zero: Stats = { amount: 0, units: 0, previousAmount: 0, distinct: 0, perProductUnits: {} };
    const span = { start: b.validFrom > p.start ? b.validFrom : p.start, end: now };
    // Phase 49: a buying group's deal — the whole group's progress, this business's share
    let group: { name: string; stats: Stats; members: number } | null = null;
    let res: { companyId: string; branchId: string; stats: Stats; result: Result }[];
    if (b.audience === "BUYING_GROUP") {
      const all = started ? await pooledResults(b, span, s) : [];
      const gStats = all[0]?.group ?? zero;
      const g = await prisma.buyingGroup.findUnique({ where: { id: b.buyingGroupId ?? "" }, select: { name: true } });
      group = { name: g?.name ?? "", stats: gStats, members: all.length };
      const own = all.find((r) => r.companyId === ctx.company.id);
      res = [own ?? { companyId: ctx.company.id, branchId: "", stats: zero, result: { ...evaluate(rules, gStats), value: 0, freeUnits: 0 } }];
    } else res = started ? await periodResults(b, span, s, [ctx.company.id]) : [];
    let rows = res.length ? res : [{ companyId: ctx.company.id, branchId: "", stats: zero, result: evaluate(rules, zero) }];
    if (b.kind === "GROWTH" && !res.length) {
      const prev = statsOf(await purchaseRows(b, previousYear(p).start, previousYear(p).end, [ctx.company.id]), b.perShop);
      rows = [...prev.values()].map((x) => { const st = { ...zero, previousAmount: r2(x.amount) }; return { companyId: ctx.company.id, branchId: x.branchId, stats: st, result: evaluate(rules, st) }; });
      if (!rows.length) rows = [{ companyId: ctx.company.id, branchId: "", stats: zero, result: evaluate(rules, zero) }];
    }
    if (scope) rows = rows.filter((r) => !r.branchId || scope.includes(r.branchId));
    running.push({ id: b.id, name: b.name, description: b.description, kind: b.kind, period: b.period, periodKey: p.key, periodEnd: p.end, startsAt: started ? null : b.validFrom, validTo: b.validTo, supplier: name(b.seller), rules, perShop: b.perShop, rewardOfferId: b.rewardOfferId, offerIds: b.offerIds, categoryIds: b.categoryIds, brandIds: b.brandIds, rows, group });
  }
  const [earned, goods] = await Promise.all([
    prisma.tradeBonusSettlement.findMany({ where: { companyId: ctx.company.id, status: "SETTLED" }, include: { bonus: { select: { name: true, kind: true, seller: { select: { legalName: true, tradeName: true } } } } }, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.tradeBonusFreeGoods.findMany({ where: { companyId: ctx.company.id }, include: { bonus: { select: { name: true } } }, orderBy: { expiresAt: "asc" }, take: 100 }),
  ]);
  const branchIds = [...new Set(running.flatMap((r) => r.rows.map((x) => x.branchId)).filter(Boolean))];
  const [labels, branches] = await Promise.all([
    offerLabels([...new Set([...goods.map((g) => g.offerId), ...running.flatMap((r) => (r.rewardOfferId ? [r.rewardOfferId] : []))])]),
    prisma.branch.findMany({ where: { id: { in: branchIds } }, select: { id: true, name: true } }),
  ]);
  return {
    enabled: s.enabled,
    running, branches: Object.fromEntries(branches.map((x) => [x.id, x.name])), labels: Object.fromEntries(labels),
    earned: earned.map((e) => ({ id: e.id, name: e.bonus.name, kind: e.bonus.kind, supplier: name(e.bonus.seller), periodKey: e.periodKey, value: Number(e.value), freeUnits: e.freeUnits, at: e.createdAt, creditNoteIds: e.creditNoteIds })),
    freeGoods: goods.map((g) => ({ id: g.id, name: g.bonus.name, offerId: g.offerId, product: labels.get(g.offerId) ?? "", qty: g.qty, left: g.qty - g.usedQty, expiresAt: g.expiresAt, expired: g.expiresAt <= now })),
    totals: { year: r2(earned.filter((e) => e.createdAt.getUTCFullYear() === now.getUTCFullYear()).reduce((a, e) => a + Number(e.value), 0)), freeLeft: goods.filter((g) => g.expiresAt > now).reduce((a, g) => a + g.qty - g.usedQty, 0) },
  };
}

/** Number of running bonuses for a buyer (dashboard / nav badge). */
export async function runningCount(companyId: string, type: string) {
  const s = await rebateSettings();
  if (!s.enabled || !(s.buyers as Record<string, boolean>)[type]) return 0;
  const now = new Date();
  const rows = await prisma.tradeBonus.findMany({ where: { status: "APPROVED", validFrom: { lte: now }, OR: [{ validTo: null }, { validTo: { gt: now } }] } });
  let n = 0;
  for (const b of rows) if ((await forBonus(b, [companyId], s)).has(companyId)) n++;
  return n;
}

/** Names of chosen customers (to show a saved deal in the form). */
export async function companyNames(ids: string[]) {
  if (!ids.length) return [];
  const rows = await prisma.company.findMany({ where: { id: { in: ids } }, select: { id: true, legalName: true, tradeName: true } });
  return rows.map((c) => ({ id: c.id, name: name(c) }));
}
