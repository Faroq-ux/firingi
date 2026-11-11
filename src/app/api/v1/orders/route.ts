/**
 * DEPRECATED — use /api/v2/orders (same key). Kept for integrations built on Phase 11.
 * Orders API (API key "orders.read" or a signed-in session):
 *   GET /api/v1/orders?as=buyer|vendor&since=ISO-date&page=N
 * Buyers get the orders they placed; suppliers the orders they received.
 */
import { getContext } from "@/server/context";
import { AppError } from "@/server/errors";
import { listOrders } from "@/server/services/orders";

export async function GET(req: Request) {
  const ctx = await getContext();
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const u = new URL(req.url).searchParams;
  const as = u.get("as") === "vendor" || (!u.get("as") && ctx.company.type === "DISTRIBUTOR") ? "VENDOR" : "BUYER";
  const since = u.get("since") ? new Date(u.get("since")!) : undefined;
  try {
    const r = await listOrders(ctx, as, { page: Number(u.get("page")) || 1, since: since && !Number.isNaN(since.getTime()) ? since : undefined });
    return Response.json(r, { headers: { "cache-control": "private, no-store", deprecation: "true", link: '</api/v2/orders>; rel="successor-version"' } });
  } catch (e) {
    const err = e instanceof AppError ? e : null;
    return Response.json({ error: err?.message ?? "Error" }, { status: err?.status ?? 500 });
  }
}
