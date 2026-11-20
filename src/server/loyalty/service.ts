/**
 * Phase 32 — Loyalty & rewards.
 *
 * Customers and wholesalers earn points on delivered goods (net, after discounts, excl. VAT and the
 * delivery fee): points per € × the tier's multiplier × the best bonus campaign. FIRINGI pays for every
 * reward — supplier payouts never change. Points are spent as a discount at checkout (a FIRINGI-funded
 * "€ off the order", like a coupon — see orders/pricing.ts) or turned into a credit note on an unpaid
 * invoice. Tiers follow the last 12 months' spend; inviting another business gives both sides points
 * after its first delivered order; points expire (oldest first) with a reminder before.
 *
 * The ledger (LoyaltyEntry) is append-only; the balance is kept on LoyaltyAccount and can never go
 * below zero (database rule). Automatic entries carry a dedupe key, so the job can run any number of times.
 */
import { randomBytes } from "node:crypto";
import Decimal from "decimal.js";
import type { LoyaltyEntryKind, LoyaltyTier, Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";

type Tx = Prisma.TransactionClient;
const DAY = 86_400_000;
const r2 = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

// ── settings ────────────────────────────────────────────────────────────────

export type TierRule = { minSpend: number; multiplier: number; freeDelivery: boolean; prioritySupport: boolean };
export type LoyaltySettings = {
  enabled: boolean;
  /** Points earned per € of delivered goods (net). */
  pointsPerEuro: number;
  /** € one point is worth when spent (0.01 = 100 points → 1 €). */
  pointValue: number;
  /** Smallest number of points that can be spent at checkout. */
  minRedeem: number;
  /** At most this % of the goods can be paid with points. */
  maxRedeemPct: number;
  /** Smallest number of points that can be turned into a credit note. */
  creditNoteMin: number;
  expiryMonths: number;
  /** Remind this many days before points expire. */
  reminderDays: number;
  tiers: Record<LoyaltyTier, TierRule>;
  referral: { inviter: number; invited: number };
  /** Points only for orders delivered from this day (YYYY-MM-DD) — set the first time loyalty runs, so
   *  switching it on doesn't pay out for old orders. */
  startsOn?: string | null;
};
export const LOYALTY_DEFAULTS: LoyaltySettings = {
  enabled: true, pointsPerEuro: 1, pointValue: 0.01, minRedeem: 500, maxRedeemPct: 50, creditNoteMin: 1000, expiryMonths: 12, reminderDays: 30,
  tiers: {
    BRONZE: { minSpend: 0, multiplier: 1, freeDelivery: false, prioritySupport: false },
    SILVER: { minSpend: 5000, multiplier: 1.25, freeDelivery: false, prioritySupport: false },
    GOLD: { minSpend: 15000, multiplier: 1.5, freeDelivery: true, prioritySupport: true },
  },
  referral: { inviter: 2000, invited: 1000 },
};
const KEY = "loyalty.settings";
export const TIERS: LoyaltyTier[] = ["BRONZE", "SILVER", "GOLD"];
/** System promotion that carries the points discount and the Gold free delivery on orders (never auto-applied). */
export const LOYALTY_PROMOTION_ID = "loyalty-points";

export async function loyaltySettings(): Promise<LoyaltySettings> {
  const row = await prisma.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: KEY } });
  const v = (row?.value ?? {}) as Partial<LoyaltySettings>;
  return { ...LOYALTY_DEFAULTS, ...v, tiers: { ...LOYALTY_DEFAULTS.tiers, ...(v.tiers ?? {}) }, referral: { ...LOYALTY_DEFAULTS.referral, ...(v.referral ?? {}) } };
}

const isStaffManager = (ctx: Ctx) => ctx.company.type === "ADMIN" && can(ctx, "admin.marketing.manage");
const isStaffViewer = (ctx: Ctx) => ctx.company.type === "ADMIN" && can(ctx, ["admin.marketing.view", "admin.marketing.manage"]);

export async function saveLoyaltySettings(ctx: Ctx, input: Partial<LoyaltySettings>) {
  if (!isStaffManager(ctx)) throw new ForbiddenError();
  const cur = await loyaltySettings();
  const next: LoyaltySettings = { ...cur, ...input, tiers: { ...cur.tiers, ...(input.tiers ?? {}) }, referral: { ...cur.referral, ...(input.referral ?? {}) } };
  const bad = (m: string) => { throw new ValidationError(m); };
  if (!(next.pointsPerEuro > 0 && next.pointsPerEuro <= 100)) bad("Points per €: more than 0, up to 100.");
  if (!(next.pointValue > 0 && next.pointValue <= 1)) bad("Value of a point: more than 0 €, up to 1 €.");
  if (!Number.isInteger(next.minRedeem) || next.minRedeem < 1) bad("Minimum points to spend: a whole number, at least 1.");
  if (!(next.maxRedeemPct > 0 && next.maxRedeemPct <= 100)) bad("Maximum share paid with points: 1–100 %.");
  if (!Number.isInteger(next.creditNoteMin) || next.creditNoteMin < 1) bad("Minimum points for a credit note: a whole number, at least 1.");
  if (!Number.isInteger(next.expiryMonths) || next.expiryMonths < 1 || next.expiryMonths > 60) bad("Points expire after 1–60 months.");
  if (!Number.isInteger(next.reminderDays) || next.reminderDays < 1 || next.reminderDays > 90) bad("Reminder: 1–90 days before.");
  for (const t of TIERS) {
    const r = next.tiers[t];
    if (!(r.multiplier >= 1 && r.multiplier <= 5)) bad(`${t}: points multiplier 1–5.`);
    if (!(r.minSpend >= 0)) bad(`${t}: spend can't be negative.`);
  }
  if (next.tiers.BRONZE.minSpend !== 0) bad("Bronze starts at 0 €.");
  if (next.startsOn && !/^\d{4}-\d{2}-\d{2}$/.test(next.startsOn)) bad("Start date: YYYY-MM-DD.");
  if (!(next.tiers.SILVER.minSpend > 0 && next.tiers.GOLD.minSpend > next.tiers.SILVER.minSpend)) bad("Gold needs more spend than Silver, Silver more than 0 €.");
  if (!Number.isInteger(next.referral.inviter) || !Number.isInteger(next.referral.invited) || next.referral.inviter < 0 || next.referral.invited < 0) bad("Referral points: whole numbers, 0 or more.");
  await prisma.setting.upsert({
    where: { scope_scopeId_key: { scope: "GLOBAL", scopeId: "", key: KEY } },
    update: { value: next as unknown as Prisma.InputJsonValue, updatedById: ctx.user.id },
    create: { scope: "GLOBAL", key: KEY, value: next as unknown as Prisma.InputJsonValue, updatedById: ctx.user.id },
  });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "loyalty.settings_changed", entityType: "Setting", entityId: KEY, before: cur, after: next });
  return next;
}

