import { getContext } from "@/server/context";
import { certificateData } from "@/server/coldchain/service";
import { AppError } from "@/server/errors";

/** Temperature certificate of a delivered order (PDF) — the customer, the supplier or FIRINGI. Phase 42. */
export async function GET(_req: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const ctx = await getContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  try {
    const data = await certificateData(ctx, (await params).orderId);
    const { renderCertificate } = await import("@/server/pdf/coldchain");
    const pdf = await renderCertificate(data);
    return new Response(new Uint8Array(pdf), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="temperatura-${data.number}.pdf"`, "cache-control": "private, no-store" } });
  } catch (e) {
    return new Response(e instanceof AppError ? e.message : "Error", { status: e instanceof AppError ? e.status : 500 });
  }
}
