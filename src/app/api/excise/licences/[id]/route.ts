import { getContext } from "@/server/context";
import { licenceFile } from "@/server/excise/service";
import { AppError } from "@/server/errors";

/** A customer's licence file — the customer itself or FIRINGI staff. Phase 43. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  try {
    const f = await licenceFile(ctx, (await params).id);
    return new Response(new Uint8Array(f.body), { headers: { "content-type": f.mimeType, "content-disposition": `inline; filename="${f.fileName.replace(/[^\w.-]/g, "_")}"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
  } catch (e) {
    return new Response(e instanceof AppError ? e.message : "Error", { status: e instanceof AppError ? e.status : 500 });
  }
}
