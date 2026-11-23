/**
 * AI Business Assistant — Claude (Anthropic API) answering questions about the user's own
 * FIRINGI data through read-only tools (tools.ts). Suggest only: it can't change anything.
 *
 * - Model claude-opus-5-5 (changeable in AI settings), adaptive thinking, effort "medium".
 * - Server-side fallback on (beta "server-side-fallback-2026-07-01", fallbacks: "default"):
 *   if the model is overloaded the API answers with an eligible fallback model; the model that
 *   answered is stored with the message.
 * - Prompt caching: top-level cache_control (system + tools + earlier turns are reused).
 * - Without ANTHROPIC_API_KEY the assistant is off and the pages say how to switch it on.
 */
import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import type { Ctx } from "@/server/context";
import { can } from "@/server/rbac/guard";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { aiScope, type Side } from "./insights";
import { CompanyFeatureOffError, companyFeatureOn } from "@/server/accounting/features";
import { logAi } from "./feed";
import { apiTools, toolsFor, type Channel, type ToolCard } from "./tools";
import { AI_MODELS, DEFAULT_AI, type AiSettings } from "@/lib/ai";
export type { AiSettings };

type BetaMessage = Anthropic.Beta.Messages.BetaMessage;
type BetaMessageParam = Anthropic.Beta.Messages.BetaMessageParam;
type CreateParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type ToolResult = Anthropic.Beta.Messages.BetaToolResultBlockParam;

const AI_KEY = "ai.settings";
const MAX_STEPS = 8;
const MAX_TOOL_CHARS = 14_000;
const HISTORY_TURNS = 12;

export async function aiSettings(): Promise<AiSettings> {
  const row = await prisma.setting.findFirst({ where: { scope: "GLOBAL", scopeId: "", key: AI_KEY } });
  return { ...DEFAULT_AI, ...((row?.value as Partial<AiSettings>) ?? {}) };
}

export async function saveAiSettings(ctx: Ctx, input: Partial<AiSettings>) {
  if (ctx.company.type !== "ADMIN" || !can(ctx, "admin.settings.manage")) throw new ForbiddenError();
  const cur = await aiSettings();
  const next = { ...cur, ...input };
  if (!AI_MODELS.includes(next.model)) throw new ValidationError("Choose one of the listed models.");
  if (!Number.isInteger(next.hourlyLimit) || next.hourlyLimit < 1 || next.hourlyLimit > 500) throw new ValidationError("Questions per hour: 1 to 500.");
  await prisma.setting.upsert({
    where: { scope_scopeId_key: { scope: "GLOBAL", scopeId: "", key: AI_KEY } },
    update: { value: next as unknown as Prisma.InputJsonValue, updatedById: ctx.user.id }, create: { scope: "GLOBAL", key: AI_KEY, value: next as unknown as Prisma.InputJsonValue, updatedById: ctx.user.id },
  });
  await logAi({ kind: "SETTINGS", ctx, summary: "AI settings changed", detail: { before: cur, after: next } });
  return next;
}

/** Is the assistant configured (API key) and switched on — for staff globally, for a supplier / customer per company? */
export async function assistantStatus(side: Side, companyId?: string) {
  const s = await aiSettings();
  const configured = !!process.env.ANTHROPIC_API_KEY || !!transportOverride || simulating(side);
  const on = side === "STAFF" ? s.staff : (side === "BUYER" ? s.buyers : s.suppliers) && !!companyId && (await companyFeatureOn(companyId, "ASSISTANT"));
  // Photos & barcode scan: FIRINGI's global switch and the company's own
  const photos = side !== "STAFF" && on && s.photos && (await companyFeatureOn(companyId!, "ASSISTANT_PHOTOS"));
  // Phase 67: AI Governance's master switch stops every Claude call
  const governed = (await (await import("./ops/governance")).governance()).enabled;
  return { configured, enabled: configured && on && governed, switchedOn: on, photos, model: s.model };
}

// ── transport (swappable in tests: no live API calls there) ─────────────────

export type AiTransport = (params: CreateParams) => Promise<BetaMessage>;
let transportOverride: AiTransport | null = null;
export function setAiTransportForTests(t: AiTransport | null) { transportOverride = t; }

/** Development / browser tests only: a rule-based stand-in for the customer / supplier agent when there is no API key (see simulated.ts). */
const simulating = (side: Side) => side !== "STAFF" && process.env.ASSISTANT_SIMULATE === "1" && !process.env.ANTHROPIC_API_KEY && process.env.FIRINGI_ENV !== "production";

