import { apiRoute } from "@/server/api/v2";
import { catalogueForApi } from "@/server/api/v2-ops";

/** GET /api/v2/catalogue?q=&category=&page=&lang=pt — what the buyer can order, at its prices. */
export const GET = apiRoute("catalogue.read", (ctx, req) => {
  const u = new URL(req.url).searchParams;
  return catalogueForApi(ctx, { q: u.get("q") ?? undefined, categoryId: u.get("category") ?? undefined, page: Number(u.get("page")) || 1, lang: u.get("lang") ?? undefined });
});
