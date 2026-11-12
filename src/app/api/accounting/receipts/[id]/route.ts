import { getContext } from "@/server/context";
import { entryReceipt } from "@/server/accounting/entries";
import { AppError } from "@/server/errors";

/** A receipt photo / PDF of the company's own expense (never shown to FIRINGI staff). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext();
  if (!ctx) return new Response("Please sign in.", { status: 401 });
  try {
    const r = await entryReceipt(ctx, (await params).id);
    return new Response(new Uint8Array(r.body), { headers: { "content-type": r.mime, "content-disposition": `inline; filename="${r.name.replace(/[^\w.-]/g, "_")}"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
  } catch (e) {
    if (e instanceof AppError) return new Response(e.message, { status: e.status });
    throw e;
  }
}
