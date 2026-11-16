/**
 * Order chat (Phase 35). Conversations on an order, in up to four channels:
 *   BUYER_SUPPLIER   buyer and supplier (not on orders FIRINGI routed — there the buyer's seller is FIRINGI)
 *   BUYER_FIRINGI    buyer and FIRINGI
 *   SUPPLIER_FIRINGI supplier and FIRINGI (never shown to the buyer)
 *   DRIVER           the driver, the buyer and whoever runs the delivery; open while it is on the road
 * FIRINGI staff see every thread and can write in all of them. FIRINGI switches each channel on/off
 * (chat.settings) and the chat per company (CHAT). Phone numbers, e-mails, IBANs and links are hidden
 * and flagged (CHAT_MASK per company, on by default); the original stays visible to FIRINGI only.
 * Messages are translated into each reader's language with AI when a key is set (cached per message).
 * Nobody sees prices here — the chat carries only text and photos.
 */
import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { ChatChannel, ChatSide, Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";
import { companyFeatureOn } from "@/server/accounting/features";
import { notify } from "@/server/notify/dispatch";
import { storeUpload } from "@/server/services/storage";
import { CHAT_CHANNELS, DEFAULT_CHAT, lang, screenContacts, type ChatChannelKey, type ChatSettings } from "@/lib/chat";
import { AI_MODELS } from "@/lib/ai";

export type Portal = "buy" | "vendor" | "admin" | "driver";
const KEY = "chat.settings";
const MAX_PHOTOS = 3;
const MAX_LEN = 2000;
const RATE = { messages: 30, minutes: 10 };
const NOTIFY_QUIET_MIN = 5;
const ACTIVE_DELIVERY = ["ASSIGNED", "PICKED_UP", "OUT_FOR_DELIVERY"];
const ENDED_ORDER = ["DELIVERED", "CANCELLED", "RETURNED"];

// ── settings ────────────────────────────────────────────────────────────────

export async function chatSettings(): Promise<ChatSettings> {
  const row = await prisma.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: KEY } });
  const v = (row?.value as Partial<ChatSettings>) ?? {};
  return { ...DEFAULT_CHAT, ...v, channels: { ...DEFAULT_CHAT.channels, ...(v.channels ?? {}) } };
}

export async function saveChatSettings(ctx: Ctx, input: Partial<ChatSettings>) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, "admin.settings.manage")) throw new ForbiddenError();
  const cur = await chatSettings();
  const next: ChatSettings = { ...cur, ...input, channels: { ...cur.channels, ...(input.channels ?? {}) } };
  if (!AI_MODELS.includes(next.translateModel)) throw new ValidationError("Choose one of the listed models.");
  if (!Number.isInteger(next.driverHoursAfter) || next.driverHoursAfter < 0 || next.driverHoursAfter > 72) throw new ValidationError("Driver chat after delivery: 0 to 72 hours.");
  if (!Number.isInteger(next.closeDaysAfter) || next.closeDaysAfter < 1 || next.closeDaysAfter > 365) throw new ValidationError("Read-only after: 1 to 365 days.");
  await prisma.setting.upsert({
    where: { scope_scopeId_key: { scope: "GLOBAL", scopeId: "", key: KEY } },
    update: { value: next as unknown as Prisma.InputJsonValue, updatedById: ctx.user.id },
    create: { scope: "GLOBAL", key: KEY, value: next as unknown as Prisma.InputJsonValue, updatedById: ctx.user.id },
  });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "chat.settings_changed", entityType: "Setting", entityId: KEY, before: cur, after: next });
  return next;
}

// ── who is who on an order ──────────────────────────────────────────────────

const orderSelect = {
  id: true, number: true, status: true, updatedAt: true, routedByFiringi: true, buyerCompanyId: true, sellerCompanyId: true,
  buyer: { select: { id: true, legalName: true, tradeName: true } },
  seller: { select: { id: true, legalName: true, tradeName: true } },
  delivery: { select: { id: true, status: true, completedAt: true, updatedAt: true, executingCompanyId: true, executor: { select: { type: true } }, driver: { select: { id: true, userId: true } } } },
} as const;
type ChatOrder = Prisma.OrderGetPayload<{ select: typeof orderSelect }>;
const name = (c: { tradeName: string | null; legalName: string }) => c.tradeName ?? c.legalName;
const firstName = (n: string) => n.trim().split(/\s+/)[0] ?? n;

