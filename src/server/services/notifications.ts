/**
 * Notifications for users (bell, preferences, push devices) and for FIRINGI's back office
 * (message log, channels, per-event channels, templates, test sends, inbound messages).
 * Sending itself lives in server/notify/dispatch.ts.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { MessageStatus, NotificationChannel, Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { UI_LOCALES } from "@/i18n/config";
import { CATEGORIES, EVENTS, OPTIONAL_CHANNELS, eventDef, messageKey, normalisePhone, type Category } from "@/server/notify/events";
import { deliverMessage, enabledChannels, eventChannelOverrides, processOutbox, renderEvent, SETTINGS_KEYS } from "@/server/notify/dispatch";
import { driverFor, providerStatus } from "@/server/notify/providers";
import { writeAudit } from "./audit";

// ── the signed-in user ──────────────────────────────────────────────────────

export async function myNotifications(ctx: Ctx, opts: { take?: number; unreadOnly?: boolean } = {}) {
  return prisma.notification.findMany({ where: { userId: ctx.user.id, ...(opts.unreadOnly ? { readAt: null } : {}) }, orderBy: { createdAt: "desc" }, take: opts.take ?? 50 });
}
export const unreadCount = (ctx: Ctx) => prisma.notification.count({ where: { userId: ctx.user.id, readAt: null } });

export async function markRead(ctx: Ctx, id: string | "ALL") {
  await prisma.notification.updateMany({ where: { userId: ctx.user.id, readAt: null, ...(id === "ALL" ? {} : { id }) }, data: { readAt: new Date() } });
}

/** Which channels make sense per category (some event in it uses the channel). */
function channelsOfCategory(c: Category): NotificationChannel[] {
  const evs = EVENTS.filter((e) => e.category === c);
  return OPTIONAL_CHANNELS.filter((ch) => evs.some((e) => e.channels.includes(ch)));
}

export async function myPreferences(ctx: Ctx) {
  const [rows, user, enabled, subs] = await Promise.all([
    prisma.notificationPreference.findMany({ where: { userId: ctx.user.id } }),
    prisma.user.findUniqueOrThrow({ where: { id: ctx.user.id }, select: { phone: true, smsConsentAt: true, whatsappConsentAt: true } }),
    enabledChannels(),
    prisma.pushSubscription.count({ where: { userId: ctx.user.id } }),
  ]);
  const categories: { category: Category | "marketing"; critical: boolean; channels: { channel: NotificationChannel; enabled: boolean }[] }[] = CATEGORIES.map((category) => ({
    category,
    critical: EVENTS.some((e) => e.category === category && e.critical),
    channels: channelsOfCategory(category).filter((ch) => enabled.has(ch)).map((channel) => ({
      channel, enabled: rows.find((r) => r.category === category && r.channel === channel)?.enabled ?? true,
    })),
  })).filter((c) => c.channels.length > 0);
  // Offers & news (marketing campaigns): on unless switched off; in-app too.
  categories.push({
    category: "marketing", critical: false,
    channels: (["IN_APP", ...OPTIONAL_CHANNELS] as NotificationChannel[]).filter((ch) => ch === "IN_APP" || enabled.has(ch)).map((channel) => ({
      channel, enabled: rows.find((r) => r.category === "marketing" && r.channel === channel)?.enabled ?? true,
    })),
  });
  return { categories, phone: user.phone ?? "", smsConsent: !!user.smsConsentAt, whatsappConsent: !!user.whatsappConsentAt, pushDevices: subs, vapidPublicKey: process.env.VAPID_PUBLIC_KEY ?? null };
}

