import { apiRoute } from "@/server/api/v2";
import { listOwnOffers } from "@/server/api/v2-ops";

/** GET /api/v2/offers — the supplier's own offers with base price, stock and minimums. */
export const GET = apiRoute("offers.write", (ctx) => listOwnOffers(ctx));
