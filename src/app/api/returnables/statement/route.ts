import { getContext } from "@/server/context";
import { statement } from "@/server/returnables/service";
import { AppError } from "@/server/errors";

/** Phase 40: returnables statement (every movement with the running balance per item) as CSV — customer, supplier or FIRINGI view. */
export async function GET(req: Request) {
  const ctx = await getContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  const q = new URL(req.url).searchParams;
  const as = (["CUSTOMER", "SUPPLIER", "ADMIN"] as const).find((x) => x === q.get("as")) ?? "CUSTOMER";
  const date = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00Z`) : null);
  try {
    const rows = await statement(ctx, as, { counterpartyId: q.get("counterparty"), from: date(q.get("from")), to: date(q.get("to")) }, ctx.user.locale ?? "en");
    const cell = (v: unknown) => { const s = v == null ? "" : String(v); return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const head = ["date", "customer", "supplier", "item_code", "item", "movement", "qty", "balance", "reference", "note"];
    const lines = rows.map((r) => [r.at.toISOString().slice(0, 19).replace("T", " "), r.customer, r.supplier, r.code, r.name, r.kind, r.qty, r.balance, r.ref ?? "", r.note ?? ""].map(cell).join(";"));
    return new Response(`﻿${[head.join(";"), ...lines].join("\n")}\n`, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="firingi-empties-${new Date().toISOString().slice(0, 10)}.csv"`, "cache-control": "private, no-store" } });
  } catch (e) {
    return new Response(e instanceof AppError ? e.message : "Error", { status: e instanceof AppError ? e.status : 500 });
  }
}
