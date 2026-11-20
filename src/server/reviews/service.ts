/**
 * Product reviews & questions (Phase 53). Verified buyers review what they received (one review per product, supplier
 * and business — editable): stars, detail scores, text, up to 3 photos; others vote "helpful" and report. The supplier
 * replies once, in public, and sees insights. Questions are answered by the supplier and FIRINGI (official) and by
 * buyers who bought the product. Posts publish at once; the automatic filter holds those with contact details, links,
 * insults or competitor names for FIRINGI, who hides anything with a reason. Reminders a few days after delivery.
 * Stars on cards, a "4★ and up" filter and sort by rating; an AI summary when an AI is connected.
 * In FIRINGI ordering mode the supplier is never named to the buyer: ratings are shown per product.
 * Every part is FIRINGI's switch (Settings › Reviews), per business type and per business.
 */
import "server-only";
import { cache } from "react";
import type Anthropic from "@anthropic-ai/sdk";
import type { Prisma, PostStatus, ReportKind } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";
import { notify } from "@/server/notify/dispatch";
import { storeUpload } from "@/server/services/storage";
import { orderingMode } from "@/server/allocation/mode";
import { aiSettings, aiTransport } from "@/server/ai/assistant";
import { logAi } from "@/server/ai/feed";
import { pickLocalized } from "@/i18n/config";
import {
  DETAILS, REPORT_REASONS, cleanReviewSettings, cleanText, combineStats, complaints, detailAvg, emptyStat, mergeReviewSettings, monthlyTrend, ratingStat, screen, validScore,
  type BuyerType, type HoldReason, type RatingStat, type ReviewSettings, type SellerType,
} from "@/lib/reviews";

const KEY = "reviews.settings";
const FEATURE = "REVIEWS";
const DAY = 86_400_000;
const PAGE = 10;

// ── settings, switches, access ──────────────────────────────────────────────

export async function reviewSettings(): Promise<ReviewSettings> {
  const row = await prisma.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: KEY } });
  return mergeReviewSettings(row?.value as Partial<ReviewSettings> | null);
}
/** Once per request (cards on a list each ask). */
export const reviewSettingsCached = cache(reviewSettings);

function firingiAdmin(ctx: Ctx) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, "admin.settings.manage")) throw new ForbiddenError();
}
function moderator(ctx: Ctx) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, ["admin.reviews.moderate", "admin.settings.manage"])) throw new ForbiddenError();
}

export async function saveReviewSettings(ctx: Ctx, input: ReviewSettings) {
  firingiAdmin(ctx);
  let v: ReviewSettings;
  try { v = cleanReviewSettings(input); } catch (e) { throw new ValidationError((e as Error).message); }
  const before = await reviewSettings();
  await prisma.setting.upsert({
    where: { scope_scopeId_key: { scope: "GLOBAL", scopeId: "", key: KEY } },
    create: { scope: "GLOBAL", scopeId: "", key: KEY, value: v as unknown as Prisma.InputJsonValue },
    update: { value: v as unknown as Prisma.InputJsonValue },
  });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "reviews.settings_saved", entityType: "Setting", entityId: KEY, before, after: v });
  return v;
}

type Switch = "DEFAULT" | "ON" | "OFF";
async function switches(ids: string[]) {
  const f = ids.length ? await prisma.companyFeature.findMany({ where: { key: FEATURE, companyId: { in: ids } } }) : [];
  return new Map<string, Switch>(f.map((x) => [x.companyId, x.enabled ? "ON" : "OFF"]));
}

export async function setReviewSwitch(ctx: Ctx, companyId: string, state: Switch) {
  firingiAdmin(ctx);
  const co = await prisma.company.findUnique({ where: { id: companyId }, select: { type: true } });
  if (!co || co.type === "ADMIN") throw new NotFoundError("Business");
  if (state === "DEFAULT") await prisma.companyFeature.deleteMany({ where: { companyId, key: FEATURE } });
  else await prisma.companyFeature.upsert({ where: { companyId_key: { companyId, key: FEATURE } }, create: { companyId, key: FEATURE, enabled: state === "ON", updatedById: ctx.user.id }, update: { enabled: state === "ON", updatedById: ctx.user.id } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "reviews.company_switch", entityType: "Company", entityId: companyId, after: { state } });
  await recomputeSellerStats(companyId);
}

export async function reviewSwitches(ctx: Ctx) {
  firingiAdmin(ctx);
  const f = await prisma.companyFeature.findMany({ where: { key: FEATURE }, include: { company: { select: { id: true, legalName: true, tradeName: true, type: true } } } });
  return f.map((x) => ({ companyId: x.companyId, name: x.company.tradeName ?? x.company.legalName, type: x.company.type, state: x.enabled ? ("ON" as const) : ("OFF" as const) }));
}

/** May this business write reviews, ask and answer? (customers and wholesalers, as FIRINGI set) */
export async function buyerAccess(co: { id: string; type: string }, s?: ReviewSettings) {
  const set = s ?? (await reviewSettings());
  if (!set.enabled || (co.type !== "CUSTOMER" && co.type !== "WHOLESALER")) return { on: false, settings: set };
  const sw = (await switches([co.id])).get(co.id) ?? "DEFAULT";
  return { on: sw === "ON" || (sw === "DEFAULT" && set.buyers[co.type as BuyerType]), settings: set };
}

/** Of these suppliers, whose products show reviews? */
export async function showingSellers(ids: string[], s: ReviewSettings): Promise<Set<string>> {
  const out = new Set<string>();
  if (!s.enabled || !ids.length) return out;
  const [cos, sw] = await Promise.all([prisma.company.findMany({ where: { id: { in: ids } }, select: { id: true, type: true } }), switches(ids)]);
  for (const c of cos) {
    const st = sw.get(c.id) ?? "DEFAULT";
    if (st === "ON" || (st === "DEFAULT" && (s.sellers as Record<string, boolean>)[c.type])) out.add(c.id);
  }
  return out;
}

const productName = (name: unknown, locale = "en") => pickLocalized(name as Record<string, string>, locale);
const firingiMode = async (ctx: Ctx) => ctx.company.type === "CUSTOMER" && (await orderingMode(ctx)) === "FIRINGI";

// ── totals ──────────────────────────────────────────────────────────────────

async function recomputeStat(productId: string, sellerCompanyId: string, db: Prisma.TransactionClient | typeof prisma = prisma) {
  const rows = await db.productReview.findMany({ where: { productId, sellerCompanyId, status: "PUBLISHED" }, select: { stars: true, quality: true, value: true, packaging: true, freshness: true } });
  const s = await reviewSettings();
  const shows = (await showingSellers([sellerCompanyId], s)).has(sellerCompanyId);
  if (!rows.length || !shows) { await db.productRatingStat.deleteMany({ where: { productId, sellerCompanyId } }); return; }
  const st = ratingStat(rows);
  const data = { count: st.count, sum: st.sum, avg: st.avg, dist: st.dist, details: st.details as unknown as Prisma.InputJsonValue };
  await db.productRatingStat.upsert({ where: { productId_sellerCompanyId: { productId, sellerCompanyId } }, create: { productId, sellerCompanyId, ...data }, update: data });
}

async function recomputeSellerStats(sellerCompanyId: string) {
  const ps = await prisma.productReview.findMany({ where: { sellerCompanyId }, distinct: ["productId"], select: { productId: true } });
  for (const p of ps) await recomputeStat(p.productId, sellerCompanyId);
}

/** Everything, after FIRINGI changes which business types show reviews. */
export async function recomputeAllStats() {
  const pairs = await prisma.productReview.findMany({ distinct: ["productId", "sellerCompanyId"], select: { productId: true, sellerCompanyId: true } });
  await prisma.productRatingStat.deleteMany({ where: { NOT: { OR: pairs.length ? pairs.map((p) => ({ productId: p.productId, sellerCompanyId: p.sellerCompanyId })) : [{ productId: "-" }] } } });
  for (const p of pairs) await recomputeStat(p.productId, p.sellerCompanyId);
  return pairs.length;
}