export async function savePreferences(ctx: Ctx, input: { prefs: { category: string; channel: NotificationChannel; enabled: boolean }[]; phone?: string | null; smsConsent: boolean; whatsappConsent: boolean }) {
  const phone = input.phone?.trim() ? normalisePhone(input.phone) : null;
  if (input.phone?.trim() && !phone) throw new ValidationError("Enter the mobile number with its country code, e.g. +351 912 345 678.");
  if ((input.smsConsent || input.whatsappConsent) && !phone) throw new ValidationError("Add your mobile number to receive SMS or WhatsApp.");
  const cur = await prisma.user.findUniqueOrThrow({ where: { id: ctx.user.id }, select: { smsConsentAt: true, whatsappConsentAt: true, phone: true } });
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    for (const p of input.prefs) {
      const marketing = p.category === "marketing" && (p.channel === "IN_APP" || OPTIONAL_CHANNELS.includes(p.channel));
      if (!marketing && (!(CATEGORIES as readonly string[]).includes(p.category) || !OPTIONAL_CHANNELS.includes(p.channel))) continue;
      await tx.notificationPreference.upsert({
        where: { userId_category_channel: { userId: ctx.user.id, category: p.category, channel: p.channel } },
        update: { enabled: p.enabled }, create: { userId: ctx.user.id, category: p.category, channel: p.channel, enabled: p.enabled },
      });
    }
    const samePhone = phone === cur.phone;
    await tx.user.update({
      where: { id: ctx.user.id },
      data: {
        phone,
        // Consent belongs to a number: changing the number asks for it again.
        smsConsentAt: input.smsConsent ? (samePhone && cur.smsConsentAt ? cur.smsConsentAt : now) : null,
        whatsappConsentAt: input.whatsappConsent ? (samePhone && cur.whatsappConsentAt ? cur.whatsappConsentAt : now) : null,
      },
    });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "notifications.preferences", entityType: "User", entityId: ctx.user.id, after: { sms: input.smsConsent, whatsapp: input.whatsappConsent, phoneChanged: !samePhone } }, tx);
  });
}

export async function subscribePush(ctx: Ctx, sub: { endpoint: string; p256dh: string; auth: string; userAgent?: string | null }) {
  if (!/^https:\/\//.test(sub.endpoint) || sub.endpoint.length > 1000) throw new ValidationError("Invalid push subscription.");
  await prisma.pushSubscription.upsert({
    where: { endpoint: sub.endpoint },
    update: { userId: ctx.user.id, p256dh: sub.p256dh, auth: sub.auth, userAgent: sub.userAgent ?? null },
    create: { userId: ctx.user.id, endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth, userAgent: sub.userAgent ?? null },
  });
}
export async function unsubscribePush(ctx: Ctx, endpoint: string) {
  await prisma.pushSubscription.deleteMany({ where: { userId: ctx.user.id, endpoint } });
}

// ── back office ─────────────────────────────────────────────────────────────

function requireMessages(ctx: Ctx) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, ["admin.messages.manage", "admin.notifications.manage"])) throw new ForbiddenError();
}
function requireAdmin(ctx: Ctx, manage = false) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, manage ? "admin.notifications.manage" : ["admin.notifications.view", "admin.notifications.manage"])) throw new ForbiddenError();
}

export async function listMessages(ctx: Ctx, f: { channel?: NotificationChannel; status?: MessageStatus; eventKey?: string; q?: string; take?: number } = {}) {
  requireAdmin(ctx);
  const where: Prisma.NotificationMessageWhereInput = {
    ...(f.channel ? { channel: f.channel } : {}), ...(f.status ? { status: f.status } : {}), ...(f.eventKey ? { eventKey: f.eventKey } : {}),
    ...(f.q ? { OR: [{ to: { contains: f.q, mode: "insensitive" } }, { subject: { contains: f.q, mode: "insensitive" } }] } : {}),
  };
  return prisma.notificationMessage.findMany({ where, orderBy: { createdAt: "desc" }, take: f.take ?? 200, include: { user: { select: { name: true } } } });
}

export async function messageStats(ctx: Ctx, days = 7) {
  requireAdmin(ctx);
  const rows = await prisma.notificationMessage.groupBy({ by: ["channel", "status"], where: { createdAt: { gte: new Date(Date.now() - days * 86400_000) } }, _count: { _all: true } });
  return rows.map((r) => ({ channel: r.channel, status: r.status, n: r._count._all }));
}

export async function retryMessage(ctx: Ctx, id: string) {
  requireAdmin(ctx, true);
  const m = await prisma.notificationMessage.findUnique({ where: { id } });
  if (!m) throw new NotFoundError("Message");
  if (m.status !== "FAILED") throw new AppError("NOT_FAILED", "Only failed messages can be retried.", 409);
  await prisma.notificationMessage.update({ where: { id }, data: { attempts: 0, nextAttemptAt: null } });
  return deliverMessage(id);
}
export async function runOutbox(ctx: Ctx) {
  requireAdmin(ctx, true);
  return processOutbox();
}

export async function channelsOverview(ctx: Ctx) {
  requireAdmin(ctx);
  const enabled = await enabledChannels();
  return OPTIONAL_CHANNELS.map((channel) => ({ channel, enabled: enabled.has(channel), ...providerStatus(channel) }));
}