// ── who takes part ──────────────────────────────────────────────────────────

const BUYER_TYPES = ["CUSTOMER", "WHOLESALER"] as const;

/** Loyalty is on for this company: FIRINGI's global switch, a buyer company, and its own switch (Business Features). */
export async function loyaltyOn(companyId: string, s?: LoyaltySettings) {
  const settings = s ?? (await loyaltySettings());
  if (!settings.enabled) return false;
  const c = await prisma.company.findUnique({ where: { id: companyId }, select: { type: true } });
  if (!c || !(BUYER_TYPES as readonly string[]).includes(c.type)) return false;
  const { companyFeatureOn } = await import("@/server/accounting/features");
  return companyFeatureOn(companyId, "LOYALTY");
}

const newCode = () => `F${randomBytes(4).toString("hex").toUpperCase().slice(0, 7)}`;

export async function ensureAccount(tx: Tx | typeof prisma, companyId: string) {
  const a = await tx.loyaltyAccount.findUnique({ where: { companyId } });
  if (a) return a;
  for (let i = 0; i < 5; i++) {
    try { return await tx.loyaltyAccount.create({ data: { companyId, referralCode: newCode() } }); }
    catch (e) { if (!(e instanceof Error && /Unique constraint/.test(e.message)) || /companyId/.test(e.message)) { const again = await tx.loyaltyAccount.findUnique({ where: { companyId } }); if (again) return again; if (i === 4) throw e; } }
  }
  throw new Error("referral code");
}

// ── ledger ──────────────────────────────────────────────────────────────────

type EntryIn = { kind: LoyaltyEntryKind; points: number; orderId?: string | null; invoiceId?: string | null; campaignId?: string | null; dedupeKey?: string | null; note?: string | null; createdById?: string | null; euros?: Decimal | null };

/** Adds points (expire after the configured months). Returns null if the dedupe key was already used. */
export async function addPoints(tx: Tx, companyId: string, e: EntryIn, s: LoyaltySettings) {
  if (!Number.isInteger(e.points) || e.points <= 0) throw new ValidationError("Points must be a positive whole number.");
  if (e.dedupeKey && (await tx.loyaltyEntry.findUnique({ where: { dedupeKey: e.dedupeKey } }))) return null;
  await ensureAccount(tx, companyId);
  const expiresAt = new Date(Date.now() + s.expiryMonths * 30.44 * DAY);
  const row = await tx.loyaltyEntry.create({
    data: { companyId, kind: e.kind, points: e.points, remaining: e.points, expiresAt, orderId: e.orderId ?? null, invoiceId: e.invoiceId ?? null, campaignId: e.campaignId ?? null, dedupeKey: e.dedupeKey ?? null, note: e.note ?? null, createdById: e.createdById ?? null },
  });
  const earned = e.kind === "EARN" || e.kind === "REFERRAL" || e.kind === "BONUS";
  await tx.loyaltyAccount.update({ where: { companyId }, data: { balance: { increment: e.points }, ...(earned ? { lifetimeEarned: { increment: e.points } } : {}) } });
  return row;
}

/** Takes points off — the oldest-expiring first. `clamp`: take what there is (reversals) instead of refusing. */
export async function spendPoints(tx: Tx, companyId: string, e: EntryIn, opts: { clamp?: boolean } = {}) {
  if (!Number.isInteger(e.points) || e.points <= 0) throw new ValidationError("Points must be a positive whole number.");
  if (e.dedupeKey && (await tx.loyaltyEntry.findUnique({ where: { dedupeKey: e.dedupeKey } }))) return null;
  const acc = await ensureAccount(tx, companyId);
  // Lock the account row so two checkouts can't spend the same points.
  await tx.$queryRaw`SELECT 1 FROM "LoyaltyAccount" WHERE "companyId" = ${companyId} FOR UPDATE`;
  const balance = (await tx.loyaltyAccount.findUniqueOrThrow({ where: { companyId: acc.companyId }, select: { balance: true } })).balance;
  const take = opts.clamp ? Math.min(balance, e.points) : e.points;
  if (take > balance) throw new AppError("NOT_ENOUGH_POINTS", `You have ${balance} points — not enough for ${e.points}.`, 409);
  if (take <= 0) return null;
  let left = take;
  const lots = await tx.loyaltyEntry.findMany({ where: { companyId, remaining: { gt: 0 } }, orderBy: [{ expiresAt: "asc" }, { createdAt: "asc" }] });
  for (const lot of lots) {
    if (left <= 0) break;
    const use = Math.min(lot.remaining, left);
    await tx.loyaltyEntry.update({ where: { id: lot.id }, data: { remaining: { decrement: use } } });
    left -= use;
  }
  const row = await tx.loyaltyEntry.create({
    data: { companyId, kind: e.kind, points: -take, orderId: e.orderId ?? null, invoiceId: e.invoiceId ?? null, campaignId: e.campaignId ?? null, dedupeKey: e.dedupeKey ?? null, note: e.note ?? null, createdById: e.createdById ?? null, euros: e.euros ? e.euros.toFixed(2) : null },
  });
  await tx.loyaltyAccount.update({ where: { companyId }, data: { balance: { decrement: take } } });
  return row;
}