const toStat = (r: { count: number; sum: number; dist: number[]; details: unknown }): RatingStat => combineStats([{ count: r.count, sum: r.sum, dist: r.dist, details: r.details as RatingStat["details"] }]);

/**
 * Stars for catalogue cards: per product and supplier, or per product when the supplier is hidden (FIRINGI mode).
 * Key: `${productId}:${sellerId}` or `${productId}:` — empty when FIRINGI switched stars on cards off.
 */
export async function cardRatings(items: { productId: string; sellerId: string | null }[]): Promise<Map<string, { avg: number; count: number }>> {
  const out = new Map<string, { avg: number; count: number }>();
  const s = await reviewSettingsCached();
  if (!s.enabled || !s.parts.reviews || !s.parts.searchStars || !items.length) return out;
  const productIds = [...new Set(items.map((i) => i.productId))];
  const rows = await prisma.productRatingStat.findMany({ where: { productId: { in: productIds } } });
  for (const i of items) {
    const mine = rows.filter((r) => r.productId === i.productId && (i.sellerId == null || r.sellerCompanyId === i.sellerId));
    if (!mine.length) continue;
    const st = combineStats(mine.map((r) => ({ count: r.count, sum: r.sum, dist: r.dist, details: r.details as RatingStat["details"] })));
    out.set(`${i.productId}:${i.sellerId ?? ""}`, { avg: st.avg, count: st.count });
  }
  return out;
}

