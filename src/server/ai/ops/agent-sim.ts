import "server-only";
/**
 * A stand-in for Claude for AI agents in development and browser tests (ASSISTANT_SIMULATE=1, no API
 * key; never in production): it calls the agent's read tools once, proposes one action from what it
 * read (when it may), then writes a short report — so runs, tools, proposals and approvals can be
 * exercised end to end without the AI service.
 */
import type Anthropic from "@anthropic-ai/sdk";

type BetaMessage = Anthropic.Beta.Messages.BetaMessage;
type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type Block = { type: string; [k: string]: unknown };
type ToolDef = { name: string; input_schema: { properties?: Record<string, { type?: string; enum?: string[] }> } };

let seq = 0;
const reply = (content: Block[], stop: "tool_use" | "end_turn", tin: number, tout: number): BetaMessage => ({
  id: `simag_${++seq}`, type: "message", role: "assistant", model: "simulated", content: content as unknown as BetaMessage["content"], stop_reason: stop, stop_sequence: null,
  usage: { input_tokens: tin, output_tokens: tout, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } as BetaMessage["usage"],
} as unknown as BetaMessage);

const PREFERRED = ["overdue_customers", "open_suggestions", "sales_summary", "stock_outlook", "delivery_risk", "supplier_scorecards", "breakdown", "reorder_outlook", "margin_opportunities", "demand_forecast", "find_orders", "supplier_alternatives", "profit_and_loss"];
function defaults(t: ToolDef): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, p] of Object.entries(t.input_schema.properties ?? {})) {
    if (k === "period") out[k] = "30d";
    else if (p.enum?.length) out[k] = p.enum[0];
    else if (p.type === "integer" || p.type === "number") out[k] = k === "months" ? 3 : k.includes("days") ? 0 : 10;
    else if (p.type === "boolean") out[k] = true;
    else if (p.type === "array") out[k] = [];
    else out[k] = k === "query" ? "a" : "";
  }
  return out;
}

export async function simulatedAgentTransport(params: Params): Promise<BetaMessage> {
  const tools = (params.tools ?? []) as unknown as ToolDef[];
  const names = tools.map((t) => t.name);
  const turns = params.messages.filter((m) => m.role === "assistant").length;
  const results = params.messages.flatMap((m) => (m.role === "user" && Array.isArray(m.content) ? m.content : [])).filter((b) => (b as Block).type === "tool_result") as unknown as { content: string; is_error?: boolean }[];
  const reads = PREFERRED.filter((n) => names.includes(n)).slice(0, 2);
  // 1st turn: read
  if (turns === 0 && reads.length) {
    return reply(reads.map((n) => ({ type: "tool_use", id: `tu_${++seq}`, name: n, input: defaults(tools.find((t) => t.name === n)!) })), "tool_use", 1200, 120);
  }
  // 2nd turn: one proposal from the first row that names a company
  if (turns === 1) {
    let company: { id: string; name: string; why: string } | null = null;
    for (const r of results) {
      if (r.is_error) continue;
      try {
        const rows = JSON.parse(r.content) as unknown;
        const list = Array.isArray(rows) ? rows : [];
        const row = list.find((x) => x && typeof x === "object" && ("buyerId" in x || "companyId" in x)) as Record<string, unknown> | undefined;
        if (row) { company = { id: String(row.buyerId ?? row.companyId), name: String(row.buyer ?? row.name ?? "the customer"), why: row.open ? `€${row.open} overdue, ${row.daysLate} days late` : "flagged by the AI Centre" }; break; }
      } catch { /* not JSON */ }
    }
    if (company && names.includes("create_task")) {
      return reply([{ type: "tool_use", id: `tu_${++seq}`, name: "create_task", input: { company_id: company.id, title: `Call ${company.name}`, notes: `Simulated agent: ${company.why}. Agree a payment date.`, due_in_days: 1, why: company.why } }], "tool_use", 1800, 90);
    }
    if (names.includes("notify_staff")) {
      return reply([{ type: "tool_use", id: `tu_${++seq}`, name: "notify_staff", input: { group: "admin.ai.view", title: "Agent check finished", body: `Looked at ${reads.join(", ") || "the data"}; nothing urgent found.`, why: "Keep the team informed" } }], "tool_use", 1800, 80);
    }
  }
  const looked = reads.length ? `Looked at: ${reads.join(", ")}.` : "No tools to read with.";
  const acted = results.length > reads.length ? " Proposed one follow-up (see the approval queue)." : "";
  return reply([{ type: "text", text: `**Simulated agent report** (no AI connected)\n\n${looked}${acted}\n\nConnect Claude (ANTHROPIC_API_KEY) for real analysis.`, citations: null }], "end_turn", 2000, 150);
}
