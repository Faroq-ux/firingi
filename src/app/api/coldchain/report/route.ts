import { getLocale } from "next-intl/server";
import { getContext } from "@/server/context";
import { monthlyReport, reportCsv } from "@/server/coldchain/service";
import { AppError } from "@/server/errors";

/** Monthly HACCP temperature report (?month=YYYY-MM&format=pdf|csv) for the customer, supplier or FIRINGI. Phase 42. */
export async function GET(req: Request) {
  const ctx = await getContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  const u = new URL(req.url);
  const month = u.searchParams.get("month") ?? new Date().toISOString().slice(0, 7);
  try {
    const r = await monthlyReport(ctx, month, await getLocale());
    if (u.searchParams.get("format") === "csv")
      return new Response("﻿" + reportCsv(r), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="haccp-${month}.csv"`, "cache-control": "private, no-store" } });
    const { renderMonthlyReport } = await import("@/server/pdf/coldchain");
    const pdf = await renderMonthlyReport(r);
    return new Response(new Uint8Array(pdf), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="haccp-${month}.pdf"`, "cache-control": "private, no-store" } });
  } catch (e) {
    return new Response(e instanceof AppError ? e.message : "Error", { status: e instanceof AppError ? e.status : 500 });
  }
}
