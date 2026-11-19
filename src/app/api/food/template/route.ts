import { getContext } from "@/server/context";
import { supplierFoodList } from "@/server/food/service";
import { templateCsv } from "@/server/food/import";
import { AppError } from "@/server/errors";

/** The import template (?layout=firingi|gs1) with the supplier's food products listed. Phase 44. */
export async function GET(req: Request) {
  const ctx = await getContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  const layout = new URL(req.url).searchParams.get("layout") === "gs1" ? "gs1" : "firingi";
  try {
    const { rows } = await supplierFoodList(ctx);
    const csv = templateCsv(rows.map((r) => ({ sku: r.sku, gtin: r.gtin, name: r.name })), layout);
    return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="firingi-food-${layout}.csv"`, "cache-control": "private, no-store" } });
  } catch (e) {
    return new Response(e instanceof AppError ? e.message : "Error", { status: e instanceof AppError ? e.status : 500 });
  }
}
