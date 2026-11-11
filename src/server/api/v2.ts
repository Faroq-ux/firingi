/**
 * FIRINGI JSON API v2 — the shared part of every /api/v2 route:
 *  • who calls: an API key ("Authorization: Bearer fk_live_…", acting as one company user, limited
 *    to the key's scopes AND that user's permissions) or a signed-in browser session;
 *  • the scope a route needs (a key without it gets 403 with the scope's name);
 *  • a rate limit per key (API_RATE_LIMIT_PER_MIN, default 120 calls a minute → 429 + Retry-After);
 *  • a call log per key (method, path, status, time) shown to the company;
 *  • errors as { error: { code, message } } with the right HTTP status.
 * And what the API shows: an explicit list of fields per side, so a buyer never sees FIRINGI's
 * commission or the supplier's payout, and a supplier never sees FIRINGI's margin.
 */
import Decimal from "decimal.js";
import { ZodError, type z } from "zod";
import { prisma } from "@/server/db";
import { getContext, type Ctx } from "@/server/context";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import type { Scope } from "@/server/services/api-keys";

type Params = Record<string, string>;
type Handler = (ctx: Ctx, req: Request, params: Params) => Promise<unknown>;

const LIMIT = () => Math.max(1, Number(process.env.API_RATE_LIMIT_PER_MIN) || 120);
const windows = new Map<string, number[]>();

/** Sliding one-minute window per key. In memory: with several app servers each counts its own. */
export function rateLimit(keyId: string, now = Date.now()) {
  const recent = (windows.get(keyId) ?? []).filter((t) => now - t < 60_000);
  const limit = LIMIT();
  if (recent.length >= limit) {
    windows.set(keyId, recent);
    return { ok: false as const, limit, remaining: 0, retryAfter: Math.ceil((recent[0] + 60_000 - now) / 1000) };
  }
  recent.push(now);
  windows.set(keyId, recent);
  if (windows.size > 5000) for (const [k, v] of windows) if (!v.length || now - v[v.length - 1] > 60_000) windows.delete(k);
  return { ok: true as const, limit, remaining: limit - recent.length };
}

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { "cache-control": "private, no-store", ...extra } });

export const apiError = (code: string, message: string, status: number, extra: Record<string, string> = {}, more: Record<string, unknown> = {}) =>
  json({ error: { code, message, ...more } }, status, extra);

/** Wrap a route: authenticate, check the scope, rate-limit, log, map errors. */
export function apiRoute(scope: Scope | null, fn: Handler) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Next.js checks the route context type per route
  return async (req: Request, ctxArg: { params: Promise<any> }) => {
    const t0 = Date.now();
    const url = new URL(req.url);
    const ctx = await getContext();
    if (!ctx) return apiError("UNAUTHORIZED", "Send a valid API key: Authorization: Bearer fk_live_…", 401, { "www-authenticate": "Bearer" });
    const keyId = ctx.sessionId.startsWith("api:") ? ctx.sessionId.slice(4) : null;
    let headers: Record<string, string> = {};
    if (keyId) {
      const rl = rateLimit(keyId);
      headers = { "x-ratelimit-limit": String(rl.limit), "x-ratelimit-remaining": String(rl.remaining) };
      if (!rl.ok) {
        await log(keyId, req.method, url.pathname, 429, t0);
        return apiError("RATE_LIMITED", `Too many calls — at most ${rl.limit} a minute.`, 429, { ...headers, "retry-after": String(rl.retryAfter) });
      }
    }
    let res: Response;
    try {
      if (keyId && scope) {
        const key = await prisma.apiKey.findUnique({ where: { id: keyId }, select: { scopes: true } });
        if (!key?.scopes.includes(scope)) throw new AppError("MISSING_SCOPE", `This key doesn't have the "${scope}" permission.`, 403);
      }
      const out = await fn(ctx, req, ((await ctxArg?.params) ?? {}) as Params);
      res = out instanceof Response ? out : json(out, req.method === "POST" && (out as { created?: boolean })?.created ? 201 : 200, headers);
    } catch (e) {
      res = toErrorResponse(e, headers);
    }
    if (keyId) await log(keyId, req.method, url.pathname, res.status, t0);
    return res;
  };
}

