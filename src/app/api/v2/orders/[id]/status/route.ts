import { apiRoute, body } from "@/server/api/v2";
import { StatusBody, statusViaApi } from "@/server/api/v2-ops";

/** POST /api/v2/orders/{id}/status — move the order on: { status, reason? } (see nextStatuses in GET /orders/{id}). */
export const POST = apiRoute("orders.write", async (ctx, req, p) => statusViaApi(ctx, p.id, await body(req, StatusBody)));
