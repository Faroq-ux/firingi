/**
 * Order risk at checkout, and FIRINGI's review of it.
 *
 *  • assessCheckout — gathers the facts for a checkout and scores it (see engine.ts)
 *  • recordRisk     — inside the order transaction: one RiskAssessment per order; HIGH → ON_HOLD
 *  • afterCheckout  — notifications (buyer told the order is being checked; reviewers alerted)
 *  • release / cancel a held order; mark a flagged order reviewed (cleared / fraud)
 *  • settings (thresholds, checks on/off) and the review queue
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { notify } from "@/server/notify/dispatch";
import { haversineKm } from "@/server/catalogue/distance";
import { writeAudit } from "@/server/services/audit";
import { applyOrderTransition, notifyHoldDecision } from "@/server/services/orders";
import { DEFAULT_RISK, RISK_RULES, scoreRisk, type RiskResult, type RiskRule, type RiskSettings } from "./engine";

type Tx = Prisma.TransactionClient;
const KEY = "risk.rules";
const WEBMAIL = new Set(["gmail.com", "hotmail.com", "outlook.com", "live.com", "yahoo.com", "icloud.com", "sapo.pt", "gmx.de", "web.de", "orange.fr", "free.fr", "libero.it", "proton.me", "protonmail.com"]);

export async function riskSettings(db: Tx | typeof prisma = prisma): Promise<RiskSettings> {
  const s = await db.setting.findUnique({ where: { scope_scopeId_key: { scope: "GLOBAL", scopeId: "", key: KEY } } });
  return { ...DEFAULT_RISK, ...((s?.value ?? {}) as Partial<RiskSettings>) };
}

export async function saveRiskSettings(ctx: Ctx, input: Partial<RiskSettings>) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, "admin.risk.manage")) throw new ForbiddenError();
  const cur = await riskSettings();
  const next: RiskSettings = { ...cur, ...input, disabledRules: (input.disabledRules ?? cur.disabledRules).filter((r) => RISK_RULES.some((x) => x.rule === r)) };
  const n = (v: number, min: number, what: string) => { if (!Number.isFinite(v) || v < min) throw new ValidationError(`${what} must be at least ${min}.`); };
  n(next.holdScore, 1, "Hold score"); n(next.flagScore, 1, "Review score"); n(next.newAccountDays, 0, "New account days"); n(next.bigOrderAmount, 1, "Big order amount");
  n(next.velocityOrders, 2, "Orders in a short time"); n(next.velocityMinutes, 1, "Minutes"); n(next.spikeFactor, 1, "Times the usual order"); n(next.farKm, 1, "Distance");
  if (next.flagScore > next.holdScore) throw new ValidationError("The review score must be at or below the hold score.");
  await prisma.setting.upsert({
    where: { scope_scopeId_key: { scope: "GLOBAL", scopeId: "", key: KEY } },
    update: { value: next as unknown as Prisma.InputJsonValue, updatedById: ctx.user.id }, create: { scope: "GLOBAL", key: KEY, value: next as unknown as Prisma.InputJsonValue, updatedById: ctx.user.id },
  });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "risk.settings", entityType: "Setting", entityId: KEY, before: cur, after: next });
  return next;
}

// ── at checkout ─────────────────────────────────────────────────────────────

/** Facts and score for a checkout (before the orders exist). */
export async function assessCheckout(ctx: Ctx, c: { gross: number; goods: number; addressId: string; couponCode: string | null }): Promise<RiskResult> {
  const settings = await riskSettings();
  if (!settings.enabled) return { score: 0, level: "LOW", reasons: [] };
  const now = Date.now();
  const since = new Date(now - settings.velocityMinutes * 60_000);
  const [company, user, address, head, prior, recent, last10] = await Promise.all([
    prisma.company.findUniqueOrThrow({ where: { id: ctx.company.id }, select: { approvedAt: true, createdAt: true, email: true, phone: true } }),
    prisma.user.findUniqueOrThrow({ where: { id: ctx.user.id }, select: { createdAt: true } }),
    prisma.address.findUnique({ where: { id: c.addressId }, select: { createdAt: true, latitude: true, longitude: true, line1: true, postalCode: true } }),
    prisma.address.findFirst({ where: { companyId: ctx.company.id, kind: "HEAD_OFFICE" }, select: { latitude: true, longitude: true } }),
    prisma.order.aggregate({ where: { buyerCompanyId: ctx.company.id, status: { not: "CANCELLED" } }, _count: { _all: true }, _avg: { netTotal: true } }),
    prisma.$queryRaw<{ n: number }[]>`SELECT count(DISTINCT COALESCE("checkoutId", id))::int AS n FROM "Order" WHERE "buyerCompanyId" = ${ctx.company.id} AND "placedAt" >= ${since}`,
    prisma.order.findMany({ where: { buyerCompanyId: ctx.company.id }, orderBy: { placedAt: "desc" }, take: 10, select: { status: true } }),
  ]);
  const ll = (a: { latitude: unknown; longitude: unknown } | null) => (a?.latitude != null && a.longitude != null ? { lat: Number(a.latitude), lng: Number(a.longitude) } : null);
  const a = ll(address), h = ll(head);
  let lookAlikes = 0;
  if (c.couponCode) {
    const others = await prisma.company.findMany({
      where: { id: { not: ctx.company.id }, redemptions: { some: { code: c.couponCode, order: { status: { not: "CANCELLED" } } } } },
      select: { email: true, phone: true, addresses: { select: { line1: true, postalCode: true } } },
    });
    const domain = (e: string | null) => { const d = e?.split("@")[1]?.toLowerCase(); return d && !WEBMAIL.has(d) ? d : null; };
    const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const myDomain = domain(company.email), myPhone = norm(company.phone).slice(-9);
    const myAddr = address ? `${norm(address.line1)}|${norm(address.postalCode)}` : null;
    lookAlikes = others.filter((o) => (myDomain && domain(o.email) === myDomain) || (myPhone.length >= 9 && norm(o.phone).slice(-9) === myPhone) || (myAddr && o.addresses.some((x) => `${norm(x.line1)}|${norm(x.postalCode)}` === myAddr))).length;
  }
  const approved = company.approvedAt ?? company.createdAt;
  return scoreRisk({
    checkoutGross: c.gross, checkoutGoods: c.goods, accountAgeDays: (now - approved.getTime()) / 86400_000,
    priorOrders: prior._count._all, priorAvgGoods: Number(prior._avg.netTotal ?? 0), recentCheckouts: recent[0]?.n ?? 0,
    recentCancelled: last10.filter((o) => o.status === "CANCELLED").length,
    addressKm: a && h ? haversineKm(a, h) : null, addressAgeHours: address ? (now - address.createdAt.getTime()) / 3600_000 : null,
    userAgeHours: (now - user.createdAt.getTime()) / 3600_000, userIsOwner: ctx.membership.isOwner, couponLookAlikes: lookAlikes,
  }, settings);
}

