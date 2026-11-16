import { getContext } from "@/server/context";
import { chatPhotoKey, type Portal } from "@/server/chat/service";
import { readStored, sniffMime } from "@/server/services/storage";
import { AppError } from "@/server/errors";

/** A photo sent in an order chat — only for someone who can see that conversation. */
export async function GET(_req: Request, { params }: { params: Promise<{ portal: string; id: string; n: string }> }) {
  const ctx = await getContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  try {
    const { portal, id, n } = await params;
    if (!["buy", "vendor", "admin", "driver"].includes(portal) || !/^[a-z0-9]{8,40}$/.test(id) || !/^\d$/.test(n)) return new Response("Not found", { status: 404 });
    const data = await readStored(await chatPhotoKey(ctx, id, Number(n), portal as Portal));
    return new Response(new Uint8Array(data), {
      headers: { "content-type": sniffMime(data) ?? "application/octet-stream", "cache-control": "private, no-store", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox" },
    });
  } catch (e) {
    return new Response(e instanceof AppError ? e.message : "Error", { status: e instanceof AppError ? e.status : 500 });
  }
}
