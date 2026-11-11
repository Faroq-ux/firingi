import { apiRoute, body } from "@/server/api/v2";
import { ConfirmBody, confirmViaApi } from "@/server/api/v2-ops";

/** POST /api/v2/orders/{id}/confirm — the supplier confirms: { quantities?: { [lineId]: qty } } (missing lines = as ordered). */
export const POST = apiRoute("orders.write", async (ctx, req, p) => confirmViaApi(ctx, p.id, await body(req, ConfirmBody)));
