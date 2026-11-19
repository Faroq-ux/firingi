import { getLocale } from "next-intl/server";
import { getContext } from "@/server/context";
import { exportCsv } from "@/server/food/service";
import { AppError } from "@/server/errors";

/** Food data of the products the customer buys (CSV for its webshop / till). Phase 44. */
export async function GET() {
  const ctx = await getContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  try {
    const csv = await exportCsv(ctx, await getLocale());
    return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="food-information.csv"`, "cache-control": "private, no-store" } });
  } catch (e) {
    return new Response(e instanceof AppError ? e.message : "Error", { status: e instanceof AppError ? e.status : 500 });
  }
}
