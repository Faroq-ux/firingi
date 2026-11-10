/**
 * AI recommendations feed + AI activity log.
 *
 * refreshRecommendations() turns the insights into suggestions for FIRINGI staff, each supplier
 * (its own stock / late orders / rising demand) and each buyer (time to reorder). One row per
 * situation (dedupeKey); a situation that went away expires. AI only suggests — accepting does
 * the small, safe step a person would (a CRM call task, a stock notice to the supplier) and
 * dismissing hides it. Runs from the cron route and lazily when a page finds it stale.
 */
import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { ALL_PERMISSION_CODES, PERMISSIONS, type PermissionCode } from "@/server/rbac/permissions";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { notify } from "@/server/notify/dispatch";
import { reasonText, type RecKind } from "@/lib/ai";
import { aiScope, deliveryRisk, demandForecast, marginOpportunities, reorderPredictions, stockPredictions, supplierRecommendations, type Side } from "./insights";

const DAY = 86400_000;

// ── activity log ────────────────────────────────────────────────────────────

export async function logAi(a: { kind: string; ctx?: Ctx | null; summary: string; detail?: unknown; model?: string | null; tokensIn?: number; tokensOut?: number }) {
  return prisma.aiActivity.create({
    data: {
      kind: a.kind, actorUserId: a.ctx && a.ctx.user.id !== "system" ? a.ctx.user.id : null, companyId: a.ctx?.company.id ?? null, summary: a.summary.slice(0, 500),
      detail: (a.detail ?? undefined) as Prisma.InputJsonValue | undefined, model: a.model ?? null, tokensIn: a.tokensIn ?? 0, tokensOut: a.tokensOut ?? 0,
    },
  });
}

export async function listActivity(ctx: Ctx, f: { kind?: string; page?: number } = {}) {
  aiScope(ctx, "STAFF");
  const size = 50, page = Math.max(1, f.page ?? 1);
  const w = f.kind ? { kind: f.kind } : {};
  const [rows, total, usage] = await Promise.all([
    prisma.aiActivity.findMany({ where: w, orderBy: { at: "desc" }, skip: (page - 1) * size, take: size }),
    prisma.aiActivity.count({ where: w }),
    prisma.aiActivity.aggregate({ where: { at: { gt: new Date(Date.now() - 30 * DAY) } }, _sum: { tokensIn: true, tokensOut: true }, _count: { _all: true } }),
  ]);
  const ids = [...new Set(rows.flatMap((r) => [r.actorUserId, r.companyId]).filter((x): x is string => !!x))];
  const [users, companies] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }),
    prisma.company.findMany({ where: { id: { in: ids } }, select: { id: true, legalName: true, tradeName: true } }),
  ]);
  return {
    rows: rows.map((r) => ({ ...r, actor: users.find((u) => u.id === r.actorUserId)?.name ?? (r.actorUserId ? "—" : "FIRINGI AI"), company: (() => { const c = companies.find((x) => x.id === r.companyId); return c ? c.tradeName ?? c.legalName : null; })() })),
    total, page, pages: Math.max(1, Math.ceil(total / size)),
    last30: { events: usage._count._all, tokensIn: usage._sum.tokensIn ?? 0, tokensOut: usage._sum.tokensOut ?? 0 },
  };
}

// ── refresh ─────────────────────────────────────────────────────────────────

/** A read-only staff context for scheduled work (no user; never used to write as someone). */
async function systemCtx(): Promise<Ctx> {
  const admin = await prisma.company.findFirstOrThrow({ where: { type: "ADMIN" }, include: { country: { select: { code: true } } }, orderBy: { createdAt: "asc" } });
  return {
    user: { id: "system", email: "", name: "FIRINGI AI", locale: "en", twoFactor: false }, sessionId: "system", membership: { id: "system", isOwner: false },
    company: { id: admin.id, type: "ADMIN", status: admin.status, legalName: admin.legalName, tradeName: admin.tradeName, countryId: admin.countryId, countryCode: admin.country.code },
    permissions: new Set<PermissionCode>(ALL_PERMISSION_CODES.filter((p) => PERMISSIONS[p].audience === "ADMIN" && (p.endsWith(".view") || p === "admin.allocation.manage"))),
    scopes: [], driver: null, memberships: [],
  };
}

