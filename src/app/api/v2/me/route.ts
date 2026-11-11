import { apiRoute } from "@/server/api/v2";
import { whoAmI } from "@/server/api/v2-ops";

/** GET /api/v2/me — the company, the user the key acts as, and what the key may do. */
export const GET = apiRoute(null, (ctx) => whoAmI(ctx));