// ── tiers ───────────────────────────────────────────────────────────────────

export function tierFor(spend: number, s: LoyaltySettings): LoyaltyTier {
  return spend >= s.tiers.GOLD.minSpend ? "GOLD" : spend >= s.tiers.SILVER.minSpend ? "SILVER" : "BRONZE";
}

/** Delivered goods (net) the company bought in the last 12 months: invoices minus credit notes, delivery fees left out. */
export async function spendLast12m(companyId: string) {
  const since = new Date(Date.now() - 365 * DAY);
  const rows = await prisma.$queryRaw<{ net: string | null }[]>`
    SELECT SUM(CASE WHEN i."docType" = 'CREDIT_NOTE' THEN -l."lineNet" ELSE l."lineNet" END)::text AS net
    FROM "InvoiceLine" l JOIN "Invoice" i ON i.id = l."invoiceId"
    WHERE i."recipientCompanyId" = ${companyId} AND i.status <> 'DRAFT' AND i."issuedAt" >= ${since} AND l."orderLineId" IS NOT NULL`;
  return Math.max(0, Number(rows[0]?.net ?? 0));
}

/** The buyer's perks right now (checkout: Gold free delivery). */
export async function buyerPerks(companyId: string) {
  const s = await loyaltySettings();
  if (!(await loyaltyOn(companyId, s))) return null;
  const a = await prisma.loyaltyAccount.findUnique({ where: { companyId }, select: { tier: true, balance: true } });
  const tier = a?.tier ?? "BRONZE";
  return { tier, balance: a?.balance ?? 0, ...s.tiers[tier], settings: s };
}

// ── earning ─────────────────────────────────────────────────────────────────

type CampaignRow = { id: string; multiplier: Decimal; vendorIds: string[]; categoryIds: string[]; offerIds: string[] };
const campaignMatches = (c: CampaignRow, l: { offerId: string; vendorId: string; categoryId: string }) =>
  (!c.vendorIds.length && !c.categoryIds.length && !c.offerIds.length)
  || c.vendorIds.includes(l.vendorId) || c.categoryIds.includes(l.categoryId) || c.offerIds.includes(l.offerId);

/** Points for one delivered (invoiced) order, the campaign that gave the most, and the goods value. */
export async function pointsForOrder(orderId: string, s: LoyaltySettings, tier: LoyaltyTier) {
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { placedAt: true, sellerCompanyId: true, lines: { select: { id: true, offerId: true, offer: { select: { packaging: { select: { variant: { select: { product: { select: { categoryId: true } } } } } } } } } } } });
  const inv = await prisma.invoice.findFirst({ where: { orderId, docType: "INVOICE", status: { not: "DRAFT" } }, select: { id: true, lines: { where: { orderLineId: { not: null } }, select: { orderLineId: true, lineNet: true } } } });
  if (!inv) return null;
  const campaigns = await prisma.loyaltyCampaign.findMany({ where: { active: true, startsAt: { lte: order.placedAt }, endsAt: { gt: order.placedAt } } });
  const tierMult = new Decimal(s.tiers[tier].multiplier);
  let points = new Decimal(0), goods = new Decimal(0);
  const byCampaign = new Map<string, Decimal>();
  for (const il of inv.lines) {
    const ol = order.lines.find((x) => x.id === il.orderLineId);
    if (!ol) continue;
    const net = new Decimal(il.lineNet.toString());
    goods = goods.plus(net);
    const facts = { offerId: ol.offerId, vendorId: order.sellerCompanyId, categoryId: ol.offer.packaging.variant.product.categoryId };
    const best = campaigns.filter((c) => campaignMatches(c, facts)).sort((a, b) => new Decimal(b.multiplier).comparedTo(new Decimal(a.multiplier)))[0];
    const mult = tierMult.mul(best ? new Decimal(best.multiplier) : 1);
    const p = net.mul(s.pointsPerEuro).mul(mult);
    points = points.plus(p);
    if (best) byCampaign.set(best.id, (byCampaign.get(best.id) ?? new Decimal(0)).plus(p));
  }
  const top = [...byCampaign.entries()].sort((a, b) => b[1].comparedTo(a[1]))[0]?.[0] ?? null;
  return { points: points.floor().toNumber(), goods: r2(goods), campaignId: top, invoiceId: inv.id };
}

