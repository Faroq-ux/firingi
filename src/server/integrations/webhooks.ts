/**
 * Outbound webhooks: a company's systems are told the moment something happens (new order for a
 * supplier, status changes, invoice issued, payment received, payout sent).
 *
 *  • Transactional outbox — `emitWebhook(tx, …)` writes a WebhookDelivery inside the same database
 *    transaction as the change, so an event is never lost nor sent for a change that rolled back.
 *  • The payload says what happened and which object (ids, number, status); details are read with
 *    the API (GET /api/v1/orders/{id} …) under the company's own permissions — nothing leaks.
 *  • Signed: "X-Firingi-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, t + '.' + body)>".
 *  • Retries after 1 min, 5 min, 30 min, 2 h, 6 h, 24 h; after 20 failures in a row the endpoint
 *    is switched off and the company is told.
 */
import "server-only";
import { createHmac, randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma, type Tx } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";
import { assertPublicUrl } from "./feeds";

/** Events a company can subscribe to, by who receives them. */
export const WEBHOOK_EVENTS = {
  "order.created": { for: "SUPPLIER", label: "New order to confirm" },
  "order.placed": { for: "BUYER", label: "Order placed" },
  "order.status_changed": { for: "BOTH", label: "Order status changed" },
  "invoice.issued": { for: "BUYER", label: "Invoice issued" },
  "payment.received": { for: "BUYER", label: "Payment received" },
  "payout.sent": { for: "SUPPLIER", label: "Payout sent" },
} as const;
export type WebhookEvent = keyof typeof WEBHOOK_EVENTS;
const BACKOFF_MIN = [1, 5, 30, 120, 360, 1440];
const DISABLE_AFTER = 20;

