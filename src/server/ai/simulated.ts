/**
 * A simulated assistant for development and browser tests (ASSISTANT_SIMULATE=1, no API key): a few
 * fixed rules instead of the AI model, so the chat — cart filling, hand-over to support, voice — can be
 * exercised end to end. It speaks through the same tools with the user's own rights. Never in
 * production (env validation refuses it).
 */
import "server-only";
import type Anthropic from "@anthropic-ai/sdk";

type BetaMessage = Anthropic.Beta.Messages.BetaMessage;
type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type Block = { type: string; [k: string]: unknown };

let seq = 0;
const reply = (content: Block[], stop: "tool_use" | "end_turn"): BetaMessage => ({
  id: `sim_${++seq}`, type: "message", role: "assistant", model: "simulated", content: content as unknown as BetaMessage["content"], stop_reason: stop, stop_sequence: null,
  usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } as BetaMessage["usage"],
} as unknown as BetaMessage);
const text = (t: string) => ({ type: "text", text: `${t}\n\n*(simulated assistant — no AI connected)*`, citations: null });
const callTool = (name: string, input: unknown) => ({ type: "tool_use", id: `tu_${++seq}`, name, input });

const ADD = /(?:add|adicion\w*|junt\w*|p[oõ]e|ponha|coloca\w*|quero|leg\w*|añad\w*)\s+(\d+)\s+(?:x\s+|caixas?\s+de\s+|boxes?\s+of\s+|packs?\s+of\s+)?(.+)/i;
/** "olive oil to my cart" → "olive oil" */
const product = (s: string) => s.replace(/[.!?]+$/, "").replace(/\s+(?:to|in|into)\s+(?:my|the)\s+(?:cart|basket)$|\s+(?:a|ao|no|para o)\s+(?:meu\s+)?carrinho$|\s+(?:a|al|en)\s+(?:mi\s+)?carrito$/i, "").trim();
const REPEAT_Q = /repeat my last order|same as last|o mesmo|repetir/i;
const ORDER_Q = /\b(place (?:the |my )?order|order (?:it|now)|encomendar|fazer (?:a )?encomenda|finalizar|checkout|pedir)\b/i;
const PAY_Q = /\b(pay|pagar|owe|devo|payment link)\b/i;
const HUMAN = /\b(human|person|agent|staff|pessoa|humano|suporte|support|falar com|hablar con|persona)\b/i;

type Content = Params["messages"][number]["content"];
const textOf = (c: Content) => (typeof c === "string" ? c : (c as Block[]).filter((b) => b.type === "text").map((b) => String(b.text)).join("\n"));
const photosIn = (c: Content) => (typeof c === "string" ? 0 : (c as Block[]).filter((b) => b.type === "image").length);
const isQuestion = (c: Content) => typeof c === "string" || !(c as Block[]).some((b) => b.type === "tool_result");

function lastQuestion(messages: Params["messages"]) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "user" && isQuestion(m.content)) return textOf(m.content).replace(/^\[Today is [^\]]*\]\s*/, "").replace(/^\[\d+ photo\(s\) attached\]\s*/, "").trim();
  }
  return "";
}

