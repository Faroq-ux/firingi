import { processOverdue } from "@/server/allocation/engine";
import { cronRoute } from "@/server/ops/jobs";

/** Moves orders suppliers didn't confirm in time. Every 10 minutes, "Authorization: Bearer $CRON_SECRET". */
export const { GET, POST } = cronRoute("allocation", () => processOverdue());