/** "4★ and up": the offers (per supplier) or products (FIRINGI mode) that qualify. */
export async function ratingWhere(ctx: Ctx, minStars: number | null | undefined): Promise<Prisma.VendorOfferWhereInput> {
  if (!minStars) return {};
  const s = await reviewSettingsCached();
  if (!s.enabled || !s.parts.reviews || !s.parts.searchStars) return {};
  const min = Math.max(1, Math.min(5, Math.round(minStars)));
  if (await firingiMode(ctx)) {
    const rows = await prisma.$queryRaw<{ productId: string }[]>`SELECT "productId" FROM "ProductRatingStat" GROUP BY "productId" HAVING SUM("sum")::numeric / NULLIF(SUM("count"), 0) >= ${min}`;
    return { packaging: { variant: { productId: { in: rows.map((r) => r.productId) } } } };
  }
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT vo.id FROM "VendorOffer" vo
    JOIN "PackagingUnit" pu ON pu.id = vo."packagingUnitId"
    JOIN "ProductVariant" pv ON pv.id = pu."variantId"
    JOIN "ProductRatingStat" s ON s."productId" = pv."productId" AND s."sellerCompanyId" = vo."vendorCompanyId"
    WHERE s.avg >= ${min}`;
  return { id: { in: rows.map((r) => r.id) } };
}

// ── verified purchase ───────────────────────────────────────────────────────

/** The latest delivered order in which this business received the product (from this supplier, if given). */
async function deliveredPurchase(buyerCompanyId: string, productId: string, sellerCompanyId?: string | null) {
  const line = await prisma.orderLine.findFirst({
    where: {
      qtyDelivered: { gt: 0 },
      order: { buyerCompanyId, status: "DELIVERED", ...(sellerCompanyId ? { sellerCompanyId } : {}) },
      offer: { packaging: { variant: { productId } } },
    },
    orderBy: { order: { updatedAt: "desc" } },
    select: { orderId: true, offerId: true, order: { select: { sellerCompanyId: true } } },
  });
  return line ? { orderId: line.orderId, offerId: line.offerId, sellerCompanyId: line.order.sellerCompanyId } : null;
}

async function offerInfo(offerId: string) {
  const o = await prisma.vendorOffer.findUnique({ where: { id: offerId }, select: { id: true, vendorCompanyId: true, packaging: { select: { variant: { select: { productId: true, product: { select: { name: true } } } } } } } });
  if (!o) throw new NotFoundError("Product");
  return { offerId: o.id, sellerId: o.vendorCompanyId, productId: o.packaging.variant.productId, productName: o.packaging.variant.product.name };
}

// ── what the buyer sees on a product ────────────────────────────────────────

export type ReviewSort = "recent" | "helpful" | "high" | "low";
type Author = { kind: "NAME" | "TYPE"; name: string | null; type: string; flag: string | null };

const authorOf = (r: { showName: boolean; buyer: { tradeName: string | null; legalName: string; type: string; country: { flag: string | null } | null } }): Author =>
  r.showName ? { kind: "NAME", name: r.buyer.tradeName ?? r.buyer.legalName, type: r.buyer.type, flag: r.buyer.country?.flag ?? null } : { kind: "TYPE", name: null, type: r.buyer.type, flag: r.buyer.country?.flag ?? null };

const reviewInclude = { buyer: { select: { tradeName: true, legalName: true, type: true, country: { select: { flag: true } } } } } as const;

/** Reviews and questions on a product page. In FIRINGI mode: across all suppliers, never naming one. */
export async function productReviews(ctx: Ctx, offerId: string, f: { sort?: ReviewSort; stars?: number | null; photos?: boolean; page?: number } = {}) {
  const s = await reviewSettings();
  const o = await offerInfo(offerId);
  const firingi = await firingiMode(ctx);
  const showing = await showingSellers([o.sellerId], s);
  const off = { on: false as const, settings: s };
  if (!s.enabled || !s.parts.reviews) return off;
  // In FIRINGI mode every supplier of the product whose reviews show; otherwise this supplier only (if it shows).
  let sellers: string[];
  if (firingi) {
    const all = await prisma.productReview.findMany({ where: { productId: o.productId }, distinct: ["sellerCompanyId"], select: { sellerCompanyId: true } });
    sellers = [...(await showingSellers(all.map((a) => a.sellerCompanyId), s))];
  } else {
    if (!showing.has(o.sellerId)) return off;
    sellers = [o.sellerId];
  }
  const access = ctx.company.type === "ADMIN" ? { on: false } : await buyerAccess(ctx.company, s);
  const scope: Prisma.ProductReviewWhereInput = { productId: o.productId, sellerCompanyId: { in: sellers } };
  const visible: Prisma.ProductReviewWhereInput = { ...scope, OR: [{ status: "PUBLISHED" }, { buyerCompanyId: ctx.company.id }] };
  const where: Prisma.ProductReviewWhereInput = {
    AND: [visible, f.stars ? { stars: f.stars } : {}, f.photos ? { photos: { isEmpty: false } } : {}],
  };
  const orderBy: Prisma.ProductReviewOrderByWithRelationInput[] =
    f.sort === "helpful" ? [{ helpfulCount: "desc" }, { createdAt: "desc" }] : f.sort === "high" ? [{ stars: "desc" }, { createdAt: "desc" }] : f.sort === "low" ? [{ stars: "asc" }, { createdAt: "desc" }] : [{ createdAt: "desc" }];
  const page = Math.max(1, f.page ?? 1);
  const [rows, total, statRows, mine, votes] = await Promise.all([
    prisma.productReview.findMany({ where, orderBy, skip: (page - 1) * PAGE, take: PAGE, include: reviewInclude }),
    prisma.productReview.count({ where }),
    prisma.productRatingStat.findMany({ where: { productId: o.productId, sellerCompanyId: { in: sellers } } }),
    prisma.productReview.findFirst({ where: { productId: o.productId, buyerCompanyId: ctx.company.id, ...(firingi ? {} : { sellerCompanyId: o.sellerId }) }, orderBy: { updatedAt: "desc" } }),
    prisma.reviewVote.findMany({ where: { companyId: ctx.company.id, review: { productId: o.productId } }, select: { reviewId: true } }),
  ]);
  const stat = statRows.length ? combineStats(statRows.map(toStat)) : emptyStat();
  const purchase = access.on && ctx.company.type !== "ADMIN" ? await deliveredPurchase(ctx.company.id, o.productId, firingi ? null : o.sellerId) : null;
  const editable = (r: { createdAt: Date }) => !s.editDays || Date.now() - r.createdAt.getTime() <= s.editDays * DAY;
  const voted = new Set(votes.map((v) => v.reviewId));
  const myReports = await prisma.contentReport.findMany({ where: { byCompanyId: ctx.company.id, kind: { in: ["REVIEW", "REPLY"] }, targetId: { in: rows.map((r) => r.id) } }, select: { kind: true, targetId: true } });
  const reported = new Set(myReports.map((r) => `${r.kind}:${r.targetId}`));

  return {
    on: true as const, settings: s, firingi, productId: o.productId, sellerId: firingi ? null : o.sellerId,
    stat, details: Object.fromEntries(DETAILS.map((d) => [d, detailAvg(stat, d)])) as Record<(typeof DETAILS)[number], number | null>,
    reviews: rows.map((r) => ({
      id: r.id, stars: r.stars, quality: r.quality, value: r.value, packaging: r.packaging, freshness: r.freshness, body: r.body, photos: r.photos.length,
      author: authorOf(r), mine: r.buyerCompanyId === ctx.company.id, status: r.status, createdAt: r.createdAt, editedAt: r.editedAt,
      reply: r.reply && (r.replyStatus === "PUBLISHED" || r.sellerCompanyId === ctx.company.id) ? { text: r.reply, at: r.repliedAt } : null,
      helpful: r.helpfulCount, voted: voted.has(r.id), reported: reported.has(`REVIEW:${r.id}`), replyReported: reported.has(`REPLY:${r.id}`),
    })),
    total, page, pageCount: Math.max(1, Math.ceil(total / PAGE)),
    my: mine ? { id: mine.id, stars: mine.stars, quality: mine.quality, value: mine.value, packaging: mine.packaging, freshness: mine.freshness, body: mine.body, photos: mine.photos.length, showName: mine.showName, status: mine.status, holdReasons: mine.holdReasons, hiddenReason: mine.hiddenReason, editable: editable(mine) } : null,
    canWrite: !!purchase && can(ctx, "buyer.reviews.write"),
    canVote: s.parts.helpful && ctx.company.type !== "ADMIN",
    canAsk: access.on && s.parts.questions && can(ctx, "buyer.reviews.write"),
    canAnswerAsBuyer: !!purchase && s.parts.questions && s.parts.buyerAnswers && can(ctx, "buyer.reviews.write"),
  };
}

/** Questions and answers about a product (the questions part of the product page). */
export async function productQuestions(ctx: Ctx, offerId: string, opts: { all?: boolean } = {}) {
  const s = await reviewSettings();
  if (!s.enabled || !s.parts.questions) return null;
  const o = await offerInfo(offerId);
  const rows = await prisma.productQuestion.findMany({
    where: { productId: o.productId, OR: [{ status: "PUBLISHED" }, { buyerCompanyId: ctx.company.id }] },
    orderBy: [{ answerCount: "desc" }, { createdAt: "desc" }], take: opts.all ? 100 : 10,
    include: { answers: { where: { OR: [{ status: "PUBLISHED" }, { companyId: ctx.company.id }] }, orderBy: [{ createdAt: "asc" }] } },
  });
  const reports = await prisma.contentReport.findMany({ where: { byCompanyId: ctx.company.id, kind: { in: ["QUESTION", "ANSWER"] } }, select: { kind: true, targetId: true } });
  const reported = new Set(reports.map((r) => `${r.kind}:${r.targetId}`));
  const total = await prisma.productQuestion.count({ where: { productId: o.productId, status: "PUBLISHED" } });
  return {
    total,
    questions: rows.map((q) => ({
      id: q.id, body: q.body, mine: q.buyerCompanyId === ctx.company.id, status: q.status, createdAt: q.createdAt, reported: reported.has(`QUESTION:${q.id}`),
      answers: q.answers
        .sort((a, b) => Number(b.role !== "BUYER") - Number(a.role !== "BUYER") || a.createdAt.getTime() - b.createdAt.getTime())
        .map((a) => ({ id: a.id, role: a.role, body: a.body, mine: a.companyId === ctx.company.id, status: a.status, createdAt: a.createdAt, reported: reported.has(`ANSWER:${a.id}`) })),
    })),
  };
}

// ── writing ─────────────────────────────────────────────────────────────────

export type ReviewInput = {
  offerId: string; stars: number; quality?: number | null; value?: number | null; packaging?: number | null; freshness?: number | null;
  body?: string | null; showName?: boolean; keep?: number[]; photos?: File[]; language?: string | null;
};

async function heldNotice(kind: string, reasons: HoldReason[]) {
  if (!reasons.length) return;
  await notify("review.to_moderate", [{ companyId: await adminCompanyId(), link: "/admin/reviews" }], { kind, reason: reasons.join(", ") }).catch(() => null);
}
const adminCompanyId = async () => (await prisma.company.findFirst({ where: { type: "ADMIN" }, select: { id: true } }))?.id ?? "";

/** Write or edit the business's review of a product it received. */
export async function saveReview(ctx: Ctx, input: ReviewInput) {
  if (!can(ctx, "buyer.reviews.write")) throw new ForbiddenError();
  const { on, settings: s } = await buyerAccess(ctx.company);
  if (!on || !s.parts.reviews) throw new AppError("REVIEWS_OFF", "Reviews are switched off.", 409);
  const o = await offerInfo(input.offerId);
  const firingi = await firingiMode(ctx);
  if (!firingi && !(await showingSellers([o.sellerId], s)).has(o.sellerId)) throw new AppError("REVIEWS_OFF", "Reviews are switched off.", 409);
  const purchase = await deliveredPurchase(ctx.company.id, o.productId, firingi ? null : o.sellerId);
  if (!purchase) throw new AppError("NOT_VERIFIED", "You can review a product once it has been delivered to you.", 409);
  if (!validScore(input.stars)) throw new ValidationError("Choose 1 to 5 stars.");
  const detail = (v: number | null | undefined) => (s.parts.details && validScore(v) ? v : null);
  const body = cleanText(input.body, s.maxChars) || null;
  const existing = await prisma.productReview.findFirst({ where: { productId: o.productId, buyerCompanyId: ctx.company.id, ...(firingi ? {} : { sellerCompanyId: o.sellerId }) }, orderBy: { updatedAt: "desc" } });
  if (existing?.status === "HIDDEN") throw new AppError("REVIEW_HIDDEN", "FIRINGI hid your review; it can't be changed.", 409);
  if (existing && s.editDays && Date.now() - existing.createdAt.getTime() > s.editDays * DAY) throw new AppError("REVIEW_LOCKED", "This review can no longer be changed.", 409);
  // photos: keep the chosen old ones, add new ones, at most maxPhotos
  const max = s.parts.photos ? s.maxPhotos : 0;
  const kept = (existing?.photos ?? []).filter((_, i) => (input.keep ?? []).includes(i));
  const files = (input.photos ?? []).filter((f) => f && f.size > 0);
  if (kept.length + files.length > max) throw new ValidationError(max ? `Up to ${max} photos.` : "Photos are switched off.");
  const added: string[] = [];
  for (const f of files) {
    const st = await storeUpload(f, "reviews");
    if (!st.mimeType.startsWith("image/")) throw new ValidationError("Photos must be images (JPG, PNG or WEBP).");
    added.push(st.key);
  }
  const holds = body ? screen(body, s.filter) : [];
  const status: PostStatus = holds.length ? "HELD" : "PUBLISHED";
  const data = {
    stars: input.stars, quality: detail(input.quality), value: detail(input.value), packaging: detail(input.packaging), freshness: detail(input.freshness),
    body, language: input.language?.slice(0, 8) ?? null, photos: [...kept, ...added], showName: !!input.showName, status, holdReasons: holds, offerId: o.offerId, orderId: purchase.orderId,
  };
  const sellerCompanyId = existing?.sellerCompanyId ?? purchase.sellerCompanyId;
  const row = existing
    ? await prisma.productReview.update({ where: { id: existing.id }, data: { ...data, editedAt: new Date() } })
    : await prisma.productReview.create({ data: { ...data, productId: o.productId, sellerCompanyId, buyerCompanyId: ctx.company.id, byUserId: ctx.user.id } });
  await recomputeStat(o.productId, sellerCompanyId);
  await prisma.reviewSummary.deleteMany({ where: { productId: o.productId } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: existing ? "review.edited" : "review.created", entityType: "ProductReview", entityId: row.id, after: { stars: row.stars, status, holds } });
  if (status === "PUBLISHED" && !existing) {
    await notify("review.received", [{ companyId: sellerCompanyId, link: "/vendor/reviews" }], { product: productName(o.productName), stars: String(row.stars) }).catch(() => null);
  }
  await heldNotice("review", holds);
  return { id: row.id, status, holdReasons: holds };
}

export async function deleteReview(ctx: Ctx, id: string) {
  const r = await prisma.productReview.findUnique({ where: { id } });
  if (!r || r.buyerCompanyId !== ctx.company.id || !can(ctx, "buyer.reviews.write")) throw new NotFoundError("Review");
  await prisma.productReview.delete({ where: { id } });
  await prisma.contentReport.deleteMany({ where: { kind: { in: ["REVIEW", "REPLY"] }, targetId: id } });
  await recomputeStat(r.productId, r.sellerCompanyId);
  await prisma.reviewSummary.deleteMany({ where: { productId: r.productId } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "review.deleted", entityType: "ProductReview", entityId: id, before: { stars: r.stars } });
  return true;
}

export async function voteHelpful(ctx: Ctx, reviewId: string, on: boolean) {
  const s = await reviewSettings();
  if (!s.enabled || !s.parts.helpful || ctx.company.type === "ADMIN") throw new AppError("REVIEWS_OFF", "Helpful votes are switched off.", 409);
  const r = await prisma.productReview.findUnique({ where: { id: reviewId }, select: { status: true, buyerCompanyId: true } });
  if (!r || r.status !== "PUBLISHED") throw new NotFoundError("Review");
  if (r.buyerCompanyId === ctx.company.id) throw new ValidationError("You can't vote for your own review.");
  await prisma.$transaction(async (tx) => {
    if (on) {
      const ins = await tx.reviewVote.createMany({ data: [{ reviewId, companyId: ctx.company.id, userId: ctx.user.id }], skipDuplicates: true });
      if (ins.count) await tx.productReview.update({ where: { id: reviewId }, data: { helpfulCount: { increment: 1 } } });
    } else {
      const del = await tx.reviewVote.deleteMany({ where: { reviewId, companyId: ctx.company.id } });
      if (del.count) await tx.productReview.update({ where: { id: reviewId }, data: { helpfulCount: { decrement: del.count } } });
    }
  });
  return (await prisma.productReview.findUnique({ where: { id: reviewId }, select: { helpfulCount: true } }))?.helpfulCount ?? 0;
}

/** Anyone signed in may report a post (once per business); enough reports hold it for FIRINGI. */
export async function reportContent(ctx: Ctx, kind: ReportKind, targetId: string, reason: string, note?: string | null) {
  if (!(REPORT_REASONS as readonly string[]).includes(reason)) throw new ValidationError("Choose a reason.");
  const s = await reviewSettings();
  const target = await targetOf(kind, targetId);
  if (!target || target.status !== "PUBLISHED") throw new NotFoundError("Post");
  if (target.ownerCompanyId === ctx.company.id) throw new ValidationError("You can't report your own post.");
  const ins = await prisma.contentReport.createMany({ data: [{ kind, targetId, byCompanyId: ctx.company.id, byUserId: ctx.user.id, reason, note: cleanText(note, 500) || null }], skipDuplicates: true });
  if (!ins.count) return { held: false };
  const open = await prisma.contentReport.count({ where: { kind, targetId, status: "OPEN" } });
  if (kind === "REVIEW") await prisma.productReview.update({ where: { id: targetId }, data: { reportCount: { increment: 1 } } });
  const hold = s.autoHoldReports > 0 && open >= s.autoHoldReports;
  if (hold) await setStatus(kind, targetId, "HELD", { holdReasons: ["REPORTS"] });
  await notify("review.to_moderate", [{ companyId: await adminCompanyId(), link: "/admin/reviews" }], { kind: kind.toLowerCase(), reason }).catch(() => null);
  return { held: hold };
}

/** The supplier's one public reply (it can be corrected; FIRINGI's filter applies). */
export async function replyToReview(ctx: Ctx, reviewId: string, text: string) {
  if (!can(ctx, "vendor.reviews.manage")) throw new ForbiddenError();
  const s = await reviewSettings();
  if (!s.enabled || !s.parts.replies) throw new AppError("REVIEWS_OFF", "Replies are switched off.", 409);
  const r = await prisma.productReview.findUnique({ where: { id: reviewId }, include: { product: { select: { name: true } } } });
  if (!r || r.sellerCompanyId !== ctx.company.id || r.status === "HIDDEN") throw new NotFoundError("Review");
  if (r.replyStatus === "HIDDEN") throw new AppError("REPLY_HIDDEN", "FIRINGI hid your reply; it can't be changed.", 409);
  const body = cleanText(text, s.maxChars);
  if (body.length < 2) throw new ValidationError("Write a reply.");
  const holds = screen(body, s.filter);
  const first = !r.reply;
  await prisma.productReview.update({ where: { id: reviewId }, data: { reply: body, replyStatus: holds.length ? "HELD" : "PUBLISHED", replyHold: holds, replyById: ctx.user.id, repliedAt: new Date() } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: first ? "review.replied" : "review.reply_edited", entityType: "ProductReview", entityId: reviewId, after: { holds } });
  if (!holds.length && first && r.offerId) await notify("review.reply", [{ userId: r.byUserId, link: `/buy/catalogue/offers/${r.offerId}#reviews` }], { product: productName(r.product.name) }).catch(() => null);
  await heldNotice("reply", holds);
  return { status: holds.length ? "HELD" : "PUBLISHED", holdReasons: holds };
}

