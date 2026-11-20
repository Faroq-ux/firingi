import { runTendersJob } from "@/server/tenders/service";
import { cronRoute } from "@/server/ops/jobs";

/** Open tenders (Phase 50): close bidding at the deadline; expire tenders not awarded in time. Every 15 minutes. "Authorization: Bearer $CRON_SECRET". */
export const { GET, POST } = cronRoute("tenders", async () => runTendersJob());
