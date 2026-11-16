/**
 * Phase 34 — Sponsored products (advertising).
 *
 * Suppliers (wholesalers, distributors) pay FIRINGI to show their products higher up: in search results,
 * on category pages, on the shop home and as suggestions in the cart. FIRINGI switches each placement on
 * or off and sets its minimum price per click, its price per day and its number of slots.
 *
 * Pricing, chosen per campaign: CPC (pay per click, bid ≥ the placement's minimum, with a daily and an
 * optional total budget) or DAILY (a fixed price per day, booked from a start to an end date; booked days
 * are paid whether or not anyone clicks, and a placement can't be booked by more campaigns than it has slots).
 * Prices are net (excl. VAT). Booked DAILY campaigns show first, then CPC campaigns by bid; one ad per
 * campaign per page. A buyer clicking the same campaign again within a few minutes isn't charged again.
 *
 * Billing — agreed with each supplier, set by FIRINGI per supplier (AdAccount.billing):
 *   PAYOUT  — a monthly ad invoice, settled against what FIRINGI owes the supplier (offset recorded as an
 *             inbound + an outbound payment of the same amount, so both sides' accounts stay right);
 *   INVOICE — a monthly ad invoice, paid with normal terms;
 *   PREPAID — the supplier tops up a balance first (FIRINGI records the transfer and issues an
 *             invoice-receipt for it); ads stop when the balance is used up.
 * A remaining prepaid balance is always used first, whatever the method.
 */
import Decimal from "decimal.js";
import type { AdBilling, AdPlacement, AdPricing, AdStatus, Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";
import { companyFeatureOn } from "@/server/accounting/features";

type Tx = Prisma.TransactionClient;
const DAY = 86_400_000;
const D = (v: unknown) => new Decimal((v as { toString(): string } | null)?.toString() ?? "0");
const r2 = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
export const PLACEMENTS = ["SEARCH", "CATEGORY", "HOME", "CART"] as const satisfies readonly AdPlacement[];
const dayOf = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

// ── settings ────────────────────────────────────────────────────────────────

export type PlacementRule = { enabled: boolean; slots: number; minCpc: number; dailyPrice: number };
export type AdsSettings = {
  enabled: boolean; approvalRequired: boolean; defaultBilling: AdBilling; invoiceDueDays: number; clickDedupeMinutes: number; lowBalance: number;
  placements: Record<AdPlacement, PlacementRule>;
};
export const ADS_DEFAULTS: AdsSettings = {
  enabled: true, approvalRequired: true, defaultBilling: "INVOICE", invoiceDueDays: 30, clickDedupeMinutes: 30, lowBalance: 20,
  placements: {
    SEARCH: { enabled: true, slots: 2, minCpc: 0.3, dailyPrice: 5 },
    CATEGORY: { enabled: true, slots: 2, minCpc: 0.25, dailyPrice: 4 },
    HOME: { enabled: true, slots: 4, minCpc: 0.2, dailyPrice: 8 },
    CART: { enabled: true, slots: 2, minCpc: 0.2, dailyPrice: 3 },
  },
};
const KEY = "ads.settings";

export async function adsSettings(): Promise<AdsSettings> {
  const row = await prisma.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: KEY } });
  const v = (row?.value ?? {}) as Partial<AdsSettings>;
  const placements = { ...ADS_DEFAULTS.placements };
  for (const p of PLACEMENTS) placements[p] = { ...ADS_DEFAULTS.placements[p], ...(v.placements?.[p] ?? {}) };
  return { ...ADS_DEFAULTS, ...v, placements };
}

const staffView = (ctx: Ctx) => ctx.company.type === "ADMIN" && can(ctx, ["admin.marketing.view", "admin.marketing.manage", "admin.finance.view", "admin.finance.manage"]);
const staffManage = (ctx: Ctx) => ctx.company.type === "ADMIN" && can(ctx, "admin.marketing.manage");
const staffFinance = (ctx: Ctx) => ctx.company.type === "ADMIN" && can(ctx, ["admin.finance.manage"]);

export async function saveAdsSettings(ctx: Ctx, input: Partial<AdsSettings>) {
  if (!staffManage(ctx)) throw new ForbiddenError();
  const cur = await adsSettings();
  const next: AdsSettings = { ...cur, ...input, placements: { ...cur.placements } };
  for (const p of PLACEMENTS) next.placements[p] = { ...cur.placements[p], ...(input.placements?.[p] ?? {}) };
  const bad = (m: string) => { throw new ValidationError(m); };
  if (!["PAYOUT", "PREPAID", "INVOICE"].includes(next.defaultBilling)) bad("Choose a default billing method.");
  if (!Number.isInteger(next.invoiceDueDays) || next.invoiceDueDays < 0 || next.invoiceDueDays > 120) bad("Invoice payment terms: 0–120 days.");
  if (!Number.isInteger(next.clickDedupeMinutes) || next.clickDedupeMinutes < 0 || next.clickDedupeMinutes > 1440) bad("Repeat clicks: 0–1440 minutes.");
  if (!(next.lowBalance >= 0)) bad("Low balance warning can't be negative.");
  for (const p of PLACEMENTS) {
    const r = next.placements[p];
    if (!Number.isInteger(r.slots) || r.slots < 1 || r.slots > 8) bad(`${p}: 1–8 slots.`);
    if (!(r.minCpc > 0 && r.minCpc <= 50)) bad(`${p}: minimum per click more than 0 €, up to 50 €.`);
    if (!(r.dailyPrice > 0 && r.dailyPrice <= 1000)) bad(`${p}: price per day more than 0 €, up to 1000 €.`);
  }
  await prisma.setting.upsert({
    where: { scope_scopeId_key: { scope: "GLOBAL", scopeId: "", key: KEY } },
    update: { value: next as unknown as Prisma.InputJsonValue, updatedById: ctx.user.id },
    create: { scope: "GLOBAL", key: KEY, value: next as unknown as Prisma.InputJsonValue, updatedById: ctx.user.id },
  });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "ads.settings_changed", entityType: "Setting", entityId: KEY, before: cur, after: next });
  return next;
}

// ── supplier access / account ───────────────────────────────────────────────

async function requireAdvertiser(ctx: Ctx, manage = true) {
  if (!["WHOLESALER", "DISTRIBUTOR"].includes(ctx.company.type)) throw new ForbiddenError();
  if (!can(ctx, manage ? "vendor.promotions.manage" : ["vendor.promotions.manage", "vendor.reports.view"])) throw new ForbiddenError();
  const s = await adsSettings();
  if (!s.enabled || !(await companyFeatureOn(ctx.company.id, "ADS"))) throw new NotFoundError("Advertising");
  return s;
}

/** Is advertising available to this supplier (FIRINGI's global switch + the per-company switch)? */
export async function adsOn(companyId: string) {
  return (await adsSettings()).enabled && (await companyFeatureOn(companyId, "ADS"));
}

async function account(db: Tx | typeof prisma, companyId: string) {
  return (await db.adAccount.findUnique({ where: { companyId } })) ?? db.adAccount.create({ data: { companyId, billing: (await adsSettings()).defaultBilling } });
}

// ── campaigns (supplier) ────────────────────────────────────────────────────

export type CampaignInput = {
  name: string; placement: AdPlacement; pricing: AdPricing; offerIds: string[]; keywords?: string[]; categoryId?: string | null;
  cpcBid?: number | null; dailyBudget?: number | null; totalBudget?: number | null; startsOn: string; endsOn?: string | null;
};