export async function askQuestion(ctx: Ctx, offerId: string, text: string) {
  if (!can(ctx, "buyer.reviews.write")) throw new ForbiddenError();
  const { on, settings: s } = await buyerAccess(ctx.company);
  if (!on || !s.parts.questions) throw new AppError("REVIEWS_OFF", "Questions are switched off.", 409);
  const o = await offerInfo(offerId);
  const body = cleanText(text, Math.min(s.maxChars, 1000));
  if (body.length < 5) throw new ValidationError("Write your question.");
  const holds = screen(body, s.filter);
  const q = await prisma.productQuestion.create({ data: { productId: o.productId, sellerCompanyId: o.sellerId, buyerCompanyId: ctx.company.id, byUserId: ctx.user.id, body, status: holds.length ? "HELD" : "PUBLISHED", holdReasons: holds } });
  if (!holds.length) await notify("review.question", [{ companyId: o.sellerId, link: "/vendor/reviews/questions" }], { product: productName(o.productName) }).catch(() => null);
  await heldNotice("question", holds);
  return { id: q.id, status: q.status, holdReasons: holds };
}

/** The supplier asked (official), FIRINGI (official) or a buyer who received the product. */
export async function answerQuestion(ctx: Ctx, questionId: string, text: string) {
  const s = await reviewSettings();
  if (!s.enabled || !s.parts.questions) throw new AppError("REVIEWS_OFF", "Questions are switched off.", 409);
  const q = await prisma.productQuestion.findUnique({ where: { id: questionId }, include: { product: { select: { name: true } } } });
  if (!q || q.status === "HIDDEN") throw new NotFoundError("Question");
  let role: "SUPPLIER" | "FIRINGI" | "BUYER";
  if (ctx.company.type === "ADMIN") {
    if (!can(ctx, "admin.reviews.moderate")) throw new ForbiddenError();
    role = "FIRINGI";
  } else if (can(ctx, "vendor.reviews.manage") && q.sellerCompanyId === ctx.company.id) { // only the supplier the question was asked about
    role = "SUPPLIER";
  } else {
    if (!can(ctx, "buyer.reviews.write") || !s.parts.buyerAnswers || !(await buyerAccess(ctx.company, s)).on) throw new ForbiddenError();
    if (!(await deliveredPurchase(ctx.company.id, q.productId))) throw new AppError("NOT_VERIFIED", "Only businesses that received this product can answer.", 409);
    role = "BUYER";
  }
  const body = cleanText(text, Math.min(s.maxChars, 2000));
  if (body.length < 2) throw new ValidationError("Write an answer.");
  const holds = role === "FIRINGI" ? [] : screen(body, s.filter);
  const a = await prisma.$transaction(async (tx) => {
    const a = await tx.productAnswer.create({ data: { questionId, companyId: ctx.company.id, byUserId: ctx.user.id, role, body, status: holds.length ? "HELD" : "PUBLISHED", holdReasons: holds } });
    if (!holds.length) await tx.productQuestion.update({ where: { id: questionId }, data: { answerCount: { increment: 1 } } });
    return a;
  });
  if (!holds.length && q.byUserId !== ctx.user.id) {
    const offer = await prisma.vendorOffer.findFirst({ where: { packaging: { variant: { productId: q.productId } }, ...(q.sellerCompanyId ? { vendorCompanyId: q.sellerCompanyId } : {}) }, select: { id: true } });
    await notify("review.answered", [{ userId: q.byUserId, link: offer ? `/buy/catalogue/offers/${offer.id}#questions` : "/buy/reviews" }], { product: productName(q.product.name) }).catch(() => null);
  }
  await heldNotice("answer", holds);
  return { id: a.id, role, status: a.status, holdReasons: holds };
}