/** Which side the caller speaks for on this order, from the portal they are in. */
function sideOf(ctx: Ctx, o: ChatOrder, portal: Portal): ChatSide {
  if (portal === "admin" && ctx.company.type === "ADMIN" && can(ctx, ["admin.orders.view", "admin.orders.manage", "admin.support.manage"])) return "FIRINGI";
  if (portal === "buy" && o.buyerCompanyId === ctx.company.id && can(ctx, ["buyer.orders.view", "buyer.orders.place"])) return "BUYER";
  if (portal === "vendor" && o.sellerCompanyId === ctx.company.id && can(ctx, ["vendor.orders.view", "vendor.orders.manage"])) return "SUPPLIER";
  if (portal === "driver" && o.delivery?.driver?.userId === ctx.user.id && can(ctx, "driver.deliveries.view")) return "DRIVER";
  throw new NotFoundError("Order");
}

/** The supplier runs the delivery with its own driver (then it is in the driver thread). */
const supplierRunsDelivery = (o: ChatOrder) => !!o.delivery && o.delivery.executingCompanyId === o.sellerCompanyId;

function channelsFor(side: ChatSide, o: ChatOrder): ChatChannelKey[] {
  const hasDriver = !!o.delivery?.driver;
  switch (side) {
    case "FIRINGI": return [...CHAT_CHANNELS].filter((c) => !(c === "BUYER_SUPPLIER" && o.routedByFiringi) && !(c === "DRIVER" && !hasDriver));
    case "BUYER": return [...(o.routedByFiringi ? [] : ["BUYER_SUPPLIER" as const]), "BUYER_FIRINGI", ...(hasDriver ? ["DRIVER" as const] : [])];
    case "SUPPLIER": return [...(o.routedByFiringi ? [] : ["BUYER_SUPPLIER" as const]), "SUPPLIER_FIRINGI", ...(hasDriver && supplierRunsDelivery(o) ? ["DRIVER" as const] : [])];
    case "DRIVER": return ["DRIVER"];
  }
}

/** Companies (besides FIRINGI) in a channel — the chat switched off for one of them closes it. */
function companiesIn(channel: ChatChannelKey, o: ChatOrder): string[] {
  switch (channel) {
    case "BUYER_SUPPLIER": return [o.buyerCompanyId, o.sellerCompanyId];
    case "BUYER_FIRINGI": return [o.buyerCompanyId];
    case "SUPPLIER_FIRINGI": return [o.sellerCompanyId];
    case "DRIVER": return supplierRunsDelivery(o) ? [o.buyerCompanyId, o.sellerCompanyId] : [o.buyerCompanyId];
  }
}

type Why = "OFF" | "COMPANY_OFF" | "CLOSED" | "DRIVER_ENDED" | "NO_RIGHTS" | null;

async function channelState(ctx: Ctx, side: ChatSide, channel: ChatChannelKey, o: ChatOrder, s: ChatSettings): Promise<{ visible: boolean; canWrite: boolean; why: Why }> {
  const staff = side === "FIRINGI";
  if (!s.enabled || !s.channels[channel]) return { visible: staff, canWrite: false, why: "OFF" };
  for (const id of companiesIn(channel, o)) if (!(await companyFeatureOn(id, "CHAT"))) return { visible: staff, canWrite: false, why: "COMPANY_OFF" };
  if (staff) return { visible: true, canWrite: can(ctx, ["admin.orders.manage", "admin.support.manage"]), why: can(ctx, ["admin.orders.manage", "admin.support.manage"]) ? null : "NO_RIGHTS" };
  if (ENDED_ORDER.includes(o.status) && Date.now() - o.updatedAt.getTime() > s.closeDaysAfter * 86400_000) return { visible: true, canWrite: false, why: "CLOSED" };
  if (channel === "DRIVER") {
    const d = o.delivery!;
    const active = ACTIVE_DELIVERY.includes(d.status);
    const endedAt = d.completedAt ?? d.updatedAt;
    if (!active && Date.now() - endedAt.getTime() > s.driverHoursAfter * 3600_000) return { visible: true, canWrite: false, why: "DRIVER_ENDED" };
  }
  return { visible: true, canWrite: true, why: null };
}

