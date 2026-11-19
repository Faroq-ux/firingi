import { getContext } from "@/server/context";
import { vendorInvoiceFile } from "@/server/data/finance-docs";
import { readStored } from "@/server/services/storage";
import { AppError } from "@/server/errors";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  try {
    const vi = await vendorInvoiceFile(ctx, (await params).id);
    // Phase 46: a self-billed invoice is rendered from its statement; a received e-invoice is its XML
    if (vi.fileKey.startsWith("selfbill/")) {
      const { selfBilledPdf } = await import("@/server/einvoice/pdf");
      const pdf = await selfBilledPdf(vi.fileKey.slice("selfbill/".length).replace(/\.pdf$/, ""));
      return new Response(new Uint8Array(pdf), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${vi.externalNumber.replace(/[^\w-]+/g, "_")}.pdf"`, "cache-control": "private, no-store" } });
    }
    const data = await readStored(vi.fileKey);
    if (vi.fileKey.endsWith(".xml")) return new Response(new Uint8Array(data), { headers: { "content-type": "application/xml; charset=utf-8", "content-disposition": `attachment; filename="${vi.externalNumber.replace(/[^\w-]+/g, "_")}.xml"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
    const type = vi.fileKey.endsWith(".pdf") ? "application/pdf" : vi.fileKey.endsWith(".png") ? "image/png" : "image/jpeg";
    return new Response(new Uint8Array(data), { headers: { "content-type": type, "cache-control": "private, no-store", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox" } });
  } catch (e) {
    return new Response(e instanceof AppError ? e.message : "Error", { status: e instanceof AppError ? e.status : 500 });
  }
}
