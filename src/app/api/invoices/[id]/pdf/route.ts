import { getContext } from "@/server/context";
import { invoicePdfData } from "@/server/data/finance-docs";
import { renderInvoicePdf } from "@/server/pdf/documents";
import { AppError } from "@/server/errors";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  try {
    const data = await invoicePdfData(ctx, (await params).id);
    const pdf = await renderInvoicePdf(data);
    return new Response(new Uint8Array(pdf), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${data.fullNumber.replace(/[^\w-]+/g, "_")}.pdf"`, "cache-control": "private, no-store" } });
  } catch (e) {
    return new Response(e instanceof AppError ? e.message : "Error", { status: e instanceof AppError ? e.status : 500 });
  }
}
