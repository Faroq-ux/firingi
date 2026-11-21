import "server-only";
/**
 * WhatsApp ordering with AI (Phase 58). Rules in src/lib/wa-ordering.ts; docs in docs/whatsapp-ordering.md.
 *
 * A business writes to FIRINGI's WhatsApp number from the WhatsApp number on its account (registration or
 * profile). FIRINGI's AI agent (the same one as the Assistant page) reads text, photos of lists and transcribed
 * voice notes, finds the products, fills the cart and proposes the order: lines, each supplier's delivery (its own
 * minimum and free-delivery amount, fee) and the total. ONLY the customer's YES — recognised by FIRINGI, not by the
 * AI — places that exact cart. Status updates, payment links and reorder reminders come back on WhatsApp; asking for
 * a person opens a support request and pauses the AI so staff answer from the inbox.
 * Who may order is FIRINGI's choice (Settings › WhatsApp Ordering): wholesale customers now; wholesalers and unknown
 * numbers are switches; each business can also be switched off (Business Features).
 */
import Decimal from "decimal.js";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { writeAudit } from "@/server/services/audit";
import { pickLocalized } from "@/i18n/config";
import { cartHash, DEFAULT_WA, intentOf, localeFromPhone, mergeWaSettings, toWhatsApp, type WaSettings } from "@/lib/wa-ordering";

