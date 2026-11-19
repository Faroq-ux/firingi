import { getContext } from "@/server/context";
import { documentFile } from "@/server/einvoice/service";
import { AppError } from "@/server/errors";

/** Phase 46: an e-invoice's XML or PDF — its customer / supplier, or FIRINGI finance. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; file: string }> }) {
  const ctx = await getContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  const { id, file } = await params;
  if (file !== "xml" && file !== "pdf") return new Response("Not found", { status: 404 });
  try {
    const f = await documentFile(ctx, id, file);
    return new Response(new Uint8Array(f.buf), { headers: { "content-type": f.type, "content-disposition": `attachment; filename="${f.name}"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
  } catch (e) {
    return new Response(e instanceof AppError ? e.message : "Error", { status: e instanceof AppError ? e.status : 500 });
  }
}
