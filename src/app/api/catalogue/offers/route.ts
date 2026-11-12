/**
 * JSON catalogue API for buyers (used by future mobile apps / integrations).
 * Uses exactly the same guarded data layer as the pages, so the visibility rules
 * (no distributors for customers, restricted products, country rules) apply here too.
 */
import { getContext } from "@/server/context";
import { browseCatalogue } from "@/server/data/catalogue-buyer";
import { AppError } from "@/server/errors";

export async function GET(req: Request) {
  const ctx = await getContext();
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const u = new URL(req.url).searchParams;
  try {
    return Response.json(await browseCatalogue(ctx, { q: u.get("q") ?? undefined, categoryId: u.get("category") ?? undefined, vendorId: u.get("vendor") ?? undefined, page: Number(u.get("page")) || 1, badge: u.get("badge") }));
  } catch (e) {
    const err = e instanceof AppError ? e : null;
    return Response.json({ error: err?.message ?? "Error" }, { status: err?.status ?? 500 });
  }
}
