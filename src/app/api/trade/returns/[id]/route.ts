import { getContext } from "@/server/context";
import { returnFile } from "@/server/trade/service";
import { AppError } from "@/server/errors";

/** A trade return as a file (?format=csv|xlsx|national). FIRINGI staff only. Phase 57. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  const f = new URL(req.url).searchParams.get("format");
  try {
    const out = await returnFile(ctx, (await params).id, f === "xlsx" || f === "national" ? f : "csv");
    return new Response(typeof out.body === "string" ? out.body : new Uint8Array(out.body), { headers: { "content-type": out.contentType, "content-disposition": `attachment; filename="${out.fileName}"`, "cache-control": "private, no-store" } });
  } catch (e) {
    return new Response(e instanceof AppError ? e.message : "Error", { status: e instanceof AppError ? e.status : 500 });
  }
}