export async function setChannelEnabled(ctx: Ctx, channel: NotificationChannel, enabled: boolean) {
  requireAdmin(ctx, true);
  if (!OPTIONAL_CHANNELS.includes(channel)) throw new ValidationError("Unknown channel.");
  const cur = await enabledChannels();
  const value = Object.fromEntries(OPTIONAL_CHANNELS.map((c) => [c, c === channel ? enabled : cur.has(c)]));
  await prisma.$transaction(async (tx) => {
    await tx.setting.upsert({ where: { scope_scopeId_key: { scope: "GLOBAL", scopeId: "", key: SETTINGS_KEYS.SETTING_CHANNELS } }, update: { value, updatedById: ctx.user.id }, create: { scope: "GLOBAL", scopeId: "", key: SETTINGS_KEYS.SETTING_CHANNELS, value, updatedById: ctx.user.id } });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "notifications.channel", entityType: "Setting", entityId: channel, after: { enabled } }, tx);
  });
}

export async function eventSettings(ctx: Ctx) {
  requireAdmin(ctx);
  const o = await eventChannelOverrides();
  return EVENTS.map((e) => ({ ...e, current: o[e.key] ?? e.channels, overridden: !!o[e.key] }));
}

export async function setEventChannels(ctx: Ctx, eventKey: string, channels: NotificationChannel[] | null) {
  requireAdmin(ctx, true);
  eventDef(eventKey);
  const o = await eventChannelOverrides();
  if (channels === null) delete o[eventKey];
  else o[eventKey] = channels.filter((c) => OPTIONAL_CHANNELS.includes(c));
  await prisma.$transaction(async (tx) => {
    const value = o as Prisma.InputJsonValue;
    await tx.setting.upsert({ where: { scope_scopeId_key: { scope: "GLOBAL", scopeId: "", key: SETTINGS_KEYS.SETTING_EVENTS } }, update: { value, updatedById: ctx.user.id }, create: { scope: "GLOBAL", scopeId: "", key: SETTINGS_KEYS.SETTING_EVENTS, value, updatedById: ctx.user.id } });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "notifications.event_channels", entityType: "Setting", entityId: eventKey, after: { channels } }, tx);
  });
}

/** Sample values for previews. */
const SAMPLE: Record<string, string> = {
  number: "FO-2026-000123", buyer: "Kebab House", supplier: "Lisboa Central", total: "156,00 €", reason: "…", document: "FT FIR2026/42", product: "Mozzarella 2 kg",
  restriction: "tobacco", until: "2027-12-31", customer: "Kebab House", address: "Rua da Madalena 120, 1100-319 Lisboa", promotion: "Summer cheese week", share: "50",
};

export async function templateEditor(ctx: Ctx, eventKey: string, channel: NotificationChannel, locale: string) {
  requireAdmin(ctx);
  const def = eventDef(eventKey);
  if (!(UI_LOCALES as readonly string[]).includes(locale)) throw new ValidationError("Unknown language.");
  const [tpl, defaults] = await Promise.all([
    prisma.notificationTemplate.findUnique({ where: { eventKey_channel_locale: { eventKey, channel, locale } } }),
    import(`@/messages/${locale}.json`).then((m) => (m.default.notify?.[messageKey(eventKey)] as { title: string; body: string } | undefined) ?? null),
  ]);
  const vars = Object.fromEntries(def.vars.map((v) => [v, SAMPLE[v] ?? v]));
  return { def, template: tpl, defaults, preview: await renderEvent(eventKey, channel, locale, vars) };
}

export async function saveTemplate(ctx: Ctx, input: { eventKey: string; channel: NotificationChannel; locale: string; subject?: string | null; body: string; waTemplateName?: string | null; waLanguage?: string | null; isActive: boolean }) {
  requireAdmin(ctx, true);
  const def = eventDef(input.eventKey);
  if (!(UI_LOCALES as readonly string[]).includes(input.locale)) throw new ValidationError("Unknown language.");
  const body = input.body.trim();
  if (!body) throw new ValidationError("The message can't be empty.");
  if (input.channel === "SMS" && body.length > 480) throw new ValidationError("Keep SMS under 480 characters (3 messages).");
  const unknown = [...`${input.subject ?? ""} ${body}`.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).filter((v) => !def.vars.includes(v));
  if (unknown.length) throw new ValidationError(`Unknown placeholder(s): ${[...new Set(unknown)].map((v) => `{${v}}`).join(", ")}. Available: ${def.vars.map((v) => `{${v}}`).join(", ") || "none"}.`);
  const data = { subject: input.subject?.trim() || null, body, waTemplateName: input.waTemplateName?.trim() || null, waLanguage: input.waLanguage?.trim() || null, isActive: input.isActive, updatedById: ctx.user.id };
  await prisma.$transaction(async (tx) => {
    const t = await tx.notificationTemplate.upsert({
      where: { eventKey_channel_locale: { eventKey: input.eventKey, channel: input.channel, locale: input.locale } },
      update: data, create: { eventKey: input.eventKey, channel: input.channel, locale: input.locale, ...data },
    });
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "notifications.template_saved", entityType: "NotificationTemplate", entityId: t.id, after: { eventKey: input.eventKey, channel: input.channel, locale: input.locale } }, tx);
  });
}

