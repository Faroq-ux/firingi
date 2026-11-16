import { runDealsJob } from "@/server/deals/service";
import { cronRoute } from "@/server/ops/jobs";

/** Clearance deals (Phase 38): end finished deals, expire offers, alert buyers about deals that start, send the daily digest. Hourly. "Authorization: Bearer $CRON_SECRET". */
export const { GET, POST } = cronRoute("deals", async () => runDealsJob());