const parseDay = (s: string | null | undefined, f: string) => {
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new ValidationError("Dates: YYYY-MM-DD.", { [f]: ["Invalid date"] });
  return new Date(`${s}T00:00:00.000Z`);
};

/** Days of a DAILY booking where the placement would have more bookings than slots. */
async function fullyBookedDays(placement: AdPlacement, from: Date, to: Date, slots: number, exceptId?: string) {
  const others = await prisma.adCampaign.findMany({
    where: { placement, pricing: "DAILY", status: { in: ["PENDING", "ACTIVE", "PAUSED"] }, startsOn: { lte: to }, endsOn: { gte: from }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { startsOn: true, endsOn: true },
  });
  const full: string[] = [];
  for (let t = from.getTime(); t <= to.getTime(); t += DAY) {
    const n = others.filter((o) => o.startsOn.getTime() <= t && (o.endsOn?.getTime() ?? Infinity) >= t).length;
    if (n >= slots) full.push(new Date(t).toISOString().slice(0, 10));
  }
  return full;
}

export async function createCampaign(ctx: Ctx, input: CampaignInput, now = new Date()) {
  const s = await requireAdvertiser(ctx);
  const name = input.name.trim();
  if (name.length < 3 || name.length > 120) throw new ValidationError("Give the campaign a name (3–120 characters).", { name: ["3–120 characters"] });
  if (!PLACEMENTS.includes(input.placement as (typeof PLACEMENTS)[number])) throw new ValidationError("Choose where the ad shows.", { placement: ["Required"] });
  const rule = s.placements[input.placement];
  if (!rule.enabled) throw new ValidationError("FIRINGI has switched this placement off.", { placement: ["Not available"] });
  if (!["CPC", "DAILY"].includes(input.pricing)) throw new ValidationError("Choose per click or per day.", { pricing: ["Required"] });
  const offerIds = [...new Set(input.offerIds)];
  if (!offerIds.length || offerIds.length > 20) throw new ValidationError("Choose 1–20 of your products.", { offerIds: ["1–20 products"] });
  const own = await prisma.vendorOffer.count({ where: { id: { in: offerIds }, vendorCompanyId: ctx.company.id, status: "ACTIVE" } });
  if (own !== offerIds.length) throw new ValidationError("Only your own products on sale can be advertised.", { offerIds: ["Not yours or not on sale"] });
  const keywords = input.placement === "SEARCH" ? [...new Set((input.keywords ?? []).map((k) => k.trim().toLowerCase()).filter(Boolean))] : [];
  if (keywords.length > 20 || keywords.some((k) => k.length < 2 || k.length > 40)) throw new ValidationError("Up to 20 search words, 2–40 characters each.", { keywords: ["Invalid"] });
  let categoryId: string | null = null;
  if (input.placement === "CATEGORY" && input.categoryId) {
    if (!(await prisma.category.findFirst({ where: { id: input.categoryId, isActive: true } }))) throw new ValidationError("Choose a category.", { categoryId: ["Invalid"] });
    categoryId = input.categoryId;
  }
  const today = dayOf(now);
  const startsOn = parseDay(input.startsOn, "startsOn")!;
  const endsOn = parseDay(input.endsOn ?? null, "endsOn");
  if (!startsOn || startsOn < today) throw new ValidationError("The start can't be in the past.", { startsOn: ["From today"] });
  if (endsOn && endsOn < startsOn) throw new ValidationError("The end must be on or after the start.", { endsOn: ["After the start"] });
  const data: Prisma.AdCampaignUncheckedCreateInput = {
    vendorCompanyId: ctx.company.id, name, placement: input.placement, pricing: input.pricing, offerIds, keywords, categoryId,
    startsOn, endsOn, createdById: ctx.user.id, status: s.approvalRequired ? "PENDING" : "ACTIVE",
  };
  if (input.pricing === "CPC") {
    const bid = Number(input.cpcBid), daily = Number(input.dailyBudget), total = input.totalBudget == null ? null : Number(input.totalBudget);
    if (!(bid >= rule.minCpc) || bid > 50) throw new ValidationError(`Price per click: at least ${rule.minCpc.toFixed(2)} €, up to 50 €.`, { cpcBid: [`From ${rule.minCpc.toFixed(2)} €`] });
    if (!(daily >= bid) || daily > 10_000) throw new ValidationError("Daily budget: at least one click, up to 10 000 €.", { dailyBudget: ["Too low"] });
    if (total !== null && (!(total >= bid) || total > 1_000_000)) throw new ValidationError("Total budget: at least one click.", { totalBudget: ["Too low"] });
    Object.assign(data, { cpcBid: bid.toFixed(2), dailyBudget: daily.toFixed(2), totalBudget: total === null ? null : total.toFixed(2) });
  } else {
    if (!endsOn) throw new ValidationError("A booking per day needs an end date.", { endsOn: ["Required"] });
    const days = Math.round((endsOn.getTime() - startsOn.getTime()) / DAY) + 1;
    if (days > 90) throw new ValidationError("Book up to 90 days at a time.", { endsOn: ["Up to 90 days"] });
    const full = await fullyBookedDays(input.placement, startsOn, endsOn, rule.slots);
    if (full.length) throw new AppError("FULLY_BOOKED", `This placement is fully booked on ${full.slice(0, 5).join(", ")}${full.length > 5 ? " …" : ""}.`, 409);
    Object.assign(data, { dailyPrice: rule.dailyPrice.toFixed(2) });
  }
  const c = await prisma.adCampaign.create({ data });
  await account(prisma, ctx.company.id);
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "ads.campaign_created", entityType: "AdCampaign", entityId: c.id, after: { name, placement: c.placement, pricing: c.pricing, status: c.status } });
  return c;
}

async function ownCampaign(ctx: Ctx, id: string) {
  const c = await prisma.adCampaign.findFirst({ where: { id, vendorCompanyId: ctx.company.id } });
  if (!c) throw new NotFoundError("Campaign");
  return c;
}

/** Supplier: pause / resume / end; change the bid and budgets of a per-click campaign (no new approval). */
export async function updateCampaign(ctx: Ctx, id: string, change: { action?: "PAUSE" | "RESUME" | "END"; cpcBid?: number; dailyBudget?: number; totalBudget?: number | null }) {
  const s = await requireAdvertiser(ctx);
  const c = await ownCampaign(ctx, id);
  const data: Prisma.AdCampaignUpdateInput = {};
  if (change.action === "PAUSE") {
    if (c.status !== "ACTIVE") throw new ValidationError("Only a running campaign can be paused.");
    Object.assign(data, { status: "PAUSED", pausedReason: "SUPPLIER" });
  } else if (change.action === "RESUME") {
    if (c.status !== "PAUSED" || c.pausedReason === "FIRINGI") throw new ValidationError(c.pausedReason === "FIRINGI" ? "FIRINGI paused this campaign — contact FIRINGI." : "Only a paused campaign can be resumed.");
    Object.assign(data, { status: "ACTIVE", pausedReason: null });
  } else if (change.action === "END") {
    if (["ENDED", "REJECTED"].includes(c.status)) throw new ValidationError("This campaign has already finished.");
    Object.assign(data, { status: "ENDED", pausedReason: null });
  }
  if (change.cpcBid != null || change.dailyBudget != null || change.totalBudget !== undefined) {
    if (c.pricing !== "CPC") throw new ValidationError("Only per-click campaigns have a bid and budgets.");
    const rule = s.placements[c.placement];
    const bid = change.cpcBid ?? Number(c.cpcBid), daily = change.dailyBudget ?? Number(c.dailyBudget);
    const total = change.totalBudget === undefined ? (c.totalBudget === null ? null : Number(c.totalBudget)) : change.totalBudget;
    if (!(bid >= rule.minCpc) || bid > 50) throw new ValidationError(`Price per click: at least ${rule.minCpc.toFixed(2)} €, up to 50 €.`, { cpcBid: [`From ${rule.minCpc.toFixed(2)} €`] });
    if (!(daily >= bid)) throw new ValidationError("Daily budget: at least one click.", { dailyBudget: ["Too low"] });
    if (total !== null && !(total >= bid)) throw new ValidationError("Total budget: at least one click.", { totalBudget: ["Too low"] });
    Object.assign(data, { cpcBid: bid.toFixed(2), dailyBudget: daily.toFixed(2), totalBudget: total === null ? null : total.toFixed(2) });
    if (c.status === "ENDED" && c.pausedReason === "BUDGET" && (total === null || D(total).gt(await spentOf(c.id)))) Object.assign(data, { status: "ACTIVE", pausedReason: null });
  }
  const row = await prisma.adCampaign.update({ where: { id }, data });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "ads.campaign_changed", entityType: "AdCampaign", entityId: id, before: { status: c.status, cpcBid: c.cpcBid?.toString(), dailyBudget: c.dailyBudget?.toString(), totalBudget: c.totalBudget?.toString() ?? null }, after: { status: row.status, cpcBid: row.cpcBid?.toString(), dailyBudget: row.dailyBudget?.toString(), totalBudget: row.totalBudget?.toString() ?? null } });
  return row;
}