export async function resetTemplate(ctx: Ctx, eventKey: string, channel: NotificationChannel, locale: string) {
  requireAdmin(ctx, true);
  await prisma.notificationTemplate.deleteMany({ where: { eventKey, channel, locale } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "notifications.template_reset", entityType: "NotificationTemplate", entityId: `${eventKey}/${channel}/${locale}` });
}

export async function listOverrides(ctx: Ctx) {
  requireAdmin(ctx);
  return prisma.notificationTemplate.findMany({ orderBy: [{ eventKey: "asc" }, { channel: "asc" }, { locale: "asc" }] });
}

/** Send a test message to any address / number (log driver in development). */
export async function testSend(ctx: Ctx, channel: NotificationChannel, to: string, text: string) {
  requireAdmin(ctx, true);
  const addr = channel === "EMAIL" ? to.trim() : normalisePhone(to);
  if (!addr || (channel === "EMAIL" && !/^\S+@\S+\.\S+$/.test(addr))) throw new ValidationError(channel === "EMAIL" ? "Enter an e-mail address." : "Enter a mobile number with country code.");
  if (channel === "PUSH") throw new ValidationError("Push tests are sent to your own devices from your notification settings.");
  const row = await prisma.notificationMessage.create({
    data: { eventKey: "manual.test", channel, to: addr, locale: "en", subject: "FIRINGI test", body: text.trim() || "FIRINGI test message", provider: driverFor(channel), userId: null, companyId: null },
  });
  return deliverMessage(row.id);
}

// ── inbound messages (SMS / WhatsApp) ───────────────────────────────────────

export type Audience = "CUSTOMER" | "VENDOR" | "DRIVER" | "UNKNOWN";

async function audienceOf(userId: string | null): Promise<Audience> {
  if (!userId) return "UNKNOWN";
  const u = await prisma.user.findUnique({ where: { id: userId }, include: { driver: { select: { id: true } }, memberships: { where: { status: "ACTIVE" }, include: { company: { select: { type: true } } } } } });
  if (!u) return "UNKNOWN";
  if (u.driver) return "DRIVER";
  if (u.memberships.some((m) => m.company.type === "DISTRIBUTOR" || m.company.type === "WHOLESALER")) return "VENDOR";
  if (u.memberships.some((m) => m.company.type === "CUSTOMER")) return "CUSTOMER";
  return "UNKNOWN";
}

/** Conversations (one per phone number) for an audience, newest first. */
export async function inbox(ctx: Ctx, audience: Audience | "ALL") {
  requireAdmin(ctx);
  const msgs = await prisma.inboundMessage.findMany({ orderBy: { receivedAt: "desc" }, take: 500, include: { user: { select: { id: true, name: true, memberships: { take: 1, include: { company: { select: { legalName: true, tradeName: true } } } } } } } });
  const byFrom = new Map<string, { from: string; channel: NotificationChannel; user: (typeof msgs)[number]["user"]; last: (typeof msgs)[number]; unhandled: number; audience: Audience }>();
  for (const m of msgs) {
    const cur = byFrom.get(m.from);
    if (cur) { if (!m.handledAt) cur.unhandled++; continue; }
    byFrom.set(m.from, { from: m.from, channel: m.channel, user: m.user, last: m, unhandled: m.handledAt ? 0 : 1, audience: await audienceOf(m.userId) });
  }
  return [...byFrom.values()].filter((c) => audience === "ALL" || c.audience === audience || (audience === "CUSTOMER" && c.audience === "UNKNOWN"));
}