export function toErrorResponse(e: unknown, headers: Record<string, string> = {}) {
  if (e instanceof ZodError) return apiError("VALIDATION", "The request body isn't valid.", 400, headers, { issues: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
  if (e instanceof SyntaxError) return apiError("BAD_JSON", "The request body isn't valid JSON.", 400, headers);
  if (e instanceof AppError) return apiError(e.code, e.message, e.status, headers, e.details ? { details: e.details } : {});
  console.error("[api v2]", e);
  return apiError("INTERNAL", "Something went wrong on our side.", 500, headers);
}

async function log(apiKeyId: string, method: string, path: string, status: number, t0: number) {
  await prisma.apiCallLog.create({ data: { apiKeyId, method, path: path.slice(0, 200), status, ms: Date.now() - t0 } }).catch(() => null);
}

export async function body<S extends z.ZodTypeAny>(req: Request, schema: S): Promise<z.infer<S>> {
  const text = await req.text();
  if (text.length > 5 * 1024 * 1024) throw new ValidationError("The request body is larger than 5 MB.");
  return schema.parse(text ? JSON.parse(text) : {});
}

// ── what the API shows ─────────────────────────────────────────────────────

const money = (v: { toString(): string } | null | undefined) => (v == null ? null : new Decimal(v.toString()).toFixed(2));
const unit = (v: { toString(): string } | null | undefined) => (v == null ? null : new Decimal(v.toString()).toFixed(4));
const nameOf = (n: unknown) => { const o = (n ?? {}) as Record<string, string>; return o.en ?? o.pt ?? Object.values(o)[0] ?? ""; };

type OrderRow = {
  id: string; number: string; status: string; placedAt: Date; updatedAt: Date; currencyCode: string; deliveryMode: string | null; deliveryAddress: unknown;
  requestedDeliveryDate: Date | null; buyerNotes: string | null; awaitingPayment: boolean; couponCode: string | null; routedByFiringi: boolean;
  listNet: unknown; discountTotal: unknown; deliveryFeeNet: unknown; netTotal: unknown; vatTotal: unknown; grandTotal: unknown;
  commissionTotal?: unknown; vendorPayableNet?: unknown;
  buyer?: { legalName: string; tradeName: string | null; taxId?: string } | null; seller?: { legalName: string; tradeName: string | null } | null;
};

/** One order as the buyer or the supplier may see it. */
export function presentOrder(o: OrderRow, side: "BUYER" | "VENDOR" | "ADMIN") {
  const m = (v: unknown) => money(v as Decimal);
  const base = {
    id: o.id, number: o.number, status: o.status, placedAt: o.placedAt.toISOString(), updatedAt: o.updatedAt.toISOString(), currency: o.currencyCode,
    deliveryMode: o.deliveryMode, deliveryAddress: o.deliveryAddress, requestedDeliveryDate: o.requestedDeliveryDate?.toISOString() ?? null, buyerNotes: o.buyerNotes,
    totals: { listNet: m(o.listNet), discount: m(o.discountTotal), deliveryFeeNet: m(o.deliveryFeeNet), net: m(o.netTotal), vat: m(o.vatTotal), gross: m(o.grandTotal) },
  };
  if (side === "BUYER")
    return { ...base, awaitingPayment: o.awaitingPayment, couponCode: o.couponCode, supplier: o.routedByFiringi ? "FIRINGI" : (o.seller?.tradeName ?? o.seller?.legalName ?? null) };
  return { ...base, buyer: o.buyer ? { name: o.buyer.tradeName ?? o.buyer.legalName, taxId: o.buyer.taxId ?? null } : null, commission: m(o.commissionTotal), payableToYouNet: m(o.vendorPayableNet) };
}

type LineRow = {
  id: string; offerId: string; sku: string; productName: unknown; packagingName: unknown; qtyOrdered: number; qtyConfirmed: number | null; qtyDelivered: number | null;
  unitSalePriceNet: unknown; taxRate: unknown; lineNet: unknown; lineVat: unknown; vendorUnitCostNet?: unknown; vendorLineNet?: unknown; commissionAmount?: unknown;
};
export function presentLine(l: LineRow, side: "BUYER" | "VENDOR" | "ADMIN") {
  const base = {
    id: l.id, offerId: l.offerId, sku: l.sku, product: nameOf(l.productName), packaging: nameOf(l.packagingName), qtyOrdered: l.qtyOrdered, qtyConfirmed: l.qtyConfirmed, qtyDelivered: l.qtyDelivered,
    unitPriceNet: unit(l.unitSalePriceNet as Decimal), vatRate: String(l.taxRate), lineNet: money(l.lineNet as Decimal), lineVat: money(l.lineVat as Decimal),
  };
  if (side === "BUYER") return base;
  return { ...base, unitPayableNet: unit(l.vendorUnitCostNet as Decimal), linePayableNet: money(l.vendorLineNet as Decimal), commission: money(l.commissionAmount as Decimal) };
}

/** GET /api/v2/orders/{id}. */
export async function orderForApi(ctx: Ctx, id: string) {
  const { getOrder } = await import("@/server/services/orders");
  const { order, role, allowed } = await getOrder(ctx, id);
  const delivery = await prisma.delivery.findUnique({ where: { orderId: id }, select: { status: true, scheduledFor: true, eta: true, completedAt: true } }).catch(() => null);
  return {
    ...presentOrder(order, role),
    lines: order.lines.map((l) => presentLine(l, role)),
    history: order.statusHistory.map((h) => ({ from: h.fromStatus, to: h.toStatus, at: h.at.toISOString(), reason: h.reason })),
    delivery: delivery ? { status: delivery.status, scheduledFor: delivery.scheduledFor?.toISOString() ?? null, eta: delivery.eta?.toISOString() ?? null, completedAt: delivery.completedAt?.toISOString() ?? null } : null,
    nextStatuses: allowed,
  };
}

/** Which side of an order list the caller wants (?as=buyer|supplier). */
export function sideOf(ctx: Ctx, as: string | null): "BUYER" | "VENDOR" {
  if (as === "supplier" || as === "vendor") return "VENDOR";
  if (as === "buyer") return "BUYER";
  return ctx.company.type === "DISTRIBUTOR" ? "VENDOR" : "BUYER";
}

export function requireBuyer(ctx: Ctx) {
  if (ctx.company.type !== "CUSTOMER" && ctx.company.type !== "WHOLESALER") throw new ForbiddenError();
}

export { NotFoundError };