/** Credits the points of a delivered, invoiced order (once). Also pays the referral bonus on the first one. */
export async function earnForOrder(orderId: string) {
  const s = await loyaltySettings();
  const o = await prisma.order.findUnique({ where: { id: orderId }, select: { id: true, number: true, status: true, buyerCompanyId: true } });
  if (!o || o.status !== "DELIVERED" || !(await loyaltyOn(o.buyerCompanyId, s))) return null;
  if (await prisma.loyaltyEntry.findUnique({ where: { dedupeKey: `EARN:${orderId}` } })) return null;
  const start = await programmeStart(s);
  const delivered = await prisma.orderStatusHistory.findFirst({ where: { orderId, toStatus: "DELIVERED" }, orderBy: { at: "desc" }, select: { at: true } });
  if (delivered && delivered.at < start) return null; // delivered before the programme started
  const acc = await ensureAccount(prisma, o.buyerCompanyId);
  const p = await pointsForOrder(orderId, s, acc.tier);
  if (!p) return null; // not invoiced yet — the job tries again
  const earned = await prisma.$transaction(async (tx) => {
    const row = p.points > 0
      ? await addPoints(tx, o.buyerCompanyId, { kind: "EARN", points: p.points, orderId, invoiceId: p.invoiceId, campaignId: p.campaignId, dedupeKey: `EARN:${orderId}`, note: `Order ${o.number}` }, s)
      : await tx.loyaltyEntry.create({ data: { companyId: o.buyerCompanyId, kind: "EARN", points: 0, orderId, dedupeKey: `EARN:${orderId}`, note: `Order ${o.number} (no points)` } }).catch(() => null);
    return row;
  });
  await rewardReferral(o.buyerCompanyId, s);
  return earned;
}

/** After the invited business's first delivered order, both sides get their bonus (once). */
async function rewardReferral(companyId: string, s: LoyaltySettings) {
  const acc = await prisma.loyaltyAccount.findUnique({ where: { companyId }, include: { company: { select: { legalName: true, tradeName: true } }, referredBy: { include: { company: { select: { legalName: true, tradeName: true } } } } } });
  if (!acc?.referredById || acc.referralRewardedAt || !acc.referredBy) return;
  if (!(await loyaltyOn(acc.referredById, s))) return;
  const done = await prisma.$transaction(async (tx) => {
    const claimed = await tx.loyaltyAccount.updateMany({ where: { companyId, referralRewardedAt: null }, data: { referralRewardedAt: new Date() } });
    if (!claimed.count) return false;
    const name = (c: { legalName: string; tradeName: string | null }) => c.tradeName ?? c.legalName;
    if (s.referral.invited > 0) await addPoints(tx, companyId, { kind: "REFERRAL", points: s.referral.invited, dedupeKey: `REFIN:${companyId}`, note: `Welcome bonus — invited by ${name(acc.referredBy!.company)}` }, s);
    if (s.referral.inviter > 0) await addPoints(tx, acc.referredById!, { kind: "REFERRAL", points: s.referral.inviter, dedupeKey: `REFBY:${companyId}`, note: `Invited ${name(acc.company)}` }, s);
    return true;
  });
  if (!done) return;
  const { notify } = await import("@/server/notify/dispatch");
  const nm = acc.company.tradeName ?? acc.company.legalName;
  if (s.referral.inviter > 0) await notify("loyalty.referral", [{ companyId: acc.referredById, link: "/buy/rewards" }], { points: String(s.referral.inviter), company: nm }).catch(() => null);
  if (s.referral.invited > 0) await notify("loyalty.referral", [{ companyId, link: "/buy/rewards" }], { points: String(s.referral.invited), company: acc.referredBy.company.tradeName ?? acc.referredBy.company.legalName }).catch(() => null);
}

/** A business registered with an invitation code: remember who invited it. */
export async function attachReferral(newCompanyId: string, code: string | null | undefined) {
  const c = code?.trim().toUpperCase();
  if (!c) return false;
  const inviter = await prisma.loyaltyAccount.findUnique({ where: { referralCode: c } });
  if (!inviter || inviter.companyId === newCompanyId) return false;
  const acc = await ensureAccount(prisma, newCompanyId);
  if (acc.referredById) return false;
  await prisma.loyaltyAccount.update({ where: { companyId: newCompanyId }, data: { referredById: inviter.companyId } });
  return true;
}

/** Points spent on a cancelled order go back (once) — unless the order was moved to another supplier. */
export async function refundForOrder(orderId: string, settings?: LoyaltySettings) {
  const s = settings ?? (await loyaltySettings());
  const o = await prisma.order.findUnique({ where: { id: orderId }, select: { status: true, number: true } });
  if (!o || o.status !== "CANCELLED") return 0;
  if (await prisma.order.count({ where: { parentOrderId: orderId } })) return 0; // moved: the discount is on the new order
  const entries = await prisma.loyaltyEntry.findMany({ where: { kind: "REDEEM_ORDER", orderId }, select: { id: true, companyId: true, points: true } });
  let n = 0;
  for (const e of entries) {
    const row = await prisma.$transaction((tx) => addPoints(tx, e.companyId, { kind: "REFUND", points: -e.points, orderId, dedupeKey: `REF:${e.id}`, note: `Order ${o.number} cancelled — points given back` }, s));
    if (row) n++;
  }
  return n;
}

// ── job: earn, reverse, refund, expire, remind, tiers ───────────────────────

/** The programme's start day; recorded the first time it is needed. */
async function programmeStart(s: LoyaltySettings, now = new Date()) {
  if (s.startsOn) return new Date(`${s.startsOn}T00:00:00Z`);
  const day = now.toISOString().slice(0, 10);
  const row = await prisma.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: KEY } });
  const value = { ...((row?.value as object) ?? {}), startsOn: day } as Prisma.InputJsonValue;
  await prisma.setting.upsert({ where: { scope_scopeId_key: { scope: "GLOBAL", scopeId: "", key: KEY } }, update: { value }, create: { scope: "GLOBAL", key: KEY, value } });
  s.startsOn = day;
  return new Date(`${day}T00:00:00Z`);
}