export async function deleteOwnPost(ctx: Ctx, kind: "QUESTION" | "ANSWER", id: string) {
  if (kind === "QUESTION") {
    const q = await prisma.productQuestion.findUnique({ where: { id } });
    if (!q || q.buyerCompanyId !== ctx.company.id) throw new NotFoundError("Question");
    await prisma.productQuestion.delete({ where: { id } });
  } else {
    const a = await prisma.productAnswer.findUnique({ where: { id } });
    if (!a || a.companyId !== ctx.company.id) throw new NotFoundError("Answer");
    await prisma.$transaction([
      prisma.productAnswer.delete({ where: { id } }),
      ...(a.status === "PUBLISHED" ? [prisma.productQuestion.update({ where: { id: a.questionId }, data: { answerCount: { decrement: 1 } } })] : []),
    ]);
  }
  await prisma.contentReport.deleteMany({ where: { kind, targetId: id } });
  return true;
}

// ── moderation (FIRINGI) ────────────────────────────────────────────────────

type Target = { status: PostStatus; ownerCompanyId: string; ownerUserId: string; productId: string; sellerId: string | null; text: string | null; product: unknown };

async function targetOf(kind: ReportKind, id: string): Promise<Target | null> {
  if (kind === "REVIEW" || kind === "REPLY") {
    const r = await prisma.productReview.findUnique({ where: { id }, include: { product: { select: { name: true } } } });
    if (!r) return null;
    if (kind === "REVIEW") return { status: r.status, ownerCompanyId: r.buyerCompanyId, ownerUserId: r.byUserId, productId: r.productId, sellerId: r.sellerCompanyId, text: r.body, product: r.product.name };
    if (!r.reply || !r.replyStatus || !r.replyById) return null;
    return { status: r.replyStatus, ownerCompanyId: r.sellerCompanyId, ownerUserId: r.replyById, productId: r.productId, sellerId: r.sellerCompanyId, text: r.reply, product: r.product.name };
  }
  if (kind === "QUESTION") {
    const q = await prisma.productQuestion.findUnique({ where: { id }, include: { product: { select: { name: true } } } });
    return q ? { status: q.status, ownerCompanyId: q.buyerCompanyId, ownerUserId: q.byUserId, productId: q.productId, sellerId: q.sellerCompanyId, text: q.body, product: q.product.name } : null;
  }
  const a = await prisma.productAnswer.findUnique({ where: { id }, include: { question: { include: { product: { select: { name: true } } } } } });
  return a ? { status: a.status, ownerCompanyId: a.companyId, ownerUserId: a.byUserId, productId: a.question.productId, sellerId: a.question.sellerCompanyId, text: a.body, product: a.question.product.name } : null;
}

async function setStatus(kind: ReportKind, id: string, status: PostStatus, extra: { holdReasons?: string[]; hiddenReason?: string | null; by?: string } = {}) {
  const mod = extra.by ? { moderatedById: extra.by, moderatedAt: new Date() } : {};
  if (kind === "REVIEW") {
    const r = await prisma.productReview.update({ where: { id }, data: { status, ...(extra.holdReasons ? { holdReasons: extra.holdReasons } : {}), hiddenReason: status === "HIDDEN" ? extra.hiddenReason ?? null : null, ...mod } });
    await recomputeStat(r.productId, r.sellerCompanyId);
    await prisma.reviewSummary.deleteMany({ where: { productId: r.productId } });
  } else if (kind === "REPLY") {
    await prisma.productReview.update({ where: { id }, data: { replyStatus: status, ...(extra.holdReasons ? { replyHold: extra.holdReasons } : {}) } });
  } else if (kind === "QUESTION") {
    await prisma.productQuestion.update({ where: { id }, data: { status, ...(extra.holdReasons ? { holdReasons: extra.holdReasons } : {}), hiddenReason: status === "HIDDEN" ? extra.hiddenReason ?? null : null, ...mod } });
  } else {
    const before = await prisma.productAnswer.findUniqueOrThrow({ where: { id } });
    await prisma.productAnswer.update({ where: { id }, data: { status, ...(extra.holdReasons ? { holdReasons: extra.holdReasons } : {}), hiddenReason: status === "HIDDEN" ? extra.hiddenReason ?? null : null, ...mod } });
    const delta = Number(status === "PUBLISHED") - Number(before.status === "PUBLISHED");
    if (delta) await prisma.productQuestion.update({ where: { id: before.questionId }, data: { answerCount: { increment: delta } } });
  }
}

/** Publish (it's fine) or hide (with a reason the author is told). Open reports on it are closed. */
export async function moderate(ctx: Ctx, kind: ReportKind, id: string, action: "PUBLISH" | "HIDE", reason?: string | null) {
  moderator(ctx);
  const t = await targetOf(kind, id);
  if (!t) throw new NotFoundError("Post");
  const why = cleanText(reason, 300);
  if (action === "HIDE" && why.length < 3) throw new ValidationError("Give the reason the author will see.");
  await setStatus(kind, id, action === "HIDE" ? "HIDDEN" : "PUBLISHED", { hiddenReason: why || null, by: ctx.user.id, ...(action === "PUBLISH" ? { holdReasons: [] } : {}) });
  await prisma.contentReport.updateMany({ where: { kind, targetId: id, status: "OPEN" }, data: { status: action === "HIDE" ? "HIDDEN" : "DISMISSED", resolvedById: ctx.user.id, resolvedAt: new Date() } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: action === "HIDE" ? "review.hidden" : "review.published", entityType: kind, entityId: id, after: { reason: why || null } });
  if (action === "HIDE") await notify("review.hidden", [{ userId: t.ownerUserId, link: t.ownerCompanyId === t.sellerId && kind === "REPLY" ? "/vendor/reviews" : "/buy/reviews" }], { product: productName(t.product), reason: why }).catch(() => null);
  if (action === "PUBLISH" && t.status === "HELD" && kind === "REVIEW" && t.sellerId) {
    await notify("review.received", [{ companyId: t.sellerId, link: "/vendor/reviews" }], { product: productName(t.product), stars: "" }).catch(() => null);
  }
  return true;
}

export type ModTab = "HELD" | "REPORTED" | "HIDDEN" | "ALL";

