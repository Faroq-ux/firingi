import { getLocale } from "next-intl/server";
import { getContext } from "@/server/context";
import { exciseReport, reportCsv } from "@/server/excise/service";
import { AppError } from "@/server/errors";

/** Monthly excise report (?month=YYYY-MM&format=pdf|csv) for a supplier (its own sales) or FIRINGI (all). Phase 43. */
export async function GET(req: Request) {
  const ctx = await getContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  const u = new URL(req.url);
  const month = u.searchParams.get("month") ?? new Date().toISOString().slice(0, 7);
  try {
    const r = await exciseReport(ctx, month, await getLocale());
    if (u.searchParams.get("format") === "csv")
      return new Response("﻿" + reportCsv(r), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="excise-${month}.csv"`, "cache-control": "private, no-store" } });
    const { renderExciseReport } = await import("@/server/pdf/excise");
    const pdf = await renderExciseReport(r);
    return new Response(new Uint8Array(pdf), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="excise-${month}.pdf"`, "cache-control": "private, no-store" } });
  } catch (e) {
    return new Response(e instanceof AppError ? e.message : "Error", { status: e instanceof AppError ? e.status : 500 });
  }
}
