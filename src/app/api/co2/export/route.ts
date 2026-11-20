import { getContext } from "@/server/context";
import { co2Csv, co2ReportFor } from "@/server/co2/service";
import { co2Labels } from "@/components/co2/labels";
import { AppError } from "@/server/errors";

/** Phase 51: the CO₂ report as CSV (CSRD-style Scope 3 rows) or PDF. ?side=BUYER|VENDOR|ADMIN&year=2026&format=csv|pdf */
export async function GET(req: Request) {
  const ctx = await getContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  const u = new URL(req.url);
  const year = Number(u.searchParams.get("year")) || new Date().getUTCFullYear();
  const asked = u.searchParams.get("side");
  const side = ctx.company.type === "ADMIN" ? "ADMIN" : asked === "VENDOR" && (ctx.company.type === "WHOLESALER" || ctx.company.type === "DISTRIBUTOR") ? "VENDOR" : "BUYER";
  try {
    const { l, locale } = await co2Labels(side === "ADMIN");
    if (u.searchParams.get("format") === "pdf") {
      const r = await co2ReportFor(ctx, side, year, locale);
      if (!r.settings.show.export) return new Response("Switched off", { status: 404 });
      const { renderCo2Pdf } = await import("@/server/pdf/co2");
      const pdf = await renderCo2Pdf({ r, company: ctx.company.tradeName ?? ctx.company.legalName, locale, l, partyLabel: side === "BUYER" ? l.bySupplier : l.byCustomer });
      return new Response(new Uint8Array(pdf), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="co2-${year}.pdf"`, "cache-control": "private, no-store" } });
    }
    const csv = await co2Csv(ctx, side, year, locale);
    return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="co2-scope3-${year}.csv"`, "cache-control": "private, no-store" } });
  } catch (e) {
    return new Response(e instanceof AppError ? e.message : "Error", { status: e instanceof AppError ? e.status : 500 });
  }
}
