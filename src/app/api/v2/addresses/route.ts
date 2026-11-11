import { apiRoute } from "@/server/api/v2";
import { deliveryAddresses } from "@/server/api/v2-ops";

/** GET /api/v2/addresses — the buyer's delivery addresses (for POST /orders). */
export const GET = apiRoute("orders.write", async (ctx) => ({ addresses: await deliveryAddresses(ctx) }));
