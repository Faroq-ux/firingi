import { getContext } from "@/server/context";
import { AppError } from "@/server/errors";
import { templateRows } from "@/server/integrations/catalogue-import";
import { toCsv, toXlsx } from "@/server/integrations/accounting";

/** GET /api/imports/template?file=xlsx|csv — the columns FIRINGI reads, filled with the supplier's current offers. */
export async function GET(req: Request) {
  const ctx = await getContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  try {
    const { header, rows } = await templateRows(ctx);
    const table = { name: "FIRINGI", headers: header, rows };
    if (new URL(req.url).searchParams.get("file") === "csv")
      return new Response(toCsv(table), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="firingi-offers.csv"', "cache-control": "private, no-store" } });
    return new Response(new Uint8Array(await toXlsx([table], "FIRINGI offers")), { headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": 'attachment; filename="firingi-offers.xlsx"', "cache-control": "private, no-store" } });
  } catch (e) {
    return new Response(e instanceof AppError ? e.message : "Error", { status: e instanceof AppError ? e.status : 500 });
  }
}
