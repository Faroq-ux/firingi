import { getContext } from "@/server/context";
import { AppError } from "@/server/errors";

/** Phase 68: a done visit's collection note / service certificate (PDF) — the customer, the provider or FIRINGI. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  try {
    const { visitDocument } = await import("@/server/servicing/plans");
    const d = await visitDocument(ctx, id);
    const { renderVisitPdf } = await import("@/server/pdf/service-visit");
    const pdf = await renderVisitPdf(d);
    return new Response(new Uint8Array(pdf), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="firingi-${d.number}.pdf"`, "cache-control": "private, no-store" } });
  } catch (e) {
    return new Response(e instanceof AppError ? e.message : "Error", { status: e instanceof AppError ? e.status : 500 });
  }
}