async function spentOf(campaignId: string, since?: Date) {
  const a = await prisma.adCharge.aggregate({ where: { campaignId, ...(since ? { day: { gte: since } } : {}) }, _sum: { amount: true } });
  return D(a._sum.amount);
}

// ── FIRINGI review ──────────────────────────────────────────────────────────

const PLACE_PT: Record<AdPlacement, string> = { SEARCH: "pesquisa", CATEGORY: "categoria", HOME: "página inicial", CART: "carrinho" };

export async function reviewCampaign(ctx: Ctx, id: string, decision: "APPROVE" | "REJECT" | "PAUSE" | "END", reason?: string | null) {
  if (!staffManage(ctx)) throw new ForbiddenError();
  const c = await prisma.adCampaign.findUnique({ where: { id } });
  if (!c) throw new NotFoundError("Campaign");
  let data: Prisma.AdCampaignUpdateInput;
  if (decision === "APPROVE" || decision === "REJECT") {
    if (c.status !== "PENDING") throw new ValidationError("This campaign isn't waiting for approval.");
    if (decision === "REJECT" && (reason ?? "").trim().length < 3) throw new ValidationError("Tell the supplier why (3+ characters).", { reason: ["Required"] });
    data = decision === "APPROVE" ? { status: "ACTIVE", reviewedById: ctx.user.id, reviewedAt: new Date() } : { status: "REJECTED", rejectReason: reason!.trim(), reviewedById: ctx.user.id, reviewedAt: new Date() };
  } else if (decision === "PAUSE") {
    if (c.status !== "ACTIVE") throw new ValidationError("Only a running campaign can be paused.");
    data = { status: "PAUSED", pausedReason: "FIRINGI" };
  } else {
    if (["ENDED", "REJECTED"].includes(c.status)) throw new ValidationError("This campaign has already finished.");
    data = { status: "ENDED", pausedReason: "FIRINGI" };
  }
  const row = await prisma.adCampaign.update({ where: { id }, data });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: `ads.campaign_${decision.toLowerCase()}`, entityType: "AdCampaign", entityId: id, before: { status: c.status }, after: { status: row.status, reason: reason ?? null } });
  const { notify } = await import("@/server/notify/dispatch");
  if (decision === "APPROVE") await notify("ads.approved", [{ companyId: c.vendorCompanyId, link: `/vendor/ads/${c.id}` }], { campaign: c.name }).catch(() => null);
  if (decision === "REJECT") await notify("ads.rejected", [{ companyId: c.vendorCompanyId, link: `/vendor/ads/${c.id}` }], { campaign: c.name, reason: reason!.trim() }).catch(() => null);
  return row;
}

// ── serving ─────────────────────────────────────────────────────────────────

type CampaignRow = Awaited<ReturnType<typeof prisma.adCampaign.findMany>>[number];
export type SponsoredItem = { campaignId: string; placement: AdPlacement; href: string; item: Awaited<ReturnType<typeof import("@/server/data/catalogue-buyer").presentOffers>>[number] };

async function categoryAncestors() {
  const cats = await prisma.category.findMany({ select: { id: true, parentId: true } });
  const parent = new Map(cats.map((c) => [c.id, c.parentId]));
  return (id: string) => { const out: string[] = []; let p = parent.get(id) ?? null; while (p && out.length < 20) { out.push(p); p = parent.get(p) ?? null; } return out; };
}

/** Charge a DAILY campaign for one day (idempotent). False when the prepaid balance can't pay for it. */
async function chargeDay(c: CampaignRow, day: Date): Promise<boolean> {
  const key = `DAY:${c.id}:${isoDay(day)}`;
  if (await prisma.adCharge.findUnique({ where: { dedupeKey: key } })) return true;
  return prisma.$transaction(async (tx) => {
    const price = D(c.dailyPrice);
    const acc = await account(tx, c.vendorCompanyId);
    const [locked] = await tx.$queryRaw<{ balance: string }[]>`SELECT balance::text FROM "AdAccount" WHERE "companyId" = ${c.vendorCompanyId} FOR UPDATE`;
    const balance = D(locked?.balance ?? acc.balance);
    let prepaid = false;
    if (balance.gt(0)) {
      if (balance.lt(price)) { if (acc.billing === "PREPAID") return false; } // not enough left: billed normally instead
      else { prepaid = true; await tx.adAccount.update({ where: { companyId: c.vendorCompanyId }, data: { balance: balance.minus(price).toFixed(2) } }); }
    } else if (acc.billing === "PREPAID") return false;
    const created = await tx.adCharge.createMany({ data: [{ campaignId: c.id, companyId: c.vendorCompanyId, kind: "DAY", amount: price.toFixed(2), day, prepaid, dedupeKey: key }], skipDuplicates: true });
    if (created.count) await tx.$executeRaw`INSERT INTO "AdStatDay" ("campaignId", day, impressions, clicks, cost) VALUES (${c.id}, ${day}, 0, 0, ${price.toFixed(2)}::numeric)
      ON CONFLICT ("campaignId", day) DO UPDATE SET cost = "AdStatDay".cost + EXCLUDED.cost`;
    else if (prepaid) await tx.adAccount.update({ where: { companyId: c.vendorCompanyId }, data: { balance: balance.toFixed(2) } }); // someone else charged it first
    return true;
  });
}

/**
 * The sponsored products for a buyer in one placement (never more than the placement's slots), and
 * counts the impressions. Empty when FIRINGI switched advertising or the placement off, and in
 * "order from FIRINGI" countries (suppliers aren't shown there).
 */