export async function simulatedTransport(params: Params): Promise<BetaMessage> {
  const tools = new Set((params.tools ?? []).map((t) => (t as { name: string }).name));
  const last = params.messages[params.messages.length - 1];
  const q = lastQuestion(params.messages);

  // A new question from the person.
  if (isQuestion(last.content)) {
    if (HUMAN.test(q) && tools.has("handover"))
      return reply([callTool("handover", { subject: q.slice(0, 80), summary: `The customer asked for a person: "${q.slice(0, 300)}"`, category: "OTHER" })], "tool_use");
    const n = photosIn(last.content);
    if (n && !ADD.test(q)) return reply([text(`I received ${n} photo(s). The simulated assistant can't read photos — with the AI connected I would read the products, labels or order list in them and fill your cart.`)], "end_turn");
    const add = q.match(ADD);
    // Phase 58 (WhatsApp): repeat, propose, pay
    if (tools.has("repeat_last_order") && REPEAT_Q.test(q)) return reply([callTool("repeat_last_order", {})], "tool_use");
    if (tools.has("propose_order") && !add && ORDER_Q.test(q)) return reply([callTool("propose_order", {})], "tool_use");
    if (tools.has("pay_invoices_link") && PAY_Q.test(q)) return reply([callTool("pay_invoices_link", {})], "tool_use");
    if (add && tools.has("add_to_cart")) return reply([callTool("search_catalogue", { query: product(add[2]), limit: 5 })], "tool_use");
    if (tools.has("search_catalogue") && q.length > 2) return reply([callTool("search_catalogue", { query: q.replace(/[?!.]+$/, "").split(/\s+/).slice(-2).join(" "), limit: 3 })], "tool_use");
    if (tools.has("find_orders")) return reply([callTool("find_orders", { query: "", state: "ANY", limit: 3 })], "tool_use");
    return reply([text("I can help with products, your cart, orders, invoices and claims.")], "end_turn");
  }

  // Tool results came back: decide the next step from the tool that ran.
  const prev = params.messages[params.messages.length - 2];
  const call = (Array.isArray(prev?.content) ? (prev.content as Block[]) : []).find((b) => b.type === "tool_use") as { name: string } | undefined;
  const result = (Array.isArray(last.content) ? (last.content as Block[]) : []).find((b) => b.type === "tool_result") as { content?: string; is_error?: boolean } | undefined;
  const data = (() => { try { return JSON.parse(String(result?.content ?? "null")); } catch { return null; } })();
  if (result?.is_error) return reply([text(`Sorry, that didn't work: ${result.content}`)], "end_turn");

  if (call?.name === "search_catalogue") {
    const rows = (Array.isArray(data) ? data : []) as { offerId: string; product: string; pack: string; pricePerPackNet: string | null; stock: string; minOrderQty: number }[];
    const add = q.match(ADD);
    if (add && tools.has("add_to_cart")) {
      const pick = rows.find((r) => r.stock !== "OUT") ?? rows[0];
      if (!pick) return reply([text(`I couldn't find "${product(add[2])}" in your catalogue.`)], "end_turn");
      return reply([callTool("add_to_cart", { offer_id: pick.offerId, qty: Math.max(Number(add[1]), pick.minOrderQty || 1) })], "tool_use");
    }
    if (!rows.length) return reply([text("I couldn't find that product in your catalogue.")], "end_turn");
    return reply([text(rows.slice(0, 3).map((r) => `- **${r.product}** — ${r.pack}: ${r.pricePerPackNet ?? "?"} € excl. VAT (${r.stock})`).join("\n"))], "end_turn");
  }
  if (call?.name === "add_to_cart" && tools.has("propose_order")) return reply([callTool("propose_order", {})], "tool_use");
  if (call?.name === "repeat_last_order") return (data as { repeated?: boolean })?.repeated ? reply([callTool("propose_order", {})], "tool_use") : reply([text("You have no earlier order to repeat.")], "end_turn");
  if (call?.name === "propose_order") {
    const d = data as { proposed: boolean; lines?: { product: string; pack: string; qty: number }[]; totalInclVat?: string; delivery?: { supplier: string; deliveryFeeNet: string | null; freeDeliveryFromNet: string | null }[]; problems?: { supplier?: string; problem: string; missing?: string; minimum?: string }[] };
    if (!d.proposed) return reply([text(`I can't send the order yet: ${(d.problems ?? []).map((p) => `${p.supplier ?? ""} ${p.problem}${p.missing ? ` (${p.missing} € more, minimum ${p.minimum} €)` : ""}`.trim()).join("; ")}.`)], "end_turn");
    const lines = (d.lines ?? []).map((l) => `- ${l.qty} × ${l.product} (${l.pack})`).join("\n");
    const del = (d.delivery ?? []).map((g) => `${g.supplier}: delivery ${g.deliveryFeeNet ?? "0.00"} €${g.freeDeliveryFromNet ? ` (free from ${g.freeDeliveryFromNet} €)` : ""}`).join("\n");
    return reply([text(`Your order:\n${lines}\n${del}\nTotal ${d.totalInclVat} € incl. VAT.`)], "end_turn");
  }
  if (call?.name === "pay_invoices_link") {
    const d = data as { link: string | null; note?: string; total?: string };
    return reply([text(d.link ? `Pay ${d.total} € here: ${d.link}` : d.note ?? "Nothing to pay.")], "end_turn");
  }
  if (call?.name === "add_to_cart") {
    const d = data as { product: string; pack: string; qtyAdded: number; qtyInCartNow: number };
    return reply([text(`Added ${d.qtyAdded} × ${d.product} (${d.pack}) to your cart — ${d.qtyInCartNow} in the cart now. Open the cart to check it and place the order.`)], "end_turn");
  }
  if (call?.name === "handover") return reply([text("I've prepared a request for FIRINGI's support team — tap **Send to FIRINGI support** below and a person will answer in Help & Support.")], "end_turn");
  return reply([text("Here is what I found.")], "end_turn");
}