async function loadOrder(orderId: string) {
  const o = await prisma.order.findUnique({ where: { id: orderId }, select: orderSelect });
  if (!o) throw new NotFoundError("Order");
  return o;
}

/** How a message's author is named to this viewer (the supplier stays hidden on orders FIRINGI routed). */
function authorLabel(viewer: ChatSide, m: { authorSide: ChatSide; authorName: string }, o: ChatOrder) {
  switch (m.authorSide) {
    case "FIRINGI": return { company: "FIRINGI", name: m.authorName };
    case "BUYER": return { company: name(o.buyer), name: m.authorName };
    case "SUPPLIER": return { company: o.routedByFiringi && (viewer === "BUYER" || viewer === "DRIVER") ? "FIRINGI" : name(o.seller), name: m.authorName };
    case "DRIVER": return { company: null, name: m.authorName };
  }
}

// ── translation ─────────────────────────────────────────────────────────────

type TranslateFn = (text: string, toLocale: string, model: string) => Promise<string>;
let translateOverride: TranslateFn | null = null;
export function setChatTranslatorForTests(t: TranslateFn | null) { translateOverride = t; }
const simulated = () => process.env.ASSISTANT_SIMULATE === "1" && !process.env.ANTHROPIC_API_KEY && process.env.FIRINGI_ENV !== "production";
export const translationAvailable = () => !!translateOverride || !!process.env.ANTHROPIC_API_KEY || simulated();

function languageName(locale: string) {
  try { return new Intl.DisplayNames(["en"], { type: "language" }).of(locale) ?? locale; } catch { return locale; }
}

let client: Anthropic | null = null;
const liveTranslate: TranslateFn = async (text, toLocale, model) => {
  client ??= new Anthropic();
  const r = await client.messages.create({
    model, max_tokens: 4000,
    system: `You translate short business chat messages between a food-service buyer, a supplier, a delivery driver and FIRINGI (a B2B marketplace). Translate the message inside <message> into ${languageName(toLocale)}. Reply with the translation only — no quotes, notes or explanations. Keep [•••], numbers, quantities, product names, brand names and document numbers (like FO-2026-000100) exactly as written. If it is already in ${languageName(toLocale)}, return it unchanged.`,
    messages: [{ role: "user", content: `<message>\n${text}\n</message>` }],
  });
  const out = r.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("").trim();
  if (!out || r.stop_reason === "refusal") throw new AppError("TRANSLATE_FAILED", "Translation failed.", 502);
  return out;
};
const simulatedTranslate: TranslateFn = async (text, toLocale) => `[${lang(toLocale).toUpperCase()}] ${text}`;

async function translations(messages: { id: string; body: string; locale: string; authorUserId: string; translations: { locale: string; body: string }[] }[], viewerLocale: string, s: ChatSettings, viewerId: string) {
  const out = new Map<string, string>();
  if (!s.translate || !translationAvailable()) return out;
  const want = lang(viewerLocale);
  const fn = translateOverride ?? (simulated() ? simulatedTranslate : liveTranslate);
  // your own messages stay as you wrote them
  const todo = messages.filter((m) => m.authorUserId !== viewerId && lang(m.locale) !== want && m.body.trim());
  for (const m of todo) { const t = m.translations.find((x) => x.locale === want); if (t) out.set(m.id, t.body); }
  const missing = todo.filter((m) => !out.has(m.id)).slice(-20); // newest first; older ones translate on the next view
  await Promise.all(missing.map(async (m) => {
    try {
      const body = await fn(m.body, want, s.translateModel);
      await prisma.orderMessageTranslation.upsert({ where: { messageId_locale: { messageId: m.id, locale: want } }, update: { body }, create: { messageId: m.id, locale: want, body, model: translateOverride ? "test" : simulated() ? "simulated" : s.translateModel } });
      out.set(m.id, body);
    } catch { /* shown as written */ }
  }));
  return out;
}

