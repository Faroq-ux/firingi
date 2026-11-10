/**
 * Phase 17: the AI Business Assistant with a fake Anthropic transport (no live API calls):
 * request shape (model, strict tools per side, server-side fallback, caching), the tool loop
 * with the user's own rights, buyers never getting FIRINGI-internal figures, refusals, errors,
 * the hourly limit, private conversations, and the "not set up" state.
 */
import Anthropic from "@anthropic-ai/sdk";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { aiSettings, ask, assistantStatus, getConversation, listConversations, saveAiSettings, setAiTransportForTests, type AiTransport } from "@/server/ai/assistant";
import { ctxFor } from "../helpers";

type Params = Parameters<AiTransport>[0];
const SA = "superadmin@firingi.test", OPS = "ops@firingi.test", SUPPORT = "support@firingi.test", KEBAB = "owner@kebabhouse.test";
let original: Awaited<ReturnType<typeof aiSettings>> | null = null;

const msg = (content: unknown[], stop_reason: string, model = "claude-opus-5-5") => ({
  id: `msg_${Math.random()}`, type: "message", role: "assistant", model, content, stop_reason, stop_sequence: null,
  usage: { input_tokens: 120, output_tokens: 30, cache_read_input_tokens: 50, cache_creation_input_tokens: 0 },
}) as unknown as Awaited<ReturnType<AiTransport>>;
const toolUse = (name: string, input: unknown, id = `tu_${name}`) => ({ type: "tool_use", id, name, input });
const text = (t: string) => ({ type: "text", text: t });

/** A scripted model: each call returns the next reply; every request is recorded. */
function script(...replies: ((p: Params) => Awaited<ReturnType<AiTransport>>)[]) {
  const calls: Params[] = [];
  setAiTransportForTests(async (p) => { calls.push(structuredClone(p)); const r = replies[calls.length - 1]; if (!r) throw new Error("unexpected call"); return r(p); });
  return calls;
}
const lastToolResults = (p: Params) => (p.messages[p.messages.length - 1].content as { type: string; content: string; is_error?: boolean; tool_use_id: string }[]);

afterEach(() => setAiTransportForTests(null));
afterAll(async () => {
  if (original) await saveAiSettings(await ctxFor(SA), original);
  await prisma.$disconnect();
});

