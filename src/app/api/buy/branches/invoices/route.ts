import { getContext } from "@/server/context";
import { invoiceSummary } from "@/server/multisite/reports";
import { AppError } from "@/server/errors";

/** FIRINGI's invoices of a month with shop, cost centre and PO reference — CSV for accounts payable. */
export async function GET(req: Request) {
  const ctx = await getContext();
  if (!ctx) return new Response("Please sign in.", { status: 401 });
  const m = new URL(req.url).searchParams.get("month") ?? "";
  const month = /^\d{4}-\d{2}$/.test(m) ? new Date(`${m}-01T00:00:00Z`) : new Date();
  try {
    const s = await invoiceSummary(ctx, month);
    const q = (v: unknown) => { const x = v === null || v === undefined ? "" : String(v); return /[;"\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; };
    const head = ["document", "type", "date", "due", "order", "shop", "cost_centre", "po_reference", "net", "vat", "total"];
    const lines = s.invoices.map((i) => [i.number, i.docType, i.issuedAt?.toISOString().slice(0, 10), i.dueAt?.toISOString().slice(0, 10), i.order, i.branch, i.costCentre, i.poReference, i.net, i.vat, i.gross].map(q).join(";"));
    return new Response(`﻿${[head.join(";"), ...lines].join("\n")}\n`, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="firingi-invoices-${month.toISOString().slice(0, 7)}.csv"` } });
  } catch (e) {
    if (e instanceof AppError) return new Response(e.message, { status: e.status });
    throw e;
  }
}