/** Inside the order transaction: record the check on each order. Returns true when the orders are held. */
export async function recordRisk(tx: Tx, risk: RiskResult, orders: { id: string; buyerCompanyId: string }[], checkoutId: string | null) {
  if (risk.score === 0) return false;
  const held = risk.level === "HIGH";
  for (const o of orders)
    await tx.riskAssessment.create({ data: { orderId: o.id, checkoutId, buyerCompanyId: o.buyerCompanyId, score: risk.score, level: risk.level, reasons: risk.reasons as unknown as Prisma.InputJsonValue, held } });
  return held;
}

/** After the checkout: the buyer is told a held order is being checked; reviewers get an alert. */
export async function afterCheckout(risk: RiskResult, orders: { id: string; number: string }[], buyerCompanyId: string, buyerName: string) {
  if (risk.level === "LOW") return;
  const admin = await prisma.company.findFirst({ where: { type: "ADMIN" }, select: { id: true } });
  for (const o of orders) {
    if (risk.level === "HIGH") await notify("order.held", [{ companyId: buyerCompanyId, link: `/buy/orders/${o.id}` }], { number: o.number }, { ref: { type: "Order", id: o.id } });
    if (admin) await notify(risk.level === "HIGH" ? "risk.order_held" : "risk.order_flagged", [{ companyId: admin.id, link: `/admin/risk/suspicious-orders?order=${o.id}` }], { number: o.number, company: buyerName, score: risk.score }, { ref: { type: "Order", id: o.id } });
  }
}

// ── review ──────────────────────────────────────────────────────────────────

function assertReviewer(ctx: Ctx) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, "admin.risk.manage")) throw new ForbiddenError();
}