export async function sponsoredFor(ctx: Ctx, placement: AdPlacement, opts: { q?: string | null; categoryId?: string | null; cartOfferIds?: string[]; excludeOfferIds?: string[] } = {}, now = new Date()): Promise<SponsoredItem[]> {
  if (!["CUSTOMER", "WHOLESALER"].includes(ctx.company.type)) return [];
  const s = await adsSettings();
  const rule = s.placements[placement];
  if (!s.enabled || !rule.enabled) return [];
  if (placement === "SEARCH" && !opts.q?.trim()) return [];
  if (placement === "CATEGORY" && !opts.categoryId) return [];
  if (placement === "CART" && !opts.cartOfferIds?.length) return [];
  const { orderingMode } = await import("@/server/allocation/mode");
  if ((await orderingMode(ctx)) === "FIRINGI") return [];
  const today = dayOf(now);
  let campaigns = await prisma.adCampaign.findMany({
    where: { placement, status: "ACTIVE", startsOn: { lte: today }, OR: [{ endsOn: null }, { endsOn: { gte: today } }], vendorCompanyId: { not: ctx.company.id } },
    orderBy: { createdAt: "asc" },
  });
  if (!campaigns.length) return [];
  // supplier switches, prepaid balances, budgets
  const vendorIds = [...new Set(campaigns.map((c) => c.vendorCompanyId))];
  const [features, accounts, todayStats, totals] = await Promise.all([
    prisma.companyFeature.findMany({ where: { companyId: { in: vendorIds }, key: "ADS" } }),
    prisma.adAccount.findMany({ where: { companyId: { in: vendorIds } } }),
    prisma.adStatDay.findMany({ where: { day: today, campaignId: { in: campaigns.map((c) => c.id) } } }),
    prisma.adCharge.groupBy({ by: ["campaignId"], where: { campaignId: { in: campaigns.filter((c) => c.totalBudget).map((c) => c.id) } }, _sum: { amount: true } }),
  ]);
  const off = new Set(features.filter((f) => !f.enabled).map((f) => f.companyId));
  const acc = new Map(accounts.map((a) => [a.companyId, a]));
  const costToday = new Map(todayStats.map((st) => [st.campaignId, D(st.cost)]));
  const spent = new Map(totals.map((t) => [t.campaignId, D(t._sum.amount)]));
  campaigns = campaigns.filter((c) => {
    if (off.has(c.vendorCompanyId)) return false;
    const a = acc.get(c.vendorCompanyId);
    if (c.pricing === "CPC") {
      if (a?.billing === "PREPAID" && !D(a.balance).gte(D(c.cpcBid))) return false;
      if ((costToday.get(c.id) ?? new Decimal(0)).plus(D(c.cpcBid)).gt(D(c.dailyBudget))) return false;
      if (c.totalBudget && (spent.get(c.id) ?? new Decimal(0)).plus(D(c.cpcBid)).gt(D(c.totalBudget))) return false;
    }
    return true;
  });
  // DAILY bookings are paid for the day before they show (idempotent; the hourly job does it too)
  const daily: CampaignRow[] = [];
  for (const c of campaigns.filter((x) => x.pricing === "DAILY")) if (await chargeDay(c, today)) daily.push(c);
  const cpc = campaigns.filter((c) => c.pricing === "CPC").sort((a, b) => D(b.cpcBid).cmp(D(a.cpcBid)) || a.createdAt.getTime() - b.createdAt.getTime());
  const ranked = [...daily, ...cpc];
  if (!ranked.length) return [];

  const { presentOffers } = await import("@/server/data/catalogue-buyer");
  const exclude = new Set([...(opts.excludeOfferIds ?? []), ...(opts.cartOfferIds ?? [])]);
  const allOffers = [...new Set(ranked.flatMap((c) => c.offerIds))].filter((o) => !exclude.has(o));
  let visible = await presentOffers(ctx, allOffers);
  visible = visible.filter((i) => i.available > 0 && i.price);
  const byId = new Map(visible.map((i) => [i.offerId, i]));
  let eligible: (c: CampaignRow) => string[];
  if (placement === "SEARCH") {
    const q = opts.q!.trim().toLowerCase();
    const matching = new Set((await presentOffers(ctx, [...byId.keys()], { matching: opts.q })).map((i) => i.offerId));
    eligible = (c) => (c.keywords.some((k) => q.includes(k) || k.includes(q)) ? c.offerIds : c.offerIds.filter((o) => matching.has(o)));
  } else if (placement === "CATEGORY") {
    const ancestorsOf = await categoryAncestors();
    const inPage = new Set((await presentOffers(ctx, [...byId.keys()], { categoryIds: [opts.categoryId!] })).map((i) => i.offerId));
    const lineage = new Set([opts.categoryId!, ...ancestorsOf(opts.categoryId!)]);
    eligible = (c) => (c.categoryId ? (lineage.has(c.categoryId) ? c.offerIds : []) : c.offerIds.filter((o) => inPage.has(o)));
  } else if (placement === "CART") {
    const cart = await prisma.vendorOffer.findMany({ where: { id: { in: opts.cartOfferIds } }, select: { packaging: { select: { variant: { select: { product: { select: { categoryId: true } } } } } } } });
    const cats = cart.map((o) => o.packaging.variant.product.categoryId);
    const related = new Set((await presentOffers(ctx, [...byId.keys()], { categoryIds: cats })).map((i) => i.offerId));
    eligible = (c) => c.offerIds.filter((o) => related.has(o));
  } else eligible = (c) => c.offerIds;

  const out: SponsoredItem[] = [];
  const used = new Set<string>();
  for (const c of ranked) {
    if (out.length >= rule.slots) break;
    const offerId = eligible(c).find((o) => byId.has(o) && !used.has(o));
    if (!offerId) continue;
    used.add(offerId);
    out.push({ campaignId: c.id, placement, item: byId.get(offerId)!, href: `/api/ads/click?c=${c.id}&o=${offerId}` });
  }
  if (out.length) {
    const values = out.map((o) => `('${o.campaignId}', '${isoDay(today)}'::date, 1, 0, 0)`).join(",");
    await prisma.$executeRawUnsafe(`INSERT INTO "AdStatDay" ("campaignId", day, impressions, clicks, cost) VALUES ${values}
      ON CONFLICT ("campaignId", day) DO UPDATE SET impressions = "AdStatDay".impressions + 1`);
  }
  return out;
}

/**
 * A buyer clicked a sponsored product: counted, and charged for a per-click campaign — not again for the
 * same buyer within the repeat window, never above the bid or the remaining budget / prepaid balance.
 * Returns where to send the buyer (the product page).
 */