type Rec = { kind: RecKind; audience: "STAFF" | "BUYER" | "VENDOR"; companyId: string | null; subjectType: string | null; subjectId: string | null; dedupeKey: string; title: string; detail: Record<string, unknown>; score: number };
const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const weekKey = (now: Date) => Math.floor(now.getTime() / (7 * DAY));
const monthKey = (now: Date) => now.toISOString().slice(0, 7);

export async function computeRecommendations(now = new Date()): Promise<Rec[]> {
  const sys = await systemCtx();
  const wk = weekKey(now), mo = monthKey(now);
  const [reorders, stock, suppliers, margins, risks, demand] = await Promise.all([
    reorderPredictions(sys, "STAFF", { now, onlyDue: true, dueWithinDays: 1 }),
    stockPredictions(sys, "STAFF", { now, onlyAtRisk: true }),
    supplierRecommendations(sys, { now }),
    marginOpportunities(sys, { now }),
    deliveryRisk(sys, "STAFF", { now }),
    demandForecast(sys, "STAFF", { now, limit: 500 }),
  ]);
  const out: Rec[] = [];
  for (const r of reorders) {
    const detail = { ...r };
    // Buyers see "time to reorder" from the day it is expected; staff from 2 days late.
    out.push({ kind: "REORDER_DUE", audience: "BUYER", companyId: r.buyerId, subjectType: "Company", subjectId: r.sellerId, dedupeKey: `B:REORDER:${r.buyerId}:${r.sellerId}:${r.expected}`, title: `Time to reorder from ${r.seller}`, detail, score: clamp(50 + r.overdueDays * 5) });
    if (r.overdueDays >= 2)
      out.push({ kind: "REORDER_DUE", audience: "STAFF", companyId: null, subjectType: "Company", subjectId: r.buyerId, dedupeKey: `REORDER:${r.buyerId}:${r.sellerId}:${r.expected}`, title: `${r.buyer} is ${r.overdueDays} days late reordering from ${r.seller} (usually every ${r.gapDays} days)`, detail, score: clamp(35 + r.overdueDays * 3 + Math.log10(Math.max(1, r.usualNet)) * 8) });
  }
  for (const s of stock) {
    if (s.dailyUnits <= 0) continue;
    const kind: RecKind = s.status === "LOW" ? "LOW_COVER" : "STOCK_OUT";
    const days = s.status === "OUT" ? "is out of stock" : `runs out in ${s.days} days`;
    out.push({ kind, audience: "VENDOR", companyId: s.vendorId, subjectType: "VendorOffer", subjectId: s.offerId, dedupeKey: `V:STOCK:${s.offerId}:${wk}`, title: `${s.product} (${s.pack}) ${days}`, detail: { ...s }, score: clamp(s.status === "OUT" ? 90 : s.status === "CRITICAL" ? 75 : 50) });
    if (s.status !== "LOW")
      out.push({ kind, audience: "STAFF", companyId: null, subjectType: "VendorOffer", subjectId: s.offerId, dedupeKey: `STOCK:${s.offerId}:${wk}`, title: `${s.vendor}: ${s.product} (${s.pack}) ${days} — selling ${s.dailyUnits}/day`, detail: { ...s }, score: clamp(s.status === "OUT" ? 85 : 65 + Math.min(15, s.dailyUnits)) });
  }
  for (const s of suppliers) {
    if (s.reason === "CHEAPER" && s.weeklySaving < 5) continue;
    out.push({
      kind: "CHEAPER_SUPPLIER", audience: "STAFF", companyId: null, subjectType: "VendorOffer", subjectId: s.currentOfferId, dedupeKey: `SUPPLIER:${s.currentOfferId}:${s.betterOfferId}:${mo}`,
      title: s.reason === "BETTER_SERVICE" ? `${s.product}: ${s.better} is more reliable than ${s.current} at a similar price` : `${s.product}: ${s.better} is €${(s.currentPrice - s.betterPrice).toFixed(2)} cheaper than ${s.current} — about €${s.weeklySaving.toFixed(0)} a week`,
      detail: { ...s }, score: clamp(30 + Math.log10(Math.max(1, s.weeklySaving * 52)) * 12 + (s.reason !== "CHEAPER" ? 10 : 0)),
    });
  }
  for (const m of margins) {
    if (m.yearlyGap < 100 && m.below !== "MIN") continue;
    out.push({ kind: "MARGIN_GAP", audience: "STAFF", companyId: null, subjectType: "VendorOffer", subjectId: m.offerId, dedupeKey: `MARGIN:${m.offerId}:${mo}`, title: `${m.vendor} — ${m.product}: ${m.margin}% margin, ${m.below === "MIN" ? "below the minimum" : "below target"} ${m.goal}% (≈ €${m.yearlyGap.toLocaleString("en")} a year)`, detail: { ...m }, score: clamp((m.below === "MIN" ? 55 : 35) + Math.log10(Math.max(1, m.yearlyGap)) * 9) });
  }
  for (const d of risks) {
    if (d.level === "LOW") continue;
    const staff = d.level === "HIGH";
    const sellerId = (await prisma.order.findUnique({ where: { id: d.orderId }, select: { sellerCompanyId: true } }))?.sellerCompanyId;
    if (sellerId) out.push({ kind: "DELIVERY_RISK", audience: "VENDOR", companyId: sellerId, subjectType: "Order", subjectId: d.orderId, dedupeKey: `V:DELIVERY:${d.orderId}`, title: `${d.number} for ${d.buyer} may be late`, detail: { ...d }, score: d.score });
    if (staff) out.push({ kind: "DELIVERY_RISK", audience: "STAFF", companyId: null, subjectType: "Order", subjectId: d.orderId, dedupeKey: `DELIVERY:${d.orderId}`, title: `${d.number} (${d.seller} → ${d.buyer}): ${d.reasons.map(reasonText).join("; ")}`, detail: { ...d }, score: d.score });
  }
  const vendorOf = new Map((await prisma.vendorOffer.findMany({ where: { id: { in: demand.map((x) => x.offerId) } }, select: { id: true, vendorCompanyId: true } })).map((o) => [o.id, o.vendorCompanyId]));
  for (const d of demand) {
    if (d.trend === null || d.trend < 0.3 || d.nextWeeks < 10) continue;
    const pct = Math.round(d.trend * 100);
    const vId = vendorOf.get(d.offerId);
    if (vId) out.push({ kind: "DEMAND_SURGE", audience: "VENDOR", companyId: vId, subjectType: "VendorOffer", subjectId: d.offerId, dedupeKey: `V:SURGE:${d.offerId}:${wk}`, title: `Demand for ${d.product} (${d.pack}) is rising (+${pct}%)`, detail: { ...d }, score: clamp(40 + pct / 4) });
    out.push({ kind: "DEMAND_SURGE", audience: "STAFF", companyId: null, subjectType: "VendorOffer", subjectId: d.offerId, dedupeKey: `SURGE:${d.offerId}:${wk}`, title: `${d.product} (${d.pack}) from ${d.vendor}: about ${d.nextWeeks} units in the next 4 weeks (+${pct}%)`, detail: { ...d }, score: clamp(30 + pct / 4) });
  }
  return out;
}

