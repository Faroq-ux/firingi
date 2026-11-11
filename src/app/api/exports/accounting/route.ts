import { getContext } from "@/server/context";
import { AppError } from "@/server/errors";
import { exportAccounting, FORMATS, JOURNALS, type Format, type Journal } from "@/server/integrations/accounting";

/** GET /api/exports/accounting?from=&to=&journals=SALES,RECEIPTS&format=documents&file=xlsx — FIRINGI finance. */
export async function GET(req: Request) {
  const ctx = await getContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  const u = new URL(req.url).searchParams;
  try {
    const journals = (u.get("journals") ?? "").split(",").filter((j): j is Journal => (JOURNALS as readonly string[]).includes(j));
    const format = (FORMATS as readonly string[]).includes(u.get("format") ?? "") ? (u.get("format") as Format) : "documents";
    const f = await exportAccounting(ctx, { from: u.get("from") ?? "", to: u.get("to") ?? "", journals, format, file: u.get("file") === "csv" ? "csv" : "xlsx" });
    return new Response(typeof f.body === "string" ? f.body : new Uint8Array(f.body), { headers: { "content-type": f.contentType, "content-disposition": `attachment; filename="${f.fileName}"`, "cache-control": "private, no-store" } });
  } catch (e) {
    return new Response(e instanceof AppError ? e.message : "Error", { status: e instanceof AppError ? e.status : 500 });
  }
}
