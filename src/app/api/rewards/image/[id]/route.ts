import { getContext } from "@/server/context";
import { rewardImageKey } from "@/server/rewards/service";
import { readStored, sniffMime } from "@/server/services/storage";
import { AppError } from "@/server/errors";

/** A rewards-shop picture (Phase 55): for anyone signed in. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  try {
    const { id } = await params;
    const data = await readStored(await rewardImageKey(id));
    return new Response(new Uint8Array(data), {
      headers: { "content-type": sniffMime(data) ?? "application/octet-stream", "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox" },
    });
  } catch (e) {
    return new Response(e instanceof AppError ? e.message : "Error", { status: e instanceof AppError ? e.status : 500 });
  }
}