export async function refreshRecommendations(now = new Date()) {
  const t0 = Date.now();
  const recs = await computeRecommendations(now);
  const keys = new Set(recs.map((r) => r.dedupeKey));
  const existing = await prisma.aiRecommendation.findMany({ where: { dedupeKey: { in: [...keys] } }, select: { id: true, dedupeKey: true, status: true } });
  const have = new Map(existing.map((e) => [e.dedupeKey, e]));
  const fresh = recs.filter((r) => !have.has(r.dedupeKey));
  await prisma.aiRecommendation.createMany({ data: fresh.map((r) => ({ ...r, detail: r.detail as Prisma.InputJsonValue })), skipDuplicates: true });
  let updated = 0;
  for (const r of recs) {
    const e = have.get(r.dedupeKey);
    if (e?.status !== "OPEN") continue;
    await prisma.aiRecommendation.update({ where: { id: e.id }, data: { title: r.title, detail: r.detail as Prisma.InputJsonValue, score: r.score } });
    updated++;
  }
  const expired = await prisma.aiRecommendation.updateMany({ where: { status: "OPEN", dedupeKey: { notIn: [...keys] } }, data: { status: "EXPIRED" } });
  const byKind: Record<string, number> = {};
  for (const r of recs) byKind[`${r.audience}:${r.kind}`] = (byKind[`${r.audience}:${r.kind}`] ?? 0) + 1;
  const summary = { created: fresh.length, updated, expired: expired.count, ms: Date.now() - t0, byKind };
  await logAi({ kind: "REFRESH", summary: `Insights refreshed: ${fresh.length} new, ${updated} updated, ${expired.count} expired`, detail: summary });
  return summary;
}

