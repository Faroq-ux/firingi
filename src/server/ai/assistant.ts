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
import { apiTools, toolsFor } from "./tools";
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
  const configured = !!process.env.ANTHROPIC_API_KEY || !!transportOverride;
  const on = side === "STAFF" ? s.staff : !!companyId && (await companyFeatureOn(companyId, "ASSISTANT"));
  return { configured, enabled: configured && on, switchedOn: on, model: s.model };
}

// ── transport (swappable in tests: no live API calls there) ─────────────────

export type AiTransport = (params: CreateParams) => Promise<BetaMessage>;
let transportOverride: AiTransport | null = null;
export function setAiTransportForTests(t: AiTransport | null) { transportOverride = t; }

let client: Anthropic | null = null;
const liveTransport: AiTransport = async (params) => {
  client ??= new Anthropic(); // reads ANTHROPIC_API_KEY; retries 429 / 5xx itself
  // Streaming keeps long answers clear of HTTP timeouts; we only need the final message.
  return client.beta.messages.stream(params).finalMessage();
};

// ── prompt ──────────────────────────────────────────────────────────────────

function languageName(locale: string) {
  try { return new Intl.DisplayNames(["en"], { type: "language" }).of(locale) ?? "English"; } catch { return "English"; }
}

function systemPrompt(ctx: Ctx, side: Side, locale: string) {
  const who = side === "STAFF"
    ? "a member of FIRINGI's back-office staff. FIRINGI is a B2B wholesale marketplace in the Schengen area: restaurants and shops (customers) buy from wholesalers in their own country; wholesalers buy from distributors across the EU. FIRINGI buys from the supplier and resells to every buyer, earning a commission that buyers never see."
    : side === "VENDOR"
      ? `a supplier on FIRINGI: ${ctx.company.tradeName ?? ctx.company.legalName}, a ${ctx.company.type.toLowerCase()}. FIRINGI buys its goods and resells them to its customers; it is paid its payout (sales minus FIRINGI's commission).`
      : `a buyer on FIRINGI: ${ctx.company.tradeName ?? ctx.company.legalName}. It buys from suppliers through FIRINGI, which invoices it.`;
  return [
    `You are FIRINGI's business assistant ("WHOLESALE MADE SIMPLE"). You are talking with ${who}`,
    "Answer questions about their business using the tools, which read FIRINGI's live data with this user's own access rights. Use a tool whenever the answer depends on data — never guess numbers. If a tool says the user has no access, say so plainly.",
    "You can only look and suggest. You cannot place, change or cancel orders, prices, stock or settings; say where in FIRINGI the user can do it.",
    side === "BUYER" ? "Never mention FIRINGI's commission, margins, supplier costs or payouts, or other customers." : "",
    side === "VENDOR" ? "Talk only about this supplier's own products, orders and customers." : "",
    `Reply in ${languageName(locale)}. Be short and concrete: lead with the answer, then the few numbers that support it (amounts in EUR, excl. VAT unless said), then at most three suggestions. Use plain words; use a small Markdown table only when comparing several rows.`,
  ].filter(Boolean).join("\n\n");
}

// ── conversations ───────────────────────────────────────────────────────────

/**
 * Staff: the AI right (Super Admin by default, others by role). Suppliers and customers: only when
 * FIRINGI switched the Assistant on for their company (Settings › Business Features).
 */
async function assertSide(ctx: Ctx, side: Side) {
  aiScope(ctx, side);
  if (side !== "STAFF" && !(await companyFeatureOn(ctx.company.id, "ASSISTANT"))) throw new CompanyFeatureOffError();
}

export async function listConversations(ctx: Ctx, side: Side) {
  await assertSide(ctx, side);
  return prisma.aiConversation.findMany({ where: { userId: ctx.user.id, companyId: ctx.company.id, side }, orderBy: { updatedAt: "desc" }, take: 50, select: { id: true, title: true, updatedAt: true } });
}

export async function getConversation(ctx: Ctx, side: Side, id: string) {
  await assertSide(ctx, side);
  const c = await prisma.aiConversation.findFirst({ where: { id, userId: ctx.user.id, companyId: ctx.company.id, side }, include: { messages: { orderBy: { at: "asc" } } } });
  if (!c) throw new NotFoundError("Conversation");
  return c;
}

export async function deleteConversation(ctx: Ctx, side: Side, id: string) {
  await getConversation(ctx, side, id);
  await prisma.aiConversation.delete({ where: { id } });
}

// ── ask ─────────────────────────────────────────────────────────────────────

const textOf = (m: BetaMessage) => m.content.filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === "text").map((b) => b.text).join("\n").trim();

