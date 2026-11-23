import { getContext } from "@/server/context";
import { reportCsv, reportRun, type ReportData } from "@/server/ai/centre/reports";
import { AppError } from "@/server/errors";

/** Phase 66: an AI report as PDF (default) or CSV (?format=csv). FIRINGI staff with the report's data rights. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  try {
    const r = await reportRun(ctx, id);
    const d = r.data as unknown as ReportData;
    const name = `firingi-${r.kind.toLowerCase()}-${d.to}`;
    if (new URL(req.url).searchParams.get("format") === "csv")
      return new Response(reportCsv(d, r.summary), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}.csv"`, "cache-control": "private, no-store" } });
    const { renderAiReportPdf } = await import("@/server/pdf/ai-report");
    const pdf = await renderAiReportPdf(d, r.summary, r.byClaude, r.createdAt);
    return new Response(new Uint8Array(pdf), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${name}.pdf"`, "cache-control": "private, no-store" } });
  } catch (e) {
    return new Response(e instanceof AppError ? e.message : "Error", { status: e instanceof AppError ? e.status : 500 });
  }
}
