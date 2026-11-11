import { apiRoute, orderForApi } from "@/server/api/v2";

/** GET /api/v2/orders/{id} — one order with lines, history, delivery and the statuses it can move to. */
export const GET = apiRoute("orders.read", (ctx, _req, p) => orderForApi(ctx, p.id));