export async function ask(ctx: Ctx, side: Side, input: { conversationId?: string | null; text: string; locale?: string }) {
  await assertSide(ctx, side);
  const text = input.text.trim();
  if (!text) throw new ValidationError("Type a question.");
  if (text.length > 4000) throw new ValidationError("Please keep the question under 4,000 characters.");
  const status = await assistantStatus(side, ctx.company.id);
  if (!status.configured) throw new AppError("AI_NOT_CONFIGURED", "The AI assistant isn't set up yet (no Anthropic API key).", 503);
  if (!status.switchedOn) throw new ForbiddenError("The AI assistant is switched off.");
  const settings = await aiSettings();
  const asked = await prisma.aiMessage.count({ where: { role: "user", at: { gt: new Date(Date.now() - 3600_000) }, conversation: { userId: ctx.user.id } } });
  if (asked >= settings.hourlyLimit) throw new AppError("AI_LIMIT", `You've reached ${settings.hourlyLimit} questions this hour — please try again later.`, 429);

  const locale = input.locale ?? ctx.user.locale ?? "en";
  const conv = input.conversationId ? await getConversation(ctx, side, input.conversationId) : null;
  const history: BetaMessageParam[] = (conv?.messages ?? []).slice(-HISTORY_TURNS * 2).map((m) => ({ role: m.role as "user" | "assistant", content: m.text }));
  // The date goes in the newest turn (not the system prompt) so the cached prefix stays the same.
  const messages: BetaMessageParam[] = [...history, { role: "user", content: `[Today is ${new Date().toISOString().slice(0, 10)}]\n\n${text}` }];
  const tools = apiTools(side);
  const runners = new Map(toolsFor(side).map((t) => [t.name, t]));
  const transport = transportOverride ?? liveTransport;
  const used: { name: string; input: unknown; ok: boolean }[] = [];
  let tokensIn = 0, tokensOut = 0, answer = "", stopReason: string | null = null, servedBy: string = settings.model;

  for (let step = 0; step < MAX_STEPS; step++) {
    let res: BetaMessage;
    try {
      res = await transport({
        model: settings.model, max_tokens: 16000, system: systemPrompt(ctx, side, locale), tools, tool_choice: { type: "auto" }, messages,
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
      let content: string, isError = false;
      if (!t) { content = `Unknown tool ${block.name}.`; isError = true; }
      else if (!parsed!.success) { content = `Invalid input: ${parsed!.error.issues.map((x) => x.message).join("; ")}`; isError = true; }
      else {
        try {
          const out = await t.run(ctx, side, parsed!.data, locale);
          content = JSON.stringify(out ?? null);
          if (content.length > MAX_TOOL_CHARS) content = `${content.slice(0, MAX_TOOL_CHARS)}… [cut: ask for fewer rows]`;
        } catch (e) {
          isError = true;
          content = e instanceof ForbiddenError ? "This user has no access to that data." : e instanceof AppError ? e.message : "The data couldn't be read just now.";
        }
      }
      used.push({ name: block.name, input: block.input, ok: !isError });
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
    const c = conv ?? await tx.aiConversation.create({ data: { userId: ctx.user.id, companyId: ctx.company.id, side, title: text.length > 80 ? `${text.slice(0, 77)}…` : text } });
    await tx.aiMessage.create({ data: { conversationId: c.id, role: "user", text } });
    const m = await tx.aiMessage.create({ data: { conversationId: c.id, role: "assistant", text: answer, tools: used as Prisma.InputJsonValue, model: servedBy, tokensIn, tokensOut, stopReason } });
    await tx.aiConversation.update({ where: { id: c.id }, data: { updatedAt: new Date() } });
    return { conversationId: c.id, message: m };
  });
  await logAi({ kind: "ASSISTANT", ctx, summary: `${side.toLowerCase()} asked: ${text.slice(0, 160)}`, detail: { conversationId: saved.conversationId, tools: used.map((x) => `${x.name}${x.ok ? "" : " (error)"}`), stopReason, side }, model: servedBy, tokensIn, tokensOut });
  return { conversationId: saved.conversationId, answer, tools: used, model: servedBy, fellBack: servedBy !== settings.model };
}

function friendlyError(e: unknown) {
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return new AppError("AI_KEY", "The AI service rejected FIRINGI's API key — an administrator needs to check it.", 503);
  if (e instanceof Anthropic.RateLimitError) return new AppError("AI_BUSY", "The AI service is busy right now — please try again in a minute.", 503);
  if (e instanceof Anthropic.APIConnectionError) return new AppError("AI_OFFLINE", "FIRINGI couldn't reach the AI service — please try again.", 503);
  if (e instanceof Anthropic.BadRequestError) return new AppError("AI_REQUEST", "The AI service couldn't handle this question — try rephrasing it or start a new conversation.", 400);
  if (e instanceof Anthropic.APIError) return new AppError("AI_DOWN", "The AI service is unavailable right now — please try again later.", 503);
  return e instanceof Error ? e : new Error(String(e));
}
