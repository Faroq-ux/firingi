import { getContext } from "@/server/context";
import { claimPhotoKey } from "@/server/claims/service";
import { readStored, sniffMime } from "@/server/services/storage";
import { AppError } from "@/server/errors";

/** Photos on a quality claim — customer (c), supplier (s) or a message (m<id>); FIRINGI-only notes stay with FIRINGI. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; who: string; n: string }> }) {
  const ctx = await getContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  try {
    const { id, who, n } = await params;
    if (who !== "c" && who !== "s" && !/^m[a-z0-9]{8,40}$/.test(who)) return new Response("Not found", { status: 404 });
    const data = await readStored(await claimPhotoKey(ctx, id, who as "c" | "s" | `m${string}`, Number(n)));
    return new Response(new Uint8Array(data), {
      headers: { "content-type": sniffMime(data) ?? "application/octet-stream", "cache-control": "private, no-store", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox" },
    });
  } catch (e) {
    return new Response(e instanceof AppError ? e.message : "Error", { status: e instanceof AppError ? e.status : 500 });
  }
}
