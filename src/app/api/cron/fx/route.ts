import { runFxJob } from "@/server/currency/service";
import { cronRoute } from "@/server/ops/jobs";

/** Exchange rates (Phase 45): the ECB daily reference rates, alerts on big moves / feed failures / stale rates. Daily after 16:00 CET. "Authorization: Bearer $CRON_SECRET". */
export const { GET, POST } = cronRoute("fx", async () => runFxJob());
