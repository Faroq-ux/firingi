import { getContext } from "@/server/context";
import { listActivity } from "@/server/ai/feed";
import { AppError } from "@/server/errors";

const cell = (v: unknown) => { const s = v === null || v === undefined ? "" : String(v); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

/** Phase 67: the AI audit trail as CSV (same filters as the page: kind, from, to, q). FIRINGI staff with the AI right. */
export async function GET(req: Request) {
  const ctx = await getContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  const sp = new URL(req.url).searchParams;
  const day = (s: string | null, add = 0) => { if (!s) return null; const d = new Date(`${s}T00:00:00Z`); return Number.isNaN(+d) ? null : new Date(d.getTime() + add); };
  try {
    const rows: string[] = ["when,kind,who,company,summary,model,tokens_in,tokens_out"];
    for (let page = 1; page <= 50; page++) {
      const r = await listActivity(ctx, { kind: sp.get("kind") || undefined, from: day(sp.get("from")), to: day(sp.get("to"), 86400_000), q: sp.get("q")?.slice(0, 80) || null, page, size: 500 });
      for (const x of r.rows) rows.push([x.at.toISOString(), x.kind, x.actor, x.company ?? "", x.summary, x.model ?? "", x.tokensIn, x.tokensOut].map(cell).join(","));
      if (page >= r.pages) break;
    }
    return new Response(`${rows.join("\n")}\n`, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="firingi-ai-audit-${new Date().toISOString().slice(0, 10)}.csv"`, "cache-control": "private, no-store" } });
  } catch (e) {
    return new Response(e instanceof AppError ? e.message : "Error", { status: e instanceof AppError ? e.status : 500 });
  }
}
