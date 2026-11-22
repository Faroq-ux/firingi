import { getContext } from "@/server/context";
import { resultsCsv } from "@/server/salesreps/service";
import { AppError } from "@/server/errors";

/** Phase 62: the sales team's month results as CSV (?month=YYYY-MM) — for the supplier's managers. */
export async function GET(req: Request) {
  const ctx = await getContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  const month = new URL(req.url).searchParams.get("month");
  try {
    const csv = await resultsCsv(ctx, month);
    const key = /^\d{4}-\d{2}$/.test(month ?? "") ? month : new Date().toISOString().slice(0, 7);
    return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="sales-reps-${key}.csv"`, "cache-control": "private, no-store" } });
  } catch (e) {
    return new Response(e instanceof AppError ? e.message : "Error", { status: e instanceof AppError ? e.status : 500 });
  }
}
