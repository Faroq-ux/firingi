import { getContext } from "@/server/context";
import { certificateFile } from "@/server/compliance/service";
import { AppError } from "@/server/errors";

/** A supplier certificate file: FIRINGI staff, the supplier, or a buyer when the certificate type allows public download. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext();
  if (!ctx) return new Response("Please sign in.", { status: 401 });
  try {
    const r = await certificateFile(ctx, (await params).id);
    return new Response(new Uint8Array(r.body), { headers: { "content-type": r.mimeType, "content-disposition": `inline; filename="${r.fileName.replace(/[^\w.-]/g, "_")}"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
  } catch (e) {
    if (e instanceof AppError) return new Response(e.message, { status: e.status });
    throw e;
  }
}
