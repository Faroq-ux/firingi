/** A file of a print order: the print-ready shelf-labels PDF ("pdf") or the customer's file n — for the customer, its supplier and FIRINGI. */
import { getContext } from "@/server/context";
import { AppError } from "@/server/errors";
import { printFileKey } from "@/server/servicing/printing";
import { readStored } from "@/server/services/storage";

const TYPES: Record<string, string> = { pdf: "application/pdf", jpg: "image/jpeg", png: "image/png", webp: "image/webp" };

export async function GET(_req: Request, { params }: { params: Promise<{ id: string; which: string }> }) {
  const { id, which } = await params;
  const ctx = await getContext().catch(() => null);
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  try {
    const f = await printFileKey(ctx, id, which);
    const buf = await readStored(f.key);
    const ext = f.key.split(".").pop() ?? "pdf";
    return new Response(new Uint8Array(buf), { headers: { "content-type": TYPES[ext] ?? "application/octet-stream", "content-disposition": `inline; filename="${encodeURIComponent(f.name)}"`, "cache-control": "private, no-store" } });
  } catch (e) {
    if (e instanceof AppError) return new Response(e.message, { status: e.status });
    throw e;
  }
}
