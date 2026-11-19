import { runFoodJob } from "@/server/food/service";
import { cronRoute } from "@/server/ops/jobs";

/** Food information (Phase 44): diet-certificate reminders, the "required to sell" gate re-checked. Daily. "Authorization: Bearer $CRON_SECRET". */
export const { GET, POST } = cronRoute("food", async () => runFoodJob());
