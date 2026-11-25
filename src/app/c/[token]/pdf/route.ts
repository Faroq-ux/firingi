/** Public download of a published marketing catalogue (FIRINGI's own PDF or the generated one). */
import { cataloguePdf, pdfName, publicCatalogue } from "@/server/marketing/catalogues";

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const c = await publicCatalogue(token, false);
  if (!c) return new Response("Not found", { status: 404 });
  const pdf = await cataloguePdf(c);
  return new Response(new Uint8Array(pdf), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${encodeURIComponent(pdfName(c))}"`, "cache-control": "public, max-age=300", "x-content-type-options": "nosniff" } });
}
