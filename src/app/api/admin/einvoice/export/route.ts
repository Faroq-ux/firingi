import { getContext } from "@/server/context";
import { auditExport } from "@/server/einvoice/service";
import { AppError } from "@/server/errors";

/** Phase 46: auditor export of the e-invoice archive for a period (ZIP: XML, PDF, manifest with hashes). */
export async function GET(req: Request) {
  const ctx = await getContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  const u = new URL(req.url);
  const from = new Date(u.searchParams.get("from") ?? "");
  const to = new Date(`${u.searchParams.get("to") ?? ""}T23:59:59Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) return new Response("Give from and to dates (YYYY-MM-DD).", { status: 400 });
  const country = u.searchParams.get("country") || undefined;
  try {
    const { zip } = await auditExport(ctx, { from, to, country });
    const name = `firingi-einvoices-${from.toISOString().slice(0, 10)}-${to.toISOString().slice(0, 10)}${country ? `-${country}` : ""}.zip`;
    return new Response(new Uint8Array(zip), { headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="${name}"`, "cache-control": "private, no-store" } });
  } catch (e) {
    return new Response(e instanceof AppError ? e.message : "Error", { status: e instanceof AppError ? e.status : 500 });
  }
}