export async function runLoyaltyJob(now = new Date()) {
  const s = await loyaltySettings();
  const out = { earned: 0, reversed: 0, refunded: 0, expired: 0, reminded: 0, tiersChanged: 0 };
  if (!s.enabled) return out;
  const start = await programmeStart(s, now);

  // 1. delivered + invoiced orders of the last 120 days (and since the programme started) without points yet
  const since = new Date(Math.max(now.getTime() - 120 * DAY, start.getTime()));
  const orders = await prisma.order.findMany({
    where: { status: "DELIVERED", updatedAt: { gte: since }, buyer: { type: { in: [...BUYER_TYPES] } }, invoices: { some: { docType: "INVOICE", status: { not: "DRAFT" } } } },
    select: { id: true }, take: 2000, orderBy: { updatedAt: "asc" },
  });
  const done = new Set((await prisma.loyaltyEntry.findMany({ where: { dedupeKey: { in: orders.map((o) => `EARN:${o.id}`) } }, select: { dedupeKey: true } })).map((e) => e.dedupeKey));
  for (const o of orders) if (!done.has(`EARN:${o.id}`) && (await earnForOrder(o.id))) out.earned++;

  // 2. goods credited (returns, quality claims, credit notes) → the points earned on them go back
  const earns = await prisma.loyaltyEntry.findMany({ where: { kind: "EARN", points: { gt: 0 }, createdAt: { gte: new Date(now.getTime() - 400 * DAY) }, invoiceId: { not: null } }, select: { companyId: true, points: true, invoiceId: true, orderId: true } });
  const rebateIds = new Set((await prisma.loyaltyEntry.findMany({ where: { kind: "REDEEM_CREDIT", invoiceId: { not: null } }, select: { invoiceId: true } })).map((e) => e.invoiceId));
  for (const e of earns) {
    const cns = await prisma.invoice.findMany({ where: { originalInvoiceId: e.invoiceId!, docType: "CREDIT_NOTE", status: { not: "DRAFT" } }, select: { id: true, lines: { where: { orderLineId: { not: null } }, select: { lineNet: true } } } });
    if (!cns.length) continue;
    const inv = await prisma.invoiceLine.aggregate({ where: { invoiceId: e.invoiceId!, orderLineId: { not: null } }, _sum: { lineNet: true } });
    const total = Number(inv._sum.lineNet ?? 0);
    for (const cn of cns) {
      if (rebateIds.has(cn.id) || !total) continue;
      const credited = cn.lines.reduce((a, l) => a + Number(l.lineNet), 0);
      const back = Math.floor((e.points * credited) / total);
      if (back <= 0) continue;
      const row = await prisma.$transaction((tx) => spendPoints(tx, e.companyId, { kind: "REVERSE", points: back, orderId: e.orderId, invoiceId: cn.id, dedupeKey: `REV:${cn.id}`, note: "Goods credited" }, { clamp: true }));
      if (row) out.reversed++;
    }
  }

  // 3. points spent on an order that was cancelled → given back (not when FIRINGI moved the order
  //    to another supplier: the discount went with it to the new order)
  const spent = await prisma.loyaltyEntry.findMany({ where: { kind: "REDEEM_ORDER", orderId: { not: null }, createdAt: { gte: new Date(now.getTime() - 400 * DAY) } }, select: { orderId: true } });
  const cancelled = await prisma.order.findMany({ where: { id: { in: [...new Set(spent.map((e) => e.orderId!))] }, status: "CANCELLED" }, select: { id: true } });
  for (const o of cancelled) out.refunded += await refundForOrder(o.id, s);

  // 3b. referral bonuses still due (the invited business has earned on a delivered order)
  const due = await prisma.loyaltyAccount.findMany({ where: { referredById: { not: null }, referralRewardedAt: null, entries: { some: { kind: "EARN" } } }, select: { companyId: true } });
  for (const d of due) await rewardReferral(d.companyId, s);

  // 4. expiry
  const lots = await prisma.loyaltyEntry.findMany({ where: { remaining: { gt: 0 }, expiresAt: { lte: now } }, select: { id: true, companyId: true, remaining: true } });
  const byCompany = new Map<string, typeof lots>();
  for (const l of lots) byCompany.set(l.companyId, [...(byCompany.get(l.companyId) ?? []), l]);
  for (const [companyId, ls] of byCompany) {
    await prisma.$transaction(async (tx) => {
      let total = 0;
      for (const l of ls) { const u = await tx.loyaltyEntry.updateMany({ where: { id: l.id, remaining: l.remaining }, data: { remaining: 0 } }); if (u.count) total += l.remaining; }
      if (total <= 0) return;
      await tx.loyaltyEntry.create({ data: { companyId, kind: "EXPIRE", points: -total, note: "Points expired" } });
      await tx.loyaltyAccount.update({ where: { companyId }, data: { balance: { decrement: total } } });
    });
    out.expired++;
  }

  // 5. reminder: points expiring within the reminder window (at most once in 25 days)
  const soon = new Date(now.getTime() + s.reminderDays * DAY);
  const expiring = await prisma.loyaltyEntry.groupBy({ by: ["companyId"], where: { remaining: { gt: 0 }, expiresAt: { gt: now, lte: soon } }, _sum: { remaining: true }, _min: { expiresAt: true } });
  const { notify } = await import("@/server/notify/dispatch");
  for (const g of expiring) {
    const ok = await prisma.loyaltyAccount.updateMany({ where: { companyId: g.companyId, OR: [{ expiryRemindedAt: null }, { expiryRemindedAt: { lt: new Date(now.getTime() - 25 * DAY) } }] }, data: { expiryRemindedAt: now } });
    if (!ok.count) continue;
    await notify("loyalty.expiring", [{ companyId: g.companyId, link: "/buy/rewards" }], { points: String(g._sum.remaining ?? 0), date: g._min.expiresAt!.toISOString().slice(0, 10) }).catch(() => null);
    out.reminded++;
  }

  // 6. tiers from the last 12 months' spend
  const accounts = await prisma.loyaltyAccount.findMany({ select: { companyId: true, tier: true } });
  const buyers = await prisma.company.findMany({ where: { type: { in: [...BUYER_TYPES] }, status: "APPROVED", invoicesReceived: { some: { issuedAt: { gte: new Date(now.getTime() - 365 * DAY) } } } }, select: { id: true } });
  const ids = new Set([...accounts.map((a) => a.companyId), ...buyers.map((b) => b.id)]);
  for (const id of ids) {
    if (!(await loyaltyOn(id, s))) continue;
    const spend = await spendLast12m(id);
    const acc = await ensureAccount(prisma, id);
    const tier = tierFor(spend, s);
    await prisma.loyaltyAccount.update({ where: { companyId: id }, data: { spend12m: spend.toFixed(2), ...(tier !== acc.tier ? { tier, tierUpdatedAt: now } : {}) } });
    if (tier !== acc.tier) {
      out.tiersChanged++;
      if (TIERS.indexOf(tier) > TIERS.indexOf(acc.tier)) await notify("loyalty.tier_up", [{ companyId: id, link: "/buy/rewards" }], { tier: tier[0] + tier.slice(1).toLowerCase() }).catch(() => null);
    }
  }
  return out;
}