export async function recordClick(ctx: Ctx, campaignId: string, offerId: string, now = new Date()) {
  const fallback = `/buy/catalogue/offers/${encodeURIComponent(offerId)}`;
  if (!["CUSTOMER", "WHOLESALER"].includes(ctx.company.type)) return { href: fallback, charged: "0" };
  const c = await prisma.adCampaign.findUnique({ where: { id: campaignId } });
  if (!c || !c.offerIds.includes(offerId)) return { href: fallback, charged: "0" };
  const today = dayOf(now);
  const s = await adsSettings();
  let charged = new Decimal(0);
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`INSERT INTO "AdStatDay" ("campaignId", day, impressions, clicks, cost) VALUES (${c.id}, ${today}, 0, 1, 0)
      ON CONFLICT ("campaignId", day) DO UPDATE SET clicks = "AdStatDay".clicks + 1`;
    if (c.pricing !== "CPC" || c.status !== "ACTIVE" || c.vendorCompanyId === ctx.company.id) return;
    const since = new Date(now.getTime() - s.clickDedupeMinutes * 60_000);
    if (await tx.adCharge.findFirst({ where: { campaignId: c.id, buyerCompanyId: ctx.company.id, kind: "CLICK", createdAt: { gte: since } } })) return;
    await account(tx, c.vendorCompanyId);
    const [a] = await tx.$queryRaw<{ balance: string; billing: AdBilling }[]>`SELECT balance::text, billing::text AS billing FROM "AdAccount" WHERE "companyId" = ${c.vendorCompanyId} FOR UPDATE`;
    const [st] = await tx.$queryRaw<{ cost: string }[]>`SELECT cost::text FROM "AdStatDay" WHERE "campaignId" = ${c.id} AND day = ${today} FOR UPDATE`;
    let amount = D(c.cpcBid);
    amount = Decimal.min(amount, D(c.dailyBudget).minus(D(st?.cost)));
    if (c.totalBudget) amount = Decimal.min(amount, D(c.totalBudget).minus(D((await tx.adCharge.aggregate({ where: { campaignId: c.id }, _sum: { amount: true } }))._sum.amount)));
    const balance = D(a.balance);
    const prepaid = balance.gt(0);
    if (prepaid) amount = Decimal.min(amount, balance);
    else if (a.billing === "PREPAID") amount = new Decimal(0);
    amount = r2(amount);
    if (amount.lte(0)) return;
    if (prepaid) await tx.adAccount.update({ where: { companyId: c.vendorCompanyId }, data: { balance: balance.minus(amount).toFixed(2) } });
    await tx.adCharge.create({ data: { campaignId: c.id, companyId: c.vendorCompanyId, kind: "CLICK", amount: amount.toFixed(2), day: today, buyerCompanyId: ctx.company.id, offerId, prepaid } });
    await tx.$executeRaw`UPDATE "AdStatDay" SET cost = cost + ${amount.toFixed(2)}::numeric WHERE "campaignId" = ${c.id} AND day = ${today}`;
    charged = amount;
    // used up its total budget → finished
    if (c.totalBudget && D((await tx.adCharge.aggregate({ where: { campaignId: c.id }, _sum: { amount: true } }))._sum.amount).gte(D(c.totalBudget).minus(0.004))) {
      await tx.adCampaign.update({ where: { id: c.id }, data: { status: "ENDED", pausedReason: "BUDGET" } });
    }
  });
  const fresh = await prisma.adCampaign.findUnique({ where: { id: c.id }, select: { status: true, pausedReason: true } });
  if (charged.gt(0) && fresh?.status === "ENDED" && fresh.pausedReason === "BUDGET") {
    const { notify } = await import("@/server/notify/dispatch");
    await notify("ads.stopped", [{ companyId: c.vendorCompanyId, link: `/vendor/ads/${c.id}` }], { campaign: c.name, reason: "BUDGET" }).catch(() => null);
  }
  return { href: fallback, charged: charged.toFixed(2) };
}

// ── invoicing, netting, prepaid ─────────────────────────────────────────────

const MONTHS_PT = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/**
 * Monthly ad invoices: every charge not paid from a prepaid balance and not invoiced yet, up to (not
 * including) `upTo` — by default the first day of this month. One invoice per supplier, one line per
 * campaign. PAYOUT suppliers' invoices are then settled against what FIRINGI owes them.
 */
export async function invoiceAdCharges(opts: { upTo?: Date; companyId?: string; actorUserId?: string | null } = {}, now = new Date()) {
  const upTo = opts.upTo ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const s = await adsSettings();
  const groups = await prisma.adCharge.groupBy({ by: ["companyId"], where: { invoiceId: null, prepaid: false, day: { lt: upTo }, ...(opts.companyId ? { companyId: opts.companyId } : {}) }, _sum: { amount: true } });
  const out: { companyId: string; invoiceId: string; number: string | null; gross: string; netted: string }[] = [];
  const { issueServiceInvoice } = await import("@/server/invoicing/service");
  for (const g of groups) {
    if (!D(g._sum.amount).gt(0)) continue;
    const res = await prisma.$transaction(async (tx) => {
      const charges = await tx.adCharge.findMany({ where: { companyId: g.companyId, invoiceId: null, prepaid: false, day: { lt: upTo } }, include: { campaign: { select: { name: true, placement: true, pricing: true } } }, orderBy: { day: "asc" } });
      if (!charges.length) return null;
      const from = charges[0].day, to = charges[charges.length - 1].day;
      const per = new Map<string, { name: string; placement: AdPlacement; pricing: AdPricing; amount: Decimal; n: number }>();
      for (const ch of charges) {
        const cur = per.get(ch.campaignId) ?? { name: ch.campaign.name, placement: ch.campaign.placement, pricing: ch.campaign.pricing, amount: new Decimal(0), n: 0 };
        cur.amount = cur.amount.plus(D(ch.amount)); cur.n++;
        per.set(ch.campaignId, cur);
      }
      const period = from.getUTCMonth() === to.getUTCMonth() && from.getUTCFullYear() === to.getUTCFullYear() ? `${MONTHS_PT[from.getUTCMonth()]} ${from.getUTCFullYear()}` : `${isoDay(from)} a ${isoDay(to)}`;
      const acc = await account(tx, g.companyId);
      const inv = await issueServiceInvoice(tx, {
        recipientCompanyId: g.companyId, docType: "INVOICE", dueDays: s.invoiceDueDays, actorUserId: opts.actorUserId ?? null,
        lines: [...per.values()].map((p) => ({ description: `Publicidade FIRINGI — ${p.name} (${PLACE_PT[p.placement]}), ${period}: ${p.n} ${p.pricing === "CPC" ? (p.n === 1 ? "clique" : "cliques") : p.n === 1 ? "dia" : "dias"}`, net: p.amount })),
      });
      await tx.adCharge.updateMany({ where: { id: { in: charges.map((c) => c.id) } }, data: { invoiceId: inv.id } });
      await tx.adInvoice.create({ data: { companyId: g.companyId, invoiceId: inv.id, kind: "MONTH", billing: acc.billing, periodStart: from, periodEnd: to, gross: inv.grossTotal } });
      return { inv, billing: acc.billing };
    });
    if (!res) continue;
    const { kickFiscalQueue } = await import("@/server/invoicing/fiscal");
    kickFiscalQueue();
    let netted = new Decimal(0);
    if (res.billing === "PAYOUT") netted = await netAdInvoices(g.companyId, opts.actorUserId ?? null);
    out.push({ companyId: g.companyId, invoiceId: res.inv.id, number: res.inv.fullNumber, gross: res.inv.grossTotal.toString(), netted: netted.toFixed(2) });
  }
  return out;
}

/** Open (approved, unpaid) supplier invoices FIRINGI has to pay, oldest first, with what's still open. */
async function openVendorInvoices(tx: Tx, companyId: string) {
  const rows = await tx.vendorInvoice.findMany({ where: { vendorCompanyId: companyId, status: "APPROVED", docType: { not: "CREDIT_NOTE" } }, orderBy: { issueDate: "asc" }, include: { paymentAllocations: { where: { payment: { status: "CONFIRMED" } }, select: { amount: true } } } });
  return rows.map((r) => ({ id: r.id, number: r.externalNumber, open: D(r.grossTotal).minus(r.paymentAllocations.reduce((a, x) => a.plus(D(x.amount)), new Decimal(0))) })).filter((r) => r.open.gt(0.004));
}

/**
 * PAYOUT suppliers: settle their open ad invoices against what FIRINGI owes them — recorded as a
 * confirmed inbound payment (to the ad invoice) and an outbound payment of the same amount (to their
 * invoices), reference "Compensação". Whatever can't be settled yet waits for the next supplier invoice.
 */
