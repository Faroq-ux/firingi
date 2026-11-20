import { runKitchenJob } from "@/server/kitchen/service";
import { cronRoute } from "@/server/ops/jobs";

/** Menu costing & waste (Phase 54): ingredient costs from purchases, price-rise and waste-over-target alerts, use-first reminders. Daily. "Authorization: Bearer $CRON_SECRET". */
export const { GET, POST } = cronRoute("kitchen", async () => runKitchenJob());