// ── the buyer's own view ────────────────────────────────────────────────────

function requireBuyer(ctx: Ctx) {
  if (!(BUYER_TYPES as readonly string[]).includes(ctx.company.type) || !can(ctx, ["buyer.orders.view", "buyer.orders.place", "buyer.invoices.view"])) throw new ForbiddenError();
}

export async function myRewards(ctx: Ctx) {
  requireBuyer(ctx);
  const s = await loyaltySettings();
  const on = await loyaltyOn(ctx.company.id, s);
  if (!on) return { on: false as const, settings: s };
  const acc = await ensureAccount(prisma, ctx.company.id);
  const spend = Number(acc.spend12m);
  const next = acc.tier === "GOLD" ? null : acc.tier === "SILVER" ? "GOLD" as const : "SILVER" as const;
  const [entries, expiring, campaigns, invited] = await Promise.all([
    prisma.loyaltyEntry.findMany({ where: { companyId: ctx.company.id, NOT: { kind: "EARN", points: 0 } }, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.loyaltyEntry.aggregate({ where: { companyId: ctx.company.id, remaining: { gt: 0 }, expiresAt: { lte: new Date(Date.now() + s.reminderDays * DAY) } }, _sum: { remaining: true }, _min: { expiresAt: true } }),
    activeCampaigns(),
    prisma.loyaltyAccount.findMany({ where: { referredById: ctx.company.id }, select: { referralRewardedAt: true, createdAt: true, company: { select: { legalName: true, tradeName: true } } }, orderBy: { createdAt: "desc" } }),
  ]);
  const orderIds = [...new Set(entries.map((e) => e.orderId).filter(Boolean) as string[])];
  const orders = new Map((await prisma.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, number: true } })).map((o) => [o.id, o.number]));
  const invoiceIds = [...new Set(entries.map((e) => e.invoiceId).filter(Boolean) as string[])];
  const invoices = new Map((await prisma.invoice.findMany({ where: { id: { in: invoiceIds } }, select: { id: true, fullNumber: true } })).map((i) => [i.id, i.fullNumber]));
  return {
    on: true as const, settings: s,
    balance: acc.balance, value: r2(new Decimal(acc.balance).mul(s.pointValue)).toFixed(2), lifetimeEarned: acc.lifetimeEarned,
    tier: acc.tier, spend12m: spend.toFixed(2), perks: s.tiers[acc.tier],
    next: next ? { tier: next, minSpend: s.tiers[next].minSpend, missing: Math.max(0, s.tiers[next].minSpend - spend).toFixed(2), progress: Math.min(1, spend / s.tiers[next].minSpend) } : null,
    expiring: expiring._sum.remaining ? { points: expiring._sum.remaining, at: expiring._min.expiresAt } : null,
    referralCode: acc.referralCode,
    invited: invited.map((i) => ({ name: i.company.tradeName ?? i.company.legalName, rewarded: !!i.referralRewardedAt, at: i.createdAt })),
    campaigns,
    entries: entries.map((e) => ({ id: e.id, kind: e.kind, points: e.points, at: e.createdAt, expiresAt: e.points > 0 ? e.expiresAt : null, remaining: e.remaining, order: e.orderId ? orders.get(e.orderId) ?? null : null, orderId: e.orderId, invoice: e.invoiceId ? invoices.get(e.invoiceId) ?? null : null, euros: e.euros?.toString() ?? null, note: e.note })),
  };
}

export async function activeCampaigns(now = new Date()) {
  return prisma.loyaltyCampaign.findMany({ where: { active: true, startsAt: { lte: now }, endsAt: { gt: now } }, orderBy: { endsAt: "asc" }, select: { id: true, name: true, message: true, multiplier: true, endsAt: true, vendorIds: true, categoryIds: true, offerIds: true } });
}

// ── points → credit note ────────────────────────────────────────────────────

