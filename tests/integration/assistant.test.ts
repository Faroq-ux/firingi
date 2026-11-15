/**
 * Phase 17: the AI Business Assistant with a fake Anthropic transport (no live API calls):
 * request shape (model, strict tools per side, server-side fallback, caching), the tool loop
 * with the user's own rights, buyers never getting FIRINGI-internal figures, refusals, errors,
 * the hourly limit, private conversations, and the "not set up" state.
 */
import Anthropic from "@anthropic-ai/sdk";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { aiSettings, ask, assistantPhotoKey, assistantStatus, getConversation, handoverToSupport, listConversations, saveAiSettings, setAiTransportForTests, type AiTransport } from "@/server/ai/assistant";
import { companyFeatureOn, hiddenCompanyNav } from "@/server/accounting/features";
import { searchAcrossSuppliers } from "@/server/data/catalogue-buyer";
import { ticketPhotoKey } from "@/server/services/support";
import { ctxFor, setAiRole } from "../helpers";
import { setCompanyFeature } from "@/server/accounting/features";

type Params = Parameters<AiTransport>[0];
const SA = "superadmin@firingi.test", OPS = "ops@firingi.test", SUPPORT = "support@firingi.test", KEBAB = "owner@kebabhouse.test", LX_OWNER = "owner@lisboacentral.test";
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
/** FIRINGI switches the Assistant on per supplier / customer (Settings › Business Features). */
const assistantFor = async (email: string, on: boolean) => setCompanyFeature(await ctxFor(SA), (await ctxFor(email)).company.id, "ASSISTANT", on);
beforeAll(async () => {
  await setAiRole(OPS, true); // AI Centre via a role (Super Admin has it by default)
  await assistantFor(KEBAB, true);
});
afterAll(async () => {
  await setAiRole(OPS, false);
  // back to the default (on for everyone)
  await prisma.companyFeature.deleteMany({ where: { key: "ASSISTANT", companyId: { in: [(await ctxFor(KEBAB)).company.id, (await ctxFor(LX_OWNER)).company.id] } } });
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

  it("suppliers and customers only when FIRINGI switched the Assistant on for their company", async () => {
    const calls = script(() => msg([text("Olá")], "end_turn"));
    const lx = await ctxFor(LX_OWNER);
    await assistantFor(LX_OWNER, false);
    await expect(ask(lx, "VENDOR", { text: "Vendas?" })).rejects.toThrow(/switched this on/);
    await expect(listConversations(lx, "VENDOR")).rejects.toThrow(/switched this on/);
    expect(calls).toHaveLength(0); // the model was never called
    expect((await assistantStatus("VENDOR", lx.company.id)).switchedOn).toBe(false);
    await expect(setCompanyFeature(await ctxFor(OPS), lx.company.id, "ASSISTANT", true)).rejects.toThrow(); // only settings managers switch it
    await assistantFor(LX_OWNER, true);
    expect((await assistantStatus("VENDOR", lx.company.id)).switchedOn).toBe(true);
    expect((await ask(lx, "VENDOR", { text: "Vendas?" })).answer).toMatch(/Olá/);
    await assistantFor(LX_OWNER, false);
    await expect(ask(lx, "VENDOR", { text: "again" })).rejects.toThrow(/switched this on/);
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
    await expect(saveAiSettings(await ctxFor(OPS), { staff: false })).rejects.toThrow();
    await expect(saveAiSettings(sa, { model: "gpt-x" as never })).rejects.toThrow(/model/);
    await saveAiSettings(sa, { staff: false });
    script(() => msg([text("hi")], "end_turn"));
    await expect(ask(sa, "STAFF", { text: "hi" })).rejects.toThrow(/switched off/);
    const used = await prisma.aiMessage.count({ where: { role: "user", at: { gt: new Date(Date.now() - 3600_000) }, conversation: { userId: sa.user.id } } });
    await saveAiSettings(sa, { staff: true, hourlyLimit: used });
    script(() => msg([text("hi")], "end_turn"));
    await expect(ask(sa, "STAFF", { text: "one more" })).rejects.toThrow(/questions this hour/);
    await saveAiSettings(sa, original);
  });

  it("on for every supplier and customer until FIRINGI switches it off", async () => {
    const lx = await ctxFor(LX_OWNER);
    await prisma.companyFeature.deleteMany({ where: { key: "ASSISTANT", companyId: lx.company.id } });
    expect(await companyFeatureOn(lx.company.id, "ASSISTANT")).toBe(true);
    expect(await companyFeatureOn(lx.company.id, "ACCOUNTING")).toBe(false); // accounting stays off by default
    expect((await assistantStatus("VENDOR", lx.company.id)).switchedOn).toBe(true);
    await assistantFor(LX_OWNER, false);
    expect((await assistantStatus("VENDOR", lx.company.id)).switchedOn).toBe(false);
    await prisma.companyFeature.deleteMany({ where: { key: "ASSISTANT", companyId: lx.company.id } });
  });

  it("sales agent: fills the customer's cart when asked — never places the order", async () => {
    const k = await ctxFor(KEBAB);
    const cart = await prisma.cart.findFirst({ where: { buyerCompanyId: k.company.id, userId: k.user.id }, include: { items: true } });
    const before = cart?.items.map((i) => ({ offerId: i.offerId, qty: i.qty })) ?? [];
    const offer = (await searchAcrossSuppliers(k, "a")).items.find((x) => x.stockStatus !== "OUT" && !before.some((b) => b.offerId === x.offerId))!;
    expect(offer).toBeTruthy();
    const orders = await prisma.order.count({ where: { buyerCompanyId: k.company.id } });
    const qty = offer.minOrderQty * 2;
    try {
      const calls = script(
        () => msg([toolUse("add_to_cart", { offer_id: offer.offerId, qty })], "tool_use"),
        () => msg([text(`Adicionei ${qty} ao carrinho.`)], "end_turn"),
      );
      const r = await ask(k, "BUYER", { text: `Adiciona ${qty} caixas`, locale: "pt-PT" });
      expect(String(calls[0].system)).toMatch(/sales/i);
      expect(String(calls[0].system)).toMatch(/never|Never/);
      const names = (calls[0].tools as { name: string }[]).map((t) => t.name);
      expect(names).toEqual(expect.arrayContaining(["add_to_cart", "view_cart", "my_invoices", "my_claims", "handover"]));
      expect(names).not.toContain("my_statements");
      expect(r.tools[0]).toMatchObject({ name: "add_to_cart", ok: true, card: { kind: "cart", qty, cartQty: qty } });
      const res = JSON.parse(lastToolResults(calls[1])[0].content);
      expect(res).toMatchObject({ added: true, qtyInCartNow: qty });
      const line = await prisma.cartItem.findFirst({ where: { cart: { buyerCompanyId: k.company.id, userId: k.user.id }, offerId: offer.offerId } });
      expect(line?.qty).toBe(qty);
      expect(await prisma.order.count({ where: { buyerCompanyId: k.company.id } })).toBe(orders); // nothing ordered
      const stored = await prisma.aiMessage.findUniqueOrThrow({ where: { id: r.messageId } });
      expect((stored.tools as { card?: { kind: string } }[])[0].card?.kind).toBe("cart");

      // a wrong quantity (below the minimum / not a multiple) is refused with the reason
      if (offer.minOrderQty > 1 || offer.qtyStep > 1) {
        const c2 = script(() => msg([toolUse("add_to_cart", { offer_id: offer.offerId, qty: 1 })], "tool_use"), () => msg([text("ok")], "end_turn"));
        await ask(k, "BUYER", { text: "add 1" });
        expect(lastToolResults(c2[1])[0]).toMatchObject({ is_error: true });
      }
      // an offer the customer can't see is refused
      const c3 = script(() => msg([toolUse("add_to_cart", { offer_id: "nope", qty: 1 })], "tool_use"), () => msg([text("ok")], "end_turn"));
      await ask(k, "BUYER", { text: "add it" });
      expect(lastToolResults(c3[1])[0]).toMatchObject({ is_error: true });
    } finally {
      await prisma.cartItem.deleteMany({ where: { cart: { buyerCompanyId: k.company.id, userId: k.user.id }, offerId: { notIn: before.map((b) => b.offerId) } } });
    }
  });

  it("support agent for suppliers: support tools only, no cart", async () => {
    const calls = script(() => msg([toolUse("my_statements", { limit: 5 }, "s"), toolUse("my_claims", { limit: 5 }, "c"), toolUse("add_to_cart", { offer_id: "x", qty: 1 }, "a")], "tool_use"), () => msg([text("ok")], "end_turn"));
    const lx = await ctxFor(LX_OWNER);
    await ask(lx, "VENDOR", { text: "What do I have to invoice?", locale: "pt-PT" });
    const names = (calls[0].tools as { name: string }[]).map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["my_statements", "my_claims", "handover"]));
    for (const n of ["add_to_cart", "view_cart", "search_catalogue", "my_invoices"]) expect(names).not.toContain(n);
    expect(String(calls[0].system)).toMatch(/support/i);
    const [st, cl, add] = lastToolResults(calls[1]);
    expect(JSON.parse(st.content)).toHaveProperty("openStatements");
    expect(JSON.parse(cl.content)).toHaveProperty("claimWindowHours");
    expect(add).toMatchObject({ is_error: true, content: expect.stringMatching(/Unknown tool/) });
  });

  it("hand-over: one tap opens a Help & Support request with the summary and the chat — once", async () => {
    const k = await ctxFor(KEBAB);
    script(() => msg([toolUse("handover", { subject: "Reembolso da encomenda", summary: "O cliente pede o reembolso de uma caixa partida.", category: "ORDER" })], "tool_use"),
      () => msg([text("Toque em Enviar para o suporte FIRINGI.")], "end_turn"));
    const r = await ask(k, "BUYER", { text: "Quero falar com uma pessoa sobre um reembolso", locale: "pt-PT" });
    expect(r.tools[0]).toMatchObject({ name: "handover", ok: true, card: { kind: "handover", subject: "Reembolso da encomenda", category: "ORDER" } });
    expect(await prisma.supportTicket.count({ where: { subject: "Reembolso da encomenda" } })).toBe(0); // nothing sent until tapped

    await expect(handoverToSupport(await ctxFor(LX_OWNER), "VENDOR", r.messageId)).rejects.toThrow(/not found/i); // someone else's chat
    await expect(handoverToSupport(k, "STAFF", r.messageId)).rejects.toThrow();
    const h = await handoverToSupport(k, "BUYER", r.messageId);
    expect(h.already).toBe(false);
    const t = await prisma.supportTicket.findUniqueOrThrow({ where: { id: h.ticketId }, include: { messages: true } });
    expect(t).toMatchObject({ subject: "Reembolso da encomenda", category: "ORDER", companyId: k.company.id });
    const body = t.messages.map((m) => m.body).join("\n");
    expect(body).toMatch(/caixa partida/);
    expect(body).toMatch(/Customer: Quero falar com uma pessoa/);
    expect(body).toMatch(/Assistant: Toque em Enviar/);
    const again = await handoverToSupport(k, "BUYER", r.messageId);
    expect(again).toMatchObject({ ticketId: h.ticketId, already: true });
    expect(await prisma.supportTicket.count({ where: { subject: "Reembolso da encomenda", companyId: k.company.id } })).toBe(1);
    const stored = await prisma.aiMessage.findUniqueOrThrow({ where: { id: r.messageId } });
    expect((stored.tools as { ticketId?: string }[])[0].ticketId).toBe(h.ticketId);

    // an answer that didn't offer it can't be handed over
    script(() => msg([text("Olá")], "end_turn"));
    const plain = await ask(k, "BUYER", { text: "Olá" });
    await expect(handoverToSupport(k, "BUYER", plain.messageId)).rejects.toThrow(/didn't offer/);
    await prisma.supportTicket.delete({ where: { id: h.ticketId } }).catch(() => {});
  });

  it("the simulated assistant (development / browser tests) fills the cart and offers the hand-over", async () => {
    const env = { key: process.env.ANTHROPIC_API_KEY, sim: process.env.ASSISTANT_SIMULATE };
    delete process.env.ANTHROPIC_API_KEY; process.env.ASSISTANT_SIMULATE = "1";
    const k = await ctxFor(KEBAB);
    const cart = await prisma.cart.findFirst({ where: { buyerCompanyId: k.company.id, userId: k.user.id }, include: { items: true } });
    const before = cart?.items.map((i) => i.offerId) ?? [];
    try {
      expect((await assistantStatus("BUYER", k.company.id)).configured).toBe(true);
      const offer = (await searchAcrossSuppliers(k, "a")).items.find((x) => x.stockStatus !== "OUT" && !before.includes(x.offerId) && x.qtyStep === 1)!;
      const name = (offer.name as Record<string, string>).en ?? Object.values(offer.name as Record<string, string>)[0];
      const r = await ask(k, "BUYER", { text: `add ${offer.minOrderQty} ${name}`, locale: "en" });
      expect(r.model).toBe("simulated");
      expect(r.tools.map((t) => t.name)).toEqual(["search_catalogue", "add_to_cart"]);
      expect(r.answer).toMatch(/Added/);
      const h = await ask(k, "BUYER", { text: "I want to talk to a person", locale: "en" });
      expect(h.tools[0]).toMatchObject({ name: "handover", card: { kind: "handover" } });
    } finally {
      if (env.key) process.env.ANTHROPIC_API_KEY = env.key;
      if (env.sim) process.env.ASSISTANT_SIMULATE = env.sim; else delete process.env.ASSISTANT_SIMULATE;
      await prisma.cartItem.deleteMany({ where: { cart: { buyerCompanyId: k.company.id, userId: k.user.id }, offerId: { notIn: before } } });
    }
  });

  it("photos: sent to the AI with the question, kept with the conversation, private, passed on with a hand-over", async () => {
    const jpeg = (name = "list.jpg") => new File([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9])], name, { type: "image/jpeg" });
    const k = await ctxFor(KEBAB);
    const calls = script(
      () => msg([toolUse("handover", { subject: "Lista de encomenda", summary: "O cliente enviou uma foto da lista de encomenda.", category: "ORDER" })], "tool_use"),
      () => msg([text("Vi a sua lista.")], "end_turn"),
    );
    const r = await ask(k, "BUYER", { text: "Encomenda isto", locale: "pt-PT", photos: [jpeg()] });
    const first = calls[0].messages[calls[0].messages.length - 1].content as { type: string; source?: { media_type: string; data: string }; text?: string }[];
    expect(first.map((b) => b.type)).toEqual(["image", "text"]);
    expect(first[0].source?.media_type).toBe("image/jpeg");
    expect(first[1].text).toMatch(/\[1 photo\(s\) attached\]\nEncomenda isto/);
    expect(String(calls[0].system)).toMatch(/order list, go through it line by line/);
    expect(r.photos).toBe(1);
    const key = await assistantPhotoKey(k, r.questionId, 0);
    expect(key).toMatch(/^assistant\//);
    await expect(assistantPhotoKey(await ctxFor(LX_OWNER), r.questionId, 0)).rejects.toThrow(/not found/i); // someone else
    await expect(assistantPhotoKey(k, r.questionId, 1)).rejects.toThrow(/not found/i);

    // the next question doesn't send the photo again (cost) but says one was sent
    const c2 = script(() => msg([text("ok")], "end_turn"));
    await ask(k, "BUYER", { conversationId: r.conversationId, text: "e mais?" });
    expect(c2[0].messages[0].content).toMatch(/^\[sent 1 photo\(s\) earlier\]\nEncomenda isto/);

    // hand-over: the photo goes with the support request; FIRINGI support and the company can open it
    const h = await handoverToSupport(k, "BUYER", r.messageId);
    const msgRow = await prisma.ticketMessage.findFirstOrThrow({ where: { ticketId: h.ticketId } });
    expect(msgRow.photoKeys).toEqual([key]);
    expect(msgRow.body).toMatch(/Customer: \[1 photo\(s\)\] Encomenda isto/);
    expect(await ticketPhotoKey(k, h.ticketId, msgRow.id, 0)).toBe(key);
    expect(await ticketPhotoKey(await ctxFor(SUPPORT), h.ticketId, msgRow.id, 0)).toBe(key);
    await expect(ticketPhotoKey(await ctxFor(LX_OWNER), h.ticketId, msgRow.id, 0)).rejects.toThrow(/not found/i);
    await prisma.supportTicket.delete({ where: { id: h.ticketId } }).catch(() => {});

    // limits: 3 photos, images only, not for staff
    script(() => msg([text("x")], "end_turn"));
    await expect(ask(k, "BUYER", { text: "x", photos: [jpeg(), jpeg(), jpeg(), jpeg()] })).rejects.toThrow(/Up to 3 photos/);
    await expect(ask(k, "BUYER", { text: "x", photos: [new File([Buffer.from("%PDF-1.4 x")], "a.pdf")] })).rejects.toThrow(/JPG, PNG or WEBP/);
    await expect(ask(await ctxFor(SA), "STAFF", { text: "x", photos: [jpeg()] })).rejects.toThrow(/customer and supplier/);
    // a photo alone (no text) is a question too
    const c3 = script(() => msg([text("ok")], "end_turn"));
    await ask(k, "BUYER", { text: "", photos: [jpeg()] });
    expect((c3[0].messages[0].content as { type: string }[])[0].type).toBe("image");

    // the simulated assistant says it can't read photos
    const env = { key: process.env.ANTHROPIC_API_KEY, sim: process.env.ASSISTANT_SIMULATE };
    delete process.env.ANTHROPIC_API_KEY; process.env.ASSISTANT_SIMULATE = "1"; setAiTransportForTests(null);
    try {
      const sim = await ask(k, "BUYER", { text: "isto", photos: [jpeg()] });
      expect(sim.answer).toMatch(/received 1 photo/);
    } finally {
      if (env.key) process.env.ANTHROPIC_API_KEY = env.key;
      if (env.sim) process.env.ASSISTANT_SIMULATE = env.sim; else delete process.env.ASSISTANT_SIMULATE;
    }
  });

  it("FIRINGI's master switches (all customers / all suppliers) and the photo switches (global and per company)", async () => {
    const sa = await ctxFor(SA), k = await ctxFor(KEBAB), lx = await ctxFor(LX_OWNER);
    const before = await aiSettings();
    const jpeg = () => new File([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9])], "p.jpg", { type: "image/jpeg" });
    try {
      // all customers off: hidden and refused for customers, suppliers unaffected
      await saveAiSettings(sa, { buyers: false });
      expect((await assistantStatus("BUYER", k.company.id)).switchedOn).toBe(false);
      await expect(ask(k, "BUYER", { text: "olá" })).rejects.toThrow(/switched this on/);
      expect((await hiddenCompanyNav(k, "buy")).has("ASSISTANT")).toBe(true);
      expect((await assistantStatus("VENDOR", lx.company.id)).switchedOn).toBe(true);
      expect((await hiddenCompanyNav(lx, "vendor")).has("ASSISTANT")).toBe(false);
      await saveAiSettings(sa, { buyers: true, suppliers: false });
      expect((await assistantStatus("BUYER", k.company.id)).switchedOn).toBe(true);
      await expect(listConversations(lx, "VENDOR")).rejects.toThrow(/switched this on/);
      await saveAiSettings(sa, { suppliers: true });

      // photos: on by default; off for everyone in AI settings
      expect((await assistantStatus("BUYER", k.company.id)).photos).toBe(true);
      await saveAiSettings(sa, { photos: false });
      expect((await assistantStatus("BUYER", k.company.id)).photos).toBe(false);
      script(() => msg([text("x")], "end_turn"));
      await expect(ask(k, "BUYER", { text: "isto", photos: [jpeg()] })).rejects.toThrow(/Photos are switched off/);
      script(() => msg([text("ok")], "end_turn"));
      expect((await ask(k, "BUYER", { text: "sem foto" })).answer).toBe("ok"); // the chat itself still works
      await saveAiSettings(sa, { photos: true });

      // photos off for one company only (Business Features)
      await setCompanyFeature(sa, k.company.id, "ASSISTANT_PHOTOS", false);
      expect((await assistantStatus("BUYER", k.company.id)).photos).toBe(false);
      expect((await assistantStatus("VENDOR", lx.company.id)).photos).toBe(true);
      await expect(setCompanyFeature(await ctxFor(OPS), k.company.id, "ASSISTANT_PHOTOS", true)).rejects.toThrow(); // only settings managers
      // Assistant off for the company → no photos either
      await prisma.companyFeature.deleteMany({ where: { key: "ASSISTANT_PHOTOS", companyId: k.company.id } });
      await assistantFor(KEBAB, false);
      expect((await assistantStatus("BUYER", k.company.id)).photos).toBe(false);
    } finally {
      await saveAiSettings(sa, before);
      await prisma.companyFeature.deleteMany({ where: { key: { in: ["ASSISTANT", "ASSISTANT_PHOTOS"] }, companyId: k.company.id } });
    }
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
