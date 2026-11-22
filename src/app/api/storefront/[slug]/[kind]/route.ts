/** Storefront pictures (Phase 61): logo, banner, products the store sells — public once the store is published. */
import { getContext } from "@/server/context";
import { storefrontImageKey } from "@/server/storefront/service";
import { readStored, sniffMime } from "@/server/services/storage";

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; kind: string }> }) {
  const { slug, kind } = await params;
  const viewer = await getContext().catch(() => null);
  const key = await storefrontImageKey(slug, kind, viewer);
  if (!key) return new Response("Not found", { status: 404 });
  const data = await readStored(key).catch(() => null);
  if (!data) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(data), {
    headers: { "content-type": sniffMime(data) ?? "application/octet-stream", "cache-control": viewer ? "private, max-age=300" : "public, max-age=600", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox" },
  });
}