/**
 * The buyer turns points into credit: a rebate credit note on its oldest unpaid invoice that is big
 * enough (the value incl. VAT comes off what it owes). FIRINGI pays; suppliers aren't affected.
 */
export async function redeemAsCreditNote(ctx: Ctx, points: number) {
  if (!(BUYER_TYPES as readonly string[]).includes(ctx.company.type) || !can(ctx, ["buyer.invoices.view", "buyer.payments.view"])) throw new ForbiddenError();
  const s = await loyaltySettings();
  if (!(await loyaltyOn(ctx.company.id, s))) throw new AppError("LOYALTY_OFF", "Rewards aren't available for your company.", 403);
  if (!Number.isInteger(points) || points < s.creditNoteMin) throw new ValidationError(`Turn at least ${s.creditNoteMin} points into credit.`);
  const acc = await ensureAccount(prisma, ctx.company.id);
  if (points > acc.balance) throw new AppError("NOT_ENOUGH_POINTS", `You have ${acc.balance} points.`, 409);
  const gross = new Decimal(points).mul(s.pointValue).toDecimalPlaces(2, Decimal.ROUND_DOWN);
  // the oldest unpaid invoice whose open amount (after payments and credit notes) covers it
  const { openAmounts } = await import("@/server/payments/service");
  // page through every open-status invoice, oldest first (a long-standing customer has hundreds, most paid)
  let target: { id: string; fullNumber: string | null } | undefined;
  for (let skip = 0; !target; skip += 200) {
    const invoices = await prisma.invoice.findMany({ where: { recipientCompanyId: ctx.company.id, docType: "INVOICE", status: { in: ["ISSUED", "PARTIALLY_CREDITED"] } }, select: { id: true, fullNumber: true }, orderBy: [{ issuedAt: "asc" }, { id: "asc" }], skip, take: 200 });
    if (!invoices.length) break;
    const open = await openAmounts(invoices.map((i) => i.id));
    target = invoices.find((i) => (open.get(i.id) ?? new Decimal(0)).gte(gross));
  }
  if (!target) throw new AppError("NO_OPEN_INVOICE", "You have no unpaid invoice to take the credit off — use the points in your cart instead.", 409);
  const { rebateCreditNote, REBATE_PREFIX } = await import("@/server/invoicing/service");
  const cn = await prisma.$transaction(async (tx) => {
    const doc = await rebateCreditNote(tx, target.id, { gross, description: REBATE_PREFIX, reason: `${points} pontos de fidelização`, actorUserId: ctx.user.id });
    await spendPoints(tx, ctx.company.id, { kind: "REDEEM_CREDIT", points, invoiceId: doc.id, euros: gross, note: `Credit note on ${target.fullNumber}`, createdById: ctx.user.id });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "loyalty.credit_note", entityType: "Invoice", entityId: doc.id, after: { points, gross: gross.toFixed(2), invoice: target.fullNumber } }, tx);
    return doc;
  });
  (await import("@/server/invoicing/fiscal")).kickFiscalQueue();
  const { notify } = await import("@/server/notify/dispatch");
  await notify("invoice.credit_note", [{ companyId: ctx.company.id, link: "/buy/finance/invoices" }], { document: cn.fullNumber }, { ref: { type: "Invoice", id: cn.id } }).catch(() => null);
  return { id: cn.id, number: cn.fullNumber, gross: gross.toFixed(2), invoice: target.fullNumber };
}

// ── staff ───────────────────────────────────────────────────────────────────

export async function loyaltyOverview(ctx: Ctx) {
  if (!isStaffViewer(ctx)) throw new ForbiddenError();
  const s = await loyaltySettings();
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const [accounts, sums, tiers, month, redeemedEuros] = await Promise.all([
    prisma.loyaltyAccount.count(),
    prisma.loyaltyAccount.aggregate({ _sum: { balance: true, lifetimeEarned: true } }),
    prisma.loyaltyAccount.groupBy({ by: ["tier"], _count: { _all: true } }),
    prisma.loyaltyEntry.groupBy({ by: ["kind"], where: { createdAt: { gte: monthStart } }, _sum: { points: true } }),
    prisma.loyaltyEntry.aggregate({ where: { kind: { in: ["REDEEM_ORDER", "REDEEM_CREDIT"] } }, _sum: { euros: true } }),
  ]);
  const balance = sums._sum.balance ?? 0;
  return {
    settings: s, accounts, balance, liability: r2(new Decimal(balance).mul(s.pointValue)).toFixed(2), lifetimeEarned: sums._sum.lifetimeEarned ?? 0,
    tiers: Object.fromEntries(TIERS.map((t) => [t, tiers.find((x) => x.tier === t)?._count._all ?? 0])) as Record<LoyaltyTier, number>,
    month: Object.fromEntries(month.map((m) => [m.kind, m._sum.points ?? 0])) as Partial<Record<LoyaltyEntryKind, number>>,
    redeemedEuros: Number(redeemedEuros._sum.euros ?? 0).toFixed(2),
  };
}