// ── reading ─────────────────────────────────────────────────────────────────

export type ChatView = Awaited<ReturnType<typeof orderChat>>;

export async function orderChat(ctx: Ctx, orderId: string, portal: Portal, opts: { locale?: string } = {}) {
  const [o, s] = await Promise.all([loadOrder(orderId), chatSettings()]);
  const side = sideOf(ctx, o, portal);
  const viewerLocale = opts.locale ?? ctx.user.locale ?? "en";
  const threads = await prisma.orderThread.findMany({
    where: { orderId },
    include: { messages: { orderBy: { createdAt: "asc" }, take: 300, include: { translations: true } }, reads: { where: { userId: ctx.user.id } } },
  });
  const channels = [];
  for (const channel of channelsFor(side, o)) {
    const st = await channelState(ctx, side, channel, o, s);
    const th = threads.find((t) => t.channel === channel);
    if (!st.visible) continue;
    if (st.why === "OFF" && !th?.messages.length && side !== "FIRINGI") continue;
    const msgs = th?.messages ?? [];
    const tr = await translations(msgs, viewerLocale, s, ctx.user.id);
    const lastRead = th?.reads[0]?.lastReadAt ?? null;
    channels.push({
      channel, canWrite: st.canWrite, why: st.why, threadId: th?.id ?? null,
      unread: msgs.filter((m) => m.authorUserId !== ctx.user.id && (!lastRead || m.createdAt > lastRead)).length,
      messages: msgs.map((m) => ({
        id: m.id, mine: m.authorUserId === ctx.user.id, side: m.authorSide, ...authorLabel(side, m, o),
        body: tr.get(m.id) ?? m.body, translated: tr.has(m.id), original: tr.has(m.id) ? m.body : null, locale: m.locale,
        hidden: m.originalBody !== null, photos: m.photoKeys.length, createdAt: m.createdAt,
        // FIRINGI staff only: what was typed and what the filter found
        ...(side === "FIRINGI" ? { typed: m.originalBody, flags: m.flags, reviewed: !!m.reviewedAt } : {}),
      })),
    });
  }
  return { orderId: o.id, number: o.number, as: side, photos: s.enabled && s.photos, translate: s.translate && translationAvailable(), channels };
}

export async function markThreadRead(ctx: Ctx, orderId: string, channel: ChatChannelKey, portal: Portal) {
  const o = await loadOrder(orderId);
  const side = sideOf(ctx, o, portal);
  if (!channelsFor(side, o).includes(channel)) throw new NotFoundError("Conversation");
  const th = await prisma.orderThread.findUnique({ where: { orderId_channel: { orderId, channel } } });
  if (!th) return false;
  await prisma.orderThreadRead.upsert({ where: { threadId_userId: { threadId: th.id, userId: ctx.user.id } }, update: { lastReadAt: new Date() }, create: { threadId: th.id, userId: ctx.user.id, lastReadAt: new Date() } });
  return true;
}

// ── writing ─────────────────────────────────────────────────────────────────

const LINK: Record<Exclude<ChatSide, "DRIVER">, (o: { id: string }) => string> = {
  BUYER: (o) => `/buy/orders/${o.id}#chat`, SUPPLIER: (o) => `/vendor/orders/${o.id}#chat`, FIRINGI: (o) => `/admin/orders/${o.id}#chat`,
};