let client: Anthropic | null = null;
const liveTransport: AiTransport = async (params) => {
  client ??= new Anthropic(); // reads ANTHROPIC_API_KEY; retries 429 / 5xx itself
  // Streaming keeps long answers clear of HTTP timeouts; we only need the final message.
  return client.beta.messages.stream(params).finalMessage();
};

/** One call outside the chat (Phase 44: reading a food label) — the same live transport and test override; null = no AI connected. */
export function aiTransport(): AiTransport | null {
  if (transportOverride) return transportOverride;
  return process.env.ANTHROPIC_API_KEY ? liveTransport : null;
}

// ── prompt ──────────────────────────────────────────────────────────────────

function languageName(locale: string) {
  try { return new Intl.DisplayNames(["en"], { type: "language" }).of(locale) ?? "English"; } catch { return "English"; }
}

/** Facts the support agent may quote (from FIRINGI's own settings). */
async function helpFacts() {
  const [{ claimSettings }, { RETURN_WINDOW_DAYS }] = await Promise.all([import("@/server/claims/service"), import("@/server/services/returns")]);
  const c = await claimSettings();
  return [
    "How FIRINGI works (for support answers): FIRINGI buys from the supplier and resells, so every invoice comes from FIRINGI.",
    "Prices in the catalogue are per pack, excl. VAT; the cart shows VAT, the delivery fee and any minimum order still missing. Orders are placed from the cart (Orders › Cart); Buy Again refills a usual order.",
    `Problems with delivered goods (damaged, missing, wrong, warm, short-dated, poor quality): report them on the delivered order with "Report a problem" within ${c.windowHours} hours of delivery, with photos; FIRINGI decides within ${c.slaHours} hours (credit note or replacement).`,
    `Returns: up to ${RETURN_WINDOW_DAYS} days after delivery from the order (Orders › Returns); FIRINGI approves them.`,
    "Invoices and payments: Invoices & Payments (MB WAY, Multibanco, card or SEPA direct debit where offered). Help & Support reaches FIRINGI staff.",
  ].join("\n");
}

const PHOTOS_BUYER = "Photos and barcodes: the customer may send photos (a product or its label, a handwritten or printed order list, an empty shelf) or a scanned barcode number. Read what is in the photo; search the catalogue for each product by name, brand or the barcode digits you can read. For an order list, go through it line by line: add each line you matched with its quantity when the customer asked to order or add it, then list clearly what you added and what you could not match or read (ask about those). Never guess a quantity that isn't written or said — ask. If a photo is unclear, say what you can see and ask.";
const PHOTOS_VENDOR = "Photos: the supplier may send photos (a delivery note, damaged goods, a document). Describe what matters for the question; if FIRINGI staff need to see it, offer the handover — the photos go with the chat.";

/** Up to 3 photos per question (JPG / PNG / WEBP, 5 MB each — the browser shrinks them first). */
export const MAX_PHOTOS = 3;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

const WHATSAPP = [
  "You are answering on WhatsApp. Keep every reply short (at most about 10 lines), in plain text; *bold* is fine, no tables, no Markdown links. The customer can't see the website cart here: you show what matters in the chat.",
  "Ordering on WhatsApp: find the products (search_catalogue), put what the customer asked in the cart (add_to_cart; ask if the product or quantity is unclear), then call propose_order. propose_order checks each supplier's own minimum order and free-delivery amount and sends the customer the order to confirm. The order is placed only when the customer replies YES — never say it is placed or confirmed yourself. For 'the same as last time' use repeat_last_order, then propose_order.",
  "Payments: pay_invoices_link gives a secure payment link for the open invoices.",
].join("\n");

