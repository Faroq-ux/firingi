import { runExciseJob } from "@/server/excise/service";
import { cronRoute } from "@/server/ops/jobs";

/** Licensed goods (Phase 43): licence reminders before expiry, expired licences marked. Daily. "Authorization: Bearer $CRON_SECRET". */
export const { GET, POST } = cronRoute("excise", async () => runExciseJob());
