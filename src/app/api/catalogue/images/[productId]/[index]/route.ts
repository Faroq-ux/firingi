/** Product images — permission-checked (see productImageForViewer). */
import { getContext } from "@/server/context";
import { productImageForViewer } from "@/server/data/catalogue-buyer";
import { readStored } from "@/server/services/storage";

export async function GET(_req: Request, { params }: { params: Promise<{ productId: string; index: string }> }) {
  const ctx = await getContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  const { productId, index } = await params;
  const key = await productImageForViewer(ctx, productId, Number(index));
  if (!key) return new Response("Not found", { status: 404 });
  const data = await readStored(key);
  const type = key.endsWith(".png") ? "image/png" : key.endsWith(".webp") ? "image/webp" : "image/jpeg";
  return new Response(new Uint8Array(data), { headers: { "content-type": type, "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff" } });
}