const KEY = "whatsapp.ordering";
const appUrl = () => (process.env.APP_URL ?? process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
const isStaff = (ctx: Ctx) => ctx.company.type === "ADMIN";
const money = (v: Decimal.Value, locale: string) => `${Number(v).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

// ── settings ──

export async function waSettings(): Promise<WaSettings> {
  const row = await prisma.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: KEY } });
  return mergeWaSettings(row?.value);
}

export async function saveWaSettings(ctx: Ctx, input: WaSettings) {
  if (!isStaff(ctx) || !can(ctx, ["admin.settings.manage", "admin.messages.manage"])) throw new ForbiddenError();
  const s = mergeWaSettings(input);
  const before = await waSettings();
  const row = await prisma.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: KEY } });
  if (row) await prisma.setting.update({ where: { id: row.id }, data: { value: s as unknown as Prisma.InputJsonValue } });
  else await prisma.setting.create({ data: { scope: "GLOBAL", scopeId: "", key: KEY, value: s as unknown as Prisma.InputJsonValue } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "whatsapp.settings_saved", entityType: "Setting", entityId: KEY, before: before as never, after: s as never });
  return s;
}

// ── texts FIRINGI sends itself (not the AI): messages › waOrder.bot ──

const textCache = new Map<string, Record<string, string>>();
async function bot(locale: string) {
  const file = ["pt", "pt-PT", "pt-BR"].includes(locale) ? "pt-PT" : locale;
  if (!textCache.has(file)) {
    type Tree = { [k: string]: string | Tree };
    const flat = (o: Tree, p = ""): Record<string, string> => Object.fromEntries(Object.entries(o).flatMap(([k, v]) => (typeof v === "string" ? [[p + k, v]] : Object.entries(flat(v, `${p}${k}.`)))));
    const load = async (f: string) => flat(((await import(`@/messages/${f}.json`)).default as { waOrder?: { bot?: Tree } }).waOrder?.bot ?? {});
    const en = await load("en");
    let own: Record<string, string> = {};
    try { own = file === "en" ? {} : await load(file); } catch { own = {}; }
    textCache.set(file, { ...en, ...own });
  }
  const t = textCache.get(file)!;
  return (k: string, v: Record<string, string | number> = {}) => (t[k] ?? k).replace(/\{(\w+)\}/g, (_, x: string) => String(v[x] ?? `{${x}}`));
}

// ── sending ──

/** WhatsApp free text is allowed within 24 hours of the customer's last message; after that only an approved template. */
async function windowOpen(number: string) {
  const last = await prisma.inboundMessage.findFirst({ where: { from: number, channel: "WHATSAPP" }, orderBy: { receivedAt: "desc" }, select: { receivedAt: true } });
  return !!last && Date.now() - last.receivedAt.getTime() < 24 * 3600_000;
}

type Send = { to: string; body: string; locale: string; userId?: string | null; companyId?: string | null; buttons?: { id: string; title: string }[]; template?: { name: string; language: string; params: string[] } | null; event?: string; ref?: { type: string; id: string } };
export async function sendWa(m: Send) {
  const { deliverMessage } = await import("@/server/notify/dispatch");
  const { driverFor } = await import("@/server/notify/providers");
  const row = await prisma.notificationMessage.create({
    data: {
      eventKey: m.event ?? "whatsapp.order", channel: "WHATSAPP", to: m.to, locale: m.locale, body: m.body.slice(0, 4000), provider: driverFor("WHATSAPP"), userId: m.userId ?? null, companyId: m.companyId ?? null,
      refType: m.ref?.type ?? "WaConversation", refId: m.ref?.id ?? m.to,
      variables: { ...(m.template ? { _wa: m.template } : {}), ...(m.buttons?.length ? { _buttons: m.buttons } : {}) } as Prisma.InputJsonValue,
    },
  });
  return deliverMessage(row.id);
}

// ── inbound: queue and process ──

/** Called after an inbound WhatsApp message is stored: mark it for the AI (processed right away and by the job). */
export async function queueInbound(id: string) {
  await prisma.inboundMessage.update({ where: { id }, data: { aiStatus: "PENDING" } });
}

/** The job's fallback: messages still waiting (e.g. the server restarted). */
export async function processPending(limit = 20) {
  const due = await prisma.inboundMessage.findMany({ where: { aiStatus: "PENDING", receivedAt: { lt: new Date(Date.now() - 15_000) } }, orderBy: { receivedAt: "asc" }, take: limit, select: { id: true } });
  let n = 0;
  for (const d of due) { await processInbound(d.id); n++; }
  return n;
}

const done = (id: string, status: "DONE" | "SKIPPED" | "FAILED", note?: string) =>
  prisma.inboundMessage.update({ where: { id }, data: { aiStatus: status, aiNote: note?.slice(0, 300) ?? null, aiAt: new Date(), ...(status === "DONE" ? { handledAt: new Date() } : {}) } });

/** Handle one inbound WhatsApp message (idempotent: only a PENDING message is taken). */
export async function processInbound(id: string, fetchImpl?: typeof fetch) {
  const taken = await prisma.inboundMessage.updateMany({ where: { id, aiStatus: "PENDING" }, data: { aiStatus: "WORKING" } });
  if (!taken.count) return null;
  const msg = await prisma.inboundMessage.findUniqueOrThrow({ where: { id } });
  try {
    return await handle(msg, fetchImpl);
  } catch (e) {
    const t = await bot(localeFromPhone(msg.from));
    await sendWa({ to: msg.from, body: t("error"), locale: localeFromPhone(msg.from), userId: msg.userId, companyId: msg.companyId }).catch(() => null);
    await done(id, "FAILED", e instanceof Error ? e.message : String(e));
    return "FAILED";
  }
}

type Inbound = Awaited<ReturnType<typeof prisma.inboundMessage.findUniqueOrThrow>>;

async function handle(msg: Inbound, fetchImpl?: typeof fetch) {
  const s = await waSettings();
  if (!s.enabled) return done(msg.id, "SKIPPED", "WhatsApp ordering is off").then(() => "SKIPPED");
  // Unknown number: the registration link (once a day), if FIRINGI wants that.
  if (!msg.companyId || !msg.userId) {
    if (!s.audiences.unknownNumbers) return done(msg.id, "SKIPPED", "Unknown number").then(() => "SKIPPED");
    const locale = localeFromPhone(msg.from);
    const recent = await prisma.notificationMessage.count({ where: { to: msg.from, eventKey: "whatsapp.register", createdAt: { gt: new Date(Date.now() - 24 * 3600_000) } } });
    if (!recent) await sendWa({ to: msg.from, body: (await bot(locale))("register", { link: `${appUrl()}/register` }), locale, event: "whatsapp.register" });
    return done(msg.id, "DONE", "Registration link sent").then(() => "DONE");
  }
  const company = await prisma.company.findUnique({ where: { id: msg.companyId }, select: { id: true, type: true, status: true } });
  const allowed = company?.status === "APPROVED" && ((company.type === "CUSTOMER" && s.audiences.customers) || (company.type === "WHOLESALER" && s.audiences.wholesalers));
  if (!allowed) return done(msg.id, "SKIPPED", "Not a business that orders by WhatsApp").then(() => "SKIPPED");
  const { companyFeatureOn } = await import("@/server/accounting/features");
  if (!(await companyFeatureOn(company.id, "WHATSAPP_ORDERING"))) return done(msg.id, "SKIPPED", "Switched off for this business").then(() => "SKIPPED");
  const { loadContext } = await import("@/server/context");
  const ctx = await loadContext(msg.userId, "whatsapp", company.id);
  if (!ctx || !can(ctx, "buyer.orders.place")) return done(msg.id, "SKIPPED", "This person can't order").then(() => "SKIPPED");
  const locale = ctx.user.locale ?? localeFromPhone(msg.from);
  const t = await bot(locale);
  const send = (body: string, extra: Partial<Send> = {}) => sendWa({ to: msg.from, body, locale, userId: ctx.user.id, companyId: company.id, ...extra });

  // A person took over: the AI stays quiet (staff answer in Notifications › Inbox).
  const conv = await prisma.aiConversation.findFirst({ where: { userId: ctx.user.id, companyId: company.id, side: "BUYER", channel: "WHATSAPP", updatedAt: { gt: new Date(Date.now() - 24 * 3600_000) } }, orderBy: { updatedAt: "desc" } });
  if (conv?.aiPausedUntil && conv.aiPausedUntil > new Date()) return done(msg.id, "SKIPPED", "A person is answering").then(() => "SKIPPED");
  const lastHour = await prisma.inboundMessage.count({ where: { companyId: company.id, channel: "WHATSAPP", aiStatus: "DONE", receivedAt: { gt: new Date(Date.now() - 3600_000) } } });
  if (lastHour >= s.hourlyLimit) { await send(t("limit")); return done(msg.id, "SKIPPED", "Hourly limit").then(() => "SKIPPED"); }

  // What the customer sent.
  let text = msg.body.trim();
  const photos: File[] = [];
  if (msg.kind === "AUDIO") {
    const { downloadMedia, transcribe, transcriptionReady } = await import("./media");
    if (!s.inputs.voice || !transcriptionReady()) { await send(t("voiceOff")); return done(msg.id, "DONE", "Voice notes off").then(() => "DONE"); }
    const media = msg.mediaUrl ? await downloadMedia(msg.mediaUrl, msg.mediaType, fetchImpl) : null;
    const said = media ? await transcribe(media, locale, fetchImpl) : null;
    if (!said) { await send(t("voiceFail")); return done(msg.id, "DONE", "Voice note not understood").then(() => "DONE"); }
    await prisma.inboundMessage.update({ where: { id: msg.id }, data: { transcript: said.slice(0, 4000) } });
    text = said;
  } else if (msg.kind === "IMAGE") {
    if (!s.inputs.photos) { await send(t("photosOff")); return done(msg.id, "DONE", "Photos off").then(() => "DONE"); }
    const { downloadMedia } = await import("./media");
    const media = msg.mediaUrl ? await downloadMedia(msg.mediaUrl, msg.mediaType, fetchImpl) : null;
    if (media && ["image/jpeg", "image/png", "image/webp"].includes(media.mime) && media.buf.length <= 5 * 1024 * 1024)
      photos.push(new File([new Uint8Array(media.buf)], `whatsapp.${media.mime.split("/")[1]}`, { type: media.mime }));
    if (text === "[image]") text = "";
  }

  // YES / NO to a proposal: FIRINGI acts, not the AI.
  const intent = intentOf(text);
  const draft = await prisma.waOrderDraft.findFirst({ where: { waNumber: msg.from, companyId: company.id, status: "PENDING" }, orderBy: { createdAt: "desc" } });
  if (draft && intent === "YES") { await placeDraft(ctx, draft.id, msg.from, locale); return done(msg.id, "DONE", "Order confirmed").then(() => "DONE"); }
  if (draft && intent === "NO") {
    await prisma.waOrderDraft.update({ where: { id: draft.id }, data: { status: "CANCELLED", decidedAt: new Date() } });
    await send(t("cancelled"));
    return done(msg.id, "DONE", "Proposal cancelled").then(() => "DONE");
  }
  if (intent === "REPEAT") text = "Repeat my last order: put the same products and quantities in my cart and send me the order to confirm.";

  // Everything else: the AI agent, in this business's WhatsApp conversation.
  const { ask, handoverToSupport } = await import("@/server/ai/assistant");
  let r: Awaited<ReturnType<typeof ask>>;
  try {
    r = await ask(ctx, "BUYER", { conversationId: conv?.id ?? null, text: text || "(photo)", locale, photos, whatsapp: { number: msg.from } });
  } catch (e) {
    if (e instanceof AppError && ["AI_NOT_CONFIGURED", "AI_LIMIT"].includes(e.code)) return done(msg.id, "SKIPPED", e.message).then(() => "SKIPPED"); // a person answers from the inbox
    throw e;
  }
  const proposal = r.tools.find((x) => x.card?.kind === "proposal")?.card as { kind: "proposal"; draftId: string } | undefined;
  if (proposal) await prisma.waOrderDraft.updateMany({ where: { id: proposal.draftId }, data: { conversationId: r.conversationId } });
  let body = toWhatsApp(r.answer);
  const { driverFor } = await import("@/server/notify/providers");
  const buttonsOn = s.inputs.buttons && driverFor("WHATSAPP") === "meta";
  if (proposal && !buttonsOn) body = `${body}\n\n${t("confirmHint")}`;
  if (r.tools.some((x) => x.card?.kind === "handover")) {
    // On WhatsApp the hand-over happens at once: a support request with the chat, and the AI pauses.
    await handoverToSupport(ctx, "BUYER", r.messageId).catch(() => null);
    await prisma.aiConversation.update({ where: { id: r.conversationId }, data: { aiPausedUntil: new Date(Date.now() + s.pauseHours * 3600_000) } });
    body = `${body}\n\n${t("handover")}`;
  }
  await send(body, { ref: { type: "AiConversation", id: r.conversationId } });
  if (proposal && buttonsOn) await send(t("confirmHint"), { buttons: [{ id: "wa_confirm", title: t("btnConfirm") }, { id: "wa_cancel", title: t("btnCancel") }], ref: { type: "AiConversation", id: r.conversationId } });
  await done(msg.id, "DONE", proposal ? "Order proposed" : "Answered");
  return "DONE";
}

// ── proposals and placing ──

type CartV = { lines: { offerId: string; qty: number; name?: unknown; packaging?: { name?: unknown }; lineGross?: string }[]; totalGross: string; totalNet: string; addresses: { id: string; label: string }[]; groups: { supplier: { id: string; name: string }; goodsNet: string; delivery: { ok: boolean; feeNet?: string; free?: unknown; reason?: string; minimum?: string; missing?: string; unit?: string } }[]; credit?: unknown };

async function freeFromFor(ctx: Ctx, vendorId: string, addressId: string | null) {
  const { deliveryRulesFor } = await import("@/server/services/cart");
  const r = await deliveryRulesFor(ctx.company.countryId, vendorId, addressId);
  const pickN = (v: unknown) => (v == null ? null : Number(v));
  // the supplier's own free-delivery amount (it delivers itself from there), else FIRINGI's free delivery when on
  const vendorFree = pickN(r.vendor?.vendorDeliveryMinimum);
  const firingiFree = r.firingi?.firingiFreeEnabled ? pickN(r.firingi.firingiFreeFrom) : null;
  return { freeFrom: vendorFree ?? firingiFree, minimum: pickN(r.firingi?.minOrderValue) };
}

/** The AI's propose_order tool: a summary of the cart as orders, or what is missing. */
export async function proposeOrder(ctx: Ctx, waNumber: string, locale: string, conversationId: string | null) {
  const { cartView } = await import("@/server/services/cart");
  const v = (await cartView(ctx)) as unknown as CartV;
  if (!v.lines.length) return { ok: false as const, problems: [{ problem: "EMPTY_CART" }] };
  const address = v.addresses[0];
  if (!address) return { ok: false as const, problems: [{ problem: "NO_DELIVERY_ADDRESS", where: "Company › Delivery Addresses" }] };
  const groups = [];
  const problems = [];
  for (const g of v.groups) {
    const rules = await freeFromFor(ctx, g.supplier.id, address.id);
    groups.push({ supplier: g.supplier.name, goodsNet: g.goodsNet, deliveryOk: g.delivery.ok, deliveryFeeNet: g.delivery.ok ? g.delivery.feeNet ?? "0.00" : null, freeDeliveryFromNet: rules.freeFrom?.toFixed(2) ?? null, ...(g.delivery.ok ? {} : { problem: g.delivery.reason, minimum: g.delivery.minimum, missing: g.delivery.missing, unit: g.delivery.unit }) });
    if (!g.delivery.ok) problems.push({ supplier: g.supplier.name, problem: g.delivery.reason, minimum: g.delivery.minimum, missing: g.delivery.missing, unit: g.delivery.unit, freeDeliveryFromNet: rules.freeFrom?.toFixed(2) ?? null });
  }
  // Not enough stock: say so now rather than after the YES (placing still checks each batch).
  const levels = await prisma.stockLevel.groupBy({ by: ["offerId"], where: { offerId: { in: v.lines.map((l) => l.offerId) } }, _sum: { onHand: true, reserved: true } });
  for (const l of v.lines) {
    const lv = levels.find((x) => x.offerId === l.offerId);
    const free = lv ? (lv._sum.onHand ?? 0) - (lv._sum.reserved ?? 0) : 0;
    if (free < l.qty) problems.push({ product: pickLocalized((l.name ?? {}) as Record<string, string>, locale), problem: "NOT_ENOUGH_STOCK", available: Math.max(0, free), inCart: l.qty });
  }
  if (problems.length) return { ok: false as const, problems };
  const s = await waSettings();
  const lines = v.lines.map((l) => ({ product: pickLocalized((l.name ?? {}) as Record<string, string>, locale), pack: pickLocalized((l.packaging?.name ?? {}) as Record<string, string>, locale), qty: l.qty, lineInclVat: l.lineGross ?? null }));
  const summary = { lines, delivery: groups, totalNet: v.totalNet, totalInclVat: v.totalGross, deliverTo: address.label };
  await prisma.waOrderDraft.updateMany({ where: { waNumber, companyId: ctx.company.id, status: "PENDING" }, data: { status: "CHANGED", decidedAt: new Date() } });
  const d = await prisma.waOrderDraft.create({
    data: {
      companyId: ctx.company.id, userId: ctx.user.id, conversationId, waNumber, cartHash: cartHash(v.lines.map((l) => ({ offerId: l.offerId, qty: l.qty }))),
      summary: summary as unknown as Prisma.InputJsonValue, totalGross: new Decimal(v.totalGross).toFixed(2), addressId: address.id, expiresAt: new Date(Date.now() + s.draftMinutes * 60_000),
    },
  });
  return { ok: true as const, draftId: d.id, summary };
}

/** The customer said YES: place exactly the proposed cart (or say why not). */
export async function placeDraft(ctx: Ctx, draftId: string, waNumber: string, locale: string) {
  const t = await bot(locale);
  const send = (body: string) => sendWa({ to: waNumber, body, locale, userId: ctx.user.id, companyId: ctx.company.id, ref: { type: "WaOrderDraft", id: draftId } });
  const d = await prisma.waOrderDraft.findUniqueOrThrow({ where: { id: draftId } });
  if (d.status !== "PENDING") return d;
  if (d.expiresAt < new Date()) { await prisma.waOrderDraft.update({ where: { id: d.id }, data: { status: "EXPIRED", decidedAt: new Date() } }); await send(t("expired")); return d; }
  const { cartView } = await import("@/server/services/cart");
  const v = (await cartView(ctx)) as unknown as CartV;
  if (cartHash(v.lines.map((l) => ({ offerId: l.offerId, qty: l.qty }))) !== d.cartHash) {
    await prisma.waOrderDraft.update({ where: { id: d.id }, data: { status: "CHANGED", decidedAt: new Date() } });
    await send(t("cartChanged"));
    return d;
  }
  const { placeOrder } = await import("@/server/services/orders");
  try {
    const r = await placeOrder(ctx, { deliveryAddressId: d.addressId, notes: "WhatsApp" });
    if (r.approval) {
      await prisma.waOrderDraft.update({ where: { id: d.id }, data: { status: "PLACED", approvalId: r.approval.id, decidedAt: new Date() } });
      await send(t("approval"));
      return d;
    }
    const ids = r.orders.map((o) => o.id), numbers = r.orders.map((o) => o.number);
    await prisma.order.updateMany({ where: { id: { in: ids } }, data: { placedVia: "WHATSAPP" } });
    await prisma.waOrderDraft.update({ where: { id: d.id }, data: { status: "PLACED", orderIds: ids, orderNumbers: numbers, decidedAt: new Date() } });
    let body = t("placed", { numbers: numbers.join(", "), total: money(d.totalGross.toString(), locale) });
    if (r.payFirst && ids[0]) {
      const { buyerPayOrder, payLinkUrl } = await import("@/server/payments/service");
      const pr = await buyerPayOrder(ctx, ids[0]).catch(() => null);
      if (pr) body = `${body}\n\n${t("payFirst", { link: payLinkUrl(pr.token) })}`;
    }
    await send(body);
    await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "whatsapp.order_placed", entityType: "WaOrderDraft", entityId: d.id, after: { orders: numbers } });
  } catch (e) {
    const reason = e instanceof AppError ? e.message : "error";
    await prisma.waOrderDraft.update({ where: { id: d.id }, data: { status: "CANCELLED", error: reason.slice(0, 300), decidedAt: new Date() } });
    await send(t("failed", { reason }));
  }
  return prisma.waOrderDraft.findUniqueOrThrow({ where: { id: d.id } });
}

/** The AI's repeat_last_order tool: the last order's lines back in the cart. */
export async function repeatLastOrder(ctx: Ctx, locale: string) {
  const last = await prisma.order.findFirst({ where: { buyerCompanyId: ctx.company.id, status: { notIn: ["CANCELLED"] } }, orderBy: { placedAt: "desc" }, include: { lines: { select: { offerId: true, qtyOrdered: true, productName: true } } } });
  if (!last) return { repeated: false, note: "This customer has no earlier order." };
  const { addToCart, clearCart } = await import("@/server/services/cart");
  await clearCart(ctx);
  const added = [], missing = [];
  for (const l of last.lines) {
    try { await addToCart(ctx, l.offerId, l.qtyOrdered); added.push({ product: pickLocalized(l.productName as Record<string, string>, locale), qty: l.qtyOrdered }); }
    catch (e) { missing.push({ product: pickLocalized(l.productName as Record<string, string>, locale), why: e instanceof AppError ? e.message : "not available" }); }
  }
  return { repeated: true, from: last.number, added, notAvailable: missing, next: "Now call propose_order." };
}

/** The AI's pay_invoices_link tool. */
export async function payLinkForOpenInvoices(ctx: Ctx) {
  const s = await waSettings();
  if (!s.payLinks) return { link: null, note: "Payment links on WhatsApp are switched off; the customer pays in Invoices & Payments." };
  const { listSalesInvoices } = await import("@/server/services/finance");
  const rows = await listSalesInvoices(ctx, { as: "BUYER", unpaidOnly: true });
  if (!rows.length) return { link: null, note: "No open invoices." };
  const { buyerPayInvoices, payLinkUrl } = await import("@/server/payments/service");
  const r = await buyerPayInvoices(ctx, rows.map((x) => x.id));
  return { link: payLinkUrl(r.token), invoices: rows.map((x) => x.fullNumber), total: r.amount.toString() };
}

// ── order updates and reminders ──

const UPDATE_STATUSES = new Set(["SUPPLIER_PROCESSING", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED"]);

/** An order placed on WhatsApp changed status: tell the business there (its 24-hour window, or the approved template). */
export async function orderStatusChanged(orderId: string, status: string) {
  if (!UPDATE_STATUSES.has(status)) return;
  const s = await waSettings();
  if (!s.enabled || !s.orderUpdates) return;
  const o = await prisma.order.findUnique({ where: { id: orderId }, select: { number: true, placedVia: true, buyerCompanyId: true, buyer: { select: { whatsapp: true, whatsappOrderUpdates: true } }, placedByUserId: true } });
  if (!o || o.placedVia !== "WHATSAPP" || !o.buyer.whatsapp || !o.buyer.whatsappOrderUpdates) return;
  const user = await prisma.user.findUnique({ where: { id: o.placedByUserId }, select: { locale: true } });
  const locale = user?.locale ?? localeFromPhone(o.buyer.whatsapp);
  const t = await bot(locale);
  const body = t(`status.${status}`, { number: o.number });
  const open = await windowOpen(o.buyer.whatsapp);
  if (!open && !s.templates.orderUpdate) return; // WhatsApp won't deliver free text outside the window
  await sendWa({ to: o.buyer.whatsapp, body, locale, userId: o.placedByUserId, companyId: o.buyerCompanyId, event: "whatsapp.order_update", ref: { type: "Order", id: orderId },
    template: open ? null : { name: s.templates.orderUpdate, language: s.templates.language, params: [o.number, body] } }).catch(() => null);
}

/** Daily: businesses that agreed get a reminder when they usually reorder (average gap between their last orders). */
export async function runWhatsAppJob(at = new Date()) {
  const pending = await processPending();
  await prisma.waOrderDraft.updateMany({ where: { status: "PENDING", expiresAt: { lt: at } }, data: { status: "EXPIRED", decidedAt: at } });
  const s = await waSettings();
  let reminders = 0;
  if (s.enabled && s.reminders.enabled) {
    const types = [...(s.audiences.customers ? ["CUSTOMER" as const] : []), ...(s.audiences.wholesalers ? ["WHOLESALER" as const] : [])];
    const cos = await prisma.company.findMany({ where: { whatsappReminders: true, whatsapp: { not: null }, status: "APPROVED", type: { in: types } }, select: { id: true, legalName: true, tradeName: true, whatsapp: true, whatsappRemindedAt: true } });
    const { companyFeatureOn } = await import("@/server/accounting/features");
    for (const c of cos) {
      if (!(await companyFeatureOn(c.id, "WHATSAPP_ORDERING"))) continue;
      const orders = await prisma.order.findMany({ where: { buyerCompanyId: c.id, status: { notIn: ["CANCELLED"] } }, orderBy: { placedAt: "desc" }, take: 4, select: { number: true, placedAt: true, placedByUserId: true } });
      if (orders.length < 2) continue;
      const gaps = orders.slice(0, -1).map((o, i) => o.placedAt.getTime() - orders[i + 1].placedAt.getTime());
      const avg = gaps.reduce((a, g) => a + g, 0) / gaps.length;
      const due = orders[0].placedAt.getTime() + avg - s.reminders.daysBefore * 86400_000;
      if (at.getTime() < due || (c.whatsappRemindedAt && c.whatsappRemindedAt > orders[0].placedAt)) continue;
      const user = await prisma.user.findUnique({ where: { id: orders[0].placedByUserId }, select: { locale: true } });
      const locale = user?.locale ?? localeFromPhone(c.whatsapp!);
      const t = await bot(locale);
      const open = await windowOpen(c.whatsapp!);
      if (!open && !s.templates.reminder) continue;
      const name = c.tradeName ?? c.legalName;
      await sendWa({ to: c.whatsapp!, body: t("reminder", { company: name, number: orders[0].number }), locale, userId: orders[0].placedByUserId, companyId: c.id, event: "whatsapp.reminder",
        buttons: s.inputs.buttons ? [{ id: "wa_repeat", title: t("btnRepeat") }] : undefined, template: open ? null : { name: s.templates.reminder, language: s.templates.language, params: [name, orders[0].number] } }).catch(() => null);
      await prisma.company.update({ where: { id: c.id }, data: { whatsappRemindedAt: at } });
      reminders++;
    }
  }
  return { pending, reminders };
}

// ── FIRINGI's pages ──

/** One line of a message for a list: WhatsApp text, no formatting, at most 160 characters. */
const preview = (t: string) => { const x = toWhatsApp(t).replace(/[*_]/g, "").replace(/\s+/g, " ").trim(); return x.length > 160 ? `${x.slice(0, 157)}…` : x; };

function staffOnly(ctx: Ctx, manage = false) {
  if (!isStaff(ctx) || !can(ctx, manage ? ["admin.messages.manage", "admin.settings.manage"] : ["admin.notifications.view", "admin.messages.manage", "admin.settings.manage"])) throw new ForbiddenError();
}

export async function waOverview(ctx: Ctx) {
  staffOnly(ctx);
  const since30 = new Date(Date.now() - 30 * 86400_000), since7 = new Date(Date.now() - 7 * 86400_000);
  const [s, msgs7, answered7, orders30, drafts, convs] = await Promise.all([
    waSettings(),
    prisma.inboundMessage.count({ where: { channel: "WHATSAPP", receivedAt: { gt: since7 } } }),
    prisma.inboundMessage.count({ where: { channel: "WHATSAPP", aiStatus: "DONE", receivedAt: { gt: since7 } } }),
    prisma.order.findMany({ where: { placedVia: "WHATSAPP", placedAt: { gt: since30 } }, select: { id: true, number: true, grandTotal: true, status: true, placedAt: true, buyer: { select: { legalName: true, tradeName: true } } }, orderBy: { placedAt: "desc" }, take: 50 }),
    prisma.waOrderDraft.findMany({ orderBy: { createdAt: "desc" }, take: 30, include: { company: { select: { legalName: true, tradeName: true } } } }),
    prisma.aiConversation.findMany({ where: { channel: "WHATSAPP" }, orderBy: { updatedAt: "desc" }, take: 50, include: { messages: { orderBy: { at: "desc" }, take: 1, select: { text: true, role: true, at: true } } } }),
  ]);
  const cos = await prisma.company.findMany({ where: { id: { in: convs.map((c) => c.companyId) } }, select: { id: true, legalName: true, tradeName: true } });
  const nm = (c?: { legalName: string; tradeName: string | null } | null) => (c ? c.tradeName ?? c.legalName : "");
  const { providerStatus } = await import("@/server/notify/providers");
  const { transcriptionReady } = await import("./media");
  return {
    settings: s, provider: providerStatus("WHATSAPP"), voiceReady: transcriptionReady(), aiReady: !!process.env.ANTHROPIC_API_KEY || process.env.ASSISTANT_SIMULATE === "1",
    tiles: { messages7: msgs7, answered7, orders30: orders30.length, value30: orders30.reduce((a, o) => a.plus(o.grandTotal.toString()), new Decimal(0)).toFixed(2), pendingDrafts: drafts.filter((d) => d.status === "PENDING").length, paused: convs.filter((c) => c.aiPausedUntil && c.aiPausedUntil > new Date()).length },
    conversations: convs.map((c) => ({ id: c.id, company: nm(cos.find((x) => x.id === c.companyId)), number: c.waNumber, updatedAt: c.updatedAt.toISOString(), last: c.messages[0] ? `${c.messages[0].role === "user" ? "Customer" : "AI"}: ${preview(c.messages[0].text)}` : "", pausedUntil: c.aiPausedUntil && c.aiPausedUntil > new Date() ? c.aiPausedUntil.toISOString() : null })),
    drafts: drafts.map((d) => ({ id: d.id, company: nm(d.company), number: d.waNumber, status: d.status, total: d.totalGross.toString(), orders: d.orderNumbers, createdAt: d.createdAt.toISOString(), error: d.error })),
    orders: orders30.map((o) => ({ id: o.id, number: o.number, company: nm(o.buyer), total: o.grandTotal.toString(), status: o.status, at: o.placedAt.toISOString() })),
  };
}

/** Staff take over a WhatsApp conversation (the AI stays quiet) or give it back to the AI. */
export async function setConversationPause(ctx: Ctx, conversationId: string, pause: boolean) {
  staffOnly(ctx, true);
  const c = await prisma.aiConversation.findUnique({ where: { id: conversationId } });
  if (!c || c.channel !== "WHATSAPP") throw new NotFoundError();
  const s = await waSettings();
  await prisma.aiConversation.update({ where: { id: c.id }, data: { aiPausedUntil: pause ? new Date(Date.now() + s.pauseHours * 3600_000) : null } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: pause ? "whatsapp.ai_paused" : "whatsapp.ai_resumed", entityType: "AiConversation", entityId: c.id });
}

// ── the business's own page ──

function buyerOnly(ctx: Ctx) {
  if ((ctx.company.type !== "CUSTOMER" && ctx.company.type !== "WHOLESALER") || !can(ctx, ["buyer.orders.view", "buyer.orders.place", "company.profile.manage"])) throw new ForbiddenError();
}

export async function myWhatsApp(ctx: Ctx) {
  buyerOnly(ctx);
  const s = await waSettings();
  const { companyFeatureOn } = await import("@/server/accounting/features");
  const { landingSettings } = await import("@/server/landing/service");
  const [co, feature, ls, orders] = await Promise.all([
    prisma.company.findUniqueOrThrow({ where: { id: ctx.company.id }, select: { whatsapp: true, whatsappOrderUpdates: true, whatsappReminders: true, type: true } }),
    companyFeatureOn(ctx.company.id, "WHATSAPP_ORDERING"),
    landingSettings(),
    prisma.order.findMany({ where: { buyerCompanyId: ctx.company.id, placedVia: "WHATSAPP" }, orderBy: { placedAt: "desc" }, take: 10, select: { id: true, number: true, status: true, grandTotal: true, placedAt: true } }),
  ]);
  const audienceOn = co.type === "CUSTOMER" ? s.audiences.customers : s.audiences.wholesalers;
  const firingi = (ls as { whatsapp?: string }).whatsapp || process.env.WHATSAPP_PUBLIC_NUMBER || "";
  return {
    available: s.enabled && audienceOn && feature, firingiNumber: firingi ? `+${firingi.replace(/\D/g, "")}` : null, myNumber: co.whatsapp,
    orderUpdates: co.whatsappOrderUpdates, reminders: co.whatsappReminders, remindersOn: s.reminders.enabled, voice: s.inputs.voice, photos: s.inputs.photos,
    canEdit: can(ctx, ["company.profile.manage", "buyer.orders.place"]),
    orders: orders.map((o) => ({ id: o.id, number: o.number, status: o.status, total: o.grandTotal.toString(), at: o.placedAt.toISOString() })),
  };
}

export async function saveMyWhatsApp(ctx: Ctx, i: { orderUpdates: boolean; reminders: boolean }) {
  buyerOnly(ctx);
  if (!can(ctx, ["company.profile.manage", "buyer.orders.place"])) throw new ForbiddenError();
  const co = await prisma.company.findUniqueOrThrow({ where: { id: ctx.company.id }, select: { whatsapp: true } });
  if (i.reminders && !co.whatsapp) throw new ValidationError("Add your WhatsApp number in the company profile first.");
  await prisma.company.update({ where: { id: ctx.company.id }, data: { whatsappOrderUpdates: i.orderUpdates, whatsappReminders: i.reminders } });
  await writeAudit({ actorUserId: ctx.user.id, actorCompanyId: ctx.company.id, action: "whatsapp.preferences_saved", entityType: "Company", entityId: ctx.company.id, after: i });
}

export { DEFAULT_WA };

/** FIRINGI: wholesale businesses with their WhatsApp number, switch and small-order limit (settings page). */
export async function waBusinesses(ctx: Ctx) {
  staffOnly(ctx);
  const { smallOrderSettings } = await import("@/server/orders/small-orders");
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
  const [small, rows, used] = await Promise.all([
    smallOrderSettings(),
    prisma.company.findMany({
      where: { type: { in: ["CUSTOMER", "WHOLESALER"] }, status: "APPROVED", isInHouse: false },
      select: { id: true, legalName: true, tradeName: true, type: true, whatsapp: true, smallOrdersPerMonth: true, smallOrdersUnlimited: true, features: { where: { key: "WHATSAPP_ORDERING" }, select: { enabled: true } } },
      orderBy: { legalName: "asc" },
    }),
    prisma.order.groupBy({ by: ["buyerCompanyId"], where: { smallOrder: true, status: { notIn: ["CANCELLED"] }, placedAt: { gte: monthStart } }, _count: { _all: true } }),
  ]);
  return {
    small,
    rows: rows.map((c) => ({
      id: c.id, name: c.tradeName ?? c.legalName, type: c.type, whatsapp: c.whatsapp, whatsappOn: c.features[0]?.enabled ?? true,
      perMonth: c.smallOrdersPerMonth, unlimited: c.smallOrdersUnlimited, used: used.find((u) => u.buyerCompanyId === c.id)?._count._all ?? 0,
    })),
  };
}