export async function sendOrderMessage(ctx: Ctx, orderId: string, portal: Portal, input: { channel: ChatChannelKey; body: string; locale?: string; photos?: File[] }) {
  const [o, s] = await Promise.all([loadOrder(orderId), chatSettings()]);
  const side = sideOf(ctx, o, portal);
  if (!CHAT_CHANNELS.includes(input.channel) || !channelsFor(side, o).includes(input.channel)) throw new NotFoundError("Conversation");
  const st = await channelState(ctx, side, input.channel, o, s);
  if (!st.canWrite) throw new AppError("CHAT_CLOSED", st.why === "DRIVER_ENDED" ? "The delivery has ended — this conversation is closed." : st.why === "CLOSED" ? "This order is closed for messages." : "Messages are switched off here.", 409);
  const raw = (input.body ?? "").trim();
  const files = (input.photos ?? []).filter((f) => f && f.size > 0);
  if (!raw && !files.length) throw new ValidationError("Write a message.");
  if (raw.length > MAX_LEN) throw new ValidationError(`Messages can be up to ${MAX_LEN} characters.`);
  if (files.length && !s.photos) throw new ValidationError("Photos are switched off.");
  if (files.length > MAX_PHOTOS) throw new ValidationError(`Up to ${MAX_PHOTOS} photos per message.`);
  const recent = await prisma.orderMessage.count({ where: { authorUserId: ctx.user.id, createdAt: { gte: new Date(Date.now() - RATE.minutes * 60_000) } } });
  if (recent >= RATE.messages) throw new AppError("RATE_LIMITED", "Too many messages — wait a few minutes.", 429);

  // staff messages are never screened; others per FIRINGI's switch and the company's
  const screen = side !== "FIRINGI";
  const mask = screen && s.maskContacts && (await companyFeatureOn(ctx.company.id, "CHAT_MASK"));
  const { text, flags } = screen ? screenContacts(raw, mask) : { text: raw, flags: [] };
  const photoKeys: string[] = [];
  for (const f of files) {
    const st2 = await storeUpload(f, "chat");
    if (!st2.mimeType.startsWith("image/")) throw new ValidationError("Photos must be images (JPG, PNG or WEBP).");
    photoKeys.push(st2.key);
  }
  const now = new Date();
  const { message, previous } = await prisma.$transaction(async (tx) => {
    const thread = await tx.orderThread.upsert({ where: { orderId_channel: { orderId, channel: input.channel as ChatChannel } }, update: { lastMessageAt: now }, create: { orderId, channel: input.channel as ChatChannel, lastMessageAt: now } });
    const previous = await tx.orderMessage.findFirst({ where: { threadId: thread.id }, orderBy: { createdAt: "desc" }, select: { authorSide: true, createdAt: true } });
    const message = await tx.orderMessage.create({
      data: {
        threadId: thread.id, authorUserId: ctx.user.id, authorCompanyId: ctx.company.id, authorSide: side, authorName: firstName(ctx.user.name),
        body: text, originalBody: mask && flags.length ? raw : null, locale: input.locale ?? ctx.user.locale ?? "en", flags, photoKeys, createdAt: now,
      },
    });
    await tx.orderThreadRead.upsert({ where: { threadId_userId: { threadId: thread.id, userId: ctx.user.id } }, update: { lastReadAt: now }, create: { threadId: thread.id, userId: ctx.user.id, lastReadAt: now } });
    return { thread, message, previous };
  });
  if (flags.length) await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "chat.contact_flagged", entityType: "OrderMessage", entityId: message.id, after: { order: o.number, channel: input.channel, flags, hidden: mask } });

  // tell the others — once per burst (no new notice while the same side keeps typing)
  const quiet = previous && previous.authorSide === side && now.getTime() - previous.createdAt.getTime() < NOTIFY_QUIET_MIN * 60_000;
  if (!quiet) await notifyOthers(o, side, input.channel).catch(() => null);
  return { id: message.id, hidden: !!message.originalBody, flags: mask ? flags : [] };
}

