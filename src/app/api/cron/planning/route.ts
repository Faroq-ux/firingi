import { runPlanning } from "@/server/planning/service";
import { cronRoute } from "@/server/ops/jobs";

/** Demand planning (Phase 30): forecasts, actuals, restock suggestions for every supplier. Daily. "Authorization: Bearer $CRON_SECRET". */
export const { GET, POST } = cronRoute("planning", async () => runPlanning());
