import { getContext } from "@/server/context";
import { globalSearch } from "@/server/services/search";
import type { Portal } from "@/server/rbac/guard";

/** GET /api/search?portal=admin|vendor|buy&q= — command palette (signed-in session only). */
export async function GET(req: Request) {
  const ctx = await getContext();
  if (!ctx || ctx.sessionId.startsWith("api:")) return Response.json({ hits: [] }, { status: 401 });
  const u = new URL(req.url).searchParams;
  const portal = (["admin", "vendor", "buy"].includes(u.get("portal") ?? "") ? u.get("portal") : "buy") as Portal;
  const hits = await globalSearch(ctx, portal, u.get("q") ?? "");
  return Response.json({ hits }, { headers: { "cache-control": "private, no-store" } });
}
