/** Phase 39: the app was installed / opened from the home screen (for FIRINGI's overview). */
import { getContext } from "@/server/context";
import { recordAppEvent } from "@/server/app/service";
import { APP_PORTALS, type AppPortal } from "@/lib/app";

export async function POST(req: Request) {
  const ctx = await getContext();
  if (!ctx) return new Response(null, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { portal?: string; kind?: string; platform?: string };
  if (!APP_PORTALS.includes(b.portal as AppPortal) || (b.kind !== "INSTALLED" && b.kind !== "OPENED")) return new Response(null, { status: 400 });
  await recordAppEvent(ctx, b.portal as AppPortal, b.kind, b.platform ?? null).catch(() => null);
  return new Response(null, { status: 204 });
}