function systemPrompt(ctx: Ctx, side: Side, locale: string, facts = "", channel: Channel = "WEB") {
  const who = side === "STAFF"
    ? "a member of FIRINGI's back-office staff. FIRINGI is a B2B wholesale marketplace in the Schengen area: restaurants and shops (customers) buy from wholesalers in their own country; wholesalers buy from distributors across the EU. FIRINGI buys from the supplier and resells to every buyer, earning a commission that buyers never see."
    : side === "VENDOR"
      ? `a supplier on FIRINGI: ${ctx.company.tradeName ?? ctx.company.legalName}, a ${ctx.company.type.toLowerCase()}. FIRINGI buys its goods and resells them to its customers; it is paid its payout (sales minus FIRINGI's commission).`
      : `a buyer on FIRINGI: ${ctx.company.tradeName ?? ctx.company.legalName}. It buys from suppliers through FIRINGI, which invoices it.`;
  const agent = side === "BUYER"
    ? [
        "You are FIRINGI's customer support and sales agent for this customer: help them find and buy products, and solve questions about their orders, deliveries, invoices, payments, returns and quality claims.",
        "Selling: search the catalogue, compare packs and prices, mention current offers and what they usually buy (reorder_outlook). When the customer clearly asks for a product and quantity, put it in their cart with add_to_cart; if the product or quantity is unclear, ask first. Never claim an order was placed — after adding, say what is in the cart and that they open the cart to check and place the order (and if a minimum order or delivery fee applies).",
        "You can't place, change or cancel orders, prices or settings yourself — only fill the cart. For anything only FIRINGI staff can do (refund, cancel an order, change an invoice, account changes, complaints) or when the customer asks for a person, use handover.",
        PHOTOS_BUYER,
      ]
    : side === "VENDOR"
      ? [
          "You are FIRINGI's support agent for this supplier: answer questions about its orders, deliveries, billing statements, invoices to FIRINGI, payouts, quality claims and charge-backs, and how FIRINGI works. You don't sell to suppliers.",
          "You can only look and explain; for anything FIRINGI staff must decide or change, or when the supplier asks for a person, use handover.",
          PHOTOS_VENDOR,
        ]
      : ["You can only look and suggest. You cannot place, change or cancel orders, prices, stock or settings; say where in FIRINGI the user can do it."];
  return [
    `You are FIRINGI's ${side === "STAFF" ? "business assistant" : "assistant"} ("WHOLESALE MADE SIMPLE"). You are talking with ${who}`,
    "Answer using the tools, which read FIRINGI's live data with this user's own access rights. Use a tool whenever the answer depends on data — never guess numbers, prices or stock. If a tool says the user has no access, say so plainly.",
    ...agent,
    side !== "STAFF" ? facts : "",
    side === "BUYER" ? "Never mention FIRINGI's commission, margins, supplier costs or payouts, or other customers." : "",
    side === "VENDOR" ? "Talk only about this supplier's own products, orders and customers." : "",
    channel === "WHATSAPP" ? WHATSAPP : "",
    `Reply in ${languageName(locale)}. Be short and concrete: lead with the answer, then the few numbers that support it (amounts in EUR, excl. VAT unless said), then at most three suggestions. Use plain words; use a small Markdown table only when comparing several rows.`,
  ].filter(Boolean).join("\n\n");
}

// ── conversations ───────────────────────────────────────────────────────────

/**
 * Staff: the AI right (Super Admin by default, others by role). Suppliers and customers: only when
 * FIRINGI switched the Assistant on for their company (Settings › Business Features).
 */
async function assertSide(ctx: Ctx, side: Side, channel: Channel = "WEB") {
  aiScope(ctx, side);
  if (side === "STAFF" || channel === "WHATSAPP") return; // WhatsApp: its own switches (whatsapp/ordering.ts)
  const s = await aiSettings();
  if (!(side === "BUYER" ? s.buyers : s.suppliers) || !(await companyFeatureOn(ctx.company.id, "ASSISTANT"))) throw new CompanyFeatureOffError();
}

export async function listConversations(ctx: Ctx, side: Side) {
  await assertSide(ctx, side);
  return prisma.aiConversation.findMany({ where: { userId: ctx.user.id, companyId: ctx.company.id, side, channel: "WEB" }, orderBy: { updatedAt: "desc" }, take: 50, select: { id: true, title: true, updatedAt: true } });
}

export async function getConversation(ctx: Ctx, side: Side, id: string, channel: Channel = "WEB") {
  await assertSide(ctx, side, channel);
  const c = await prisma.aiConversation.findFirst({ where: { id, userId: ctx.user.id, companyId: ctx.company.id, side, channel }, include: { messages: { orderBy: { at: "asc" } } } });
  if (!c) throw new NotFoundError("Conversation");
  return c;
}

export async function deleteConversation(ctx: Ctx, side: Side, id: string) {
  await getConversation(ctx, side, id);
  await prisma.aiConversation.delete({ where: { id } });
}

