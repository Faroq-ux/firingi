import { getContext } from "@/server/context";
import { AppError } from "@/server/errors";

/** Phase 69: the food safety logbook for a period (PDF) — ?from=YYYY-MM-DD&to=YYYY-MM-DD (max 92 days). */
export async function GET(req: Request) {
  const ctx = await getContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  const u = new URL(req.url);
  const day = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00Z`) : null);
  const to = day(u.searchParams.get("to")) ?? new Date();
  const from = day(u.searchParams.get("from")) ?? new Date(to.getTime() - 29 * 86400_000);
  if (from > to || to.getTime() - from.getTime() > 92 * 86400_000) return new Response("Choose up to 3 months.", { status: 400 });
  try {
    const { reportData } = await import("@/server/haccp/service");
    const r = await reportData(ctx, from, to);
    const { renderHaccpPdf } = await import("@/server/pdf/haccp");
    const pdf = await renderHaccpPdf(r);
    return new Response(new Uint8Array(pdf), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="haccp-${from.toISOString().slice(0, 10)}-${to.toISOString().slice(0, 10)}.pdf"`, "cache-control": "private, no-store" } });
  } catch (e) {
    return new Response(e instanceof AppError ? e.message : "Error", { status: e instanceof AppError ? e.status : 500 });
  }
}
