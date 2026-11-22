/** Phase 62: a visit photo — for the rep, the supplier's managers and FIRINGI. */
import { getContext } from "@/server/context";
import { visitPhotoKey } from "@/server/salesreps/service";
import { readStored, sniffMime } from "@/server/services/storage";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string; n: string }> }) {
  const ctx = await getContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  const { id, n } = await params;
  const key = await visitPhotoKey(ctx, id, Math.max(0, Math.floor(Number(n)) || 0));
  if (!key) return new Response("Not found", { status: 404 });
  const data = await readStored(key).catch(() => null);
  if (!data) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(data), {
    headers: { "content-type": sniffMime(data) ?? "application/octet-stream", "cache-control": "private, max-age=300", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox" },
  });
}