export async function listMembers(ctx: Ctx, f: { q?: string; tier?: LoyaltyTier } = {}) {
  if (!isStaffViewer(ctx)) throw new ForbiddenError();
  const rows = await prisma.loyaltyAccount.findMany({
    where: { ...(f.tier ? { tier: f.tier } : {}), ...(f.q ? { company: { OR: [{ legalName: { contains: f.q, mode: "insensitive" } }, { tradeName: { contains: f.q, mode: "insensitive" } }] } } : {}) },
    include: { company: { select: { id: true, legalName: true, tradeName: true, type: true, country: { select: { code: true } } } }, referredBy: { select: { company: { select: { legalName: true, tradeName: true } } } }, _count: { select: { referrals: true } } },
    orderBy: { balance: "desc" }, take: 500,
  });
  return rows.map((a) => ({
    companyId: a.companyId, name: a.company.tradeName ?? a.company.legalName, type: a.company.type, country: a.company.country.code, tier: a.tier, balance: a.balance,
    lifetimeEarned: a.lifetimeEarned, spend12m: a.spend12m.toString(), referralCode: a.referralCode, referrals: a._count.referrals,
    referredBy: a.referredBy ? a.referredBy.company.tradeName ?? a.referredBy.company.legalName : null,
  }));
}

export async function memberDetail(ctx: Ctx, companyId: string) {
  if (!isStaffViewer(ctx)) throw new ForbiddenError();
  const a = await prisma.loyaltyAccount.findUnique({ where: { companyId }, include: { company: { select: { legalName: true, tradeName: true, type: true } }, entries: { orderBy: { createdAt: "desc" }, take: 200 } } });
  if (!a) throw new NotFoundError("Loyalty account");
  return a;
}

/** FIRINGI adds or takes points by hand (with a reason; audited). */
export async function adjustPoints(ctx: Ctx, companyId: string, points: number, reason: string) {
  if (!isStaffManager(ctx)) throw new ForbiddenError();
  if (!Number.isInteger(points) || points === 0 || Math.abs(points) > 1_000_000) throw new ValidationError("Points: a whole number, not 0.");
  if (reason.trim().length < 3) throw new ValidationError("Give a reason.");
  const s = await loyaltySettings();
  const c = await prisma.company.findFirst({ where: { id: companyId, type: { in: [...BUYER_TYPES] } }, select: { id: true } });
  if (!c) throw new NotFoundError("Company");
  const row = await prisma.$transaction(async (tx) => {
    const r = points > 0
      ? await addPoints(tx, companyId, { kind: "BONUS", points, note: reason.trim(), createdById: ctx.user.id }, s)
      : await spendPoints(tx, companyId, { kind: "ADJUST", points: -points, note: reason.trim(), createdById: ctx.user.id });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "loyalty.adjusted", entityType: "Company", entityId: companyId, after: { points, reason: reason.trim() } }, tx);
    return r;
  });
  return row;
}

export type CampaignInput = { name: string; message?: Record<string, string> | null; multiplier: number; startsAt: Date; endsAt: Date; vendorIds?: string[]; categoryIds?: string[]; offerIds?: string[] };

export async function saveCampaign(ctx: Ctx, input: CampaignInput, id?: string) {
  if (!isStaffManager(ctx)) throw new ForbiddenError();
  if (input.name.trim().length < 3) throw new ValidationError("Give the campaign a name.");
  if (!(input.multiplier > 1 && input.multiplier <= 10)) throw new ValidationError("Multiplier: more than 1×, up to 10×.");
  if (!(input.endsAt > input.startsAt)) throw new ValidationError("The campaign must end after it starts.");
  const data = {
    name: input.name.trim(), message: input.message ?? undefined, multiplier: input.multiplier.toFixed(2), startsAt: input.startsAt, endsAt: input.endsAt,
    vendorIds: input.vendorIds ?? [], categoryIds: input.categoryIds ?? [], offerIds: input.offerIds ?? [],
  };
  const row = id ? await prisma.loyaltyCampaign.update({ where: { id }, data }) : await prisma.loyaltyCampaign.create({ data: { ...data, createdById: ctx.user.id } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: id ? "loyalty.campaign_changed" : "loyalty.campaign_created", entityType: "LoyaltyCampaign", entityId: row.id, after: data });
  return row;
}

export async function endCampaign(ctx: Ctx, id: string) {
  if (!isStaffManager(ctx)) throw new ForbiddenError();
  const row = await prisma.loyaltyCampaign.update({ where: { id }, data: { active: false, endedAt: new Date() } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "loyalty.campaign_ended", entityType: "LoyaltyCampaign", entityId: id });
  return row;
}

export async function listCampaigns(ctx: Ctx) {
  if (!isStaffViewer(ctx)) throw new ForbiddenError();
  const rows = await prisma.loyaltyCampaign.findMany({ orderBy: { startsAt: "desc" }, take: 200 });
  const pts = await prisma.loyaltyEntry.groupBy({ by: ["campaignId"], where: { campaignId: { in: rows.map((r) => r.id) } }, _sum: { points: true }, _count: { _all: true } });
  return rows.map((r) => ({ ...r, points: pts.find((p) => p.campaignId === r.id)?._sum.points ?? 0, orders: pts.find((p) => p.campaignId === r.id)?._count._all ?? 0 }));
}

/** Suppliers and top categories a campaign can target (staff form). */
export async function campaignOptions(ctx: Ctx) {
  if (!isStaffViewer(ctx)) throw new ForbiddenError();
  const [vendors, categories] = await Promise.all([
    prisma.company.findMany({ where: { type: { in: ["WHOLESALER", "DISTRIBUTOR"] }, status: "APPROVED" }, select: { id: true, legalName: true, tradeName: true }, orderBy: { legalName: "asc" } }),
    prisma.category.findMany({ where: { parentId: null }, select: { id: true, name: true }, orderBy: { sortOrder: "asc" } }),
  ]);
  return {
    vendors: vendors.map((v) => ({ id: v.id, label: v.tradeName ?? v.legalName })),
    categories: categories.map((c) => { const n = (c.name ?? {}) as Record<string, string>; return { id: c.id, label: n.en ?? Object.values(n)[0] ?? c.id }; }),
  };
}