describe("AI assistant", () => {
  it("without an API key it is off and says so", async () => {
    const had = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      expect((await assistantStatus("STAFF")).configured).toBe(false);
      await expect(ask(await ctxFor(SA), "STAFF", { text: "How are sales?" })).rejects.toThrow(/isn't set up/);
    } finally { if (had) process.env.ANTHROPIC_API_KEY = had; }
  });

  it("staff: strict tools, server-side fallback, caching; tools run with the user's rights; answer and usage stored", async () => {
    const calls = script(
      () => msg([text("Let me check."), toolUse("sales_summary", { period: "30d", compare_previous: true })], "tool_use"),
      () => msg([text("Sales are steady: **12 orders** in the last 30 days.")], "end_turn", "claude-sonnet-5-5"),
    );
    const sa = await ctxFor(SA);
    const r = await ask(sa, "STAFF", { text: "How are sales this month?", locale: "en" });
    expect(r.answer).toMatch(/12 orders/);
    expect(r.tools).toEqual([{ name: "sales_summary", input: { period: "30d", compare_previous: true }, ok: true }]);
    expect(r.model).toBe("claude-sonnet-5-5");
    expect(r.fellBack).toBe(true);

    const p = calls[0];
    expect(p.model).toBe("claude-opus-5-5");
    expect(p.betas).toContain("server-side-fallback-2026-07-01");
    expect(p.fallbacks).toBe("default");
    expect(p.cache_control).toEqual({ type: "ephemeral" });
    expect(p.thinking).toEqual({ type: "adaptive" });
    expect(p.tool_choice).toEqual({ type: "auto" });
    const tools = p.tools as unknown as { name: string; strict: boolean; input_schema: { additionalProperties: boolean; required: string[]; properties: object } }[];
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(["sales_summary", "margin_opportunities", "profit_and_loss", "supplier_alternatives"]));
    expect(tools.map((t) => t.name)).not.toContain("search_catalogue");
    for (const t of tools) { expect(t.strict).toBe(true); expect(t.input_schema.additionalProperties).toBe(false); expect(t.input_schema.required).toEqual(Object.keys(t.input_schema.properties)); }
    expect(String(p.system)).not.toMatch(/\d{4}-\d{2}-\d{2}/); // no date in the cached system prompt
    expect(String((p.messages[0].content as string))).toMatch(/^\[Today is \d{4}-\d{2}-\d{2}\]/);

    // second call carries the assistant turn back unchanged + one tool_result
    const results = lastToolResults(calls[1]);
    expect(results).toHaveLength(1);
    expect(results[0].tool_use_id).toBe("tu_sales_summary");
    expect(JSON.parse(results[0].content)).toHaveProperty("current.commission");

    const c = await getConversation(sa, "STAFF", r.conversationId);
    expect(c.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(c.messages[1]).toMatchObject({ model: "claude-sonnet-5-5", tokensIn: 340, tokensOut: 60, stopReason: "end_turn" });
    const log = await prisma.aiActivity.findFirstOrThrow({ where: { kind: "ASSISTANT", actorUserId: sa.user.id }, orderBy: { at: "desc" } });
    expect(log.tokensIn).toBe(340);

    // a follow-up sends the earlier turns as history
    const calls2 = script(() => msg([text("Yes.")], "end_turn"));
    await ask(sa, "STAFF", { conversationId: r.conversationId, text: "And last month?" });
    expect(calls2[0].messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(calls2[0].messages[1].content).toMatch(/12 orders/);
  });

  it("no access → the tool answers with an error, not the data", async () => {
    const calls = script(
      () => msg([toolUse("profit_and_loss", { months: 3 })], "tool_use"),
      () => msg([text("You don't have access to the P&L.")], "end_turn"),
    );
    const r = await ask(await ctxFor(OPS), "STAFF", { text: "What was our net profit?" });
    expect(r.tools[0].ok).toBe(false);
    const res = lastToolResults(calls[1])[0];
    expect(res.is_error).toBe(true);
    expect(res.content).toMatch(/no access/);
  });

  it("buyers: their own tools only, nothing FIRINGI-internal; several tool calls answered in one message", async () => {
    const calls = script(
      () => msg([toolUse("sales_summary", { period: "90d", compare_previous: false }, "a"), toolUse("find_orders", { query: "", state: "ANY", limit: 5 }, "b"), toolUse("margin_opportunities", { limit: 5 }, "c")], "tool_use"),
      () => msg([text("Gastou …")], "end_turn"),
    );
    const k = await ctxFor(KEBAB);
    await ask(k, "BUYER", { text: "Quanto gastei?", locale: "pt-PT" });
    const names = (calls[0].tools as { name: string }[]).map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["sales_summary", "find_orders", "search_catalogue", "reorder_outlook"]));
    for (const hidden of ["margin_opportunities", "profit_and_loss", "supplier_alternatives", "demand_forecast", "stock_outlook"]) expect(names).not.toContain(hidden);
    expect(String(calls[0].system)).toMatch(/Reply in European Portuguese/);
    expect(String(calls[0].system)).toMatch(/Never mention FIRINGI's commission/);
    const results = lastToolResults(calls[1]);
    expect(results.map((x) => x.tool_use_id)).toEqual(["a", "b", "c"]);
    const all = results.map((x) => x.content).join(" ");
    expect(all).not.toMatch(/commission|payout|firingiMargin|vendorPayable|margin"/i);
    expect(JSON.parse(results[0].content).current).toHaveProperty("spentNet");
    expect(results[2]).toMatchObject({ is_error: true, content: expect.stringMatching(/Unknown tool/) });
  });

  it("refusals, invalid tool input and API errors are handled", async () => {
    const sa = await ctxFor(SA);
    script(() => msg([], "refusal"));
    expect((await ask(sa, "STAFF", { text: "something" })).answer).toMatch(/can't help/);

    const calls = script(() => msg([toolUse("breakdown", { by: "planet", period: "30d", limit: 5 })], "tool_use"), () => msg([text("ok")], "end_turn"));
    await ask(sa, "STAFF", { text: "breakdown" });
    expect(lastToolResults(calls[1])[0]).toMatchObject({ is_error: true, content: expect.stringMatching(/Invalid input/) });

    setAiTransportForTests(async () => { throw Anthropic.APIError.generate(429, { type: "error", error: { type: "rate_limit_error", message: "slow down" } }, "slow down", new Headers()); });
    await expect(ask(sa, "STAFF", { text: "x" })).rejects.toThrow(/busy/);
    setAiTransportForTests(async () => { throw Anthropic.APIError.generate(401, { type: "error", error: { type: "authentication_error", message: "bad key" } }, "bad key", new Headers()); });
    await expect(ask(sa, "STAFF", { text: "x" })).rejects.toThrow(/API key/);
  });

  it("access, switches and the hourly limit", async () => {
    script(() => msg([text("hi")], "end_turn"));
    await expect(ask(await ctxFor(SUPPORT), "STAFF", { text: "hi" })).rejects.toThrow(); // no AI right
    await expect(ask(await ctxFor(KEBAB), "VENDOR", { text: "hi" })).rejects.toThrow(); // a restaurant isn't a supplier
    const sa = await ctxFor(SA);
    original = await aiSettings();
    await expect(saveAiSettings(await ctxFor(OPS), { buyers: false })).rejects.toThrow();
    await expect(saveAiSettings(sa, { model: "gpt-x" as never })).rejects.toThrow(/model/);
    await saveAiSettings(sa, { buyers: false });
    script(() => msg([text("hi")], "end_turn"));
    await expect(ask(await ctxFor(KEBAB), "BUYER", { text: "hi" })).rejects.toThrow(/switched off/);
    const used = await prisma.aiMessage.count({ where: { role: "user", at: { gt: new Date(Date.now() - 3600_000) }, conversation: { userId: sa.user.id } } });
    await saveAiSettings(sa, { buyers: true, hourlyLimit: used });
    script(() => msg([text("hi")], "end_turn"));
    await expect(ask(sa, "STAFF", { text: "one more" })).rejects.toThrow(/questions this hour/);
    await saveAiSettings(sa, original);
  });

  it("conversations are private to the user and the side they were asked on", async () => {
    const sa = await ctxFor(SA);
    const mine = await listConversations(sa, "STAFF");
    expect(mine.length).toBeGreaterThan(0);
    await expect(getConversation(await ctxFor(OPS), "STAFF", mine[0].id)).rejects.toThrow(/not found/i);
    const k = await ctxFor(KEBAB);
    expect((await listConversations(k, "BUYER")).length).toBeGreaterThan(0);
  });
});
