import { apiRoute, sideOf } from "@/server/api/v2";
import { invoicesForApi } from "@/server/api/v2-ops";

/** GET /api/v2/invoices?as=buyer|supplier — FIRINGI's invoices to the buyer, or the supplier's statements. */
export const GET = apiRoute("invoices.read", (ctx, req) => invoicesForApi(ctx, sideOf(ctx, new URL(req.url).searchParams.get("as"))));