export const signPayload = (secret: string, body: string, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;

/** Events this company may use (suppliers get supplier events, buyers buyer events). */
export function eventsFor(type: string): WebhookEvent[] {
  const supplier = type === "DISTRIBUTOR" || type === "WHOLESALER", buyer = type === "CUSTOMER" || type === "WHOLESALER";
  return (Object.keys(WEBHOOK_EVENTS) as WebhookEvent[]).filter((e) => { const f = WEBHOOK_EVENTS[e].for; return f === "BOTH" || (f === "SUPPLIER" && supplier) || (f === "BUYER" && buyer); });
}

function requireManager(ctx: Ctx) {
  if (ctx.company.type === "ADMIN" || ctx.company.status !== "APPROVED" || !can(ctx, "company.integrations.manage")) throw new ForbiddenError();
}

// ── outbox ─────────────────────────────────────────────────────────────────

/** Queue an event for the company's subscribed endpoints (inside the caller's transaction). */
export async function emitWebhook(tx: Tx, companyId: string, event: WebhookEvent, data: Record<string, unknown>) {
  const endpoints = await tx.webhookEndpoint.findMany({ where: { companyId, active: true, events: { has: event } }, select: { id: true } });
  if (!endpoints.length) return 0;
  const at = new Date();
  await tx.webhookDelivery.createMany({ data: endpoints.map((e) => ({ endpointId: e.id, event, payload: { event, createdAt: at.toISOString(), data } as Prisma.InputJsonValue })) });
  kickWebhooks();
  return endpoints.length;
}

/** Order events for both sides of an order (call inside the order transaction). */
export async function emitOrderEvents(tx: Tx, orderId: string, change: { from?: string | null; to: string; reason?: string | null; placed?: boolean }) {
  const o = await tx.order.findUnique({ where: { id: orderId }, select: { id: true, number: true, buyerCompanyId: true, sellerCompanyId: true, awaitingPayment: true } });
  if (!o) return;
  const base = { orderId: o.id, number: o.number, status: change.to, previousStatus: change.from ?? null, reason: change.reason ?? null };
  if (change.placed) await emitWebhook(tx, o.buyerCompanyId, "order.placed", base);
  else await emitWebhook(tx, o.buyerCompanyId, "order.status_changed", base);
  // The supplier only hears about an order once it may see it (not while FIRINGI holds it).
  if (change.to === "PENDING_CONFIRMATION") await emitWebhook(tx, o.sellerCompanyId, "order.created", base);
  else if (change.from && change.from !== "ON_HOLD" && change.from !== "NEW") await emitWebhook(tx, o.sellerCompanyId, "order.status_changed", base);
}

let kickTimer: NodeJS.Timeout | null = null;
/** Send queued deliveries soon (after the transaction committed); the job retries the rest. */
export function kickWebhooks() {
  if (kickTimer) return;
  // Shortly after — by then the caller's transaction has committed; anything missed goes with the job.
  kickTimer = setTimeout(() => { kickTimer = null; void processWebhooks().catch(() => null); }, 1500);
  kickTimer.unref?.();
}

// ── sending ────────────────────────────────────────────────────────────────

async function deliver(d: { id: string; event: string; payload: unknown; attempts: number; endpoint: { id: string; url: string; secret: string; companyId: string; failureStreak: number } }) {
  const body = JSON.stringify({ id: d.id, ...(d.payload as object) });
  let code: number | null = null, text = "";
  try {
    await assertPublicUrl(d.endpoint.url);
    const res = await fetch(d.endpoint.url, {
      method: "POST", redirect: "manual", signal: AbortSignal.timeout(10_000), body,
      headers: { "content-type": "application/json", "user-agent": "FIRINGI-webhooks/1.0", "x-firingi-event": d.event, "x-firingi-delivery": d.id, "x-firingi-signature": signPayload(d.endpoint.secret, body) },
    });
    code = res.status;
    text = (await res.text().catch(() => "")).slice(0, 500);
  } catch (e) {
    text = (e instanceof Error ? e.message : String(e)).slice(0, 500);
  }
  const ok = code !== null && code >= 200 && code < 300;
  const attempts = d.attempts + 1;
  if (ok) {
    await prisma.$transaction([
      prisma.webhookDelivery.update({ where: { id: d.id }, data: { status: "SENT", attempts, sentAt: new Date(), responseCode: code, responseBody: text } }),
      prisma.webhookEndpoint.update({ where: { id: d.endpoint.id }, data: { lastSuccessAt: new Date(), failureStreak: 0 } }),
    ]);
    return true;
  }
  const done = attempts >= BACKOFF_MIN.length;
  const streak = d.endpoint.failureStreak + 1;
  await prisma.$transaction([
    prisma.webhookDelivery.update({ where: { id: d.id }, data: { status: done ? "FAILED" : "PENDING", attempts, responseCode: code, responseBody: text, nextAttemptAt: new Date(Date.now() + BACKOFF_MIN[Math.min(attempts, BACKOFF_MIN.length) - 1] * 60_000) } }),
    prisma.webhookEndpoint.update({ where: { id: d.endpoint.id }, data: { lastFailureAt: new Date(), failureStreak: streak, ...(streak >= DISABLE_AFTER ? { active: false, disabledReason: `Switched off after ${streak} failed deliveries (last: ${code ?? text})` } : {}) } }),
  ]);
  if (streak === DISABLE_AFTER) {
    const { notify } = await import("@/server/notify/dispatch");
    const type = (await prisma.company.findUnique({ where: { id: d.endpoint.companyId }, select: { type: true } }))?.type;
    const link = type === "CUSTOMER" ? "/buy/company/integrations" : "/vendor/company/integrations";
    await notify("integration.webhook_disabled", [{ companyId: d.endpoint.companyId, link }], { url: d.endpoint.url, reason: String(code ?? text).slice(0, 120) });
  }
  return false;
}

/** The integrations job: send what is due. */
export async function processWebhooks(now = new Date(), limit = 200) {
  const due = await prisma.webhookDelivery.findMany({
    where: { status: "PENDING", nextAttemptAt: { lte: now }, endpoint: { active: true } },
    include: { endpoint: { select: { id: true, url: true, secret: true, companyId: true, failureStreak: true } } },
    orderBy: { nextAttemptAt: "asc" }, take: limit,
  });
  let sent = 0, failed = 0;
  for (const d of due) {
    // Claim it (another worker / kick may be sending the same batch).
    const claimed = await prisma.webhookDelivery.updateMany({ where: { id: d.id, status: "PENDING", attempts: d.attempts }, data: { nextAttemptAt: new Date(Date.now() + 5 * 60_000) } });
    if (!claimed.count) continue;
    if (await deliver(d)) sent++; else failed++;
  }
  return { due: due.length, sent, failed };
}

// ── management (company portal) ────────────────────────────────────────────

export async function listEndpoints(ctx: Ctx) {
  requireManager(ctx);
  const rows = await prisma.webhookEndpoint.findMany({ where: { companyId: ctx.company.id }, orderBy: { createdAt: "asc" } });
  const recent = await prisma.webhookDelivery.findMany({ where: { endpointId: { in: rows.map((r) => r.id) } }, orderBy: { createdAt: "desc" }, take: 30, select: { id: true, endpointId: true, event: true, status: true, attempts: true, responseCode: true, createdAt: true, sentAt: true } });
  return { endpoints: rows.map(({ secret: _s, ...r }) => ({ ...r, secretHint: `${_s.slice(0, 10)}…` })), recent, events: eventsFor(ctx.company.type) };
}

export async function createEndpoint(ctx: Ctx, input: { url: string; events: string[] }) {
  requireManager(ctx);
  const url = (await assertPublicUrl(input.url.trim())).toString();
  const allowed = eventsFor(ctx.company.type);
  const events = [...new Set(input.events)].filter((e): e is WebhookEvent => allowed.includes(e as WebhookEvent));
  if (!events.length) throw new ValidationError("Choose at least one event.");
  if ((await prisma.webhookEndpoint.count({ where: { companyId: ctx.company.id } })) >= 10) throw new ValidationError("At most 10 endpoints.");
  const secret = `whsec_${randomBytes(24).toString("base64url")}`;
  const row = await prisma.webhookEndpoint.create({ data: { companyId: ctx.company.id, url, secret, events, createdById: ctx.user.id } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "webhook.created", entityType: "WebhookEndpoint", entityId: row.id, after: { url, events } });
  return { id: row.id, secret }; // shown once
}

async function own(ctx: Ctx, id: string) {
  const e = await prisma.webhookEndpoint.findFirst({ where: { id, companyId: ctx.company.id } });
  if (!e) throw new NotFoundError("Webhook");
  return e;
}

export async function setEndpointActive(ctx: Ctx, id: string, active: boolean) {
  requireManager(ctx);
  const e = await own(ctx, id);
  await prisma.webhookEndpoint.update({ where: { id: e.id }, data: { active, ...(active ? { failureStreak: 0, disabledReason: null } : {}) } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: active ? "webhook.enabled" : "webhook.disabled", entityType: "WebhookEndpoint", entityId: e.id });
}

export async function deleteEndpoint(ctx: Ctx, id: string) {
  requireManager(ctx);
  const e = await own(ctx, id);
  await prisma.webhookEndpoint.delete({ where: { id: e.id } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "webhook.deleted", entityType: "WebhookEndpoint", entityId: e.id, before: { url: e.url } });
}

/** Send a "ping" now and report what the endpoint answered. */
export async function sendTest(ctx: Ctx, id: string) {
  requireManager(ctx);
  const e = await own(ctx, id);
  const d = await prisma.webhookDelivery.create({ data: { endpointId: e.id, event: "ping", payload: { event: "ping", createdAt: new Date().toISOString(), data: { message: "Test from FIRINGI" } } } });
  const ok = await deliver({ ...d, endpoint: { id: e.id, url: e.url, secret: e.secret, companyId: e.companyId, failureStreak: e.failureStreak } });
  const after = await prisma.webhookDelivery.findUniqueOrThrow({ where: { id: d.id } });
  return { ok, status: after.responseCode, body: after.responseBody };
}

/** Keep 90 days of API calls and 30 days of delivered webhooks (failed ones 90 days). */
export async function pruneIntegrationLogs(now = new Date()) {
  const d = (days: number) => new Date(now.getTime() - days * 86400_000);
  const [calls, sent, failed] = await Promise.all([
    prisma.apiCallLog.deleteMany({ where: { at: { lt: d(90) } } }),
    prisma.webhookDelivery.deleteMany({ where: { status: "SENT", createdAt: { lt: d(30) } } }),
    prisma.webhookDelivery.deleteMany({ where: { status: "FAILED", createdAt: { lt: d(90) } } }),
  ]);
  return { apiCalls: calls.count, webhooks: sent.count + failed.count };
}
