import { getContext } from "@/server/context";
import { AppError } from "@/server/errors";
import { exportCompany } from "@/server/integrations/accounting";

/** GET /api/exports/company?from=&to=&kinds=buyer.invoices,buyer.payments&file=xlsx — a company's own documents. */
export async function GET(req: Request) {
  const ctx = await getContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  const u = new URL(req.url).searchParams;
  try {
    const f = await exportCompany(ctx, { from: u.get("from") ?? "", to: u.get("to") ?? "", kinds: (u.get("kinds") ?? "").split(",").filter(Boolean), file: u.get("file") === "csv" ? "csv" : "xlsx" });
    return new Response(typeof f.body === "string" ? f.body : new Uint8Array(f.body), { headers: { "content-type": f.contentType, "content-disposition": `attachment; filename="${f.fileName}"`, "cache-control": "private, no-store" } });
  } catch (e) {
    return new Response(e instanceof AppError ? e.message : "Error", { status: e instanceof AppError ? e.status : 500 });
  }
}
