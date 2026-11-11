import { getLocale } from "next-intl/server";
import { getContext } from "@/server/context";
import { boxLabelsPdf, packingSlipPdf } from "@/server/warehouse/documents";
import { AppError } from "@/server/errors";

/** Packing slip (/slip?order=…) or box labels (/boxes?order=…) of an order on a pick list. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string; doc: string }> }) {
  const ctx = await getContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  try {
    const { id, doc } = await params;
    const orderId = new URL(req.url).searchParams.get("order") ?? "";
    const locale = await getLocale();
    const r = doc === "slip" ? await packingSlipPdf(ctx, id, orderId, locale) : doc === "boxes" ? await boxLabelsPdf(ctx, id, orderId, locale) : null;
    if (!r) return new Response("Not found", { status: 404 });
    return new Response(new Uint8Array(r.pdf), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${doc === "slip" ? "packing-slip" : "box-labels"}-${r.number}.pdf"`, "cache-control": "private, no-store" } });
  } catch (e) {
    return new Response(e instanceof AppError ? e.message : "Error", { status: e instanceof AppError ? e.status : 500 });
  }
}
