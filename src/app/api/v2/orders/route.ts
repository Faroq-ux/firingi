import { apiRoute, body, sideOf } from "@/server/api/v2";
import { PlaceBody, ordersForApi, placeOrderViaApi } from "@/server/api/v2-ops";

/** GET /api/v2/orders?as=buyer|supplier&since=ISO&status=A,B&page=N — orders placed (buyer) or received (supplier). */
export const GET = apiRoute("orders.read", (ctx, req) => {
  const u = new URL(req.url).searchParams;
  return ordersForApi(ctx, sideOf(ctx, u.get("as")), { since: u.get("since"), status: u.get("status"), page: Number(u.get("page")) || 1 });
});

/** POST /api/v2/orders — a buyer places an order: { lines: [{ offerId, qty }], deliveryAddressId?, requestedDeliveryDate?, notes? }. */
export const POST = apiRoute("orders.write", async (ctx, req) => placeOrderViaApi(ctx, await body(req, PlaceBody)));