/** The moderation queue: posts waiting (held by the filter or reports) and open reports. */
export async function moderationQueue(ctx: Ctx, f: { tab?: ModTab; kind?: ReportKind | null; q?: string | null; page?: number } = {}) {
  moderator(ctx);
  const tab = f.tab ?? "HELD";
  const page = Math.max(1, f.page ?? 1);
  const reports = await prisma.contentReport.groupBy({ by: ["kind", "targetId"], where: { status: "OPEN" }, _count: { _all: true } });
  const repMap = new Map(reports.map((r) => [`${r.kind}:${r.targetId}`, r._count._all]));
  const reasons = await prisma.contentReport.findMany({ where: { status: "OPEN" }, select: { kind: true, targetId: true, reason: true, note: true } });
  const repReasons = new Map<string, { reason: string; note: string | null }[]>();
  for (const r of reasons) repReasons.set(`${r.kind}:${r.targetId}`, [...(repReasons.get(`${r.kind}:${r.targetId}`) ?? []), { reason: r.reason, note: r.note }]);
  const status: PostStatus | undefined = tab === "HELD" ? "HELD" : tab === "HIDDEN" ? "HIDDEN" : undefined;
  const reportedIds = (k: ReportKind) => reports.filter((r) => r.kind === k).map((r) => r.targetId);
  const q = f.q?.trim();
  const textQ = (field: string) => (q ? { [field]: { contains: q, mode: "insensitive" as const } } : {});
  type Item = { kind: ReportKind; id: string; status: PostStatus; text: string | null; stars: number | null; product: string; productId: string; author: string; reasons: string[]; reports: number; reportReasons: { reason: string; note: string | null }[]; createdAt: Date; hiddenReason: string | null; photos: number };
  const items: Item[] = [];
  const want = (k: ReportKind) => !f.kind || f.kind === k;
  if (want("REVIEW")) {
    const where: Prisma.ProductReviewWhereInput = tab === "REPORTED" ? { id: { in: reportedIds("REVIEW") } } : { ...(status ? { status: status } : {}), ...textQ("body") };
    for (const r of await prisma.productReview.findMany({ where, orderBy: { createdAt: "desc" }, take: 200, include: { product: { select: { name: true } }, buyer: { select: { tradeName: true, legalName: true } } } }))
      items.push({ kind: "REVIEW", id: r.id, status: r.status, text: r.body, stars: r.stars, product: productName(r.product.name), productId: r.productId, author: r.buyer.tradeName ?? r.buyer.legalName, reasons: r.holdReasons, reports: repMap.get(`REVIEW:${r.id}`) ?? 0, reportReasons: repReasons.get(`REVIEW:${r.id}`) ?? [], createdAt: r.createdAt, hiddenReason: r.hiddenReason, photos: r.photos.length });
  }
  if (want("REPLY")) {
    const where: Prisma.ProductReviewWhereInput = tab === "REPORTED" ? { id: { in: reportedIds("REPLY") } } : { reply: { not: null }, ...(status ? { replyStatus: status as PostStatus } : {}), ...textQ("reply") };
    for (const r of await prisma.productReview.findMany({ where, orderBy: { repliedAt: "desc" }, take: 200, include: { product: { select: { name: true } }, seller: { select: { tradeName: true, legalName: true } } } }))
      if (r.reply && r.replyStatus) items.push({ kind: "REPLY", id: r.id, status: r.replyStatus, text: r.reply, stars: null, product: productName(r.product.name), productId: r.productId, author: r.seller.tradeName ?? r.seller.legalName, reasons: r.replyHold, reports: repMap.get(`REPLY:${r.id}`) ?? 0, reportReasons: repReasons.get(`REPLY:${r.id}`) ?? [], createdAt: r.repliedAt ?? r.createdAt, hiddenReason: null, photos: 0 });
  }
  if (want("QUESTION")) {
    const where: Prisma.ProductQuestionWhereInput = tab === "REPORTED" ? { id: { in: reportedIds("QUESTION") } } : { ...(status ? { status: status } : {}), ...textQ("body") };
    for (const x of await prisma.productQuestion.findMany({ where, orderBy: { createdAt: "desc" }, take: 200, include: { product: { select: { name: true } } } })) {
      const co = await prisma.company.findUnique({ where: { id: x.buyerCompanyId }, select: { tradeName: true, legalName: true } });
      items.push({ kind: "QUESTION", id: x.id, status: x.status, text: x.body, stars: null, product: productName(x.product.name), productId: x.productId, author: co?.tradeName ?? co?.legalName ?? "—", reasons: x.holdReasons, reports: repMap.get(`QUESTION:${x.id}`) ?? 0, reportReasons: repReasons.get(`QUESTION:${x.id}`) ?? [], createdAt: x.createdAt, hiddenReason: x.hiddenReason, photos: 0 });
    }
  }
  if (want("ANSWER")) {
    const where: Prisma.ProductAnswerWhereInput = tab === "REPORTED" ? { id: { in: reportedIds("ANSWER") } } : { ...(status ? { status: status } : {}), ...textQ("body") };
    for (const x of await prisma.productAnswer.findMany({ where, orderBy: { createdAt: "desc" }, take: 200, include: { question: { include: { product: { select: { name: true } } } } } })) {
      const co = await prisma.company.findUnique({ where: { id: x.companyId }, select: { tradeName: true, legalName: true } });
      items.push({ kind: "ANSWER", id: x.id, status: x.status, text: x.body, stars: null, product: productName(x.question.product.name), productId: x.question.productId, author: `${co?.tradeName ?? co?.legalName ?? "—"} (${x.role.toLowerCase()})`, reasons: x.holdReasons, reports: repMap.get(`ANSWER:${x.id}`) ?? 0, reportReasons: repReasons.get(`ANSWER:${x.id}`) ?? [], createdAt: x.createdAt, hiddenReason: x.hiddenReason, photos: 0 });
    }
  }
  items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const size = 25;
  return { items: items.slice((page - 1) * size, page * size), total: items.length, page, pageCount: Math.max(1, Math.ceil(items.length / size)), counts: await moderationCounts(ctx) };
}

export async function moderationCounts(ctx: Ctx) {
  moderator(ctx);
  const [rh, ph, qh, ah, rep] = await Promise.all([
    prisma.productReview.count({ where: { status: "HELD" } }),
    prisma.productReview.count({ where: { replyStatus: "HELD" } }),
    prisma.productQuestion.count({ where: { status: "HELD" } }),
    prisma.productAnswer.count({ where: { status: "HELD" } }),
    prisma.contentReport.groupBy({ by: ["kind", "targetId"], where: { status: "OPEN" } }),
  ]);
  return { held: rh + ph + qh + ah, reported: rep.length };
}

/** FIRINGI overview: totals, the latest reviews, the best and worst rated products. */
export async function adminReviewOverview(ctx: Ctx) {
  moderator(ctx);
  const since = new Date(Date.now() - 30 * DAY);
  const [total, last30, questions, unanswered, avg, worst, best, counts] = await Promise.all([
    prisma.productReview.count({ where: { status: "PUBLISHED" } }),
    prisma.productReview.count({ where: { createdAt: { gte: since } } }),
    prisma.productQuestion.count({ where: { status: "PUBLISHED" } }),
    prisma.productQuestion.count({ where: { status: "PUBLISHED", answerCount: 0 } }),
    prisma.productRatingStat.aggregate({ _sum: { sum: true, count: true } }),
    prisma.productRatingStat.findMany({ where: { count: { gte: 1 } }, orderBy: [{ avg: "asc" }, { count: "desc" }], take: 8 }),
    prisma.productRatingStat.findMany({ where: { count: { gte: 1 } }, orderBy: [{ avg: "desc" }, { count: "desc" }], take: 8 }),
    moderationCounts(ctx),
  ]);
  const ids = [...new Set([...worst, ...best].flatMap((r) => [r.productId]))];
  const sellerIds = [...new Set([...worst, ...best].map((r) => r.sellerCompanyId))];
  const [products, sellers] = await Promise.all([
    prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }),
    prisma.company.findMany({ where: { id: { in: sellerIds } }, select: { id: true, tradeName: true, legalName: true } }),
  ]);
  const pn = new Map(products.map((p) => [p.id, productName(p.name)]));
  const sn = new Map(sellers.map((c) => [c.id, c.tradeName ?? c.legalName]));
  const row = (r: (typeof worst)[number]) => ({ productId: r.productId, product: pn.get(r.productId) ?? "—", supplier: sn.get(r.sellerCompanyId) ?? "—", avg: Number(r.avg), count: r.count });
  const s = avg._sum;
  return { total, last30, questions, unanswered, avg: s.count ? Math.round(((s.sum ?? 0) / s.count) * 100) / 100 : null, worst: worst.map(row), best: best.map(row), ...counts };
}

