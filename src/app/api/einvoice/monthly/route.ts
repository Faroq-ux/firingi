import { getContext } from "@/server/context";
import { downloadPack } from "@/server/einvoice/monthly";
import { AppError } from "@/server/errors";

/** Phase 46: a month's pack (ZIP: the XML, the summary PDF) for the company itself or FIRINGI finance. */
export async function GET(req: Request) {
  const ctx = await getContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  const u = new URL(req.url);
  const period = u.searchParams.get("period") ?? "";
  const companyId = u.searchParams.get("companyId") ?? ctx.company.id;
  try {
    const p = await downloadPack(ctx, period, companyId);
    const name = `FIRINGI-${period}-${p.name.replace(/[^\w.-]+/g, "_")}.zip`;
    return new Response(new Uint8Array(p.zip), { headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="${name}"`, "cache-control": "private, no-store" } });
  } catch (e) {
    return new Response(e instanceof AppError ? e.message : "Error", { status: e instanceof AppError ? e.status : 500 });
  }
}
