import { runTradeJob } from "@/server/trade/service";
import { cronRoute } from "@/server/ops/jobs";

/** EU trade reporting (Phase 57): returns rebuilt, filing reminders, threshold watch. Daily. "Authorization: Bearer $CRON_SECRET". */
export const { GET, POST } = cronRoute("trade", async () => runTradeJob());
