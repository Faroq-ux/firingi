import { processSalesReps } from "@/server/salesreps/service";
import { cronRoute } from "@/server/ops/jobs";

/** Unconfirmed rep orders expire; planned visits from past days become missed. Hourly, "Authorization: Bearer $CRON_SECRET". */
export const { GET, POST } = cronRoute("salesreps", () => processSalesReps());
