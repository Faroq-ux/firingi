import { apiRoute, body } from "@/server/api/v2";
import { SyncBody, syncOffers } from "@/server/api/v2-ops";

/** POST /api/v2/offers/sync — send prices / stock / minimums from your ERP; FIRINGI applies what changed. */
export const POST = apiRoute("offers.write", async (ctx, req) => syncOffers(ctx, await body(req, SyncBody)));
