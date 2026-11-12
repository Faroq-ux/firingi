import { runPricingJob } from "@/server/price-intel/service";
import { cronRoute } from "@/server/ops/jobs";

/** Price intelligence (Phase 29): apply approved price changes that are due, detect price alerts. Hourly. "Authorization: Bearer $CRON_SECRET". */
export const { GET, POST } = cronRoute("pricing", async () => runPricingJob());