export async function netAdInvoices(companyId: string, actorUserId: string | null) {
  const { openAmounts } = await import("@/server/payments/service");
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "companyId" FROM "AdAccount" WHERE "companyId" = ${companyId} FOR UPDATE`;
    const adInv = await tx.adInvoice.findMany({ where: { companyId, billing: "PAYOUT", kind: "MONTH" }, orderBy: { createdAt: "asc" } });
    const open = await openAmounts(adInv.map((a) => a.invoiceId), tx);
    let total = new Decimal(0);
    for (const a of adInv) {
      let need = open.get(a.invoiceId) ?? new Decimal(0);
      if (need.lte(0)) continue;
      const vendorOpen = await openVendorInvoices(tx, companyId);
      const allocs: { vendorInvoiceId: string; amount: Decimal }[] = [];
      for (const v of vendorOpen) {
        if (need.lte(0)) break;
        const take = Decimal.min(need, v.open);
        allocs.push({ vendorInvoiceId: v.id, amount: take });
        need = need.minus(take);
      }
      const amount = allocs.reduce((s, x) => s.plus(x.amount), new Decimal(0));
      if (amount.lte(0)) break;
      const inv = await tx.invoice.findUniqueOrThrow({ where: { id: a.invoiceId }, select: { fullNumber: true } });
      const reference = `Compensação ${inv.fullNumber ?? ""}`.trim();
      await tx.payment.create({ data: { companyId, direction: "INBOUND", method: "OTHER", amount: amount.toFixed(2), reference, status: "CONFIRMED", paidAt: new Date(), recordedById: actorUserId, allocations: { create: [{ invoiceId: a.invoiceId, amount: amount.toFixed(2) }] } } });
      await tx.payment.create({ data: { companyId, direction: "OUTBOUND", method: "OTHER", amount: amount.toFixed(2), reference, status: "CONFIRMED", paidAt: new Date(), recordedById: actorUserId, allocations: { create: allocs.map((x) => ({ vendorInvoiceId: x.vendorInvoiceId, amount: x.amount.toFixed(2) })) } } });
      await writeAudit({ actorUserId, actorCompanyId: null, action: "ads.netted", entityType: "Invoice", entityId: a.invoiceId, after: { amount: amount.toFixed(2), vendorInvoices: allocs.map((x) => x.vendorInvoiceId) } }, tx);
      total = total.plus(amount);
    }
    return total;
  });
}

/**
 * FIRINGI received a prepaid top-up (gross, incl. VAT where it applies): an invoice-receipt is issued,
 * the payment recorded against it, and the net amount added to the ad balance.
 */
export async function recordTopUp(ctx: Ctx, companyId: string, input: { gross: number; method: "BANK_TRANSFER" | "CARD" | "MB_WAY" | "MULTIBANCO" | "OTHER"; reference?: string | null }) {
  if (!staffFinance(ctx)) throw new ForbiddenError();
  const gross = new Decimal(input.gross);
  if (!(gross.gt(0) && gross.lte(100_000))) throw new ValidationError("Amount: more than 0 €, up to 100 000 €.", { gross: ["Invalid"] });
  const co = await prisma.company.findFirst({ where: { id: companyId, type: { in: ["WHOLESALER", "DISTRIBUTOR"] } } });
  if (!co) throw new NotFoundError("Supplier");
  const { issueServiceInvoice } = await import("@/server/invoicing/service");
  const res = await prisma.$transaction(async (tx) => {
    // the net that, with the VAT this supplier is invoiced, makes the amount received
    const probe = await issueServiceInvoice(tx, { recipientCompanyId: companyId, docType: "INVOICE_RECEIPT", dueDays: 0, actorUserId: ctx.user.id, lines: [{ description: "Publicidade FIRINGI — carregamento de saldo pré-pago", net: await netFor(tx, companyId, gross) }] });
    const acc = await account(tx, companyId);
    const net = D(probe.netTotal);
    await tx.payment.create({ data: { companyId, direction: "INBOUND", method: input.method, amount: D(probe.grossTotal).toFixed(2), reference: input.reference?.trim() || `ADS ${probe.fullNumber}`, status: "CONFIRMED", paidAt: new Date(), recordedById: ctx.user.id, allocations: { create: [{ invoiceId: probe.id, amount: D(probe.grossTotal).toFixed(2) }] } } });
    await tx.adAccount.update({ where: { companyId }, data: { balance: D(acc.balance).plus(net).toFixed(2) } });
    await tx.adInvoice.create({ data: { companyId, invoiceId: probe.id, kind: "TOPUP", billing: acc.billing, gross: probe.grossTotal } });
    return { invoice: probe, net };
  });
  const { kickFiscalQueue } = await import("@/server/invoicing/fiscal");
  kickFiscalQueue();
  // campaigns paused for lack of balance can run again
  await prisma.adCampaign.updateMany({ where: { vendorCompanyId: companyId, status: "PAUSED", pausedReason: "BALANCE" }, data: { status: "ACTIVE", pausedReason: null } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "ads.topup", entityType: "Company", entityId: companyId, after: { gross: gross.toFixed(2), net: res.net.toFixed(2), invoice: res.invoice.fullNumber } });
  return { number: res.invoice.fullNumber, net: res.net.toFixed(2), gross: res.invoice.grossTotal.toString() };
}

/** Net part of a gross amount at the VAT rate FIRINGI would invoice this supplier for a service. */
async function netFor(tx: Tx, companyId: string, gross: Decimal) {
  const co = await tx.company.findUniqueOrThrow({ where: { id: companyId } });
  const le = await tx.legalEntity.findFirst({ where: { countryId: co.countryId, isActive: true } });
  if (!le) return gross; // reverse charge: no VAT on FIRINGI's invoice
  const r = await tx.taxRate.findFirst({ where: { countryId: le.countryId, regionId: null, taxCategory: { code: "STANDARD" }, validFrom: { lte: new Date() }, OR: [{ validTo: null }, { validTo: { gte: new Date() } }] }, orderBy: { validFrom: "desc" } });
  return r2(gross.div(D(r?.rate).div(100).plus(1)));
}

/** FIRINGI sets how it collects from this supplier (as agreed with them). */
export async function setAdBilling(ctx: Ctx, companyId: string, billing: AdBilling) {
  if (!staffFinance(ctx) && !staffManage(ctx)) throw new ForbiddenError();
  if (!["PAYOUT", "PREPAID", "INVOICE"].includes(billing)) throw new ValidationError("Choose how FIRINGI collects.");
  const co = await prisma.company.findFirst({ where: { id: companyId, type: { in: ["WHOLESALER", "DISTRIBUTOR"] } } });
  if (!co) throw new NotFoundError("Supplier");
  const cur = await account(prisma, companyId);
  const row = await prisma.adAccount.update({ where: { companyId }, data: { billing } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "ads.billing_changed", entityType: "Company", entityId: companyId, before: { billing: cur.billing }, after: { billing } });
  return row;
}

// ── the hourly job ──────────────────────────────────────────────────────────

/** Booked days charged, finished campaigns ended, low balances warned, last month invoiced, PAYOUT invoices settled. */
export async function runAdsJob(now = new Date()) {
  const today = dayOf(now);
  const s = await adsSettings();
  const ended = await prisma.adCampaign.updateMany({ where: { status: { in: ["ACTIVE", "PAUSED"] }, endsOn: { lt: today } }, data: { status: "ENDED" } });
  let charged = 0, stopped = 0;
  const { notify } = await import("@/server/notify/dispatch");
  for (const c of await prisma.adCampaign.findMany({ where: { status: "ACTIVE", pricing: "DAILY", startsOn: { lte: today }, OR: [{ endsOn: null }, { endsOn: { gte: today } }] } })) {
    if (await chargeDay(c, today)) charged++;
    else {
      stopped++;
      await prisma.adCampaign.update({ where: { id: c.id }, data: { status: "PAUSED", pausedReason: "BALANCE" } });
      await notify("ads.stopped", [{ companyId: c.vendorCompanyId, link: "/vendor/ads/billing" }], { campaign: c.name, reason: "BALANCE" }).catch(() => null);
    }
  }
  // low prepaid balance (once a day per supplier)
  const low = await prisma.adAccount.findMany({ where: { billing: "PREPAID", balance: { lte: s.lowBalance } } });
  let warned = 0;
  for (const a of low) {
    if (!(await prisma.adCampaign.count({ where: { vendorCompanyId: a.companyId, status: "ACTIVE" } }))) continue;
    const key = `ads.low:${a.companyId}:${isoDay(today)}`;
    const exists = await prisma.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key } });
    if (exists) continue;
    await prisma.setting.create({ data: { scope: "GLOBAL", key, value: true } });
    await notify("ads.low_balance", [{ companyId: a.companyId, link: "/vendor/ads/billing" }], { balance: D(a.balance).toFixed(2) }).catch(() => null);
    warned++;
  }
  const invoices = await invoiceAdCharges({}, now);
  // PAYOUT invoices not fully settled yet: try again (new supplier invoices may have been approved)
  let netted = new Decimal(0);
  for (const g of await prisma.adInvoice.groupBy({ by: ["companyId"], where: { billing: "PAYOUT", kind: "MONTH" } })) netted = netted.plus(await netAdInvoices(g.companyId, null));
  return { ended: ended.count, charged, stopped, warned, invoiced: invoices.length, netted: netted.toFixed(2) };
}

// ── reports ─────────────────────────────────────────────────────────────────

async function statsFor(campaignIds: string[], since?: Date) {
  const rows = await prisma.adStatDay.groupBy({ by: ["campaignId"], where: { campaignId: { in: campaignIds }, ...(since ? { day: { gte: since } } : {}) }, _sum: { impressions: true, clicks: true, cost: true } });
  return new Map(rows.map((r) => [r.campaignId, { impressions: r._sum.impressions ?? 0, clicks: r._sum.clicks ?? 0, cost: D(r._sum.cost) }]));
}

/** Orders of the campaign's products placed by buyers within 7 days after they clicked its ad. */
async function ordersAfterClick(campaignIds: string[]) {
  if (!campaignIds.length) return new Map<string, { orders: number; revenue: Decimal }>();
  const rows = await prisma.$queryRaw<{ campaignId: string; orders: bigint; revenue: string }[]>`
    SELECT c."campaignId", COUNT(DISTINCT o.id) AS orders, COALESCE(SUM(l."vendorLineNet"), 0)::text AS revenue
    FROM (SELECT DISTINCT "campaignId", "buyerCompanyId", "offerId", MIN("createdAt") AS at FROM "AdCharge" WHERE kind = 'CLICK' AND "campaignId" = ANY(${campaignIds}) GROUP BY 1, 2, 3) c
    JOIN "Order" o ON o."buyerCompanyId" = c."buyerCompanyId" AND o."placedAt" >= c.at AND o."placedAt" <= c.at + interval '7 days' AND o.status <> 'CANCELLED'
    JOIN "OrderLine" l ON l."orderId" = o.id AND l."offerId" = c."offerId"
    GROUP BY c."campaignId"`;
  return new Map(rows.map((r) => [r.campaignId, { orders: Number(r.orders), revenue: D(r.revenue) }]));
}

export async function myAds(ctx: Ctx, now = new Date()) {
  const s = await requireAdvertiser(ctx, false);
  const campaigns = await prisma.adCampaign.findMany({ where: { vendorCompanyId: ctx.company.id }, orderBy: { createdAt: "desc" } });
  const ids = campaigns.map((c) => c.id);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [stats, month, orders, acc] = await Promise.all([statsFor(ids), statsFor(ids, monthStart), ordersAfterClick(ids), account(prisma, ctx.company.id)]);
  const rows = campaigns.map((c) => {
    const st = stats.get(c.id) ?? { impressions: 0, clicks: 0, cost: new Decimal(0) };
    return { ...c, impressions: st.impressions, clicks: st.clicks, cost: st.cost.toFixed(2), ctr: st.impressions ? st.clicks / st.impressions : 0, orders: orders.get(c.id)?.orders ?? 0, revenue: (orders.get(c.id)?.revenue ?? new Decimal(0)).toFixed(2) };
  });
  const spentMonth = [...month.values()].reduce((a, m) => a.plus(m.cost), new Decimal(0));
  return { settings: s, account: { billing: acc.billing, balance: D(acc.balance).toFixed(2) }, spentMonth: spentMonth.toFixed(2), rows };
}

export async function campaignDetail(ctx: Ctx, id: string) {
  const viewer = ctx.company.type === "ADMIN";
  if (viewer && !staffView(ctx)) throw new ForbiddenError();
  if (!viewer) await requireAdvertiser(ctx, false);
  const c = await prisma.adCampaign.findFirst({ where: { id, ...(viewer ? {} : { vendorCompanyId: ctx.company.id }) }, include: { vendor: { select: { legalName: true, tradeName: true } } } });
  if (!c) throw new NotFoundError("Campaign");
  const [days, offers, orders, cat] = await Promise.all([
    prisma.adStatDay.findMany({ where: { campaignId: id }, orderBy: { day: "desc" }, take: 90 }),
    prisma.vendorOffer.findMany({ where: { id: { in: c.offerIds } }, select: { id: true, status: true, packaging: { select: { name: true, variant: { select: { sku: true, product: { select: { name: true } } } } } } } }),
    ordersAfterClick([id]),
    c.categoryId ? prisma.category.findUnique({ where: { id: c.categoryId }, select: { name: true } }) : null,
  ]);
  const tot = days.reduce((a, d) => ({ impressions: a.impressions + d.impressions, clicks: a.clicks + d.clicks, cost: a.cost.plus(D(d.cost)) }), { impressions: 0, clicks: 0, cost: new Decimal(0) });
  return {
    campaign: { ...c, vendorName: c.vendor.tradeName ?? c.vendor.legalName, categoryName: cat?.name ?? null },
    totals: { ...tot, cost: tot.cost.toFixed(2), ctr: tot.impressions ? tot.clicks / tot.impressions : 0, orders: orders.get(id)?.orders ?? 0, revenue: (orders.get(id)?.revenue ?? new Decimal(0)).toFixed(2) },
    days: days.map((d) => ({ day: isoDay(d.day), impressions: d.impressions, clicks: d.clicks, cost: D(d.cost).toFixed(2) })),
    offers: offers.map((o) => ({ id: o.id, status: o.status, sku: o.packaging.variant.sku, name: o.packaging.variant.product.name, pack: o.packaging.name })),
  };
}

/** Supplier: own products on sale (for the campaign form), categories, placement rules. */
export async function campaignOptions(ctx: Ctx) {
  const s = await requireAdvertiser(ctx);
  const [offers, categories] = await Promise.all([
    prisma.vendorOffer.findMany({ where: { vendorCompanyId: ctx.company.id, status: "ACTIVE" }, select: { id: true, packaging: { select: { name: true, variant: { select: { sku: true, product: { select: { name: true } } } } } } }, orderBy: [{ packaging: { variant: { sku: "asc" } } }, { packaging: { unitsPerPack: "asc" } }, { id: "asc" }], take: 500 }),
    prisma.category.findMany({ where: { isActive: true }, select: { id: true, name: true, parentId: true }, orderBy: [{ sortOrder: "asc" }] }),
  ]);
  return { settings: s, offers: offers.map((o) => ({ id: o.id, sku: o.packaging.variant.sku, name: o.packaging.variant.product.name, pack: o.packaging.name })), categories };
}

/** Supplier billing page: method, balance, how to top up, FIRINGI's ad invoices. */
export async function myAdBilling(ctx: Ctx) {
  await requireAdvertiser(ctx, false);
  const acc = await account(prisma, ctx.company.id);
  const invs = await prisma.adInvoice.findMany({ where: { companyId: ctx.company.id }, orderBy: { createdAt: "desc" }, take: 100 });
  const docs = await prisma.invoice.findMany({ where: { id: { in: invs.map((i) => i.invoiceId) } }, select: { id: true, fullNumber: true, issuedAt: true, dueAt: true, grossTotal: true, docType: true } });
  const { openAmounts } = await import("@/server/payments/service");
  const open = await openAmounts(docs.map((d) => d.id));
  const byId = new Map(docs.map((d) => [d.id, d]));
  const le = await prisma.legalEntity.findFirst({ where: { countryId: ctx.company.countryId, isActive: true } }) ?? await prisma.legalEntity.findFirst({ where: { isActive: true } });
  const unbilled = await prisma.adCharge.aggregate({ where: { companyId: ctx.company.id, invoiceId: null, prepaid: false }, _sum: { amount: true } });
  return {
    billing: acc.billing, balance: D(acc.balance).toFixed(2), unbilled: D(unbilled._sum.amount).toFixed(2),
    topUp: { iban: le?.iban ?? null, reference: `ADS-${ctx.company.id.slice(-8).toUpperCase()}` },
    invoices: invs.map((i) => { const d = byId.get(i.invoiceId); return { id: i.invoiceId, kind: i.kind, number: d?.fullNumber ?? null, issuedAt: d?.issuedAt ?? i.createdAt, dueAt: d?.dueAt ?? null, gross: D(d?.grossTotal).toFixed(2), open: (open.get(i.invoiceId) ?? new Decimal(0)).toFixed(2), period: i.periodStart ? `${isoDay(i.periodStart)} – ${isoDay(i.periodEnd!)}` : null }; }),
  };
}

// ── FIRINGI views ───────────────────────────────────────────────────────────

export async function adsOverview(ctx: Ctx, now = new Date()) {
  if (!staffView(ctx)) throw new ForbiddenError();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [s, byStatus, month, invoiced, pending, balance] = await Promise.all([
    adsSettings(),
    prisma.adCampaign.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.adStatDay.aggregate({ where: { day: { gte: monthStart } }, _sum: { impressions: true, clicks: true, cost: true } }),
    prisma.adInvoice.aggregate({ where: { createdAt: { gte: monthStart } }, _sum: { gross: true } }),
    prisma.adCampaign.count({ where: { status: "PENDING" } }),
    prisma.adAccount.aggregate({ _sum: { balance: true } }),
  ]);
  const count = (st: AdStatus) => byStatus.find((b) => b.status === st)?._count._all ?? 0;
  const imp = month._sum.impressions ?? 0, clicks = month._sum.clicks ?? 0;
  return { settings: s, active: count("ACTIVE"), pending, paused: count("PAUSED"), revenueMonth: D(month._sum.cost).toFixed(2), impressions: imp, clicks, ctr: imp ? clicks / imp : 0, invoicedMonth: D(invoiced._sum.gross).toFixed(2), prepaidBalance: D(balance._sum.balance).toFixed(2) };
}

export async function listCampaigns(ctx: Ctx, f: { status?: AdStatus | null } = {}) {
  if (!staffView(ctx)) throw new ForbiddenError();
  const rows = await prisma.adCampaign.findMany({ where: f.status ? { status: f.status } : {}, include: { vendor: { select: { legalName: true, tradeName: true } } }, orderBy: [{ status: "asc" }, { createdAt: "desc" }], take: 500 });
  const stats = await statsFor(rows.map((r) => r.id));
  return rows.map((r) => { const st = stats.get(r.id); return { ...r, vendorName: r.vendor.tradeName ?? r.vendor.legalName, impressions: st?.impressions ?? 0, clicks: st?.clicks ?? 0, cost: (st?.cost ?? new Decimal(0)).toFixed(2) }; });
}

export async function listAdvertisers(ctx: Ctx, now = new Date()) {
  if (!staffView(ctx)) throw new ForbiddenError();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [suppliers, accounts, spend, campaigns, invs, s] = await Promise.all([
    prisma.company.findMany({ where: { type: { in: ["WHOLESALER", "DISTRIBUTOR"] }, status: "APPROVED" }, select: { id: true, legalName: true, tradeName: true, type: true, country: { select: { code: true } } }, orderBy: { legalName: "asc" } }),
    prisma.adAccount.findMany(),
    prisma.adCharge.groupBy({ by: ["companyId"], where: { day: { gte: monthStart } }, _sum: { amount: true } }),
    prisma.adCampaign.groupBy({ by: ["vendorCompanyId"], where: { status: "ACTIVE" }, _count: { _all: true } }),
    prisma.adInvoice.findMany({ select: { companyId: true, invoiceId: true } }),
    adsSettings(),
  ]);
  const { openAmounts } = await import("@/server/payments/service");
  const open = await openAmounts(invs.map((i) => i.invoiceId));
  const openBy = new Map<string, Decimal>();
  for (const i of invs) openBy.set(i.companyId, (openBy.get(i.companyId) ?? new Decimal(0)).plus(open.get(i.invoiceId) ?? 0));
  const acc = new Map(accounts.map((a) => [a.companyId, a]));
  const sp = new Map(spend.map((x) => [x.companyId, D(x._sum.amount)]));
  const act = new Map(campaigns.map((x) => [x.vendorCompanyId, x._count._all]));
  return suppliers.map((c) => ({
    id: c.id, name: c.tradeName ?? c.legalName, type: c.type, country: c.country.code,
    billing: acc.get(c.id)?.billing ?? s.defaultBilling, hasAccount: acc.has(c.id), balance: D(acc.get(c.id)?.balance).toFixed(2),
    spendMonth: (sp.get(c.id) ?? new Decimal(0)).toFixed(2), active: act.get(c.id) ?? 0, open: (openBy.get(c.id) ?? new Decimal(0)).toFixed(2),
  }));
}

export async function listAdInvoices(ctx: Ctx) {
  if (!staffView(ctx)) throw new ForbiddenError();
  const invs = await prisma.adInvoice.findMany({ orderBy: { createdAt: "desc" }, take: 500 });
  const [docs, cos] = await Promise.all([
    prisma.invoice.findMany({ where: { id: { in: invs.map((i) => i.invoiceId) } }, select: { id: true, fullNumber: true, issuedAt: true, grossTotal: true, taxRegime: true } }),
    prisma.company.findMany({ where: { id: { in: [...new Set(invs.map((i) => i.companyId))] } }, select: { id: true, legalName: true, tradeName: true } }),
  ]);
  const { openAmounts } = await import("@/server/payments/service");
  const open = await openAmounts(docs.map((d) => d.id));
  const byId = new Map(docs.map((d) => [d.id, d])), co = new Map(cos.map((c) => [c.id, c.tradeName ?? c.legalName]));
  return invs.map((i) => { const d = byId.get(i.invoiceId); return { id: i.invoiceId, companyId: i.companyId, company: co.get(i.companyId) ?? "", kind: i.kind, billing: i.billing, number: d?.fullNumber ?? null, issuedAt: d?.issuedAt ?? i.createdAt, gross: D(d?.grossTotal).toFixed(2), open: (open.get(i.invoiceId) ?? new Decimal(0)).toFixed(2), reverseCharge: d?.taxRegime === "INTRA_EU_REVERSE_CHARGE" }; });
}
