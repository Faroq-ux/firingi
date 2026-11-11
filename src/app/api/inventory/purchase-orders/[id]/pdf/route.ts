import { getContext } from "@/server/context";
import { purchaseOrderPdf } from "@/server/inventory/purchasing";
import { AppError } from "@/server/errors";

/** A supplier's purchase order as a PDF (only its own). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  try {
    const id = (await params).id;
    const pdf = await purchaseOrderPdf(ctx, id);
    return new Response(new Uint8Array(pdf), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="purchase-order-${id}.pdf"`, "cache-control": "private, no-store" } });
  } catch (e) {
    return new Response(e instanceof AppError ? e.message : "Error", { status: e instanceof AppError ? e.status : 500 });
  }
}
