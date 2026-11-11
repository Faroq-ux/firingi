import { getContext } from "@/server/context";
import { invoiceForViewer } from "@/server/services/finance";
import { invoicePdfData } from "@/server/data/finance-docs";
import { renderInvoicePdf } from "@/server/pdf/documents";
import { providerPdf } from "@/server/invoicing/fiscal";
import { MoloniError } from "@/server/invoicing/moloni/client";
import { AppError } from "@/server/errors";

/**
 * The invoice / credit note as a PDF. Issued at Moloni → Moloni's own signed PDF (the legal
 * document); still being issued there → 409; otherwise FIRINGI renders it.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  try {
    const id = (await params).id;
    const inv = await invoiceForViewer(ctx, id);
    if (inv.externalProvider?.startsWith("moloni") && inv.fiscalStatus !== "DONE")
      return new Response("This document is being issued by the certified invoicing system. Please try again in a few minutes.", { status: 409 });
    const name = (inv.providerNumber ?? inv.fullNumber ?? "document").replace(/[^\w-]+/g, "_");
    const external = await providerPdf(inv);
    const pdf = external ?? (await renderInvoicePdf(await invoicePdfData(ctx, id)));
    return new Response(new Uint8Array(pdf), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${name}.pdf"`, "cache-control": "private, no-store" } });
  } catch (e) {
    if (e instanceof MoloniError) return new Response(`The invoicing system is not reachable right now (${e.message}). Please try again shortly.`, { status: 503 });
    return new Response(e instanceof AppError ? e.message : "Error", { status: e instanceof AppError ? e.status : 500 });
  }
}