async function notifyOthers(o: ChatOrder, from: ChatSide, channel: ChatChannelKey) {
  const admin = (await prisma.company.findFirst({ where: { type: "ADMIN" }, select: { id: true } }))?.id;
  const parties: { side: ChatSide; target: { companyId: string } | { userId: string } }[] = [];
  if (channel !== "SUPPLIER_FIRINGI") parties.push({ side: "BUYER", target: { companyId: o.buyerCompanyId } });
  if (channel === "BUYER_SUPPLIER" || channel === "SUPPLIER_FIRINGI" || (channel === "DRIVER" && supplierRunsDelivery(o))) parties.push({ side: "SUPPLIER", target: { companyId: o.sellerCompanyId } });
  if (channel === "DRIVER" && o.delivery?.driver) parties.push({ side: "DRIVER", target: { userId: o.delivery.driver.userId } });
  // FIRINGI is told when it is a party (it reads the buyer↔supplier and driver threads without being pinged)
  if (admin && (channel === "BUYER_FIRINGI" || channel === "SUPPLIER_FIRINGI" || (channel === "DRIVER" && !supplierRunsDelivery(o)))) parties.push({ side: "FIRINGI", target: { companyId: admin } });
  const targets = parties.filter((p) => p.side !== from).map((p) => ({ ...p.target, link: p.side === "DRIVER" ? `/driver/deliveries/${o.delivery!.id}#chat` : LINK[p.side as Exclude<ChatSide, "DRIVER">](o) }));
  const fromName = from === "BUYER" ? name(o.buyer) : from === "SUPPLIER" ? name(o.seller) : from === "FIRINGI" ? "FIRINGI" : "Driver";
  // the buyer must not learn the supplier on routed orders: one notice per target with the right sender
  for (const t of targets) {
    const hideSupplier = from === "SUPPLIER" && o.routedByFiringi && !("companyId" in t && t.companyId === admin);
    await notify("chat.message", [t], { number: o.number, from: hideSupplier ? "FIRINGI" : fromName }, { ref: { type: "Order", id: o.id } });
  }
}

/** Photo n of a message, for someone who can see the thread. */
export async function chatPhotoKey(ctx: Ctx, messageId: string, n: number, portal: Portal) {
  const m = await prisma.orderMessage.findUnique({ where: { id: messageId }, select: { photoKeys: true, thread: { select: { orderId: true, channel: true } } } });
  if (!m) throw new NotFoundError("File");
  const o = await loadOrder(m.thread.orderId);
  const side = sideOf(ctx, o, portal);
  if (!channelsFor(side, o).includes(m.thread.channel)) throw new NotFoundError("File");
  const key = m.photoKeys[n];
  if (!key) throw new NotFoundError("File");
  return key;
}

// ── inbox: every conversation the caller is in ──────────────────────────────

export async function chatInbox(ctx: Ctx, portal: Portal, opts: { take?: number } = {}) {
  const where: Prisma.OrderThreadWhereInput =
    portal === "admin" ? {} :
    portal === "buy" ? { order: { buyerCompanyId: ctx.company.id }, channel: { in: ["BUYER_SUPPLIER", "BUYER_FIRINGI", "DRIVER"] } } :
    portal === "vendor" ? { order: { sellerCompanyId: ctx.company.id }, channel: { in: ["BUYER_SUPPLIER", "SUPPLIER_FIRINGI", "DRIVER"] } } :
    { order: { delivery: { driver: { userId: ctx.user.id } } }, channel: "DRIVER" };
  if (portal === "admin" && (ctx.company.type !== "ADMIN" || !can(ctx, ["admin.orders.view", "admin.orders.manage", "admin.support.manage"]))) throw new ForbiddenError();
  const threads = await prisma.orderThread.findMany({
    where: { ...where, lastMessageAt: { not: null } }, orderBy: { lastMessageAt: "desc" }, take: opts.take ?? 100,
    include: {
      order: { select: orderSelect },
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
      reads: { where: { userId: ctx.user.id } },
      _count: { select: { messages: true } },
    },
  });
  const rows = [];
  for (const t of threads) {
    const o = t.order;
    let side: ChatSide;
    try { side = sideOf(ctx, o, portal); } catch { continue; }
    if (!channelsFor(side, o).includes(t.channel)) continue;
    const last = t.messages[0];
    const lastRead = t.reads[0]?.lastReadAt ?? null;
    const unread = await prisma.orderMessage.count({ where: { threadId: t.id, authorUserId: { not: ctx.user.id }, ...(lastRead ? { createdAt: { gt: lastRead } } : {}) } });
    rows.push({
      threadId: t.id, orderId: o.id, number: o.number, channel: t.channel, lastAt: t.lastMessageAt!, messages: t._count.messages, unread,
      with: side === "BUYER" ? (t.channel === "BUYER_SUPPLIER" ? name(o.seller) : t.channel === "DRIVER" ? "DRIVER" : "FIRINGI")
        : side === "SUPPLIER" ? (t.channel === "SUPPLIER_FIRINGI" ? "FIRINGI" : name(o.buyer))
        : side === "DRIVER" ? name(o.buyer) : `${name(o.buyer)} · ${name(o.seller)}`,
      last: last ? { ...authorLabel(side, last, o), side: last.authorSide, body: last.body.slice(0, 140), photos: last.photoKeys.length, flags: side === "FIRINGI" ? last.flags : [] } : null,
      deliveryId: o.delivery?.id ?? null,
    });
  }
  return rows;
}