/** Refresh when the last one is older than `maxAgeMinutes` (pages call this; cheap when fresh). */
export async function ensureFresh(maxAgeMinutes = 60) {
  const last = await prisma.aiActivity.findFirst({ where: { kind: "REFRESH" }, orderBy: { at: "desc" }, select: { at: true } });
  if (last && Date.now() - last.at.getTime() < maxAgeMinutes * 60_000) return null;
  return refreshRecommendations();
}

// ── list / decide ───────────────────────────────────────────────────────────

export async function listRecommendations(ctx: Ctx, side: Side, f: { kind?: string; status?: "OPEN" | "ACCEPTED" | "DISMISSED" | "EXPIRED" | "ALL"; limit?: number } = {}) {
  aiScope(ctx, side);
  const status = f.status ?? "OPEN";
  return prisma.aiRecommendation.findMany({
    where: { audience: side, ...(side === "STAFF" ? {} : { companyId: ctx.company.id }), ...(f.kind ? { kind: f.kind } : {}), ...(status === "ALL" ? {} : { status }) },
    orderBy: status === "OPEN" ? [{ score: "desc" }, { createdAt: "desc" }] : [{ updatedAt: "desc" }],
    take: f.limit ?? 200,
  });
}

export async function recommendationCounts(ctx: Ctx) {
  aiScope(ctx, "STAFF");
  const rows = await prisma.aiRecommendation.groupBy({ by: ["kind"], where: { audience: "STAFF", status: "OPEN" }, _count: { _all: true } });
  return Object.fromEntries(rows.map((r) => [r.kind, r._count._all])) as Partial<Record<RecKind, number>>;
}