// ── supplier ────────────────────────────────────────────────────────────────

function vendorOnly(ctx: Ctx) {
  if (ctx.company.type !== "WHOLESALER" && ctx.company.type !== "DISTRIBUTOR") throw new ForbiddenError();
  if (!can(ctx, "vendor.reviews.manage")) throw new ForbiddenError();
}

export async function vendorReviewAccess(ctx: Ctx) {
  const s = await reviewSettings();
  const shows = (await showingSellers([ctx.company.id], s)).has(ctx.company.id);
  return { on: s.enabled && s.parts.reviews && shows, settings: s };
}

export async function vendorReviews(ctx: Ctx, f: { filter?: "all" | "unreplied" | "low" | "held"; productId?: string | null; page?: number } = {}) {
  vendorOnly(ctx);
  const page = Math.max(1, f.page ?? 1);
  const where: Prisma.ProductReviewWhereInput = {
    sellerCompanyId: ctx.company.id, status: f.filter === "held" ? "HELD" : "PUBLISHED",
    ...(f.filter === "unreplied" ? { reply: null } : {}), ...(f.filter === "low" ? { stars: { lte: 2 } } : {}), ...(f.productId ? { productId: f.productId } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.productReview.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE, take: PAGE, include: { ...reviewInclude, product: { select: { name: true } } } }),
    prisma.productReview.count({ where }),
  ]);
  return {
    total, page, pageCount: Math.max(1, Math.ceil(total / PAGE)),
    items: rows.map((r) => ({
      id: r.id, productId: r.productId, product: r.product.name, offerId: r.offerId, stars: r.stars, quality: r.quality, value: r.value, packaging: r.packaging, freshness: r.freshness,
      body: r.body, photos: r.photos.length, author: authorOf(r), createdAt: r.createdAt, editedAt: r.editedAt, helpful: r.helpfulCount,
      reply: r.reply, replyStatus: r.replyStatus, repliedAt: r.repliedAt,
    })),
  };
}

export async function vendorQuestions(ctx: Ctx, f: { open?: boolean; page?: number } = {}) {
  vendorOnly(ctx);
  const page = Math.max(1, f.page ?? 1);
  const where: Prisma.ProductQuestionWhereInput = {
    status: "PUBLISHED", sellerCompanyId: ctx.company.id,
    ...(f.open ? { answers: { none: { companyId: ctx.company.id } } } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.productQuestion.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE, take: PAGE, include: { product: { select: { name: true } }, answers: { where: { OR: [{ status: "PUBLISHED" }, { companyId: ctx.company.id }] }, orderBy: { createdAt: "asc" } } } }),
    prisma.productQuestion.count({ where }),
  ]);
  return {
    total, page, pageCount: Math.max(1, Math.ceil(total / PAGE)),
    items: rows.map((q) => ({
      id: q.id, product: q.product.name, body: q.body, createdAt: q.createdAt,
      answers: q.answers.map((a) => ({ id: a.id, role: a.role, body: a.body, mine: a.companyId === ctx.company.id, status: a.status, createdAt: a.createdAt })),
      answered: q.answers.some((a) => a.companyId === ctx.company.id),
    })),
  };
}

/** Ratings per product, the 12-month trend, common complaints, reply rate, open questions. */
export async function vendorInsights(ctx: Ctx, now = new Date()) {
  vendorOnly(ctx);
  const s = await reviewSettings();
  if (!s.parts.insights) return null;
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));
  const [stats, reviews, open] = await Promise.all([
    prisma.productRatingStat.findMany({ where: { sellerCompanyId: ctx.company.id }, orderBy: [{ count: "desc" }] }),
    prisma.productReview.findMany({ where: { sellerCompanyId: ctx.company.id, status: "PUBLISHED" }, select: { productId: true, stars: true, quality: true, value: true, packaging: true, freshness: true, body: true, createdAt: true, reply: true } }),
    vendorQuestions(ctx, { open: true }),
  ]);
  const products = await prisma.product.findMany({ where: { id: { in: stats.map((x) => x.productId) } }, select: { id: true, name: true } });
  const pn = new Map(products.map((p) => [p.id, p.name]));
  const all = combineStats(stats.map(toStat));
  const recent = reviews.filter((r) => r.createdAt >= new Date(now.getTime() - 90 * DAY));
  const byProduct = stats.map((x) => {
    const st = toStat(x);
    const mine = reviews.filter((r) => r.productId === x.productId);
    const last90 = mine.filter((r) => r.createdAt >= new Date(now.getTime() - 90 * DAY));
    const prev = mine.filter((r) => r.createdAt < new Date(now.getTime() - 90 * DAY));
    return {
      productId: x.productId, name: pn.get(x.productId) ?? {}, avg: st.avg, count: st.count, dist: st.dist,
      details: Object.fromEntries(DETAILS.map((d) => [d, detailAvg(st, d)])) as Record<(typeof DETAILS)[number], number | null>,
      change: last90.length && prev.length ? Math.round((ratingStat(last90).avg - ratingStat(prev).avg) * 100) / 100 : null,
      complaints: complaints(mine, 3),
    };
  });
  return {
    avg: all.avg, count: all.count, dist: all.dist,
    details: Object.fromEntries(DETAILS.map((d) => [d, detailAvg(all, d)])) as Record<(typeof DETAILS)[number], number | null>,
    last90: recent.length, replyRate: reviews.length ? Math.round((reviews.filter((r) => r.reply).length / reviews.length) * 100) : null,
    trend: monthlyTrend(reviews.filter((r) => r.createdAt >= since), now, 12),
    complaints: complaints(reviews, 6), products: byProduct, openQuestions: open.total,
  };
}

// ── the buyer's own reviews ─────────────────────────────────────────────────

/** Products delivered and not yet reviewed, the business's reviews and questions. */
export async function myReviews(ctx: Ctx, locale = "en") {
  if (!can(ctx, "buyer.reviews.write") && !can(ctx, "buyer.orders.view")) throw new ForbiddenError();
  const { on, settings: s } = await buyerAccess(ctx.company);
  if (!on || !s.parts.reviews) return { on: false as const };
  const firingi = await firingiMode(ctx);
  const [lines, reviews, questions] = await Promise.all([
    prisma.orderLine.findMany({
      where: { qtyDelivered: { gt: 0 }, order: { buyerCompanyId: ctx.company.id, status: "DELIVERED", updatedAt: { gte: new Date(Date.now() - 365 * DAY) } } },
      orderBy: { order: { updatedAt: "desc" } }, take: 500,
      select: { offerId: true, productName: true, order: { select: { number: true, sellerCompanyId: true, updatedAt: true, seller: { select: { tradeName: true, legalName: true } } } }, offer: { select: { packaging: { select: { variant: { select: { productId: true } } } } } } },
    }),
    prisma.productReview.findMany({ where: { buyerCompanyId: ctx.company.id }, orderBy: { updatedAt: "desc" }, include: { product: { select: { name: true } } } }),
    prisma.productQuestion.findMany({ where: { buyerCompanyId: ctx.company.id }, orderBy: { createdAt: "desc" }, take: 50, include: { product: { select: { name: true } }, answers: { where: { status: "PUBLISHED" }, orderBy: { createdAt: "asc" } } } }),
  ]);
  const showing = await showingSellers([...new Set(lines.map((l) => l.order.sellerCompanyId))], s);
  const done = new Set(reviews.map((r) => (firingi ? r.productId : `${r.productId}:${r.sellerCompanyId}`)));
  const seen = new Set<string>();
  const todo: { offerId: string; product: string; supplier: string | null; order: string; deliveredAt: Date }[] = [];
  for (const l of lines) {
    const pid = l.offer.packaging.variant.productId;
    const key = firingi ? pid : `${pid}:${l.order.sellerCompanyId}`;
    if (done.has(key) || seen.has(key) || (!firingi && !showing.has(l.order.sellerCompanyId))) continue;
    seen.add(key);
    todo.push({ offerId: l.offerId, product: pickLocalized(l.productName as Record<string, string>, locale), supplier: firingi ? null : l.order.seller.tradeName ?? l.order.seller.legalName, order: l.order.number, deliveredAt: l.order.updatedAt });
  }
  return {
    on: true as const, firingi,
    todo: todo.slice(0, 30), todoCount: todo.length,
    reviews: reviews.map((r) => ({ id: r.id, offerId: r.offerId, product: productName(r.product.name, locale), stars: r.stars, body: r.body, status: r.status, hiddenReason: r.hiddenReason, holdReasons: r.holdReasons, reply: r.reply && r.replyStatus === "PUBLISHED" ? r.reply : null, helpful: r.helpfulCount, updatedAt: r.updatedAt })),
    questions: questions.map((q) => ({ id: q.id, product: productName(q.product.name, locale), body: q.body, status: q.status, hiddenReason: q.hiddenReason, answers: q.answers.map((a) => ({ role: a.role, body: a.body })), createdAt: q.createdAt })),
  };
}