/** Unread messages for the menu badge. */
export async function chatUnread(ctx: Ctx, portal: Portal) {
  return (await chatInbox(ctx, portal, { take: 200 })).reduce((a, r) => a + r.unread, 0);
}

// ── FIRINGI: overview, flagged messages ─────────────────────────────────────

function requireStaff(ctx: Ctx, manage = false) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, manage ? ["admin.orders.manage", "admin.support.manage", "admin.settings.manage"] : ["admin.orders.view", "admin.orders.manage", "admin.support.manage", "admin.settings.view", "admin.settings.manage"])) throw new ForbiddenError();
}

export async function flaggedMessages(ctx: Ctx, opts: { open?: boolean } = {}) {
  requireStaff(ctx);
  const rows = await prisma.orderMessage.findMany({
    where: { flags: { isEmpty: false }, ...(opts.open === false ? {} : { reviewedAt: null }) }, orderBy: { createdAt: "desc" }, take: 200,
    include: { thread: { select: { channel: true, order: { select: { id: true, number: true, buyer: { select: { legalName: true, tradeName: true } }, seller: { select: { legalName: true, tradeName: true } } } } } } },
  });
  const companies = await prisma.company.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.authorCompanyId))] } }, select: { id: true, legalName: true, tradeName: true } });
  return rows.map((m) => ({
    id: m.id, at: m.createdAt, orderId: m.thread.order.id, number: m.thread.order.number, channel: m.thread.channel, side: m.authorSide, author: m.authorName,
    company: (() => { const c = companies.find((x) => x.id === m.authorCompanyId); return c ? name(c) : "—"; })(), companyId: m.authorCompanyId,
    shown: m.body, typed: m.originalBody ?? m.body, hidden: m.originalBody !== null, flags: m.flags, reviewed: !!m.reviewedAt,
  }));
}

export async function reviewFlagged(ctx: Ctx, messageId: string) {
  requireStaff(ctx, true);
  const m = await prisma.orderMessage.findUnique({ where: { id: messageId }, select: { id: true, flags: true } });
  if (!m || !m.flags.length) throw new NotFoundError("Message");
  await prisma.orderMessage.update({ where: { id: messageId }, data: { reviewedAt: new Date(), reviewedById: ctx.user.id } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "chat.flag_reviewed", entityType: "OrderMessage", entityId: messageId });
  return true;
}

export async function chatOverview(ctx: Ctx) {
  requireStaff(ctx);
  const since = new Date(Date.now() - 30 * 86400_000);
  const [s, byChannel, messages30, flagged, openFlags, translated] = await Promise.all([
    chatSettings(),
    prisma.$queryRaw<{ channel: ChatChannel; threads: bigint; messages: bigint }[]>`
      SELECT t.channel, COUNT(DISTINCT t.id) AS threads, COUNT(m.id) AS messages
      FROM "OrderThread" t LEFT JOIN "OrderMessage" m ON m."threadId" = t.id AND m."createdAt" >= ${since}
      GROUP BY t.channel`,
    prisma.orderMessage.count({ where: { createdAt: { gte: since } } }),
    prisma.orderMessage.count({ where: { createdAt: { gte: since }, flags: { isEmpty: false } } }),
    prisma.orderMessage.count({ where: { flags: { isEmpty: false }, reviewedAt: null } }),
    prisma.orderMessageTranslation.count({ where: { createdAt: { gte: since } } }),
  ]);
  return {
    settings: s, translation: translationAvailable() ? (simulated() ? "simulated" : "on") : "no-key",
    messages30, flagged30: flagged, openFlags, translated30: translated,
    channels: CHAT_CHANNELS.map((c) => { const r = byChannel.find((x) => x.channel === c); return { channel: c, threads: Number(r?.threads ?? 0), messages: Number(r?.messages ?? 0) }; }),
  };
}
