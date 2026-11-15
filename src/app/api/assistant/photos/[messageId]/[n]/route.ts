import { getContext } from "@/server/context";
import { assistantPhotoKey } from "@/server/ai/assistant";
import { readStored, sniffMime } from "@/server/services/storage";
import { AppError } from "@/server/errors";

/** A photo the person sent to the Assistant — only in their own conversation. */
export async function GET(_req: Request, { params }: { params: Promise<{ messageId: string; n: string }> }) {
  const ctx = await getContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  try {
    const { messageId, n } = await params;
    const data = await readStored(await assistantPhotoKey(ctx, messageId, Number(n)));
    return new Response(new Uint8Array(data), {
      headers: { "content-type": sniffMime(data) ?? "application/octet-stream", "cache-control": "private, no-store", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox" },
    });
  } catch (e) {
    return new Response(e instanceof AppError ? e.message : "Error", { status: e instanceof AppError ? e.status : 500 });
  }
}
