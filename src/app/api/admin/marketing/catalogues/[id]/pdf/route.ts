/** FIRINGI: the catalogue PDF while editing (any status). */
import { getContext } from "@/server/context";
import { cataloguePdf, getCatalogue, pdfName } from "@/server/marketing/catalogues";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getContext().catch(() => null);
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  const c = await getCatalogue(ctx, id).catch(() => null);
  if (!c) return new Response("Not found", { status: 404 });
  const pdf = await cataloguePdf(c);
  return new Response(new Uint8Array(pdf), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${encodeURIComponent(pdfName(c))}"`, "cache-control": "no-store" } });
}