/** Release a held order to its supplier, or cancel it (the buyer is told; the supplier never saw it). */
export async function decideHeld(ctx: Ctx, orderId: string, decision: "RELEASE" | "CANCEL", note: string | null) {
  assertReviewer(ctx);
  if (decision === "CANCEL" && !note?.trim()) throw new ValidationError("Give the reason (the customer sees it).");
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { lines: true } });
  if (!order) throw new NotFoundError("Order");
  if (order.status !== "ON_HOLD") throw new AppError("NOT_HELD", "This order isn't on hold any more.", 409);
  const to = decision === "RELEASE" ? "PENDING_CONFIRMATION" : "CANCELLED";
  // Checked, but the customer still has to pay first (pay-before-shipping): it stays on hold until paid.
  if (decision === "RELEASE" && order.awaitingPayment) {
    await prisma.riskAssessment.updateMany({ where: { orderId }, data: { review: "CLEARED", reviewedById: ctx.user.id, reviewedAt: new Date(), note: note?.trim() || null } });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "risk.cleared_awaiting_payment", entityType: "Order", entityId: orderId, after: { note } });
    return;
  }
  await prisma.$transaction(async (tx) => {
    await applyOrderTransition(tx, order, to, { reason: note?.trim() || (decision === "RELEASE" ? "Checked by FIRINGI" : null), userId: ctx.user.id, companyId: ctx.company.id });
    await tx.riskAssessment.updateMany({ where: { orderId }, data: { review: decision === "RELEASE" ? "CLEARED" : "FRAUD", reviewedById: ctx.user.id, reviewedAt: new Date(), note: note?.trim() || null } });
  });
  if (to === "CANCELLED") await (await import("@/server/payments/service")).refundOrderPrepayment(orderId).catch(() => null);
  await notifyHoldDecision(order, to, note, "ADMIN");
}

/** A flagged (not held) order: reviewed — fine, or fraud (FIRINGI then acts on the order itself). */
export async function reviewAssessment(ctx: Ctx, id: string, verdict: "CLEARED" | "FRAUD", note: string | null) {
  assertReviewer(ctx);
  const a = await prisma.riskAssessment.findUnique({ where: { id }, include: { order: { select: { status: true } } } });
  if (!a) throw new NotFoundError("Risk check");
  if (a.order.status === "ON_HOLD") throw new ValidationError("Release or cancel the held order instead.");
  if (verdict === "FRAUD" && !note?.trim()) throw new ValidationError("Note what was found.");
  await prisma.riskAssessment.update({ where: { id }, data: { review: verdict, reviewedById: ctx.user.id, reviewedAt: new Date(), note: note?.trim() || null } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: `risk.${verdict.toLowerCase()}`, entityType: "RiskAssessment", entityId: id, after: { note } });
}

export async function listAssessments(ctx: Ctx, f: { review?: "OPEN" | "CLEARED" | "FRAUD"; level?: "LOW" | "MEDIUM" | "HIGH" } = {}) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, ["admin.risk.view", "admin.risk.manage"])) throw new ForbiddenError();
  return prisma.riskAssessment.findMany({
    where: { ...(f.review ? { review: f.review } : {}), ...(f.level ? { level: f.level } : { level: { in: ["MEDIUM", "HIGH"] } }) },
    orderBy: [{ held: "desc" }, { createdAt: "desc" }], take: 200,
    include: { order: { select: { id: true, number: true, status: true, grandTotal: true, placedAt: true, buyer: { select: { id: true, legalName: true } }, seller: { select: { legalName: true } } } } },
  });
}

/** Fraud Detection overview: checks over a period by rule and outcome, and the riskiest customers. */
export async function riskOverview(ctx: Ctx, days = 30) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, ["admin.risk.view", "admin.risk.manage"])) throw new ForbiddenError();
  const since = new Date(Date.now() - days * 86400_000);
  const rows = await prisma.riskAssessment.findMany({ where: { createdAt: { gte: since } }, select: { level: true, held: true, review: true, reasons: true, buyerCompanyId: true, score: true, order: { select: { grandTotal: true } } } });
  const byRule = new Map<RiskRule, number>();
  for (const r of rows) for (const x of r.reasons as { rule: RiskRule }[]) byRule.set(x.rule, (byRule.get(x.rule) ?? 0) + 1);
  const byBuyer = new Map<string, { count: number; maxScore: number; fraud: number }>();
  for (const r of rows) { const b = byBuyer.get(r.buyerCompanyId) ?? { count: 0, maxScore: 0, fraud: 0 }; b.count++; b.maxScore = Math.max(b.maxScore, r.score); if (r.review === "FRAUD") b.fraud++; byBuyer.set(r.buyerCompanyId, b); }
  const buyers = await prisma.company.findMany({ where: { id: { in: [...byBuyer.keys()] } }, select: { id: true, legalName: true } });
  return {
    checks: rows.length, held: rows.filter((r) => r.held).length, flagged: rows.filter((r) => r.level === "MEDIUM").length,
    open: rows.filter((r) => r.review === "OPEN" && r.level !== "LOW").length, fraud: rows.filter((r) => r.review === "FRAUD").length,
    heldValue: rows.filter((r) => r.held).reduce((a, r) => a + Number(r.order.grandTotal), 0),
    byRule: RISK_RULES.map((x) => ({ ...x, count: byRule.get(x.rule) ?? 0 })),
    riskiest: [...byBuyer].map(([id, v]) => ({ id, name: buyers.find((b) => b.id === id)?.legalName ?? "", ...v })).sort((a, b) => b.maxScore - a.maxScore).slice(0, 10),
  };
}