// ── photos ──────────────────────────────────────────────────────────────────

/** A review photo's storage key — published: anyone signed in; otherwise the author, the supplier and FIRINGI. */
export async function reviewPhotoKey(ctx: Ctx, reviewId: string, n: number) {
  const r = await prisma.productReview.findUnique({ where: { id: reviewId }, select: { photos: true, status: true, buyerCompanyId: true, sellerCompanyId: true } });
  const key = r?.photos[n];
  if (!r || !key) throw new NotFoundError("Photo");
  const ok = r.status === "PUBLISHED" || ctx.company.id === r.buyerCompanyId || ctx.company.type === "ADMIN" || (ctx.company.id === r.sellerCompanyId && r.status !== "HIDDEN");
  if (!ok) throw new NotFoundError("Photo");
  return key;
}

// ── AI summary ──────────────────────────────────────────────────────────────

const simulating = () => process.env.ASSISTANT_SIMULATE === "1" && !process.env.ANTHROPIC_API_KEY && process.env.FIRINGI_ENV !== "production";

export async function aiSummaryStatus() {
  const s = await reviewSettings();
  return { on: s.enabled && s.parts.reviews && s.parts.aiSummary, configured: !!aiTransport() || simulating(), minReviews: s.aiMinReviews };
}

function languageName(locale: string) {
  try { return new Intl.DisplayNames(["en"], { type: "language" }).of(locale) ?? "English"; } catch { return "English"; }
}

/** A short, neutral summary of a product's reviews in the reader's language — cached until the reviews change. */
export async function reviewSummary(ctx: Ctx, offerId: string, locale: string) {
  const st = await aiSummaryStatus();
  if (!st.on || !st.configured) return null;
  const view = await productReviews(ctx, offerId);
  if (!view.on || view.stat.count < st.minReviews) return null;
  const sellerKey = view.sellerId ?? "";
  const cached = await prisma.reviewSummary.findUnique({ where: { productId_sellerCompanyId_locale: { productId: view.productId, sellerCompanyId: sellerKey, locale } } });
  if (cached && cached.basedOn === view.stat.count) return { text: cached.text, basedOn: cached.basedOn, simulated: cached.simulated };
  const sellers = view.sellerId ? [view.sellerId] : (await prisma.productRatingStat.findMany({ where: { productId: view.productId }, select: { sellerCompanyId: true } })).map((r) => r.sellerCompanyId);
  const rows = await prisma.productReview.findMany({ where: { productId: view.productId, sellerCompanyId: { in: sellers }, status: "PUBLISHED" }, orderBy: { createdAt: "desc" }, take: 100, select: { stars: true, quality: true, value: true, packaging: true, freshness: true, body: true } });
  let text: string;
  const transport = aiTransport();
  if (!transport) {
    const c = complaints(rows, 2);
    text = `Simulated summary (no AI connected): ${view.stat.count} reviews, ${view.stat.avg.toFixed(1)} of 5 on average.${c.length ? ` Mentioned in lower ratings: ${c.map((x) => x.theme.toLowerCase()).join(", ")}.` : ""}`;
  } else {
    const settings = await aiSettings();
    const lines = rows.map((r, i) => `${i + 1}. ${r.stars}★${DETAILS.map((d) => (r[d] ? ` ${d} ${r[d]}/5` : "")).join("")}${r.body ? ` — ${r.body.replace(/\s+/g, " ").slice(0, 600)}` : ""}`).join("\n");
    const params: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming = {
      model: settings.model, max_tokens: 400,
      system: `You summarise B2B buyers' reviews of one food product for other professional buyers (restaurants, shops). Write 2 to 4 short sentences in ${languageName(locale)}: what buyers like, what they criticise, and how consistent the opinions are. Be neutral and factual; only use what the reviews say. Never name businesses, people, suppliers or brands other than the product's, never include contact details or prices, and don't give advice. Plain text only.`,
      messages: [{ role: "user", content: `Average ${view.stat.avg} of 5 from ${view.stat.count} reviews. The most recent reviews:\n${lines}` }],
    };
    const res = await transport(params);
    if (res.stop_reason === "refusal") return null;
    text = res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join(" ").trim().slice(0, 1200);
    if (!text) return null;
    await logAi({ kind: "REVIEW_SUMMARY", ctx, summary: `Review summary (${view.stat.count} reviews)`, detail: { productId: view.productId, locale }, model: settings.model, tokensIn: res.usage?.input_tokens, tokensOut: res.usage?.output_tokens }).catch(() => null);
  }
  const data = { text, basedOn: view.stat.count, simulated: !transport };
  await prisma.reviewSummary.upsert({ where: { productId_sellerCompanyId_locale: { productId: view.productId, sellerCompanyId: sellerKey, locale } }, create: { productId: view.productId, sellerCompanyId: sellerKey, locale, ...data }, update: { ...data, createdAt: new Date() } });
  return data;
}

// ── reminders (daily job) ───────────────────────────────────────────────────

/** "How was …?" a few days after delivery — once per product, supplier and business. */
export async function runReviewJob(now = new Date()) {
  const s = await reviewSettings();
  if (!s.enabled || !s.parts.reviews || !s.parts.reminders) return { reminders: 0 };
  const to = new Date(now.getTime() - s.reminder.afterDays * DAY);
  const from = new Date(to.getTime() - 7 * DAY); // never chase old orders
  const orders = await prisma.order.findMany({
    where: { status: "DELIVERED", statusHistory: { some: { toStatus: "DELIVERED", at: { gte: from, lt: to } } } },
    select: {
      id: true, buyerCompanyId: true, sellerCompanyId: true, placedByUserId: true, buyer: { select: { id: true, type: true } },
      lines: { where: { qtyDelivered: { gt: 0 } }, select: { offerId: true, productName: true, offer: { select: { packaging: { select: { variant: { select: { productId: true } } } } } } } },
    },
    take: 2000,
  });
  const showing = await showingSellers([...new Set(orders.map((o) => o.sellerCompanyId))], s);
  let sent = 0;
  for (const o of orders) {
    if (!showing.has(o.sellerCompanyId) || !(await buyerAccess(o.buyer, s)).on) continue;
    const fresh: { productName: unknown; offerId: string }[] = [];
    for (const l of o.lines) {
      const productId = l.offer.packaging.variant.productId;
      const has = await prisma.productReview.count({ where: { productId, buyerCompanyId: o.buyerCompanyId } });
      if (has) continue;
      const ins = await prisma.reviewReminder.createMany({ data: [{ buyerCompanyId: o.buyerCompanyId, productId, sellerCompanyId: o.sellerCompanyId, orderId: o.id }], skipDuplicates: true });
      if (ins.count) fresh.push({ productName: l.productName, offerId: l.offerId });
    }
    if (!fresh.length) continue;
    const first = productName(fresh[0].productName);
    await notify("review.reminder", [{ userId: o.placedByUserId, link: fresh.length === 1 ? `/buy/catalogue/offers/${fresh[0].offerId}#reviews` : "/buy/reviews" }], { product: fresh.length > 1 ? `${first} +${fresh.length - 1}` : first }).catch(() => null);
    sent++;
  }
  return { reminders: sent };
}

// re-exported for the pages
export type { BuyerType, SellerType };
