import { getContext } from "@/server/context";
import { exportRows } from "@/server/staff/service";
import { AppError } from "@/server/errors";

/** Phase 52: payroll (per person) or the legal time record (every entry) as CSV. ?kind=PAYROLL|RECORD&from=YYYY-MM-DD&to=YYYY-MM-DD */
export async function GET(req: Request) {
  const ctx = await getContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  const u = new URL(req.url);
  const kind = u.searchParams.get("kind") === "RECORD" ? "RECORD" : "PAYROLL";
  try {
    const r = await exportRows(ctx, kind, u.searchParams.get("from") ?? "", u.searchParams.get("to") ?? "");
    const esc = (v: unknown) => { const s = String(v ?? ""); return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const csv = "﻿" + [r.head, ...r.rows].map((row) => row.map(esc).join(";")).join("\r\n");
    return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${r.filename}"`, "cache-control": "private, no-store" } });
  } catch (e) {
    return new Response(e instanceof AppError ? e.message : "Error", { status: e instanceof AppError ? e.status : 500 });
  }
}