// ── ask ─────────────────────────────────────────────────────────────────────

const textOf = (m: BetaMessage) => m.content.filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === "text").map((b) => b.text).join("\n").trim();

export async function ask(ctx: Ctx, side: Side, input: { conversationId?: string | null; text: string; locale?: string; photos?: File[]; whatsapp?: { number: string } }) {
  const channel: Channel = input.whatsapp ? "WHATSAPP" : "WEB";
  await assertSide(ctx, side, channel);
  const files = (input.photos ?? []).filter((f) => f && f.size > 0);
  const text = input.text.trim() || (files.length ? "(photo)" : "");
  if (!text) throw new ValidationError("Type a question.");
  if (side === "STAFF" && files.length) throw new ValidationError("Photos are for the customer and supplier Assistant.");
  if (files.length > MAX_PHOTOS) throw new ValidationError(`Up to ${MAX_PHOTOS} photos per question.`);
  if (files.some((f) => f.size > MAX_PHOTO_BYTES)) throw new ValidationError("Each photo can be up to 5 MB.");
  if (text.length > 4000) throw new ValidationError("Please keep the question under 4,000 characters.");
  const status = await assistantStatus(side, ctx.company.id);
  if (!status.configured) throw new AppError("AI_NOT_CONFIGURED", "The AI assistant isn't set up yet (no Anthropic API key).", 503);
  if (!status.switchedOn && channel === "WEB") throw new ForbiddenError("The AI assistant is switched off.");
  if (files.length && !status.photos && channel === "WEB") throw new ValidationError("Photos are switched off for the Assistant.");
  const settings = await aiSettings();
  // Phase 67: AI Governance (master switch, monthly budget) and the model chosen for the assistant
  const { assertClaude, modelFor } = await import("./ops/governance");
  await assertClaude("assistant");
  const model = await modelFor("assistant");
  const asked = await prisma.aiMessage.count({ where: { role: "user", at: { gt: new Date(Date.now() - 3600_000) }, conversation: { userId: ctx.user.id } } });
  if (asked >= settings.hourlyLimit) throw new AppError("AI_LIMIT", `You've reached ${settings.hourlyLimit} questions this hour — please try again later.`, 429);

  const locale = input.locale ?? ctx.user.locale ?? "en";
  const conv = input.conversationId ? await getConversation(ctx, side, input.conversationId, channel) : null;
  // Earlier photos aren't sent again (cost); the answer that followed them says what they showed.
  const history: BetaMessageParam[] = (conv?.messages ?? []).slice(-HISTORY_TURNS * 2).map((m) => ({
    role: m.role as "user" | "assistant", content: m.photoKeys.length ? `[sent ${m.photoKeys.length} photo(s) earlier]\n${m.text}` : m.text,
  }));
  // Photos: stored (kept with the conversation, shown in the chat, passed on with a hand-over) and sent with this question.
  const photos: { key: string; mime: string; data: string }[] = [];
  for (const f of files) {
    const { storeUpload, readStored } = await import("@/server/services/storage");
    const stored = await storeUpload(f, "assistant");
    if (!["image/jpeg", "image/png", "image/webp"].includes(stored.mimeType)) throw new ValidationError("Photos must be JPG, PNG or WEBP.");
    photos.push({ key: stored.key, mime: stored.mimeType, data: (await readStored(stored.key)).toString("base64") });
  }
  // The date goes in the newest turn (not the system prompt) so the cached prefix stays the same.
  const question = `[Today is ${new Date().toISOString().slice(0, 10)}]\n\n${photos.length ? `[${photos.length} photo(s) attached]\n` : ""}${text}`;
  const messages: BetaMessageParam[] = [...history, {
    role: "user",
    content: photos.length
      ? [...photos.map((p) => ({ type: "image" as const, source: { type: "base64" as const, media_type: p.mime as "image/jpeg" | "image/png" | "image/webp", data: p.data } })), { type: "text" as const, text: question }]
      : question,
  }];
  const facts = side === "STAFF" ? "" : await helpFacts();
  const tools = apiTools(side, channel);
  const runners = new Map(toolsFor(side, channel).map((t) => [t.name, t]));
  const transport = transportOverride ?? (simulating(side) ? (await import("./simulated")).simulatedTransport : liveTransport);
  const used: { name: string; input: unknown; ok: boolean; card?: ToolCard }[] = [];
  let tokensIn = 0, tokensOut = 0, answer = "", stopReason: string | null = null, servedBy: string = model;

  for (let step = 0; step < MAX_STEPS; step++) {
    let res: BetaMessage;
    try {
      res = await transport({
        model, max_tokens: 16000, system: systemPrompt(ctx, side, locale, facts, channel), tools, tool_choice: { type: "auto" }, messages,
        thinking: { type: "adaptive" }, output_config: { effort: "medium" }, cache_control: { type: "ephemeral" },
        betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
        metadata: { user_id: ctx.user.id },
      });
    } catch (e) {
      throw friendlyError(e);
    }
    const u = res.usage;
    tokensIn += (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
    tokensOut += u.output_tokens ?? 0;
    servedBy = res.model;
    stopReason = res.stop_reason;
    // The full content goes back unchanged (thinking blocks included) so the model continues its own turn.
    messages.push({ role: "assistant", content: res.content as unknown as Anthropic.Beta.Messages.BetaContentBlockParam[] });
    const said = textOf(res);
    if (said) answer = said;
    if (res.stop_reason === "pause_turn") continue; // the API paused a long turn: send it back to continue
    if (res.stop_reason !== "tool_use") break;
    // Run every requested tool and answer them all in one user message.
    const results: ToolResult[] = [];
    for (const block of res.content) {
      if (block.type !== "tool_use") continue;
      const t = runners.get(block.name);
      const parsed = t?.input.safeParse(block.input);
      let content: string, isError = false, card: ToolCard | undefined;
      if (!t) { content = `Unknown tool ${block.name}.`; isError = true; }
      else if (!parsed!.success) { content = `Invalid input: ${parsed!.error.issues.map((x) => x.message).join("; ")}`; isError = true; }
      else {
        try {
          const out = await t.run(ctx, side, parsed!.data, locale, { channel, waNumber: input.whatsapp?.number ?? null, conversationId: conv?.id ?? null });
          card = (out as { card?: ToolCard } | null)?.card;
          content = JSON.stringify(out ?? null);
          if (content.length > MAX_TOOL_CHARS) content = `${content.slice(0, MAX_TOOL_CHARS)}… [cut: ask for fewer rows]`;
        } catch (e) {
          isError = true;
          content = e instanceof ForbiddenError ? "This user has no access to that data." : e instanceof AppError ? e.message : "The data couldn't be read just now.";
        }
      }
      used.push({ name: block.name, input: block.input, ok: !isError, ...(card ? { card } : {}) });
      results.push({ type: "tool_result", tool_use_id: block.id, content, ...(isError ? { is_error: true } : {}) });
    }
    messages.push({ role: "user", content: results });
    if (step === MAX_STEPS - 1) stopReason = "max_steps";
  }

  if (stopReason === "refusal") answer = "I can't help with that request.";
  else if (stopReason === "max_tokens") answer = `${answer}\n\n(The answer was cut short — ask a narrower question for the rest.)`.trim();
  else if (stopReason === "max_steps" || stopReason === "tool_use") answer = answer || "That needed more steps than I can take in one answer — please ask a narrower question.";
  else if (stopReason === "model_context_window_exceeded") answer = `${answer}\n\n(This conversation is too long — please start a new one.)`.trim();
  if (!answer) answer = "I couldn't find an answer to that.";

  const saved = await prisma.$transaction(async (tx) => {
    const c = conv ?? await tx.aiConversation.create({ data: { userId: ctx.user.id, companyId: ctx.company.id, side, channel, waNumber: input.whatsapp?.number ?? null, title: text.length > 80 ? `${text.slice(0, 77)}…` : text } });
    const q = await tx.aiMessage.create({ data: { conversationId: c.id, role: "user", text, photoKeys: photos.map((p) => p.key) } });
    const m = await tx.aiMessage.create({ data: { conversationId: c.id, role: "assistant", text: answer, tools: used as Prisma.InputJsonValue, model: servedBy, tokensIn, tokensOut, stopReason } });
    await tx.aiConversation.update({ where: { id: c.id }, data: { updatedAt: new Date() } });
    return { conversationId: c.id, message: m, question: q };
  });
  await logAi({ kind: "ASSISTANT", ctx, summary: `${side.toLowerCase()} asked: ${text.slice(0, 160)}`, detail: { conversationId: saved.conversationId, tools: used.map((x) => `${x.name}${x.ok ? "" : " (error)"}`), stopReason, side, photos: photos.length }, model: servedBy, tokensIn, tokensOut });
  return { conversationId: saved.conversationId, messageId: saved.message.id, questionId: saved.question.id, photos: photos.length, answer, tools: used, model: servedBy, fellBack: servedBy !== model };
}

/** A photo the person sent in their own conversation (for the chat thumbnails). */
export async function assistantPhotoKey(ctx: Ctx, messageId: string, n: number) {
  const m = await prisma.aiMessage.findFirst({ where: { id: messageId, role: "user", conversation: { userId: ctx.user.id, companyId: ctx.company.id } }, select: { photoKeys: true } });
  const key = m?.photoKeys[n];
  if (!key) throw new NotFoundError("Photo");
  return key;
}

// ── hand-over to FIRINGI support (a person) ─────────────────────────────────

type StoredTool = { name: string; input?: unknown; ok: boolean; card?: ToolCard; ticketId?: string; ticketNumber?: string };

/**
 * The person tapped "Send to FIRINGI support" under an answer that offered it: a Help & Support
 * request is opened in their name with the assistant's summary and the chat so far. Once per answer.
 */
export async function handoverToSupport(ctx: Ctx, side: Side, messageId: string) {
  if (side === "STAFF") throw new ForbiddenError();
  await assertSide(ctx, side);
  const m = await prisma.aiMessage.findFirst({ where: { id: messageId, role: "assistant", conversation: { userId: ctx.user.id, companyId: ctx.company.id, side } }, include: { conversation: { include: { messages: { orderBy: { at: "asc" } } } } } });
  if (!m) throw new NotFoundError("Message");
  const tools = ((m.tools ?? []) as unknown as StoredTool[]);
  const i = tools.findIndex((t) => t.card?.kind === "handover");
  if (i < 0) throw new ValidationError("This answer didn't offer to contact FIRINGI support.");
  const prev = tools[i];
  if (prev.ticketId) return { ticketId: prev.ticketId, number: prev.ticketNumber ?? "", already: true };
  const card = prev.card as Extract<ToolCard, { kind: "handover" }>;
  const recent = m.conversation.messages.filter((x) => x.at <= m.at).slice(-12);
  // Support messages are plain text: drop the Markdown emphasis marks of the answers.
  const plain = (t: string) => t.replace(/\*\*(.+?)\*\*/g, "$1").replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,!?:;]|$)/gm, "$1$2");
  const chat = recent.map((x) => `${x.role === "user" ? "Customer" : "Assistant"}: ${x.photoKeys.length ? `[${x.photoKeys.length} photo(s)] ` : ""}${plain(x.text)}`).join("\n\n");
  const photoKeys = recent.flatMap((x) => x.photoKeys).slice(-6);
  const body = `${card.summary}\n\n— Chat with the FIRINGI assistant —\n\n${chat}`.slice(0, 8000);
  const { openTicket } = await import("@/server/services/support");
  const t = await openTicket(ctx, { subject: card.subject.slice(0, 150), body, category: card.category as Parameters<typeof openTicket>[1]["category"], photoKeys });
  tools[i] = { ...prev, ticketId: t.id, ticketNumber: t.number };
  await prisma.aiMessage.update({ where: { id: m.id }, data: { tools: tools as unknown as Prisma.InputJsonValue } });
  await logAi({ kind: "ASSISTANT", ctx, summary: `handed over to FIRINGI support: ${t.number}`, detail: { conversationId: m.conversationId, ticketId: t.id, side } });
  return { ticketId: t.id, number: t.number, already: false };
}

function friendlyError(e: unknown) {
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return new AppError("AI_KEY", "The AI service rejected FIRINGI's API key — an administrator needs to check it.", 503);
  if (e instanceof Anthropic.RateLimitError) return new AppError("AI_BUSY", "The AI service is busy right now — please try again in a minute.", 503);
  if (e instanceof Anthropic.APIConnectionError) return new AppError("AI_OFFLINE", "FIRINGI couldn't reach the AI service — please try again.", 503);
  if (e instanceof Anthropic.BadRequestError) return new AppError("AI_REQUEST", "The AI service couldn't handle this question — try rephrasing it or start a new conversation.", 400);
  if (e instanceof Anthropic.APIError) return new AppError("AI_DOWN", "The AI service is unavailable right now — please try again later.", 503);
  return e instanceof Error ? e : new Error(String(e));
}