export async function conversation(ctx: Ctx, from: string) {
  requireAdmin(ctx);
  const [inbound, outbound] = await Promise.all([
    prisma.inboundMessage.findMany({ where: { from }, orderBy: { receivedAt: "asc" }, take: 200 }),
    prisma.notificationMessage.findMany({ where: { to: from, channel: { in: ["SMS", "WHATSAPP"] } }, orderBy: { createdAt: "asc" }, take: 200 }),
  ]);
  const items = [
    ...inbound.map((m) => ({ id: m.id, dir: "in" as const, at: m.receivedAt, body: m.body, channel: m.channel, status: null as MessageStatus | null })),
    ...outbound.map((m) => ({ id: m.id, dir: "out" as const, at: m.createdAt, body: m.body, channel: m.channel, status: m.status })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());
  const lastIn = inbound.filter((m) => m.channel === "WHATSAPP").at(-1)?.receivedAt ?? null;
  return { from, items, whatsappWindowOpen: !!lastIn && Date.now() - lastIn.getTime() < 24 * 3600_000, userId: inbound.find((m) => m.userId)?.userId ?? null };
}

/** FIRINGI staff reply. WhatsApp free text only inside the customer's 24-hour window. */
export async function reply(ctx: Ctx, from: string, channel: "SMS" | "WHATSAPP", text: string) {
  requireMessages(ctx);
  const body = text.trim();
  if (!body) throw new ValidationError("Write a message.");
  const conv = await conversation(ctx, from);
  if (channel === "WHATSAPP" && !conv.whatsappWindowOpen)
    throw new AppError("WA_WINDOW_CLOSED", "WhatsApp only allows free-text replies within 24 hours of the customer's last message. Use an approved template instead.", 409);
  const row = await prisma.notificationMessage.create({
    data: { eventKey: "manual.reply", channel, to: from, locale: "en", body, provider: driverFor(channel), userId: conv.userId, refType: "InboundConversation", refId: from },
  });
  await prisma.inboundMessage.updateMany({ where: { from, handledAt: null }, data: { handledAt: new Date(), handledById: ctx.user.id } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "notifications.reply", entityType: "NotificationMessage", entityId: row.id, after: { to: from, channel } });
  return deliverMessage(row.id);
}

export async function markHandled(ctx: Ctx, from: string) {
  requireMessages(ctx);
  await prisma.inboundMessage.updateMany({ where: { from, handledAt: null }, data: { handledAt: new Date(), handledById: ctx.user.id } });
}

// ── provider webhooks (no session; verified by signature) ───────────────────

const STATUS: Record<string, MessageStatus> = { queued: "QUEUED", accepted: "QUEUED", sending: "QUEUED", sent: "SENT", delivered: "DELIVERED", read: "READ", failed: "FAILED", undelivered: "FAILED" };

async function updateStatus(providerMessageId: string, raw: string, error?: string | null) {
  const status = STATUS[raw.toLowerCase()];
  if (!status) return;
  const now = new Date();
  await prisma.notificationMessage.updateMany({
    where: { providerMessageId },
    data: { status, ...(status === "DELIVERED" ? { deliveredAt: now } : {}), ...(status === "READ" ? { readAt: now } : {}), ...(error ? { error: error.slice(0, 500), nextAttemptAt: null } : {}) },
  });
}

type InboundExtra = { kind?: "TEXT" | "AUDIO" | "IMAGE" | "BUTTON" | "OTHER"; mediaType?: string | null };
/** Store an inbound SMS / WhatsApp; Phase 58: WhatsApp messages are queued for the ordering AI. Returns the new id. */
async function storeInbound(channel: NotificationChannel, rawFrom: string, body: string, providerMessageId: string | null, mediaUrl?: string | null, extra: InboundExtra = {}): Promise<string | null> {
  const from = normalisePhone(rawFrom.replace(/^whatsapp:/, "").replace(/^(\d)/, "+$1"));
  if (!from) return null;
  if (providerMessageId && (await prisma.inboundMessage.findUnique({ where: { providerMessageId } }))) return null; // provider retries
  let userId: string | null = null, companyId: string | null = null;
  const user = await prisma.user.findFirst({ where: { phone: from }, select: { id: true, memberships: { where: { status: "ACTIVE" }, take: 1, select: { companyId: true } } } });
  if (user) { userId = user.id; companyId = user.memberships[0]?.companyId ?? null; }
  else if (channel === "WHATSAPP") {
    // Phase 56: a business's own WhatsApp number (given at registration or in its profile) → that business and its owner
    const company = await prisma.company.findFirst({ where: { whatsapp: from }, select: { id: true, memberships: { where: { status: "ACTIVE", isOwner: true }, take: 1, select: { userId: true } } } });
    if (company) { companyId = company.id; userId = company.memberships[0]?.userId ?? null; }
  }
  const row = await prisma.inboundMessage.create({ data: { channel, from, body: body.slice(0, 4000), mediaUrl: mediaUrl ?? null, providerMessageId, userId, companyId, kind: extra.kind ?? "TEXT", mediaType: extra.mediaType ?? null, ...(channel === "WHATSAPP" ? { aiStatus: "PENDING" } : {}) } });
  return channel === "WHATSAPP" ? row.id : null;
}

/** Tests and the e2e helper: an inbound WhatsApp as the providers deliver it (no signature). */
export const storeInboundForTests = storeInbound;

/** Twilio: X-Twilio-Signature = base64(HMAC-SHA1(authToken, url + sorted key+value pairs)). */
export function twilioSignatureValid(url: string, params: Record<string, string>, signature: string, token: string) {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  const expected = createHmac("sha1", token).update(data).digest("base64");
  return expected.length === signature.length && timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

/** Returns the id of a stored inbound WhatsApp (for the ordering AI) or null. */
export async function handleTwilio(params: Record<string, string>): Promise<string | null> {
  if (params.MessageStatus && params.MessageSid && params.Body === undefined) { await updateStatus(params.MessageSid, params.MessageStatus, params.ErrorMessage ?? (params.ErrorCode ? `Twilio error ${params.ErrorCode}` : null)); return null; }
  if (params.From && params.Body !== undefined) {
    const mime = params.MediaContentType0 ?? null;
    const kind = params.ButtonPayload ? "BUTTON" : mime?.startsWith("audio") ? "AUDIO" : mime?.startsWith("image") ? "IMAGE" : params.MediaUrl0 ? "OTHER" : "TEXT";
    return storeInbound(params.From.startsWith("whatsapp:") ? "WHATSAPP" : "SMS", params.From, params.ButtonPayload ?? params.Body, params.MessageSid ?? null, params.MediaUrl0 ?? null, { kind, mediaType: mime });
  }
  return null;
}

/** Meta: X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(appSecret, raw body). */
export function metaSignatureValid(rawBody: string, signature: string, secret: string) {
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  return expected.length === signature.length && timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

type MetaMedia = { id: string; mime_type?: string; caption?: string };
type MetaBody = { entry?: { changes?: { value?: { statuses?: { id: string; status: string; errors?: { title?: string }[] }[]; messages?: { id: string; from: string; type: string; text?: { body: string }; audio?: MetaMedia; voice?: MetaMedia; image?: MetaMedia; interactive?: { button_reply?: { id: string; title: string }; list_reply?: { id: string; title: string } }; button?: { payload?: string; text?: string } }[] } }[] }[] };
/** Returns the ids of stored inbound WhatsApp messages (for the ordering AI). */
export async function handleMeta(body: MetaBody): Promise<string[]> {
  const ids: string[] = [];
  for (const e of body.entry ?? [])
    for (const c of e.changes ?? []) {
      for (const s of c.value?.statuses ?? []) await updateStatus(s.id, s.status, s.errors?.[0]?.title ?? null);
      for (const m of c.value?.messages ?? []) {
        const audio = m.audio ?? m.voice;
        const id = m.type === "text" ? await storeInbound("WHATSAPP", m.from, m.text?.body ?? "", m.id)
          : audio ? await storeInbound("WHATSAPP", m.from, "[voice note]", m.id, `meta:${audio.id}`, { kind: "AUDIO", mediaType: audio.mime_type ?? "audio/ogg" })
          : m.image ? await storeInbound("WHATSAPP", m.from, m.image.caption ?? "[image]", m.id, `meta:${m.image.id}`, { kind: "IMAGE", mediaType: m.image.mime_type ?? "image/jpeg" })
          : m.interactive ? await storeInbound("WHATSAPP", m.from, m.interactive.button_reply?.id ?? m.interactive.list_reply?.id ?? "", m.id, null, { kind: "BUTTON" })
          : m.button ? await storeInbound("WHATSAPP", m.from, m.button.payload ?? m.button.text ?? "", m.id, null, { kind: "BUTTON" })
          : await storeInbound("WHATSAPP", m.from, `[${m.type}]`, m.id, null, { kind: "OTHER" });
        if (id) ids.push(id);
      }
    }
  return ids;
}
