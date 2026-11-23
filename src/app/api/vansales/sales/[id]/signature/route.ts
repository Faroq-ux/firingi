/** Phase 63: the customer's signature for a van sale — for the supplier, the customer and FIRINGI. */
import { getContext } from "@/server/context";
import { saleSignature } from "@/server/vansales/service";
import { readStored, sniffMime } from "@/server/services/storage";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  const key = await saleSignature(ctx, id).catch(() => null);
  if (!key) return new Response("Not found", { status: 404 });
  const data = await readStored(key).catch(() => null);
  if (!data) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(data), {
    headers: { "content-type": sniffMime(data) ?? "application/octet-stream", "cache-control": "private, max-age=300", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox" },
  });
}