/** Accept (do the suggested small step) or dismiss. Staff suggestions need the AI right; others belong to the company. */
export async function decideRecommendation(ctx: Ctx, id: string, accept: boolean, note?: string | null) {
  const r = await prisma.aiRecommendation.findUnique({ where: { id } });
  if (!r) throw new NotFoundError("Suggestion");
  aiScope(ctx, r.audience);
  if (r.audience !== "STAFF" && r.companyId !== ctx.company.id) throw new ForbiddenError();
  if (r.status !== "OPEN") throw new ValidationError("This suggestion was already handled.");
  const d = r.detail as Record<string, unknown>;
  let result: Record<string, unknown> = {};
  if (accept && r.audience === "STAFF") {
    if (r.kind === "REORDER_DUE" && can(ctx, "admin.crm.manage")) {
      const { createTask } = await import("@/server/services/crm");
      const owner = (await prisma.crmAccount.findUnique({ where: { companyId: String(d.buyerId) }, select: { ownerId: true } }))?.ownerId;
      const t = await createTask(ctx, {
        kind: "FOLLOW_UP", companyId: String(d.buyerId), assigneeId: owner ?? ctx.user.id, dueAt: new Date(),
        title: `Call ${d.buyer}: usual order from ${d.seller} is ${d.overdueDays} days late`,
        notes: `Orders every ${d.gapDays} days; last ${d.lastOrder}. Usual basket: ${(d.basket as { product: string; qty: number }[]).map((b) => `${b.qty} × ${b.product}`).join(", ")}. (AI suggestion)`,
      }).catch((e) => { if (e instanceof ForbiddenError) return null; throw e; });
      if (t) result = { taskId: t.id };
    } else if (r.kind === "STOCK_OUT") {
      const n = await notify("ai.stock_low", [{ companyId: String(d.vendorId), link: "/vendor/products/stock" }], { product: `${d.product} (${d.pack})`, days: d.days === null ? "0" : String(d.days), available: String(d.available) }, { ref: { type: "VendorOffer", id: String(d.offerId) } });
      result = { notified: n.recipients };
    }
  }
  const done = await prisma.aiRecommendation.updateMany({ where: { id, status: "OPEN" }, data: { status: accept ? "ACCEPTED" : "DISMISSED", decidedById: ctx.user.id, decidedAt: new Date(), result: { ...result, note: note?.trim() || null } as Prisma.InputJsonValue } });
  if (!done.count) throw new ValidationError("This suggestion was already handled.");
  await logAi({ kind: accept ? "ACCEPT" : "DISMISS", ctx, summary: `${accept ? "Accepted" : "Dismissed"}: ${r.title}`, detail: { recommendationId: id, kind: r.kind, audience: r.audience, result } });
  return { status: accept ? "ACCEPTED" : "DISMISSED", result };
}

// ── buyer: buy again ────────────────────────────────────────────────────────

/**
 * Puts the usual basket from a supplier into the buyer's cart (quantities rounded to the
 * supplier's minimum and step). Nothing is ordered: the buyer reviews the cart and places it.
 */
export async function buyAgain(ctx: Ctx, sellerId: string, locale = "en") {
  const { addToCart } = await import("@/server/services/cart");
  const { catalogueItem } = await import("@/server/data/catalogue-buyer");
  const row = (await reorderPredictions(ctx, "BUYER", { locale })).find((r) => r.sellerId === sellerId);
  if (!row) throw new NotFoundError("Usual order");
  const added: { offerId: string; qty: number }[] = [], skipped: string[] = [];
  for (const b of row.basket) {
    if (!b.available) { skipped.push(b.product); continue; }
    try {
      const { item } = await catalogueItem(ctx, b.offerId);
      if (item.stockStatus === "OUT") { skipped.push(b.product); continue; }
      const step = Math.max(1, item.qtyStep), min = Math.max(1, item.minOrderQty);
      const qty = Math.max(min, min + Math.ceil(Math.max(0, b.qty - min) / step) * step);
      await addToCart(ctx, b.offerId, qty);
      added.push({ offerId: b.offerId, qty });
    } catch (e) {
      if (e instanceof NotFoundError || e instanceof ValidationError) { skipped.push(b.product); continue; }
      throw e;
    }
  }
  if (added.length) {
    await prisma.aiRecommendation.updateMany({ where: { audience: "BUYER", companyId: ctx.company.id, kind: "REORDER_DUE", subjectId: sellerId, status: "OPEN" }, data: { status: "ACCEPTED", decidedById: ctx.user.id, decidedAt: new Date(), result: { added: added.length } } });
    await logAi({ kind: "ACCEPT", ctx, summary: `Buy again from ${row.seller}: ${added.length} products put in the cart`, detail: { sellerId, added, skipped } });
  }
  return { added: added.length, skipped };
}
