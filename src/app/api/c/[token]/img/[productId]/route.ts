/** Product photos in a marketing catalogue: public once published (FIRINGI staff while editing). */
import { getContext } from "@/server/context";
import { catalogueImageKey } from "@/server/marketing/catalogues";
import { readStored, sniffMime } from "@/server/services/storage";

export async function GET(_req: Request, { params }: { params: Promise<{ token: string; productId: string }> }) {
  const { token, productId } = await params;
  const viewer = await getContext().catch(() => null);
  const key = await catalogueImageKey(token, productId, viewer);
  if (!key) return new Response("Not found", { status: 404 });
  const data = await readStored(key).catch(() => null);
  if (!data) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(data), { headers: { "content-type": sniffMime(data) ?? "application/octet-stream", "cache-control": viewer ? "private, max-age=300" : "public, max-age=600", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox" } });
}
