import { getContext } from "@/server/context";
import { deliveryFileKey } from "@/server/services/deliveries";
import { readStored, sniffMime } from "@/server/services/storage";
import { AppError } from "@/server/errors";

/** Proof-of-delivery signature / photos and failed-attempt photos — permission-checked. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; which: string }> }) {
  const ctx = await getContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  try {
    const { id, which } = await params;
    const data = await readStored(await deliveryFileKey(ctx, id, which));
    return new Response(new Uint8Array(data), {
      headers: { "content-type": sniffMime(data) ?? "application/octet-stream", "cache-control": "private, no-store", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox" },
    });
  } catch (e) {
    return new Response(e instanceof AppError ? e.message : "Error", { status: e instanceof AppError ? e.status : 500 });
  }
}
